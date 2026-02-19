# ETA Automation – Web App

Next.js 14 Web-App zum automatischen Abgleich von Vessel ETAs aus Excel-Dateien mit Supabase-Datenbank.

## Features

- Excel Upload (.xlsx / .xls)
- Automatische Spaltenerkennung (Vessel, ETA, Terminal)
- Exact + Fuzzy Matching (Levenshtein, Threshold 85%)
- Updated Excel zum Download
- Responsive Design

## Voraussetzungen

- Node.js 18+
- Supabase-Projekt (kostenloser Tier reicht)

## 1. Supabase Setup

### Projekt erstellen

1. Gehe zu [supabase.com](https://supabase.com) und erstelle ein neues Projekt
2. Notiere dir:
   - **Project URL** (z.B. `https://abc123.supabase.co`)
   - **anon key** (unter Settings > API)
   - **service_role key** (unter Settings > API)

### Schema anlegen

Gehe zum **SQL Editor** in Supabase und führe die SQL-Dateien in dieser Reihenfolge aus:

1. `supabase_schema.sql` (Basis-Tabellen/Views)
2. `supabase_auth_schema.sql` (RLS/Auth/roles/upload logs)
3. `supabase_watchlist_schema.sql` (Watchlist + notifications)

`supabase_schema.sql` enthält absichtlich keine RLS-Toggles.

```sql
-- Kurzfassung – vollständiges SQL in supabase_schema.sql

CREATE TABLE vessels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE schedule_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vessel_id UUID REFERENCES vessels(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  eta TIMESTAMPTZ,
  etd TIMESTAMPTZ,
  terminal TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vessel_id, source, eta, terminal)
);

-- View: latest_schedule (neuester Eintrag pro vessel+source)
-- Siehe supabase_schema.sql für die vollständige View-Definition
```

## 2. Installation

```bash
cd web
npm install
```

## 3. Environment-Variablen

```bash
cp .env.example .env
```

Bearbeite `.env` mit deinen Supabase-Credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
MATCH_THRESHOLD=0.85
MAX_FILE_MB=10
TMP_TTL_MIN=30
```

## 4. Development

```bash
npm run dev
```

App läuft unter [http://localhost:3000/eta-updater](http://localhost:3000/eta-updater)

## 5. Testdaten erstellen

### Sample Excel generieren

```bash
npm run generate-sample
```

Erstellt `sample_vessels.xlsx` mit 12 Testeinträgen.

### Supabase Seed-Daten (nur Development)

```bash
curl -X POST http://localhost:3000/api/dev/seed
```

Oder im Browser die DevTools Console:
```js
fetch('/api/dev/seed', { method: 'POST' }).then(r => r.json()).then(console.log)
```

### Health Check

```bash
curl http://localhost:3000/api/health
```

## 6. Testing-Ablauf

1. Supabase Schema anlegen (SQL Editor)
2. Seed-Daten laden (`/api/dev/seed`)
3. Sample Excel generieren (`npm run generate-sample`)
4. App öffnen (`/eta-updater`)
5. `sample_vessels.xlsx` hochladen
6. Spalten überprüfen (sollten auto-detected sein)
7. "ETAs updaten" klicken
8. Ergebnis prüfen: 8 matched, 2 fuzzy, 2 unmatched
9. Excel herunterladen und prüfen

## 7. API Referenz

| Endpoint | Method | Beschreibung |
|---|---|---|
| `/api/update-excel` | POST | Excel hochladen + updaten |
| `/api/download/[jobId]` | GET | Updated Excel herunterladen |
| `/api/health` | GET | Health Check |
| `/api/dev/seed` | POST | Testdaten laden (nur dev) |

### POST /api/update-excel

**FormData Parameter:**

| Feld | Typ | Required | Beschreibung |
|---|---|---|---|
| `file` | File | Ja | Excel-Datei (.xlsx/.xls) |
| `mode` | string | Nein | `detect` = nur Spalten erkennen |
| `vesselCol` | string | Ja* | Name der Vessel-Spalte |
| `etaCol` | string | Ja* | Name der ETA-Spalte |
| `terminalCol` | string | Nein | Name der Terminal-Spalte |

*Nicht nötig wenn `mode=detect`

## Troubleshooting

### "Missing environment variables"
- Prüfe ob `.env` existiert und alle Variablen gesetzt sind
- Neustart: `npm run dev`

### "Supabase query failed"
- SQL Schema in Supabase ausgeführt?
- `latest_schedule` View existiert?
- Service Role Key korrekt?

### "File too large"
- Default-Limit: 10 MB
- Anpassbar über `MAX_FILE_MB` in `.env`

### Keine Matches gefunden
- Seed-Daten geladen? (`/api/dev/seed`)
- Vessel-Namen in Excel = Vessel-Namen in DB?
- Match Threshold zu hoch? (Default 0.85)

### Download "File not found or expired"
- Temp-Dateien werden nach 30 Min gelöscht
- Nochmal hochladen und updaten

## Projektstruktur

```
web/
├── src/
│   ├── app/
│   │   ├── layout.tsx           # Root Layout
│   │   ├── page.tsx             # Redirect -> /eta-updater
│   │   ├── globals.css          # Global styles
│   │   ├── eta-updater/
│   │   │   └── page.tsx         # Main UI
│   │   └── api/
│   │       ├── update-excel/
│   │       │   └── route.ts     # Excel processing
│   │       ├── download/
│   │       │   └── [jobId]/
│   │       │       └── route.ts # File download
│   │       ├── health/
│   │       │   └── route.ts     # Health check
│   │       └── dev/
│   │           └── seed/
│   │               └── route.ts # Dev seeding
│   └── lib/
│       ├── supabaseServer.ts    # Server-side Supabase client
│       ├── supabaseClient.ts    # Client-side Supabase client
│       ├── normalize.ts         # Name normalization + similarity
│       └── excel.ts             # Excel parsing + matching
├── scripts/
│   └── generate_sample_excel.ts
├── supabase_schema.sql
├── package.json
├── tsconfig.json
├── next.config.js
├── .env.example
└── .gitignore
```
