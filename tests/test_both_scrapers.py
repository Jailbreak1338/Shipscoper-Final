"""
Live-Test für Eurogate und HHLA Scraper.
Aufruf: python -m tests.test_both_scrapers
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rich.console import Console
from rich.table import Table

from scraper.eurogate_scraper import EurogateScraper
from scraper.hhla_scraper import HHLAScraper
from utils import logger


def display_results(vessels: list[dict], terminal: str, console: Console):
    if not vessels:
        console.print(f"\n[bold red]{terminal}: Keine Vessels gefunden![/bold red]")
        return

    table = Table(title=f"{terminal} - {len(vessels)} Vessels")
    table.add_column("Vessel", style="bold cyan", max_width=25)
    table.add_column("ETA", style="green")
    table.add_column("ETD", style="yellow")
    table.add_column("Terminal", style="magenta")
    table.add_column("Callsign", style="white")

    for v in vessels[:15]:
        table.add_row(
            v.get("vessel_name", ""),
            v.get("eta", ""),
            v.get("etd", ""),
            v.get("terminal", ""),
            v.get("callsign", ""),
        )

    if len(vessels) > 15:
        table.add_row(f"... +{len(vessels) - 15} more", "", "", "", "")

    console.print()
    console.print(table)


def main():
    console = Console()
    console.print("[bold]ETA-Automation Scraper Test[/bold]\n")

    results = {}

    # --- Eurogate ---
    console.print("[bold blue]1/2 Eurogate Hamburg...[/bold blue]")
    try:
        eg = EurogateScraper()
        results["eurogate"] = eg.run()
        display_results(results["eurogate"], "EUROGATE", console)
    except Exception as e:
        logger.error(f"Eurogate failed: {e}")
        console.print(f"[bold red]Eurogate FEHLER: {e}[/bold red]")
        results["eurogate"] = []

    # --- HHLA ---
    console.print("\n[bold blue]2/2 HHLA Hamburg...[/bold blue]")
    try:
        hhla = HHLAScraper()
        results["hhla"] = hhla.run()
        display_results(results["hhla"], "HHLA", console)
    except Exception as e:
        logger.error(f"HHLA failed: {e}")
        console.print(f"[bold red]HHLA FEHLER: {e}[/bold red]")
        results["hhla"] = []

    # --- Summary ---
    console.print("\n[bold]Zusammenfassung:[/bold]")
    total = 0
    for name, vessels in results.items():
        count = len(vessels)
        total += count
        status = "[green]OK[/green]" if count > 0 else "[red]LEER[/red]"
        console.print(f"  {name.upper()}: {count} vessels {status}")
    console.print(f"  [bold]GESAMT: {total} vessels[/bold]")


if __name__ == "__main__":
    main()
