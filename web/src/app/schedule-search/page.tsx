import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import { normalizeVesselName } from '@/lib/normalize';
import ScheduleSearchTable, { type SearchRow } from './schedule-search-table';

export const dynamic = 'force-dynamic';

type SearchParams = {
  q?: string;
  source?: string;
  page?: string;
  pageSize?: string;
  sort?: string;
  etaWindow?: string;
  snr?: string;
};

type ScheduleEventRowRaw = {
  vessel_id: string;
  source: string;
  eta: string | null;
  etd: string | null;
  terminal: string | null;
  scraped_at: string;
  vessels: { name: string } | { name: string }[] | null;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
  });
}

function toDayDiff(newEta: string | null, oldEta: string | null): number | null {
  if (!newEta || !oldEta) return null;
  const newTs = Date.parse(newEta);
  const oldTs = Date.parse(oldEta);
  if (Number.isNaN(newTs) || Number.isNaN(oldTs)) return null;
  return Math.round((newTs - oldTs) / 86_400_000);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function applyFilters(
  query: any,
  params: {
    q: string;
    source: string;
    etaWindow: string;
  }
) {
  const { q, source, etaWindow } = params;
  let next = query;

  if (q) {
    next = next.ilike('vessels.name', `%${q}%`);
  }
  if (source === 'eurogate' || source === 'hhla') {
    next = next.eq('source', source);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const addDays = (days: number): string => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  };

  if (etaWindow === '7d') {
    next = next.gte('eta', nowIso).lte('eta', addDays(7));
  } else if (etaWindow === '14d') {
    next = next.gte('eta', nowIso).lte('eta', addDays(14));
  } else if (etaWindow === '30d') {
    next = next.gte('eta', nowIso).lte('eta', addDays(30));
  } else if (etaWindow === 'overdue') {
    next = next.lt('eta', nowIso);
  } else if (etaWindow === 'unknown') {
    next = next.is('eta', null);
  }

  return next;
}

function applySort(query: any, sort: string) {
  if (sort === 'eta_asc') {
    return query.order('eta', { ascending: true, nullsFirst: false });
  }
  if (sort === 'eta_desc') {
    return query.order('eta', { ascending: false, nullsFirst: false });
  }
  return query.order('scraped_at', { ascending: false });
}

function toRows(rows: ScheduleEventRowRaw[], previousEtaByKey: Map<string, string | null>): SearchRow[] {
  const mapped = rows.map((row) => {
    const vesselData = row.vessels;
    const vesselName = Array.isArray(vesselData)
      ? (vesselData[0]?.name ?? '-')
      : (vesselData?.name ?? '-');

    return {
      vessel_name: vesselName,
      vessel_name_normalized: normalizeVesselName(vesselName),
      source: row.source,
      eta: row.eta,
      etd: row.etd,
      terminal: row.terminal,
      scraped_at: row.scraped_at,
      previous_eta: previousEtaByKey.get(`${row.vessel_id}|${row.source}`) ?? null,
      eta_change_days: toDayDiff(row.eta, previousEtaByKey.get(`${row.vessel_id}|${row.source}`) ?? null),
    };
  });

  // keep latest entry per vessel/source to avoid duplicate history rows across terminals
  const seen = new Set<string>();
  const deduped: SearchRow[] = [];
  for (const row of mapped) {
    const key = `${row.vessel_name_normalized}|${row.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function withParams(base: Record<string, string>, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams(base);
  for (const [key, value] of Object.entries(patch)) {
    if (!value) next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `/schedule-search?${qs}` : '/schedule-search';
}

export default async function ScheduleSearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  const q = (searchParams.q ?? '').trim();
  const source = (searchParams.source ?? 'all').trim().toLowerCase();
  const sort = (searchParams.sort ?? 'scraped_desc').trim().toLowerCase();
  const etaWindow = (searchParams.etaWindow ?? 'all').trim().toLowerCase();
  const snr = (searchParams.snr ?? '').trim();
  const page = parsePositiveInt(searchParams.page, 1);
  const requestedPageSize = parsePositiveInt(searchParams.pageSize, 25);
  const pageSize = PAGE_SIZE_OPTIONS.includes(requestedPageSize as (typeof PAGE_SIZE_OPTIONS)[number])
    ? requestedPageSize
    : 25;

  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const baseQuery = admin
    .from('schedule_events')
    .select('vessel_id, source, eta, etd, terminal, scraped_at, vessels!inner(name)', { count: 'exact' });

  const filtered = applyFilters(baseQuery, { q, source, etaWindow });
  const sorted = applySort(filtered, sort);
  const pageQuery = sorted.range(from, to);

  const [pageRes, vesselCountRes, eventCountRes, lastRunRes, watchedRes] = await Promise.all([
    pageQuery,
    admin.from('vessels').select('id', { count: 'exact', head: true }),
    admin.from('schedule_events').select('id', { count: 'exact', head: true }),
    admin
      .from('scraper_runs')
      .select('status, started_at, completed_at, vessels_scraped')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('vessel_watches')
      .select('vessel_name_normalized, shipment_reference')
      .eq('user_id', session.user.id),
  ]);

  if (pageRes.error) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>Datenbank Suche</h1>
        <div style={styles.errorBox}>Fehler beim Laden: {pageRes.error.message}</div>
      </div>
    );
  }

  const pageRowsRaw = (pageRes.data ?? []) as ScheduleEventRowRaw[];
  const pageVesselIds = Array.from(new Set(pageRowsRaw.map((r) => r.vessel_id).filter(Boolean)));

  let previousEtaByKey = new Map<string, string | null>();
  if (pageVesselIds.length > 0) {
    const { data: recentRows } = await admin
      .from('schedule_events')
      .select('vessel_id, source, eta, scraped_at')
      .in('vessel_id', pageVesselIds)
      .order('scraped_at', { ascending: false })
      .limit(6000);

    const latestByKey = new Map<string, string | null>();
    for (const row of recentRows ?? []) {
      const key = `${row.vessel_id}|${row.source}`;
      if (!latestByKey.has(key)) {
        latestByKey.set(key, row.eta);
        continue;
      }
      if (!previousEtaByKey.has(key)) {
        previousEtaByKey.set(key, row.eta);
      }
    }
  }

  const rows = toRows(pageRowsRaw, previousEtaByKey);
  const totalFilteredCount = pageRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));

  const baseParams: Record<string, string> = {};
  if (q) baseParams.q = q;
  if (source !== 'all') baseParams.source = source;
  if (sort !== 'scraped_desc') baseParams.sort = sort;
  if (etaWindow !== 'all') baseParams.etaWindow = etaWindow;
  if (snr) baseParams.snr = snr;
  if (pageSize !== 25) baseParams.pageSize = String(pageSize);

  const exportHref = withParams(baseParams, {});
  const watchedRows = (watchedRes.data ?? []) as Array<{
    vessel_name_normalized: string;
    shipment_reference: string | null;
  }>;

  const watched = watchedRows.map((r) => r.vessel_name_normalized);
  const shipmentByVessel = watchedRows.reduce<Record<string, string[]>>((acc, row) => {
    if (!row.shipment_reference) return acc;
    const values = row.shipment_reference
     .split(/[;,\n]/)
      .map((v) => v.trim())
      .filter(Boolean);

    if (values.length === 0) return acc;
    const existing = acc[row.vessel_name_normalized] ?? [];
    for (const value of values) {
      if (!existing.includes(value)) {
        existing.push(value);
      }
    }
    acc[row.vessel_name_normalized] = existing;
    return acc;
  }, {});
  const lastRun = lastRunRes.data;
  const lastRunText = lastRun
    ? `${formatDateTime(lastRun.started_at)} (${lastRun.status})`
    : 'Kein Lauf gefunden';

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Datenbank Suche</h1>
      <p style={styles.subtitle}>
        Volltextsuche über alle gespeicherten Datensätze mit Export und Watchlist-Quick-Add.
      </p>

      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Letzter Scraper Lauf</div>
          <div style={styles.statValueSmall}>{lastRunText}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Daten in der Datenbank</div>
          <div style={styles.statValue}>{eventCountRes.count ?? 0}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Schiffsanzahl</div>
          <div style={styles.statValue}>{vesselCountRes.count ?? 0}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Treffer (mit Filtern)</div>
          <div style={styles.statValue}>{totalFilteredCount}</div>
        </div>
      </div>

      <form method="GET" style={styles.filters}>
        <input type="text" name="q" defaultValue={q} placeholder="Vessel suchen (z.B. NORDICA)" style={styles.input} />
        <input type="text" name="snr" defaultValue={snr} placeholder="S-Nr. suchen (z.B. S00226629)" style={styles.input} />
        <select name="source" defaultValue={source} style={styles.select}>
          <option value="all">Alle Quellen</option>
          <option value="eurogate">Eurogate</option>
          <option value="hhla">HHLA</option>
        </select>
        <select name="etaWindow" defaultValue={etaWindow} style={styles.select}>
          <option value="all">Alle ETA</option>
          <option value="7d">ETA in 7 Tagen</option>
          <option value="14d">ETA in 14 Tagen</option>
          <option value="30d">ETA in 30 Tagen</option>
          <option value="overdue">ETA in der Vergangenheit</option>
          <option value="unknown">Ohne ETA</option>
        </select>
        <select name="sort" defaultValue={sort} style={styles.select}>
          <option value="scraped_desc">Neueste Scrapes zuerst</option>
          <option value="eta_asc">ETA aufsteigend</option>
          <option value="eta_desc">ETA absteigend</option>
        </select>
        <select name="pageSize" defaultValue={String(pageSize)} style={styles.select}>
          <option value="25">25 / Seite</option>
          <option value="50">50 / Seite</option>
          <option value="100">100 / Seite</option>
        </select>
        <button type="submit" style={styles.btnPrimary}>
          Filtern
        </button>
        <a href={withParams(baseParams, { page: undefined })} style={styles.btnGhost}>
          Reset
        </a>
        <a href={`/api/schedule-search/export?${new URLSearchParams(baseParams).toString()}`} style={styles.btnExport}>
          CSV Export
        </a>
      </form>

      <div style={styles.quickWrap}>
        <a href={withParams(baseParams, { etaWindow: '7d', page: '1' })} style={styles.quickChip}>Nächste 7 Tage</a>
        <a href={withParams(baseParams, { etaWindow: 'unknown', page: '1' })} style={styles.quickChip}>Ohne ETA</a>
        <a href={withParams(baseParams, { source: 'eurogate', page: '1' })} style={styles.quickChip}>Nur Eurogate</a>
        <a href={withParams(baseParams, { source: 'hhla', page: '1' })} style={styles.quickChip}>Nur HHLA</a>
      </div>

      <ScheduleSearchTable
        rows={rows}
        initiallyWatched={watched}
        initialShipmentByVessel={shipmentByVessel}
        initialSnrFilter={snr}
      />

      <div style={styles.pager}>
        <span style={styles.pagerText}>
          Seite {Math.min(page, totalPages)} von {totalPages}
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {page > 1 ? (
            <a href={withParams(baseParams, { page: String(page - 1) })} style={styles.btnGhost}>
              Zurück
            </a>
          ) : (
            <span style={styles.btnDisabled}>Zurück</span>
          )}
          {page < totalPages ? (
            <a href={withParams(baseParams, { page: String(page + 1) })} style={styles.btnPrimary}>
              Weiter
            </a>
          ) : (
            <span style={styles.btnDisabled}>Weiter</span>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    padding: '32px 24px',
    maxWidth: '1280px',
    margin: '0 auto',
  },
  pageTitle: {
    margin: '0 0 6px',
    fontSize: '24px',
    fontWeight: 700,
  },
  subtitle: {
    margin: '0 0 20px',
    color: 'var(--text-secondary)',
    fontSize: '14px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
    marginBottom: '18px',
  },
  statCard: {
    backgroundColor: 'var(--surface)',
    borderRadius: '10px',
    padding: '16px',
    border: '1px solid var(--border)',
  },
  statLabel: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    marginBottom: '6px',
  },
  statValue: {
    fontSize: '28px',
    fontWeight: 700,
  },
  statValueSmall: {
    fontSize: '13px',
    fontWeight: 600,
  },
  filters: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '10px',
  },
  quickWrap: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  quickChip: {
    fontSize: '12px',
    border: '1px solid var(--border-strong)',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--surface-muted)',
    borderRadius: '999px',
    padding: '6px 10px',
    textDecoration: 'none',
  },
  input: {
    flex: 1,
    minWidth: '240px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    fontSize: '14px',
  },
  select: {
    minWidth: '170px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    fontSize: '14px',
    backgroundColor: 'var(--surface)',
  },
  btnPrimary: {
    padding: '10px 14px',
    backgroundColor: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'none',
    fontSize: '14px',
    display: 'inline-flex',
    alignItems: 'center',
  },
  btnGhost: {
    padding: '10px 14px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-strong)',
    borderRadius: '8px',
    fontWeight: 600,
    textDecoration: 'none',
    fontSize: '14px',
    display: 'inline-flex',
    alignItems: 'center',
  },
  btnExport: {
    padding: '10px 14px',
    backgroundColor: '#0f766e',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    textDecoration: 'none',
    fontSize: '14px',
    display: 'inline-flex',
    alignItems: 'center',
  },
  btnDisabled: {
    padding: '10px 14px',
    backgroundColor: '#e5e7eb',
    color: '#94a3b8',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '14px',
  },
  pager: {
    marginTop: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  },
  pagerText: {
    fontSize: '13px',
    color: '#64748b',
  },
  errorBox: {
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
  },
};
