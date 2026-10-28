const express = require('express');
const router  = express.Router();

const { authenticate, authorize } = require('../middleware/auth');
const {
  lookupByIdNumber, registerPatient,
  getPatientById,   updatePatient, searchPatients
} = require('../controllers/patientController');
const { bookAppointment, getTodayAppointments, updateAppointmentStatus } = require('../controllers/appointmentController');
const { createNote, getPatientNotes } = require('../controllers/notesController');
const { login, createUser }           = require('../controllers/authController');

// ─────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────
router.post('/auth/login',       login);
router.post('/auth/create-user', authenticate, authorize('admin'), createUser);

// ─────────────────────────────────────────
// PATIENT ROUTES
// ─────────────────────────────────────────

// Kiosk lookup — public, no login needed
router.get('/patients',           lookupByIdNumber);

// Staff search
router.get('/patients/search',    authenticate, authorize('admin','doctor','receptionist'), searchPatients);

// Full record — doctors and admin only
router.get('/patients/:patient_id',    authenticate, authorize('admin','doctor'), getPatientById);

// Register a new patient — receptionist or admin
router.post('/patients',               authenticate, authorize('admin','receptionist'), registerPatient);

// Update patient details — receptionist or admin
router.put('/patients/:patient_id',    authenticate, authorize('admin','receptionist'), updatePatient);

// ─────────────────────────────────────────
// APPOINTMENT ROUTES
// ─────────────────────────────────────────
router.get('/appointments/today',                         authenticate, authorize('admin','doctor','receptionist'), getTodayAppointments);
router.post('/appointments',                              authenticate, authorize('admin','receptionist'),          bookAppointment);
router.patch('/appointments/:appointment_id/status',      authenticate, authorize('admin','doctor','receptionist'), updateAppointmentStatus);

// ─────────────────────────────────────────
// VISIT NOTES ROUTES
// ─────────────────────────────────────────
router.post('/notes',                      authenticate, authorize('admin','doctor'), createNote);
router.get('/notes/patient/:patient_id',   authenticate, authorize('admin','doctor'), getPatientNotes);

module.exports = router;
