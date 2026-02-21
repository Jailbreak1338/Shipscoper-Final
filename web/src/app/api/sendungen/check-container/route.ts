import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

function scraperUrl(path: string): string {
  let base = process.env.RAILWAY_SCRAPER_URL ?? '';
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = `https://${base}`;
  }
  return `${base}${path}`;
}

const secret = () => process.env.WEBHOOK_SECRET ?? '';

/** POST — trigger the check-containers job */
export async function POST() {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.RAILWAY_SCRAPER_URL || !process.env.WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'RAILWAY_SCRAPER_URL or WEBHOOK_SECRET not configured' },
      { status: 500 }
    );
  }

  const res = await fetch(scraperUrl('/webhook/check-containers'), {
    method: 'POST',
    headers: { 'X-Webhook-Secret': secret(), 'Content-Type': 'application/json' },
    cache: 'no-store',
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: body.error ?? `Scraper error (${res.status})` },
      { status: 502 }
    );
  }

  return NextResponse.json({ jobId: body.job_id });
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

  if (!process.env.RAILWAY_SCRAPER_URL || !process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const res = await fetch(scraperUrl(`/webhook/check-containers-status/${jobId}`), {
    headers: { 'X-Webhook-Secret': secret() },
    cache: 'no-store',
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: body.error ?? `Scraper error (${res.status})` }, { status: 502 });
  }

  return NextResponse.json(body);
}
