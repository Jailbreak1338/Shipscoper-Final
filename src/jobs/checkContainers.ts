/**
 * checkContainers — Container status polling job.
 *
 * Usage:
 *   npx tsx src/jobs/checkContainers.ts
 *
 * What it does:
 *  1. Load all vessel_watches with container_reference set (regardless of notification_enabled)
 *  2. For each (watch, container_no) pair: scrape HHLA or Eurogate
 *  3. Compute status_hash; if new → upsert latest + append event + send notification
 *  4. Notifications are idempotent (dedupe via UNIQUE constraint)
 *  5. Persists run summary + logs to status_check_runs table
 *
 * ENV (see README#container-tracking):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   EMAIL_PROVIDER, RESEND_API_KEY (or SES_*)
 *   EMAIL_FROM, MAKE_WEBHOOK_URL (optional)
 *   HHLA_CONTAINER_URL, EUROGATE_CONTAINER_URL (optional overrides)
 *   HEADLESS=false  — show browser window (for debugging)
 *   MAX_CONCURRENCY — parallel browser pages (default: 2)
 *   SKIP_DELIVERED=false — re-check DELIVERED_OUT containers (default: true = skip)
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { getSupabase } from '../lib/supabase.js';
import { computeStatusHash } from '../lib/hash.js';
import { sendContainerNotification } from '../lib/email.js';
import { scrapeHhla } from '../providers/hhla.js';
import { scrapeEurogate } from '../providers/eurogate.js';
import type {
  ActiveWatch,
  ContainerScrapeResult,
  LatestStatus,
  NormalizedStatus,
  Provider,
} from '../lib/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY ?? '2', 10);
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 3_000;
const HEADLESS = process.env.HEADLESS !== 'false';
const SKIP_DELIVERED = process.env.SKIP_DELIVERED !== 'false'; // default: skip DELIVERED_OUT

// Status transitions that trigger notifications
const NOTIFY_TRANSITIONS: NormalizedStatus[] = [
  'DISCHARGED',
  'READY',
  'DELIVERED_OUT',
];

const EVENT_TYPE: Record<NormalizedStatus, string> = {
  PREANNOUNCED: 'container_preannounced',
  DISCHARGED: 'container_discharged',
  READY: 'container_ready',
  DELIVERED_OUT: 'container_delivered_out',
};

// ── Structured logging ────────────────────────────────────────────────────────

const RUN_ID = randomUUID();
const logLines: string[] = [];
const startedAt = Date.now();

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function structuredLog(level: LogLevel, msg: string, data?: object): void {
  const entry = {
    ts: new Date().toISOString(),
    run_id: RUN_ID,
    level,
    msg,
    ...(data ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  logLines.push(line);
}

const log = (msg: string, data?: object) => structuredLog('info', msg, data);
const warn = (msg: string, data?: object) => structuredLog('warn', msg, data);
const err = (msg: string, data?: object) => structuredLog('error', msg, data);
const debug = (msg: string, data?: object) => structuredLog('debug', msg, data);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry a fallible async fn with exponential backoff. */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = RETRY_ATTEMPTS
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message;
      if (attempt < maxAttempts) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        warn(`${label}: attempt ${attempt}/${maxAttempts} failed. Retry in ${delay}ms`, { error: msg });
        await sleep(delay);
      } else {
        err(`${label}: all ${maxAttempts} attempts failed`, { error: msg });
      }
    }
  }
  return null;
}

/** Run at most `concurrency` async tasks in parallel. */
async function runWithConcurrency(
  tasks: (() => Promise<void>)[],
  concurrency: number
): Promise<void> {
  const running = new Set<Promise<void>>();
  for (const task of tasks) {
    const p: Promise<void> = task().finally(() => running.delete(p));
    running.add(p);
    if (running.size >= concurrency) {
      await Promise.race(running);
    }
  }
  await Promise.all(running);
}

// ── Data loading ──────────────────────────────────────────────────────────────

