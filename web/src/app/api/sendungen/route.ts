import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabaseServer';

const CONTAINER_NO_RE = /^[A-Z]{4}\d{7}$/i;

function parseContainerNos(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => CONTAINER_NO_RE.test(s));
}

function toDayDiff(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const diff = Date.parse(a) - Date.parse(b);
  return isNaN(diff) ? null : Math.round(diff / 86_400_000);
}

function parseSNrs(raw: string | null): string[] {
  return (raw ?? '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();

  // Try to select container_snr_pairs; fall back without it if column doesn't exist
  const SELECT_WITH_PAIRS =
    'id, vessel_name, vessel_name_normalized, shipment_reference, container_reference, container_snr_pairs, container_source, shipper_source, shipment_mode, notification_enabled';
  const SELECT_WITHOUT_PAIRS =
    'id, vessel_name, vessel_name_normalized, shipment_reference, container_reference, container_source, shipper_source, shipment_mode, notification_enabled';

  let watches: Record<string, unknown>[] | null = null;
  let hasPairsColumn = true;

  {
    const res = await supabase
      .from('vessel_watches')
      .select(SELECT_WITH_PAIRS)
      .eq('user_id', session.user.id)
      .not('shipment_reference', 'is', null)
      .order('created_at', { ascending: false });

    if (res.error?.message?.includes('container_snr_pairs')) {
      hasPairsColumn = false;
      const fallback = await supabase
        .from('vessel_watches')
        .select(SELECT_WITHOUT_PAIRS)
        .eq('user_id', session.user.id)
        .not('shipment_reference', 'is', null)
        .order('created_at', { ascending: false });
      if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
      watches = (fallback.data ?? []) as Record<string, unknown>[];
    } else if (res.error) {
      return NextResponse.json({ error: res.error.message }, { status: 500 });
    } else {
      watches = (res.data ?? []) as Record<string, unknown>[];
    }
  }

  if (!watches || watches.length === 0) return NextResponse.json({ sendungen: [] });

  // ETA / ETD / terminal from latest_schedule
  const normalizedNames = [...new Set(watches.map((w) => w.vessel_name_normalized as string).filter(Boolean))];
  const { data: schedules } = await admin
    .from('latest_schedule')
    .select('name_normalized, vessel_id, eta, etd, terminal')
    .in('name_normalized', normalizedNames);

  const etaMap        = new Map((schedules ?? []).map((s) => [s.name_normalized, s.eta        as string | null]));
  const etdMap        = new Map((schedules ?? []).map((s) => [s.name_normalized, s.etd        as string | null]));
  const terminalMap   = new Map((schedules ?? []).map((s) => [s.name_normalized, s.terminal   as string | null]));
  const vesselIdMap   = new Map((schedules ?? []).map((s) => [s.name_normalized, s.vessel_id  as string | null]));

  // Previous ETA/ETD
  const vesselIds = [...new Set((schedules ?? []).map((s) => s.vessel_id as string).filter(Boolean))];
  const prevEtaMap = new Map<string, string | null>();
  const prevEtdMap = new Map<string, string | null>();
  if (vesselIds.length > 0) {
    const { data: events } = await admin
      .from('schedule_events').select('vessel_id, source, eta, etd')
      .in('vessel_id', vesselIds).order('scraped_at', { ascending: false })
      .limit(vesselIds.length * 6);
    const seen = new Set<string>();
    for (const ev of events ?? []) {
      const k = `${ev.vessel_id}|${ev.source}`;
      if (!seen.has(k)) { seen.add(k); }
      else if (!prevEtaMap.has(ev.vessel_id)) {
        prevEtaMap.set(ev.vessel_id, ev.eta as string | null);
        prevEtdMap.set(ev.vessel_id, ev.etd as string | null);
      }
    }
  }

  // Container statuses
  const watchIds = watches.filter((w) => parseContainerNos(w.container_reference as string | null).length > 0).map((w) => w.id as string);
  const statusMap = new Map<string, { terminal: string|null; provider: string|null; normalized_status: string|null; status_raw: string|null; scraped_at: string|null }>();
  if (watchIds.length > 0) {
    try {
      const { data: statuses } = await admin
        .from('container_latest_status')
        .select('watch_id, container_no, terminal, provider, normalized_status, status_raw, scraped_at')
        .in('watch_id', watchIds);
      for (const s of statuses ?? []) {
        statusMap.set(`${s.watch_id}::${s.container_no}`, { terminal: s.terminal, provider: s.provider, normalized_status: s.normalized_status, status_raw: s.status_raw, scraped_at: s.scraped_at });
      }
    } catch { /* migration not run */ }
  }

  // Build rows
  type Pair = { container_no: string; snr: string | null; delivery_date?: string | null };

  const sendungen = watches.flatMap((w) => {
    const norm   = w.vessel_name_normalized as string;
    const eta    = etaMap.get(norm) ?? null;
    const etd    = etdMap.get(norm) ?? null;
    const vid    = vesselIdMap.get(norm) ?? null;
    const common = {
      watch_id:             w.id,
      vessel_name:          w.vessel_name,
      vessel_name_normalized: norm,
      container_source:     w.container_source,
      shipper_source:       w.shipper_source,
      shipment_mode:        w.shipment_mode ?? (parseContainerNos(w.container_reference as string | null).length > 0 ? 'FCL' : 'LCL'),
      notification_enabled: w.notification_enabled,
      eta,
      etd,
      previous_eta:  vid ? (prevEtaMap.get(vid) ?? null) : null,
      previous_etd:  vid ? (prevEtdMap.get(vid) ?? null) : null,
      eta_change_days: toDayDiff(eta, vid ? (prevEtaMap.get(vid) ?? null) : null),
      etd_change_days: toDayDiff(etd, vid ? (prevEtdMap.get(vid) ?? null) : null),
      vessel_terminal: terminalMap.get(norm) ?? null,
    };

    const containerNos = parseContainerNos(w.container_reference as string | null);

    if (containerNos.length > 0) {
      // 1. Use exact pairs if column exists and is populated
      if (hasPairsColumn) {
        const pairs = w.container_snr_pairs as Pair[] | null;
        if (pairs && Array.isArray(pairs) && pairs.length > 0) {
          return pairs.map((p) => {
            const st = statusMap.get(`${w.id}::${p.container_no}`);
            return { ...common, has_container: true, shipment_reference: p.snr, container_no: p.container_no, delivery_date: p.delivery_date ?? null, terminal: st?.terminal ?? null, provider: st?.provider ?? null, normalized_status: st?.normalized_status ?? null, status_raw: st?.status_raw ?? null, scraped_at: st?.scraped_at ?? null };
          });
        }
      }

      // 2. Positional zip: containers[i] paired with snrs[i] — avoids cross-product
      const snrs = parseSNrs(w.shipment_reference as string | null);
      const len  = Math.max(containerNos.length, snrs.length);
      return Array.from({ length: len }, (_, i) => {
        const containerNo = containerNos[i] ?? containerNos[containerNos.length - 1];
        const snr         = snrs[i] ?? null;
        const st = statusMap.get(`${w.id}::${containerNo}`);
        return { ...common, has_container: true, shipment_reference: snr, container_no: containerNo, delivery_date: null, terminal: st?.terminal ?? null, provider: st?.provider ?? null, normalized_status: st?.normalized_status ?? null, status_raw: st?.status_raw ?? null, scraped_at: st?.scraped_at ?? null };
      });
    }

    // Stückgut/FCL fallback — one row per S-Nr
    const snrs = parseSNrs(w.shipment_reference as string | null);
    const isFclMode = String(w.shipment_mode ?? '').toUpperCase() === 'FCL';
    return (snrs.length > 0 ? snrs : [null]).map((snr) => ({
      ...common,
      has_container: isFclMode,
      shipment_reference: snr,
      container_no: isFclMode ? 'MANUELL' : '',
      delivery_date: null,
      terminal: null,
      provider: null,
      normalized_status: null,
      status_raw: null,
      scraped_at: null,
    }));
  });

  return NextResponse.json({ sendungen });
}
