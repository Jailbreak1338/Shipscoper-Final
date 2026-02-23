import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabaseServer';

// ISO 6346: 4 uppercase letters + 7 digits (e.g. MSCU1234567)
const CONTAINER_NO_RE = /^[A-Z]{4}\d{7}$/i;

function parseContainerNos(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => CONTAINER_NO_RE.test(s));
}

function toDayDiff(newDate: string | null, oldDate: string | null): number | null {
  if (!newDate || !oldDate) return null;
  const diff = Date.parse(newDate) - Date.parse(oldDate);
  if (isNaN(diff)) return null;
  return Math.round(diff / 86_400_000);
}

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();

  // 1. Load all vessel_watches with container_reference
  const { data: watches, error } = await supabase
    .from('vessel_watches')
    .select(
      'id, vessel_name, vessel_name_normalized, shipment_reference, container_reference, container_snr_pairs, container_source, notification_enabled'
    )
    .eq('user_id', session.user.id)
    .not('container_reference', 'is', null)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 2. Filter to watches that have at least one valid ISO 6346 container number
  const filtered = (watches ?? []).filter(
    (w) => parseContainerNos(w.container_reference).length > 0
  );

  if (filtered.length === 0) return NextResponse.json({ sendungen: [] });

  // 3. Batch-load current ETA, ETD, terminal + vessel_id from latest_schedule
  const normalizedNames = [
    ...new Set(filtered.map((w) => w.vessel_name_normalized).filter(Boolean)),
  ];
  const { data: schedules } = await admin
    .from('latest_schedule')
    .select('name_normalized, vessel_id, eta, etd, terminal')
    .in('name_normalized', normalizedNames);

  const etaMap = new Map((schedules ?? []).map((s) => [s.name_normalized, s.eta as string | null]));
  const etdMap = new Map((schedules ?? []).map((s) => [s.name_normalized, s.etd as string | null]));
  const vesselTerminalMap = new Map((schedules ?? []).map((s) => [s.name_normalized, s.terminal as string | null]));
  const vesselIdByName = new Map((schedules ?? []).map((s) => [s.name_normalized, s.vessel_id as string | null]));

  // 3b. Get previous ETA/ETD from schedule_events history (2nd most recent per vessel)
  const vesselIds = [
    ...new Set((schedules ?? []).map((s) => s.vessel_id as string).filter(Boolean)),
  ];
  const prevEtaByVesselId = new Map<string, string | null>();
  const prevEtdByVesselId = new Map<string, string | null>();

  if (vesselIds.length > 0) {
    const { data: recentEvents } = await admin
      .from('schedule_events')
      .select('vessel_id, source, eta, etd')
      .in('vessel_id', vesselIds)
      .order('scraped_at', { ascending: false })
      .limit(vesselIds.length * 6);

    const seenLatest = new Set<string>();
    for (const ev of recentEvents ?? []) {
      const srcKey = `${ev.vessel_id}|${ev.source}`;
      if (!seenLatest.has(srcKey)) {
        seenLatest.add(srcKey); // latest — skip, we have it from latest_schedule
      } else if (!prevEtaByVesselId.has(ev.vessel_id)) {
        prevEtaByVesselId.set(ev.vessel_id, ev.eta as string | null);
        prevEtdByVesselId.set(ev.vessel_id, ev.etd as string | null);
      }
    }
  }

  // 4. Batch-load latest container statuses (table may not exist yet if migration not run)
  const watchIds = filtered.map((w) => w.id);
  const statusMap = new Map<
    string,
    {
      terminal: string | null;
      provider: string | null;
      normalized_status: string | null;
      status_raw: string | null;
      scraped_at: string | null;
    }
  >();

  try {
    const { data: statuses } = await admin
      .from('container_latest_status')
      .select('watch_id, container_no, terminal, provider, normalized_status, status_raw, scraped_at')
      .in('watch_id', watchIds);

    for (const s of statuses ?? []) {
      statusMap.set(`${s.watch_id}::${s.container_no}`, {
        terminal: s.terminal,
        provider: s.provider,
        normalized_status: s.normalized_status,
        status_raw: s.status_raw,
        scraped_at: s.scraped_at,
      });
    }
  } catch {
    // Migration not yet run — show without status data
  }

  // 5. ONE row per container — use container_snr_pairs when available (exact Excel pairings),
  //    fall back to cross-product for old data that predates the migration.
  type ContainerSnrPair = { container_no: string; snr: string | null };

  const sendungen = filtered.flatMap((w) => {
    const eta = etaMap.get(w.vessel_name_normalized) ?? null;
    const etd = etdMap.get(w.vessel_name_normalized) ?? null;
    const vessel_terminal = vesselTerminalMap.get(w.vessel_name_normalized) ?? null;
    const vesselId = vesselIdByName.get(w.vessel_name_normalized) ?? null;
    const previous_eta = vesselId ? (prevEtaByVesselId.get(vesselId) ?? null) : null;
    const previous_etd = vesselId ? (prevEtdByVesselId.get(vesselId) ?? null) : null;
    const eta_change_days = toDayDiff(eta, previous_eta);
    const etd_change_days = toDayDiff(etd, previous_etd);

    const commonFields = {
      watch_id: w.id,
      vessel_name: w.vessel_name,
      vessel_name_normalized: w.vessel_name_normalized,
      container_source: w.container_source,
      notification_enabled: w.notification_enabled,
      eta,
      etd,
      previous_eta,
      previous_etd,
      eta_change_days,
      etd_change_days,
      vessel_terminal,
    };

    // Prefer exact per-row pairs from Excel upload (no cross-product)
    const pairs = w.container_snr_pairs as ContainerSnrPair[] | null;
    if (pairs && Array.isArray(pairs) && pairs.length > 0) {
      return pairs.map((pair) => {
        const status = statusMap.get(`${w.id}::${pair.container_no}`);
        return {
          ...commonFields,
          shipment_reference: pair.snr,
          container_no: pair.container_no,
          terminal: status?.terminal ?? null,
          provider: status?.provider ?? null,
          normalized_status: status?.normalized_status ?? null,
          status_raw: status?.status_raw ?? null,
          scraped_at: status?.scraped_at ?? null,
        };
      });
    }

    // Fallback: cross-product for rows without container_snr_pairs (old data)
    const containerNos = parseContainerNos(w.container_reference);
    const shipmentRefs = (w.shipment_reference ?? '')
      .split(/[,;\n]/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    const refs: (string | null)[] = shipmentRefs.length > 0 ? shipmentRefs : [null];

    return containerNos.flatMap((containerNo) => {
      const status = statusMap.get(`${w.id}::${containerNo}`);
      return refs.map((ref) => ({
        ...commonFields,
        shipment_reference: ref,
        container_no: containerNo,
        terminal: status?.terminal ?? null,
        provider: status?.provider ?? null,
        normalized_status: status?.normalized_status ?? null,
        status_raw: status?.status_raw ?? null,
        scraped_at: status?.scraped_at ?? null,
      }));
    });
  });

  return NextResponse.json({ sendungen });
}
