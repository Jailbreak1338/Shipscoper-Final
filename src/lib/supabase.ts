import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Lazy-initialized Supabase admin client (service role key, bypasses RLS).
 * Mirrors the pattern in scraper/supabase_writer.py.
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  // Accept SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL (shared Railway/Vercel env)
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !key) {
    throw new Error(
      '[supabase] SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and ' +
        'SUPABASE_SERVICE_ROLE_KEY must be set'
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
