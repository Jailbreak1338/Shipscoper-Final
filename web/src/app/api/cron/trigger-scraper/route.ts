import { NextRequest, NextResponse } from 'next/server';
import { getValidatedScraperUrl } from '@/lib/security';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/trigger-scraper
 *
 * Called by Vercel Cron on a schedule. Forwards the request to the
 * Railway-hosted scraper API, which runs the full pipeline
 * (scrape → sync → ETA change detection → notifications).
 *
 * Env vars required:
 *   CRON_SECRET           – Vercel cron secret for auth
 *   RAILWAY_SCRAPER_URL   – e.g. https://eta-scraper.up.railway.app
 *   WEBHOOK_SECRET        – shared secret with the Railway scraper API
 */
export async function GET(req: NextRequest) {
  // Verify Vercel Cron auth
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
    const response = await fetch(`${scraperUrl}/webhook/run-scraper`, {
      method: 'POST',
      headers: { 'X-Webhook-Secret': webhookSecret },
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Cron trigger-scraper: scraper returned', response.status);
      return NextResponse.json({ error: 'Scraper trigger failed' }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      scraper: body,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error('Cron trigger-scraper error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
