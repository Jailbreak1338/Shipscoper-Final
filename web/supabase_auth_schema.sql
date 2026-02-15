-- ============================================
-- ETA Automation – Auth & Activity Tracking
-- Run this AFTER supabase_schema.sql
-- Requires Supabase Auth to be enabled
-- ============================================

-- ============================================
-- 1. Enable RLS on existing tables
-- ============================================
ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_events ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read vessels
CREATE POLICY "Authenticated users can read vessels"
  ON vessels FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to read schedule_events
CREATE POLICY "Authenticated users can read schedule_events"
  ON schedule_events FOR SELECT
  TO authenticated
  USING (true);

-- ============================================
-- 2. User roles table
-- ============================================
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role
CREATE POLICY "Users can read own role"
  ON user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can read all roles
CREATE POLICY "Admins can read all roles"
  ON user_roles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Admins can insert/update roles
CREATE POLICY "Admins can manage roles"
  ON user_roles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- ============================================
-- 3. Upload activity tracking
-- ============================================
CREATE TABLE IF NOT EXISTS upload_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_size_bytes BIGINT,
  matched_count INT NOT NULL DEFAULT 0,
  unmatched_count INT NOT NULL DEFAULT 0,
  total_rows INT NOT NULL DEFAULT 0,
  shipment_numbers JSONB DEFAULT '[]'::jsonb,
  processing_time_ms INT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_upload_logs_user_id ON upload_logs(user_id);
CREATE INDEX idx_upload_logs_created_at ON upload_logs(created_at DESC);

ALTER TABLE upload_logs ENABLE ROW LEVEL SECURITY;

-- Users see own logs, admins see all
CREATE POLICY "Users see own upload logs"
  ON upload_logs FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Authenticated users can insert their own logs
CREATE POLICY "Users can insert own upload logs"
  ON upload_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- 4. Scraper run logs (admin only)
-- ============================================
CREATE TABLE IF NOT EXISTS scraper_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by UUID REFERENCES auth.users(id),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  vessels_scraped INT DEFAULT 0,
  errors TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_scraper_runs_started_at ON scraper_runs(started_at DESC);

ALTER TABLE scraper_runs ENABLE ROW LEVEL SECURITY;

-- Only admins can see scraper runs
CREATE POLICY "Only admins see scraper runs"
  ON scraper_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Only admins can insert scraper runs
CREATE POLICY "Only admins can insert scraper runs"
  ON scraper_runs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Only admins can update scraper runs
CREATE POLICY "Only admins can update scraper runs"
  ON scraper_runs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- 5. Helper function: check if user is admin
-- ============================================
CREATE OR REPLACE FUNCTION is_admin(check_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = check_user_id AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- 6. Auto-assign 'user' role on signup
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- 7. Create first admin user (run manually)
-- ============================================
-- After creating a user in the Supabase Dashboard
-- (Authentication → Users → Create User), promote
-- them to admin:
--
-- INSERT INTO user_roles (user_id, role)
-- VALUES ('<USER_UUID_HERE>', 'admin')
-- ON CONFLICT (user_id)
-- DO UPDATE SET role = 'admin', updated_at = NOW();
