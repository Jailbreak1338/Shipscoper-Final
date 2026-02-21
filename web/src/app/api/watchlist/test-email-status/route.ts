import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  let scraperUrl = process.env.RAILWAY_SCRAPER_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!scraperUrl || !webhookSecret) {
    return NextResponse.json({ status: 'unknown' });
  }
  if (!scraperUrl.startsWith('http://') && !scraperUrl.startsWith('https://')) {
    scraperUrl = `https://${scraperUrl}`;
  }

  try {
    const res = await fetch(`${scraperUrl}/webhook/test-email-status/${jobId}`, {
      headers: { 'X-Webhook-Secret': webhookSecret },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ status: 'unknown' });
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ status: 'unknown' });
  }
}
