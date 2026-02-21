-- ============================================================
-- Container Tracking: Status, Events, Notifications
-- Run once in Supabase SQL Editor.
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- so this migration is idempotent and safe to re-run.
-- ============================================================

-- ── 1. Extend vessel_watches ──────────────────────────────
-- Add optional provider hint column (HHLA / EUROGATE / AUTO).
-- If NULL or AUTO the job tries to auto-detect or tries both.
ALTER TABLE vessel_watches
  ADD COLUMN IF NOT EXISTS container_source TEXT
    CHECK (container_source IN ('HHLA', 'EUROGATE', 'AUTO'));

-- ── 2. container_latest_status ───────────────────────────
-- One row per (watch_id, container_no) – always reflects the
-- most recent scraped state. Upserted on every new hash.
CREATE TABLE IF NOT EXISTS container_latest_status (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id              UUID        NOT NULL REFERENCES vessel_watches(id) ON DELETE CASCADE,
  container_no          TEXT        NOT NULL,
  provider              TEXT        NOT NULL,             -- 'hhla' | 'eurogate'
  terminal              TEXT,
  shipping_line         TEXT,                            -- Reeder (HHLA)
  iso_code              TEXT,
  normalized_status     TEXT        NOT NULL,             -- PREANNOUNCED | DISCHARGED | READY | DELIVERED_OUT
  status_raw            TEXT,                            -- Raw status text from provider
  ready_for_loading     BOOLEAN,                         -- "Bereit zur Verladung" (HHLA)
  discharge_order_status TEXT,
  discharge_order_ts    TIMESTAMPTZ,
  delivered_out         BOOLEAN     NOT NULL DEFAULT false,
  status_hash           TEXT        NOT NULL,             -- SHA-256 fingerprint of parsed fields
  parsed_json           JSONB,                           -- Full structured parse result
  raw_text              TEXT,                            -- Full page text (debug)
  scraped_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (watch_id, container_no)
);

CREATE INDEX IF NOT EXISTS idx_cls_watch_id
  ON container_latest_status(watch_id);
CREATE INDEX IF NOT EXISTS idx_cls_container_no
  ON container_latest_status(container_no);
CREATE INDEX IF NOT EXISTS idx_cls_normalized_status
  ON container_latest_status(normalized_status);

-- ── 3. container_status_events ───────────────────────────
-- Immutable append-only log: one row per status transition.
CREATE TABLE IF NOT EXISTS container_status_events (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id              UUID        NOT NULL REFERENCES vessel_watches(id) ON DELETE CASCADE,
  container_no          TEXT        NOT NULL,
  provider              TEXT        NOT NULL,
  previous_status       TEXT,                            -- NULL on first scrape
  new_status            TEXT        NOT NULL,
  status_raw            TEXT,
  status_hash           TEXT        NOT NULL,
  terminal              TEXT,
  parsed_json           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cse_watch_id
  ON container_status_events(watch_id);
CREATE INDEX IF NOT EXISTS idx_cse_container_no
  ON container_status_events(container_no);
CREATE INDEX IF NOT EXISTS idx_cse_created_at
  ON container_status_events(created_at DESC);

-- ── 4. container_status_notifications ────────────────────
-- Idempotent notification log: UNIQUE on (watch_id, container_no,
-- event_type, status_hash) prevents duplicate sends on retries.
CREATE TABLE IF NOT EXISTS container_status_notifications (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id              UUID        NOT NULL REFERENCES vessel_watches(id) ON DELETE CASCADE,
  container_no          TEXT        NOT NULL,
  event_type            TEXT        NOT NULL,             -- container_discharged | container_ready | container_delivered_out
  status_hash           TEXT        NOT NULL,
  sent_to               TEXT        NOT NULL,             -- Recipient email
  provider              TEXT,
  terminal              TEXT,
  shipment_reference    TEXT,
  sent_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (watch_id, container_no, event_type, status_hash)  -- dedupe key
);

CREATE INDEX IF NOT EXISTS idx_csn_watch_id
  ON container_status_notifications(watch_id);
CREATE INDEX IF NOT EXISTS idx_csn_container_no
  ON container_status_notifications(container_no);
CREATE INDEX IF NOT EXISTS idx_csn_sent_at
  ON container_status_notifications(sent_at DESC);

-- ── 5. Row Level Security ─────────────────────────────────
ALTER TABLE container_latest_status       ENABLE ROW LEVEL SECURITY;
ALTER TABLE container_status_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE container_status_notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own container data (service role bypasses RLS for writes)
CREATE POLICY "Users see own container status"
  ON container_latest_status FOR SELECT
  TO authenticated
  USING (
    watch_id IN (
      SELECT id FROM vessel_watches WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users see own container events"
  ON container_status_events FOR SELECT
  TO authenticated
  USING (
    watch_id IN (
      SELECT id FROM vessel_watches WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users see own container notifications"
  ON container_status_notifications FOR SELECT
  TO authenticated
  USING (
    watch_id IN (
      SELECT id FROM vessel_watches WHERE user_id = auth.uid()
    )
  );
