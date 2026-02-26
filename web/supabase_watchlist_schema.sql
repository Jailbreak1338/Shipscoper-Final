-- ============================================
-- Vessel Watchlist & Notifications
-- ============================================

-- Table: vessel_watches
-- Users can watch specific vessels and get notified on ETA changes
CREATE TABLE IF NOT EXISTS vessel_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vessel_name TEXT NOT NULL,
  vessel_name_normalized TEXT NOT NULL,
  shipment_reference TEXT, -- Optional: User's reference (S00123456), comma-separated
  container_reference TEXT, -- Optional: Container numbers, comma-separated (e.g. MSCU1234567)
  last_known_eta TIMESTAMPTZ,
  notification_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ,
  UNIQUE(user_id, vessel_name_normalized, shipment_reference)
);

-- Migration: Add container_reference column (run once in Supabase SQL editor if table already exists)
-- ALTER TABLE vessel_watches ADD COLUMN IF NOT EXISTS container_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_vessel_watches_user_id ON vessel_watches(user_id);
CREATE INDEX IF NOT EXISTS idx_vessel_watches_normalized ON vessel_watches(vessel_name_normalized);
CREATE INDEX IF NOT EXISTS idx_vessel_watches_active ON vessel_watches(notification_enabled);

-- RLS: Users see only their own watches
ALTER TABLE vessel_watches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own watches"
    ON vessel_watches FOR ALL
    TO authenticated
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Table: eta_change_notifications
-- Log of all ETA changes for watched vessels
CREATE TABLE IF NOT EXISTS eta_change_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id UUID REFERENCES vessel_watches(id) ON DELETE CASCADE,
  vessel_name TEXT NOT NULL,
  shipment_reference TEXT,
  old_eta TIMESTAMPTZ,
  new_eta TIMESTAMPTZ,
  delay_days INT, -- Calculated delay (positive = delayed, negative = earlier)
  notification_sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eta_notifications_watch_id ON eta_change_notifications(watch_id);
CREATE INDEX IF NOT EXISTS idx_eta_notifications_created_at ON eta_change_notifications(created_at DESC);

-- RLS: Users see notifications for their own watches
ALTER TABLE eta_change_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users see own notifications"
    ON eta_change_notifications FOR SELECT
    TO authenticated
    USING (
      watch_id IN (
        SELECT id FROM vessel_watches WHERE user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
