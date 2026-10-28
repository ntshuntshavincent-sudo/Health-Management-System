#!/usr/bin/env node
/**
 * SEED / BOOTSTRAP
 * ────────────────
 * Creates the very first login account, because a system with no admin account
 * can never be configured from the UI.
 *
 *   npm run seed             → superadmin account only (safe for production)
 *   npm run seed -- --demo   → also adds a sample clinic + district hospital,
 *                              departments, staff, patients and today's
 *                              appointments (never run on live data)
 *
 * Credentials come from backend/.env (SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD).
 */

const bcrypt = require('bcryptjs');
const config = require('../config');
const db     = require('./pool');
const { luhnCheckDigit } = require('../utils/saId');

const DEMO = process.argv.includes('--demo');

/** Build a Luhn-valid 13-digit SA ID from a real date of birth. */
function buildIdNumber(dobISO, sequence, citizenship = 0) {
  const [year, month, day] = dobISO.split('-');
  const base = `${year.slice(2)}${month}${day}${String(sequence).padStart(4, '0')}${citizenship}8`;
  return base + luhnCheckDigit(base);   // base is 12 digits; append the check digit
}

async function upsertFacility(f) {
  const { rows } = await db.query(
    `INSERT INTO facilities (code, name, type, level, district, province, address, phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING facility_id`,
    [f.code, f.name, f.type, f.level, f.district, f.province, f.address, f.phone]
  );
  return rows[0].facility_id;
}

async function upsertDepartment(facilityId, d) {
  const { rows } = await db.query(
    `INSERT INTO departments (facility_id, code, name, type, room)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (facility_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING department_id`,
    [facilityId, d.code, d.name, d.type, d.room || null]
  );
  return rows[0].department_id;
}

async function upsertProvider(facilityId, departmentId, p) {
  const { rows } = await db.query(
    `INSERT INTO providers (facility_id, department_id, name, role, specialisation,
                            registration_number, employee_number, phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (facility_id, employee_number) DO UPDATE SET name = EXCLUDED.name
     RETURNING provider_id`,
    [facilityId, departmentId, p.name, p.role, p.specialisation || null,
     p.registration || null, p.employeeNumber, p.phone || null]
  );
  return rows[0].provider_id;
}

