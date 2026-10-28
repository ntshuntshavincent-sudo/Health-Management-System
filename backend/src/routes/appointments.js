/**
 * APPOINTMENT ROUTES — /api/appointments
 * ────────────────────────────────────
 * GET    /                 list (defaults to today, always facility scoped)
 * GET    /waiting-room     live queue from v_waiting_room
 * GET    /:appointment_id  one appointment with patient, vitals and notes
 * POST   /                 book
 * PATCH  /:appointment_id/status   move through the visit flow
 * PATCH  /:appointment_id          reschedule / change provider or department
 */

const express = require('express');
const { body, param } = require('express-validator');

const db = require('../db/pool');
const { ApiError, asyncHandler, validate, translateDbError } = require('../utils/http');
const { authenticate, allowRoles, facilityScope } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();

const STATUSES = ['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'];

// Who is allowed to make each move. The front desk can check a patient in;
// only clinical staff may start or complete a consultation.
const TRANSITIONS = {
  scheduled:   { to: ['checked_in', 'in_progress', 'cancelled', 'no_show'], roles: ['superadmin', 'admin', 'doctor', 'nurse', 'receptionist'] },
  checked_in:  { to: ['in_progress', 'cancelled', 'no_show'],              roles: ['superadmin', 'admin', 'doctor', 'nurse', 'receptionist'] },
  in_progress: { to: ['completed', 'cancelled'],                           roles: ['superadmin', 'admin', 'doctor', 'nurse'] },
  completed:   { to: [],                                                   roles: [] },
  cancelled:   { to: ['scheduled'],                                        roles: ['superadmin', 'admin'] },
  no_show:     { to: ['scheduled', 'cancelled'],                           roles: ['superadmin', 'admin'] },
};

const APPOINTMENT_FIELDS = `
  a.appointment_id, a.patient_id, a.provider_id, a.facility_id, a.department_id,
  a.scheduled_at, a.duration_minutes, a.status, a.priority, a.reason,
  a.checked_in_at, a.completed_at, a.created_at, a.updated_at,
  p.first_name, p.last_name, p.id_number, p.date_of_birth, p.gender, p.phone,
  p.blood_type, p.allergies, p.chronic_conditions,
  pr.name AS provider_name, pr.role AS provider_role, pr.specialisation,
  f.name AS facility_name, f.type AS facility_type, f.code AS facility_code,
  dep.name AS department_name, dep.type AS department_type,
  (pf.folder_number) AS folder_number
`;

const APPOINTMENT_JOINS = `
  FROM appointments a
  JOIN patients   p   ON p.patient_id     = a.patient_id
  JOIN providers  pr  ON pr.provider_id   = a.provider_id
  JOIN facilities f   ON f.facility_id    = a.facility_id
  LEFT JOIN departments dep ON dep.department_id = a.department_id
  LEFT JOIN patient_folders pf ON pf.patient_id = a.patient_id AND pf.facility_id = a.facility_id
`;

// ── GET /api/appointments ──────────────────────────────────────────────────
router.get('/', authenticate, facilityScope, asyncHandler(async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';

  if (req.facilityId) { params.push(req.facilityId); where += ` AND a.facility_id = $${params.length}`; }
  if (req.query.department_id) { params.push(req.query.department_id); where += ` AND a.department_id = $${params.length}`; }
  if (req.query.provider_id)   { params.push(req.query.provider_id);   where += ` AND a.provider_id = $${params.length}`; }
  if (req.query.patient_id)    { params.push(req.query.patient_id);    where += ` AND a.patient_id = $${params.length}`; }
  if (req.query.status)        { params.push(req.query.status);        where += ` AND a.status = $${params.length}`; }
  if (req.query.include_inactive !== 'true') where += ` AND a.status NOT IN ('cancelled','no_show')`;

  // Date window. Nothing supplied → today, which is what a clinic works with.
  if (req.query.date) {
    params.push(req.query.date);
    where += ` AND a.scheduled_at::date = $${params.length}::date`;
  } else if (req.query.from || req.query.to) {
    if (req.query.from) { params.push(req.query.from); where += ` AND a.scheduled_at >= $${params.length}::date`; }
    if (req.query.to)   { params.push(req.query.to);   where += ` AND a.scheduled_at < ($${params.length}::date + INTERVAL '1 day')`; }
  } else if (!req.query.patient_id && !req.query.provider_id) {
    where += ' AND a.scheduled_at::date = CURRENT_DATE';
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  params.push(limit);

  const { rows } = await db.query(
    `SELECT ${APPOINTMENT_FIELDS} ${APPOINTMENT_JOINS} ${where}
      ORDER BY a.scheduled_at ASC LIMIT $${params.length}`,
    params
  );

  res.json({ appointments: rows, count: rows.length });
}));

