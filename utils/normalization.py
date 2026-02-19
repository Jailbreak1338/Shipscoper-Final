import re


def normalize_vessel_name(name: str) -> str:
    """Normalize vessel names consistently across Python services.

    Rules:
    - trim leading/trailing whitespace
    - uppercase
    - collapse internal whitespace to single spaces
    """
    return re.sub(r"\s+", " ", (name or "").strip().upper())
