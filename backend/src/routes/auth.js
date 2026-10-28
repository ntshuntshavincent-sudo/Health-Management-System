/**
 * AUTH ROUTES — /api/auth
 * ──────────────────────
 * POST   /login            staff sign-in (rate limited, lockout protected)
 * GET    /me               current user + their facility
 * POST   /logout           audit-stamps the end of a shift
 * PATCH  /password         change own password
 * GET    /users            list staff (admin: own facility, superadmin: all)
 * POST   /users            create a staff account
 * PATCH  /users/:user_id   update role / facility / status / reset password
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, param } = require('express-validator');

const config = require('../config');
const db     = require('../db/pool');
const { ApiError, asyncHandler, validate } = require('../utils/http');
const { signToken, authenticate, allowRoles, isSuperAdmin } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();

// Failed logins before the account is temporarily locked.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES      = 15;

const PUBLIC_USER_FIELDS = `
  u.user_id, u.username, u.full_name, u.email, u.role, u.facility_id,
  u.provider_id, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
  f.name AS facility_name, f.type AS facility_type, f.code AS facility_code
`;

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);

    // The same message for unknown user and wrong password — never reveal which.
    const invalid = () => ApiError.unauthorized('Invalid username or password.');
    if (rows.length === 0) throw invalid();

    const user = rows[0];

    if (!user.is_active) {
      throw ApiError.forbidden('This account has been deactivated. Contact your facility administrator.');
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutes = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      throw new ApiError(423, `Account locked after too many failed attempts. Try again in ${minutes} minute(s).`);
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      const attempts = user.failed_login_attempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      await db.query(
        `UPDATE users
            SET failed_login_attempts = $1,
                locked_until = CASE WHEN $2 THEN NOW() + ($3 || ' minutes')::interval ELSE locked_until END
          WHERE user_id = $4`,
        [lock ? 0 : attempts, lock, String(LOCKOUT_MINUTES), user.user_id]
      );
      await recordAudit(req, {
        action: 'LOGIN_FAILED', entity: 'users', entityId: user.user_id,
        detail: { username, attempts, locked: lock },
      });
      if (lock) {
        throw new ApiError(423, `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`);
      }
      throw invalid();
    }

    await db.query(
      `UPDATE users
          SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW()
        WHERE user_id = $1`,
      [user.user_id]
    );

    // A facility user with no facility cannot work — refuse now, not later.
    if (user.role !== 'superadmin' && !user.facility_id) {
      throw ApiError.forbidden('Your account is not linked to a facility. Contact your administrator.');
    }

    const { rows: facilityRows } = user.facility_id
      ? await db.query(
          `SELECT facility_id, code, name, type, level, district, province
             FROM facilities WHERE facility_id = $1`, [user.facility_id])
      : { rows: [] };

    // Superadmins get the whole district list so the UI can offer a switcher.
    const facilities = isSuperAdmin(user)
      ? (await db.query(
          `SELECT facility_id, code, name, type, level, district, province
             FROM facilities WHERE is_active ORDER BY province, district, name`)).rows
      : facilityRows;

    req.user = { user_id: user.user_id, username: user.username, role: user.role, facility_id: user.facility_id };
    await recordAudit(req, { action: 'LOGIN', entity: 'users', entityId: user.user_id, detail: { role: user.role } });

    res.json({
      token: signToken(user),
      user: {
        user_id:     user.user_id,
        username:    user.username,
        full_name:   user.full_name,
        role:        user.role,
        facility_id: user.facility_id,
        provider_id: user.provider_id,
        must_change_password: user.must_change_password,
// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_USER_FIELDS} FROM users u
       LEFT JOIN facilities f ON f.facility_id = u.facility_id
      WHERE u.user_id = $1`,
    [req.user.user_id]
  );
  if (!rows.length) throw ApiError.notFound('User account no longer exists.');

  const facilities = isSuperAdmin(rows[0])
    ? (await db.query(
        `SELECT facility_id, code, name, type, level, district, province
           FROM facilities WHERE is_active ORDER BY province, district, name`)).rows
    : [];

  res.json({ user: rows[0], facilities });
}));

// ── POST /api/auth/logout ───────────────────────────────────────────────────
// Tokens are stateless, so this exists to stamp the audit trail (shift end).
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  await recordAudit(req, { action: 'LOGOUT', entity: 'users', entityId: req.user.user_id });
  res.json({ message: 'Signed out.' });
}));

// ── PATCH /api/auth/password ────────────────────────────────────────────────
// Changing your own password. Every other active session dies on next request
// only when a secret is rotated; documenting that is why we log the change.
router.patch(
  '/password',
  authenticate,
  [
    body('current_password').notEmpty().withMessage('Your current password is required.'),
    body('new_password')
      .isLength({ min: 10 })
      .withMessage('The new password must be at least 10 characters.')
      .matches(/[A-Za-z]/).withMessage('The new password must contain a letter.')
      .matches(/\d/).withMessage('The new password must contain a number.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;

    const { rows } = await db.query('SELECT user_id, password_hash FROM users WHERE user_id = $1', [req.user.user_id]);
    if (!rows.length) throw ApiError.notFound('User account no longer exists.');

    if (!(await bcrypt.compare(current_password, rows[0].password_hash))) {
      throw ApiError.badRequest('Your current password is incorrect.');
    }
    if (await bcrypt.compare(new_password, rows[0].password_hash)) {
      throw ApiError.badRequest('The new password must be different from the current one.');
    }

    const hash = await bcrypt.hash(new_password, config.bcryptRounds);
    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE user_id = $2',
      [hash, req.user.user_id]
    );

    await recordAudit(req, { action: 'PASSWORD_CHANGED', entity: 'users', entityId: req.user.user_id });
    res.json({ message: 'Password updated.' });
  })
);

// ── GET /api/auth/users ──────────────────────────────────────────────────────
// Staff list. An admin sees only their own facility; a superadmin sees all
// (optionally filtered by ?facility_id= or ?role=).
router.get(
  '/users',
  authenticate,
  allowRoles('admin', 'superadmin'),
  asyncHandler(async (req, res) => {
    const params = [];
    let where = 'WHERE 1=1';

    if (!isSuperAdmin(req.user)) {
      params.push(req.user.facility_id);
      where += ` AND u.facility_id = $${params.length}`;
    } else if (req.query.facility_id) {
      params.push(req.query.facility_id);
      where += ` AND u.facility_id = $${params.length}`;
    }

    if (req.query.role)   { params.push(req.query.role);   where += ` AND u.role = $${params.length}`; }
    if (req.query.active === 'true')  where += ' AND u.is_active = TRUE';
    if (req.query.active === 'false') where += ' AND u.is_active = FALSE';

    const { rows } = await db.query(
      `SELECT ${PUBLIC_USER_FIELDS}
         FROM users u
         LEFT JOIN facilities f ON f.facility_id = u.facility_id
         ${where}
        ORDER BY u.role, u.username`,
      params
    );

    res.json({ users: rows });
  })
);
      },
      facility:   facilityRows[0] || null,
      facilities,
      expires_in: config.jwt.expiresIn,
    });
  })
);
// ── POST /api/auth/users ────────────────────────────────────────────────────
// Create a staff account. An admin may only create staff inside their own
// facility, and can never create a superadmin — that keeps district-wide
// access in the hands of the district office.
router.post(
  '/users',
  authenticate,
  allowRoles('admin', 'superadmin'),
  [
    body('username').trim().isLength({ min: 3, max: 80 }).withMessage('Username must be at least 3 characters.'),
    body('password')
      .isLength({ min: 10 }).withMessage('The password must be at least 10 characters.')
      .matches(/[A-Za-z]/).withMessage('The password must contain a letter.')
      .matches(/\d/).withMessage('The password must contain a number.'),
    body('role').isIn(['superadmin', 'admin', 'doctor', 'nurse', 'pharmacist', 'receptionist'])
      .withMessage('Choose a valid role.'),
    body('full_name').optional().trim(),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email address.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { username, password, role, full_name, email } = req.body;

    if (role === 'superadmin' && !isSuperAdmin(req.user)) {
      throw ApiError.forbidden('Only a district administrator can create a superadmin account.');
    }

    // Facility binding: an admin is locked to their own facility.
    const facilityId = isSuperAdmin(req.user) ? (req.body.facility_id || null) : req.user.facility_id;
    if (role !== 'superadmin' && !facilityId) {
      throw ApiError.badRequest('facility_id is required — staff must belong to a facility.');
    }

    // If the login is tied to a clinical provider record, it must match.
    if (req.body.provider_id) {
      const provider = await db.query('SELECT facility_id FROM providers WHERE provider_id = $1', [req.body.provider_id]);
      if (!provider.rows.length) throw ApiError.badRequest('That provider record does not exist.');
      if (facilityId && provider.rows[0].facility_id !== facilityId) {
        throw ApiError.badRequest('The provider belongs to a different facility.');
      }
    }

    const hash = await bcrypt.hash(password, config.bcryptRounds);

    try {
      const { rows } = await db.query(
        `INSERT INTO users (username, password_hash, full_name, email, role, facility_id, provider_id, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
         RETURNING user_id, username, full_name, email, role, facility_id, provider_id,
                   is_active, must_change_password, created_at`,
        [username, hash, full_name || null, email || null, role, facilityId, req.body.provider_id || null]
      );

      await recordAudit(req, {
        action: 'USER_CREATED', entity: 'users', entityId: rows[0].user_id,
        detail: { username, role, facility_id: facilityId },
      });

      res.status(201).json({ user: rows[0] });
    } catch (err) {
      throw translateDbError(err) || err;
    }
  })
);
// ── PATCH /api/auth/users/:user_id ──────────────────────────────────────────
// Update a staff account, including resetting their password. Guards exist so
// an admin cannot lock themselves out or escalate their own privileges.
router.patch(
  '/users/:user_id',
  authenticate,
  allowRoles('admin', 'superadmin'),
  [param('user_id').isUUID().withMessage('Invalid user id.')],
  validate,
  asyncHandler(async (req, res) => {
    const { user_id } = req.params;
    const actorIsSuper = isSuperAdmin(req.user);

    const target = await db.query('SELECT * FROM users WHERE user_id = $1', [user_id]);
    if (!target.rows.length) throw ApiError.notFound('User account not found.');
    const existing = target.rows[0];

    if (!actorIsSuper && existing.facility_id !== req.user.facility_id) {
      throw ApiError.forbidden('You can only manage staff at your own facility.');
    }
    if (!actorIsSuper && existing.role === 'superadmin') {
      throw ApiError.forbidden('Only a district administrator can change a superadmin account.');
    }

    const updates = {};
    if (req.body.full_name   !== undefined) updates.full_name   = req.body.full_name;
    if (req.body.email       !== undefined) updates.email       = req.body.email || null;
    if (req.body.is_active   !== undefined) updates.is_active   = !!req.body.is_active;
    if (req.body.provider_id !== undefined) updates.provider_id = req.body.provider_id || null;

    if (req.body.role !== undefined) {
      if (req.body.role === 'superadmin' && !actorIsSuper) {
        throw ApiError.forbidden('Only a district administrator can grant superadmin access.');
      }
      updates.role = req.body.role;
    }

    if (req.body.facility_id !== undefined) {
      if (!actorIsSuper) throw ApiError.forbidden('Only a district administrator can move staff between facilities.');
      updates.facility_id = req.body.facility_id || null;
    }

    // Safety rails around your own account.
    if (user_id === req.user.user_id) {
      if (updates.role && updates.role !== req.user.role) {
        throw ApiError.badRequest('You cannot change your own role.');
      }
      if (updates.is_active === false) {
        throw ApiError.badRequest('You cannot deactivate your own account.');
      }
    }

    if (req.body.new_password) {
      const { new_password } = req.body;
      if (new_password.length < 10 || !/[A-Za-z]/.test(new_password) || !/\d/.test(new_password)) {
        throw ApiError.badRequest('The new password must be at least 10 characters and contain a letter and a number.');
      }
      updates.password_hash = await bcrypt.hash(new_password, config.bcryptRounds);
      updates.must_change_password  = true;
      updates.failed_login_attempts = 0;
      updates.locked_until          = null;
    }

    const columns = Object.keys(updates);
    if (!columns.length) throw ApiError.badRequest('Nothing to update.');

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const values = columns.map((c) => updates[c]);

    const { rows } = await db.query(
      `UPDATE users SET ${setClause} WHERE user_id = $${columns.length + 1}
       RETURNING user_id, username, full_name, email, role, facility_id, provider_id,
                 is_active, must_change_password, last_login_at`,
      [...values, user_id]
    );

    await recordAudit(req, {
      action: 'USER_UPDATED', entity: 'users', entityId: user_id,
      detail: {
        changed: columns.filter((c) => c !== 'password_hash'),
        password_reset: !!req.body.new_password,
      },
    });

    res.json({ user: rows[0] });
  })
);

module.exports = router;
module.exports.PUBLIC_USER_FIELDS = PUBLIC_USER_FIELDS;