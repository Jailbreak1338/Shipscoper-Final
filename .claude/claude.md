\# CLAUDE.md — ETA Sea Tracker



Context file for Claude Code. Read this before making changes.



---



\## Project overview



Full-stack vessel ETA tracking + container status notifications for Hamburg terminals (Eurogate \& HHLA).



\*\*Three services:\*\*

1\. \*\*Python scraper\*\* (Railway) — Playwright + requests scraper exposed via Flask API

2\. \*\*Next.js frontend\*\* (Vercel) — Excel upload, watchlist, search, sendungen

3\. \*\*Node.js worker\*\* (runs inside Railway via Flask trigger) — Container status checker



\*\*Database:\*\* Supabase (PostgreSQL + Auth + RLS)



---



\## Tech stack



| Layer | Tech |

|-------|------|

| Scraper | Python 3.11, Playwright, BeautifulSoup, pandas, Supabase Python SDK |

| Scraper API | Flask 3, Gunicorn, Railway + Nixpacks |

| Worker | TypeScript, tsx, Playwright, Supabase JS SDK |

| Frontend | Next.js 14 (App Router), React 18, TypeScript |

| Auth | Supabase Auth (email/password) |

| DB | Supabase PostgreSQL with RLS |

| Email | Resend (primary) / AWS SES / SMTP |

| Hosting | Railway (Python) + Vercel (Next.js) |



---



\## Directory structure



```

eta-sea-tracker-codex/

├── scraper\_api.py              Flask API — Railway entry point

├── main.py                     CLI (click) — local dev use

├── config.yaml                 Scraper config (URLs, thresholds, timeouts)

├── requirements.txt            Python deps

├── package.json                Root: tsx worker scripts + tests

├── tsconfig.json               TypeScript config (root, for src/)

├── nixpacks.toml               Railway Nixpacks build config

├── railway.json                Railway deploy manifest

├── Procfile                    Fallback start command

│

├── scraper/

│   ├── hhla\_scraper.py         Playwright SPA scraper, 14 columns

│   ├── eurogate\_scraper.py     requests + BS4, session-based, rowspan table

│   ├── supabase\_writer.py      upserts vessels + schedule\_events

│   └── email\_sender.py         SMTP ETA change notifications (Python)

│

├── orchestrator/

│   ├── pipeline.py             run\_scrape() / run\_full() / run\_sync\_from\_latest()

│   └── email\_handler.py        IMAP inbox automation

│

├── processor/

│   └── excel\_processor.py      fuzzy matching (Levenshtein) + Excel export

│

├── utils/

│   ├── config\_loader.py        YAML + .env loader

│   ├── logger.py               Loguru setup

│   └── normalization.py        vessel name normalization

│

├── src/                        Node.js TypeScript worker

│   ├── jobs/checkContainers.ts Main container status job

│   ├── providers/hhla.ts       HHLA coast.hhla.de Playwright scraper

│   ├── providers/eurogate.ts   Eurogate portal scraper

│   └── lib/

│       ├── email.ts            Email sender (Resend / SES / none)

│       ├── hash.ts             SHA-256 status fingerprint

│       ├── supabase.ts         Supabase client

│       └── types.ts            Shared TypeScript interfaces

│

├── web/                        Next.js 14 frontend

│   ├── src/app/

│   │   ├── layout.tsx          Root layout + nav

│   │   ├── eta-updater/        Excel upload + processing UI

│   │   ├── watchlist/          Vessel watchlist

│   │   ├── sendungen/          Shipment tracking (container per S-Nr)

│   │   ├── schedule-search/    Search all vessel schedules

│   │   ├── dashboard/          Upload stats + admin

│   │   └── api/

│   │       ├── update-excel/   POST Excel → process → return jobId

│   │       ├── download/\[jobId] GET processed Excel

│   │       ├── watchlist/      CRUD vessel watches

│   │       ├── sendungen/      Container per shipment lookup

│   │       └── admin/          Admin triggers

│   └── src/lib/

│       ├── excel.ts            Column detection + fuzzy match

│       ├── normalize.ts        Vessel name normalization (JS)

│       ├── security.ts         getClientIp, extractShipmentNumbers

│       ├── tmpFiles.ts         /tmp TTL management (Vercel Lambda)

│       ├── supabaseClient.ts   Browser Supabase client

│       └── supabaseServer.ts   Server-side Supabase (service role)

│

├── migrations/

│   ├── 20260221\_container\_tracking.sql   container\_latest\_status, events, notifications

│   └── 20260223\_container\_snr\_pairs.sql  container\_snr\_pairs JSONB, status\_check\_runs

│

└── web/

&nbsp;   ├── supabase\_schema.sql           vessels, schedule\_events, latest\_schedule view

&nbsp;   ├── supabase\_auth\_schema.sql      user\_roles, upload\_logs, scraper\_runs

&nbsp;   └── supabase\_watchlist\_schema.sql vessel\_watches, eta\_change\_notifications

```



---



