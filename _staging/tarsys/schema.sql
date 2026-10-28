-- Run this file once in PostgreSQL to create your database schema
-- psql -U postgres -d patient_system -f schema.sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- DOCTORS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  doctor_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(150) NOT NULL,
  specialisation   VARCHAR(100),
  employee_number  VARCHAR(50) UNIQUE NOT NULL,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PATIENTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  patient_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_number      VARCHAR(13) UNIQUE NOT NULL,
  first_name     VARCHAR(100) NOT NULL,
  last_name      VARCHAR(100) NOT NULL,
  date_of_birth  DATE,
  gender         VARCHAR(30),
  phone          VARCHAR(20),
  address        TEXT,
  blood_type     VARCHAR(5),
  allergies      TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- APPOINTMENTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  appointment_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  doctor_id       UUID NOT NULL REFERENCES doctors(doctor_id),
  scheduled_at    TIMESTAMP NOT NULL,
  status          VARCHAR(20) DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  reason          TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- VISIT NOTES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visit_notes (
  note_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID NOT NULL REFERENCES appointments(appointment_id) ON DELETE CASCADE,
  doctor_id       UUID NOT NULL REFERENCES doctors(doctor_id),
  diagnosis       TEXT,
  prescription    TEXT,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- USERS (staff logins)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       VARCHAR(100) UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           VARCHAR(20) DEFAULT 'receptionist'
                 CHECK (role IN ('admin', 'doctor', 'receptionist')),
  linked_id      UUID,   -- links to doctor_id if role = 'doctor'
  created_at     TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- AUDIT LOG (tracks who accessed which record)
-- Required for POPIA compliance
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  log_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(user_id),
  action      VARCHAR(50) NOT NULL,
  table_name  VARCHAR(50),
  record_id   UUID,
  ip_address  VARCHAR(45),
  accessed_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- INDEXES for fast lookups
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_patients_id_number   ON patients(id_number);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor  ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date    ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_visit_notes_appt     ON visit_notes(appointment_id);

-- ─────────────────────────────────────────
-- SAMPLE DATA (for testing)
-- ─────────────────────────────────────────
INSERT INTO doctors (name, specialisation, employee_number) VALUES
  ('Dr Priya Naidoo',   'General Practice', 'EMP-001'),
  ('Dr James Sithole',  'Cardiology',       'EMP-002')
ON CONFLICT DO NOTHING;

INSERT INTO patients (id_number, first_name, last_name, date_of_birth, gender, phone, blood_type, allergies) VALUES
  ('8001015009087', 'Nomsa',  'Khumalo', '1980-01-01', 'Female', '072 345 6789', 'B+', 'Penicillin'),
  ('9203204800083', 'Sipho',  'Mokoena', '1992-03-20', 'Male',   '083 111 2233', 'O+', 'None')
ON CONFLICT DO NOTHING;