// ── GET /api/appointments/waiting-room ─────────────────────────────────────
// The nurse's view: everybody who is scheduled or physically waiting today.
router.get('/waiting-room', authenticate, facilityScope, asyncHandler(async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';
  if (req.facilityId) { params.push(req.facilityId); where += ` AND facility_id = $${params.length}`; }
  if (req.query.department_id) { params.push(req.query.department_id); where += ` AND department_id = $${params.length}`; }

  const { rows } = await db.query(
    `SELECT * FROM v_waiting_room ${where} ORDER BY priority DESC, scheduled_at ASC`,
    params
  );

  res.json({
    waiting: rows.filter((r) => r.status === 'checked_in'),
    expected: rows.filter((r) => r.status === 'scheduled'),
    in_progress: rows.filter((r) => r.status === 'in_progress'),
  });
}));

// ── GET /api/appointments/:appointment_id ──────────────────────────────────
router.get(
  '/:appointment_id',
  authenticate,
  [param('appointment_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${APPOINTMENT_FIELDS} ${APPOINTMENT_JOINS} WHERE a.appointment_id = $1`,
      [req.params.appointment_id]
    );
    if (!rows.length) throw ApiError.notFound('Appointment not found.');

    const appointment = rows[0];

    const vitals = (await db.query(
      `SELECT vitals_id, temperature_c, bp_systolic, bp_diastolic, pulse_bpm, resp_rate,
              spo2_percent, weight_kg, height_cm, pain_score, triage, notes, recorded_at
         FROM vitals WHERE appointment_id = $1 ORDER BY recorded_at DESC`,
      [req.params.appointment_id]
    )).rows;

    const notes = (await db.query(
      `SELECT note_id, diagnosis, icd10_code, prescription, notes, follow_up_date,
              created_at, provider_id
         FROM visit_notes WHERE appointment_id = $1 ORDER BY created_at DESC`,
      [req.params.appointment_id]
    )).rows;

    res.json({ appointment, vitals, notes });
  })
);

