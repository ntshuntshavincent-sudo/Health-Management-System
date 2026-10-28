-- ─── VISIT NOTES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visit_notes (
  note_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(appointment_id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES patients(patient_id)   ON DELETE CASCADE,
  provider_id    UUID NOT NULL REFERENCES providers(provider_id) ON DELETE RESTRICT,
  facility_id    UUID NOT NULL REFERENCES facilities(facility_id) ON DELETE RESTRICT,
  department_id  UUID REFERENCES departments(department_id) ON DELETE SET NULL,
  diagnosis      TEXT,
  icd10_code     VARCHAR(10),
  prescription   TEXT,
  notes          TEXT,
  follow_up_date DATE,
  created_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── VITALS / TRIAGE ─────────────────────────────────────────────────────────
-- Captured by nursing staff at every visit. 'triage' uses the South African
-- Triage Scale colours.
CREATE TABLE IF NOT EXISTS vitals (
  vitals_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES appointments(appointment_id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES patients(patient_id)   ON DELETE CASCADE,
  facility_id    UUID NOT NULL REFERENCES facilities(facility_id) ON DELETE RESTRICT,
  recorded_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  temperature_c  NUMERIC(4,1) CHECK (temperature_c BETWEEN 25 AND 45),
  bp_systolic    SMALLINT     CHECK (bp_systolic   BETWEEN 40 AND 300),
  bp_diastolic   SMALLINT     CHECK (bp_diastolic  BETWEEN 20 AND 200),
  pulse_bpm      SMALLINT     CHECK (pulse_bpm     BETWEEN 20 AND 250),
  resp_rate      SMALLINT     CHECK (resp_rate     BETWEEN 5  AND 80),
  spo2_percent   SMALLINT     CHECK (spo2_percent  BETWEEN 50 AND 100),
  weight_kg      NUMERIC(5,1) CHECK (weight_kg     BETWEEN 0.5 AND 400),
  height_cm      SMALLINT     CHECK (height_cm     BETWEEN 30 AND 250),
  pain_score     SMALLINT     CHECK (pain_score    BETWEEN 0 AND 10),
  triage         VARCHAR(10)  CHECK (triage IN ('green','yellow','orange','red')),
  notes          TEXT,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AUDIT LOG (POPIA section 22) ────────────────────────────────────────────
-- No FK to users/facilities on purpose: the trail must outlive the rows it
-- describes, otherwise deleting a staff account would erase the evidence.
CREATE TABLE IF NOT EXISTS audit_log (
  log_id      BIGSERIAL PRIMARY KEY,
  user_id     UUID,
  username    VARCHAR(80),
  role        VARCHAR(20),
  facility_id UUID,
  action      VARCHAR(60) NOT NULL,
  entity      VARCHAR(50),
  entity_id   UUID,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── DATA ACCESS LOG (who viewed which patient record, and why) ──────────────
CREATE TABLE IF NOT EXISTS data_access_log (
  access_id   BIGSERIAL PRIMARY KEY,
  user_id     UUID,
  username    VARCHAR(80),
  role        VARCHAR(20),
  facility_id UUID,
  patient_id  UUID,
  action      VARCHAR(60) NOT NULL,
  reason      TEXT,
  ip_address  VARCHAR(45),
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── HOUSEKEEPING: keep updated_at honest ────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities','departments','users','providers',
                           'patients','appointments','visit_notes']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;