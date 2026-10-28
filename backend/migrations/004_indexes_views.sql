-- ═════════════════════════════════════════════════════════════════════════════
-- HealthRecord — 004 Indexes and reporting views
-- ═══════════════════════════════════════════════════════════════════════════

-- ─ Indexes: sized for the queries the UI actually runs ─────────────────────
CREATE INDEX IF NOT EXISTS idx_facilities_district      ON facilities(district);
CREATE INDEX IF NOT EXISTS idx_facilities_type          ON facilities(type);
CREATE INDEX IF NOT EXISTS idx_departments_facility     ON departments(facility_id);

CREATE INDEX IF NOT EXISTS idx_users_facility           ON users(facility_id);
CREATE INDEX IF NOT EXISTS idx_users_role               ON users(role);

CREATE INDEX IF NOT EXISTS idx_providers_facility       ON providers(facility_id);
CREATE INDEX IF NOT EXISTS idx_providers_department     ON providers(department_id);
CREATE INDEX IF NOT EXISTS idx_providers_active         ON providers(facility_id, is_active);

-- Kiosk lookup and name search.
CREATE INDEX IF NOT EXISTS idx_patients_id_number       ON patients(id_number);
CREATE INDEX IF NOT EXISTS idx_patients_name            ON patients(lower(last_name), lower(first_name));
CREATE INDEX IF NOT EXISTS idx_patients_phone           ON patients(phone);

CREATE INDEX IF NOT EXISTS idx_folders_patient          ON patient_folders(patient_id);
CREATE INDEX IF NOT EXISTS idx_folders_facility         ON patient_folders(facility_id);

CREATE INDEX IF NOT EXISTS idx_appt_patient             ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_provider            ON appointments(provider_id);
CREATE INDEX IF NOT EXISTS idx_appt_department          ON appointments(department_id);
-- The busiest query in the system: "today's list for this facility".
CREATE INDEX IF NOT EXISTS idx_appt_facility_day        ON appointments(facility_id, scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_appt_scheduled_at        ON appointments(scheduled_at);

CREATE INDEX IF NOT EXISTS idx_notes_appointment        ON visit_notes(appointment_id);
CREATE INDEX IF NOT EXISTS idx_notes_patient            ON visit_notes(patient_id);
CREATE INDEX IF NOT EXISTS idx_notes_facility           ON visit_notes(facility_id);

CREATE INDEX IF NOT EXISTS idx_vitals_appointment       ON vitals(appointment_id);
CREATE INDEX IF NOT EXISTS idx_vitals_patient           ON vitals(patient_id);

CREATE INDEX IF NOT EXISTS idx_audit_created            ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user               ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_facility           ON audit_log(facility_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action             ON audit_log(action);

CREATE INDEX IF NOT EXISTS idx_access_patient           ON data_access_log(patient_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_user              ON data_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_access_facility          ON data_access_log(facility_id, accessed_at DESC);

-- ── VIEW: today's waiting room / live queue ─────────────────────────────────
-- Powers the nurse and doctor dashboards: who is physically waiting right now.
CREATE OR REPLACE VIEW v_waiting_room AS
SELECT
  a.appointment_id,
  a.facility_id,
  f.name          AS facility_name,
  a.department_id,
  d.name          AS department_name,
  a.patient_id,
  p.id_number,
  p.first_name || ' ' || p.last_name AS patient_name,
  p.date_of_birth,
  EXTRACT(YEAR FROM AGE(p.date_of_birth))::INT AS age,
  p.blood_type,
  p.allergies,
  a.provider_id,
  pr.name         AS provider_name,
  a.scheduled_at,
  a.status,
  a.priority,
  a.reason,
  a.checked_in_at,
  CASE WHEN a.checked_in_at IS NOT NULL
       THEN EXTRACT(EPOCH FROM (a.checked_in_at - a.scheduled_at)) / 60
  END AS minutes_late
FROM appointments a
JOIN patients       p  ON p.patient_id     = a.patient_id
JOIN facilities     f  ON f.facility_id    = a.facility_id
JOIN providers      pr ON pr.provider_id   = a.provider_id
LEFT JOIN departments d ON d.department_id = a.department_id
WHERE a.status IN ('scheduled', 'checked_in', 'in_progress')
  AND a.scheduled_at::date <= CURRENT_DATE;
-- ── VIEW: daily throughput per facility ────────────────────────────────────
-- The number the clinic manager and the district office both ask for.
CREATE OR REPLACE VIEW v_facility_daily_activity AS
SELECT
  a.facility_id,
  f.name               AS facility_name,
  f.type               AS facility_type,
  a.scheduled_at::date AS activity_date,
  COUNT(*)                                         AS booked,
  COUNT(*) FILTER (WHERE a.status = 'completed')   AS completed,
  COUNT(*) FILTER (WHERE a.status = 'checked_in')  AS waiting,
  COUNT(*) FILTER (WHERE a.status = 'in_progress') AS in_progress,
  COUNT(*) FILTER (WHERE a.status = 'cancelled')   AS cancelled,
  COUNT(*) FILTER (WHERE a.status = 'no_show')     AS no_show,
  COUNT(DISTINCT a.patient_id)                     AS unique_patients,
  ROUND(AVG(CASE WHEN a.checked_in_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (a.checked_in_at - a.scheduled_at)) / 60 END)::numeric, 1)
                                                   AS avg_minutes_late,
  ROUND(AVG(CASE WHEN a.completed_at IS NOT NULL AND a.checked_in_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (a.completed_at - a.checked_in_at)) / 60 END)::numeric, 1)
                                                   AS avg_consult_minutes
FROM appointments a
JOIN facilities f ON f.facility_id = a.facility_id
GROUP BY a.facility_id, f.name, f.type, a.scheduled_at::date;

-- ── VIEW: cross-facility visit history (continuity of care) ────────────────
-- Deliberately not facility-filtered: this is the view that lets a patient's
-- history follow them from a clinic to a district hospital.
CREATE OR REPLACE VIEW v_patient_visit_history AS
SELECT
  a.patient_id,
  a.appointment_id,
  a.scheduled_at,
  a.status,
  a.facility_id,
  f.name  AS facility_name,
  f.type  AS facility_type,
  a.department_id,
  d.name  AS department_name,
  pr.name AS provider_name,
  pr.specialisation,
  n.note_id,
  n.diagnosis,
  n.prescription,
  n.follow_up_date,
  n.created_at AS note_created_at
FROM appointments a
JOIN facilities  f  ON f.facility_id  = a.facility_id
JOIN providers   pr ON pr.provider_id = a.provider_id
LEFT JOIN departments d ON d.department_id = a.department_id
LEFT JOIN visit_notes n ON n.appointment_id = a.appointment_id;