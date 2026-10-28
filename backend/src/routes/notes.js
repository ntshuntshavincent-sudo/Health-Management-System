/**
 * VISIT NOTE ROUTES — /api/notes
 * ─────────────────────────────
 * POST   /                  record diagnosis, prescription, follow-up
 * GET    /?patient_id=      every note for a patient (cross-facility history)
 * GET    /:appointment_id   notes for one appointment
 * PATCH  /:note_id          append a correction (records are never overwritten)
 *
 * Medical records are append-only here: a clinician who made a mistake writes
 * an amendment rather than silently editing history — which is what a HPCSA
 * inquiry or a court expects to see.
 */

const express = require('express');
const { body, param } = require('express-validator');

const db = require('../db/pool');
const { ApiError, asyncHandler, validate, translateDbError } = require('../utils/http');
const { authenticate, allowRoles, CLINICAL_ROLES } = require('../middleware/auth');
const { recordAudit, recordPatientAccess } = require('../services/audit');

const router = express.Router();

const NOTE_FIELDS = `
  n.note_id, n.appointment_id, n.patient_id, n.provider_id, n.facility_id, n.department_id,
  n.diagnosis, n.icd10_code, n.prescription, n.notes, n.follow_up_date,
  n.created_by, n.created_at, n.updated_at,
  pr.name AS provider_name, pr.role AS provider_role, pr.specialisation,
  f.name AS facility_name, f.type AS facility_type, dep.name AS department_name
`;

const NOTE_JOINS = `
  FROM visit_notes n
  JOIN providers  pr ON pr.provider_id = n.provider_id
  JOIN facilities f  ON f.facility_id  = n.facility_id
  LEFT JOIN departments dep ON dep.department_id = n.department_id
`;

// ── POST /api/notes ────────────────────────────────────────────────────────
// Saving a note also closes the consultation, in one transaction, so a visit
// can never be left half-finished.
router.post(
  '/',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor', 'nurse', 'pharmacist'),
  [
    body('appointment_id').isUUID().withMessage('appointment_id is required.'),
    body('follow_up_date').optional({ values: 'falsy' }).isISO8601().withMessage('Enter a valid follow-up date.'),
    body().custom((value) => {
      const hasContent = ['diagnosis', 'prescription', 'notes'].some((f) => value[f] && String(value[f]).trim());
      if (!hasContent) throw new Error('Record at least a diagnosis, a prescription or a note.');
      return true;
    }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { appointment_id, diagnosis, icd10_code, prescription, notes, follow_up_date } = req.body;

    const appt = await db.query(
      `SELECT appointment_id, patient_id, provider_id, facility_id, department_id, status
         FROM appointments WHERE appointment_id = $1`,
      [appointment_id]
    );
    if (!appt.rows.length) throw ApiError.notFound('Appointment not found.');
    const appointment = appt.rows[0];

    if (req.user.role !== 'superadmin' && appointment.facility_id !== req.user.facility_id) {
      throw ApiError.forbidden('That appointment belongs to a different facility.');
    }
    if (appointment.status === 'cancelled') {
      throw ApiError.badRequest('That appointment was cancelled — reopen it before writing notes.');
    }

    // Attribute the note to the logged-in clinician's provider record when they
    // have one, so the record shows who actually saw the patient.
    const providerId = req.user.provider_id || appointment.provider_id;

    try {
      const note = await db.withTransaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO visit_notes
             (appointment_id, patient_id, provider_id, facility_id, department_id,
              diagnosis, icd10_code, prescription, notes, follow_up_date, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [appointment_id, appointment.patient_id, providerId, appointment.facility_id,
           appointment.department_id, diagnosis || null, icd10_code || null,
           prescription || null, notes || null, follow_up_date || null, req.user.user_id]
        );

        await client.query(
          `UPDATE appointments
              SET status = 'completed', completed_at = COALESCE(completed_at, NOW())
            WHERE appointment_id = $1 AND status <> 'completed'`,
          [appointment_id]
        );

        return rows[0];
      });

      await recordAudit(req, {
        action: 'NOTE_CREATED', entity: 'visit_notes', entityId: note.note_id,
        detail: { appointment_id, patient_id: appointment.patient_id, follow_up_date: follow_up_date || null },
      });
      await recordPatientAccess(req, { patientId: appointment.patient_id, action: 'WRITE_NOTE' });

      res.status(201).json({ note });
    } catch (err) {
      throw translateDbError(err) || err;
    }
  })
);
// ─ GET /api/notes?patient_id= ────────────────────────────────────────────
// The continuity-of-care view: everything any facility has recorded.
router.get('/', authenticate, allowRoles('superadmin', 'admin', 'doctor', 'nurse', 'pharmacist'), asyncHandler(async (req, res) => {
  const { patient_id } = req.query;
  if (!patient_id) throw ApiError.badRequest('patient_id is required.');

  const { rows } = await db.query(
    `SELECT ${NOTE_FIELDS} ${NOTE_JOINS}
      WHERE n.patient_id = $1
      ORDER BY n.created_at DESC
      LIMIT 200`,
    [patient_id]
  );

  await recordPatientAccess(req, { patientId: patient_id, action: 'VIEW_NOTES' });
  res.json({ notes: rows, count: rows.length });
}));

// ── GET /api/notes/:appointment_id ─────────────────────────────────────────
router.get(
  '/:appointment_id',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor', 'nurse', 'pharmacist', 'receptionist'),
  [param('appointment_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    // A receptionist gets nothing clinical: return an empty list rather than a
    // 403 so the UI can simply show "no notes" without an error state.
    if (!CLINICAL_ROLES.includes(req.user.role)) {
      return res.json({ notes: [] });
    }

    const { rows } = await db.query(
      `SELECT ${NOTE_FIELDS} ${NOTE_JOINS} WHERE n.appointment_id = $1 ORDER BY n.created_at DESC`,
      [req.params.appointment_id]
    );

    res.json({ notes: rows });
  })
);

// ── PATCH /api/notes/:note_id ──────────────────────────────────────────────
// Append a correction. The original text is kept and the amendment is stamped,
// never silently replaced.
router.patch(
  '/:note_id',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor'),
  [param('note_id').isUUID(), body('amendment').trim().notEmpty().withMessage('Write the correction you want to add.')],
  validate,
  asyncHandler(async (req, res) => {
    const existing = await db.query('SELECT * FROM visit_notes WHERE note_id = $1', [req.params.note_id]);
    if (!existing.rows.length) throw ApiError.notFound('Visit note not found.');
    const note = existing.rows[0];

    if (req.user.role !== 'superadmin' && note.facility_id !== req.user.facility_id) {
      throw ApiError.forbidden('That note belongs to a different facility.');
    }

    const stamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${req.user.username}`;
    const amendment = `\n\n--- CORRECTION (${stamp}) ---\n${req.body.amendment}`;

    const { rows } = await db.query(
      `UPDATE visit_notes SET notes = COALESCE(notes, '') || $1 WHERE note_id = $2 RETURNING *`,
      [amendment, req.params.note_id]
    );

    await recordAudit(req, {
      action: 'NOTE_AMENDED', entity: 'visit_notes', entityId: req.params.note_id,
      detail: { patient_id: note.patient_id },
    });

    res.json({ note: rows[0] });
  })
);

module.exports = router;