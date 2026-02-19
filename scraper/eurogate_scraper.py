import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from scraper.base_scraper import BaseScraper
from utils import logger

BASE_URL = "https://www.eurogate.de"
START_URL = f"{BASE_URL}/eportal/state/do/start"


class EurogateScraper(BaseScraper):
    """Scraper for EUROGATE Hamburg vessel schedule (Segelliste).

    Flow: Start session -> Segelliste Hamburg -> switch to 4-week view -> parse.
    The table uses heavy rowspan; a grid resolver normalises all column positions.
    """

    def __init__(self):
        super().__init__("eurogate")
        self.session = self._build_session()

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        retry = Retry(
            total=self.retry_attempts,
            backoff_factor=self.retry_delay,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        session.headers.update({"User-Agent": self.user_agent})
        return session

    def fetch(self) -> str:
        # Step 1: Start a session to get valid _state tokens
        logger.info("[eurogate] Starting session...")
        r1 = self.session.get(START_URL, timeout=self.timeout, allow_redirects=True)
        r1.raise_for_status()

        # Step 2: Find Segelliste Hamburg link
        soup = BeautifulSoup(r1.text, "html.parser")
        seg_link = None
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "segelliste" in href.lower() and "locationCode=HAM" in href:
                seg_link = BASE_URL + href
                break

        if not seg_link:
            self.save_debug(r1.text)
            raise RuntimeError("Segelliste Hamburg link not found on start page")

        # Step 3: Fetch the initial Segelliste (defaults to 1 week)
        logger.info("[eurogate] Fetching Segelliste...")
        r2 = self.session.get(seg_link, timeout=self.timeout, allow_redirects=True)
        r2.raise_for_status()

        # Step 4: Switch to 4-week view for the full vessel list.
        # The page has period links: period1 (1w), period2 (2w), period3 (4w).
        soup2 = BeautifulSoup(r2.text, "html.parser")
        period_link = None
        for a in soup2.find_all("a", href=True):
            if "segelliste.period3" in a["href"]:
                period_link = BASE_URL + a["href"]
                break

        if period_link:
            logger.info("[eurogate] Switching to 4-week view...")
            r3 = self.session.get(
                period_link, timeout=self.timeout, allow_redirects=True
            )
            r3.raise_for_status()
            r3.encoding = r3.apparent_encoding
            self.html = r3.text
        else:
            logger.warning("[eurogate] 4-week link not found, using default period")
            r2.encoding = r2.apparent_encoding
            self.html = r2.text

        logger.info(f"[eurogate] OK - {len(self.html)} bytes received")
        return self.html

    def parse(self) -> list[dict]:
        if not self.html:
            logger.warning("[eurogate] No HTML to parse - call fetch() first")
            return []

        soup = BeautifulSoup(self.html, "html.parser")
        vessels = []

        # Find the data table by looking for the header row with
        # "Datum", "Schiffsname" as separate <td> cells (not nested text)
        target_table = None
        for table in soup.find_all("table"):
            first_row = table.find("tr")
            if not first_row:
                continue
            cells = first_row.find_all(["th", "td"], recursive=False)
            header_texts = [c.get_text(strip=True) for c in cells]
            if len(cells) >= 10 and "Datum" in header_texts and "Schiffsname" in header_texts:
                target_table = table
                break

        if not target_table:
            logger.warning("[eurogate] No vessel table found")
            self.save_debug(self.html)
            return []

        # Build a rowspan-aware logical grid so every row has all 13 columns
        grid = _build_logical_grid(target_table)
        num_cols = len(grid[0]) if grid else 0
        logger.info(
            f"[eurogate] Vessel table: {len(grid)} rows x {num_cols} cols "
            f"(incl. header)"
        )

        # Column indices (from the header row):
        #  0=Datum  1=Zeit  2=Abfahrt(Etd)  3=Schiffsname  4=Callsign
        #  5=Liegeplatz  6=Lö/La  7=SchiffNr  8=ReiseNr
        #  9=Auslieferbeg.  10=Annahmebeginn  11=Status  12=Makler
        COL_DATE = 0
        COL_TIME = 1
        COL_ETD = 2
        COL_VESSEL = 3
        COL_CALLSIGN = 4
        COL_BERTH = 5
        COL_LOLA = 6
        COL_STATUS = 11
        COL_BROKER = 12

        for row in grid[1:]:  # skip header
            if len(row) <= COL_LOLA:
                continue

            # Skip "Laden" rows — only keep "Löschen" rows
            lola = row[COL_LOLA]

            vessel_name = row[COL_VESSEL].strip()
            if not vessel_name:
                continue

            date_str = row[COL_DATE].strip()
            time_str = row[COL_TIME].strip()
            etd_str = row[COL_ETD].strip()

            eta = f"{date_str} {time_str}" if date_str and time_str else ""

            vessel = {
                "vessel_name": vessel_name,
                "eta": eta,
                "etd": etd_str,
                "callsign": row[COL_CALLSIGN].strip() if len(row) > COL_CALLSIGN else "",
                "berth": row[COL_BERTH].strip() if len(row) > COL_BERTH else "",
                "cargo_operation": lola,
                "status": row[COL_STATUS].strip() if len(row) > COL_STATUS else "",
                "broker": row[COL_BROKER].strip() if len(row) > COL_BROKER else "",
                "terminal": "EUROGATE Hamburg",
            }
            vessels.append(vessel)

        logger.info(f"[eurogate] Parsed {len(vessels)} vessels")
        return vessels


def _build_logical_grid(table) -> list[list[str]]:
    """Resolve rowspans into a 2D grid where every row has all columns.

    HTML tables with rowspan cause subsequent rows to have fewer physical
    <td> cells. This function reconstructs the full logical grid so each
    row always has a value for every column.
    """
    rows = table.find_all("tr", recursive=False)
    if not rows:
        return []

    grid = []
    # Track cells that are "occupied" by a rowspan from a previous row.
    # Key: (row_index, col_index) -> text value
    occupied: dict[tuple[int, int], str] = {}

    for row_idx, row in enumerate(rows):
        cells = row.find_all(["th", "td"], recursive=False)
        logical_row: list[str] = []
        phys_idx = 0
        col_idx = 0

        # Walk through columns, filling from either occupied spans or
        # physical cells until both sources are exhausted.
        while phys_idx < len(cells) or (row_idx, col_idx) in occupied:
            if (row_idx, col_idx) in occupied:
                logical_row.append(occupied.pop((row_idx, col_idx)))
                col_idx += 1
            elif phys_idx < len(cells):
                cell = cells[phys_idx]
                text = cell.get_text(strip=True)
                logical_row.append(text)

                # Register this cell's value for future rows if rowspan > 1
                rowspan_str = cell.get("rowspan", "1") or "1"
                try:
                    rowspan = int(rowspan_str)
                except ValueError:
                    rowspan = 1
                for r in range(1, rowspan):
                    occupied[(row_idx + r, col_idx)] = text

                phys_idx += 1
                col_idx += 1
            else:
                break

        grid.append(logical_row)

    return grid
