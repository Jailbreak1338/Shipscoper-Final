import { NextRequest, NextResponse } from 'next/server';
import { getValidatedScraperUrl } from '@/lib/security';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/daily
 *
 * Single daily cron at 12:00 UTC. Triggers:
 *   1. /webhook/run-scraper   – full pipeline (scrape → sync → ETA → notifications)
 *   2. /webhook/check-containers – container status check
 *
 * Env vars required:
 *   CRON_SECRET           – Vercel cron secret
 *   RAILWAY_SCRAPER_URL   – e.g. https://your-app.up.railway.app
 *   WEBHOOK_SECRET        – shared secret with Railway
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

  const headers = { 'X-Webhook-Secret': webhookSecret };
  const results: Record<string, unknown> = {};

  // 1. Trigger full scraper pipeline
  try {
    const res = await fetch(`${scraperUrl}/webhook/run-scraper`, {
      method: 'POST',
      headers,
    });
    results.scraper = { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  } catch (err: unknown) {
    results.scraper = { ok: false, error: String(err) };
  }

  // 2. Trigger container status check
  try {
    const res = await fetch(`${scraperUrl}/webhook/check-containers`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    results.containers = { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  } catch (err: unknown) {
    results.containers = { ok: false, error: String(err) };
  }

  return NextResponse.json({ timestamp: new Date().toISOString(), results });
}
