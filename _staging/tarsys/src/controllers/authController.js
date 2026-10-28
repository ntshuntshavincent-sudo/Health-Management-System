const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../db/pool');

// POST /api/auth/login
// Body: { username, password }
async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

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
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      message: 'Login successful.',
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

// POST /api/auth/create-user
// Admin only — creates a new staff account
// Body: { username, password, role, linked_id? }
async function createUser(req, res) {
  const { username, password, role, linked_id } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required.' });
  }

  const validRoles = ['admin', 'doctor', 'receptionist'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}.` });
  }

  try {
    const salt         = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, linked_id)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, username, role, created_at`,
      [username, passwordHash, role, linked_id || null]
    );

    res.status(201).json({
      message: 'User created successfully.',
      user: result.rows[0],
    });

  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    console.error('Create user error:', err.message);
    res.status(500).json({ error: 'Server error creating user.' });
  }
}

module.exports = { login, createUser };
