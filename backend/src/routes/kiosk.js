/**
 * KIOSK ROUTES — /api/kiosk  (PUBLIC)
 * ─────────────────────────────────
 * The waiting-room touchscreen. This is the only part of the API that answers
 * without a staff login, so it is deliberately the most restricted:
 *
 *   • an anonymous kiosk gets the patient's name and appointment ONLY — never
 *     allergies, blood type, phone numbers or the ID number itself;
 *   • set KIOSK_API_KEY in .env and the kiosk must send it as X-Kiosk-Key, so
 *     the endpoint cannot be called from any random PC on the clinic network;
 *   • every lookup and check-in is written to the POPIA access log;
 *   • rate limited to 60 requests/minute per IP (middleware/security.js).
 *
 * Staff calling these endpoints with a valid token receive the full record
 * their role allows, so one screen can serve the waiting room and reception.
 */

const express = require('express');
const { body } = require('express-validator');

const config = require('../config');
const db     = require('../db/pool');
const { ApiError, asyncHandler, validate } = require('../utils/http');
const { optionalAuth } = require('../middleware/auth');
const { maskPatientForRole, minimiseForKiosk } = require('../middleware/popia');
const { recordAudit, recordPatientAccess } = require('../services/audit');
const { isValidIdNumber, normaliseIdNumber } = require('../utils/saId');

const router = express.Router();

const idRule = body('id_number')
  .customSanitizer((v) => normaliseIdNumber(v))
  .custom((v) => isValidIdNumber(v))
  .withMessage('That ID number does not look right. Please check the 13 digits and try again.');

/** Shared-key check for unauthenticated kiosk devices. */
function kioskKey(req, _res, next) {
  if (req.user) return next();                     // staff token — no key needed
  if (!config.kiosk.apiKey) return next();         // not configured (pilot)
  const provided = req.headers['x-kiosk-key'];
  if (provided && provided === config.kiosk.apiKey) return next();
  return next(ApiError.unauthorized('This kiosk is not authorised. Ask the clinic administrator for the kiosk key.'));
}

const APPOINTMENT_SELECT = `
  SELECT a.appointment_id, a.scheduled_at, a.status, a.priority, a.reason,
         f.facility_id, f.name AS facility_name, f.type AS facility_type,
         dep.name AS department_name, pr.name AS provider_name, pr.specialisation
    FROM appointments a
    JOIN facilities f  ON f.facility_id  = a.facility_id
    JOIN providers  pr ON pr.provider_id = a.provider_id
    LEFT JOIN departments dep ON dep.department_id = a.department_id
`;

/** Today's appointment if there is one, otherwise the next future booking. */
async function appointmentFor(patientId, facilityId) {
  const today = await db.query(
    `${APPOINTMENT_SELECT}
      WHERE a.patient_id = $1
        AND a.status IN ('scheduled', 'checked_in', 'in_progress')
        AND a.scheduled_at::date = CURRENT_DATE
        AND ($2::uuid IS NULL OR a.facility_id = $2::uuid)
      ORDER BY a.scheduled_at ASC LIMIT 1`,
    [patientId, facilityId]
  );
  if (today.rows.length) return today.rows[0];

  const next = await db.query(
    `${APPOINTMENT_SELECT}
      WHERE a.patient_id = $1
        AND a.status = 'scheduled'
        AND a.scheduled_at >= NOW()
        AND ($2::uuid IS NULL OR a.facility_id = $2::uuid)
      ORDER BY a.scheduled_at ASC LIMIT 1`,
    [patientId, facilityId]
  );
  return next.rows[0] || null;
}

