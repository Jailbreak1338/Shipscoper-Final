// ── Normalized container status ──────────────────────────────────────────────
// Priority (highest first): DELIVERED_OUT > READY > DISCHARGED > PREANNOUNCED
export type NormalizedStatus =
  | 'PREANNOUNCED'
  | 'DISCHARGED'
  | 'READY'
  | 'DELIVERED_OUT';

export type Provider = 'hhla' | 'eurogate';

// ── Raw scrape result returned by each provider ───────────────────────────────
export interface ContainerScrapeResult {
  provider: Provider;
  container_no: string;
  terminal: string | null;
  shipping_line: string | null;      // "Reeder" at HHLA
  iso_code: string | null;
  status_raw: string;
  normalized_status: NormalizedStatus;
  ready_for_loading: boolean | null; // "Bereit zur Verladung" (HHLA)
  discharge_order_status: string | null;
  discharge_order_ts: string | null; // ISO string if parsed
  delivered_out: boolean;
  parsed_json: Record<string, unknown>;
  raw_text: string;
  scraped_at: string;                // ISO string (UTC)
}

// ── Watch record loaded from vessel_watches ───────────────────────────────────
export interface ActiveWatch {
  id: string;
  user_id: string;
  vessel_name: string;
  shipment_reference: string | null;
  container_reference: string | null; // comma/space-separated container numbers
  container_source: 'HHLA' | 'EUROGATE' | 'AUTO' | null;
  notification_enabled: boolean;
}

// ── Existing status from container_latest_status ──────────────────────────────
export interface LatestStatus {
  id: string;
  watch_id: string;
  container_no: string;
  status_hash: string;
  normalized_status: NormalizedStatus;
}