\## Key data model



\### vessel\_watches (most important table)



```sql

id                  UUID

user\_id             UUID (→ auth.users)

vessel\_name         TEXT

vessel\_name\_normalized TEXT

shipment\_reference  TEXT  -- comma-separated S-Nrs: "S00123456, S00789012"

container\_reference TEXT  -- comma-separated containers: "MSCU1234567, HLBU7654321"

container\_snr\_pairs JSONB -- \[{"container\_no":"MSCU1234567","snr":"S00123456"}]

last\_known\_eta      TIMESTAMPTZ

notification\_enabled BOOLEAN  -- gates EMAIL only, not status checking

container\_source    TEXT  -- 'HHLA' | 'EUROGATE' | 'AUTO'

```



`container\_snr\_pairs` is the canonical mapping from Excel row imports.

`shipment\_reference` + `container\_reference` are legacy fallback (cross-product).



\### Container status flow



```

PREANNOUNCED → DISCHARGED → READY → DELIVERED\_OUT

```



Email on `DISCHARGED`, `READY`, `DELIVERED\_OUT`.

Deduplicated via UNIQUE on `container\_status\_notifications(watch\_id, container\_no, event\_type, status\_hash)`.



\### Container number format (ISO-6346)

```

/^\[A-Z]{4}\[0-9]{7}$/

```

4 uppercase letters + 7 digits. Validated everywhere.



---



\## Important patterns \& conventions



\### Vessel name normalization

All vessel names go through `normalizeVesselName()` (TS: `web/src/lib/normalize.ts`, Python: `utils/normalization.py`).

Always store normalized form in `\*\_normalized` columns. Never compare raw names.



\### Shipment numbers (S-Nrs)

Format: `S` + 8 digits. Extracted with `extractShipmentNumbers()` in `web/src/lib/security.ts`.

Stored comma-separated in `shipment\_reference`.



\### Supabase access patterns

\- Browser: `supabaseClient.ts` (anon key, RLS enforced)

\- API routes: `supabaseServer.ts` `getSupabaseAdmin()` (service role, RLS bypassed)

\- Always use admin client for writes from API routes



\### Next.js API routes use Next 14 App Router style

```typescript

export async function POST(request: NextRequest): Promise<NextResponse>

```



\### Auth in API routes

```typescript

const supabase = createRouteHandlerClient({ cookies });

const { data: { session } } = await supabase.auth.getSession();

if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

```



\### Webhook auth (Next.js → Railway)

All requests to the Railway Flask API include `X-Webhook-Secret: $WEBHOOK\_SECRET`.

Both sides use the same env var `WEBHOOK\_SECRET`.



---



\## Common commands



```bash

\# Tests (Node.js unit tests in src/tests/logic.test.ts)

npm test



\# TypeScript type check (root + web)

npm run typecheck

cd web \&\& npx tsc --noEmit



\# Container status check (runs once, exits)

npm run check-containers



\# Next.js dev

cd web \&\& npm run dev



\# Python: full scrape + Supabase sync

python main.py run



\# Python: just process an Excel locally

python main.py process --input myfile.xlsx

```



---



\## Environment variables



\### Root `.env` (Railway + Node.js worker)

```

SUPABASE\_URL

SUPABASE\_SERVICE\_ROLE\_KEY

EMAIL\_ADDRESS          # SMTP sender for ETA change emails

EMAIL\_PASSWORD

SMTP\_SERVER / SMTP\_PORT

IMAP\_SERVER / IMAP\_PORT

WEBHOOK\_SECRET         # Shared with Vercel

EMAIL\_PROVIDER         # resend | ses | none

EMAIL\_FROM             # "Name <addr>"

RESEND\_API\_KEY

MAX\_CONCURRENCY        # parallel container checks (default 2)

```



\### `web/.env.local` (Vercel / Next.js)

```

NEXT\_PUBLIC\_SUPABASE\_URL

NEXT\_PUBLIC\_SUPABASE\_ANON\_KEY

SUPABASE\_SERVICE\_ROLE\_KEY

RAILWAY\_SCRAPER\_URL    # https://your-app.up.railway.app

WEBHOOK\_SECRET         # Same as Railway

CRON\_SECRET

MATCH\_THRESHOLD        # 0.85

MAX\_FILE\_MB            # 10

TMP\_TTL\_MIN            # 30

```



---



\## Railway / Nixpacks deployment — CRITICAL NOTES



\### LD\_LIBRARY\_PATH must NOT be an env variable



numpy and Playwright need `libstdc++.so.6` from the apt layer (`/usr/lib/x86\_64-linux-gnu/`).

Setting `LD\_LIBRARY\_PATH` in `nixpacks.toml \[variables]` or Railway Variables causes \*\*all\*\* build stages to inherit it as a Docker ENV, which breaks Nix bash with:

```

bash: error while loading shared libraries: \_\_vdso\_gettimeofday: invalid mode for dlopen()

```



\*\*Correct approach\*\*: set it inline in the start command only:

