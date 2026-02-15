# Deployment Guide

Komplettes Setup: Vercel (Web-App) + Railway (Python Scraper) + Supabase (Datenbank).

---

## Voraussetzungen

- GitHub Repository mit dem Code
- Accounts: [Vercel](https://vercel.com), [Railway](https://railway.app), [Supabase](https://supabase.com)
- Supabase-Projekt bereits eingerichtet (Auth, Tabellen)

---

## 1. Supabase Setup

### 1.1 Watchlist-Tabellen erstellen

Im Supabase SQL Editor ausführen:

```sql
-- Datei: web/supabase_watchlist_schema.sql
-- Erstellt: vessel_watches, eta_change_notifications + RLS Policies
```

### 1.2 Environment Variables notieren

Aus Supabase Dashboard > Settings > API:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## 2. Railway Setup (Python Scraper)

### 2.1 Neues Projekt erstellen

1. Railway Dashboard > New Project > Deploy from GitHub repo
2. Root Directory: `/` (Root des Repos, nicht `/web`)
3. Railway erkennt `Procfile` und `requirements.txt` automatisch

### 2.2 Environment Variables setzen

In Railway > Variables:

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

EMAIL_ADDRESS=kontakt@example.de
EMAIL_PASSWORD=your-password
SMTP_SERVER=smtp.ionos.de
SMTP_PORT=587
IMAP_SERVER=imap.ionos.de
IMAP_PORT=993

WEBHOOK_SECRET=ein-sicheres-geheimnis-hier
```

> `WEBHOOK_SECRET` selbst generieren, z.B.: `openssl rand -hex 32`

### 2.3 Playwright installieren

Railway braucht Chromium für den HHLA-Scraper. Nixpacks-Buildpack erkennt
`playwright` in `requirements.txt`. Falls nötig, `NIXPACKS_PKGS` setzen:

```
NIXPACKS_PKGS=chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers
```

Oder ein `nixpacks.toml` erstellen:

```toml
[phases.setup]
aptPkgs = ["chromium-browser"]
```

### 2.4 Deploy prüfen

Nach dem Deploy:

```bash
# Health Check
curl https://eta-scraper.up.railway.app/health

# Manueller Scraper-Test
curl -X POST https://eta-scraper.up.railway.app/webhook/run-scraper \
  -H "X-Webhook-Secret: dein-webhook-secret"

# Status abfragen
curl https://eta-scraper.up.railway.app/status
```

---

## 3. Vercel Setup (Next.js Web-App)

### 3.1 Neues Projekt erstellen

1. Vercel Dashboard > Add New Project > Import GitHub repo
2. **Root Directory:** `web`
3. Framework Preset: Next.js (auto-detected)

### 3.2 Environment Variables setzen

In Vercel > Settings > Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

RAILWAY_SCRAPER_URL=https://eta-scraper.up.railway.app
WEBHOOK_SECRET=selbes-geheimnis-wie-in-railway
CRON_SECRET=ein-anderes-geheimnis
```

### 3.3 Cron Jobs (Vercel Pro erforderlich)

Die `vercel.json` konfiguriert automatisch den Cron:

```json
{
  "crons": [{
    "path": "/api/cron/trigger-scraper",
    "schedule": "0 6,12,18 * * *"
  }]
}
```

- Läuft um 06:00, 12:00, 18:00 UTC
- Ruft Railway-Scraper per Webhook auf
- Vercel setzt `Authorization: Bearer <CRON_SECRET>` automatisch

> **Hinweis:** Vercel Cron Jobs erfordern den Pro-Plan. Auf dem Hobby-Plan
> kann man stattdessen einen externen Cron-Service verwenden (z.B. cron-job.org).

### 3.4 Deploy prüfen

```bash
# Web-App
open https://eta-automation.vercel.app

# Health Check
curl https://eta-automation.vercel.app/api/health
```

---

## 4. Architektur-Übersicht

```
Vercel (Next.js)                    Railway (Python)
┌─────────────────┐                ┌──────────────────┐
│  Web-App        │                │  scraper_api.py   │
│  /eta-updater   │                │                    │
│  /dashboard     │    Cron/POST   │  /webhook/run     │
│  /watchlist     │ ─────────────> │    scraper        │
│                 │                │                    │
│  /api/cron/     │                │  pipeline.py       │
│    trigger-     │                │  ├─ Eurogate      │
│    scraper      │                │  ├─ HHLA          │
└────────┬────────┘                │  ├─ Supabase Sync │
         │                         │  └─ ETA Check     │
         │                         └────────┬───────────┘
         │                                  │
         │         Supabase                 │
         │     ┌──────────────┐             │
         └────>│  vessels     │<────────────┘
               │  schedule_   │
               │    events    │
               │  latest_     │
               │    schedule  │
               │  upload_logs │
               │  vessel_     │
               │    watches   │
               │  eta_change_ │
               │    notifs    │
               └──────────────┘
```

---

## 5. Troubleshooting

| Problem | Lösung |
|---------|--------|
| Cron läuft nicht | Vercel Pro-Plan? `CRON_SECRET` gesetzt? |
| Scraper 401 | `WEBHOOK_SECRET` stimmt in Vercel und Railway überein? |
| Scraper 409 | Pipeline läuft bereits, `/status` prüfen |
| HHLA-Scraper scheitert | Playwright/Chromium auf Railway installiert? |
| Dashboard leer nach Upload | `logUpload()` Bug? Prüfe ob `await` vorhanden ist |
| Watchlist-Emails kommen nicht | `EMAIL_ADDRESS`/`EMAIL_PASSWORD` in Railway gesetzt? |
| RLS blockiert Daten | SQL-Policies prüfen, `supabase_watchlist_schema.sql` ausgeführt? |

---

## 6. Monitoring

- **Railway Logs:** Railway Dashboard > Deployments > Logs
- **Vercel Logs:** Vercel Dashboard > Deployments > Functions
- **Supabase Logs:** Dashboard > Logs > API / Postgres
- **Scraper Status:** `GET /status` auf Railway
- **App Health:** `GET /api/health` auf Vercel