/** Parse comma/semicolon/whitespace-separated container numbers. Strict ISO 6346. */
function parseContainerNos(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{4}[0-9]{7}$/.test(s));
}

async function loadActiveWatches(): Promise<ActiveWatch[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('vessel_watches')
    .select(
      'id, user_id, vessel_name, shipment_reference, container_reference, container_source, notification_enabled'
    )
    // Check ALL watches with containers — notification_enabled only gates email, not status-checking
    .not('container_reference', 'is', null);

  if (error) throw new Error(`loadActiveWatches: ${error.message}`);
  return (data ?? []) as ActiveWatch[];
}

async function loadLatestStatuses(
  watchIds: string[]
): Promise<Map<string, LatestStatus>> {
  if (watchIds.length === 0) return new Map();
  const sb = getSupabase();
  const { data, error } = await sb
    .from('container_latest_status')
    .select('id, watch_id, container_no, status_hash, normalized_status')
    .in('watch_id', watchIds);

  if (error) throw new Error(`loadLatestStatuses: ${error.message}`);

  const map = new Map<string, LatestStatus>();
  for (const row of data ?? []) {
    map.set(`${row.watch_id}::${row.container_no}`, row as LatestStatus);
  }
  return map;
}

/** Resolve which provider to use for a given watch + container. */
function resolveProvider(
  watch: ActiveWatch,
  _containerNo: string
): Provider[] {
  const src = watch.container_source?.toUpperCase();
  if (src === 'HHLA') return ['hhla'];
  if (src === 'EUROGATE') return ['eurogate'];
  // AUTO or null → try HHLA first, then Eurogate as fallback
  return ['hhla', 'eurogate'];
}

// ── DB writes ──────────────────────────────────────────────────────────────────

async function saveRunToDb(stats: {
  loaded: number;
  skipped: number;
  ok: number;
  failed: number;
  changed: number;
}): Promise<void> {
  try {
    const sb = getSupabase();
    const now = new Date().toISOString();
    const duration_ms = Date.now() - startedAt;
    await sb.from('status_check_runs').upsert(
      {
        run_id: RUN_ID,
        started_at: new Date(startedAt).toISOString(),
        finished_at: now,
        duration_ms,
        shipments_loaded: stats.loaded,
        shipments_skipped: stats.skipped,
        checked_ok: stats.ok,
        checked_failed: stats.failed,
        changed: stats.changed,
        summary_json: stats,
        log_text: logLines.join('\n'),
      },
      { onConflict: 'run_id' }
    );
    log('Run saved to status_check_runs', { run_id: RUN_ID, duration_ms });
  } catch (e) {
    warn('Could not save run to DB (migration not yet applied?)', { error: (e as Error).message });
  }
}

async function upsertLatestStatus(
  watchId: string,
  containerNo: string,
  result: ContainerScrapeResult,
  hash: string
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('container_latest_status').upsert(
    {
      watch_id: watchId,
      container_no: containerNo,
      provider: result.provider,
      terminal: result.terminal,
      shipping_line: result.shipping_line,
      iso_code: result.iso_code,
      normalized_status: result.normalized_status,
      status_raw: result.status_raw,
      ready_for_loading: result.ready_for_loading,
      discharge_order_status: result.discharge_order_status,
      discharge_order_ts: result.discharge_order_ts,
      delivered_out: result.delivered_out,
      status_hash: hash,
      parsed_json: result.parsed_json,
      raw_text: result.raw_text,
      scraped_at: result.scraped_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'watch_id,container_no' }
  );
  if (error) throw new Error(`upsertLatestStatus: ${error.message}`);
}

