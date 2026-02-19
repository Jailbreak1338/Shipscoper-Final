import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

async function isAdmin(userId: string): Promise<boolean> {
  // Use service-role client to bypass RLS for the role check
  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();

  const { data } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  return (data as { role: string } | null)?.role === 'admin';
}

// POST: Trigger scraper run
export async function POST() {
  const supabase = createRouteHandlerClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Create scraper run log via service role (bypasses RLS)
  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();

  const { data: runLog, error: insertError } = await admin
    .from('scraper_runs')
    .insert({
      triggered_by: session.user.id,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError || !runLog) {
    console.error('Failed to create run log:', insertError);
    return NextResponse.json(
      { error: 'Failed to create run log' },
      { status: 500 }
    );
  }

  try {
    // Call Railway-hosted scraper API instead of spawning subprocess
    // Fix by tim-k: Use HTTP webhook instead of subprocess to avoid Python path issues
    let scraperUrl = process.env.RAILWAY_SCRAPER_URL;
    const webhookSecret = process.env.WEBHOOK_SECRET;

    if (!scraperUrl || !webhookSecret) {
      throw new Error('RAILWAY_SCRAPER_URL or WEBHOOK_SECRET not configured');
    }

    // Ensure URL has protocol (add https:// if missing)
    if (!scraperUrl.startsWith('http://') && !scraperUrl.startsWith('https://')) {
      scraperUrl = `https://${scraperUrl}`;
    }

    const response = await fetch(`${scraperUrl}/webhook/run-scraper`, {
      method: 'POST',
      headers: {
        'X-Webhook-Secret': webhookSecret,
      },
    });

    const body = await response.json();

    if (!response.ok) {
      throw new Error(`Scraper API returned ${response.status}: ${JSON.stringify(body)}`);
    }

    // Poll for completion (Railway runs scraper in background)
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max (60 * 5s)
    let finalStatus = null;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s between polls

      const statusResponse = await fetch(`${scraperUrl}/status`, {
        method: 'GET',
      });

      if (statusResponse.ok) {
        const status = await statusResponse.json();

        if (status.status === 'completed' || status.status === 'failed') {
          finalStatus = status;
          break;
        }
      }

      attempts++;
    }

    if (!finalStatus) {
      // Timeout - scraper still running
      return NextResponse.json({
        success: true,
        run_id: runLog.id,
        message: 'Scraper started (still running after 5 minutes)',
        status: 'timeout',
      });
    }

    const success = finalStatus.status === 'completed';
    const vesselsScraped = finalStatus.summary?.total || 0;

    // Update scraper run log
    await admin
      .from('scraper_runs')
      .update({
        status: success ? 'success' : 'failed',
        vessels_scraped: vesselsScraped,
        errors: success ? null : (finalStatus.error || 'Unknown error').slice(0, 5000),
        completed_at: new Date().toISOString(),
      })
      .eq('id', runLog.id);
    revalidatePath('/dashboard');
    revalidatePath('/admin');

    if (success) {
      return NextResponse.json({
        success: true,
        vessels_scraped: vesselsScraped,
        run_id: runLog.id,
        message: `Scraper completed successfully. ${vesselsScraped} vessels scraped.`,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: finalStatus.error || 'Scraper failed',
          run_id: runLog.id,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Scraper execution error:', message);

    // Update run log with failure
    await admin
      .from('scraper_runs')
      .update({
        status: 'failed',
        errors: message.slice(0, 5000),
        completed_at: new Date().toISOString(),
      })
      .eq('id', runLog.id);
    revalidatePath('/dashboard');
    revalidatePath('/admin');

    return NextResponse.json(
      { success: false, error: message, run_id: runLog.id },
      { status: 500 }
    );
  }
}

// GET: Get last scraper run status
export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Use service role to read scraper_runs (RLS: admin-only via policy)
  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();

  const { data: lastRun } = await admin
    .from('scraper_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (!lastRun) {
    return NextResponse.json({ last_run: null, message: 'No scraper runs found' });
  }

  return NextResponse.json({
    last_run: {
      id: lastRun.id,
      status: lastRun.status,
      vessels_scraped: lastRun.vessels_scraped,
      started_at: lastRun.started_at,
      completed_at: lastRun.completed_at,
      duration_ms: lastRun.completed_at
        ? new Date(lastRun.completed_at).getTime() -
          new Date(lastRun.started_at).getTime()
        : null,
      errors: lastRun.errors,
    },
  });
}