// ── POST /api/kiosk/lookup ─────────────────────────────────────────────────
router.post(
  '/lookup',
  optionalAuth,
  kioskKey,
  [idRule],
  validate,
  asyncHandler(async (req, res) => {
    const idNumber   = normaliseIdNumber(req.body.id_number);
    const facilityId = req.user?.facility_id || req.body.facility_id || null;

    const { rows } = await db.query(
      `SELECT patient_id, id_number, first_name, last_name, date_of_birth, gender,
              phone, address, blood_type, allergies, chronic_conditions, home_facility_id
         FROM patients WHERE id_number = $1`,
      [idNumber]
    );

    if (!rows.length) {
      return res.status(404).json({
        found: false,
        error: 'We could not find that ID number. Please go to the reception desk so we can register you.',
      });
    }

    const patient = rows[0];
    const appointment = await appointmentFor(patient.patient_id, facilityId);

    await recordPatientAccess(req, {
      patientId: patient.patient_id,
      action: req.user ? 'KIOSK_LOOKUP_STAFF' : 'KIOSK_LOOKUP_PUBLIC',
    });

    // Authenticated staff see the full record their role permits.
    if (req.user) {
      return res.json({
        found: true,
        mode: 'staff',
        patient: maskPatientForRole(patient, req.user.role),
        appointment,
        can_check_in: !!appointment && appointment.status === 'scheduled',
      });
    }

    const checkedIn = !!appointment && appointment.status !== 'scheduled';
    return res.json({
      found: true,
      mode: 'kiosk',
      ...(config.kiosk.minimisePublicLookup
        ? minimiseForKiosk(patient, appointment, checkedIn)
        : {
            patient: `${patient.first_name} ${patient.last_name}`,
            next_appointment: appointment,
          }),
      can_check_in: !!appointment && appointment.status === 'scheduled',
    });
  })
);

// ── POST /api/kiosk/check-in ───────────────────────────────────────────────
// Step 4 of the clinic flow: the patient confirms they have arrived, and they
// appear on the nurse's waiting list.
router.post(
  '/check-in',
  optionalAuth,
  kioskKey,
  [idRule],
  validate,
  asyncHandler(async (req, res) => {
    const idNumber   = normaliseIdNumber(req.body.id_number);
    const facilityId = req.user?.facility_id || req.body.facility_id || null;

    const patient = await db.query(
      'SELECT patient_id, first_name, last_name FROM patients WHERE id_number = $1',
      [idNumber]
    );
    if (!patient.rows.length) {
      return res.status(404).json({ checked_in: false, error: 'No record found for that ID number. Please see reception.' });
    }

    const appointment = await appointmentFor(patient.rows[0].patient_id, facilityId);

    if (!appointment || appointment.scheduled_at.slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
      return res.json({
        checked_in: false,
        message: appointment
          ? `Your next appointment is on ${new Date(appointment.scheduled_at).toLocaleDateString('en-ZA')} — there is nothing to check in for today.`
          : 'You have no appointment booked. Please go to the reception desk.',
      });
    }

    if (appointment.status !== 'scheduled') {
      return res.json({
        checked_in: true,
        already: true,
        message: 'You are already checked in. Please take a seat — a nurse will call your name.',
        appointment: {
          scheduled_at: appointment.scheduled_at,
          provider_name: appointment.provider_name,
          department_name: appointment.department_name,
        },
      });
    }

    await db.query(
      `UPDATE appointments SET status = 'checked_in', checked_in_at = NOW()
        WHERE appointment_id = $1 AND status = 'scheduled'`,
      [appointment.appointment_id]
    );

    await recordAudit(req, {
      action: 'KIOSK_CHECK_IN', entity: 'appointments', entityId: appointment.appointment_id,
      facilityId: appointment.facility_id,
      detail: { patient_id: patient.rows[0].patient_id, mode: req.user ? 'staff' : 'kiosk' },
    });
    await recordPatientAccess(req, {
      patientId: patient.rows[0].patient_id, action: 'KIOSK_CHECK_IN',
    });

    res.json({
      checked_in: true,
      message: 'Thank you — you are checked in. Please take a seat and a nurse will call your name.',
      appointment: {
        scheduled_at: appointment.scheduled_at,
        facility_name: appointment.facility_name,
        department_name: appointment.department_name,
        provider_name: appointment.provider_name,
      },
    });
  })
);

module.exports = router;