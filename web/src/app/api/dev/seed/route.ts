import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Seed endpoint is disabled in production' },
      { status: 403 }
    );
  }

  try {
    const { supabaseAdmin } = await import('@/lib/supabaseServer');

    const testVessels = [
      { name: 'MSC OSCAR', name_normalized: 'MSC OSCAR' },
      { name: 'EVER GIVEN', name_normalized: 'EVER GIVEN' },
      { name: 'CMA CGM MARCO POLO', name_normalized: 'CMA CGM MARCO POLO' },
      { name: 'HAPAG LLOYD EXPRESS', name_normalized: 'HAPAG LLOYD EXPRESS' },
      { name: 'MAERSK SEALAND', name_normalized: 'MAERSK SEALAND' },
      { name: 'COSCO SHIPPING TAURUS', name_normalized: 'COSCO SHIPPING TAURUS' },
      { name: 'MOL TRIUMPH', name_normalized: 'MOL TRIUMPH' },
      { name: 'OOCL HONG KONG', name_normalized: 'OOCL HONG KONG' },
    ];

    // Upsert vessels
    const { data: vessels, error: vesselError } = await supabaseAdmin
      .from('vessels')
      .upsert(testVessels, { onConflict: 'name_normalized' })
      .select();

    if (vesselError) {
      throw new Error(`Failed to seed vessels: ${vesselError.message}`);
    }

    if (!vessels || vessels.length === 0) {
      throw new Error('No vessels returned after upsert');
    }

    // Create schedule events
    const now = new Date();
    const terminals = ['CTB', 'CTH', 'CTA', 'EUROGATE', 'HHLA CTA', 'HHLA CTB'];
    const sources = ['eurogate', 'hhla'];

    const events = vessels.map((v, i) => {
      const eta = new Date(now);
      eta.setDate(eta.getDate() + i + 1);
      eta.setHours(6 + i * 2, 0, 0, 0);

      const etd = new Date(eta);
      etd.setHours(etd.getHours() + 12);

      return {
        vessel_id: v.id,
        source: sources[i % sources.length],
        eta: eta.toISOString(),
        etd: etd.toISOString(),
        terminal: terminals[i % terminals.length],
        scraped_at: now.toISOString(),
      };
    });

    const { error: eventError } = await supabaseAdmin
      .from('schedule_events')
      .upsert(events, {
        onConflict: 'vessel_id,source,eta,terminal',
      });

    if (eventError) {
      throw new Error(`Failed to seed events: ${eventError.message}`);
    }

    return NextResponse.json({
      message: 'Seed data created successfully',
      vessels: vessels.length,
      events: events.length,
    });
  } catch (error) {
    console.error('seed error:', error);
    const message =
      error instanceof Error ? error.message : 'Seed failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
