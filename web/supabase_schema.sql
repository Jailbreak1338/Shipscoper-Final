-- ============================================
-- ETA Automation – Supabase Schema
-- Run this in the Supabase SQL Editor
-- ============================================

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Table: vessels
-- ============================================
CREATE TABLE IF NOT EXISTS vessels (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  name_normalized TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vessels_name_normalized
  ON vessels (name_normalized);

-- ============================================
-- Table: schedule_events
-- ============================================
CREATE TABLE IF NOT EXISTS schedule_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vessel_id   UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,          -- e.g. 'eurogate', 'hhla'
  eta         TIMESTAMPTZ,
  etd         TIMESTAMPTZ,
  terminal    TEXT,
  scraped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (vessel_id, source, eta, terminal)
);

CREATE INDEX IF NOT EXISTS idx_schedule_events_vessel_id
  ON schedule_events (vessel_id);

CREATE INDEX IF NOT EXISTS idx_schedule_events_scraped_at
  ON schedule_events (scraped_at DESC);

-- ============================================
-- View: latest_schedule
-- Returns only the most recent record per
-- (vessel_id, source) combination.
-- ============================================
CREATE OR REPLACE VIEW latest_schedule AS
SELECT
  se.id,
  se.vessel_id,
  v.name        AS vessel_name,
  v.name_normalized,
  se.source,
  se.eta,
  se.etd,
  se.terminal,
  se.scraped_at
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY vessel_id, source
      ORDER BY scraped_at DESC
    ) AS rn
  FROM schedule_events
) se
JOIN vessels v ON v.id = se.vessel_id
WHERE se.rn = 1;

-- ============================================
-- RLS note
-- ============================================
-- This base schema intentionally does not toggle RLS.
-- Apply auth/RLS policies via:
--   1) supabase_auth_schema.sql
--   2) supabase_watchlist_schema.sql
