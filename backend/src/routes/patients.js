/**
 * PATIENT ROUTES — /api/patients
 * ─────────────────────────────
 * GET    /                  exact SA-ID lookup (the heart of the system)
 * GET    /search            name / phone / folder search (facility scoped)
 * GET    /:patient_id       full record: folders, cross-facility history, vitals
 * POST   /                  register a patient (POPIA consent required)
 * PATCH  /:patient_id       correct details (role-limited fields)
 * POST   /:patient_id/folders   assign a folder number at a facility
 *
 * Access model worth knowing:
 *   • An exact ID-number lookup works district-wide — the patient is standing in
 *     front of you, and their history must follow them. Clinical fields are
 *     masked for receptionists and every lookup is written to the access log.
 *   • A name search is restricted to your facility's own patient population, so
 *     nobody can browse the district register from a clinic desk.
 */

const express = require('express');
const { body, param, query } = require('express-validator');

const db = require('../db/pool');
const { ApiError, asyncHandler, validate, translateDbError } = require('../utils/http');
const { authenticate, allowRoles, isSuperAdmin, assertFacilityAccess, REGISTER_ROLES, CLINICAL_ROLES } = require('../middleware/auth');
const { maskPatientForRole } = require('../middleware/popia');
const { recordAudit, recordPatientAccess } = require('../services/audit');
const { isValidIdNumber, normaliseIdNumber, decodeIdNumber } = require('../utils/saId');

const router = express.Router();

const ID_RULE = body('id_number')
  .custom((value) => isValidIdNumber(value))
  .withMessage('That is not a valid South African ID number. Please check the 13 digits.');

/** Is a 13-digit value a valid SA ID? (route-level validator) */
const idNumberRule = (field) =>
  query(field)
    .customSanitizer((v) => normaliseIdNumber(v))
    .custom((v) => isValidIdNumber(v))
    .withMessage('That is not a valid South African ID number.');

/** Next appointment for a patient, optionally scoped to one facility. */
async function nextAppointment(patientId, facilityId) {
  const { rows } = await db.query(
    `SELECT a.appointment_id, a.scheduled_at, a.status, a.priority, a.reason,
            f.facility_id, f.name AS facility_name, f.type AS facility_type,
            dep.name AS department_name,
            pr.name AS provider_name, pr.specialisation
       FROM appointments a
       JOIN facilities f ON f.facility_id = a.facility_id
       JOIN providers pr ON pr.provider_id = a.provider_id
       LEFT JOIN departments dep ON dep.department_id = a.department_id
      WHERE a.patient_id = $1
        AND a.status IN ('scheduled', 'checked_in', 'in_progress')
        AND a.scheduled_at >= NOW() - INTERVAL '6 hours'
        AND ($2::uuid IS NULL OR a.facility_id = $2::uuid)
      ORDER BY a.scheduled_at ASC
      LIMIT 1`,
    [patientId, facilityId]
  );
  return rows[0] || null;
}

async function foldersFor(patientId) {
  const { rows } = await db.query(
    `SELECT pf.folder_id, pf.folder_number, pf.facility_id, pf.opened_at,
            f.name AS facility_name, f.code AS facility_code
       FROM patient_folders pf
       JOIN facilities f ON f.facility_id = pf.facility_id
      WHERE pf.patient_id = $1
      ORDER BY pf.opened_at`,
    [patientId]
  );
  return rows;
}

// ── GET /api/patients?id_number=XXXXXXXXXXXXX ───────────────────────────────
router.get(
  '/',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor', 'nurse', 'pharmacist', 'receptionist'),
  [idNumberRule('id_number')],
  validate,
  asyncHandler(async (req, res) => {
    const idNumber = normaliseIdNumber(req.query.id_number);

    const { rows } = await db.query(
      `SELECT patient_id, id_number, first_name, last_name, date_of_birth, gender,
              phone, email, address, blood_type, allergies, chronic_conditions,
              next_of_kin_name, next_of_kin_phone, medical_aid_scheme, medical_aid_number,
              home_facility_id, is_deceased, consent_popia, created_at
         FROM patients WHERE id_number = $1`,
      [idNumber]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'No patient registered with that ID number.' });
    }

    const patient = maskPatientForRole(rows[0], req.user.role);

    await recordPatientAccess(req, {
      patientId: rows[0].patient_id,
      action: 'LOOKUP_BY_ID',
      reason: req.query.reason || null,
    });

    res.json({
      patient,
      next_appointment: await nextAppointment(rows[0].patient_id, req.facilityId || null),
      folders: await foldersFor(rows[0].patient_id),
    });
  })
);