```

LD\_LIBRARY\_PATH=/usr/lib/x86\_64-linux-gnu python -m gunicorn ...

```



This is already set in `nixpacks.toml \[start]`, `railway.json startCommand`, and `Procfile`.

\*\*Never move this to env variables.\*\*



\### nixpacks.toml \[variables] vs Railway Variables

`\[variables]` in nixpacks.toml become Docker ENV → apply to all build stages.

Railway dashboard Variables → also Docker ENV.

Both are problematic for LD\_LIBRARY\_PATH.



\### nodejs\_20 must be in nixPkgs

If `package.json` and `requirements.txt` both exist, Nixpacks may auto-switch to Node-only mode.

`nixpacks.toml` explicitly lists `\['python311', 'python311Packages.pip', 'nodejs\_20']` to keep both.

`PIP\_BREAK\_SYSTEM\_PACKAGES = "1"` is required because Nix marks its Python as externally managed (PEP 668).



---



\## Flask API endpoints (Railway)



All require header `X-Webhook-Secret: <WEBHOOK\_SECRET>`.



| Method | Path | Description |

|--------|------|-------------|

| GET | `/health` | Health check (no auth) |

| GET | `/status` | Pipeline status |

| POST | `/webhook/run-scraper` | Trigger full scrape pipeline |

| POST | `/webhook/test-email` | Send test email to user |

| POST | `/webhook/check-containers` | Trigger checkContainers.ts |



`/webhook/run-scraper` and `/webhook/check-containers` run in background threads and return 202 immediately.



---



\## checkContainers.ts behavior



\- Loads ALL `vessel\_watches` that have a `container\_reference` (does NOT filter by `notification\_enabled`)

\- `notification\_enabled` gates only email sending, not scraping

\- Scrapes each container via provider (HHLA or Eurogate)

\- Computes SHA-256 hash of status fields

\- Upserts `container\_latest\_status`

\- If hash changed: inserts `container\_status\_events` row + sends email if notification\_enabled AND terminal status warrants it

\- Logs structured JSON to console + `status\_check\_runs` table

\- Run ID (UUID) ties logs to DB record



---



\## Excel upload flow (update-excel/route.ts)



1\. POST multipart/form-data with file + column mappings

2\. `detectColumns()` — auto-detect vessel/ETA/shipment/container columns

3\. `processExcel()` — fuzzy match vessel names → update ETA cells

4\. `autoAssignShipmentsFromUpload()` — create/update `vessel\_watches` with S-Nr + container pairs

5\. Save updated buffer to `/tmp/<uuid>.xlsx` (Vercel Lambda writable)

6\. Return `jobId` → client fetches `/api/download/<jobId>`



`container\_snr\_pairs` is built per-row: each row = one `{container\_no, snr}` pair.

This avoids cross-product explosions when a vessel has multiple containers and S-Nrs.



---



\## Known issues / gotchas



1\. \*\*Vercel /tmp is ephemeral\*\* — downloaded Excel files expire after `TMP\_TTL\_MIN` (default 30 min). `cleanupExpiredTmpFiles()` runs on each upload.



2\. \*\*`notification\_enabled` default is `false`\*\* for Excel-imported watches (to avoid spam on bulk import). Users must manually enable in Watchlist UI.



3\. \*\*Supabase `UNIQUE(user\_id, vessel\_name\_normalized, shipment\_reference)`\*\* on `vessel\_watches` — if the same vessel appears in multiple Excel rows with different S-Nrs, they get merged into one watch row with comma-separated refs.



4\. \*\*schedule\_events dedup\*\* — `UNIQUE(vessel\_id, source, eta, terminal)` prevents duplicate schedule records.



5\. \*\*Fuzzy matching threshold\*\* — `MATCH\_THRESHOLD=0.85`. Below this, vessels are listed in `unmatchedNames` in the upload response.



6\. \*\*Container provider auto-detection\*\* — If `container\_source` is NULL or 'AUTO', the checker tries HHLA first, then Eurogate. Can set explicitly in Watchlist UI.



7\. \*\*`latest\_schedule` is a VIEW\*\* (not materialized) — queries on it can be slow if `schedule\_events` is large. Add a `scraped\_at > NOW() - interval '30 days'` filter if needed.



---



\## SQL migration order (fresh setup)



Run in Supabase SQL Editor in this order:

```

1\. web/supabase\_schema.sql

2\. web/supabase\_auth\_schema.sql

3\. web/supabase\_watchlist\_schema.sql

4\. migrations/20260221\_container\_tracking.sql

5\. migrations/20260223\_container\_snr\_pairs.sql

```



All migrations are idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).



---



\## Testing



Unit tests live in `src/tests/logic.test.ts` (Node.js built-in test runner).

Run with `npm test`.



Covers:

\- ISO-6346 container validation

\- container\_snr\_pairs building

\- Deduplication logic

\- `notification\_enabled` independence from status checking

\- S-Nr filter vessel subset logic



