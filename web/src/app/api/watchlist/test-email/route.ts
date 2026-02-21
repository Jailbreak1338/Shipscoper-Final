import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function POST() {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let scraperUrl = process.env.RAILWAY_SCRAPER_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!scraperUrl || !webhookSecret) {
    return NextResponse.json(
      { error: 'RAILWAY_SCRAPER_URL or WEBHOOK_SECRET not configured' },
      { status: 500 }
    );
  }

  if (!scraperUrl.startsWith('http://') && !scraperUrl.startsWith('https://')) {
    scraperUrl = `https://${scraperUrl}`;
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

    const body = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: body.error || `Test email failed (${response.status})` },
        { status: 502 }
      );
    }

    // Fire-and-forget: scraper accepted the job, email will be sent in background (~30s).
    // Return immediately to avoid Vercel function timeout issues.
    const jobId = typeof body.job_id === 'string' ? body.job_id : null;
    return NextResponse.json({ queued: true, email: session.user.email, jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
