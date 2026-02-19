# ETA Automation - Vessel Schedule Scraper

Automatisiertes Scraping von Schiffsankunftszeiten (ETAs) der Hamburger Container-Terminals **EUROGATE** und **HHLA**, mit Cross-Matching, Excel-Export und E-Mail-Automatisierung.

# Features

- **Eurogate Scraper* — Session-basiert, parst komplexe Rowspan-Tabellen
- **HHLA Scraper** — Playwright-basiert (JavaScript SPA), 14 Spalten
- **Cross-Matching** — Fuzzy Name Matching + ETA-Datum zwischen Terminals
- **Excel-Export** — Formatierte Tabelle mit Auto-Spaltenbreiten, Freeze Panes
- **E-Mail-Automatisierung** — IMAP/SMTP: Excel-Anhang als Trigger, erzeugt frischen Live-Report und sendet ihn zurück
- **CLI-Interface** — Click-basiert mit mehreren Commands
- **Logging** — Loguru mit Rotation und File-Output

## Architektur

```
eta-automation/
├── main.py                    # CLI Entry Point
├── scraper_api.py             # Flask API für Railway (Webhook)
├── check_eta_changes.py       # Watchlist: ETA-Änderungen prüfen
├── config.yaml                # Zentrale Konfiguration
├── .env                       # Credentials (nicht in Git!)
├── requirements.txt
├── Procfile                   # Railway Deployment
├── railway.json               # Railway Config
│
├── scraper/
│   ├── base_scraper.py        # Abstract Base Class
│   ├── eurogate_scraper.py    # Eurogate (requests + BS4)
│   ├── hhla_scraper.py        # HHLA (Playwright + BS4)
│   ├── supabase_writer.py     # Supabase Sync
│   └── email_sender.py        # ETA-Benachrichtigungen per E-Mail
│
├── processor/
│   └── excel_processor.py     # Cross-Match + Excel-Export
│
├── orchestrator/
│   ├── pipeline.py            # Full Pipeline (Scrape → Sync → Notify)
│   └── email_handler.py       # IMAP/SMTP Automation
│
├── utils/
│   ├── config_loader.py       # YAML + .env Loader
│   └── logger.py              # Loguru Setup
│
├── web/                       # Next.js Web-App (Vercel)
│   ├── src/app/
│   │   ├── eta-updater/       # Excel Upload + Processing
│   │   ├── dashboard/         # Upload-Statistiken
│   │   └── watchlist/         # Vessel Watchlist UI
│   └── vercel.json            # Vercel Cron Config
│
├── docs/
│   ├── DEPLOYMENT.md          # Deployment-Anleitung
│   └── WATCHLIST.md           # Watchlist-Benutzerhandbuch
│
├── tests/
├── deployment/
├── data/
└── logs/
```

## Installation

```bash
# 1. Repository klonen / Ordner erstellen
cd C:\Users\tim-k\OneDrive\Dokumente\eta-automation

# 2. Virtual Environment erstellen
python -m venv venv

# 3. Aktivieren
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# 4. Dependencies installieren
pip install -r requirements.txt

# 5. Playwright Browser installieren
playwright install chromium

# 6. .env konfigurieren (für E-Mail-Funktion)
# EMAIL_ADDRESS und EMAIL_PASSWORD setzen
```

## Usage

### Full Pipeline (Scrape + Process + Excel)
```bash
python main.py run
python main.py run --output custom_report.xlsx
python main.py run --debug
python main.py run --no-excel          # Nur scrapen
python main.py run --email-mode        # Pipeline + E-Mail senden
```

### Nur Scraping
```bash
python main.py scrape
```

### Nur Verarbeitung (aus letzten JSONs)
```bash
python main.py process
python main.py process --output report.xlsx
```

### E-Mail Workflow
```bash
python main.py email                   # Einmalig prüfen
python main.py email --watch           # Dauerhaft überwachen
```

Hinweis:
- Eingehende Excel-Anhänge werden archiviert (`data/inbox`), aber nicht direkt transformiert.
- Die Antwort enthält immer einen frisch erzeugten Report aus dem Live-Scraping.

### Aufräumen
```bash
python main.py clean                   # Dateien > 7 Tage löschen
python main.py clean --days 3
python main.py clean --dry-run         # Nur anzeigen
```

### Status
```bash
python main.py status
```

## Deployment

### Produktiv: Vercel + Railway

Siehe **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** für die komplette Anleitung:

- **Vercel** — Next.js Web-App + Cron Jobs
- **Railway** — Python Scraper API
- **Supabase** — Datenbank + Auth

### Lokal: Windows Task Scheduler
1. Task Scheduler öffnen
2. "Create Basic Task"
3. Trigger: Täglich / Alle 30 Min
4. Action: `deployment\run_pipeline.bat` ausführen

### Lokal: Linux/Mac Cron
```bash
chmod +x deployment/cron_setup.sh
./deployment/cron_setup.sh
```

## Vessel Watchlist

Siehe **[docs/WATCHLIST.md](docs/WATCHLIST.md)** — Vessels beobachten und bei ETA-Änderungen per E-Mail benachrichtigt werden.

## Konfiguration

### config.yaml
- `scraper.*` — URLs, Timeouts, User-Agent
- `processor.fuzzy_match_threshold` — Matching-Schwelle (0-100, default: 85)
- `email.*` — Subject-Filter, erlaubte Absender, Antwort-Template
- `clean.max_age_days` — Aufbewahrung alter Dateien
- `logging.*` — Level, Format, Rotation

### .env
```
SUPABASE_URL=https://xxx.supabase.co
# Optional fallback alias used by some deployments:
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

EMAIL_ADDRESS=bot@firma.de
EMAIL_PASSWORD=app-specific-password
IMAP_SERVER=imap.gmail.com
SMTP_SERVER=smtp.gmail.com
```

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| Eurogate "abgemeldet" | Session abgelaufen — Scraper startet automatisch neue Session |
| HHLA "No table found" | JavaScript nicht geladen — Playwright Timeout erhöhen in config.yaml |
| Playwright not found | `playwright install chromium` ausführen |
| Email auth failed | App-Passwort in Gmail generieren (Sicherheit > App-Passwörter) |
| Zu viele/wenige Matches | `fuzzy_match_threshold` in config.yaml anpassen (höher = strenger) |
