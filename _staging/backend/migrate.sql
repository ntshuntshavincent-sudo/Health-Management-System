-- Run this file once to set up the database.
-- psql -U postgres -d patient_system -f db/migrate.sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── DOCTORS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  doctor_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(150)  NOT NULL,
  specialisation   VARCHAR(100)  NOT NULL,
  employee_number  VARCHAR(50)   UNIQUE NOT NULL,
  created_at       TIMESTAMP     DEFAULT NOW()
);

-- ─── PATIENTS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  patient_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_number     VARCHAR(13)  UNIQUE NOT NULL,   -- SA ID number (13 digits)
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  date_of_birth DATE,
  gender        VARCHAR(30),
  phone         VARCHAR(20),
  address       TEXT,
  blood_type    VARCHAR(5),
  allergies     TEXT,
  created_at    TIMESTAMP    DEFAULT NOW()
);

-- ─── APPOINTMENTS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  appointment_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID         NOT NULL REFERENCES patients(patient_id)  ON DELETE CASCADE,
  doctor_id       UUID         NOT NULL REFERENCES doctors(doctor_id)    ON DELETE RESTRICT,
  scheduled_at    TIMESTAMP    NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'scheduled'
                               CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  reason          TEXT,
  created_at      TIMESTAMP    DEFAULT NOW()
);

-- ─── VISIT NOTES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visit_notes (
  note_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID  NOT NULL REFERENCES appointments(appointment_id) ON DELETE CASCADE,
  doctor_id       UUID  NOT NULL REFERENCES doctors(doctor_id)           ON DELETE RESTRICT,
  diagnosis       TEXT,
  prescription    TEXT,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ─── USERS (staff login accounts) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       VARCHAR(80)  UNIQUE NOT NULL,
  password_hash  TEXT         NOT NULL,
  role           VARCHAR(20)  NOT NULL DEFAULT 'receptionist'
                              CHECK (role IN ('admin','doctor','receptionist')),
  linked_id      UUID,        -- points to doctors.doctor_id when role = 'doctor'
  created_at     TIMESTAMP    DEFAULT NOW()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_patients_id_number   ON patients(id_number);
CREATE INDEX IF NOT EXISTS idx_appointments_patient  ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor   ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date     ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_visit_notes_appt      ON visit_notes(appointment_id);
