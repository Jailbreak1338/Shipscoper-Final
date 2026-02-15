import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  const checks: Record<string, string> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };

  // Check Supabase env vars
  const hasSupabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasSupabaseKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  checks.supabase_config = hasSupabaseUrl && hasSupabaseKey ? 'ok' : 'missing';

  // Check Supabase connection
  if (hasSupabaseUrl && hasSupabaseKey) {
    try {
      const { supabaseAdmin } = await import('@/lib/supabaseServer');
      const { error } = await supabaseAdmin
        .from('latest_schedule')
        .select('vessel_id')
        .limit(1);

      checks.supabase_connection = error ? `error: ${error.message}` : 'ok';
    } catch (e) {
      checks.supabase_connection =
        e instanceof Error ? `error: ${e.message}` : 'error';
    }
  }

  const allOk = Object.values(checks).every(
    (v) => v === 'ok' || v === checks.timestamp
  );

  return NextResponse.json(checks, { status: allOk ? 200 : 503 });
}
