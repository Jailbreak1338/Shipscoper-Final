/**
 * Minimal Resend helper for Next.js API routes and server actions.
 * Uses fetch directly — no SDK dependency needed.
 */

export interface ResendPayload {
  to: string | string[];
  subject: string;
  html: string;
}

export async function sendResendEmail(payload: ResendPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[resend] RESEND_API_KEY not set — skipping email');
    return;
  }

  const from = process.env.EMAIL_FROM || 'Shipscoper <noreply@shipscoper.de>';
  const to = Array.isArray(payload.to) ? payload.to : [payload.to];

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject: payload.subject, html: payload.html }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }
}

// ── Email template helpers ────────────────────────────────────────────────────

function emailShell(body: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#1a1a2e;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:520px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:#0D1117;padding:24px 32px;">
            <span style="font-size:22px;font-weight:700;letter-spacing:-0.5px;">
              <span style="color:#00C9A7;">Ship</span><span style="color:#ffffff;">scoper</span>
            </span>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:32px;">${body}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #eee;font-size:11px;color:#aaa;text-align:center;">
            Shipscoper · Hamburg · <a href="https://shipscoper.de/impressum" style="color:#aaa;">Impressum</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildWaitlistEmail(): string {
  return emailShell(`
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a2e;">Du bist auf der Warteliste!</h2>
    <p style="margin:0 0 12px;line-height:1.6;color:#444;">
      Danke für dein Interesse an Shipscoper. Du wirst einer der Ersten sein,
      die Zugang zur Plattform erhalten.
    </p>
    <div style="margin:24px 0;padding:16px;background:#f0fdf9;border-left:4px solid #00C9A7;border-radius:4px;">
      <p style="margin:0;font-size:14px;color:#1a5c4a;line-height:1.5;">
        Shipscoper verbindet sich direkt mit <strong>Eurogate &amp; HHLA</strong> und liefert
        automatische Vessel-ETAs, Container-Status und Excel-Export — ohne Copy-Paste.
      </p>
    </div>
    <p style="margin:0 0 24px;line-height:1.6;color:#444;">
      Wir melden uns per E-Mail, sobald dein Zugang bereit ist.
    </p>
    <p style="margin:0;color:#888;font-size:13px;">— Tim Kimmich</p>
  `);
}

export function buildWatchlistEmail(opts: {
  vesselName: string;
  shipmentReference: string | null;
  eta: string | null;
  isUpdate: boolean;
  source?: string | null;
  mode?: 'LCL' | 'FCL' | string | null;
  shipmentSourceLines?: Array<{ shipmentReference: string; source: string | null }>;
}): string {
  const etaFormatted = opts.eta
    ? new Date(opts.eta).toLocaleString('de-DE', {
        timeZone: 'Europe/Berlin',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';


  const sourceValue = (opts.source ?? '').trim() || '—';
  const modeValue = String(opts.mode ?? '').trim().toUpperCase() || '—';
  const shipmentSourceRows = (opts.shipmentSourceLines ?? [])
    .filter((row) => row.shipmentReference)
    .map((row) => {
      const src = (row.source ?? '').trim() || '—';
      return `
      <tr>
        <td style="padding:10px 14px;background:#f5f7fa;font-weight:600;border-bottom:1px solid #eee;">S-Nr. / Source</td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;">${row.shipmentReference} (${src})</td>
      </tr>`;
    })
    .join('');

  const action = opts.isUpdate ? 'aktualisiert' : 'aktiviert';

  const html = emailShell(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">
      Vessel-Watch ${action}
    </h2>
    <p style="margin:0 0 24px;color:#666;font-size:14px;">
      ${opts.isUpdate ? 'Dein Watch wurde mit einer neuen S-Nr. ergänzt.' : 'Du erhältst eine Benachrichtigung, sobald sich die ETA ändert.'}
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:10px 14px;background:#f5f7fa;font-weight:600;width:40%;border-bottom:1px solid #eee;">Schiff</td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;">${opts.vesselName}</td>
      </tr>
      ${shipmentSourceRows || (opts.shipmentReference ? `
      <tr>
        <td style="padding:10px 14px;background:#f5f7fa;font-weight:600;border-bottom:1px solid #eee;">S-Nr.</td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;">${opts.shipmentReference}</td>
      </tr>` : '')}
      <tr>
        <td style="padding:10px 14px;background:#f5f7fa;font-weight:600;border-bottom:1px solid #eee;">Source</td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;">${sourceValue}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#f5f7fa;font-weight:600;border-bottom:1px solid #eee;">Mode</td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;">${modeValue}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#f5f7fa;font-weight:600;">Aktuelle ETA</td>
        <td style="padding:10px 14px;color:${opts.eta ? '#00876a' : '#999'};font-weight:${opts.eta ? '600' : '400'};">
          ${etaFormatted}
        </td>
      </tr>
    </table>

    <p style="margin:24px 0 0;font-size:13px;color:#888;">
      Watch verwalten: <a href="https://shipscoper.de/watchlist" style="color:#00C9A7;">shipscoper.de/watchlist</a>
    </p>
  `);

  return html;
}
