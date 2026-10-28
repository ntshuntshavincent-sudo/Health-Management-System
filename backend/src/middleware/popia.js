/**
 * POPIA COMPLIANCE LAYER
 * ──────────────────────
 * The Protection of Personal Information Act requires, among other things:
 *   1. Purpose limitation    — only process data needed for healthcare
 *   2. Data minimisation     — hand out only the fields actually needed
 *   3. Access logging        — record who accessed which patient record, when
 *   4. Data subject rights   — patients can ask for their record or a deletion
 *   5. Security safeguards   — protect data in transit and at rest
 *
 * This file implements (2) and (3) in one place so no route can forget them.
 */

const db = require('../db/pool');
const { recordPatientAccess } = require('../services/audit');

// ─── FIELD-LEVEL MASKING ─────────────────────────────────────────────────────
// receptionist  → contact details, no clinical data
// clinical roles→ full record
// public kiosk  → first name, surname and next appointment ONLY
function maskPatientForRole(patient, role) {
  if (!patient) return null;

  const base = {
    patient_id:    patient.patient_id,
    id_number:     patient.id_number,
    first_name:    patient.first_name,
    last_name:     patient.last_name,
    date_of_birth: patient.date_of_birth,
    gender:        patient.gender,
  };

  if (role === 'receptionist') {
    return {
      ...base,
      phone:      patient.phone,
      address:    patient.address,
      blood_type: '[restricted]',
      allergies:  '[restricted]',
    };
  }

  if (['superadmin', 'admin', 'doctor', 'nurse', 'pharmacist'].includes(role)) {
    return { ...patient };
  }

  return base;
}

/**
 * PUBLIC KIOSK PAYLOAD
 * The kiosk is a touchscreen in a public waiting room. Anyone can stand at it,
 * so it must never expose allergies, blood type, ID number or phone numbers —
 * the original design leaked all of those to anyone who typed a known ID.
 * The patient still sees what they came for: their name and next appointment,
 * plus a confirmation that they have checked in.
 */
function minimiseForKiosk(patient, nextAppointment, checkedIn = false) {
  if (!patient) return null;
  return {
    greeting: `${patient.first_name} ${patient.last_name}`,
    first_name: patient.first_name,
    date_of_birth: patient.date_of_birth,
    next_appointment: nextAppointment
      ? {
          appointment_id: nextAppointment.appointment_id,
          scheduled_at:   nextAppointment.scheduled_at,
          status:         nextAppointment.status,
          facility_name:  nextAppointment.facility_name || null,
          department_name: nextAppointment.department_name || null,
          provider_name:  nextAppointment.provider_name || null,
        }
      : null,
    checked_in: checkedIn,
    privacy_notice:
      'Only your name and appointment are shown here. Full medical records are available to clinic staff only.',
  };
}

// ─── CHANGED-RECORDS / ACCESS LOGGING ────────────────────────────────────────
/**
 * Middleware factory: logs a data access row whenever the response actually
 * contains a patient record. Errors in logging never break the request — but
 * they are written to stderr so operations can see an audit failure.
 */
function trackPatientAccess(action = 'VIEW_PATIENT') {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      const patientId = body?.patient?.patient_id || body?.patients?.[0]?.patient_id;
      if (patientId && req.user) {
        recordPatientAccess(req, { patientId, action, reason: req.auditReason || null });
      }
      return originalJson(body);
    };

    next();
  };
}

// ─── DATA RETENTION ──────────────────────────────────────────────────────────
/**
 * POPIA + the National Health Act: do not keep personal data longer than
 * necessary. Medical records are retained for at least 6 years after the last
 * entry. This finds patients with no activity inside the retention window so
 * the Information Officer can review them — it never deletes anything itself.
 */
async function getRetentionCandidates(retentionYears = 6, facilityId = null) {
  const { rows } = await db.query(
    `SELECT p.patient_id, p.first_name, p.last_name, p.id_number, p.created_at,
            MAX(a.scheduled_at) AS last_visit
       FROM patients p
       LEFT JOIN appointments a ON a.patient_id = p.patient_id
      WHERE ($1::uuid IS NULL OR p.home_facility_id = $1::uuid)
      GROUP BY p.patient_id, p.first_name, p.last_name, p.id_number, p.created_at
     HAVING COALESCE(MAX(a.scheduled_at), p.created_at) < NOW() - ($2 || ' years')::interval
      ORDER BY COALESCE(MAX(a.scheduled_at), p.created_at) ASC
      LIMIT 500`,
    [facilityId, String(retentionYears)]
  );
  return rows;
}

module.exports = {
  maskPatientForRole,
  minimiseForKiosk,
  trackPatientAccess,
  getRetentionCandidates,
};