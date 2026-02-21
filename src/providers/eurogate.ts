/**
 * Eurogate container status scraper.
 *
 * Deep-links with _state/_unique URL fragments are unstable (Angular SPA),
 * so this provider always uses the search UI:
 *  1. Open EUROGATE_CONTAINER_URL (search homepage)
 *  2. Type container number into the search input
 *  3. Click "Suchen"
 *  4. Click accordion / triangle / status row if present
 *  5. Parse: Standort, Terminal, Bestandsstatus, Gesperrt, Zollfreigabe, Import Schiff
 *
 * Debug: set HEADLESS=false in .env to watch the browser.
 */

import type { Page } from 'playwright';
import type { ContainerScrapeResult, NormalizedStatus } from '../lib/types.js';

// Configure via EUROGATE_CONTAINER_URL env var.
// Default targets the public Eurogate Hamburg container inquiry portal.
const EUROGATE_BASE =
  process.env.EUROGATE_CONTAINER_URL ??
  'https://www.eurogate.eu/en/services/container-terminal-hamburg/';

const log = (msg: string) => console.log(`[eurogate] ${msg}`);
const warn = (msg: string) => console.warn(`[eurogate] WARN ${msg}`);

// ── Field extraction ─────────────────────────────────────────────────────────

function extractLine(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  return m ? (m[1] ?? m[0]).trim() : null;
}

function parseEurogateText(text: string): Omit<
  ContainerScrapeResult,
  'provider' | 'container_no' | 'raw_text' | 'scraped_at'
> {
  const lc = text.toLowerCase();

  // Standort / Terminal
  const terminal =
    extractLine(text, /Terminal[:\s]+([^\n\r]+)/i) ??
    extractLine(text, /Standort[:\s]+([^\n\r]+)/i);

  // Bestandsstatus
  const bestandsstatus = extractLine(
    text,
    /Bestandsstatus[:\s]+(Avisiert|Ausgeliefert|Eingelagert|[^\n\r]+)/i
  );

  // Gesperrt
  const gesperrtRaw = extractLine(text, /Gesperrt[:\s]+(Ja|Nein)/i);

  // Zollfreigabe
  const zollfreigabe = extractLine(text, /Zollfreigabe[:\s]+([^\n\r]+)/i);

  // Import Schiff
  const shipping_line = extractLine(text, /Import Schiff[:\s]+([^\n\r]+)/i);

  // delivered_out
  const delivered_out =
    (bestandsstatus?.toLowerCase() ?? '') === 'ausgeliefert' ||
    lc.includes('ausgeliefert');

  // status_raw
  const status_raw = bestandsstatus ?? (delivered_out ? 'Ausgeliefert' : 'Avisiert');

  // Normalize: DELIVERED_OUT > READY > DISCHARGED > PREANNOUNCED
  let normalized_status: NormalizedStatus = 'PREANNOUNCED';
  if (delivered_out) {
    normalized_status = 'DELIVERED_OUT';
  } else if (bestandsstatus?.toLowerCase().includes('eingelagert')) {
    normalized_status = 'DISCHARGED';
  } else if (lc.includes('avisiert') || lc.includes('vorgemeldet')) {
    normalized_status = 'PREANNOUNCED';
  }

  const parsed_json: Record<string, unknown> = {
    terminal,
    bestandsstatus,
    gesperrt: gesperrtRaw,
    zollfreigabe,
    shipping_line,
    status_raw,
    normalized_status,
  };

  return {
    terminal,
    shipping_line,
    iso_code: null,
    status_raw,
    normalized_status,
    ready_for_loading: null,
    discharge_order_status: null,
    discharge_order_ts: null,
    delivered_out,
    parsed_json,
  };
}

// ── Main scraper ─────────────────────────────────────────────────────────────

/**
 * Scrape Eurogate container status for a single container number.
 * Accepts an already-opened Playwright Page (caller manages browser lifecycle).
 * Returns null on error.
 */
export async function scrapeEurogate(
  containerNo: string,
  page: Page
): Promise<ContainerScrapeResult | null> {
  log(`Scraping ${containerNo} → ${EUROGATE_BASE}`);

  try {
    await page.goto(EUROGATE_BASE, { waitUntil: 'networkidle', timeout: 30_000 });

    // Step 1: Find search input and enter container number
    const inputLocator = page.locator(
      [
        'input[placeholder*="Container"]',
        'input[name*="container"]',
        'input[id*="container"]',
        'input[type="text"]',
        'input[type="search"]',
      ].join(', ')
    );

    try {
      const input = inputLocator.first();
      await input.waitFor({ state: 'visible', timeout: 10_000 });
      await input.fill(containerNo);
      log(`${containerNo}: filled search input`);
    } catch {
      warn(`${containerNo}: could not find search input`);
      return null;
    }

    // Step 2: Click "Suchen" button
    const suchenLocator = page.locator(
      [
        'button:has-text("Suchen")',
        'button:has-text("Search")',
        'input[type="submit"]',
        'button[type="submit"]',
      ].join(', ')
    );

    try {
      const btn = suchenLocator.first();
      await btn.waitFor({ state: 'visible', timeout: 5_000 });
      await btn.click();
      await page.waitForTimeout(2_000);
      log(`${containerNo}: clicked Suchen`);
    } catch {
      warn(`${containerNo}: could not click Suchen — trying Enter`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2_000);
    }

    // Step 3: Wait for results and click accordion / triangle if present
    try {
      await page.waitForFunction(
        (cno) =>
          document.body.innerText.includes(cno) ||
          document.body.innerText.toLowerCase().includes('bestandsstatus') ||
          document.body.innerText.toLowerCase().includes('avisiert') ||
          document.body.innerText.toLowerCase().includes('ausgeliefert'),
        containerNo,
        { timeout: 15_000 }
      );
    } catch {
      warn(`${containerNo}: timed out waiting for results`);
    }

    // Click accordion row / triangle to expand details
    const accordionLocator = page.locator(
      [
        // Triangle/expand icon patterns common in Angular/React apps
        'span[class*="triangle"]',
        'span[class*="expand"]',
        'button[class*="toggle"]',
        'div[class*="accordion"]',
        'tr[class*="result"]:visible',
        // Any clickable row containing the container number
        `tr:has-text("${containerNo}")`,
        `div:has-text("${containerNo}")`,
      ].join(', ')
    );

    try {
      const card = accordionLocator.first();
      if (await card.isVisible({ timeout: 5_000 })) {
        await card.click();
        await page.waitForTimeout(1_500);
        log(`${containerNo}: clicked accordion`);
      }
    } catch {
      // Already expanded or no accordion — continue
    }

    const rawText = await page.innerText('body');

    if (
      rawText.toLowerCase().includes('nicht gefunden') ||
      rawText.toLowerCase().includes('no result') ||
      rawText.toLowerCase().includes('kein ergebnis') ||
      !rawText.toLowerCase().includes(containerNo.toLowerCase())
    ) {
      warn(`${containerNo}: container not found on Eurogate`);
      return null;
    }

    const parsed = parseEurogateText(rawText);

    log(
      `${containerNo}: status=${parsed.normalized_status} ` +
        `terminal=${parsed.terminal ?? '?'} raw="${parsed.status_raw}"`
    );

    return {
      provider: 'eurogate',
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
