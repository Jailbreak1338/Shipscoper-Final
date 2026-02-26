import { NextRequest, NextResponse } from 'next/server';
import { getValidatedScraperUrl } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/check-containers
 *
 * Called by Vercel Cron on schedule. Forwards to Railway /webhook/check-containers.
 * Protected by Vercel CRON_SECRET.
 *
 * Env vars required:
 *   CRON_SECRET          – Vercel cron secret (set automatically on Vercel)
 *   RAILWAY_SCRAPER_URL  – e.g. https://your-app.up.railway.app
 *   WEBHOOK_SECRET       – shared secret with Railway
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const scraperUrl = getValidatedScraperUrl(process.env.RAILWAY_SCRAPER_URL);
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!scraperUrl || !webhookSecret) {
    return NextResponse.json({ error: 'Scraper not configured' }, { status: 500 });
  }

  try {
    const response = await fetch(`${scraperUrl}/webhook/check-containers`, {
      method: 'POST',
      headers: { 'X-Webhook-Secret': webhookSecret },
      signal: AbortSignal.timeout(10_000),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[cron/check-containers] scraper returned', response.status);
      return NextResponse.json({ error: 'Container check trigger failed' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, job: body, timestamp: new Date().toISOString() });
  } catch (error: unknown) {
    console.error('[cron/check-containers]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
