/**
 * AUDIT ROUTES — /api/audit
 * ────────────────────────
 * POPIA section 22 gives patients the right to know who looked at their file,
 * and the Department of Health expects an audit trail it can inspect. These
 * endpoints expose that trail — to administrators only.
 *
 * GET /                      audit_log (every meaningful action)
 * GET /access                data_access_log (patient record views)
 * GET /patient/:patient_id   who viewed one patient's record
 * GET /actions               distinct action names (for filter dropdowns)
 * GET /summary               counts per action for a date range
 */

const express = require('express');
const { param } = require('express-validator');

const db = require('../db/pool');
const { ApiError, asyncHandler, validate } = require('../utils/http');
const { authenticate, allowRoles, isSuperAdmin } = require('../middleware/auth');
const { clientIp } = require('../services/audit');

const router = express.Router();

// ── GET /api/audit ─────────────────────────────────────────────────────────
router.get('/', authenticate, allowRoles('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';

  if (!isSuperAdmin(req.user)) {
    params.push(req.user.facility_id);
    where += ` AND facility_id = $${params.length}`;
  } else if (req.query.facility_id) {
    params.push(req.query.facility_id);
    where += ` AND facility_id = $${params.length}`;
  }

  if (req.query.action)   { params.push(req.query.action);   where += ` AND action = $${params.length}`; }
  if (req.query.entity)   { params.push(req.query.entity);   where += ` AND entity = $${params.length}`; }
  if (req.query.username) { params.push(req.query.username); where += ` AND username = $${params.length}`; }
  if (req.query.from)     { params.push(req.query.from);     where += ` AND created_at >= $${params.length}::date`; }
  if (req.query.to)       { params.push(req.query.to);       where += ` AND created_at < ($${params.length}::date + INTERVAL '1 day')`; }

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  params.push(limit);

  const { rows } = await db.query(
    `SELECT log_id, user_id, username, role, facility_id, action, entity, entity_id,
            ip_address, detail, created_at
       FROM audit_log ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );

  res.json({ entries: rows, count: rows.length });
}));

// ─ GET /api/audit/access ──────────────────────────────────────────────────
// "Who opened patient records, and when" — the report the Information Officer
// asks for after a complaint.
router.get('/access', authenticate, allowRoles('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';

  if (!isSuperAdmin(req.user)) {
    params.push(req.user.facility_id);
    where += ` AND facility_id = $${params.length}`;
  } else if (req.query.facility_id) {
    params.push(req.query.facility_id);
    where += ` AND facility_id = $${params.length}`;
  }

  if (req.query.patient_id) { params.push(req.query.patient_id); where += ` AND patient_id = $${params.length}`; }
  if (req.query.username)   { params.push(req.query.username);   where += ` AND username = $${params.length}`; }
  if (req.query.action)     { params.push(req.query.action);     where += ` AND action = $${params.length}`; }
  if (req.query.from)       { params.push(req.query.from);       where += ` AND accessed_at >= $${params.length}::date`; }
  if (req.query.to)         { params.push(req.query.to);         where += ` AND accessed_at < ($${params.length}::date + INTERVAL '1 day')`; }

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  params.push(limit);

  const { rows } = await db.query(
    `SELECT a.access_id, a.user_id, a.username, a.role, a.facility_id, a.patient_id,
            a.action, a.reason, a.ip_address, a.accessed_at,
            p.first_name, p.last_name, p.id_number,
            f.name AS facility_name
       FROM data_access_log a
       LEFT JOIN patients p ON p.patient_id = a.patient_id
       LEFT JOIN facilities f ON f.facility_id = a.facility_id
       ${where}
      ORDER BY a.accessed_at DESC
      LIMIT $${params.length}`,
    params
  );

  res.json({ entries: rows, count: rows.length });
}));

// ── GET /api/audit/patient/:patient_id ─────────────────────────────────────
// A patient's data-access request: "who has seen my file?"
router.get(
  '/patient/:patient_id',
  authenticate,
  allowRoles('admin', 'superadmin'),
  [param('patient_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const patient = await db.query(
      'SELECT patient_id, id_number, first_name, last_name, home_facility_id FROM patients WHERE patient_id = $1',
      [req.params.patient_id]
    );
    if (!patient.rows.length) throw ApiError.notFound('Patient not found.');

    const { rows } = await db.query(
      `SELECT a.access_id, a.username, a.role, a.action, a.reason, a.ip_address, a.accessed_at,
              f.name AS facility_name
         FROM data_access_log a
         LEFT JOIN facilities f ON f.facility_id = a.facility_id
        WHERE a.patient_id = $1
        ORDER BY a.accessed_at DESC
        LIMIT 500`,
      [req.params.patient_id]
    );

    res.json({
      patient: patient.rows[0],
      access_count: rows.length,
      entries: rows,
      requested_from_ip: clientIp(req),
    });
  })
);

// ── GET /api/audit/actions ─────────────────────────────────────────────────
router.get('/actions', authenticate, allowRoles('admin', 'superadmin'), asyncHandler(async (_req, res) => {
  const { rows } = await db.query(
    `SELECT action, COUNT(*)::int AS occurrences, MAX(created_at) AS last_seen
       FROM audit_log GROUP BY action ORDER BY action`
  );
  res.json({ actions: rows });
}));

// ── GET /api/audit/summary?from=&to= ───────────────────────────────────────
router.get('/summary', authenticate, allowRoles('admin', 'superadmin'), asyncHandler(async (req, res) => {
  const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to   = req.query.to   || new Date().toISOString().slice(0, 10);

  const params = [from, to];
  let facilityFilter = '';
  if (!isSuperAdmin(req.user)) {
    params.push(req.user.facility_id);
    facilityFilter = ` AND facility_id = $${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT action, COUNT(*)::int AS occurrences
       FROM audit_log
      WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day') ${facilityFilter}
      GROUP BY action ORDER BY occurrences DESC`,
    params
  );

  const access = await db.query(
    `SELECT COUNT(*)::int AS patient_record_views
       FROM data_access_log
      WHERE accessed_at >= $1::date AND accessed_at < ($2::date + INTERVAL '1 day') ${facilityFilter}`,
    params
  );

  res.json({ from, to, actions: rows, patient_record_views: access.rows[0].patient_record_views });
}));

module.exports = router;