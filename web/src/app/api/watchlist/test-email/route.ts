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

    const jobId = typeof body.job_id === 'string' ? body.job_id : null;
    if (!jobId) {
      return NextResponse.json(
        { error: 'Scraper did not return a test-email job id' },
        { status: 502 }
      );
    }

    // Poll scraper for actual SMTP send result so frontend gets real status.
    const maxAttempts = 8; // ~16 seconds total
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const statusRes = await fetch(
        `${scraperUrl}/webhook/test-email-status/${jobId}`,
        {
          method: 'GET',
          headers: { 'X-Webhook-Secret': webhookSecret },
          cache: 'no-store',
        }
      );

      const statusBody = await statusRes.json().catch(() => ({}));
      if (!statusRes.ok) {
        return NextResponse.json(
          { error: statusBody.error || `Status check failed (${statusRes.status})` },
          { status: 502 }
        );
      }

      if (statusBody.status === 'sent') {
        return NextResponse.json({ success: true, email: session.user.email });
      }

      if (statusBody.status === 'failed') {
        return NextResponse.json(
          {
            error:
              typeof statusBody.error === 'string'
                ? statusBody.error.split('\n').slice(-4).join('\n')
                : 'SMTP send failed',
          },
          { status: 502 }
        );
      }
    }

    return NextResponse.json(
      {
        error:
          'Test email still running. Check Railway logs for [test-email] details.',
      },
      { status: 504 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