async function upsertPatient(p) {
  const idNumber = buildIdNumber(p.dob, p.sequence, p.citizenship ?? 0);
  const { rows } = await db.query(
    `INSERT INTO patients (id_number, first_name, last_name, date_of_birth, gender,
                           phone, address, blood_type, allergies, chronic_conditions,
                           next_of_kin_name, next_of_kin_phone, home_facility_id,
                           consent_popia, consent_given_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,NOW())
async function main() {
  console.log(`\nHealthRecord seed  →  ${config.db.database}@${config.db.host}:${config.db.port}\n`);

  // ── 1. The superadmin account ──────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(config.seed.password, config.bcryptRounds);

  const existing = await db.query('SELECT user_id FROM users WHERE username = $1', [config.seed.username]);
  if (existing.rows.length) {
    console.log(`   superadmin '${config.seed.username}' already exists — left untouched.`);
  } else {
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, facility_id, must_change_password)
       VALUES ($1,$2,$3,'superadmin',NULL,TRUE)`,
      [config.seed.username, passwordHash, config.seed.fullName]
    );
    console.log(`   created superadmin '${config.seed.username}' (must change password at first login)`);
  }

  if (!DEMO) {
    console.log('\nDone. Start the API with: npm run dev\n');
    return;
  }

  // ── 2. A clinic and a district hospital ────────────────────────────────────
  const clinicId = await upsertFacility({
    code: 'MP-EHL-001', name: 'Themba Community Clinic', type: 'clinic', level: 1,
    district: 'Ehlanzeni', province: 'Mpumalanga',
    address: '123 Main St, Mbombela, 1200', phone: '013 755 1000',
  });
  const hospitalId = await upsertFacility({
    code: 'MP-EHL-002', name: 'Themba District Hospital', type: 'district_hospital', level: 2,
    district: 'Ehlanzeni', province: 'Mpumalanga',
    address: '1 Hospital Rd, Mbombela, 1200', phone: '013 755 2000',
  });
  console.log('   facilities: Themba Community Clinic, Themba District Hospital');
  // ── 5. Logins for each role (all use the seed password) ───────────────────
  const demoUsers = [
    ['clinic.admin',   'admin',        clinicId,   null,        'Ms Thandi Mokoena (Clinic Manager)'],
    ['hospital.admin', 'admin',        hospitalId, null,        'Mr Sipho Dlamini (Hospital Manager)'],
    ['doctor.naidoo',  'doctor',       clinicId,   drNaidoo,    'Dr Priya Naidoo'],
    ['doctor.sithole', 'doctor',       hospitalId, drSithole,   'Dr James Sithole'],
    ['nurse.khumalo',  'nurse',        hospitalId, srKhumalo,   'Sr Nomsa Khumalo'],
    ['reception1',     'receptionist', clinicId,   null,        'Front Desk — Clinic'],
  ];
  for (const [username, role, facilityId, providerId, fullName] of demoUsers) {
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, facility_id, provider_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (username) DO NOTHING`,
      [username, passwordHash, fullName, role, facilityId, providerId]
    );
  }
  console.log(`   logins: ${demoUsers.map((u) => u[0]).join(', ')}`);
  console.log(`   password for every demo login: ${config.seed.password}`);

  // ── 6. Demo patients ──────────────────────────────────────────────────────
  const patients = [
    { first: 'Nomsa',  last: 'Khumalo', dob: '1980-01-01', sequence: 5009, gender: 'Female',
      phone: '072 345 6789', bloodType: 'B+', allergies: 'Penicillin', chronic: 'Hypertension',
      kin: 'Sipho Khumalo', kinPhone: '072 345 6790', homeFacilityId: clinicId },
    { first: 'Sipho',  last: 'Mokoena', dob: '1992-03-20', sequence: 4800, gender: 'Male',
      phone: '083 111 2233', bloodType: 'O+', allergies: 'None', chronic: null,
      kin: 'Lerato Mokoena', kinPhone: '083 111 2244', homeFacilityId: clinicId },
    { first: 'Lerato', last: 'Ndlovu',  dob: '2001-07-14', sequence: 4321, gender: 'Female',
      phone: '076 999 8877', bloodType: 'A-', allergies: 'Peanuts', chronic: 'Asthma',
      kin: 'Grace Ndlovu', kinPhone: '076 999 8878', homeFacilityId: hospitalId },
  ];

  const saved = [];
  for (const p of patients) {
    saved.push(await upsertPatient(p));
  }
  console.log(`   patients: ${patients.map((p) => `${p.first} ${p.last}`).join(', ')}`);
  console.log(`   sample ID for the kiosk: ${saved[0].id_number}`);

  // ── 7. Folder numbers (the paper folder, replaced) ────────────────────────
  await db.query(
    `INSERT INTO patient_folders (patient_id, facility_id, folder_number)
     VALUES ($1,$2,'CL-0001') ON CONFLICT DO NOTHING`,
    [saved[0].patient_id, clinicId]
  );
  await db.query(
    `INSERT INTO patient_folders (patient_id, facility_id, folder_number)
     VALUES ($1,$2,'HOSP-0001') ON CONFLICT DO NOTHING`,
    [saved[2].patient_id, hospitalId]
  );

  // ── 8. Today's appointments, including one already checked in ─────────────
  const appointments = [
    { patient: saved[0].patient_id, provider: drNaidoo,  facility: clinicId,   dept: clinicOpd, hour: 9,  status: 'scheduled',  reason: 'Blood pressure follow-up' },
    { patient: saved[1].patient_id, provider: drNaidoo,  facility: clinicId,   dept: clinicChr, hour: 10, status: 'checked_in', reason: 'Chronic medication collection' },
    { patient: saved[2].patient_id, provider: drSithole, facility: hospitalId, dept: hospOpd,   hour: 11, status: 'scheduled',  reason: 'Asthma review' },
    { patient: saved[2].patient_id, provider: srKhumalo, facility: hospitalId, dept: hospCas,   hour: 8,  status: 'completed',  reason: 'Wheeze — triage', priority: 'urgent' },
  ];

  for (const a of appointments) {
    const existingAppt = await db.query(
      `SELECT appointment_id FROM appointments
       WHERE patient_id = $1 AND provider_id = $2 AND scheduled_at::date = CURRENT_DATE`,
      [a.patient, a.provider]
    );
    if (existingAppt.rows.length) continue;

    await db.query(
      `INSERT INTO appointments
         (patient_id, provider_id, facility_id, department_id, scheduled_at,
          status, priority, reason, checked_in_at, completed_at)
       VALUES ($1,$2,$3,$4,
               (CURRENT_DATE + ($5 || ' hours')::interval),
               $6,$7,$8,
               CASE WHEN $6 IN ('checked_in','completed') THEN NOW() END,
               CASE WHEN $6 = 'completed'                THEN NOW() END)`,
      [a.patient, a.provider, a.facility, a.dept, String(a.hour),
       a.status, a.priority || 'routine', a.reason]
    );
  }

  const count = await db.query('SELECT COUNT(*)::int AS n FROM appointments WHERE scheduled_at::date = CURRENT_DATE');
  console.log(`   appointments today: ${count.rows[0].n}`);

  console.log('\nDemo data ready.');
  console.log(`   superadmin   : ${config.seed.username} / ${config.seed.password}`);
  console.log(`   clinic admin : clinic.admin / ${config.seed.password}`);
  console.log(`   doctor       : doctor.naidoo / ${config.seed.password}`);
  console.log(`   receptionist : reception1 / ${config.seed.password}`);
  console.log('\nChange every one of these passwords before any real patient data is loaded.\n');
}

main()
  .then(async () => { await db.close(); process.exit(0); })
  .catch(async (err) => {
    console.error('\n✖ Seed failed:', err.message);
    if (err.code === '42P01') console.error('  Tables missing — run `npm run migrate` first.');
    if (err.code === '28P01') console.error('  Wrong DB_PASSWORD in backend/.env');
    console.error('');
    await db.close().catch(() => {});
    process.exit(1);
  });

  // ── 3. Departments ─────────────────────────────────────────────────────────
  const clinicOpd = await upsertDepartment(clinicId,  { code: 'OPD',  name: 'Outpatients',    type: 'opd',         room: 'A1' });
  const clinicChr = await upsertDepartment(clinicId,  { code: 'CHR',  name: 'Chronic Care',   type: 'chronic',     room: 'A2' });
  const hospOpd   = await upsertDepartment(hospitalId, { code: 'OPD',  name: 'Outpatients',   type: 'opd',         room: 'B1' });
  const hospCas   = await upsertDepartment(hospitalId, { code: 'CAS',  name: 'Casualty',      type: 'casualty',    room: 'G1' });
  const hospMat   = await upsertDepartment(hospitalId, { code: 'MAT',  name: 'Maternity',     type: 'maternity',   room: 'W2' });
  const hospPaed  = await upsertDepartment(hospitalId, { code: 'PAED', name: 'Paediatrics',   type: 'paediatrics', room: 'W3' });
  console.log('   departments: clinic OPD/Chronic · hospital OPD/Casualty/Maternity/Paediatrics');

  // ── 4. Clinical staff ─────────────────────────────────────────────────────
  const drNaidoo = await upsertProvider(clinicId, clinicOpd, {
    name: 'Dr Priya Naidoo', role: 'doctor', specialisation: 'General Practitioner',
    employeeNumber: 'EMP-001', registration: 'MP0123456',
  });
  const drSithole = await upsertProvider(hospitalId, hospOpd, {
    name: 'Dr James Sithole', role: 'specialist', specialisation: 'Internal Medicine',
    employeeNumber: 'EMP-002', registration: 'MP0234567',
  });
  const srKhumalo = await upsertProvider(hospitalId, hospCas, {
    name: 'Sr Nomsa Khumalo', role: 'nurse', specialisation: 'Emergency Nursing',
    employeeNumber: 'EMP-003', registration: 'SANC-99887',
  });
  console.log('   providers: 1 doctor, 1 specialist, 1 nurse');
     ON CONFLICT (id_number) DO UPDATE SET first_name = EXCLUDED.first_name
     RETURNING patient_id, id_number`,
    [idNumber, p.first, p.last, p.dob, p.gender, p.phone || null, p.address || null,
     p.bloodType || null, p.allergies || null, p.chronic || null,
     p.kin || null, p.kinPhone || null, p.homeFacilityId || null]
  );
  return rows[0];
}