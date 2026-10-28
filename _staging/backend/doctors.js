const express = require('express');
const { body, validationResult } = require('express-validator');
const pool    = require('../db/pool');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/doctors ─────────────────────────────────────────────────────────
// List all doctors (used when booking appointments)
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT doctor_id, name, specialisation, employee_number FROM doctors ORDER BY name'
    );
    res.json({ doctors: result.rows });
  } catch (err) {
    console.error('List doctors error:', err.message);
    res.status(500).json({ error: 'Server error listing doctors.' });
  }
});

// ─── POST /api/doctors ────────────────────────────────────────────────────────
// Add a new doctor to the system (admin only)
router.post(
  '/',
  authenticate,
  allowRoles('admin'),
  [
    body('name').notEmpty().trim(),
    body('specialisation').notEmpty().trim(),
    body('employee_number').notEmpty().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, specialisation, employee_number } = req.body;

    try {
      const result = await pool.query(
        `INSERT INTO doctors (name, specialisation, employee_number)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [name, specialisation, employee_number]
      );
      res.status(201).json({ doctor: result.rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Employee number already exists.' });
      }
      console.error('Add doctor error:', err.message);
      res.status(500).json({ error: 'Server error adding doctor.' });
    }
  }
);

module.exports = router;
