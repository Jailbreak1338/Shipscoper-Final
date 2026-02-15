"""
Test für den Excel-Processor.
Lädt die neuesten JSON-Dateien aus data/scraped/ und verarbeitet sie.
Aufruf: python -m tests.test_processor
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rich.console import Console
from rich.table import Table

from processor.excel_processor import process, cross_match, normalize_vessel_name
from utils import logger

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "scraped"


def load_latest(prefix: str) -> list[dict]:
    """Load the most recent JSON file for a given terminal prefix."""
    files = sorted(DATA_DIR.glob(f"{prefix}_*.json"), reverse=True)
    if not files:
        logger.warning(f"No JSON files found for {prefix}")
        return []
    latest = files[0]
    logger.info(f"Loading {latest.name}")
    with open(latest, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    console = Console()
    console.print("[bold]ETA-Automation Processor Test[/bold]\n")

    # Load latest scraped data
    eurogate = load_latest("eurogate")
    hhla = load_latest("hhla")

    console.print(f"  Eurogate: {len(eurogate)} vessels loaded")
    console.print(f"  HHLA:     {len(hhla)} vessels loaded\n")

    if not eurogate and not hhla:
        console.print("[bold red]Keine Daten vorhanden! Bitte zuerst Scraper starten.[/bold red]")
        return

    # Run processor
    out_path = process(eurogate, hhla)

    # Show results
    import pandas as pd
    df = pd.read_excel(out_path).fillna("")

    table = Table(title=f"Vessel Schedule - {len(df)} Einträge")
    table.add_column("Vessel", style="bold cyan", max_width=25)
    table.add_column("ETA", style="green")
    table.add_column("ETD", style="yellow")
    table.add_column("Terminal", style="magenta")
    table.add_column("Match", style="white")

    for _, row in df.head(20).iterrows():
        score = row.get("match_score", "")
        match_str = f"{int(score)}%" if score else ""
        table.add_row(
            str(row.get("vessel_name", "")),
            str(row.get("eta", "")),
            str(row.get("etd", "")),
            str(row.get("terminal", "")),
            match_str,
        )

    if len(df) > 20:
        table.add_row(f"... +{len(df) - 20} more", "", "", "", "")

    console.print(table)
    console.print(f"\n[bold green]Excel gespeichert: {out_path}[/bold green]")

    # Show cross-match results
    matched = cross_match(eurogate, hhla)
    cross = sum(1 for v in matched if v.get("match_score", 0) > 0)
    if cross > 0:
        console.print(f"[bold yellow]Cross-Matches (Eurogate<->HHLA): {cross}[/bold yellow]")


if __name__ == "__main__":
    main()
