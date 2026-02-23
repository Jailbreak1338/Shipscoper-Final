-- ============================================================
-- Migration: Container-S-Nr Pairing + Status Check Runs
-- Run once in Supabase SQL Editor.
-- All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- ── 1. container_snr_pairs on vessel_watches ─────────────────
-- Stores the exact row-level mapping from the Excel import:
-- [{"container_no": "MSCU1234567", "snr": "S00224537"}, ...]
-- This replaces the cross-product of shipment_reference × container_reference.
-- Rule: populated by update-excel upload. If NULL, UI falls back to cross-product.
ALTER TABLE vessel_watches
  ADD COLUMN IF NOT EXISTS container_snr_pairs JSONB;

COMMENT ON COLUMN vessel_watches.container_snr_pairs IS
  'Array of {container_no, snr} pairs from Excel import rows. '
  'Populated by update-excel API. If NULL, falls back to cross-product of '
  'shipment_reference × container_reference for backward compatibility.';

-- ── 2. status_check_runs ─────────────────────────────────────
-- One row per execution of checkContainers.ts.
-- Allows the UI to show the last run summary + persistent logs.
CREATE TABLE IF NOT EXISTS status_check_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          TEXT        NOT NULL UNIQUE,          -- same as logged UUID
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INTEGER,
  shipments_loaded  INTEGER   DEFAULT 0,
  shipments_skipped INTEGER   DEFAULT 0,
  checked_ok        INTEGER   DEFAULT 0,
  checked_failed    INTEGER   DEFAULT 0,
  changed           INTEGER   DEFAULT 0,
  ok_count          INTEGER   DEFAULT 0 GENERATED ALWAYS AS (checked_ok) STORED,
  fail_count        INTEGER   DEFAULT 0 GENERATED ALWAYS AS (checked_failed) STORED,
  skip_count        INTEGER   DEFAULT 0 GENERATED ALWAYS AS (shipments_skipped) STORED,
  summary_json    JSONB,
  log_text        TEXT
);

CREATE INDEX IF NOT EXISTS idx_scr_started_at
  ON status_check_runs(started_at DESC);

-- ── 3. status_check_run_items (per-container detail) ─────────
CREATE TABLE IF NOT EXISTS status_check_run_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          TEXT        NOT NULL REFERENCES status_check_runs(run_id) ON DELETE CASCADE,
  watch_id        UUID,
  container_no    TEXT        NOT NULL,
  shipment_ref    TEXT,
  provider        TEXT,
  terminal        TEXT,
  result          TEXT,                    -- 'changed' | 'unchanged' | 'error' | 'skipped'
  normalized_status TEXT,
  status_raw      TEXT,
  error_msg       TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scri_run_id
  ON status_check_run_items(run_id);

-- ── 4. RLS for new tables ─────────────────────────────────────
ALTER TABLE status_check_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_check_run_items  ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS for writes; authenticated users can read all runs
-- (runs are global to the installation, not per-user)
CREATE POLICY IF NOT EXISTS "Authenticated users can read status runs"
  ON status_check_runs FOR SELECT TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "Authenticated users can read run items"
  ON status_check_run_items FOR SELECT TO authenticated USING (true);

-- ── 5. Cleanup: rebuild container_snr_pairs for existing watches ──
-- For existing vessel_watches that have both shipment_reference and
-- container_reference, attempt a positional rebuild:
-- zip(split(shipment_reference), split(container_reference)) as pairs.
-- This is a best-effort approximation for old data.
-- Re-upload Excel to get exact pairs.
DO $$
DECLARE
  r RECORD;
  refs TEXT[];
  cnos TEXT[];
  pairs JSONB;
  pair_arr JSONB[];
  i INT;
  min_len INT;
BEGIN
  FOR r IN
    SELECT id, shipment_reference, container_reference
    FROM vessel_watches
    WHERE container_snr_pairs IS NULL
      AND shipment_reference IS NOT NULL
      AND container_reference IS NOT NULL
  LOOP
    -- Split and trim
    refs := ARRAY(
      SELECT TRIM(unnest(string_to_array(r.shipment_reference, ',')))
    );
    cnos := ARRAY(
      SELECT UPPER(TRIM(unnest(string_to_array(r.container_reference, ','))))
    );

    -- Filter to ISO-6346 containers (4 letters + 7 digits)
    cnos := ARRAY(
      SELECT c FROM unnest(cnos) AS c
      WHERE c ~ '^[A-Z]{4}[0-9]{7}$'
    );

    IF array_length(refs, 1) IS NULL OR array_length(cnos, 1) IS NULL THEN
      CONTINUE;
    END IF;

    min_len := LEAST(array_length(refs, 1), array_length(cnos, 1));
    pair_arr := ARRAY[]::JSONB[];

    FOR i IN 1..min_len LOOP
      pair_arr := pair_arr || jsonb_build_object('container_no', cnos[i], 'snr', refs[i]);
    END LOOP;

    -- If more containers than S-Nrs, add remaining with null snr
    IF array_length(cnos, 1) > min_len THEN
      FOR i IN (min_len + 1)..array_length(cnos, 1) LOOP
        pair_arr := pair_arr || jsonb_build_object('container_no', cnos[i], 'snr', NULL);
      END LOOP;
    END IF;

    IF array_length(pair_arr, 1) > 0 THEN
      UPDATE vessel_watches
      SET container_snr_pairs = to_jsonb(pair_arr)
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
