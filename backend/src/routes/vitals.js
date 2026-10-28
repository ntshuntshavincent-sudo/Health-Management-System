/**
 * VITALS ROUTES — /api/vitals
 * ─────────────────────────
 * POST   /                       record observations (nurse or doctor)
 * GET    /latest/:patient_id     most recent observations for a patient
 * GET    /:appointment_id        observations captured for one visit
 *
 * A hospital cannot run without this: triage decides who is seen first, and
 * the readings belong in the same record as the diagnosis.
 */

const express = require('express');
const { body, param } = require('express-validator');

const db = require('../db/pool');
const { ApiError, asyncHandler, validate, translateDbError } = require('../utils/http');
const { authenticate, allowRoles } = require('../middleware/auth');
const { recordAudit, recordPatientAccess } = require('../services/audit');

const router = express.Router();

const VITAL_FIELDS = `
  vitals_id, appointment_id, patient_id, facility_id, recorded_by,
  temperature_c, bp_systolic, bp_diastolic, pulse_bpm, resp_rate, spo2_percent,
  weight_kg, height_cm, pain_score, triage, notes, recorded_at
`;

const numericRules = [
  body('temperature_c').optional({ values: 'null' }).isFloat({ min: 25, max: 45 }),
  body('bp_systolic').optional({ values: 'null' }).isInt({ min: 40, max: 300 }),
  body('bp_diastolic').optional({ values: 'null' }).isInt({ min: 20, max: 200 }),
  body('pulse_bpm').optional({ values: 'null' }).isInt({ min: 20, max: 250 }),
  body('resp_rate').optional({ values: 'null' }).isInt({ min: 5, max: 80 }),
  body('spo2_percent').optional({ values: 'null' }).isInt({ min: 50, max: 100 }),
  body('weight_kg').optional({ values: 'null' }).isFloat({ min: 0.5, max: 400 }),
  body('height_cm').optional({ values: 'null' }).isInt({ min: 30, max: 250 }),
  body('pain_score').optional({ values: 'null' }).isInt({ min: 0, max: 10 }),
  body('triage').optional({ values: 'null' }).isIn(['green', 'yellow', 'orange', 'red']),
];

// ── POST /api/vitals ───────────────────────────────────────────────────────
router.post(
  '/',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor', 'nurse'),
  [
    body('patient_id').isUUID().withMessage('patient_id is required.'),
    body('appointment_id').optional({ values: 'falsy' }).isUUID(),
    ...numericRules,
  ],
  validate,
  asyncHandler(async (req, res) => {
    const b = req.body;

    // Patient must exist; if an appointment is given it must match the patient.
    const patient = await db.query('SELECT patient_id FROM patients WHERE patient_id = $1', [b.patient_id]);
    if (!patient.rows.length) throw ApiError.badRequest('That patient does not exist.');

    let facilityId = b.facility_id || req.user.facility_id;
    if (b.appointment_id) {
      const appt = await db.query(
        'SELECT patient_id, facility_id FROM appointments WHERE appointment_id = $1',
        [b.appointment_id]
      );
      if (!appt.rows.length) throw ApiError.badRequest('That appointment does not exist.');
      if (appt.rows[0].patient_id !== b.patient_id) {
        throw ApiError.badRequest('The appointment belongs to a different patient.');
      }
      facilityId = appt.rows[0].facility_id;
    }
    if (!facilityId) throw ApiError.badRequest('facility_id is required to record vitals.');

    if (req.user.role !== 'superadmin' && facilityId !== req.user.facility_id) {
      throw ApiError.forbidden('You can only record vitals at your own facility.');
    }

    try {
      const { rows } = await db.query(
        `INSERT INTO vitals
           (appointment_id, patient_id, facility_id, recorded_by, temperature_c,
            bp_systolic, bp_diastolic, pulse_bpm, resp_rate, spo2_percent,
            weight_kg, height_cm, pain_score, triage, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING ${VITAL_FIELDS}`,
        [b.appointment_id || null, b.patient_id, facilityId, req.user.user_id,
         b.temperature_c ?? null, b.bp_systolic ?? null, b.bp_diastolic ?? null,
         b.pulse_bpm ?? null, b.resp_rate ?? null, b.spo2_percent ?? null,
         b.weight_kg ?? null, b.height_cm ?? null, b.pain_score ?? null,
         b.triage || null, b.notes || null]
      );

      await recordAudit(req, {
        action: 'VITALS_RECORDED', entity: 'vitals', entityId: rows[0].vitals_id,
        detail: { patient_id: b.patient_id, appointment_id: b.appointment_id || null, triage: b.triage || null },
      });

      res.status(201).json({ vitals: rows[0] });
    } catch (err) {
      throw translateDbError(err) || err;
    }
  })
);

// ── GET /api/vitals/latest/:patient_id ─────────────────────────────────────
router.get(
  '/latest/:patient_id',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor', 'nurse', 'pharmacist'),
  [param('patient_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${VITAL_FIELDS} FROM vitals
        WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [req.params.patient_id]
    );
    await recordPatientAccess(req, { patientId: req.params.patient_id, action: 'VIEW_VITALS' });
    res.json({ vitals: rows[0] || null });
  })
);

// ── GET /api/vitals/:appointment_id ────────────────────────────────────────
router.get(
  '/:appointment_id',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor', 'nurse', 'pharmacist'),
  [param('appointment_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${VITAL_FIELDS} FROM vitals
        WHERE appointment_id = $1 ORDER BY recorded_at DESC`,
      [req.params.appointment_id]
    );
    res.json({ vitals: rows, latest: rows[0] || null });
  })
);

module.exports = router;