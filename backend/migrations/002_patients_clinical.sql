-- ─── PATIENTS ───────────────────────────────────────────────────────────────
-- Nationally unique by SA ID number: the same patient walking into a different
-- clinic is recognised, which is the "continuity of care" promise of the pitch.
CREATE TABLE IF NOT EXISTS patients (
  patient_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_number            VARCHAR(13)  NOT NULL UNIQUE,
  first_name           VARCHAR(100) NOT NULL,
  last_name            VARCHAR(100) NOT NULL,
  date_of_birth        DATE,
  gender               VARCHAR(20),
  phone                VARCHAR(20),
  email                VARCHAR(150),
  address              TEXT,
  blood_type           VARCHAR(5),
  allergies            TEXT,
  chronic_conditions   TEXT,
  next_of_kin_name     VARCHAR(150),
  next_of_kin_phone    VARCHAR(20),
  medical_aid_scheme   VARCHAR(100),
  medical_aid_number   VARCHAR(50),
  medical_aid_plan     VARCHAR(60),
  home_facility_id     UUID REFERENCES facilities(facility_id) ON DELETE SET NULL,
  is_deceased          BOOLEAN NOT NULL DEFAULT FALSE,
  -- POPIA condition 2: processing limitation. We record that consent was given.
  consent_popia        BOOLEAN NOT NULL DEFAULT FALSE,
  consent_given_at     TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PATIENT FOLDERS ────────────────────────────────────────────────────────
-- Hospitals and clinics file patients under their own folder/file number.
-- One folder per patient per facility, so nobody re-types the old number.
CREATE TABLE IF NOT EXISTS patient_folders (
  folder_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  facility_id   UUID NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  folder_number VARCHAR(40) NOT NULL,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (facility_id, folder_number),
  UNIQUE (patient_id, facility_id)
);

-- ─── APPOINTMENTS ────────────────────────────────────────────────────────────
-- status 'checked_in' is set by the kiosk and surfaces the patient on the
-- nurse's dashboard without anybody phoning down the corridor.
CREATE TABLE IF NOT EXISTS appointments (
  appointment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID NOT NULL REFERENCES patients(patient_id)   ON DELETE CASCADE,
  provider_id      UUID NOT NULL REFERENCES providers(provider_id) ON DELETE RESTRICT,
  facility_id      UUID NOT NULL REFERENCES facilities(facility_id) ON DELETE RESTRICT,
  department_id    UUID REFERENCES departments(department_id) ON DELETE SET NULL,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  duration_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  status           VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'checked_in', 'in_progress',
                                     'completed', 'cancelled', 'no_show')),
  priority         VARCHAR(20) NOT NULL DEFAULT 'routine'
                   CHECK (priority IN ('routine', 'urgent', 'emergency')),
  reason           TEXT,
  created_by       UUID REFERENCES users(user_id) ON DELETE SET NULL,
  checked_in_at    TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);