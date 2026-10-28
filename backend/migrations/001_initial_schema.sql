-- ═════════════════════════════════════════════════════════════════════════════
-- HealthRecord — 001 Initial Schema
-- Digital patient management for South African clinics AND hospitals.
--
-- Design decisions worth knowing:
--   • A patient exists ONCE nationally, keyed by SA ID number, so records
--     follow the patient between facilities (continuity of care). Each facility
--     still assigns its own paper-style folder number via patient_folders.
--   • Every clinical row carries facility_id, so a clinic can never read another
--     facility's data — enforced by middleware, and reinforced by these FKs.
--   • Audit and access logs deliberately have NO foreign key to patients, so the
--     POPIA trail survives even if a record is lawfully deleted.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ── FACILITIES ──────────────────────────────────────────────────────────────
-- One row per clinic, community health centre or hospital.
CREATE TABLE IF NOT EXISTS facilities (
  facility_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(30)  NOT NULL UNIQUE,        -- e.g. MP-EHL-001
  name            VARCHAR(150) NOT NULL,
  type            VARCHAR(30)  NOT NULL
                  CHECK (type IN ('clinic', 'chc', 'district_hospital', 'regional_hospital',
                                  'tertiary_hospital', 'private_hospital', 'private_practice')),
  level           SMALLINT     CHECK (level BETWEEN 1 AND 4),  -- DoH level 1-4
  district        VARCHAR(100),
  province        VARCHAR(100),
  address         TEXT,
  phone           VARCHAR(20),
  email           VARCHAR(150),
  operating_hours VARCHAR(120),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── DEPARTMENTS ────────────────────────────────────────────────────────────
-- OPD, casualty, maternity, wards … Clinics typically have one or two,
-- hospitals have many. Appointments and notes are filed against a department.
CREATE TABLE IF NOT EXISTS departments (
  department_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   UUID NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  code          VARCHAR(30)  NOT NULL,
  name          VARCHAR(120) NOT NULL,
  type          VARCHAR(30)  NOT NULL
                CHECK (type IN ('opd', 'casualty', 'maternity', 'paediatrics', 'pharmacy',
                                'laboratory', 'radiology', 'ward', 'dental', 'mental_health',
                                'hiv_tb', 'chronic', 'admin', 'other')),
  room          VARCHAR(40),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (facility_id, code)
);

-- ─── USERS (staff logins) ────────────────────────────────────────────────────
-- superadmin  = district / provincial / DoH oversight, sees all facilities
-- admin       = facility manager, manages that facility only
-- doctor/nurse/pharmacist = clinical staff, linked to a providers row
-- receptionist = front desk, contact details only (no clinical data)
CREATE TABLE IF NOT EXISTS users (
  user_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username              VARCHAR(80)  NOT NULL UNIQUE,
  password_hash         TEXT         NOT NULL,
  full_name             VARCHAR(150),
  email                 VARCHAR(150),
  role                  VARCHAR(20)  NOT NULL DEFAULT 'receptionist'
                        CHECK (role IN ('superadmin', 'admin', 'doctor', 'nurse',
                                        'pharmacist', 'receptionist')),
  facility_id           UUID REFERENCES facilities(facility_id) ON DELETE SET NULL,
  provider_id           UUID,                       -- FK added after providers exists
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_attempts SMALLINT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PROVIDERS (doctors, specialists, nurses, pharmacists) ───────────────────
-- Previously a "doctors" table. Hospitals book patients with nurses and
-- clinical associates too, so the roster covers all clinical staff.
CREATE TABLE IF NOT EXISTS providers (
  provider_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id         UUID NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  department_id       UUID REFERENCES departments(department_id) ON DELETE SET NULL,
  name                VARCHAR(150) NOT NULL,
  role                VARCHAR(20)  NOT NULL DEFAULT 'doctor'
                      CHECK (role IN ('doctor', 'specialist', 'nurse',
                                      'clinical_associate', 'pharmacist')),
  specialisation      VARCHAR(100),
  registration_number VARCHAR(50),          -- HPCSA / SANC registration
  employee_number     VARCHAR(50)  NOT NULL,
  phone               VARCHAR(20),
  email               VARCHAR(150),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Employee numbers are unique per facility, not nationally.
  UNIQUE (facility_id, employee_number)
);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS fk_users_provider;
ALTER TABLE users
  ADD CONSTRAINT fk_users_provider
  FOREIGN KEY (provider_id) REFERENCES providers(provider_id) ON DELETE SET NULL;