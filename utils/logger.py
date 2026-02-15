import sys
from pathlib import Path

from loguru import logger as _logger

from utils.config_loader import config

BASE_DIR = Path(__file__).resolve().parent.parent

_log_cfg = config.get("logging", {})
_log_path = BASE_DIR / _log_cfg.get("path", "logs/eta_automation.log")
_log_path.parent.mkdir(parents=True, exist_ok=True)

_logger.remove()

_logger.add(
    sys.stderr,
    level=_log_cfg.get("level", "INFO"),
    format=_log_cfg.get("format", "{time} | {level} | {message}"),
)

_logger.add(
    str(_log_path),
    level=_log_cfg.get("level", "INFO"),
    format=_log_cfg.get("format", "{time} | {level} | {message}"),
    rotation=_log_cfg.get("rotation", "10 MB"),
    retention=_log_cfg.get("retention", "30 days"),
    encoding="utf-8",
)

logger = _logger
