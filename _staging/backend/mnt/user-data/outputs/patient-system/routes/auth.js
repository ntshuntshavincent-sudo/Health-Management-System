const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Body: { username, password }
// Returns a JWT token valid for 8 hours (one working shift)
router.post(
  '/login',
  [
    body('username').notEmpty().trim(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      const user = result.rows[0];
      const passwordMatch = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      const token = jwt.sign(
        { user_id: user.user_id, username: user.username, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
      );

      res.json({
        token,
        user: {
          user_id:   user.user_id,
          username:  user.username,
          role:      user.role,
          linked_id: user.linked_id,
        },
      });
    } catch (err) {
      console.error('Login error:', err.message);
      res.status(500).json({ error: 'Server error during login.' });
    }
  }
);

// ─── POST /api/auth/create-user ───────────────────────────────────────────────
// Admin-only: create a new staff login account
// Body: { username, password, role, linked_id? }
router.post(
  '/create-user',
  authenticate,
  allowRoles('admin'),
  [
    body('username').notEmpty().trim().isLength({ min: 3 }),
    body('password').isLength({ min: 8 }),
    body('role').isIn(['admin', 'doctor', 'receptionist']),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password, role, linked_id } = req.body;

    try {
      const passwordHash = await bcrypt.hash(password, 12);

      const result = await pool.query(
        `INSERT INTO users (username, password_hash, role, linked_id)
         VALUES ($1, $2, $3, $4)
         RETURNING user_id, username, role, created_at`,
        [username, passwordHash, role, linked_id || null]
      );

      res.status(201).json({ user: result.rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Username already exists.' });
      }
      console.error('Create user error:', err.message);
      res.status(500).json({ error: 'Server error creating user.' });
    }
  }
);

module.exports = router;
