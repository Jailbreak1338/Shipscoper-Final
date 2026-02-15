"""ETA Automation CLI — Vessel Schedule Scraper for Hamburg Terminals."""

import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import click
from rich.console import Console

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from utils import config, env, logger

console = Console()
BASE_DIR = Path(__file__).resolve().parent


@click.group()
@click.option("--debug", is_flag=True, help="Enable verbose debug logging")
def cli(debug):
    """ETA Automation - Vessel Schedule Scraper for Hamburg Terminals."""
    if debug:
        from loguru import logger as _logger
        _logger.enable("")
        logger.info("Debug mode enabled")


@cli.command()
@click.option("--output", type=click.Path(), default=None, help="Custom Excel output path")
@click.option("--no-excel", is_flag=True, help="Only scrape, skip Excel export")
@click.option("--email-mode", is_flag=True, help="Run pipeline + send via email")
def run(output, no_excel, email_mode):
    """Full pipeline: Scrape + Process + Excel."""
    from orchestrator.pipeline import run_full, run_scrape

    console.print("[bold]ETA Automation - Full Pipeline[/bold]\n")

    if no_excel:
        console.print("Scraping only (--no-excel)...")
        eurogate, hhla = run_scrape()
        console.print(f"\n[green]Done:[/green] {len(eurogate)} Eurogate + {len(hhla)} HHLA")
        return

    summary = run_full(output)

    console.print(f"\n[bold green]Pipeline complete![/bold green]")
    console.print(f"  Eurogate: {summary['eurogate_count']} vessels")
    console.print(f"  HHLA:     {summary['hhla_count']} vessels")
    console.print(f"  Total:    {summary['total']} vessels")
    console.print(f"  Excel:    {summary['excel_path']}")
    console.print(f"  Time:     {summary['elapsed_seconds']}s")

    sb = summary.get("supabase", {})
    if sb.get("ok"):
        console.print(f"  Supabase: {sb['total_synced']} events synced")
    else:
        console.print(f"  Supabase: [yellow]{sb.get('error', 'skipped')}[/yellow]")

    if email_mode:
        console.print("\n[bold]Sending via email...[/bold]")
        try:
            from orchestrator.email_handler import EmailAutomation
            em = EmailAutomation()
            em.run_email_workflow()
        except Exception as e:
            console.print(f"[bold red]Email failed: {e}[/bold red]")


@cli.command()
def sync():
    """Sync latest scraped JSONs to Supabase (no re-scraping)."""
    from orchestrator.pipeline import run_sync_from_latest

    console.print("[bold]ETA Automation - Sync to Supabase[/bold]\n")
    result = run_sync_from_latest()

    if result.get("ok"):
        console.print(f"[green]Synced {result['total_synced']} events[/green]")
        console.print(f"  Eurogate: {result['eurogate_synced']}")
        console.print(f"  HHLA:     {result['hhla_synced']}")
    else:
        console.print(f"[bold red]Sync failed: {result.get('error')}[/bold red]")


@cli.command()
def scrape():
    """Only scrape terminals, save JSON."""
    from orchestrator.pipeline import run_scrape

    console.print("[bold]ETA Automation - Scrape Only[/bold]\n")
    eurogate, hhla = run_scrape()
    console.print(f"\n[green]Done:[/green] {len(eurogate)} Eurogate + {len(hhla)} HHLA")
    console.print("JSON files saved in data/scraped/")


@cli.command()
@click.option("--output", type=click.Path(), default=None, help="Custom Excel output path")
def process(output):
    """Process latest JSONs into Excel (no scraping)."""
    from orchestrator.pipeline import run_process_from_latest

    console.print("[bold]ETA Automation - Process Only[/bold]\n")
    excel_path = run_process_from_latest(output)
    console.print(f"\n[green]Excel saved:[/green] {excel_path}")


@cli.command(name="email")
@click.option("--input", "input_path", type=click.Path(exists=True), default=None, help="Process a specific Excel file")
@click.option("--watch", is_flag=True, help="Continuously watch for new emails")
def email_cmd(input_path, watch):
    """Email workflow: check inbox, process, reply."""
    from orchestrator.email_handler import EmailAutomation

    console.print("[bold]ETA Automation - Email Mode[/bold]\n")

    try:
        em = EmailAutomation()
    except ValueError as e:
        console.print(f"[bold red]{e}[/bold red]")
        console.print("Configure EMAIL_ADDRESS and EMAIL_PASSWORD in .env")
        return

    if watch:
        interval = config.get("email", {}).get("check_interval", 300)
        console.print(f"Watching inbox every {interval}s... (Ctrl+C to stop)")
        while True:
            try:
                em.run_email_workflow()
                time.sleep(interval)
            except KeyboardInterrupt:
                console.print("\n[yellow]Stopped.[/yellow]")
                break
    else:
        em.run_email_workflow()
        console.print("[green]Email workflow complete.[/green]")


@cli.command()
@click.option("--days", default=None, type=int, help="Max age in days (default: from config)")
@click.option("--dry-run", is_flag=True, help="Show what would be deleted")
def clean(days, dry_run):
    """Delete old scraped/debug files."""
    max_days = days or config.get("clean", {}).get("max_age_days", 7)
    cutoff = datetime.now() - timedelta(days=max_days)

    console.print(f"[bold]Cleaning files older than {max_days} days[/bold]\n")

    dirs_to_clean = [
        BASE_DIR / "data" / "scraped",
        BASE_DIR / "data" / "debug",
        BASE_DIR / "data" / "inbox",
    ]

    total_deleted = 0
    total_bytes = 0

    for d in dirs_to_clean:
        if not d.exists():
            continue

        for f in d.iterdir():
            if f.is_file() and datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
                size = f.stat().st_size
                if dry_run:
                    console.print(f"  [yellow]Would delete:[/yellow] {f.name} ({size:,} bytes)")
                else:
                    f.unlink()
                    console.print(f"  [red]Deleted:[/red] {f.name}")
                total_deleted += 1
                total_bytes += size

    if total_deleted == 0:
        console.print("[green]Nothing to clean.[/green]")
    else:
        action = "Would delete" if dry_run else "Deleted"
        console.print(f"\n{action} {total_deleted} files ({total_bytes:,} bytes)")


@cli.command()
def status():
    """Show current status and file counts."""
    console.print("[bold]ETA Automation - Status[/bold]\n")

    dirs = {
        "Scraped JSONs": BASE_DIR / "data" / "scraped",
        "Debug files": BASE_DIR / "data" / "debug",
        "Inbox": BASE_DIR / "data" / "inbox",
        "Logs": BASE_DIR / "logs",
    }

    for label, d in dirs.items():
        if d.exists():
            files = list(d.iterdir())
            count = len([f for f in files if f.is_file()])
            console.print(f"  {label}: {count} files")
        else:
            console.print(f"  {label}: [dim]not created yet[/dim]")

    # Latest Excel
    excel_path = BASE_DIR / config["processor"]["excel"].get("output_file", "data/vessel_schedule.xlsx")
    if excel_path.exists():
        mtime = datetime.fromtimestamp(excel_path.stat().st_mtime)
        console.print(f"\n  Latest Excel: {excel_path.name}")
        console.print(f"  Last updated: {mtime.strftime('%Y-%m-%d %H:%M:%S')}")
    else:
        console.print(f"\n  [dim]No Excel generated yet[/dim]")

    # Email config
    email_addr = env.get("EMAIL_ADDRESS", "")
    if email_addr:
        console.print(f"\n  Email: {email_addr}")
    else:
        console.print(f"\n  Email: [dim]not configured[/dim]")


if __name__ == "__main__":
    cli()
