import os
from pathlib import Path

import yaml
from dotenv import dotenv_values

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config.yaml"
ENV_PATH = BASE_DIR / ".env"


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_env(path: Path = ENV_PATH) -> dict:
    return dotenv_values(path)


config = load_config()
env = load_env()