/**
 * Give a patient a folder number at a facility. If the receptionist does not
 * supply one, the next number in the facility's sequence is used
 * (e.g. MP-EHL-001 → "001-0042"). Retries on the unique constraint, which is
 * what makes concurrent registrations at a busy front desk safe.
 */
async function assignFolder(patientId, facilityId, requestedNumber = null) {
  const { rows: facilityRows } = await db.query('SELECT code FROM facilities WHERE facility_id = $1', [facilityId]);
  if (!facilityRows.length) throw ApiError.badRequest('Facility not found.');
  const prefix = `F${facilityRows[0].code}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    let folderNumber = requestedNumber;

    if (!folderNumber) {
      const { rows: countRows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM patient_folders WHERE facility_id = $1',
        [facilityId]
      );
      folderNumber = `${prefix}-${String(countRows[0].n + 1 + attempt).padStart(4, '0')}`;
    }

    try {
      const { rows } = await db.query(
        `INSERT INTO patient_folders (patient_id, facility_id, folder_number)
         VALUES ($1,$2,$3)
         ON CONFLICT (patient_id, facility_id)
         DO UPDATE SET folder_number = EXCLUDED.folder_number
         RETURNING folder_id, patient_id, facility_id, folder_number, opened_at`,
        [patientId, facilityId, folderNumber]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505' && !requestedNumber) continue;   // number taken — try the next one
      if (err.code === '23505') throw ApiError.conflict('That folder number is already in use at this facility.');
      throw translateDbError(err) || err;
    }
  }
  return null;
}

// ── POST /api/patients ─────────────────────────────────────────────────────
// Register a patient. POPIA requires that consent can be shown to have been
// given, so consent_popia must be true — the UI shows the notice beside it.
router.post(
  '/',
  authenticate,
  allowRoles(...REGISTER_ROLES),
  [
    ID_RULE,
    body('first_name').trim().notEmpty().withMessage('The first name is required.'),
    body('last_name').trim().notEmpty().withMessage('The last name is required.'),
    body('consent_popia')
      .custom((v) => v === true || v === 'true')
      .withMessage('POPIA consent must be recorded before registering a patient.'),
    body('date_of_birth').optional({ values: 'falsy' }).isISO8601().withMessage('Enter a valid date of birth.'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email address.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const facilityId = req.facilityId || req.user.facility_id;
    if (!facilityId) throw ApiError.badRequest('facility_id is required to register a patient.');

    const b = req.body;
    const idNumber = normaliseIdNumber(b.id_number);
    const decoded  = decodeIdNumber(idNumber);        // date of birth + gender come from the ID

    const existing = await db.query(
      'SELECT patient_id, first_name, last_name FROM patients WHERE id_number = $1', [idNumber]
    );
    if (existing.rows.length) {
      throw ApiError.conflict(
        `This patient is already registered as ${existing.rows[0].first_name} ${existing.rows[0].last_name}. Search for them instead of registering again.`
      );
    }

    try {
      const { rows } = await db.query(
        `INSERT INTO patients
           (id_number, first_name, last_name, date_of_birth, gender, phone, email, address,
            blood_type, allergies, chronic_conditions, next_of_kin_name, next_of_kin_phone,
            medical_aid_scheme, medical_aid_number, medical_aid_plan, home_facility_id,
            consent_popia, consent_given_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE,NOW())
         RETURNING *`,
        [idNumber, b.first_name, b.last_name,
         b.date_of_birth || decoded.date_of_birth, b.gender || decoded.gender,
         b.phone || null, b.email || null, b.address || null, b.blood_type || null,
         b.allergies || null, b.chronic_conditions || null,
         b.next_of_kin_name || null, b.next_of_kin_phone || null,
         b.medical_aid_scheme || null, b.medical_aid_number || null, b.medical_aid_plan || null,
         facilityId]
      );

      const patient = rows[0];
      const folder  = await assignFolder(patient.patient_id, facilityId, b.folder_number);

      await recordAudit(req, {
        action: 'PATIENT_REGISTERED', entity: 'patients', entityId: patient.patient_id,
        detail: { facility_id: facilityId, folder_number: folder?.folder_number },
      });
      await recordPatientAccess(req, { patientId: patient.patient_id, action: 'REGISTER' });

      res.status(201).json({ patient: maskPatientForRole(patient, req.user.role), folder });
    } catch (err) {
      throw translateDbError(err) || err;
    }
  })
);

// ── PATCH /api/patients/:patient_id ────────────────────────────────────────
// Reception corrects contact details; clinicians correct clinical details.
router.patch(
  '/:patient_id',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor', 'nurse', 'receptionist'),
  [param('patient_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const { patient_id } = req.params;

    const contactFields  = ['phone', 'email', 'address', 'next_of_kin_name', 'next_of_kin_phone',
                            'medical_aid_scheme', 'medical_aid_number', 'medical_aid_plan'];
    const clinicalFields = ['blood_type', 'allergies', 'chronic_conditions'];

    const allowed = [...contactFields];
    if (CLINICAL_ROLES.includes(req.user.role)) allowed.push(...clinicalFields);
    if (isSuperAdmin(req.user) || req.user.role === 'admin') allowed.push('is_deceased');

    const updates = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    const columns = Object.keys(updates);
    if (!columns.length) {
      throw ApiError.badRequest('Nothing to update, or those fields are not yours to change.');
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const { rows } = await db.query(
      `UPDATE patients SET ${setClause} WHERE patient_id = $${columns.length + 1} RETURNING *`,
      [...columns.map((c) => updates[c]), patient_id]
    );
    if (!rows.length) throw ApiError.notFound('Patient not found.');

    await recordAudit(req, {
      action: 'PATIENT_UPDATED', entity: 'patients', entityId: patient_id,
      detail: { changed: columns },
    });

    res.json({ patient: maskPatientForRole(rows[0], req.user.role) });
  })
);

// ── POST /api/patients/:patient_id/folders ─────────────────────────────────
// Give a patient a folder number at a facility, or move them across from a
// paper system carrying their existing number.
router.post(
  '/:patient_id/folders',
  authenticate,
  allowRoles('superadmin', 'admin', 'receptionist'),
  [param('patient_id').isUUID(), body('folder_number').optional().trim()],
  validate,
  asyncHandler(async (req, res) => {
    const facilityId = req.body.facility_id || req.facilityId || req.user.facility_id;
    if (!facilityId) throw ApiError.badRequest('facility_id is required.');
    assertFacilityAccess(req.user, facilityId);

    const folder = await assignFolder(req.params.patient_id, facilityId, req.body.folder_number);
    if (!folder) throw ApiError.badRequest('Could not allocate a folder number. Please try again.');

    await recordAudit(req, {
      action: 'FOLDER_ASSIGNED', entity: 'patient_folders', entityId: folder.folder_id,
      detail: { patient_id: req.params.patient_id, facility_id: facilityId, folder_number: folder.folder_number },
    });

    res.status(201).json({ folder });
  })
);

module.exports = router;
// ── GET /api/patients/search?q= ─────────────────────────────────────────────
// Name, ID number or phone. Scoped to the facility's own patient population
// unless you are a district-level superadmin.
router.get(
  '/search',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor', 'nurse', 'pharmacist', 'receptionist'),
  [query('q').trim().isLength({ min: 2 }).withMessage('Type at least 2 characters to search.')],
  validate,
  asyncHandler(async (req, res) => {
    const term = req.query.q;
    const digits = normaliseIdNumber(term);
    const params = [`%${term}%`];
    let facilityParam = 'NULL::uuid';
    let where = `WHERE (p.last_name ILIKE $1 OR p.first_name ILIKE $1
                        OR (p.first_name || ' ' || p.last_name) ILIKE $1
                        OR p.phone ILIKE $1)`;

    if (digits.length >= 6) {
      params.push(`%${digits}%`);
      where += ` OR p.id_number LIKE $${params.length}`;
    }

    // Facility scoping: patients registered, filed or seen at this facility.
    const facilityId = isSuperAdmin(req.user) ? (req.query.facility_id || null) : req.user.facility_id;
    if (facilityId) {
      params.push(facilityId);
      facilityParam = `$${params.length}`;
      where += ` AND (p.home_facility_id = ${facilityParam}
                   OR EXISTS (SELECT 1 FROM patient_folders pf
                               WHERE pf.patient_id = p.patient_id AND pf.facility_id = ${facilityParam})
                   OR EXISTS (SELECT 1 FROM appointments a
                               WHERE a.patient_id = p.patient_id AND a.facility_id = ${facilityParam}))`;
    }

    const { rows } = await db.query(
      `SELECT p.patient_id, p.id_number, p.first_name, p.last_name, p.date_of_birth,
              p.gender, p.phone, p.blood_type, p.allergies, p.home_facility_id,
              f.name AS home_facility_name,
              (SELECT pf.folder_number FROM patient_folders pf
                WHERE pf.patient_id = p.patient_id
                  AND (${facilityParam} IS NULL OR pf.facility_id = ${facilityParam})
                LIMIT 1) AS folder_number
         FROM patients p
         LEFT JOIN facilities f ON f.facility_id = p.home_facility_id
         ${where}
        ORDER BY p.last_name, p.first_name
        LIMIT 25`,
      params
    );

    res.json({
      query: term,
      count: rows.length,
      patients: rows.map((r) => maskPatientForRole(r, req.user.role)),
    });
  })
);

// ── GET /api/patients/:patient_id ───────────────────────────────────────────
// Everything a clinician needs: record, folder numbers, complete visit history
// across facilities, and the most recent vitals.
router.get(
  '/:patient_id',
  authenticate,
  allowRoles('superadmin', 'admin', 'doctor', 'nurse', 'pharmacist', 'receptionist'),
  [param('patient_id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const { patient_id } = req.params;

    const { rows } = await db.query('SELECT * FROM patients WHERE patient_id = $1', [patient_id]);
    if (!rows.length) throw ApiError.notFound('Patient not found.');
    const full = rows[0];

    // Receptionists get contact details only — no clinical data at all.
    const isClinical = CLINICAL_ROLES.includes(req.user.role);

    const history = isClinical
      ? (await db.query(
          `SELECT * FROM v_patient_visit_history
            WHERE patient_id = $1 ORDER BY scheduled_at DESC LIMIT 100`, [patient_id])).rows
      : (await db.query(
          `SELECT appointment_id, scheduled_at, status, facility_name, facility_type,
                  department_name, provider_name
             FROM v_patient_visit_history
            WHERE patient_id = $1 ORDER BY scheduled_at DESC LIMIT 100`, [patient_id])).rows;

    const vitals = isClinical
      ? (await db.query(
          `SELECT vitals_id, appointment_id, temperature_c, bp_systolic, bp_diastolic,
                  pulse_bpm, resp_rate, spo2_percent, weight_kg, height_cm,
                  pain_score, triage, notes, recorded_at
             FROM vitals WHERE patient_id = $1
            ORDER BY recorded_at DESC LIMIT 10`, [patient_id])).rows
      : [];

    await recordPatientAccess(req, { patientId: patient_id, action: 'VIEW_FULL_RECORD' });

    res.json({
      patient: maskPatientForRole(full, req.user.role),
      consent: { popia: full.consent_popia, given_at: full.consent_given_at },
      folders: await foldersFor(patient_id),
      history,
      vitals,
      next_appointment: await nextAppointment(patient_id, req.facilityId || null),
    });
  })
);