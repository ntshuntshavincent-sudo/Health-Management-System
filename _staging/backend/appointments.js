const express = require('express');
const { body, param, validationResult } = require('express-validator');
const pool    = require('../db/pool');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

// ─── POST /api/appointments ───────────────────────────────────────────────────
// Book a new appointment
router.post(
  '/',
  authenticate,
  allowRoles('admin', 'receptionist'),
  [
    body('patient_id').isUUID(),
    body('doctor_id').isUUID(),
    body('scheduled_at').isISO8601().withMessage('Provide a valid date/time.'),
    body('reason').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { patient_id, doctor_id, scheduled_at, reason } = req.body;

    try {
      // Check the slot isn't already taken
      const clash = await pool.query(
        `SELECT appointment_id FROM appointments
         WHERE doctor_id = $1
           AND scheduled_at = $2
           AND status = 'scheduled'`,
        [doctor_id, scheduled_at]
      );

      if (clash.rows.length > 0) {
        return res.status(409).json({
          error: 'That time slot is already booked for this doctor.',
        });
      }

      const result = await pool.query(
        `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [patient_id, doctor_id, scheduled_at, reason || null]
      );

      res.status(201).json({ appointment: result.rows[0] });
    } catch (err) {
      console.error('Book appointment error:', err.message);
      res.status(500).json({ error: 'Server error booking appointment.' });
    }
  }
);

// ─── GET /api/appointments?doctor_id=&date= ───────────────────────────────────
// List appointments for a doctor on a given date (doctor dashboard)
router.get(
  '/',
  authenticate,
  allowRoles('admin', 'doctor', 'receptionist'),
  async (req, res) => {
    const { doctor_id, date } = req.query;

    try {
      let queryText = `
        SELECT
          a.appointment_id,
          a.scheduled_at,
          a.status,
          a.reason,
          p.patient_id,
          p.first_name,
          p.last_name,
          p.id_number,
          p.date_of_birth,
          p.blood_type,
          p.allergies,
          d.name AS doctor_name
        FROM appointments a
        JOIN patients p ON p.patient_id = a.patient_id
        JOIN doctors  d ON d.doctor_id  = a.doctor_id
        WHERE 1=1
      `;
      const params = [];

      if (doctor_id) {
        params.push(doctor_id);
        queryText += ` AND a.doctor_id = $${params.length}`;
      }

      if (date) {
        params.push(date);
        queryText += ` AND DATE(a.scheduled_at) = $${params.length}`;
      }

      queryText += ' ORDER BY a.scheduled_at ASC';

      const result = await pool.query(queryText, params);
      res.json({ appointments: result.rows });
    } catch (err) {
      console.error('List appointments error:', err.message);
      res.status(500).json({ error: 'Server error listing appointments.' });
    }
  }
);

// ─── PATCH /api/appointments/:appointment_id/status ──────────────────────────
// Update status: scheduled → in_progress → completed | cancelled
router.patch(
  '/:appointment_id/status',
  authenticate,
  allowRoles('admin', 'doctor', 'receptionist'),
  [
    param('appointment_id').isUUID(),
    body('status').isIn(['scheduled', 'in_progress', 'completed', 'cancelled']),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const result = await pool.query(
        `UPDATE appointments SET status = $1
         WHERE appointment_id = $2
         RETURNING *`,
        [req.body.status, req.params.appointment_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      res.json({ appointment: result.rows[0] });
    } catch (err) {
      console.error('Update appointment error:', err.message);
      res.status(500).json({ error: 'Server error updating appointment.' });
    }
  }
);

module.exports = router;
