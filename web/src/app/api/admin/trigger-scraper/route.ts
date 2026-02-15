import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { spawn } from 'child_process';
import path from 'path';

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
    // Path to scraper project root (one level up from web/)
    const projectRoot = path.join(process.cwd(), '..');

    // Determine Python executable:
    // - PYTHON_PATH env var (explicit override for Railway / CI)
    // - Local venv fallback for development
    const isWindows = process.platform === 'win32';
    const venvPython = isWindows
      ? path.join(projectRoot, 'venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'venv', 'bin', 'python');
    const pythonExec = process.env.PYTHON_PATH || venvPython;

    // Run main.py from the project root
    const scraper = spawn(pythonExec, ['main.py', 'run'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    let output = '';
    let errorOutput = '';
    let vesselsScraped = 0;

    scraper.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;

      // Try to extract vessel count from output
      const match = text.match(/(\d+)\s+vessels?/i);
      if (match) {
        vesselsScraped = parseInt(match[1], 10);
      }
    });

    scraper.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    // Wait for process to finish
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      scraper.on('close', (code) => resolve(code));
      scraper.on('error', (err) => reject(err));
    });

    const success = exitCode === 0;

    // Update scraper run log
    await admin
      .from('scraper_runs')
      .update({
        status: success ? 'success' : 'failed',
        vessels_scraped: vesselsScraped,
        errors: success ? null : (errorOutput || `Exit code ${exitCode}`).slice(0, 5000),
        completed_at: new Date().toISOString(),
      })
      .eq('id', runLog.id);

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
          error: errorOutput || `Scraper exited with code ${exitCode}`,
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
