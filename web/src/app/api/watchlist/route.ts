import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { normalizeVesselName } from '@/lib/normalize';
import { sendResendEmail, buildWatchlistEmail } from '@/lib/resend';


function parseShipmentRefs(input: string | null | undefined): string[] {
  return String(input ?? '')
    .split(/[;,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

async function isShipmentRefAlreadyAssigned(
  supabase: ReturnType<typeof createRouteHandlerClient>,
  userId: string,
  shipmentRef: string,
  allowedVesselNormalized?: string
): Promise<boolean> {
  const { data } = await supabase
    .from('vessel_watches')
    .select('vessel_name_normalized, shipment_reference')
    .eq('user_id', userId);

  for (const row of (data ?? []) as Array<{ vessel_name_normalized: string; shipment_reference: string | null }>) {
    if (allowedVesselNormalized && row.vessel_name_normalized === allowedVesselNormalized) continue;
    const refs = parseShipmentRefs(row.shipment_reference);
    if (refs.includes(shipmentRef)) {
      return true;
    }
  }
  return false;
}


/** GET /api/watchlist — list user's watched vessels */
export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('vessel_watches')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(200); // Prevent resource exhaustion via unbounded result sets

  if (error) {
    console.error('Failed to fetch watchlist:', error);
    return NextResponse.json({ error: 'Failed to load watchlist' }, { status: 500 });
  }

  // Enrich with fresh ETAs from latest_schedule (overrides potentially stale last_known_eta)
  if ((data ?? []).length > 0) {
    try {
      const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
      const admin = getSupabaseAdmin();
      const normalizedNames = [
        ...new Set((data ?? []).map((w) => w.vessel_name_normalized).filter(Boolean)),
      ];
      if (normalizedNames.length > 0) {
        const { data: schedules } = await admin
          .from('latest_schedule')
          .select('name_normalized, eta')
          .in('name_normalized', normalizedNames);
        const etaMap = new Map(
          (schedules ?? []).map((s) => [s.name_normalized, s.eta as string | null])
        );
        for (const watch of data ?? []) {
          if (watch.vessel_name_normalized && etaMap.has(watch.vessel_name_normalized)) {
            watch.last_known_eta = etaMap.get(watch.vessel_name_normalized) ?? watch.last_known_eta;
          }
        }
      }
    } catch {
      // Non-fatal: fall back to stored last_known_eta
    }

    // Enrich with container statuses from container_latest_status
    try {
      const watchIds = (data ?? []).map((w) => w.id);
      if (watchIds.length > 0) {
        const { data: statuses } = await admin
          .from('container_latest_status')
          .select('watch_id, container_no, normalized_status, status_raw, terminal, updated_at, ready_for_loading, discharge_order_status')
          .in('watch_id', watchIds);
        const statusMap = new Map<string, typeof statuses>();
        for (const s of (statuses ?? [])) {
          if (!statusMap.has(s.watch_id)) statusMap.set(s.watch_id, []);
          statusMap.get(s.watch_id)!.push(s);
        }
        for (const watch of data ?? []) {
          (watch as Record<string, unknown>).container_statuses = statusMap.get(watch.id) ?? [];
        }
      }
    } catch {
      // Non-fatal
    }
  }

  return NextResponse.json({ watches: data });
}

/** POST /api/watchlist — add a vessel to watchlist */
export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const vesselName = (body.vesselName ?? '').trim();
  const shipmentReference = (body.shipmentReference ?? '').trim() || null;

  if (!vesselName) {
    return NextResponse.json(
      { error: 'Vessel name is required' },
      { status: 400 }
    );
  }

  const normalized = normalizeVesselName(vesselName);

  // Look up current ETA from latest_schedule
  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();

  const { data: schedule } = await admin
    .from('latest_schedule')
    .select('eta')
    .eq('name_normalized', normalized)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single();

  const currentEta = schedule?.eta ?? null;

  if (shipmentReference) {
    const alreadyAssigned = await isShipmentRefAlreadyAssigned(
      supabase,
      session.user.id,
      shipmentReference,
      normalized
    );
    if (alreadyAssigned) {
      return NextResponse.json(
        { error: 'Diese S-Nr. ist bereits einem anderen Schiff zugeordnet.' },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabase.from('vessel_watches').insert({
    user_id: session.user.id,
    vessel_name: vesselName,
    vessel_name_normalized: normalized,
    shipment_reference: shipmentReference,
    last_known_eta: currentEta,
  }).select().single();

  if (error) {
    if (error.code === '23505') {
      const { data: existing, error: existingErr } = await supabase
        .from('vessel_watches')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('vessel_name_normalized', normalized)
        .maybeSingle();

      if (existingErr) {
        console.error('Failed to fetch existing watch after conflict:', existingErr);
        return NextResponse.json({ error: existingErr.message }, { status: 500 });
      }

      if (!existing) {
        return NextResponse.json(
          { error: 'This vessel is already on your watchlist' },
          { status: 409 }
        );
      }

      if (shipmentReference) {
        const alreadyAssigned = await isShipmentRefAlreadyAssigned(
          supabase,
          session.user.id,
          shipmentReference,
          normalized
        );
        if (alreadyAssigned) {
          return NextResponse.json(
            { error: 'Diese S-Nr. ist bereits einem anderen Schiff zugeordnet.' },
            { status: 409 }
          );
        }

        const merged = Array.from(
          new Set(
            parseShipmentRefs(existing.shipment_reference).concat(shipmentReference)
          )
        ).join(', ');

        if (merged !== (existing.shipment_reference || '')) {
          const { data: updated, error: updateErr } = await supabase
            .from('vessel_watches')
            .update({ shipment_reference: merged })
            .eq('id', existing.id)
            .select()
            .single();

          if (updateErr) {
            console.error('Failed to update shipment reference on existing watch:', updateErr);
            return NextResponse.json({ error: updateErr.message }, { status: 500 });
          }

          // Email: watch updated with new S-Nr.
          if (session.user.email) {
            sendResendEmail({
              to: session.user.email,
              subject: `Watch aktualisiert: ${vesselName}`,
              html: buildWatchlistEmail({
                vesselName,
                shipmentReference: shipmentReference,
                eta: currentEta,
                isUpdate: true,
              }),
            }).catch((e) => console.error('[watchlist] email error:', e));
          }

          return NextResponse.json({ watch: updated, updatedExisting: true }, { status: 200 });
        }
      }

      return NextResponse.json({ watch: existing, updatedExisting: false }, { status: 200 });
    }
    console.error('Failed to add watch:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Email: new watch created
  if (session.user.email) {
    sendResendEmail({
      to: session.user.email,
      subject: `Watch aktiviert: ${vesselName}`,
      html: buildWatchlistEmail({
        vesselName,
        shipmentReference,
        eta: currentEta,
        isUpdate: false,
      }),
    }).catch((e) => console.error('[watchlist] email error:', e));
  }

  return NextResponse.json({ watch: data }, { status: 201 });
}
