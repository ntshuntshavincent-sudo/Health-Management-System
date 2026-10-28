/**
 * POPIA COMPLIANCE LAYER
 * ──────────────────────
 * South Africa's Protection of Personal Information Act (POPIA) requires:
 *  1. Purpose limitation — only collect data needed for healthcare
 *  2. Data minimisation — return only the fields actually needed
 *  3. Access logging — record who accessed which patient record and when
 *  4. Data subject rights — patients can request their data or deletion
 *  5. Security safeguards — encrypt data in transit and at rest
 *
 * This middleware handles items 2 and 3 automatically.
 */

const pool = require('../db/pool');

// ─── FIELD-LEVEL MASKING ──────────────────────────────────────────────────────
// Receptionists see contact details but NOT clinical data.
// Doctors see clinical data but limited admin fields.
// Admins see everything.
function maskPatientForRole(patient, role) {
  if (!patient) return null;

  // Everyone sees these fields
  const base = {
    patient_id:    patient.patient_id,
    id_number:     patient.id_number,
    first_name:    patient.first_name,
    last_name:     patient.last_name,
    date_of_birth: patient.date_of_birth,
    gender:        patient.gender,
  };

  if (role === 'receptionist') {
    // Receptionists can see contact info to book appointments but NOT clinical
    return {
      ...base,
      phone:     patient.phone,
      address:   patient.address,
      blood_type: '[restricted]',
      allergies:  '[restricted]',
    };
  }

  if (role === 'doctor' || role === 'admin') {
    // Doctors and admins see full record
    return {
      ...base,
      phone:      patient.phone,
      address:    patient.address,
      blood_type: patient.blood_type,
      allergies:  patient.allergies,
    };
  }

  return base;
}

// ─── DATA ACCESS LOGGING ──────────────────────────────────────────────────────
// Every time a staff member views a patient record, log it.
// This creates the audit trail required by POPIA Section 22.
async function logDataAccess(userId, username, role, patientId, action) {
  try {
    await pool.query(
      `INSERT INTO data_access_log (user_id, username, role, patient_id, action, accessed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [userId, username, role, patientId, action]
    );
  } catch {
    // Never let audit logging break the actual request
    // but do write to stderr so ops team sees it
    console.error('[POPIA] Failed to write data access log');
  }
}

// ─── MIDDLEWARE: Auto-log patient record access ────────────────────────────────
function trackPatientAccess(action = 'VIEW_PATIENT') {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // If response contains a patient record, log the access
      if (body?.patient?.patient_id && req.user) {
        logDataAccess(
          req.user.user_id,
          req.user.username,
          req.user.role,
          body.patient.patient_id,
          action
        );
      }
      return originalJson(body);
    };
    next();
  };
}

// ─── DATA RETENTION CHECK ─────────────────────────────────────────────────────
// POPIA requires you don't keep personal data longer than necessary.
// This function identifies records older than the retention period (7 years
// for medical records in South Africa per the National Health Act).
async function getExpiredRecords() {
  const result = await pool.query(
    `SELECT patient_id, first_name, last_name, created_at
     FROM patients
     WHERE created_at < NOW() - INTERVAL '7 years'
     AND patient_id NOT IN (
       SELECT DISTINCT patient_id FROM appointments
       WHERE scheduled_at > NOW() - INTERVAL '7 years'
     )`
  );
  return result.rows;
}

// ─── SQL for data_access_log table ───────────────────────────────────────────
// Add this to migrate.sql if you want to use trackPatientAccess middleware:
/*
CREATE TABLE IF NOT EXISTS data_access_log (
  log_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID,
  username     VARCHAR(80),
  role         VARCHAR(20),
  patient_id   UUID,
  action       VARCHAR(50),
  accessed_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dal_patient  ON data_access_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_dal_user     ON data_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_dal_accessed ON data_access_log(accessed_at);
*/

module.exports = { maskPatientForRole, trackPatientAccess, getExpiredRecords };
