import { NextRequest, NextResponse } from 'next/server';
import { getValidatedScraperUrl, joinUrlPath } from '@/lib/security';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

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
    const endpoint = joinUrlPath(scraperUrl, '/webhook/run-scraper');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'X-Webhook-Secret': webhookSecret },
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[cron/trigger-scraper] scraper returned', response.status, { endpoint });
      if (response.status === 404) {
        return NextResponse.json({ error: 'Scraper endpoint not found (404). Check base URL and webhook path.' }, { status: 502 });
      }
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
