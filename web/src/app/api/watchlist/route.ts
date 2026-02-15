import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { normalizeVesselName } from '@/lib/normalize';

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
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch watchlist:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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

  const { data, error } = await supabase.from('vessel_watches').insert({
    user_id: session.user.id,
    vessel_name: vesselName,
    vessel_name_normalized: normalized,
    shipment_reference: shipmentReference,
    last_known_eta: currentEta,
  }).select().single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'This vessel is already on your watchlist' },
        { status: 409 }
      );
    }
    console.error('Failed to add watch:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ watch: data }, { status: 201 });
}