async function insertStatusEvent(
  watchId: string,
  containerNo: string,
  previousStatus: string | null,
  result: ContainerScrapeResult,
  hash: string
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('container_status_events').insert({
    watch_id: watchId,
    container_no: containerNo,
    provider: result.provider,
    previous_status: previousStatus,
    new_status: result.normalized_status,
    status_raw: result.status_raw,
    status_hash: hash,
    terminal: result.terminal,
    parsed_json: result.parsed_json,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`insertStatusEvent: ${error.message}`);
}

/**
 * Insert notification record (dedupe via UNIQUE constraint).
 * Returns true if the insert succeeded (notification should be sent),
 * false if it was a duplicate (already sent this exact status transition).
 */
async function insertNotificationRecord(
  watchId: string,
  containerNo: string,
  eventType: string,
  hash: string,
  sentTo: string,
  result: ContainerScrapeResult,
  shipmentRef: string | null
): Promise<boolean> {
  const sb = getSupabase();
  const { error } = await sb.from('container_status_notifications').insert({
    watch_id: watchId,
    container_no: containerNo,
    event_type: eventType,
    status_hash: hash,
    sent_to: sentTo,
    provider: result.provider,
    terminal: result.terminal,
    shipment_reference: shipmentRef,
    sent_at: new Date().toISOString(),
  });

  if (error) {
    // Unique constraint violation = duplicate (already notified)
    if (error.code === '23505') return false;
    throw new Error(`insertNotificationRecord: ${error.message}`);
  }
  return true;
}

/** Fetch the email address for a user from auth.users (service role). */
async function getUserEmail(userId: string): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) {
    warn(`Could not load email for user ${userId}`, { error: error?.message ?? 'no email' });
    return null;
  }
  return data.user.email;
}

// ── Per-container processing ──────────────────────────────────────────────────

