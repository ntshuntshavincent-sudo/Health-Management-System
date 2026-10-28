/**
 * PROVIDER ROUTES — /api/providers  (v1 alias: /api/doctors)
 * The clinical roster: doctors, specialists, nurses, clinical associates and
 * pharmacists. Hospitals book patients with nurses too, which is why this is
 * no longer a "doctors" table.
 */

const express = require('express');
const { body, param } = require('express-validator');

const db = require('../db/pool');
const { ApiError, asyncHandler, validate, translateDbError } = require('../utils/http');
const { authenticate, allowRoles, isSuperAdmin, assertFacilityAccess } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();

const PROVIDER_ROLES = ['doctor', 'specialist', 'nurse', 'clinical_associate', 'pharmacist'];

const FIELDS = `
  p.provider_id, p.facility_id, p.department_id, p.name, p.role, p.specialisation,
  p.registration_number, p.employee_number, p.phone, p.email, p.is_active,
  p.created_at, p.updated_at,
  f.name AS facility_name, f.type AS facility_type,
  d.name AS department_name, d.type AS department_type
`;

// ── GET /api/providers ──────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';

  const facilityId = isSuperAdmin(req.user) ? (req.query.facility_id || null) : req.user.facility_id;
  if (facilityId)              { params.push(facilityId);           where += ` AND p.facility_id = $${params.length}`; }
  if (req.query.department_id) { params.push(req.query.department_id); where += ` AND p.department_id = $${params.length}`; }
  if (req.query.role)          { params.push(req.query.role);        where += ` AND p.role = $${params.length}`; }
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    where += ` AND (p.name ILIKE $${params.length} OR p.specialisation ILIKE $${params.length})`;
  }
  if (req.query.active !== 'all') where += ' AND p.is_active = TRUE';

  const { rows } = await db.query(
    `SELECT ${FIELDS}
       FROM providers p
       JOIN facilities f ON f.facility_id = p.facility_id
       LEFT JOIN departments d ON d.department_id = p.department_id
       ${where}
      ORDER BY p.role, p.name`,
    params
  );

  res.json({ providers: rows, doctors: rows });   // `doctors` keeps v1 clients working
}));

// ── GET /api/providers/:provider_id/schedule?date=YYYY-MM-DD ────────────────
router.get(
  '/:provider_id/schedule',
  authenticate,
  [param('provider_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const provider = await db.query('SELECT facility_id FROM providers WHERE provider_id = $1', [req.params.provider_id]);
    if (!provider.rows.length) throw ApiError.notFound('Provider not found.');
    assertFacilityAccess(req.user, provider.rows[0].facility_id);

    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const { rows } = await db.query(
      `SELECT a.appointment_id, a.scheduled_at, a.duration_minutes, a.status, a.priority, a.reason,
              p.patient_id, p.first_name, p.last_name, p.id_number, p.date_of_birth,
              p.blood_type, p.allergies, dep.name AS department_name
         FROM appointments a
         JOIN patients p ON p.patient_id = a.patient_id
         LEFT JOIN departments dep ON dep.department_id = a.department_id
        WHERE a.provider_id = $1 AND a.scheduled_at::date = $2::date
        ORDER BY a.scheduled_at`,
      [req.params.provider_id, date]
    );

// ── POST /api/providers ─────────────────────────────────────────────────────
router.post(
  '/',
  authenticate,
  allowRoles('admin', 'superadmin'),
  [
    body('facility_id').isUUID().withMessage('facility_id is required.'),
    body('name').trim().notEmpty().withMessage('The provider name is required.'),
    body('role').isIn(PROVIDER_ROLES).withMessage('Choose a valid role.'),
    body('employee_number').trim().notEmpty().withMessage('An employee number is required.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { facility_id, department_id, name, role, specialisation,
            registration_number, employee_number, phone, email } = req.body;

    assertFacilityAccess(req.user, facility_id);

    // A department must belong to the same facility, otherwise reporting splits.
    if (department_id) {
      const dep = await db.query('SELECT facility_id FROM departments WHERE department_id = $1', [department_id]);
      if (!dep.rows.length) throw ApiError.badRequest('That department does not exist.');
      if (dep.rows[0].facility_id !== facility_id) {
        throw ApiError.badRequest('The department belongs to a different facility.');
      }
    }

    try {
      const { rows } = await db.query(
        `INSERT INTO providers (facility_id, department_id, name, role, specialisation,
                                registration_number, employee_number, phone, email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING provider_id, facility_id, department_id, name, role, specialisation,
                   registration_number, employee_number, phone, email, is_active, created_at`,
        [facility_id, department_id || null, name, role, specialisation || null,
         registration_number || null, employee_number, phone || null, email || null]
      );

      await recordAudit(req, {
        action: 'PROVIDER_CREATED', entity: 'providers', entityId: rows[0].provider_id,
        detail: { name, role, facility_id },
      });

      res.status(201).json({ provider: rows[0], doctor: rows[0] });
    } catch (err) {
      throw translateDbError(err) || err;
    }
  })
);

// ── PATCH /api/providers/:provider_id ──────────────────────────────────────
router.patch(
  '/:provider_id',
  authenticate,
  allowRoles('admin', 'superadmin'),
  [param('provider_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const current = await db.query('SELECT facility_id FROM providers WHERE provider_id = $1', [req.params.provider_id]);
    if (!current.rows.length) throw ApiError.notFound('Provider not found.');
    assertFacilityAccess(req.user, current.rows[0].facility_id);

    const updates = {};
    for (const field of ['name', 'role', 'specialisation', 'registration_number',
                         'employee_number', 'phone', 'email', 'is_active', 'department_id']) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    const columns = Object.keys(updates);
    if (!columns.length) throw ApiError.badRequest('Nothing to update.');
    if (updates.role && !PROVIDER_ROLES.includes(updates.role)) {
      throw ApiError.badRequest('Choose a valid role.');
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const { rows } = await db.query(
      `UPDATE providers SET ${setClause} WHERE provider_id = $${columns.length + 1}
       RETURNING provider_id, facility_id, department_id, name, role, specialisation,
                 registration_number, employee_number, phone, email, is_active, updated_at`,
      [...columns.map((c) => updates[c]), req.params.provider_id]
    );

    await recordAudit(req, {
      action: 'PROVIDER_UPDATED', entity: 'providers', entityId: req.params.provider_id,
      detail: { changed: columns },
    });

    res.json({ provider: rows[0], doctor: rows[0] });
  })
);

module.exports = router;