import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { sendResendEmail, buildWatchlistEmail } from '@/lib/resend';

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
    sendResendEmail({
      to: session.user.email,
      subject: `Watch aktiviert: ${data.vessel_name}`,
      html: buildWatchlistEmail({
        vesselName: data.vessel_name,
        shipmentReference: data.shipment_reference ?? null,
        eta: data.last_known_eta ?? null,
        isUpdate: false,
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
