import asyncio
import re
import time

import requests

from scraper.base_scraper import BaseScraper
from utils import logger

HHLA_URL = "https://coast.hhla.de/report?id=Standard-Report-Segelliste"

# Normalized header token -> output field
HHLA_COLUMNS = {
    "ankunftsoll": "eta_planned",
    "ankunft": "eta_actual",
    "terminal": "terminal",
    "funkcode": "callsign",
    "schiffsname": "vessel_name",
    "importreise": "voyage_import",
    "exportreise": "voyage_export",
    "loeschbeginn": "discharge_start",
    "loeschende": "discharge_end",
    "ladebeginn": "load_start",
    "ladeende": "load_end",
    "abfahrtsoll": "etd_planned",
    "abfahrt": "etd_actual",
    "schiffstyp": "vessel_type",
}


def _normalize_header(value: str) -> str:
    """Normalize HHLA table header text to matching tokens."""
    text = (value or "").strip().lower()
    text = (
        text.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
    )
    text = re.sub(r"\(soll\)", "soll", text)
    text = re.sub(r"[^a-z0-9]+", "", text)
    return text


class HHLAScraper(BaseScraper):
    """Scraper for HHLA vessel schedule (coast.hhla.de)."""

    def __init__(self):
        super().__init__("hhla")

    def fetch(self) -> str:
        """Fetch HHLA report HTML.

        Strategy:
        1) Plain HTTP GET (fast path; page currently server-renders table).
        2) Playwright fallback if HTTP response has no table.
        """
        last_error = None
        attempts = max(1, int(self.retry_attempts))

        for attempt in range(1, attempts + 1):
            timeout_this_attempt = self.timeout + ((attempt - 1) * 10)
            try:
                logger.info(
                    f"[hhla] Fetch attempt {attempt}/{attempts} "
                    f"(timeout={timeout_this_attempt}s)"
                )
                return self._fetch_http(timeout_this_attempt)
            except Exception as http_err:
                last_error = http_err
                logger.warning(f"[hhla] HTTP fetch failed: {http_err}")

                try:
                    logger.info("[hhla] Falling back to Playwright...")
                    return asyncio.run(self._fetch_async(timeout_this_attempt))
                except Exception as pw_err:
                    last_error = pw_err
                    if attempt >= attempts:
                        break
                    backoff = max(1, self.retry_delay) * attempt
                    logger.warning(
                        f"[hhla] Playwright attempt {attempt} failed: {pw_err}. "
                        f"Retrying in {backoff}s..."
                    )
                    time.sleep(backoff)

        raise RuntimeError(f"HHLA fetch failed after {attempts} attempts: {last_error}")

    def _fetch_http(self, timeout_seconds: int) -> str:
        response = requests.get(
            HHLA_URL,
            timeout=timeout_seconds,
            headers={"User-Agent": self.user_agent},
        )
        response.raise_for_status()
        html = response.text

        # If the page does not contain any table, dynamic rendering may be required.
        if "<table" not in html.lower():
            raise RuntimeError("No table in HTTP response")

        self.html = html
        logger.info(f"[hhla] HTTP fetch OK - {len(self.html)} bytes received")
        return self.html

    async def _fetch_async(self, timeout_seconds: int) -> str:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(
                user_agent=self.user_agent,
                viewport={"width": 1920, "height": 1080},
            )

            try:
                await page.goto(
                    HHLA_URL,
                    wait_until="networkidle",
                    timeout=timeout_seconds * 1000,
                )
                await page.wait_for_selector(
                    "table",
                    timeout=max(15000, timeout_seconds * 1000),
                )
                self.html = await page.content()
                logger.info(f"[hhla] Playwright fetch OK - {len(self.html)} bytes received")
            except Exception as e:
                logger.error(f"[hhla] Playwright error: {e}")
                try:
                    self.save_debug(await page.content())
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
        tables = soup.find_all("table")
        if not tables:
            logger.warning("[hhla] No <table> found")
            self.save_debug(self.html)
            return []

        target_table = None
        header_idx = -1
        col_map: dict[str, int] = {}

        for table in tables:
            rows = table.find_all("tr")
            for i, row in enumerate(rows):
                cells = row.find_all(["th", "td"])
                header_tokens = [_normalize_header(c.get_text(" ", strip=True)) for c in cells]
                if not header_tokens:
                    continue

                has_vessel = "schiffsname" in header_tokens
                has_eta = "ankunftsoll" in header_tokens
                if not (has_vessel and has_eta):
                    continue

                table_col_map: dict[str, int] = {}
                for idx, token in enumerate(header_tokens):
                    field = HHLA_COLUMNS.get(token)
                    if field and field not in table_col_map:
                        table_col_map[field] = idx

                if "vessel_name" in table_col_map:
                    target_table = table
                    header_idx = i
                    col_map = table_col_map
                    break

            if target_table is not None:
                break

        if target_table is None:
            logger.warning("[hhla] Could not identify data table/header row")
            self.save_debug(self.html)
            return []

        rows = target_table.find_all("tr")
        vessels: list[dict] = []

        for row in rows[header_idx + 1 :]:
            cells = row.find_all("td")
            if not cells:
                continue
            texts = [c.get_text(" ", strip=True) for c in cells]

            def get_field(field: str) -> str:
                idx = col_map.get(field)
                if idx is not None and idx < len(texts):
                    return texts[idx].strip()
                return ""

            vessel_name = get_field("vessel_name")
            if not vessel_name:
                continue

            terminal_raw = get_field("terminal")
            terminal = terminal_raw if terminal_raw else "Hamburg"
            if terminal and not terminal.upper().startswith("HHLA"):
                terminal = f"HHLA {terminal}"

            vessel = {
                "vessel_name": vessel_name,
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
