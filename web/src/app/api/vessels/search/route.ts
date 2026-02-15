import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

/** GET /api/vessels/search?q=<query> — search known vessels by name */
export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get('q') ?? '';
  if (q.length < 2) {
    return NextResponse.json({ vessels: [] });
  }

  const { data, error } = await supabase
    .from('vessels')
    .select('name, name_normalized')
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(10);

  if (error) {
    console.error('Vessel search failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ vessels: data });
}
