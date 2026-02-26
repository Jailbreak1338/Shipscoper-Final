# Shipscoper

Vessel ETA tracking and container status notifications for the Hamburg terminals **HHLA** and **Eurogate*

---

## Architecture

Three services work together:

| Service | Runtime | Hosting |
|---------|---------|---------|
| Python Scraper API | Python 3.11 + Flask + Playwright | Railway |
| Next.js Frontend | Next.js 14 (App Router) + TypeScript | Vercel |
| Node.js Container Worker | TypeScript + tsx + Playwright | Railway (via Flask trigger) |

**Database:** Supabase (PostgreSQL + Auth + RLS)
**Email:** Resend (REST API, sender: `hello@shipscoper.com`)

---

## Directory structure

```
shipscoper/
├── scraper_api.py              Flask API — Railway entry point
├── main.py                     CLI — local dev use
├── config.yaml                 Scraper config (URLs, timeouts, thresholds)
├── requirements.txt            Python dependencies
├── nixpacks.toml               Railway Nixpacks build config
├── railway.json                Railway deploy manifest
├── Procfile                    Fallback start command
│
├── scraper/
│   ├── hhla_scraper.py         Playwright SPA scraper (14 columns)
│   ├── eurogate_scraper.py     requests + BS4, session-based, rowspan table
│   ├── supabase_writer.py      Upserts vessels + schedule_events
│   └── email_sender.py         SMTP ETA-change notifications (Python)
│
├── orchestrator/
│   ├── pipeline.py             run_scrape() / run_full() / run_sync_from_latest()
│   └── email_handler.py        IMAP inbox automation
│
├── processor/
│   └── excel_processor.py      Fuzzy matching (Levenshtein) + Excel export
│
├── utils/
│   ├── config_loader.py        YAML + .env loader
│   ├── logger.py               Loguru setup
│   └── normalization.py        Vessel name normalization
│
├── src/                        Node.js TypeScript container worker
│   ├── jobs/checkContainers.ts Main container status job (7-day ETA filter)
│   ├── providers/hhla.ts       HHLA coast.hhla.de Playwright scraper
│   ├── providers/eurogate.ts   Eurogate portal scraper
│   └── lib/
│       ├── email.ts            Email sender (Resend / SES / none)
│       ├── hash.ts             SHA-256 status fingerprint
│       ├── supabase.ts         Supabase client
│       └── types.ts            Shared TypeScript interfaces
│
├── web/                        Next.js 14 frontend (Vercel)
│   ├── src/app/
│   │   ├── page.tsx            Landing page (waitlist)
│   │   ├── login/              Auth (Supabase email/password)
│   │   ├── eta-updater/        Excel upload + ETA processing
│   │   ├── watchlist/          Vessel watchlist (ETA sorted, notifications)
│   │   ├── sendungen/          Shipment tracking — 3 tabs:
│   │   │                         Container | Stückgut | Ohne ETA
│   │   ├── schedule-search/    Search all vessel schedules (ETA sorted)
│   │   ├── dashboard/          Upload stats
│   │   ├── admin/              Admin panel
│   │   │   └── users/          User management (invite-by-email)
│   │   ├── impressum/          Impressum (§ 5 TMG)
│   │   └── datenschutz/        Datenschutzerklärung (DSGVO)
│   │
│   └── src/app/api/
│       ├── update-excel/       POST Excel → process → jobId
│       ├── download/[jobId]/   GET processed Excel (30-min TTL in /tmp)
│       ├── watchlist/          CRUD vessel watches
│       ├── sendungen/          Container lookup per shipment
│       │   └── auto-dispo/     POST → Resend email for red-flagged containers
│       ├── cron/
│       │   ├── trigger-scraper/   Daily scraper trigger (06:00 UTC)
│       │   └── check-containers/  Container status check (every 2 h)
│       └── admin/
│           └── users/          Invite / list / role-change / delete users
│
├── migrations/
│   ├── 20260221_container_tracking.sql
│   └── 20260223_container_snr_pairs.sql
│
└── web/
    ├── supabase_schema.sql           vessels, schedule_events, latest_schedule view
    ├── supabase_auth_schema.sql      user_roles, upload_logs, scraper_runs
    └── supabase_watchlist_schema.sql vessel_watches, eta_change_notifications
```

---

## Features

### Excel Upload (ETA Updater)
- Upload customer Excel with vessel / ETA / shipment / container columns
- Auto-detection of column positions via `detectColumns()`
- Fuzzy vessel name matching (Levenshtein, threshold configurable via `MATCH_THRESHOLD`)
- Updated ETAs written back into the Excel — downloadable within 30 minutes
- Creates/updates `vessel_watches` per row with `container_snr_pairs` (ISO-6346 validated)

### Sendungen (Shipment Tracking)
Three tabs:

| Tab | Content |
|-----|---------|
| **Container** | Containers with ETA/ETD, status, delivery date |
| **Stückgut** | Shipments without container numbers |
| **Ohne ETA** | Rows with no ETA — for easy manual follow-up |

