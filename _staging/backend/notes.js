const express = require('express');
const { body, param, validationResult } = require('express-validator');
const pool    = require('../db/pool');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

// ─── POST /api/notes ──────────────────────────────────────────────────────────
// Doctor submits visit notes for a completed appointment
router.post(
  '/',
  authenticate,
  allowRoles('admin', 'doctor'),
  [
    body('appointment_id').isUUID(),
    body('diagnosis').optional().trim(),
    body('prescription').optional().trim(),
    body('notes').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { appointment_id, diagnosis, prescription, notes } = req.body;

    try {
      // Verify the appointment exists
      const apptCheck = await pool.query(
        'SELECT appointment_id, doctor_id FROM appointments WHERE appointment_id = $1',
        [appointment_id]
      );

      if (apptCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      const doctor_id = apptCheck.rows[0].doctor_id;

      const result = await pool.query(
        `INSERT INTO visit_notes (appointment_id, doctor_id, diagnosis, prescription, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [appointment_id, doctor_id, diagnosis || null, prescription || null, notes || null]
      );

      // Auto-mark appointment as completed
      await pool.query(
        `UPDATE appointments SET status = 'completed' WHERE appointment_id = $1`,
        [appointment_id]
      );

      res.status(201).json({ note: result.rows[0] });
    } catch (err) {
      console.error('Create note error:', err.message);
      res.status(500).json({ error: 'Server error saving visit note.' });
    }
  }
);

// ─── GET /api/notes/:appointment_id ──────────────────────────────────────────
// Retrieve visit notes for a specific appointment
router.get(
  '/:appointment_id',
  authenticate,
  allowRoles('admin', 'doctor', 'receptionist'),
  [param('appointment_id').isUUID()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const result = await pool.query(
        `SELECT vn.*, d.name AS doctor_name
         FROM visit_notes vn
         JOIN doctors d ON d.doctor_id = vn.doctor_id
         WHERE vn.appointment_id = $1
         ORDER BY vn.created_at DESC`,
        [req.params.appointment_id]
      );

      res.json({ notes: result.rows });
    } catch (err) {
      console.error('Get notes error:', err.message);
      res.status(500).json({ error: 'Server error fetching notes.' });
    }
  }
);

module.exports = router;
