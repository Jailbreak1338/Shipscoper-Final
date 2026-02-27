import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { normalizeVesselName } from '@/lib/normalize';
import ScheduleSearchTable, { type SearchRow } from './schedule-search-table';
import { Card, CardContent } from '@/components/ui/card';

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
  if (!value) return '—';
  return new Date(value).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
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

function applyFilters(query: any, params: { q: string; source: string; etaWindow: string }) {
  const { q, source, etaWindow } = params;
  let next = query;
  if (q) next = next.ilike('vessels.name', `%${q}%`);
  if (source === 'eurogate' || source === 'hhla') next = next.eq('source', source);
  const now = new Date();
  const nowIso = now.toISOString();
  const addDays = (days: number): string => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  };
  if (etaWindow === '7d') next = next.gte('eta', nowIso).lte('eta', addDays(7));
  else if (etaWindow === '14d') next = next.gte('eta', nowIso).lte('eta', addDays(14));
  else if (etaWindow === '30d') next = next.gte('eta', nowIso).lte('eta', addDays(30));
  else if (etaWindow === 'overdue') next = next.lt('eta', nowIso);
  else if (etaWindow === 'unknown') next = next.is('eta', null);
  return next;
}

function applySort(query: any, sort: string) {
  if (sort === 'eta_asc') return query.order('eta', { ascending: true, nullsFirst: false });
  if (sort === 'eta_desc') return query.order('eta', { ascending: false, nullsFirst: false });
  return query.order('scraped_at', { ascending: false });
}

