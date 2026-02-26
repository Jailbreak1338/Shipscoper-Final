import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

interface FlaggedRow {
  container_no: string;
  shipment_reference: string | null;
  delivery_date: string | null;
  etd: string | null;
  vessel_name: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildEmailHtml(rows: FlaggedRow[], userEmail: string): string {
  const rowsHtml = rows
    .map(
      (r) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace">${r.container_no}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${r.shipment_reference ?? '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${r.vessel_name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#ef4444;font-weight:600">${fmtDate(r.delivery_date)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${fmtDate(r.etd)}</td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8" /></head>
<body style="font-family:system-ui,sans-serif;color:#111827;padding:24px;max-width:700px">
  <h2 style="margin:0 0 8px">Auto Dispo: Anliefertermine prüfen</h2>
  <p style="color:#6b7280;margin:0 0 24px">
    Die folgenden Container haben ein <strong style="color:#ef4444">Anliefertermin vor dem ETD</strong> des Schiffes
    und müssen verschoben werden.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead>
      <tr style="background:#f9fafb">
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Container</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">S-Nr.</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Schiff</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Anliefertermin</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">ETD</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p style="margin-top:24px;color:#6b7280;font-size:13px">
    Diese E-Mail wurde automatisch von Shipscoper für ${escHtml(userEmail)} generiert.
  </p>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rows: FlaggedRow[] = Array.isArray(body.rows) ? body.rows : [];

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Keine rot markierten Container übergeben.' }, { status: 400 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM ?? 'Shipscoper <noreply@shipscoper.de>';

  if (!resendKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY nicht konfiguriert.' }, { status: 500 });
  }

  const userEmail = session.user.email!;
  const html = buildEmailHtml(rows, userEmail);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: emailFrom,
      to: userEmail,
      subject: `Auto Dispo: ${rows.length} Container müssen verschoben werden`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ error: 'E-Mail-Versand fehlgeschlagen', detail: err }, { status: 502 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
