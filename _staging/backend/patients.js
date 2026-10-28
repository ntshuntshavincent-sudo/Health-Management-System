const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const pool    = require('../db/pool');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/patients?id_number=XXXXXXXXXXXXX ────────────────────────────────
// THE KIOSK LOOKUP — patient punches their ID, record comes back instantly
// Public route (no login required at the kiosk)
router.get(
  '/',
  [query('id_number').optional().isLength({ min: 13, max: 13 }).isNumeric()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id_number } = req.query;

    try {
      // Lookup by SA ID number — also fetch their next upcoming appointment
      const result = await pool.query(
        `SELECT
           p.patient_id,
           p.id_number,
           p.first_name,
           p.last_name,
           p.date_of_birth,
           p.gender,
           p.phone,
           p.blood_type,
           p.allergies,
           -- Next appointment details
           a.appointment_id,
           a.scheduled_at,
           a.status       AS appointment_status,
           a.reason,
           d.name         AS doctor_name,
           d.specialisation
         FROM patients p
         LEFT JOIN appointments a
           ON a.patient_id = p.patient_id
           AND a.scheduled_at >= NOW()
           AND a.status = 'scheduled'
         LEFT JOIN doctors d ON d.doctor_id = a.doctor_id
         WHERE p.id_number = $1
         ORDER BY a.scheduled_at ASC
         LIMIT 1`,
        [id_number]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'No patient found with that ID number.' });
      }

      const row = result.rows[0];

      // Shape the response neatly for the kiosk screen
      res.json({
        patient: {
          patient_id:    row.patient_id,
          id_number:     row.id_number,
          first_name:    row.first_name,
          last_name:     row.last_name,
          full_name:     `${row.first_name} ${row.last_name}`,
          date_of_birth: row.date_of_birth,
          gender:        row.gender,
          phone:         row.phone,
          blood_type:    row.blood_type,
          allergies:     row.allergies,
        },
        next_appointment: row.appointment_id
          ? {
              appointment_id: row.appointment_id,
              scheduled_at:   row.scheduled_at,
              status:         row.appointment_status,
              reason:         row.reason,
              doctor_name:    row.doctor_name,
              specialisation: row.specialisation,
            }
          : null,
      });
    } catch (err) {
      console.error('Patient lookup error:', err.message);
      res.status(500).json({ error: 'Server error during lookup.' });
    }
  }
);

// ─── POST /api/patients ───────────────────────────────────────────────────────
// Register a new patient (receptionist or admin only)
router.post(
  '/',
  authenticate,
  allowRoles('admin', 'receptionist'),
  [
    body('id_number')
      .isLength({ min: 13, max: 13 })
      .isNumeric()
      .withMessage('ID number must be exactly 13 digits.'),
    body('first_name').notEmpty().trim(),
    body('last_name').notEmpty().trim(),
    body('date_of_birth').optional().isISO8601(),
    body('gender').optional().isIn(['Male', 'Female', 'Other', 'Prefer not to say']),
    body('blood_type').optional().isIn(['A+','A-','B+','B-','AB+','AB-','O+','O-','']),
    body('phone').optional().trim(),
    body('address').optional().trim(),
    body('allergies').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      id_number, first_name, last_name,
      date_of_birth, gender, phone,
      address, blood_type, allergies,
    } = req.body;

    try {
      const result = await pool.query(
        `INSERT INTO patients
           (id_number, first_name, last_name, date_of_birth, gender, phone, address, blood_type, allergies)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [id_number, first_name, last_name, date_of_birth || null,
         gender || null, phone || null, address || null,
         blood_type || null, allergies || null]
      );

      res.status(201).json({ patient: result.rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'A patient with this ID number already exists.' });
      }
      console.error('Register patient error:', err.message);
      res.status(500).json({ error: 'Server error registering patient.' });
    }
  }
);

// ─── GET /api/patients/:patient_id ───────────────────────────────────────────
// Full patient record with all visit history (doctors + admins)
router.get(
  '/:patient_id',
  authenticate,
  allowRoles('admin', 'doctor', 'receptionist'),
  [param('patient_id').isUUID()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      // Patient base record
      const patientResult = await pool.query(
        'SELECT * FROM patients WHERE patient_id = $1',
        [req.params.patient_id]
      );

      if (patientResult.rows.length === 0) {
        return res.status(404).json({ error: 'Patient not found.' });
      }

      // All appointments + visit notes
      const historyResult = await pool.query(
        `SELECT
           a.appointment_id,
           a.scheduled_at,
           a.status,
           a.reason,
           d.name         AS doctor_name,
           d.specialisation,
           vn.note_id,
           vn.diagnosis,
           vn.prescription,
           vn.notes,
           vn.created_at  AS note_created_at
         FROM appointments a
         JOIN doctors d ON d.doctor_id = a.doctor_id
         LEFT JOIN visit_notes vn ON vn.appointment_id = a.appointment_id
         WHERE a.patient_id = $1
         ORDER BY a.scheduled_at DESC`,
        [req.params.patient_id]
      );

      res.json({
        patient: patientResult.rows[0],
        history: historyResult.rows,
      });
    } catch (err) {
      console.error('Get patient error:', err.message);
      res.status(500).json({ error: 'Server error fetching patient record.' });
    }
  }
);

// ─── PATCH /api/patients/:patient_id ─────────────────────────────────────────
// Update a patient's details (admin or receptionist)
router.patch(
  '/:patient_id',
  authenticate,
  allowRoles('admin', 'receptionist'),
  [param('patient_id').isUUID()],
  async (req, res) => {
    const { phone, address, allergies, blood_type } = req.body;

    try {
      const result = await pool.query(
        `UPDATE patients
         SET phone      = COALESCE($1, phone),
             address    = COALESCE($2, address),
             allergies  = COALESCE($3, allergies),
             blood_type = COALESCE($4, blood_type)
         WHERE patient_id = $5
         RETURNING *`,
        [phone, address, allergies, blood_type, req.params.patient_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Patient not found.' });
      }

      res.json({ patient: result.rows[0] });
    } catch (err) {
      console.error('Update patient error:', err.message);
      res.status(500).json({ error: 'Server error updating patient.' });
    }
  }
);

module.exports = router;