async function processContainer(
  watch: ActiveWatch,
  containerNo: string,
  latest: LatestStatus | undefined,
  page: Page
): Promise<{ changed: boolean; error: boolean; skipped: boolean }> {
  const label = `${watch.vessel_name} / ${containerNo}`;

  debug('Processing container', {
    watch_id: watch.id,
    vessel: watch.vessel_name,
    container_no: containerNo,
    container_source: watch.container_source,
    notification_enabled: watch.notification_enabled,
    shipment_reference: watch.shipment_reference,
    current_status: latest?.normalized_status ?? null,
  });

  // Skip DELIVERED_OUT containers (already done, no point re-scraping)
  if (SKIP_DELIVERED && latest?.normalized_status === 'DELIVERED_OUT') {
    debug(`${label}: skipping DELIVERED_OUT`, { skip_delivered: true });
    return { changed: false, error: false, skipped: true };
  }

  // Determine provider order and scrape with retry
  const providers = resolveProvider(watch, containerNo);
  let result: ContainerScrapeResult | null = null;

  for (const provider of providers) {
    result = await withRetry(
      () =>
        provider === 'hhla'
          ? scrapeHhla(containerNo, page)
          : scrapeEurogate(containerNo, page),
      `${label} [${provider}]`
    );
    if (result) break;
  }

  if (!result) {
    warn(`${label}: no result from any provider — skipping`);
    return { changed: false, error: true, skipped: false };
  }

  // Compute hash and compare
  const hash = computeStatusHash(result);
  if (latest?.status_hash === hash) {
    log(`${label}: unchanged`, { normalized_status: result.normalized_status });
    return { changed: false, error: false, skipped: false };
  }

  log(`${label}: status change`, {
    from: latest?.normalized_status ?? 'NEW',
    to: result.normalized_status,
  });

  // Persist: upsert latest status + append event
  await upsertLatestStatus(watch.id, containerNo, result, hash);
  await insertStatusEvent(
    watch.id,
    containerNo,
    latest?.normalized_status ?? null,
    result,
    hash
  );

  // Send notification only when notification_enabled AND noteworthy transition
  if (watch.notification_enabled && NOTIFY_TRANSITIONS.includes(result.normalized_status)) {
    const eventType = EVENT_TYPE[result.normalized_status];
    const userEmail = await getUserEmail(watch.user_id);

    if (userEmail) {
      const shouldSend = await insertNotificationRecord(
        watch.id,
        containerNo,
        eventType,
        hash,
        userEmail,
        result,
        watch.shipment_reference
      );

      if (shouldSend) {
        try {
          await sendContainerNotification({
            to: userEmail,
            shipment_reference: watch.shipment_reference,
            container_no: containerNo,
            provider: result.provider,
            terminal: result.terminal,
            normalized_status: result.normalized_status,
            status_raw: result.status_raw,
            event_type: eventType,
            discharge_order_ts: result.discharge_order_ts,
          });
          log(`${label}: notification sent`, { to: userEmail, event_type: eventType });
        } catch (e) {
          err(`${label}: email send failed`, { error: (e as Error).message });
          // Don't re-throw: notification record exists, no duplicate send on retry
        }
      } else {
        log(`${label}: notification already sent (deduped)`);
      }
    }
  } else if (!watch.notification_enabled) {
    debug(`${label}: notification_enabled=false — status updated, no email sent`);
  }

  return { changed: true, error: false, skipped: false };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('Starting', { run_id: RUN_ID, concurrency: MAX_CONCURRENCY, headless: HEADLESS, skip_delivered: SKIP_DELIVERED });

  // 1. Load watches
  const watches = await loadActiveWatches();
  log(`Loaded ${watches.length} watch(es) with container_reference`, {
    total: watches.length,
    notification_enabled: watches.filter((w) => w.notification_enabled).length,
  });

  if (watches.length === 0) {
    log('Nothing to do.');
    await saveRunToDb({ loaded: 0, skipped: 0, ok: 0, failed: 0, changed: 0 });
    return;
  }

  // 2. Build work items: [(watch, containerNo)]
  type WorkItem = { watch: ActiveWatch; containerNo: string };
  const workItems: WorkItem[] = [];
  let skipped_no_valid_container = 0;

  for (const watch of watches) {
    const nos = parseContainerNos(watch.container_reference);
    if (nos.length === 0) {
      debug('No valid ISO-6346 container numbers — skipping watch', {
        watch_id: watch.id,
        container_reference: watch.container_reference,
      });
      skipped_no_valid_container++;
      continue;
    }
    for (const containerNo of nos) {
      workItems.push({ watch, containerNo });
    }
  }

  log(`${workItems.length} container(s) to check`, {
    work_items: workItems.length,
    skipped_no_valid_container,
  });

  // 3. Pre-load all latest statuses in one query
  const watchIds = [...new Set(watches.map((w) => w.id))];
  const latestMap = await loadLatestStatuses(watchIds);

  // 4. Launch browser
  const browser: Browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // 5. Process containers with bounded concurrency (each slot gets its own page)
  let changed = 0;
  let unchanged = 0;
  let errors = 0;
  let skipped_delivered = 0;

  const tasks = workItems.map(({ watch, containerNo }) => async () => {
    const page = await browser.newPage();
    // Block images/fonts/media to speed up scraping
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4}', (r) =>
      r.abort()
    );

    try {
      const latestKey = `${watch.id}::${containerNo}`;
      const latest = latestMap.get(latestKey);
      const result = await processContainer(watch, containerNo, latest, page);
      if (result.skipped) skipped_delivered++;
      else if (result.changed) changed++;
      else if (result.error) errors++;
      else unchanged++;
    } finally {
      await page.close();
    }
  });

  await runWithConcurrency(tasks, MAX_CONCURRENCY);

  await browser.close();

  const durationMs = Date.now() - startedAt;
  const stats = {
    loaded: watches.length,
    skipped: skipped_no_valid_container + skipped_delivered,
    ok: unchanged,
    failed: errors,
    changed,
  };

  log('Done', {
    duration_ms: durationMs,
    ...stats,
    skipped_delivered,
    skipped_no_valid_container,
  });

  await saveRunToDb(stats);
}

main().catch((e) => {
  console.error('[check-containers] Fatal error:', e);
  process.exit(1);
});
