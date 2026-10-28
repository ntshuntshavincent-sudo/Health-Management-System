/**
 * API ROUTE INDEX
 * ──────────────
 * Everything is mounted under /api. The root returns a machine-readable index
 * of the endpoints — handy when handing the system over to a district IT team.
 */

const express = require('express');
const router  = express.Router();

const authRoutes        = require('./auth');
const facilityRoutes    = require('./facilities');
const departmentRoutes  = require('./departments');
const providerRoutes    = require('./providers');
const patientRoutes     = require('./patients');
const appointmentRoutes = require('./appointments');
const noteRoutes        = require('./notes');
const vitalsRoutes      = require('./vitals');
const kioskRoutes       = require('./kiosk');
const reportRoutes      = require('./reports');
const auditRoutes       = require('./audit');

router.get('/', (_req, res) => {
  res.json({
    name: 'HealthRecord API',
    version: require('../../package.json').version,
    description: 'Digital patient management for South African clinics and hospitals',
    endpoints: {
      auth:         '/api/auth        → login, me, password, users',
      facilities:   '/api/facilities  → clinics and hospitals in the district',
      departments:  '/api/departments → OPD, casualty, maternity, wards…',
      providers:    '/api/providers   → doctors, specialists, nurses (alias: /api/doctors)',
      patients:     '/api/patients    → register, search, full record, folders',
      appointments: '/api/appointments→ book, reschedule, status, waiting room',
      notes:        '/api/notes       → visit notes (diagnosis, prescription)',
      vitals:       '/api/vitals      → observations and triage',
      kiosk:        '/api/kiosk       → public ID lookup and check-in',
      reports:      '/api/reports     → daily activity, district roll-up, retention',
      audit:        '/api/audit       → POPIA access trail (admin only)',
    },
  });
});

router.use('/auth',         authRoutes);
router.use('/facilities',   facilityRoutes);
router.use('/departments',  departmentRoutes);
router.use('/providers',    providerRoutes);
router.use('/doctors',      providerRoutes);   // v1 compatibility: /api/doctors
router.use('/patients',     patientRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/notes',        noteRoutes);
router.use('/vitals',       vitalsRoutes);
router.use('/kiosk',        kioskRoutes);
router.use('/reports',      reportRoutes);
router.use('/audit',        auditRoutes);

module.exports = router;