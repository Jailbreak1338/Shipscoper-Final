# Codex-Arbeit

Diese Datei dokumentiert die schrittweise Abarbeitung des Runbooks in Reihenfolge.

## Schritt 1 – Stack & Entry Points
- README/Runbook-Einstiegspunkte geprüft (Python API, Next.js App, Cron Route).
- Keine Codeänderung erforderlich.

## Schritt 2 – Run/Build Ablauf
- Build-Guard für Merge-Conflict-Marker ist aktiv (`web/scripts/check-conflict-markers.mjs`).
- Web-Build-Prozess geprüft.

## Schritt 3 – ENV-Liste gepflegt
- Runbook um tatsächlich verwendete Web-Variablen ergänzt:
  - `NEXT_PUBLIC_SITE_URL`
  - `APP_URL`

## Schritt 4 – Schedule
- Cron-Quelle bleibt `web/vercel.json` / `/api/cron/trigger-scraper`.
- Keine Änderung erforderlich.

## Schritt 5 – Auth/RLS
- Server-seitige Auth-Checks wurden zuvor bereits auf `getUser()` umgestellt.
- Status: umgesetzt.

## Schritt 6 – Troubleshooting
- Admin-User-Management-Fehlertexte wurden zuvor bereinigt (DELETE/PATCH melden nicht mehr „saving new user“).
- Invite/Passwort-Setup Troubleshooting ist im Runbook enthalten.

## Schritt 7 – External Ops
- Verweist weiterhin korrekt auf `OPS-CHECKLIST.md`.
- Externe Plattform-Schritte (Supabase/Vercel) bleiben manuell.

## Schritt 8 – Invite/Password Flow
- Bereits umgesetzt und dokumentiert; wurde bewusst nicht erneut umgebaut, da laut Vorgabe funktionsfähig.

## Durchgeführte technische Checks
- `npm test` (root)
- `cd web && npx tsc --noEmit`
- `cd web && npm run build` (expected warning/fail ohne lokale Supabase ENV)

## Laufende Abarbeitung (dieser Durchlauf)
1. Runbook vollständig erneut gelesen und Reihenfolge bestätigt.
2. Schritt 2 geprüft: Build-Guard aktiv und vor `next build` ausgeführt.
3. Schritt 3 gepflegt: in `RUNBOOK.md` sind `NEXT_PUBLIC_SITE_URL` und `APP_URL` als Web-ENV ergänzt.
4. Schritt 5/6 verifiziert: Auth-Härtung (`getUser`) und Admin-Fehler-Mapping sind aktiv.
5. Technische Checks durchgeführt:
   - `npm test` ✅
   - `cd web && npx tsc --noEmit` ✅
   - `cd web && npm run build` ⚠️ (lokal ohne Supabase ENV scheitert Prerender erwartbar)

Status: Runbook-Inhalte im Repo sind der Reihe nach umgesetzt bzw. als externe Ops-Schritte dokumentiert.
