"""Send ETA change notification emails."""

import smtplib
import socket
import ssl
import time
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


def _resolve_smtp_host(host: str, port: int) -> list[str]:
    """Resolve SMTP host and return a compact list of IPs for diagnostics."""
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
        ips = []
        for info in infos:
            ip = info[4][0]
            if ip not in ips:
                ips.append(ip)
        return ips[:5]
    except Exception as exc:
        logger.warning(f"[email] DNS resolve failed host={host} port={port} err={exc!r}")
        return []




def _smtp_preflight(host: str, port: int, timeout: int, max_ips: int = 2) -> None:
    """Quick TCP connectivity probe to avoid long hangs across multiple addresses."""
    ips = _resolve_smtp_host(host, port)
    if not ips:
        return

    errors: list[str] = []
    for ip in ips[:max_ips]:
        started = time.monotonic()
        try:
            with socket.create_connection((ip, port), timeout=timeout):
                took_ms = int((time.monotonic() - started) * 1000)
                logger.info(
                    f"[email] smtp_preflight ok host={host} ip={ip} port={port} duration_ms={took_ms}"
                )
                return
        except Exception as exc:
            took_ms = int((time.monotonic() - started) * 1000)
            errors.append(f"{ip}:{type(exc).__name__}")
            logger.warning(
                "[email] smtp_preflight failed "
                f"host={host} ip={ip} port={port} duration_ms={took_ms} err={exc!r}"
            )

    raise TimeoutError(
        f"SMTP preflight failed host={host} port={port} checked_ips={errors}"
    )


def _send_via_smtp(
    *,
    msg: MIMEMultipart,
    address: str,
    password: str,
    smtp_server: str,
    smtp_port: int,
    smtp_timeout: int,
    smtp_security: str,
) -> dict:
    """Send one SMTP message with detailed connection diagnostics."""
    start = time.monotonic()
    _smtp_preflight(smtp_server, smtp_port, min(smtp_timeout, 4))
    resolved_ips = _resolve_smtp_host(smtp_server, smtp_port)
    logger.info(
        "[email] smtp_attempt start "
        f"server={smtp_server} port={smtp_port} security={smtp_security} timeout={smtp_timeout} "
        f"resolved_ips={resolved_ips}"
    )

    if smtp_security == "ssl":
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(
            smtp_server,
            smtp_port,
            timeout=smtp_timeout,
            context=context,
        ) as server:
            server.login(address, password)
            failed = server.send_message(msg)
    else:
        with smtplib.SMTP(smtp_server, smtp_port, timeout=smtp_timeout) as server:
            if smtp_security == "starttls":
                server.starttls(context=ssl.create_default_context())
            server.login(address, password)
            failed = server.send_message(msg)

    took_ms = int((time.monotonic() - start) * 1000)
    logger.info(
        "[email] smtp_attempt done "
        f"server={smtp_server} port={smtp_port} security={smtp_security} duration_ms={took_ms}"
    )

    return {"failed": failed, "duration_ms": took_ms}


def _deliver_message(msg: MIMEMultipart, to_email: str) -> None:
    """Centralized send logic with timeout fallback and rich logging."""
    address = env.get("EMAIL_ADDRESS", "")
    password = env.get("EMAIL_PASSWORD", "")
    smtp_server = env.get("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(env.get("SMTP_PORT", "587"))
    smtp_timeout = int(env.get("SMTP_TIMEOUT", "10"))
    smtp_security = env.get("SMTP_SECURITY", "starttls").strip().lower()

    if not address or not password:
        raise RuntimeError("EMAIL_ADDRESS and EMAIL_PASSWORD must be set")

    logger.info(
        "[email] delivery_config "
        f"to={to_email} from={address} server={smtp_server} port={smtp_port} "
        f"security={smtp_security} timeout={smtp_timeout}"
    )

    try:
        result = _send_via_smtp(
            msg=msg,
            address=address,
            password=password,
            smtp_server=smtp_server,
            smtp_port=smtp_port,
            smtp_timeout=smtp_timeout,
            smtp_security=smtp_security,
        )
    except (TimeoutError, socket.timeout) as exc:
        logger.error(
            "[email] smtp_timeout "
            f"server={smtp_server} port={smtp_port} security={smtp_security} err={exc!r}"
        )
        if smtp_security == "starttls" and smtp_port == 587:
            logger.warning(
                f"[email] smtp_fallback switching to implicit SSL server={smtp_server} port=465"
            )
            result = _send_via_smtp(
                msg=msg,
                address=address,
                password=password,
                smtp_server=smtp_server,
                smtp_port=465,
                smtp_timeout=smtp_timeout,
                smtp_security="ssl",
            )
        elif smtp_security == "ssl" and smtp_port == 465:
            logger.warning(
                f"[email] smtp_fallback switching to STARTTLS server={smtp_server} port=587"
            )
            result = _send_via_smtp(
                msg=msg,
                address=address,
                password=password,
                smtp_server=smtp_server,
                smtp_port=587,
                smtp_timeout=smtp_timeout,
                smtp_security="starttls",
            )
        else:
            raise
    except Exception as exc:
        logger.error(
            "[email] smtp_send_failed "
            f"server={smtp_server} port={smtp_port} security={smtp_security} err={exc!r}"
        )
        raise

    failed = result["failed"]
    if failed:
        raise RuntimeError("SMTP rejected recipients: " + str(failed))


def send_eta_notification(
    to_email: str,
    vessel_name: str,
    shipment_ref: str | None,
    old_eta: str | None,
    new_eta: str | None,
    delay_days: int,
) -> None:
    """Send an ETA change notification email via SMTP."""
    old_str = _format_eta(old_eta)
    new_str = _format_eta(new_eta)
    delay_text = f"+{delay_days} Tage" if delay_days > 0 else f"{delay_days} Tage"
    delay_color = "#d32f2f" if delay_days > 0 else "#2e7d32"

    subject = f"ETA-Änderung: {vessel_name}"
    if shipment_ref:
        subject += f" ({shipment_ref})"

    address = env.get("EMAIL_ADDRESS", "")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = address
    msg["To"] = to_email

    html_body = f"""\
<html>
<body style="font-family: Arial, sans-serif; color: #333;">
  <h2 style="color: #1a1a2e;">ETA-Änderung erkannt</h2>

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
      <td style="padding: 10px 14px; background: #f5f7fa; font-weight: 600;">Verzögerung</td>
      <td style="padding: 10px 14px; color: {delay_color}; font-weight: 600;">{delay_text}</td>
    </tr>
  </table>

  <p style="margin-top: 24px; font-size: 13px; color: #888;">
    Diese Benachrichtigung wurde gesendet, weil Sie dieses Vessel auf Ihrer Watchlist haben.<br>
    Verwalten Sie Ihre Watchlist unter: /watchlist
  </p>
</body>
</html>"""
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    _deliver_message(msg, to_email)
    logger.info(f"[email] ETA notification sent to {to_email} for {vessel_name}")


def send_test_notification(to_email: str) -> None:
    """Send a simple test email to verify SMTP delivery."""
    address = env.get("EMAIL_ADDRESS", "")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Shipscoper Test Email"
    msg["From"] = address
    msg["To"] = to_email
    msg.attach(
        MIMEText(
            (
                "Dies ist eine Test-E-Mail aus Shipscoper by Tim Kimmich.\n\n"
                "Wenn du diese Nachricht siehst, funktioniert der E-Mail-Versand."
            ),
            "plain",
            "utf-8",
        )
    )

    _deliver_message(msg, to_email)
    logger.info(f"[email] Test notification sent to {to_email}")
