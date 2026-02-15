import asyncio
from pathlib import Path

from scraper.base_scraper import BaseScraper
from utils import logger

HHLA_URL = "https://coast.hhla.de/report?id=Standard-Report-Segelliste"

# Known headers from the HHLA Segelliste report table
HHLA_COLUMNS = {
    "ankunft(soll)": "eta_planned",
    "ankunft": "eta_actual",
    "terminal": "terminal",
    "funkcode": "callsign",
    "schiffsname": "vessel_name",
    "importreise": "voyage_import",
    "exportreise": "voyage_export",
    "löschbeginn": "discharge_start",
    "löschende": "discharge_end",
    "ladebeginn": "load_start",
    "ladeende": "load_end",
    "abfahrt(soll)": "etd_planned",
    "abfahrt": "etd_actual",
    "schiffstyp": "vessel_type",
}


class HHLAScraper(BaseScraper):
    """Scraper for HHLA vessel schedule (coast.hhla.de).

    This site is a JavaScript SPA — requires Playwright for rendering.
    Table: 14 columns with vessel arrivals for past 4 weeks.
    """

    def __init__(self):
        super().__init__("hhla")

    def fetch(self) -> str:
        logger.info("[hhla] Launching Playwright (headless)...")
        return asyncio.get_event_loop().run_until_complete(self._fetch_async())

    async def _fetch_async(self) -> str:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(
                user_agent=self.user_agent,
                viewport={"width": 1920, "height": 1080},
            )

            try:
                logger.info(f"[hhla] Navigating to coast.hhla.de...")
                await page.goto(HHLA_URL, wait_until="networkidle", timeout=self.timeout * 1000)

                logger.info("[hhla] Waiting for table to render...")
                await page.wait_for_selector("table", timeout=15000)

                self.html = await page.content()
                logger.info(f"[hhla] OK - {len(self.html)} bytes received")

            except Exception as e:
                logger.error(f"[hhla] Playwright error: {e}")
                try:
                    content = await page.content()
                    self.save_debug(content)
                except Exception:
                    pass
                raise
            finally:
                await browser.close()

        return self.html

    def parse(self) -> list[dict]:
        if not self.html:
            logger.warning("[hhla] No HTML to parse - call fetch() first")
            return []

        from bs4 import BeautifulSoup

        soup = BeautifulSoup(self.html, "html.parser")
        vessels = []

        tables = soup.find_all("table")
        if not tables:
            logger.warning("[hhla] No <table> found after JS rendering")
            self.save_debug(self.html)
            return []

        logger.info(f"[hhla] Found {len(tables)} table(s)")

        # The data table is the largest one
        target_table = max(tables, key=lambda t: len(t.find_all("tr")))
        rows = target_table.find_all("tr")
        logger.info(f"[hhla] Target table: {len(rows)} rows")

        # Row 0 = count header ("951 Schiffabfertigungen")
        # Row 1 = real column headers (14 columns)
        # Row 2 = empty filter row
        # Row 3+ = data
        if len(rows) < 4:
            logger.warning("[hhla] Table too small")
            return []

        # Parse headers from row 1
        header_cells = rows[1].find_all(["th", "td"])
        headers = [c.get_text(strip=True).lower() for c in header_cells]
        logger.info(f"[hhla] Headers ({len(headers)}): {headers}")

        # Build column index map — match longer keys first to avoid
        # "ankunft" matching "ankunft(soll)" before the exact key does
        col_map = {}
        sorted_keys = sorted(HHLA_COLUMNS.keys(), key=len, reverse=True)
        for idx, header in enumerate(headers):
            normalized = header.replace("\u00f6", "ö").replace("\u00fc", "ü").replace("\u00e4", "ä").replace("\u00df", "ß")
            for key in sorted_keys:
                field = HHLA_COLUMNS[key]
                if key == normalized and field not in col_map:
                    col_map[field] = idx
                    break
            else:
                # Fallback: substring match for unknown/new headers
                for key in sorted_keys:
                    field = HHLA_COLUMNS[key]
                    if key in normalized and field not in col_map:
                        col_map[field] = idx
                        break

        logger.info(f"[hhla] Column mapping: {col_map}")

        # Parse data rows (skip row 0=title, 1=headers, 2=empty filter)
        for row in rows[3:]:
            cells = row.find_all("td")
            if not cells or len(cells) < 5:
                continue

            texts = [c.get_text(strip=True) for c in cells]

            def get_field(field: str) -> str:
                idx = col_map.get(field)
                if idx is not None and idx < len(texts):
                    return texts[idx]
                return ""

            name = get_field("vessel_name")
            if not name:
                continue

            terminal_raw = get_field("terminal")
            terminal = f"HHLA {terminal_raw}" if terminal_raw else "HHLA Hamburg"

            vessel = {
                "vessel_name": name,
                "eta": get_field("eta_planned"),
                "eta_actual": get_field("eta_actual"),
                "etd": get_field("etd_planned"),
                "etd_actual": get_field("etd_actual"),
                "callsign": get_field("callsign"),
                "terminal": terminal,
                "vessel_type": get_field("vessel_type"),
                "voyage_import": get_field("voyage_import"),
                "voyage_export": get_field("voyage_export"),
            }
            vessels.append(vessel)

        logger.info(f"[hhla] Parsed {len(vessels)} vessels")
        return vessels
