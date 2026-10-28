const pool       = require('../db/pool');
const { auditLog } = require('../middleware/audit');

// ─────────────────────────────────────────
// GET /api/patients?id_number=XXXXXXXXXXXXX
// The kiosk lookup — finds a patient by ID number
// Public endpoint (no login needed for the kiosk)
// ─────────────────────────────────────────
async function lookupByIdNumber(req, res) {
  const { id_number } = req.query;

  if (!id_number) {
    return res.status(400).json({ error: 'id_number query parameter is required.' });
  }

  if (id_number.length !== 13 || !/^\d{13}$/.test(id_number)) {
    return res.status(400).json({ error: 'ID number must be exactly 13 digits.' });
  }

  try {
    const patientResult = await pool.query(
      `SELECT
         patient_id, id_number, first_name, last_name,
         date_of_birth, gender, phone, blood_type, allergies
       FROM patients
       WHERE id_number = $1`,
      [id_number]
    );

    if (patientResult.rows.length === 0) {
      return res.status(404).json({ error: 'No patient found with that ID number.' });
    }

    const patient = patientResult.rows[0];

    // Fetch their next upcoming appointment
    const apptResult = await pool.query(
      `SELECT a.scheduled_at, a.reason, d.name AS doctor_name
       FROM appointments a
       JOIN doctors d ON a.doctor_id = d.doctor_id
       WHERE a.patient_id = $1
         AND a.scheduled_at >= NOW()
         AND a.status = 'scheduled'
       ORDER BY a.scheduled_at ASC
       LIMIT 1`,
      [patient.patient_id]
    );

    const nextAppointment = apptResult.rows[0] || null;

    // Log this kiosk access (POPIA compliance)
    await auditLog(null, 'KIOSK_LOOKUP', 'patients', patient.patient_id, req.ip);

    res.json({
      patient,
      next_appointment: nextAppointment,
    });

  } catch (err) {
    console.error('Lookup error:', err.message);
    res.status(500).json({ error: 'Server error during patient lookup.' });
  }
}

// ─────────────────────────────────────────
// POST /api/patients
// Register a new patient
// Requires: receptionist or admin role
// ─────────────────────────────────────────
async function registerPatient(req, res) {
  const {
    id_number, first_name, last_name,
    date_of_birth, gender, phone,
    address, blood_type, allergies
  } = req.body;

  // Validate required fields
  if (!id_number || !first_name || !last_name) {
    return res.status(400).json({
      error: 'id_number, first_name, and last_name are required.'
    });
  }

  if (!/^\d{13}$/.test(id_number)) {
    return res.status(400).json({ error: 'ID number must be exactly 13 digits.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO patients
         (id_number, first_name, last_name, date_of_birth, gender, phone, address, blood_type, allergies)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id_number, first_name, last_name, date_of_birth || null,
       gender || null, phone || null, address || null,
       blood_type || null, allergies || null]
    );

    await auditLog(req.user.user_id, 'REGISTER_PATIENT', 'patients', result.rows[0].patient_id, req.ip);

    res.status(201).json({
      message: 'Patient registered successfully.',
      patient: result.rows[0],
    });

  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A patient with that ID number already exists.' });
    }
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Server error during registration.' });
  }
}

// ─────────────────────────────────────────
// GET /api/patients/:patient_id
// Full patient record — for doctors/admin only
// ─────────────────────────────────────────
async function getPatientById(req, res) {
  const { patient_id } = req.params;

  try {
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE patient_id = $1',
      [patient_id]
    );

    if (patientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    const patient = patientResult.rows[0];

    // Fetch full appointment history with visit notes
    const historyResult = await pool.query(
      `SELECT
         a.appointment_id, a.scheduled_at, a.status, a.reason,
         d.name AS doctor_name, d.specialisation,
         vn.diagnosis, vn.prescription, vn.notes AS visit_notes
       FROM appointments a
       JOIN doctors d ON a.doctor_id = d.doctor_id
       LEFT JOIN visit_notes vn ON vn.appointment_id = a.appointment_id
       WHERE a.patient_id = $1
       ORDER BY a.scheduled_at DESC`,
      [patient_id]
    );

    await auditLog(req.user.user_id, 'VIEW_PATIENT', 'patients', patient_id, req.ip);

    res.json({
      patient,
      appointment_history: historyResult.rows,
    });

  } catch (err) {
    console.error('Get patient error:', err.message);
    res.status(500).json({ error: 'Server error fetching patient record.' });
  }
}

// ─────────────────────────────────────────
// PUT /api/patients/:patient_id
// Update patient details — receptionist or admin
// ─────────────────────────────────────────
async function updatePatient(req, res) {
  const { patient_id } = req.params;
  const { first_name, last_name, date_of_birth, gender, phone, address, blood_type, allergies } = req.body;

  try {
    const result = await pool.query(
      `UPDATE patients SET
         first_name    = COALESCE($1, first_name),
         last_name     = COALESCE($2, last_name),
         date_of_birth = COALESCE($3, date_of_birth),
         gender        = COALESCE($4, gender),
         phone         = COALESCE($5, phone),
         address       = COALESCE($6, address),
         blood_type    = COALESCE($7, blood_type),
         allergies     = COALESCE($8, allergies)
       WHERE patient_id = $9
       RETURNING *`,
      [first_name, last_name, date_of_birth, gender, phone, address, blood_type, allergies, patient_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    await auditLog(req.user.user_id, 'UPDATE_PATIENT', 'patients', patient_id, req.ip);

    res.json({ message: 'Patient updated.', patient: result.rows[0] });

  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).json({ error: 'Server error updating patient.' });
  }
}

// ─────────────────────────────────────────
// GET /api/patients/search?q=nomsa
// Search patients by name — staff only
// ─────────────────────────────────────────
async function searchPatients(req, res) {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
  }

  try {
    const result = await pool.query(
      `SELECT patient_id, id_number, first_name, last_name, date_of_birth, phone
       FROM patients
       WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR id_number LIKE $1
       ORDER BY last_name, first_name
       LIMIT 20`,
      [`%${q.trim()}%`]
    );

    res.json({ results: result.rows, count: result.rows.length });

  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Server error during search.' });
  }
}

module.exports = {
  lookupByIdNumber,
  registerPatient,
  getPatientById,
  updatePatient,
  searchPatients,
};