function toRows(rows: ScheduleEventRowRaw[], previousEtaByKey: Map<string, string | null>): SearchRow[] {
  const mapped = rows.map((row) => {
    const vesselData = row.vessels;
    const vesselName = Array.isArray(vesselData) ? (vesselData[0]?.name ?? '-') : (vesselData?.name ?? '-');
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

export default async function ScheduleSearchPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createServerComponentClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const q = (searchParams.q ?? '').trim();
  const source = (searchParams.source ?? 'all').trim().toLowerCase();
  const sort = (searchParams.sort ?? 'eta_asc').trim().toLowerCase();
  const etaWindow = (searchParams.etaWindow ?? 'all').trim().toLowerCase();
  const snr = (searchParams.snr ?? '').trim();
  const page = parsePositiveInt(searchParams.page, 1);
  const requestedPageSize = parsePositiveInt(searchParams.pageSize, 25);
  const pageSize = PAGE_SIZE_OPTIONS.includes(requestedPageSize as (typeof PAGE_SIZE_OPTIONS)[number]) ? requestedPageSize : 25;

  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let snrVesselIds: string[] | null = null;
  if (snr) {
    const { data: snrWatches } = await supabase
      .from('vessel_watches').select('vessel_name_normalized').eq('user_id', user.id).ilike('shipment_reference', `%${snr}%`);
    const snrNormalizedNames = [...new Set((snrWatches ?? []).map((w: { vessel_name_normalized: string }) => w.vessel_name_normalized).filter(Boolean))];
    if (snrNormalizedNames.length > 0) {
      // Query vessels directly (reliable real table, not a view)
      const { data: snrVessels } = await admin.from('vessels').select('id').in('name_normalized', snrNormalizedNames);
      snrVesselIds = (snrVessels ?? []).map((v: { id: string }) => v.id).filter(Boolean);
    } else {
      snrVesselIds = [];
    }
  }

  let baseQuery = admin.from('schedule_events').select('vessel_id, source, eta, etd, terminal, scraped_at, vessels!inner(name)', { count: 'exact' });
  if (snrVesselIds !== null) {
    const ids = snrVesselIds.length > 0 ? snrVesselIds : ['00000000-0000-0000-0000-000000000000'];
    baseQuery = (baseQuery as any).in('vessel_id', ids);
  }

  const filtered = applyFilters(baseQuery, { q, source, etaWindow });
  const sorted = applySort(filtered, sort);
  const pageQuery = sorted.range(from, to);

  const [pageRes, vesselCountRes, eventCountRes, lastRunRes] = await Promise.all([
    pageQuery,
    admin.from('vessels').select('id', { count: 'exact', head: true }),
    admin.from('schedule_events').select('id', { count: 'exact', head: true }),
    admin.from('scraper_runs').select('status, started_at, completed_at, vessels_scraped').order('started_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  let watchedRows: Array<{ vessel_name_normalized: string; shipment_reference: string | null; container_reference: string | null; container_source: string | null; shipper_source: string | null }> = [];
  {
    const withShipper = await supabase
      .from('vessel_watches')
      .select('vessel_name_normalized, shipment_reference, container_reference, container_source, shipper_source')
      .eq('user_id', user.id);

    if (withShipper.error?.message?.includes('shipper_source')) {
      const fallback = await supabase
        .from('vessel_watches')
        .select('vessel_name_normalized, shipment_reference, container_reference, container_source')
        .eq('user_id', user.id);
      if (fallback.error) {
        console.error('Failed to load watchlist source mapping fallback:', fallback.error);
      } else {
        watchedRows = (fallback.data ?? []).map((row: { vessel_name_normalized: string; shipment_reference: string | null; container_reference: string | null; container_source: string | null }) => ({
          ...row,
          shipper_source: null,
        }));
      }
    } else if (withShipper.error) {
      console.error('Failed to load watchlist source mapping:', withShipper.error);
    } else {
      watchedRows = (withShipper.data ?? []) as typeof watchedRows;
    }
  }

  if (pageRes.error) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Datenbank Suche</h1>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
          Fehler beim Laden: {pageRes.error.message}
        </div>
      </div>
    );
  }

  const pageRowsRaw = (pageRes.data ?? []) as ScheduleEventRowRaw[];
  const pageVesselIds = Array.from(new Set(pageRowsRaw.map((r) => r.vessel_id).filter(Boolean)));

  let previousEtaByKey = new Map<string, string | null>();
  if (pageVesselIds.length > 0) {
    const { data: recentRows } = await admin
      .from('schedule_events').select('vessel_id, source, eta, scraped_at').in('vessel_id', pageVesselIds).order('scraped_at', { ascending: false }).limit(6000);
    const latestByKey = new Map<string, string | null>();
    for (const row of recentRows ?? []) {
      const key = `${row.vessel_id}|${row.source}`;
      if (!latestByKey.has(key)) { latestByKey.set(key, row.eta); continue; }
      if (!previousEtaByKey.has(key)) previousEtaByKey.set(key, row.eta);
    }
  }

  const rows = toRows(pageRowsRaw, previousEtaByKey);
  const totalFilteredCount = pageRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));

  const baseParams: Record<string, string> = {};
  if (q) baseParams.q = q;
  if (source !== 'all') baseParams.source = source;
  if (sort !== 'eta_asc') baseParams.sort = sort;
  if (etaWindow !== 'all') baseParams.etaWindow = etaWindow;
  if (snr) baseParams.snr = snr;
  if (pageSize !== 25) baseParams.pageSize = String(pageSize);

  const listSourceByVessel = watchedRows.reduce<Record<string, string[]>>((acc, row) => {
    const src = (row.shipper_source ?? row.container_source ?? '').trim();
    if (!src) return acc;
    const key = row.vessel_name_normalized;
    const existing = acc[key] ?? [];
    if (!existing.includes(src)) existing.push(src);
    acc[key] = existing;
    return acc;
  }, {});
  const buildByVessel = (rows: typeof watchedRows, field: 'shipment_reference' | 'container_reference'): Record<string, string[]> =>
    rows.reduce<Record<string, string[]>>((acc, row) => {
      const raw = row[field];
      if (!raw) return acc;
      const values = raw.split(/[;,\n]/).map((v) => v.trim()).filter(Boolean);
      if (values.length === 0) return acc;
      const existing = acc[row.vessel_name_normalized] ?? [];
      for (const value of values) { if (!existing.includes(value)) existing.push(value); }
      acc[row.vessel_name_normalized] = existing;
      return acc;
    }, {});

  const shipmentByVessel = buildByVessel(watchedRows, 'shipment_reference');
  const containerByVessel = buildByVessel(watchedRows, 'container_reference');
  const lastRun = lastRunRes.data;
  const lastRunText = lastRun ? `${formatDateTime(lastRun.started_at)} (${lastRun.status})` : '—';

  const inputCls = 'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground';

  return (
    <div className="max-w-[1280px] mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Datenbank Suche</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Volltextsuche über alle gespeicherten Datensätze mit Export
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Letzter Scraper-Lauf', value: lastRunText, small: true },
          { label: 'Datensätze gesamt', value: String(eventCountRes.count ?? 0) },
          { label: 'Schiffe in DB', value: String(vesselCountRes.count ?? 0) },
          { label: 'Treffer (Filter)', value: String(totalFilteredCount) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{s.label}</p>
              <p className={s.small ? 'text-sm font-semibold text-foreground' : 'text-2xl font-bold text-foreground'}>
                {s.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Form */}
      <form method="GET" className="flex flex-wrap gap-2.5 items-center">
        <input type="text" name="q" defaultValue={q} placeholder="Vessel suchen…" className={`${inputCls} flex-1 min-w-44`} />
        <input type="text" name="snr" defaultValue={snr} placeholder="S-Nr. suchen…" className={`${inputCls} flex-1 min-w-44`} />
        <select aria-label="Quelle" name="source" defaultValue={source} className={`${inputCls} min-w-36`}>
          <option value="all">Alle Quellen</option>
          <option value="eurogate">Eurogate</option>
          <option value="hhla">HHLA</option>
        </select>
        <select aria-label="ETA-Zeitfenster" name="etaWindow" defaultValue={etaWindow} className={`${inputCls} min-w-40`}>
          <option value="all">Alle ETA</option>
          <option value="7d">ETA in 7 Tagen</option>
          <option value="14d">ETA in 14 Tagen</option>
          <option value="30d">ETA in 30 Tagen</option>
          <option value="overdue">ETA vergangen</option>
          <option value="unknown">Ohne ETA</option>
        </select>
        <select aria-label="Sortierung" name="sort" defaultValue={sort} className={`${inputCls} min-w-44`}>
          <option value="eta_asc">ETA aufsteigend</option>
          <option value="eta_desc">ETA absteigend</option>
          <option value="scraped_desc">Neueste Scrapes zuerst</option>
        </select>
        <select aria-label="Einträge pro Seite" name="pageSize" defaultValue={String(pageSize)} className={`${inputCls} min-w-28`}>
          <option value="25">25 / Seite</option>
          <option value="50">50 / Seite</option>
          <option value="100">100 / Seite</option>
        </select>
        <button type="submit" className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          Filtern
        </button>
        <a href={withParams(baseParams, { page: undefined })} className="h-10 px-4 rounded-md border border-input bg-background text-foreground text-sm font-medium hover:bg-accent transition-colors flex items-center">
          Reset
        </a>
        <a
          href={`/api/schedule-search/export?${new URLSearchParams(baseParams).toString()}`}
          className="h-10 px-4 rounded-md bg-teal-700 text-white text-sm font-medium hover:bg-teal-600 transition-colors flex items-center"
        >
          CSV Export
        </a>
      </form>

      {/* Quick chips */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Nächste 7 Tage', patch: { etaWindow: '7d', page: '1' } },
          { label: 'Ohne ETA', patch: { etaWindow: 'unknown', page: '1' } },
          { label: 'Nur Eurogate', patch: { source: 'eurogate', page: '1' } },
          { label: 'Nur HHLA', patch: { source: 'hhla', page: '1' } },
        ].map((chip) => (
          <a
            key={chip.label}
            href={withParams(baseParams, chip.patch)}
            className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
          >
            {chip.label}
          </a>
        ))}
      </div>

      {/* Results table */}
      <ScheduleSearchTable
        rows={rows}
        initialShipmentByVessel={shipmentByVessel}
        initialContainerByVessel={containerByVessel}
        initialListSourceByVessel={listSourceByVessel}
        initialSnrFilter={snr}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
        <p className="text-xs text-muted-foreground">
          Seite {Math.min(page, totalPages)} von {totalPages}
        </p>
        <div className="flex gap-2">
          {page > 1 ? (
            <a href={withParams(baseParams, { page: String(page - 1) })} className="h-9 px-4 rounded-md border border-input bg-background text-foreground text-sm font-medium hover:bg-accent transition-colors flex items-center">
              Zurück
            </a>
          ) : (
            <span className="h-9 px-4 rounded-md bg-muted text-muted-foreground text-sm font-medium flex items-center opacity-40 cursor-not-allowed">
              Zurück
            </span>
          )}
          {page < totalPages ? (
            <a href={withParams(baseParams, { page: String(page + 1) })} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center">
              Weiter
            </a>
          ) : (
            <span className="h-9 px-4 rounded-md bg-muted text-muted-foreground text-sm font-medium flex items-center opacity-40 cursor-not-allowed">
              Weiter
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
