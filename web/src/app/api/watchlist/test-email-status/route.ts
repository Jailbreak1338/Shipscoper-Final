import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getValidatedScraperUrl } from '@/lib/security';

export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  // Validate UUID format to prevent path traversal / injection in downstream URL
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });

  const scraperUrl = getValidatedScraperUrl(process.env.RAILWAY_SCRAPER_URL);
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!scraperUrl || !webhookSecret) {
    return NextResponse.json({ status: 'unknown' });
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
