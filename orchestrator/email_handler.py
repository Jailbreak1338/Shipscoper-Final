"""Email automation: mailbox trigger + full pipeline report reply."""

import email
import imaplib
from datetime import datetime
from email import policy
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from utils import config, env, logger

BASE_DIR = Path(__file__).resolve().parent.parent
INBOX_DIR = BASE_DIR / "data" / "inbox"
INBOX_DIR.mkdir(parents=True, exist_ok=True)

EMAIL_CFG = config.get("email", {})
SUBJECT_FILTERS = [s.lower() for s in EMAIL_CFG.get("subject_filters", ["ETA"])]
ALLOWED_SENDERS = [s.lower() for s in EMAIL_CFG.get("allowed_senders", [])]


class EmailAutomation:
    """IMAP/SMTP email handler for the email-triggered pipeline workflow.

    Workflow semantics:
    - Incoming Excel attachments are used as workflow triggers and archived.
    - The attachment content itself is not used for transformation.
    - A fresh report is generated from live scraping (Eurogate + HHLA)
      and sent back to matched recipients.
    """

    def __init__(self):
        self.address = env.get("EMAIL_ADDRESS", "")
        self.password = env.get("EMAIL_PASSWORD", "")
        self.imap_server = env.get("IMAP_SERVER", "imap.gmail.com")
        self.imap_port = int(env.get("IMAP_PORT", "993"))
        self.smtp_server = env.get("SMTP_SERVER", "smtp.gmail.com")
        self.smtp_port = int(env.get("SMTP_PORT", "587"))
        self.smtp_timeout = int(env.get("SMTP_TIMEOUT", "10"))
        self.smtp_security = env.get("SMTP_SECURITY", "starttls").strip().lower()

        if not self.address or not self.password:
            raise ValueError(
                "EMAIL_ADDRESS and EMAIL_PASSWORD must be set in .env"
            )

    def fetch_new_emails(self) -> list[dict]:
        """Check IMAP inbox for unprocessed emails with Excel attachments."""
        logger.info("[email] Connecting to IMAP...")
        results = []

        with imaplib.IMAP4_SSL(self.imap_server, self.imap_port) as imap:
            imap.login(self.address, self.password)
            imap.select("INBOX")

            # Search for unseen emails
            status, msg_ids = imap.search(None, "UNSEEN")
            if status != "OK" or not msg_ids[0]:
                logger.info("[email] No new emails")
                return []

            ids = msg_ids[0].split()
            logger.info(f"[email] Found {len(ids)} unread email(s)")

            for msg_id in ids:
                status, data = imap.fetch(msg_id, "(RFC822)")
                if status != "OK":
                    continue

                msg = email.message_from_bytes(data[0][1], policy=policy.default)
                subject = msg.get("Subject", "")
                sender = msg.get("From", "")

                # Check subject filter
                subject_lower = subject.lower()
                if not any(f in subject_lower for f in SUBJECT_FILTERS):
                    continue

                # Check sender filter (if configured)
                if ALLOWED_SENDERS:
                    sender_lower = sender.lower()
                    if not any(s in sender_lower for s in ALLOWED_SENDERS):
                        continue

                # Check for .xlsx attachment
                has_xlsx = False
                for part in msg.walk():
                    filename = part.get_filename()
                    if filename and filename.lower().endswith(".xlsx"):
                        has_xlsx = True
                        break

                if has_xlsx:
                    results.append({
                        "msg_id": msg_id,
                        "msg": msg,
                        "subject": subject,
                        "sender": sender,
                    })
                    logger.info(f"[email] Match: '{subject}' from {sender}")

        logger.info(f"[email] {len(results)} email(s) to process")
        return results

    def archive_attachment(self, msg: email.message.Message) -> Path | None:
        """Archive first .xlsx attachment to data/inbox/ for traceability."""
        for part in msg.walk():
            filename = part.get_filename()
            if not filename or not filename.lower().endswith(".xlsx"):
                continue

            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            safe_name = f"inbox_{ts}_{filename}"
            save_path = INBOX_DIR / safe_name

            with open(save_path, "wb") as f:
                f.write(part.get_payload(decode=True))

            logger.info(f"[email] Attachment saved: {save_path.name}")
            return save_path

        return None

    def send_updated_excel(
        self,
        recipient: str,
        excel_path: Path,
        original_subject: str,
        summary: dict,
    ):
        """Send updated Excel back via SMTP."""
        logger.info(f"[email] Sending reply to {recipient}...")

        msg = MIMEMultipart()
        msg["From"] = self.address
        msg["To"] = recipient
        msg["Subject"] = f"RE: {original_subject} - Updated ETAs"

        # Build body from template
        body_template = EMAIL_CFG.get("reply_body", "Updated ETAs attached.")
        body = body_template.format(
            eurogate_count=summary.get("eurogate_count", 0),
            hhla_count=summary.get("hhla_count", 0),
            cross_matches=summary.get("cross_matches", 0),
            total=summary.get("total", 0),
            timestamp=summary.get("timestamp", datetime.now().strftime("%Y-%m-%d %H:%M")),
        )
        msg.attach(MIMEText(body, "plain", "utf-8"))

        # Attach Excel
        with open(excel_path, "rb") as f:
            attachment = MIMEApplication(f.read(), Name=excel_path.name)
        attachment["Content-Disposition"] = f'attachment; filename="{excel_path.name}"'
        msg.attach(attachment)

        from scraper.email_sender import _deliver_message
        _deliver_message(msg, recipient)
        logger.info(f"[email] Reply sent to {recipient}")

    def _batch_mark_processed(self, msg_ids: list):
        """Mark multiple emails as seen in a single IMAP connection."""
        if not msg_ids:
            return
        with imaplib.IMAP4_SSL(self.imap_server, self.imap_port) as imap:
            imap.login(self.address, self.password)
            imap.select("INBOX")
            for msg_id in msg_ids:
                imap.store(msg_id, "+FLAGS", "\\Seen")
                logger.info(f"[email] Marked {msg_id} as processed")

    def run_email_workflow(self):
        """Run email-triggered full pipeline and reply with fresh report."""
        from orchestrator.pipeline import run_full

        emails = self.fetch_new_emails()
        if not emails:
            logger.info("[email] No emails to process")
            return

        # Run pipeline once for all matched emails.
        # This is intentionally independent of attachment content.
        summary = run_full()

        processed_ids = []
        for item in emails:
            try:
                # Archive attachment for traceability only
                self.archive_attachment(item["msg"])

                # Extract sender email address
                sender_raw = item["sender"]
                # Parse "Name <email>" format
                if "<" in sender_raw and ">" in sender_raw:
                    recipient = sender_raw[sender_raw.index("<") + 1:sender_raw.index(">")]
                else:
                    recipient = sender_raw

                # Send reply
                self.send_updated_excel(
                    recipient=recipient,
                    excel_path=Path(summary["excel_path"]),
                    original_subject=item["subject"],
                    summary=summary,
                )

                processed_ids.append(item["msg_id"])

            except Exception as e:
                logger.error(f"[email] Failed processing '{item['subject']}': {e}")

        # Mark all successfully processed emails as seen in one IMAP connection
        self._batch_mark_processed(processed_ids)