- All rows sorted by ETA ascending (nulls last)
- **Delivery date** highlighted red when `Anliefertermin < ETD` (ship hasn't arrived yet)
- **Auto-Dispo button**: collects all red-marked rows and sends a summary email via Resend to the logged-in user
- **Notification bell** per row: toggle email alerts for status changes
- Auto-refresh every 3 minutes

### Vessel Watchlist
- All vessel watches sorted by `last_known_eta` ascending
- Auto-refresh every 3 minutes
- Per-watch notification toggle (email on ETA change)

### Container Status Tracking
- Runs automatically via Vercel cron every 2 hours (`/api/cron/check-containers`)
- **Only checks containers where `last_known_eta` is within 7 days** (avoids unnecessary scraping)
- Status flow: `PREANNOUNCED → DISCHARGED → READY → DELIVERED_OUT`
- Email sent on `DISCHARGED`, `READY`, `DELIVERED_OUT` (idempotent via DB UNIQUE constraint)
- `notification_enabled` gates email only — status is always checked and stored

### Schedule Search
- Search all vessel schedules stored in Supabase
- Default sort: ETA ascending

### User Management (Admin)
- Invite users by email — Resend sends a password-setup link from `hello@shipscoper.com`
- Admins can change roles (user / admin) and delete accounts
- Self-demotion and self-deletion protected

### Cron Jobs (Vercel)
| Schedule | Endpoint | Action |
|----------|----------|--------|
| `0 6 * * *` (daily 06:00 UTC) | `/api/cron/trigger-scraper` | Triggers Railway scraper |
| `0 */2 * * *` (every 2 h) | `/api/cron/check-containers` | Triggers Railway container check |

---

## Data model

### vessel_watches (key table)

```sql
id                  UUID
user_id             UUID → auth.users
vessel_name         TEXT
vessel_name_normalized TEXT
shipment_reference  TEXT    -- comma-separated: "S00123456, S00789012"
container_reference TEXT    -- comma-separated: "MSCU1234567, HLBU7654321"
container_snr_pairs JSONB   -- [{"container_no":"MSCU1234567","snr":"S00123456"}]
last_known_eta      TIMESTAMPTZ
notification_enabled BOOLEAN -- gates EMAIL only, not status checking
container_source    TEXT    -- 'HHLA' | 'EUROGATE' | 'AUTO'
delivery_date       DATE    -- Anliefertermin from Excel
```

### Container number format (ISO-6346)
```
/^[A-Z]{4}[0-9]{7}$/
```

### Shipment number format
```
S + 8 digits  →  e.g. S00123456
```

---

## Environment variables

### Railway / Node.js worker (`.env`)

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

EMAIL_PROVIDER=resend           # resend | ses | none
EMAIL_FROM=Shipscoper <hello@shipscoper.com>
RESEND_API_KEY=re_...

SMTP_SERVER=
SMTP_PORT=
EMAIL_ADDRESS=
EMAIL_PASSWORD=
IMAP_SERVER=
IMAP_PORT=

WEBHOOK_SECRET=                 # Shared with Vercel
MAX_CONCURRENCY=2
```

### Vercel / Next.js (`web/.env.local`)

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

RAILWAY_SCRAPER_URL=https://your-app.up.railway.app
WEBHOOK_SECRET=                 # Same as Railway
CRON_SECRET=

RESEND_API_KEY=re_...
EMAIL_FROM=Shipscoper <hello@shipscoper.com>

MATCH_THRESHOLD=0.85
MAX_FILE_MB=10
TMP_TTL_MIN=30
```

---

## Deployment

### Railway (Python Scraper + Node.js Worker)

> **Critical:** `LD_LIBRARY_PATH` must **not** be set as a Railway environment variable or in `nixpacks.toml [variables]`. It must only appear inline in the start command (already set in `nixpacks.toml`, `railway.json`, `Procfile`).

```bash
# nixpacks.toml start command (do not change):
LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu python -m gunicorn scraper_api:app ...
```

Railway Flask API endpoints (all require `X-Webhook-Secret` header):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth) |
| POST | `/webhook/run-scraper` | Trigger full scrape (async, 202) |
| POST | `/webhook/check-containers` | Trigger container check (async, 202) |
| POST | `/webhook/test-email` | Send test email |

### Vercel (Next.js)

```bash
cd web
npm run build    # verify before deploying
```

Set all `web/.env.local` variables as Vercel Environment Variables.

### Supabase migrations (fresh setup — run in order)

```sql
1. web/supabase_schema.sql
2. web/supabase_auth_schema.sql
3. web/supabase_watchlist_schema.sql
4. migrations/20260221_container_tracking.sql
5. migrations/20260223_container_snr_pairs.sql
```

All migrations are idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).

---

## Local development

```bash
# Next.js dev
cd web && npm run dev

# Python scraper (full pipeline)
python main.py run

# Python scraper (just process an Excel locally)
python main.py process --input myfile.xlsx

# Node.js container check (runs once, exits)
npm run check-containers

# TypeScript type checks
npm run typecheck
cd web && npx tsc --noEmit

# Unit tests (Node.js built-in runner)
npm test
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Eurogate session expired | Scraper restarts session automatically |
| HHLA "No table found" | JavaScript not loaded — increase Playwright timeout in `config.yaml` |
| Invite email not delivered | Check Resend dashboard; verify `RESEND_API_KEY` + `EMAIL_FROM` in Vercel env vars |
| Containers not checked | Verify `last_known_eta` is within 7 days and `container_reference` is set |
| Fuzzy match misses | Lower `MATCH_THRESHOLD` in Vercel env (default 0.85) |
| `/tmp` file expired | Excel download link is valid for `TMP_TTL_MIN` minutes (default 30) — re-upload |
| `LD_LIBRARY_PATH` build error | Remove it from Railway Variables — must only be in start command |
| Resend free tier | 100 emails/day, 3,000/month — upgrade plan if needed |
