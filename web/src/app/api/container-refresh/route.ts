import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import path from 'path';
import { exec } from 'child_process';

/** POST /api/container-refresh — trigger container status check (Railway or local) */
export async function POST() {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const railwayUrl = process.env.RAILWAY_SCRAPER_URL?.replace(/\/$/, '');
  const secret = process.env.WEBHOOK_SECRET;

  // ── Railway path ──────────────────────────────────────────────────────────
  if (railwayUrl && secret) {
    try {
      const res = await fetch(`${railwayUrl}/webhook/check-containers`, {
        method: 'POST',
        headers: { 'X-Webhook-Secret': secret },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return NextResponse.json({ error: `Railway error ${res.status}: ${text}` }, { status: 502 });
      }
      return NextResponse.json({ ok: true, mode: 'railway' });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 502 });
    }
  }

  // ── Local path: exec npm run check-containers in repo root ────────────────
  // Next.js dev cwd = web/, root is one level up
  const rootDir = path.resolve(process.cwd(), '..');

  // Fire-and-forget: exec returns immediately, process runs in background
  exec('npm run check-containers', { cwd: rootDir }, (err, _stdout, stderr) => {
    if (err) {
      console.error('[container-refresh] check-containers failed:', err.message);
      if (stderr) console.error('[container-refresh] stderr:', stderr.slice(0, 500));
    } else {
      console.log('[container-refresh] check-containers done');
    }
  });

  return NextResponse.json({ ok: true, mode: 'local' });
}