// ── POST /api/appointments ─────────────────────────────────────────────────
// Book an appointment. Slots are checked for overlap against the provider's
// existing bookings (not just an exact timestamp match, which missed clashes
// whenever a 30-minute visit started a few minutes after another).
router.post(
  '/',
  authenticate,
  allowRoles('superadmin', 'admin', 'receptionist', 'nurse'),
  [
    body('patient_id').isUUID().withMessage('patient_id is required.'),
    body('provider_id').isUUID().withMessage('provider_id is required.'),
    body('scheduled_at').isISO8601().withMessage('Provide a valid date and time.'),
    body('duration_minutes').optional().isInt({ min: 5, max: 480 }),
    body('priority').optional().isIn(['routine', 'urgent', 'emergency']),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const facilityId = req.body.facility_id || req.facilityId || req.user.facility_id;
    if (!facilityId) throw ApiError.badRequest('facility_id is required to book an appointment.');

    const { patient_id, provider_id, scheduled_at, reason } = req.body;
    const duration = req.body.duration_minutes || 30;

    const provider = await db.query(
      'SELECT provider_id, facility_id, department_id, name, is_active FROM providers WHERE provider_id = $1',
      [provider_id]
    );
    if (!provider.rows.length) throw ApiError.badRequest('That provider does not exist.');
    if (!provider.rows[0].is_active) throw ApiError.badRequest('That provider is no longer active.');
    if (provider.rows[0].facility_id !== facilityId) {
      throw ApiError.badRequest('The provider works at a different facility.');
    }

    const patient = await db.query('SELECT patient_id, is_deceased FROM patients WHERE patient_id = $1', [patient_id]);
    if (!patient.rows.length) throw ApiError.badRequest('That patient does not exist.');
    if (patient.rows[0].is_deceased) throw ApiError.badRequest('That patient record is marked deceased.');

    // Department: use what was asked for, otherwise the provider's home department.
    const departmentId = req.body.department_id || provider.rows[0].department_id || null;
    if (departmentId) {
      const dep = await db.query('SELECT facility_id FROM departments WHERE department_id = $1', [departmentId]);
      if (!dep.rows.length) throw ApiError.badRequest('That department does not exist.');
      if (dep.rows[0].facility_id !== facilityId) throw ApiError.badRequest('That department is at another facility.');
    }

    // Overlap check on the provider's diary.
    const clash = await db.query(
      `SELECT appointment_id, scheduled_at, duration_minutes
         FROM appointments
        WHERE provider_id = $1
          AND status NOT IN ('cancelled', 'no_show')
          AND $2::timestamptz < scheduled_at + (duration_minutes || ' minutes')::interval
          AND scheduled_at < $2::timestamptz + ($3 || ' minutes')::interval
        LIMIT 1`,
      [provider_id, scheduled_at, String(duration)]
    );
    if (clash.rows.length) {
      throw ApiError.conflict(
        `${provider.rows[0].name} already has an appointment at ` +
        `${new Date(clash.rows[0].scheduled_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}.`
      );
    }

    try {
      const { rows } = await db.query(
        `INSERT INTO appointments
           (patient_id, provider_id, facility_id, department_id, scheduled_at,
            duration_minutes, reason, priority, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [patient_id, provider_id, facilityId, departmentId, scheduled_at,
         duration, reason || null, req.body.priority || 'routine', req.user.user_id]
      );

      await recordAudit(req, {
        action: 'APPOINTMENT_BOOKED', entity: 'appointments', entityId: rows[0].appointment_id,
        detail: { patient_id, provider_id, facility_id: facilityId, scheduled_at },
      });

      res.status(201).json({ appointment: rows[0] });
    } catch (err) {
      throw translateDbError(err) || err;
    }
  })
);
// ── PATCH /api/appointments/:appointment_id/status ─────────────────────────
// The visit flow: scheduled → checked_in → in_progress → completed.
// Each move is checked against the role that is allowed to make it, and the
// timestamps that make the clinic's waiting-time report possible are stamped
// automatically.
router.patch(
  '/:appointment_id/status',
  authenticate,
  [
    param('appointment_id').isUUID(),
    body('status').isIn(STATUSES).withMessage('Choose a valid appointment status.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { appointment_id } = req.params;
    const { status } = req.body;

    const { rows } = await db.query(
      'SELECT appointment_id, status, facility_id, patient_id, provider_id FROM appointments WHERE appointment_id = $1',
      [appointment_id]
    );
    if (!rows.length) throw ApiError.notFound('Appointment not found.');
    const current = rows[0];

    // Facility staff cannot touch another facility's diary.
    if (req.user.role !== 'superadmin' && current.facility_id !== req.user.facility_id) {
      throw ApiError.forbidden('That appointment belongs to a different facility.');
    }

    const rule = TRANSITIONS[current.status];
    if (!rule.to.includes(status)) {
      throw ApiError.badRequest(`An appointment that is "${current.status.replace('_', ' ')}" cannot be moved to "${status.replace('_', ' ')}".`);
    }
    if (!rule.roles.includes(req.user.role)) {
      throw ApiError.forbidden(`Your role (${req.user.role}) may not make that change.`);
    }

    const { rows: updated } = await db.query(
      `UPDATE appointments
          SET status = $1,
              checked_in_at = CASE WHEN $1 = 'checked_in' THEN COALESCE(checked_in_at, NOW())
                                   WHEN $1 = 'scheduled'   THEN NULL
                                   ELSE checked_in_at END,
              completed_at  = CASE WHEN $1 = 'completed'  THEN NOW()
                                   WHEN $1 IN ('in_progress','checked_in','scheduled') THEN NULL
                                   ELSE completed_at END
        WHERE appointment_id = $2
        RETURNING *`,
      [status, appointment_id]
    );

    await recordAudit(req, {
      action: 'APPOINTMENT_STATUS_CHANGED', entity: 'appointments', entityId: appointment_id,
      detail: { from: current.status, to: status },
    });

    res.json({ appointment: updated[0] });
  })
);

// ── PATCH /api/appointments/:appointment_id ────────────────────────────────
// Reschedule, change provider/department, adjust priority or reason.
router.patch(
  '/:appointment_id',
  authenticate,
  allowRoles('superadmin', 'admin', 'receptionist', 'nurse', 'doctor'),
  [param('appointment_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const { appointment_id } = req.params;

    const existing = await db.query('SELECT * FROM appointments WHERE appointment_id = $1', [appointment_id]);
    if (!existing.rows.length) throw ApiError.notFound('Appointment not found.');
    const current = existing.rows[0];

    if (req.user.role !== 'superadmin' && current.facility_id !== req.user.facility_id) {
      throw ApiError.forbidden('That appointment belongs to a different facility.');
    }
    if (['completed', 'cancelled'].includes(current.status)) {
      throw ApiError.badRequest('A closed appointment cannot be changed.');
    }

    const updates = {};
    for (const field of ['scheduled_at', 'duration_minutes', 'priority', 'reason', 'department_id', 'provider_id']) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    const columns = Object.keys(updates);
    if (!columns.length) throw ApiError.badRequest('Nothing to update.');

    if (updates.provider_id) {
      const provider = await db.query('SELECT facility_id, name FROM providers WHERE provider_id = $1', [updates.provider_id]);
      if (!provider.rows.length) throw ApiError.badRequest('That provider does not exist.');
      if (provider.rows[0].facility_id !== current.facility_id) {
        throw ApiError.badRequest('The provider works at a different facility.');
      }
    }

    if (updates.scheduled_at || updates.provider_id || updates.duration_minutes) {
      const providerId = updates.provider_id || current.provider_id;
      const when = updates.scheduled_at || current.scheduled_at;
      const duration = updates.duration_minutes || current.duration_minutes;

      const clash = await db.query(
        `SELECT appointment_id, scheduled_at FROM appointments
          WHERE provider_id = $1 AND appointment_id <> $2
            AND status NOT IN ('cancelled', 'no_show')
            AND $3::timestamptz < scheduled_at + (duration_minutes || ' minutes')::interval
            AND scheduled_at < $3::timestamptz + ($4 || ' minutes')::interval
          LIMIT 1`,
        [providerId, appointment_id, when, String(duration)]
      );
      if (clash.rows.length) throw ApiError.conflict('That new time clashes with another appointment in the diary.');
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const { rows } = await db.query(
      `UPDATE appointments SET ${setClause} WHERE appointment_id = $${columns.length + 1} RETURNING *`,
      [...columns.map((c) => updates[c]), appointment_id]
    );

    await recordAudit(req, {
      action: 'APPOINTMENT_UPDATED', entity: 'appointments', entityId: appointment_id,
      detail: { changed: columns },
    });

    res.json({ appointment: rows[0] });
  })
);

module.exports = router;
module.exports.STATUSES = STATUSES;
module.exports.TRANSITIONS = TRANSITIONS;