"""Push scraped vessel data to Supabase."""
from datetime import datetime
from zoneinfo import ZoneInfo

from utils import env, logger
from utils.normalization import normalize_vessel_name

_supabase_client = None

BERLIN_TZ = ZoneInfo("Europe/Berlin")


def _get_client():
    """Lazy-initialize the Supabase client (service role key, bypasses RLS)."""
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    # Primary server-side variable is SUPABASE_URL.
    # For compatibility with shared env setups, accept NEXT_PUBLIC_SUPABASE_URL as fallback.
    url = env.get("SUPABASE_URL", "") or env.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and "
            "SUPABASE_SERVICE_ROLE_KEY must be set in .env"
        )

    from supabase import create_client

    _supabase_client = create_client(url, key)
    return _supabase_client


def _parse_german_datetime(dt_str: str) -> str | None:
    """Convert common datetime string formats to ISO 8601 in Europe/Berlin."""
    if not dt_str or not dt_str.strip():
        return None
    value = dt_str.strip()

    # Scraped sources may provide either German format (DD.MM.YYYY HH:MM)
    # or ISO-like values (YYYY-MM-DD HH:MM / YYYY-MM-DDTHH:MM[:SS][offset]).
    dt = None

    for fmt in ("%d.%m.%Y %H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(value, fmt)
            break
        except ValueError:
            continue

    if dt is None:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            logger.warning(
                f"[supabase] Could not parse datetime: {dt_str!r} "
                "(expected DD.MM.YYYY HH:MM or ISO-like YYYY-MM-DD HH:MM[:SS])"
            )
            return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BERLIN_TZ)
    else:
        dt = dt.astimezone(BERLIN_TZ)

    return dt.isoformat()


def upsert_vessel(name: str) -> str:
    """Upsert a vessel by name_normalized. Returns the vessel UUID."""
    client = _get_client()
    normalized = normalize_vessel_name(name)

    result = (
        client.table("vessels")
        .upsert(
            {"name": name.strip(), "name_normalized": normalized},
            on_conflict="name_normalized",
        )
        .execute()
    )

    return result.data[0]["id"]


def upsert_schedule_events(vessels: list[dict], source: str) -> int:
    """Upsert schedule events for a list of scraped vessels.

    Returns the number of events synced.
    """
    client = _get_client()
    count = 0

    for vessel in vessels:
        vessel_name = vessel.get("vessel_name", "")
        if not vessel_name:
            continue

        try:
            vessel_id = upsert_vessel(vessel_name)

            eta = _parse_german_datetime(vessel.get("eta", ""))
            etd = _parse_german_datetime(vessel.get("etd", ""))
            terminal = vessel.get("terminal", "")

            if not eta and not etd:
                logger.debug(
                    f"[supabase] Skipping {vessel_name}: no ETA or ETD"
                )
                continue

            row = {
                "vessel_id": vessel_id,
                "source": source,
                "eta": eta,
                "etd": etd,
                "terminal": terminal or None,
            }

            client.table("schedule_events").upsert(
                row,
                on_conflict="vessel_id,source,eta,terminal",
            ).execute()

            count += 1

        except Exception as e:
            logger.warning(
                f"[supabase] Failed to sync vessel {vessel_name!r}: {e}"
            )

    return count


def sync_to_supabase(
    eurogate: list[dict], hhla: list[dict]
) -> dict:
    """Sync scraped data to Supabase. Never raises — returns summary dict.

    Safe to call even if Supabase is not configured.
    """
    try:
        eg_count = upsert_schedule_events(eurogate, "eurogate")
        hhla_count = upsert_schedule_events(hhla, "hhla")

        summary = {
            "ok": True,
            "eurogate_synced": eg_count,
            "hhla_synced": hhla_count,
            "total_synced": eg_count + hhla_count,
        }
        logger.info(
            f"[supabase] Synced {summary['total_synced']} events "
            f"({eg_count} Eurogate + {hhla_count} HHLA)"
        )
        return summary

    except Exception as e:
        logger.error(f"[supabase] Sync failed: {e}")
        return {"ok": False, "error": str(e)}
