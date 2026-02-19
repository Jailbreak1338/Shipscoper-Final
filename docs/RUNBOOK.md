# ETA Sea Tracker Runbook

This document is the single source of truth for local/prod run, environment variables, schedule, and operations.

## 1. Stack and Entry Points

- Python pipeline entry point: `main.py`
- Python webhook API entry point (Railway): `scraper_api.py`
- Web entry point (Next.js): `web/src/app`
- Scheduled trigger endpoint: `web/src/app/api/cron/trigger-scraper/route.ts`

## 2. How To Run

### 2.1 Local Python (scraper/pipeline)

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
python main.py run
```

Useful commands:

```bash
python main.py scrape
python main.py process
python main.py sync
python main.py email
python main.py status
```

### 2.2 Local Web (Next.js)

```bash
cd web
npm install
npm run dev
```

Optional:

```bash
npm run build
npm run start
npm run generate-sample
```

### 2.3 Production Deployment

- Web: Vercel (`web/`)
- Scraper API: Railway (repo root)
- Database/Auth: Supabase

Use:
- `web/vercel.json`
- `Procfile`
- `railway.json`

## 3. Environment Variables (names only)

### 3.1 Python service (Railway / local pipeline)

- `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL` (fallback alias, optional but supported)
- `SUPABASE_SERVICE_ROLE_KEY`
- `EMAIL_ADDRESS`
- `EMAIL_PASSWORD`
- `SMTP_SERVER`
- `SMTP_PORT`
- `IMAP_SERVER`
- `IMAP_PORT`
- `WEBHOOK_SECRET`
- `PORT` (runtime, Railway)

### 3.2 Web service (Vercel / local web)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RAILWAY_SCRAPER_URL`
- `WEBHOOK_SECRET`
- `CRON_SECRET`
- `MATCH_THRESHOLD`
- `MAX_FILE_MB`
- `TMP_TTL_MIN`
- `NODE_ENV`

## 4. Schedule (Final)

- Scraper schedule: `06:00`, `12:00`, `18:00` UTC (daily)
- Source of truth: `web/vercel.json`
- Trigger path: `/api/cron/trigger-scraper`

## 5. Auth and RLS Operating Mode

- Intended mode: **RLS enabled** for production.
- Base schema: `web/supabase_schema.sql` (tables/views/extensions only)
- Auth/RLS schema: `web/supabase_auth_schema.sql`
- Watchlist schema: `web/supabase_watchlist_schema.sql`
- Service role key is used only on trusted server-side paths (Python backend and Next.js server routes).

## 6. Troubleshooting (Top 10)

1. Cron endpoint returns 401:
   - Check `CRON_SECRET` in Vercel and `Authorization: Bearer <CRON_SECRET>`.
2. Webhook trigger fails 401:
   - Check `WEBHOOK_SECRET` matches in Vercel and Railway.
3. HHLA scraper unstable:
   - Check Playwright/Chromium availability and timeout settings.
4. Supabase sync skipped:
   - Check `SUPABASE_SERVICE_ROLE_KEY` and URL variables.
5. No watchlist notifications:
   - Check mail env vars and `notification_enabled` in `vessel_watches`.
6. Dashboard/upload errors:
   - Check RLS policies and `upload_logs`/`user_roles` tables.
7. Vercel file download returns 404:
   - `/tmp` file expired or cleaned; re-run upload.
8. Railway pipeline stuck/running:
   - Check `/status` endpoint and Railway logs.
9. Local scheduler scripts fail:
   - Validate working directory and venv path from script location.
10. Encoding glitches (umlauts):
   - Ensure UTF-8 without BOM in editor and git settings.

Mail workflow semantics:
- Incoming attachments are trigger artifacts only (archived in `data/inbox`).
- Reply attachment is always a newly generated live-scrape report.

## 7. External Ops Steps

If environment/UI changes are needed outside the repo, follow `OPS-CHECKLIST.md`.
