"""Check watched vessels for ETA changes and send notifications."""

from datetime import datetime
from zoneinfo import ZoneInfo

from utils import env, logger

BERLIN_TZ = ZoneInfo("Europe/Berlin")


def _get_client():
    """Get Supabase service-role client (reuses scraper's lazy singleton)."""
    from scraper.supabase_writer import _get_client as get_sb
    return get_sb()


def check_eta_changes() -> dict:
    """Compare current ETAs against watched vessels and notify on changes.

    Returns summary dict with counts.
    """
    logger.info("[watchlist] Checking for ETA changes on watched vessels...")

    client = _get_client()
    notified = 0
    checked = 0
    errors = 0

    # Fetch all active watches
    watches_resp = (
        client.table("vessel_watches")
        .select("*")
        .eq("notification_enabled", True)
        .execute()
    )
    watches = watches_resp.data or []

    if not watches:
        logger.info("[watchlist] No active watches found")
        return {"checked": 0, "notified": 0, "errors": 0}

    logger.info(f"[watchlist] Found {len(watches)} active watch(es)")

    for watch in watches:
        checked += 1
        watch_id = watch["id"]
        vessel_normalized = watch["vessel_name_normalized"]
        last_known_eta = watch.get("last_known_eta")

        try:
            # Get current ETA from latest_schedule
            schedule_resp = (
                client.table("latest_schedule")
                .select("eta")
                .eq("name_normalized", vessel_normalized)
                .order("scraped_at", desc=True)
                .limit(1)
                .execute()
            )

            if not schedule_resp.data:
                logger.debug(
                    f"[watchlist] No schedule data for {watch['vessel_name']}"
                )
                continue

            current_eta = schedule_resp.data[0].get("eta")

            # No change
            if current_eta == last_known_eta:
                continue

            # ETA changed — calculate delay
            delay_days = 0
            if last_known_eta and current_eta:
                try:
                    old_dt = datetime.fromisoformat(last_known_eta)
                    new_dt = datetime.fromisoformat(current_eta)
                    delay_days = (new_dt - old_dt).days
                except (ValueError, TypeError):
                    pass

            logger.info(
                f"[watchlist] ETA changed for {watch['vessel_name']}: "
                f"{last_known_eta} -> {current_eta} ({delay_days:+d} days)"
            )

            # Insert notification record
            notif_resp = (
                client.table("eta_change_notifications")
                .insert({
                    "watch_id": watch_id,
                    "vessel_name": watch["vessel_name"],
                    "shipment_reference": watch.get("shipment_reference"),
                    "old_eta": last_known_eta,
                    "new_eta": current_eta,
                    "delay_days": delay_days,
                })
                .execute()
            )
            notif_id = notif_resp.data[0]["id"] if notif_resp.data else None

            # Get user email for notification
            user_resp = (
                client.auth.admin.get_user_by_id(watch["user_id"])
            )
            user_email = (
                user_resp.user.email if user_resp and user_resp.user else None
            )

            # Send email notification
            if user_email:
                try:
                    from scraper.email_sender import send_eta_notification

                    send_eta_notification(
                        to_email=user_email,
                        vessel_name=watch["vessel_name"],
                        shipment_ref=watch.get("shipment_reference"),
                        old_eta=last_known_eta,
                        new_eta=current_eta,
                        delay_days=delay_days,
                    )

                    # Mark notification as sent
                    if notif_id:
                        client.table("eta_change_notifications").update({
                            "notification_sent": True,
                            "sent_at": datetime.now(BERLIN_TZ).isoformat(),
                        }).eq("id", notif_id).execute()

                except Exception as e:
                    logger.warning(
                        f"[watchlist] Email failed for {user_email}: {e}"
                    )

            # Update watch with new ETA
            client.table("vessel_watches").update({
                "last_known_eta": current_eta,
                "last_notified_at": datetime.now(BERLIN_TZ).isoformat(),
            }).eq("id", watch_id).execute()

            notified += 1

        except Exception as e:
            logger.error(
                f"[watchlist] Error checking {watch['vessel_name']}: {e}"
            )
            errors += 1

    summary = {"checked": checked, "notified": notified, "errors": errors}
    logger.info(
        f"[watchlist] Done — checked {checked}, "
        f"notified {notified}, errors {errors}"
    )
    return summary


if __name__ == "__main__":
    check_eta_changes()
