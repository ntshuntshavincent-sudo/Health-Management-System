/**
 * DEPARTMENT ROUTES — /api/departments
 * OPD, casualty, maternity, paediatrics, pharmacy, wards… A clinic usually has
 * one or two; a hospital has many. Appointments and notes are filed against a
 * department so a hospital can see throughput per ward.
 */

const express = require('express');
const { body, param } = require('express-validator');

const db = require('../db/pool');
const { ApiError, asyncHandler, validate, translateDbError } = require('../utils/http');
const { authenticate, allowRoles, isSuperAdmin, assertFacilityAccess } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();

const DEPARTMENT_TYPES = ['opd', 'casualty', 'maternity', 'paediatrics', 'pharmacy', 'laboratory',
                          'radiology', 'ward', 'dental', 'mental_health', 'hiv_tb', 'chronic',
                          'admin', 'other'];

const FIELDS = `
  dep.department_id, dep.facility_id, dep.code, dep.name, dep.type, dep.room,
  dep.is_active, dep.created_at, dep.updated_at,
  f.name AS facility_name, f.type AS facility_type
`;

// ── GET /api/departments ────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';

  // Facility staff are pinned to their own facility; superadmin may filter.
  const facilityId = isSuperAdmin(req.user) ? (req.query.facility_id || null) : req.user.facility_id;
  if (facilityId) { params.push(facilityId); where += ` AND dep.facility_id = $${params.length}`; }
  if (req.query.type) { params.push(req.query.type); where += ` AND dep.type = $${params.length}`; }
  if (req.query.active !== 'all') where += ' AND dep.is_active = TRUE';

  const { rows } = await db.query(
    `SELECT ${FIELDS},
            (SELECT COUNT(*)::int FROM providers p
              WHERE p.department_id = dep.department_id AND p.is_active) AS provider_count
       FROM departments dep
       JOIN facilities f ON f.facility_id = dep.facility_id
       ${where}
      ORDER BY f.name, dep.type, dep.name`,
    params
  );

  res.json({ departments: rows });
}));

// ── POST /api/departments ───────────────────────────────────────────────────
router.post(
  '/',
  authenticate,
  allowRoles('admin', 'superadmin'),
  [
    body('facility_id').isUUID().withMessage('facility_id is required.'),
    body('code').trim().notEmpty().withMessage('A short department code is required (e.g. OPD).'),
    body('name').trim().notEmpty().withMessage('A department name is required.'),
    body('type').isIn(DEPARTMENT_TYPES).withMessage('Choose a valid department type.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { facility_id, code, name, type, room } = req.body;
    assertFacilityAccess(req.user, facility_id);

    try {
      const { rows } = await db.query(
        `INSERT INTO departments (facility_id, code, name, type, room)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING department_id, facility_id, code, name, type, room, is_active, created_at`,
        [facility_id, code.toUpperCase(), name, type, room || null]
      );
      await recordAudit(req, {
        action: 'DEPARTMENT_CREATED', entity: 'departments', entityId: rows[0].department_id,
        detail: { code, type, facility_id },
      });
      res.status(201).json({ department: rows[0] });
    } catch (err) {
      throw translateDbError(err) || err;
    }
  })
);

// ── PATCH /api/departments/:department_id ──────────────────────────────────
router.patch(
  '/:department_id',
  authenticate,
  allowRoles('admin', 'superadmin'),
  [param('department_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const current = await db.query('SELECT facility_id FROM departments WHERE department_id = $1', [req.params.department_id]);
    if (!current.rows.length) throw ApiError.notFound('Department not found.');
    assertFacilityAccess(req.user, current.rows[0].facility_id);

    const updates = {};
    for (const field of ['code', 'name', 'type', 'room', 'is_active']) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    const columns = Object.keys(updates);
    if (!columns.length) throw ApiError.badRequest('Nothing to update.');
    if (updates.type && !DEPARTMENT_TYPES.includes(updates.type)) {
      throw ApiError.badRequest('Choose a valid department type.');
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const { rows } = await db.query(
      `UPDATE departments SET ${setClause} WHERE department_id = $${columns.length + 1}
       RETURNING department_id, facility_id, code, name, type, room, is_active, updated_at`,
      [...columns.map((c) => updates[c]), req.params.department_id]
    );

    await recordAudit(req, {
      action: 'DEPARTMENT_UPDATED', entity: 'departments', entityId: req.params.department_id,
      detail: { changed: columns },
    });

    res.json({ department: rows[0] });
  })
);

module.exports = router;