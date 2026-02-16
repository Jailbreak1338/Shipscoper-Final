import { NextRequest, NextResponse } from 'next/server';

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

  let scraperUrl = process.env.RAILWAY_SCRAPER_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!scraperUrl || !webhookSecret) {
    return NextResponse.json(
      { error: 'RAILWAY_SCRAPER_URL or WEBHOOK_SECRET not configured' },
      { status: 500 }
    );
  }

  // Ensure URL has protocol (add https:// if missing)
  if (!scraperUrl.startsWith('http://') && !scraperUrl.startsWith('https://')) {
    scraperUrl = `https://${scraperUrl}`;
  }

  try {
    const response = await fetch(`${scraperUrl}/webhook/run-scraper`, {
      method: 'POST',
      headers: {
        'X-Webhook-Secret': webhookSecret,
      },
    });

    const body = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Scraper trigger failed', status: response.status, body },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      scraper: body,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Cron trigger-scraper error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
