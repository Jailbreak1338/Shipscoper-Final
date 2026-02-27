import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { sendResendEmail, buildWatchlistEmail } from '@/lib/resend';

function parseShipmentRefs(input: string | null | undefined): string[] {
  return String(input ?? '')
    .split(/[;,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function buildShipmentSourceLines(rows: Array<{ shipment_reference: string | null; shipper_source?: string | null; container_source?: string | null }>): Array<{ shipmentReference: string; source: string | null }> {
  const out: Array<{ shipmentReference: string; source: string | null }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const source = String(row.shipper_source ?? row.container_source ?? '').trim() || null;
    for (const ref of parseShipmentRefs(row.shipment_reference)) {
      const key = `${ref}::${source ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ shipmentReference: ref, source });
    }
  }
  return out;
}

async function loadShipmentSourceLines(
  supabase: ReturnType<typeof createRouteHandlerClient>,
  userId: string,
  normalizedVessel: string
): Promise<Array<{ shipmentReference: string; source: string | null }>> {
  const withSource = await supabase
    .from('vessel_watches')
    .select('shipment_reference, shipper_source, container_source')
    .eq('user_id', userId)
    .eq('vessel_name_normalized', normalizedVessel);

  if (withSource.error?.message?.includes('shipper_source')) {
    const fallback = await supabase
      .from('vessel_watches')
      .select('shipment_reference, container_source')
      .eq('user_id', userId)
      .eq('vessel_name_normalized', normalizedVessel);
    if (fallback.error) return [];
    return buildShipmentSourceLines((fallback.data ?? []) as Array<{ shipment_reference: string | null; container_source?: string | null }>);
  }

  if (withSource.error) return [];
  return buildShipmentSourceLines((withSource.data ?? []) as Array<{ shipment_reference: string | null; shipper_source?: string | null; container_source?: string | null }>);
}

/** PATCH /api/watchlist/[id] — toggle notification or update fields */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (typeof body.notification_enabled === 'boolean') {
    updates.notification_enabled = body.notification_enabled;
  }
  if (typeof body.shipment_reference === 'string') {
    updates.shipment_reference = body.shipment_reference.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('vessel_watches')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .select()
    .single();

  if (error) {
    console.error('Failed to update watch:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Email when notifications are turned on
  if (body.notification_enabled === true && session.user.email) {
    const shipmentSourceLines = await loadShipmentSourceLines(supabase, session.user.id, data.vessel_name_normalized);
    sendResendEmail({
      to: session.user.email,
      subject: `Watch aktiviert: ${data.vessel_name}`,
      html: buildWatchlistEmail({
        vesselName: data.vessel_name,
        shipmentReference: data.shipment_reference ?? null,
        eta: data.last_known_eta ?? null,
        isUpdate: false,
        source: data.shipper_source ?? data.container_source ?? null,
        mode: data.shipment_mode ?? (String(data.container_reference ?? '').trim() ? 'FCL' : 'LCL'),
        shipmentSourceLines,
      }),
    }).catch((e) => console.error('[watchlist] email error:', e));
  }

  return NextResponse.json({ watch: data });
}

/** DELETE /api/watchlist/[id] — remove a vessel from watchlist */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('vessel_watches')
    .delete()
    .eq('id', params.id)
    .eq('user_id', session.user.id);

  if (error) {
    console.error('Failed to delete watch:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
