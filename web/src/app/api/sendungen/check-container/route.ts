import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import path from 'path';
import { exec } from 'child_process';

function scraperUrl(p: string): string {
  let base = process.env.RAILWAY_SCRAPER_URL ?? '';
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = `https://${base}`;
  }
  return `${base}${p}`;
}

const secret = () => process.env.WEBHOOK_SECRET ?? '';

async function tryRailway(): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  try {
    const res = await fetch(scraperUrl('/webhook/check-containers'), {
      method: 'POST',
      headers: { 'X-Webhook-Secret': secret(), 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error ?? `Scraper error (${res.status})` };
    return { ok: true, jobId: body.job_id };
  } catch {
    return { ok: false, error: 'Railway not reachable' };
  }
}

function runLocal(): void {
  const rootDir = path.resolve(process.cwd(), '..');
  exec('npm run check-containers', { cwd: rootDir }, (err) => {
    if (err) console.error('[check-container] local run failed:', err.message);
    else console.log('[check-container] local run done');
  });
}

/** POST — trigger the check-containers job */
export async function POST() {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const railwayConfigured =
    !!process.env.RAILWAY_SCRAPER_URL && !!process.env.WEBHOOK_SECRET;

  if (railwayConfigured) {
    const result = await tryRailway();
    if (result.ok) {
      return NextResponse.json({ jobId: result.jobId, mode: 'railway' });
    }
    // Railway not reachable — fall through to local
    console.warn('[check-container] Railway unreachable, falling back to local');
  }

  // Local subprocess fallback
  runLocal();
  return NextResponse.json({ jobId: 'local', mode: 'local' });
}

/** GET — poll status of a running job */
export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  // Local mode: no status endpoint — just report as running
  if (jobId === 'local') {
    return NextResponse.json({ status: 'running', mode: 'local' });
  }

  if (!process.env.RAILWAY_SCRAPER_URL || !process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(scraperUrl(`/webhook/check-containers-status/${jobId}`), {
      headers: { 'X-Webhook-Secret': secret() },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: body.error ?? `Scraper error (${res.status})` }, { status: 502 });
    }
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: 'Railway not reachable' }, { status: 502 });
  }
}
