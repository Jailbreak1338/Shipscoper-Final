/**
 * HHLA container status scraper — coast.hhla.de/containerauskunft
 *
 * Flow:
 *  1. Open  https://coast.hhla.de/containerauskunft?containerid=<NO>
 *  2. Click "Suchen" if present
 *  3. Click the result card/accordion row (contains terminal code like "CTB")
 *  4. Wait for detail section ("Umschlag" or "Entladeauftrag")
 *  5. Parse fields from page text
 *  6. Capture rawText for debug
 *
 * Debug: set HEADLESS=false in .env to watch the browser.
 */

import type { Page } from 'playwright';
import type { ContainerScrapeResult, NormalizedStatus } from '../lib/types.js';

const HHLA_BASE =
  process.env.HHLA_CONTAINER_URL ?? 'https://coast.hhla.de/containerauskunft';

const log = (msg: string) => console.log(`[hhla] ${msg}`);
const warn = (msg: string) => console.warn(`[hhla] WARN ${msg}`);

// ── Field extraction helpers ─────────────────────────────────────────────────

function extractLine(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  return m ? (m[1] ?? m[0]).trim() : null;
}

/** Parse page body text into structured fields. */
function parseHhlaText(text: string): Omit<
  ContainerScrapeResult,
  'provider' | 'container_no' | 'raw_text' | 'scraped_at'
> {
  const lc = text.toLowerCase();

  // Terminal (e.g. "CTB", "CTA", "O'Swaldkai")
  const terminal =
    extractLine(text, /Terminal[:\s]+([^\n\r]+)/i) ??
    extractLine(text, /\b(CTB|CTA|O'Swaldkai|Buchardkai|Burchardkai|Altenwerder)\b/i);

  // Shipping line / Reeder
  const shipping_line = extractLine(text, /Reeder[:\s]+([^\n\r]+)/i);

  // ISO code
  const iso_code = extractLine(text, /ISO[- ]?Code[:\s]+([^\n\r]+)/i);

  // Bereit zur Verladung (Ja / Nein)
  const readyRaw = extractLine(text, /Bereit zur Verladung[:\s]+(Ja|Nein)/i);
  const ready_for_loading = readyRaw
    ? readyRaw.toLowerCase() === 'ja'
    : null;

  // Entladeauftrag status + optional timestamp
  // Pattern: "Entladeauftrag  Erledigt  24.01.2026 08:23"
  const entladeMatch = text.match(
    /Entladeauftrag[:\s]+([^\n\r\d]+?)(?:\s+(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2})?))?(?:\n|$)/i
  );
  const discharge_order_status = entladeMatch?.[1]?.trim() ?? null;
  const discharge_order_ts_raw = entladeMatch?.[2]?.trim() ?? null;
  const discharge_order_ts = parseGermanDateTime(discharge_order_ts_raw);

  // delivered_out: page contains "ausgeliefert"
  const delivered_out = lc.includes('ausgeliefert');

  // Status raw — pick the most specific matching term
  let status_raw = 'Unbekannt';
  if (lc.includes('ausgeliefert')) {
    status_raw = 'Ausgeliefert';
  } else if (lc.includes('erledigt')) {
    status_raw = 'Erledigt';
  } else if (lc.includes('vorgemeldet')) {
    status_raw = 'Vorgemeldet';
  } else if (lc.includes('avisiert')) {
    status_raw = 'Avisiert';
  }

  // Normalize: DELIVERED_OUT > READY > DISCHARGED > PREANNOUNCED
  let normalized_status: NormalizedStatus = 'PREANNOUNCED';
  if (delivered_out) {
    normalized_status = 'DELIVERED_OUT';
  } else if (ready_for_loading === true) {
    normalized_status = 'READY';
  } else if (discharge_order_status?.toLowerCase().includes('erledigt')) {
    normalized_status = 'DISCHARGED';
  }

  const parsed_json: Record<string, unknown> = {
    terminal,
    shipping_line,
    iso_code,
    ready_for_loading,
    discharge_order_status,
    discharge_order_ts,
    status_raw,
    normalized_status,
  };

  return {
    terminal,
    shipping_line,
    iso_code,
    status_raw,
    normalized_status,
    ready_for_loading,
    discharge_order_status,
    discharge_order_ts,
    delivered_out,
    parsed_json,
  };
}

function parseGermanDateTime(raw: string | null): string | null {
  if (!raw) return null;
  // "24.01.2026 08:23" → ISO
  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '00', min = '00'] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00+01:00`;
}

// ── Main scraper ─────────────────────────────────────────────────────────────

/**
 * Scrape HHLA container status for a single container number.
 * Accepts an already-opened Playwright Page (caller manages browser lifecycle).
 * Returns null on error (caller decides whether to retry).
 */
export async function scrapeHhla(
  containerNo: string,
  page: Page
): Promise<ContainerScrapeResult | null> {
  const url = `${HHLA_BASE}?containerid=${encodeURIComponent(containerNo)}`;
  log(`Scraping ${containerNo} → ${url}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    // Step 1: Click "Suchen" button if it appears (some flows need it)
    try {
      const suchenBtn = page.locator(
        'button:has-text("Suchen"), input[type="submit"][value*="Such"]'
      );
      if (await suchenBtn.first().isVisible({ timeout: 3_000 })) {
        await suchenBtn.first().click();
        await page.waitForTimeout(2_000);
        log(`${containerNo}: clicked Suchen`);
      }
    } catch {
      // Suchen button not present — continue
    }

    // Step 2: Find and click the result card / accordion row
    // The card typically shows the terminal code (CTB, CTA) + status text
    const accordionLocator = page.locator(
      [
        // Clickable elements with terminal/status text
        'div[class*="card"]:has-text("CTB")',
        'div[class*="card"]:has-text("CTA")',
        'div[class*="accordion"]',
        'div[role="button"]',
        'tr[class*="result"]',
        // Fallback: any visible element containing terminal abbreviations
        ':is(div, tr, button, li):visible:has-text("CTB")',
        ':is(div, tr, button, li):visible:has-text("CTA")',
        ':is(div, tr, button, li):visible:has-text("vorgemeldet")',
        ':is(div, tr, button, li):visible:has-text("Avisiert")',
      ].join(', ')
    );

    try {
      const card = accordionLocator.first();
      if (await card.isVisible({ timeout: 5_000 })) {
        await card.click();
        log(`${containerNo}: clicked accordion card`);

        // Wait for detail section to expand
        await page.waitForFunction(
          (keywords) =>
            keywords.some((kw) =>
              document.body.innerText.toLowerCase().includes(kw)
            ),
          ['umschlag', 'entladeauftrag', 'bereit zur verladung', 'reeder'],
          { timeout: 10_000 }
        );
      }
    } catch {
      warn(`${containerNo}: could not click accordion (may already be expanded)`);
    }

    const rawText = await page.innerText('body');

    if (
      rawText.toLowerCase().includes('nicht gefunden') ||
      rawText.toLowerCase().includes('kein ergebnis') ||
      rawText.toLowerCase().includes('no result')
    ) {
      warn(`${containerNo}: container not found on HHLA`);
      return null;
    }

    const parsed = parseHhlaText(rawText);

    log(
      `${containerNo}: status=${parsed.normalized_status} ` +
        `terminal=${parsed.terminal ?? '?'} raw="${parsed.status_raw}"`
    );

    return {
      provider: 'hhla',
      container_no: containerNo,
      ...parsed,
      raw_text: rawText,
      scraped_at: new Date().toISOString(),
    };
  } catch (err) {
    warn(`${containerNo}: scrape error — ${(err as Error).message}`);
    return null;
  }
}
