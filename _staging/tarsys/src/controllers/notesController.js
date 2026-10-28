const pool         = require('../db/pool');
const { auditLog } = require('../middleware/audit');

// ─────────────────────────────────────────
// POST /api/notes
// Doctor writes visit notes after seeing a patient
// Body: { appointment_id, diagnosis, prescription, notes }
// ─────────────────────────────────────────
async function createNote(req, res) {
  const { appointment_id, diagnosis, prescription, notes } = req.body;

  if (!appointment_id) {
    return res.status(400).json({ error: 'appointment_id is required.' });
  }

  try {
    // Confirm the appointment exists and belongs to this doctor (if role is 'doctor')
    const appt = await pool.query(
      'SELECT * FROM appointments WHERE appointment_id = $1',
      [appointment_id]
    );

    if (appt.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    // Doctors can only write notes for their own appointments
    if (req.user.role === 'doctor' && appt.rows[0].doctor_id !== req.user.linked_id) {
      return res.status(403).json({ error: 'You can only write notes for your own appointments.' });
    }

    const result = await pool.query(
      `INSERT INTO visit_notes (appointment_id, doctor_id, diagnosis, prescription, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [appointment_id, appt.rows[0].doctor_id, diagnosis || null, prescription || null, notes || null]
    );

    // Mark appointment as completed automatically
    await pool.query(
      `UPDATE appointments SET status = 'completed' WHERE appointment_id = $1`,
      [appointment_id]
    );

    await auditLog(req.user.user_id, 'WRITE_VISIT_NOTE', 'visit_notes', result.rows[0].note_id, req.ip);

    res.status(201).json({
      message: 'Visit notes saved. Appointment marked as completed.',
      note: result.rows[0],
    });

  } catch (err) {
    console.error('Create note error:', err.message);
    res.status(500).json({ error: 'Server error saving visit notes.' });
  }
}

// ─────────────────────────────────────────
// GET /api/notes/patient/:patient_id
// Full visit history for a patient
// ─────────────────────────────────────────
async function getPatientNotes(req, res) {
  const { patient_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         vn.note_id, vn.diagnosis, vn.prescription, vn.notes, vn.created_at,
         d.name AS doctor_name, d.specialisation,
         a.scheduled_at, a.reason
       FROM visit_notes vn
       JOIN appointments a ON vn.appointment_id = a.appointment_id
       JOIN doctors      d ON vn.doctor_id      = d.doctor_id
       WHERE a.patient_id = $1
       ORDER BY vn.created_at DESC`,
      [patient_id]
    );

    await auditLog(req.user.user_id, 'VIEW_VISIT_NOTES', 'visit_notes', patient_id, req.ip);

    res.json({ visit_history: result.rows });

  } catch (err) {
    console.error('Get notes error:', err.message);
    res.status(500).json({ error: 'Server error fetching visit notes.' });
  }
}

module.exports = { createNote, getPatientNotes };
