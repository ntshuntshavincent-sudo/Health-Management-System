/**
 * REPORT ROUTES — /api/reports
 * ───────────────────────────
 * The numbers a clinic manager, a hospital CEO and a district office all ask
 * for, straight from the views created in migration 004.
 *
 * GET /summary?date=        one day at one facility + department/provider split
 * GET /activity?from=&to=   day-by-day trend (the pitch's "3x more patients")
 * GET /district             roll-up across the district (superadmin)
 * GET /retention            records past the POPIA retention window
 */

const express = require('express');

const db = require('../db/pool');
const config = require('../config');
const { asyncHandler } = require('../utils/http');
const { authenticate, allowRoles, facilityScope } = require('../middleware/auth');
const { getRetentionCandidates } = require('../middleware/popia');

const router = express.Router();

const today = () => new Date().toISOString().slice(0, 10);

// ── GET /api/reports/summary ───────────────────────────────────────────────
router.get('/summary', authenticate, facilityScope, asyncHandler(async (req, res) => {
  const date = req.query.date || today();
  const params = [date];
  let facilityFilter = '';
  if (req.facilityId) {
    params.push(req.facilityId);
    facilityFilter = ` AND a.facility_id = $${params.length}`;
  }

  const { rows: summary } = await db.query(
    `SELECT
       COUNT(*)::int                                              AS booked,
       COUNT(*) FILTER (WHERE a.status = 'completed')::int        AS completed,
       COUNT(*) FILTER (WHERE a.status = 'checked_in')::int       AS waiting,
       COUNT(*) FILTER (WHERE a.status = 'in_progress')::int      AS in_progress,
       COUNT(*) FILTER (WHERE a.status = 'scheduled')::int        AS still_expected,
       COUNT(*) FILTER (WHERE a.status = 'cancelled')::int        AS cancelled,
       COUNT(*) FILTER (WHERE a.status = 'no_show')::int          AS no_show,
       COUNT(DISTINCT a.patient_id)::int                          AS unique_patients,
       ROUND(AVG(CASE WHEN a.completed_at IS NOT NULL AND a.checked_in_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (a.completed_at - a.checked_in_at)) / 60 END)::numeric, 1)
                                                                  AS avg_consult_minutes,
       ROUND(AVG(CASE WHEN a.checked_in_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (a.checked_in_at - a.scheduled_at)) / 60 END)::numeric, 1)
                                                                  AS avg_minutes_late
     FROM appointments a
     WHERE a.scheduled_at::date = $1::date ${facilityFilter}`,
    params
  );

  const { rows: byDepartment } = await db.query(
    `SELECT COALESCE(dep.name, 'Unassigned') AS department_name,
            dep.type AS department_type,
            COUNT(*)::int                                        AS booked,
            COUNT(*) FILTER (WHERE a.status = 'completed')::int  AS completed,
            COUNT(*) FILTER (WHERE a.status IN ('checked_in','in_progress'))::int AS active
       FROM appointments a
       LEFT JOIN departments dep ON dep.department_id = a.department_id
      WHERE a.scheduled_at::date = $1::date ${facilityFilter}
      GROUP BY dep.name, dep.type
      ORDER BY booked DESC`,
    params
  );

  const { rows: byProvider } = await db.query(
    `SELECT pr.name AS provider_name, pr.role AS provider_role, pr.specialisation,
            COUNT(*)::int                                        AS booked,
            COUNT(*) FILTER (WHERE a.status = 'completed')::int  AS completed
       FROM appointments a
       JOIN providers pr ON pr.provider_id = a.provider_id
      WHERE a.scheduled_at::date = $1::date ${facilityFilter}
      GROUP BY pr.name, pr.role, pr.specialisation
      ORDER BY booked DESC`,
    params
  );

  const { rows: newPatients } = await db.query(
    `SELECT COUNT(*)::int AS registered
       FROM patients
      WHERE created_at::date = $1::date
        AND ($2::uuid IS NULL OR home_facility_id = $2::uuid)`,
    [date, req.facilityId]
  );

  res.json({
    date,
    facility_id: req.facilityId,
    summary: { ...summary[0], new_patients_registered: newPatients[0].registered },
    by_department: byDepartment,
    by_provider: byProvider,
  });
}));

