import { NextResponse } from 'next/server';

/**
 * Deprecated endpoint.
 * Test email functionality has been removed from UI and backend.
 */
export async function GET() {
  return NextResponse.json({ error: 'Test email status endpoint removed' }, { status: 410 });
}
