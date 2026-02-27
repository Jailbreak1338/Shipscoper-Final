import { NextResponse } from 'next/server';

/**
 * Deprecated endpoint.
 * Test email functionality has been removed from UI and backend.
 */
export async function POST() {
  return NextResponse.json({ error: 'Test email endpoint removed' }, { status: 410 });
}
