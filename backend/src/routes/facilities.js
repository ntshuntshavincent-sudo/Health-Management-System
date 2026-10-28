/**
 * FACILITY ROUTES — /api/facilities
 * A "facility" is a clinic, community health centre or hospital. It is the top
 * of the data hierarchy: departments, staff, appointments and notes all hang
 * off a facility, which is what keeps one clinic's data inside that clinic.
 */

const express = require('express');
const { body, param } = require('express-validator');

const db = require('../db/pool');
const { ApiError, asyncHandler, validate, translateDbError } = require('../utils/http');
const { authenticate, allowRoles, isSuperAdmin, assertFacilityAccess } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();

const FACILITY_TYPES = ['clinic', 'chc', 'district_hospital', 'regional_hospital',
                        'tertiary_hospital', 'private_hospital', 'private_practice'];

const FACILITY_FIELDS = `
  facility_id, code, name, type, level, district, province, address, phone, email,
  operating_hours, is_active, created_at, updated_at
`;

// ── GET /api/facilities ─────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';

  if (!isSuperAdmin(req.user)) {
    params.push(req.user.facility_id);              // staff see their own facility only
    where += ` AND facility_id = $${params.length}`;
  } else {
    if (req.query.district) { params.push(req.query.district); where += ` AND district = $${params.length}`; }
    if (req.query.province) { params.push(req.query.province); where += ` AND province = $${params.length}`; }
  }
  if (req.query.type) { params.push(req.query.type); where += ` AND type = $${params.length}`; }
  if (req.query.active !== 'all') where += ' AND is_active = TRUE';

  const { rows } = await db.query(
    `SELECT ${FACILITY_FIELDS} FROM facilities ${where} ORDER BY province, district, name`,
    params
  );

  res.json({ facilities: rows });
}));

// ── GET /api/facilities/:facility_id ────────────────────────────────────────
router.get(
  '/:facility_id',
  authenticate,
  [param('facility_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    assertFacilityAccess(req.user, req.params.facility_id);

    const { rows } = await db.query(
      `SELECT ${FACILITY_FIELDS} FROM facilities WHERE facility_id = $1`,
      [req.params.facility_id]
    );
    if (!rows.length) throw ApiError.notFound('Facility not found.');

    const { rows: stats } = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM departments WHERE facility_id = $1 AND is_active) AS departments,
         (SELECT COUNT(*)::int FROM providers   WHERE facility_id = $1 AND is_active) AS providers,
         (SELECT COUNT(*)::int FROM users       WHERE facility_id = $1 AND is_active) AS staff_accounts,
         (SELECT COUNT(*)::int FROM patients    WHERE home_facility_id = $1)          AS registered_patients,
         (SELECT COUNT(*)::int FROM appointments
           WHERE facility_id = $1 AND scheduled_at::date = CURRENT_DATE)              AS appointments_today,
         (SELECT COUNT(*)::int FROM appointments
           WHERE facility_id = $1 AND scheduled_at::date = CURRENT_DATE
             AND status IN ('checked_in','in_progress'))                              AS waiting_now`,
      [req.params.facility_id]
    );

    res.json({ facility: rows[0], stats: stats[0] });
  })
);
// ── POST /api/facilities ────────────────────────────────────────────────────
// Only a district/provincial administrator may declare a new facility.
router.post(
  '/',
  authenticate,
  allowRoles('superadmin'),
  [
    body('code').trim().notEmpty().withMessage('A facility code is required (e.g. MP-EHL-001).'),
    body('name').trim().notEmpty().withMessage('A facility name is required.'),
    body('type').isIn(FACILITY_TYPES).withMessage('Choose a valid facility type.'),
    body('level').optional().isInt({ min: 1, max: 4 }).withMessage('Level must be 1-4.'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email address.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { code, name, type, level, district, province, address, phone, email, operating_hours } = req.body;

    try {
      const { rows } = await db.query(
        `INSERT INTO facilities (code, name, type, level, district, province, address, phone, email, operating_hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING ${FACILITY_FIELDS}`,
        [code, name, type, level || null, district || null, province || null,
         address || null, phone || null, email || null, operating_hours || null]
      );

      await recordAudit(req, {
        action: 'FACILITY_CREATED', entity: 'facilities', entityId: rows[0].facility_id,
        detail: { code, name, type },
      });

      res.status(201).json({ facility: rows[0] });
    } catch (err) {
      throw translateDbError(err) || err;
    }
  })
);
// ── PATCH /api/facilities/:facility_id ────────────────────────────────────
// A facility admin may fix their own contact details; only the district office
// may change structure (code, type, level, active flag).
router.patch(
  '/:facility_id',
  authenticate,
  allowRoles('admin', 'superadmin'),
  [param('facility_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    assertFacilityAccess(req.user, req.params.facility_id);

    const editable = ['name', 'district', 'province', 'address', 'phone', 'email', 'operating_hours'];
    if (isSuperAdmin(req.user)) editable.push('code', 'type', 'level', 'is_active');

    const updates = {};
    for (const field of editable) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    const columns = Object.keys(updates);
    if (!columns.length) throw ApiError.badRequest('Nothing to update.');

    if (updates.type && !FACILITY_TYPES.includes(updates.type)) {
      throw ApiError.badRequest('Choose a valid facility type.');
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const { rows } = await db.query(
      `UPDATE facilities SET ${setClause} WHERE facility_id = $${columns.length + 1}
       RETURNING ${FACILITY_FIELDS}`,
      [...columns.map((c) => updates[c]), req.params.facility_id]
    );
    if (!rows.length) throw ApiError.notFound('Facility not found.');

    await recordAudit(req, {
      action: 'FACILITY_UPDATED', entity: 'facilities', entityId: req.params.facility_id,
      detail: { changed: columns },
    });

    res.json({ facility: rows[0] });
  })
);

module.exports = router;