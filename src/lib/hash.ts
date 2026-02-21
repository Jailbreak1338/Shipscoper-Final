import { createHash } from 'crypto';
import type { ContainerScrapeResult } from './types.js';

/**
 * Compute a stable SHA-256 fingerprint of the scraped container state.
 * Only includes semantically significant fields so cosmetic text changes
 * (whitespace, punctuation) do not create spurious events.
 */
export function computeStatusHash(result: ContainerScrapeResult): string {
  const payload = {
    provider: result.provider,
    terminal: result.terminal ?? null,
    status_raw: result.status_raw,
    normalized_status: result.normalized_status,
    ready_for_loading: result.ready_for_loading ?? null,
    discharge_order_status: result.discharge_order_status ?? null,
    discharge_order_ts: result.discharge_order_ts ?? null,
    delivered_out: result.delivered_out,
  };
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}