// ── GET /api/reports/activity ──────────────────────────────────────────────
router.get('/activity', authenticate, facilityScope, asyncHandler(async (req, res) => {
  const from = req.query.from || new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
  const to   = req.query.to   || today();

  const params = [from, to];
  let facilityFilter = '';
  if (req.facilityId) {
    params.push(req.facilityId);
    facilityFilter = ` AND facility_id = $${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT * FROM v_facility_daily_activity
      WHERE activity_date >= $1::date AND activity_date <= $2::date ${facilityFilter}
      ORDER BY activity_date DESC, facility_name`,
    params
  );

  res.json({ from, to, days: rows });
}));

// ── GET /api/reports/district ──────────────────────────────────────────────
// District / provincial oversight view — superadmin only.
router.get('/district', authenticate, allowRoles('superadmin'), asyncHandler(async (req, res) => {
  const date = req.query.date || today();
  const params = [date];
  let filter = '';
  if (req.query.district) { params.push(req.query.district); filter += ` AND f.district = $${params.length}`; }
  if (req.query.province) { params.push(req.query.province); filter += ` AND f.province = $${params.length}`; }

  const { rows: facilities } = await db.query(
    `SELECT f.facility_id, f.code, f.name, f.type, f.level, f.district, f.province,
            COALESCE(v.booked, 0)    AS booked,
            COALESCE(v.completed, 0) AS completed,
            COALESCE(v.waiting, 0)   AS waiting,
            COALESCE(v.no_show, 0)   AS no_show,
            v.avg_consult_minutes,
            (SELECT COUNT(*)::int FROM patients p
              WHERE p.home_facility_id = f.facility_id)                  AS registered_patients,
            (SELECT COUNT(*)::int FROM providers pr
              WHERE pr.facility_id = f.facility_id AND pr.is_active)     AS providers,
            (SELECT COUNT(*)::int FROM departments d
              WHERE d.facility_id = f.facility_id AND d.is_active)       AS departments
       FROM facilities f
       LEFT JOIN v_facility_daily_activity v
              ON v.facility_id = f.facility_id AND v.activity_date = $1::date
      WHERE f.is_active ${filter}
      ORDER BY f.province, f.district, f.name`,
    params
  );

  const totals = facilities.reduce((acc, f) => ({
    facilities:          acc.facilities + 1,
    appointments:        acc.appointments + f.booked,
    completed:           acc.completed + f.completed,
    registered_patients: acc.registered_patients + f.registered_patients,
  }), { facilities: 0, appointments: 0, completed: 0, registered_patients: 0 });

  // Completeness check for the district office: facilities that reported nothing.
  const silent = facilities.filter((f) => f.booked === 0).map((f) => ({ code: f.code, name: f.name }));

  res.json({ date, totals, facilities, facilities_with_no_activity_today: silent });
}));

// ── GET /api/reports/retention ─────────────────────────────────────────────
// POPIA / National Health Act: records past the retention window, for review.
// Nothing is deleted here — the Information Officer decides, and documents it.
router.get('/retention', authenticate, allowRoles('admin', 'superadmin'), facilityScope, asyncHandler(async (req, res) => {
  const years = parseInt(req.query.years, 10) || config.retentionYears;
  const candidates = await getRetentionCandidates(years, req.facilityId);

  res.json({
    retention_years: years,
    policy: `Medical records are kept for at least ${years} years after the last entry (National Health Act). Review each record before any deletion, and document the decision.`,
    review_count: candidates.length,
    patients: candidates,
  });
}));

module.exports = router;