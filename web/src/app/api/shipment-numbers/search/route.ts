import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ shipmentNumbers: [] });
  }

  const { data, error } = await supabase
    .from('upload_logs')
    .select('shipment_numbers, created_at')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('Shipment number search failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const qLower = q.toLowerCase();
  const matches = new Set<string>();

  for (const row of data ?? []) {
    const nums = Array.isArray(row.shipment_numbers) ? row.shipment_numbers : [];
    for (const n of nums) {
      const value = String(n ?? '').trim();
      if (!value) continue;
      if (value.toLowerCase().includes(qLower)) {
        matches.add(value);
      }
      if (matches.size >= 20) break;
    }
    if (matches.size >= 20) break;
  }

  return NextResponse.json({ shipmentNumbers: Array.from(matches).slice(0, 20) });
}
