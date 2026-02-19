import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

type ScheduleEventRowRaw = {
  source: string;
  eta: string | null;
  etd: string | null;
  terminal: string | null;
  scraped_at: string;
  vessels: { name: string } | { name: string }[] | null;
};

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

function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function rowToCsv(row: ScheduleEventRowRaw): string {
  const vesselData = row.vessels;
  const vesselName = Array.isArray(vesselData)
    ? (vesselData[0]?.name ?? '')
    : (vesselData?.name ?? '');

  const values = [
    vesselName,
    row.source ?? '',
    row.eta ?? '',
    row.etd ?? '',
    row.terminal ?? '',
    row.scraped_at ?? '',
  ];
  return values.map((v) => escapeCsvCell(String(v))).join(',');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  const source = (request.nextUrl.searchParams.get('source') ?? 'all').trim().toLowerCase();
  const sort = (request.nextUrl.searchParams.get('sort') ?? 'scraped_desc').trim().toLowerCase();
  const etaWindow = (request.nextUrl.searchParams.get('etaWindow') ?? 'all').trim().toLowerCase();

  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();

  const baseQuery = admin
    .from('schedule_events')
    .select('source, eta, etd, terminal, scraped_at, vessels!inner(name)');

  const filtered = applyFilters(baseQuery, { q, source, etaWindow });
  const sorted = applySort(filtered, sort);
  const { data, error } = await sorted.limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ScheduleEventRowRaw[];
  const header = 'vessel_name,source,eta,etd,terminal,scraped_at';
  const csv = `${header}\n${rows.map(rowToCsv).join('\n')}`;
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="schedule-search-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
