"""Full pipeline: Scrape -> Process -> Excel."""

from datetime import datetime
from pathlib import Path

from utils import logger


def run_scrape() -> tuple[list[dict], list[dict]]:
    """Run both scrapers and return (eurogate_vessels, hhla_vessels)."""
    from scraper.eurogate_scraper import EurogateScraper
    from scraper.hhla_scraper import HHLAScraper

    eurogate_vessels = []
    hhla_vessels = []

    # Eurogate
    try:
        eg = EurogateScraper()
        eurogate_vessels = eg.run()
    except Exception as e:
        logger.error(f"Eurogate scraper failed: {e}")

    # HHLA
    try:
        hhla = HHLAScraper()
        hhla_vessels = hhla.run()
    except Exception as e:
        logger.error(f"HHLA scraper failed: {e}")

    logger.info(
        f"[pipeline] Scraped: {len(eurogate_vessels)} Eurogate + {len(hhla_vessels)} HHLA"
    )
    return eurogate_vessels, hhla_vessels


def run_process(
    eurogate_vessels: list[dict],
    hhla_vessels: list[dict],
    output_path: str | None = None,
) -> Path:
    """Process scraped data into Excel."""
    from processor.excel_processor import process

    return process(eurogate_vessels, hhla_vessels, output_path)


def run_process_from_latest(output_path: str | None = None) -> Path:
    """Load latest scraped JSONs and process them."""
    import json

    from scraper.base_scraper import SCRAPED_DIR

    def load_latest(prefix: str) -> list[dict]:
        files = sorted(SCRAPED_DIR.glob(f"{prefix}_*.json"), reverse=True)
        if not files:
            logger.warning(f"No JSON found for {prefix}")
            return []
        with open(files[0], "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info(f"[pipeline] Loaded {files[0].name}: {len(data)} vessels")
        return data

    eurogate = load_latest("eurogate")
    hhla = load_latest("hhla")
    return run_process(eurogate, hhla, output_path)


def run_sync_from_latest() -> dict:
    """Load latest scraped JSONs and sync to Supabase (no re-scraping)."""
    import json

    from scraper.base_scraper import SCRAPED_DIR
    from scraper.supabase_writer import sync_to_supabase

    def load_latest(prefix: str) -> list[dict]:
        files = sorted(SCRAPED_DIR.glob(f"{prefix}_*.json"), reverse=True)
        if not files:
            logger.warning(f"No JSON found for {prefix}")
            return []
        with open(files[0], "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info(f"[pipeline] Loaded {files[0].name}: {len(data)} vessels")
        return data

    eurogate = load_latest("eurogate")
    hhla = load_latest("hhla")
    return sync_to_supabase(eurogate, hhla)


def run_full(output_path: str | None = None) -> dict:
    """Full pipeline: scrape + process. Returns summary dict."""
    start = datetime.now()
    logger.info("[pipeline] Starting full pipeline...")

    eurogate, hhla = run_scrape()
    excel_path = run_process(eurogate, hhla, output_path)

    # Sync to Supabase
    from scraper.supabase_writer import sync_to_supabase

    supabase_result = sync_to_supabase(eurogate, hhla)

    # Check for ETA changes on watched vessels and notify
    watchlist_result = {"checked": 0, "notified": 0, "errors": 0}
    try:
        from check_eta_changes import check_eta_changes

        watchlist_result = check_eta_changes()
    except Exception as e:
        logger.error(f"[pipeline] ETA change check failed: {e}")

    elapsed = (datetime.now() - start).total_seconds()
    summary = {
        "eurogate_count": len(eurogate),
        "hhla_count": len(hhla),
        "total": len(eurogate) + len(hhla),
        "excel_path": str(excel_path),
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "elapsed_seconds": round(elapsed, 1),
        "supabase": supabase_result,
        "watchlist": watchlist_result,
    }

    logger.info(
        f"[pipeline] Done in {elapsed:.1f}s — "
        f"{summary['total']} vessels -> {excel_path.name}"
    )
    return summary
