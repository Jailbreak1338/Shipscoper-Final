"""Send ETA change notification emails."""

import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo

from utils import env, logger

BERLIN_TZ = ZoneInfo("Europe/Berlin")


def _format_eta(iso_str: str | None) -> str:
    """Format an ISO datetime string to DD.MM.YYYY HH:MM (Berlin time)."""
    if not iso_str:
        return "Unbekannt"
    try:
        dt = datetime.fromisoformat(iso_str)
        return dt.astimezone(BERLIN_TZ).strftime("%d.%m.%Y %H:%M")
    except (ValueError, TypeError):
        return iso_str


def send_eta_notification(
    to_email: str,
    vessel_name: str,
    shipment_ref: str | None,
    old_eta: str | None,
    new_eta: str | None,
    delay_days: int,
) -> None:
    """Send an ETA change notification email via SMTP."""

    address = env.get("EMAIL_ADDRESS", "")
    password = env.get("EMAIL_PASSWORD", "")
    smtp_server = env.get("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(env.get("SMTP_PORT", "587"))

    if not address or not password:
        raise RuntimeError("EMAIL_ADDRESS and EMAIL_PASSWORD must be set")

    old_str = _format_eta(old_eta)
    new_str = _format_eta(new_eta)
    delay_text = f"+{delay_days} Tage" if delay_days > 0 else f"{delay_days} Tage"
    delay_color = "#d32f2f" if delay_days > 0 else "#2e7d32"

    subject = f"ETA-Aenderung: {vessel_name}"
    if shipment_ref:
        subject += f" ({shipment_ref})"

    html_body = f"""\
<html>
<body style="font-family: Arial, sans-serif; color: #333;">
  <h2 style="color: #1a1a2e;">ETA-Aenderung erkannt</h2>

  <table style="border-collapse: collapse; width: 100%; max-width: 560px;">
    <tr>
      <td style="padding: 10px 14px; background: #f5f7fa; font-weight: 600;">Vessel</td>
      <td style="padding: 10px 14px;">{vessel_name}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; background: #f5f7fa; font-weight: 600;">Sendung</td>
      <td style="padding: 10px 14px;">{shipment_ref or "-"}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; background: #f5f7fa; font-weight: 600;">Alte ETA</td>
      <td style="padding: 10px 14px;">{old_str}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; background: #f5f7fa; font-weight: 600;">Neue ETA</td>
      <td style="padding: 10px 14px; color: #d32f2f; font-weight: 600;">{new_str}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; background: #f5f7fa; font-weight: 600;">Verzoegerung</td>
      <td style="padding: 10px 14px; color: {delay_color}; font-weight: 600;">{delay_text}</td>
    </tr>
  </table>

  <p style="margin-top: 24px; font-size: 13px; color: #888;">
    Diese Benachrichtigung wurde gesendet, weil Sie dieses Vessel auf Ihrer Watchlist haben.<br>
    Verwalten Sie Ihre Watchlist unter: /watchlist
  </p>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = address
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(smtp_server, smtp_port) as server:
        server.starttls()
        server.login(address, password)
        failed = server.send_message(msg)
        if failed:
            raise RuntimeError("SMTP rejected recipients: " + str(failed))

    logger.info(f"[email] ETA notification sent to {to_email} for {vessel_name}")


def send_test_notification(to_email: str) -> None:
    """Send a simple test email to verify SMTP delivery."""
    address = env.get("EMAIL_ADDRESS", "")
    password = env.get("EMAIL_PASSWORD", "")
    smtp_server = env.get("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(env.get("SMTP_PORT", "587"))

    if not address or not password:
        raise RuntimeError("EMAIL_ADDRESS and EMAIL_PASSWORD must be set")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "ETA Watchlist Test Email"
    msg["From"] = address
    msg["To"] = to_email
    msg.attach(
        MIMEText(
            (
                "Dies ist eine Test-E-Mail aus ETA Sea Tracker.\n\n"
                "Wenn du diese Nachricht siehst, funktioniert der E-Mail-Versand."
            ),
            "plain",
            "utf-8",
        )
    )

    with smtplib.SMTP(smtp_server, smtp_port) as server:
        server.starttls()
        server.login(address, password)
        failed = server.send_message(msg)
        if failed:
            raise RuntimeError("SMTP rejected recipients: " + str(failed))

    logger.info(f"[email] Test notification sent to {to_email}")
