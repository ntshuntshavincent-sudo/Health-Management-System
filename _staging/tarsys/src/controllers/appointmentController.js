const pool         = require('../db/pool');
const { auditLog } = require('../middleware/audit');

// ─────────────────────────────────────────
// POST /api/appointments
// Book an appointment — receptionist or admin
// Body: { patient_id, doctor_id, scheduled_at, reason }
// ─────────────────────────────────────────
async function bookAppointment(req, res) {
  const { patient_id, doctor_id, scheduled_at, reason } = req.body;

  if (!patient_id || !doctor_id || !scheduled_at) {
    return res.status(400).json({ error: 'patient_id, doctor_id, and scheduled_at are required.' });
  }

  try {
    // Check that the slot is not already taken for that doctor
    const conflict = await pool.query(
      `SELECT appointment_id FROM appointments
       WHERE doctor_id = $1
         AND scheduled_at = $2
         AND status = 'scheduled'`,
      [doctor_id, scheduled_at]
    );

    if (conflict.rows.length > 0) {
      return res.status(409).json({ error: 'That time slot is already booked for this doctor.' });
    }

    const result = await pool.query(
      `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [patient_id, doctor_id, scheduled_at, reason || null]
    );

    await auditLog(req.user.user_id, 'BOOK_APPOINTMENT', 'appointments', result.rows[0].appointment_id, req.ip);

    res.status(201).json({
      message: 'Appointment booked successfully.',
      appointment: result.rows[0],
    });

  } catch (err) {
    console.error('Book appointment error:', err.message);
    res.status(500).json({ error: 'Server error booking appointment.' });
  }
}

// ─────────────────────────────────────────
// GET /api/appointments/today
// Today's appointment schedule — for the front desk
// ─────────────────────────────────────────
async function getTodayAppointments(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         a.appointment_id, a.scheduled_at, a.status, a.reason,
         p.first_name, p.last_name, p.id_number, p.phone,
         d.name AS doctor_name, d.specialisation
       FROM appointments a
       JOIN patients p ON a.patient_id  = p.patient_id
       JOIN doctors  d ON a.doctor_id   = d.doctor_id
       WHERE DATE(a.scheduled_at) = CURRENT_DATE
       ORDER BY a.scheduled_at ASC`
    );

    res.json({ date: new Date().toDateString(), appointments: result.rows });

  } catch (err) {
    console.error('Today appointments error:', err.message);
    res.status(500).json({ error: 'Server error fetching today\'s appointments.' });
  }
}

// ─────────────────────────────────────────
// PATCH /api/appointments/:appointment_id/status
// Update status: completed, cancelled, no_show
// Body: { status }
// ─────────────────────────────────────────
async function updateAppointmentStatus(req, res) {
  const { appointment_id } = req.params;
  const { status }         = req.body;

  const validStatuses = ['scheduled', 'completed', 'cancelled', 'no_show'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}.` });
  }

  try {
    const result = await pool.query(
      `UPDATE appointments SET status = $1
       WHERE appointment_id = $2
       RETURNING *`,
      [status, appointment_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    await auditLog(req.user.user_id, `APPOINTMENT_${status.toUpperCase()}`, 'appointments', appointment_id, req.ip);

    res.json({ message: `Appointment marked as ${status}.`, appointment: result.rows[0] });

  } catch (err) {
    console.error('Update status error:', err.message);
    res.status(500).json({ error: 'Server error updating appointment status.' });
  }
}

module.exports = { bookAppointment, getTodayAppointments, updateAppointmentStatus };
