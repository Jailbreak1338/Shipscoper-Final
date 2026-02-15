import json
import time
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from utils import config, logger

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
SCRAPED_DIR = DATA_DIR / "scraped"
DEBUG_DIR = DATA_DIR / "debug"


class BaseScraper(ABC):
    """Abstract base class for all terminal scrapers."""

    def __init__(self, terminal_name: str):
        self.terminal_name = terminal_name
        self.scraper_cfg = config["scraper"]
        self.terminal_cfg = self.scraper_cfg[terminal_name]
        self.timeout = self.terminal_cfg.get("timeout", 20)
        self.retry_attempts = self.scraper_cfg.get("retry_attempts", 3)
        self.retry_delay = self.scraper_cfg.get("retry_delay", 2)
        self.user_agent = self.scraper_cfg.get("user_agent", "ETA-Automation/1.0")
        self.html = None
        self.vessels = []

        SCRAPED_DIR.mkdir(parents=True, exist_ok=True)
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)

    @abstractmethod
    def fetch(self) -> str:
        """Fetch HTML from source. Returns raw HTML string."""

    @abstractmethod
    def parse(self) -> list[dict]:
        """Parse self.html and return list of vessel dicts."""

    def save(self) -> Path:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = SCRAPED_DIR / f"{self.terminal_name}_{ts}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(self.vessels, f, ensure_ascii=False, indent=2)
        logger.info(
            f"[{self.terminal_name}] Saved {len(self.vessels)} vessels -> {out_path.name}"
        )
        return out_path

    def run(self) -> list[dict]:
        self.fetch()
        self.vessels = self.parse()
        self.save()
        return self.vessels

    def save_debug(self, content: str, suffix: str = "html"):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        debug_path = DEBUG_DIR / f"error_{self.terminal_name}_{ts}.{suffix}"
        with open(debug_path, "w", encoding="utf-8") as f:
            f.write(content)
        logger.debug(f"[{self.terminal_name}] Debug saved -> {debug_path.name}")
        return debug_path
