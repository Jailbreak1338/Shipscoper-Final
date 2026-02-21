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
      'id, vessel_name, vessel_name_normalized, shipment_reference, container_reference, container_source, notification_enabled'
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

  // 3. Batch-load current ETAs from latest_schedule
  const normalizedNames = [
    ...new Set(filtered.map((w) => w.vessel_name_normalized).filter(Boolean)),
  ];
  const { data: schedules } = await admin
    .from('latest_schedule')
    .select('name_normalized, eta')
    .in('name_normalized', normalizedNames);

  const etaMap = new Map((schedules ?? []).map((s) => [s.name_normalized, s.eta as string | null]));

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

  // 5. Build enriched Sendungen — one entry per (watch × container_no)
  const sendungen = filtered.flatMap((w) => {
    const eta = etaMap.get(w.vessel_name_normalized) ?? null;
    const containerNos = parseContainerNos(w.container_reference);

    return containerNos.map((containerNo) => {
      const status = statusMap.get(`${w.id}::${containerNo}`);
      return {
        watch_id: w.id,
        vessel_name: w.vessel_name,
        vessel_name_normalized: w.vessel_name_normalized,
        shipment_reference: w.shipment_reference,
        container_source: w.container_source,
        notification_enabled: w.notification_enabled,
        eta,
        container_no: containerNo,
        terminal: status?.terminal ?? null,
        provider: status?.provider ?? null,
        normalized_status: status?.normalized_status ?? null,
        status_raw: status?.status_raw ?? null,
        scraped_at: status?.scraped_at ?? null,
      };
    });
  });

  return NextResponse.json({ sendungen });
}
