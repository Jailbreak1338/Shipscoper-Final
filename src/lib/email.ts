/**
 * Transactional email adapter.
 *
 * Supported providers (set via EMAIL_PROVIDER env var):
 *   "resend"  – Resend.com API (default, no SDK dependency needed)
 *   "ses"     – Amazon SES via @aws-sdk/client-ses
 *   "none"    – Disable sending (log only)
 *
 * Required ENV:
 *   EMAIL_PROVIDER         resend | ses | none   (default: resend)
 *   EMAIL_FROM             Sender address / "Name <addr>" string
 *
 * Resend ENV:
 *   RESEND_API_KEY
 *
 * SES ENV (optional, only when EMAIL_PROVIDER=ses):
 *   SES_REGION             e.g. eu-central-1
 *   SES_ACCESS_KEY_ID
 *   SES_SECRET_ACCESS_KEY
 *
 * Optional:
 *   MAKE_WEBHOOK_URL       If set, also POST a JSON payload to Make.com
 */

const log = (msg: string) => console.log(`[email] ${msg}`);
const warn = (msg: string) => console.warn(`[email] WARN ${msg}`);

// ── Shared types ──────────────────────────────────────────────────────────────

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text fallback */
  text?: string;
}

// ── Resend adapter ────────────────────────────────────────────────────────────

async function sendViaResend(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const from = process.env.EMAIL_FROM || 'Shipscoper <noreply@shipscoper.com>';

  const body = JSON.stringify({
    from,
    to: [payload.to],
    subject: payload.subject,
    html: payload.html,
    ...(payload.text ? { text: payload.text } : {}),
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${detail}`);
  }

  const json = (await res.json()) as { id?: string };
  log(`Resend accepted message id=${json.id ?? 'unknown'} to=${payload.to}`);
}

// ── Amazon SES adapter ────────────────────────────────────────────────────────

async function sendViaSes(payload: EmailPayload): Promise<void> {
  // Dynamic import so @aws-sdk/client-ses is optional
  let SESClient: typeof import('@aws-sdk/client-ses').SESClient;
  let SendEmailCommand: typeof import('@aws-sdk/client-ses').SendEmailCommand;
  try {
    const ses = await import('@aws-sdk/client-ses');
    SESClient = ses.SESClient;
    SendEmailCommand = ses.SendEmailCommand;
  } catch {
    throw new Error(
      '@aws-sdk/client-ses is not installed. ' +
        'Run: npm install @aws-sdk/client-ses'
    );
  }

  const region = process.env.SES_REGION;
  const accessKeyId = process.env.SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'SES_REGION, SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY must be set'
    );
  }

  const from = process.env.EMAIL_FROM || 'noreply@shipscoper.com';

  const client = new SESClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  await client.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [payload.to] },
      Message: {
        Subject: { Data: payload.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: payload.html, Charset: 'UTF-8' },
          ...(payload.text
            ? { Text: { Data: payload.text, Charset: 'UTF-8' } }
            : {}),
        },
      },
    })
  );

  log(`SES accepted message to=${payload.to}`);
}

// ── Make.com webhook (optional side-channel) ──────────────────────────────────

async function notifyMakeWebhook(
  data: Record<string, unknown>
): Promise<void> {
  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      warn(`Make webhook returned ${res.status}`);
    } else {
      log(`Make webhook notified (${res.status})`);
    }
  } catch (err) {
    warn(`Make webhook failed: ${(err as Error).message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Send a transactional email using the configured provider. */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const provider = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();

  if (provider === 'none') {
    log(`[none] Would send to=${payload.to} subject="${payload.subject}"`);
    return;
  }

  if (provider === 'ses') {
    await sendViaSes(payload);
  } else {
    // default: resend
    await sendViaResend(payload);
  }
}

// ── Container notification email builders ─────────────────────────────────────

export interface ContainerNotificationData {
  to: string;
  shipment_reference: string | null;
  container_no: string;
  provider: string;
  terminal: string | null;
  normalized_status: string;
  status_raw: string;
  event_type: string;
  discharge_order_ts: string | null;
}

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  } catch {
    return iso;
  }
}

export async function sendContainerNotification(
  data: ContainerNotificationData
): Promise<void> {
  const eventLabels: Record<string, string> = {
    container_discharged: 'Container entladen (Discharged)',
    container_ready: 'Container bereit zur Verladung',
    container_delivered_out: 'Container ausgeliefert',
  };

  const label = eventLabels[data.event_type] ?? data.event_type;
  const subject = `${label}: ${data.container_no}${data.shipment_reference ? ` (${data.shipment_reference})` : ''}`;

  const html = `
<html>
<body style="font-family:Arial,sans-serif;color:#333;max-width:560px;margin:0 auto;">
  <h2 style="color:#1a1a2e;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">
    Container Status Update
  </h2>
  <table style="border-collapse:collapse;width:100%;">
    <tr>
      <td style="padding:8px 12px;background:#f5f7fa;font-weight:600;width:40%;">Ereignis</td>
      <td style="padding:8px 12px;color:#1d4ed8;font-weight:700;">${label}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;background:#f5f7fa;font-weight:600;">Container-Nr.</td>
      <td style="padding:8px 12px;font-family:monospace;font-size:15px;">${data.container_no}</td>
    </tr>
    ${data.shipment_reference ? `
    <tr>
      <td style="padding:8px 12px;background:#f5f7fa;font-weight:600;">Sendung (S-Nr.)</td>
      <td style="padding:8px 12px;">${data.shipment_reference}</td>
    </tr>` : ''}
    <tr>
      <td style="padding:8px 12px;background:#f5f7fa;font-weight:600;">Status</td>
      <td style="padding:8px 12px;">${data.status_raw}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;background:#f5f7fa;font-weight:600;">Terminal</td>
      <td style="padding:8px 12px;">${data.terminal ?? '—'}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;background:#f5f7fa;font-weight:600;">Provider</td>
      <td style="padding:8px 12px;">${data.provider.toUpperCase()}</td>
    </tr>
    ${data.discharge_order_ts ? `
    <tr>
      <td style="padding:8px 12px;background:#f5f7fa;font-weight:600;">Entladeauftrag</td>
      <td style="padding:8px 12px;">${formatTs(data.discharge_order_ts)}</td>
    </tr>` : ''}
  </table>
  <p style="margin-top:24px;font-size:12px;color:#888;">
    Diese Benachrichtigung wurde automatisch von Shipscoper gesendet.<br>
    Watchlist verwalten: /watchlist
  </p>
</body>
</html>`;

  await sendEmail({ to: data.to, subject, html });

  // Optional Make.com side-channel
  await notifyMakeWebhook({
    event_type: data.event_type,
    container_no: data.container_no,
    shipment_reference: data.shipment_reference,
    provider: data.provider,
    terminal: data.terminal,
    normalized_status: data.normalized_status,
    status_raw: data.status_raw,
    sent_to: data.to,
    timestamp: new Date().toISOString(),
  });
}
