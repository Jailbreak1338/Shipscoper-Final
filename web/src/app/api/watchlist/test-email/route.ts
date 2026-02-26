import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getValidatedScraperUrl } from '@/lib/security';

export async function POST() {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const scraperUrl = getValidatedScraperUrl(process.env.RAILWAY_SCRAPER_URL);
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!scraperUrl || !webhookSecret) {
    return NextResponse.json({ error: 'Test email not available' }, { status: 500 });
  }

  try {
    const response = await fetch(`${scraperUrl}/webhook/test-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': webhookSecret,
      },
      body: JSON.stringify({ to_email: session.user.email }),
      cache: 'no-store',
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('test-email scraper error:', response.status);
      return NextResponse.json({ error: 'Test email failed' }, { status: 502 });
    }

    // Fire-and-forget: scraper accepted the job, email will be sent in background (~30s).
    const jobId = typeof body.job_id === 'string' ? body.job_id : null;
    return NextResponse.json({ queued: true, email: session.user.email, jobId });
  } catch (error) {
    console.error('test-email error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
