# Safety-First Onboarding & Implementation Plan

## A) Umfeld-Analyse

### 1) Architektur-Skizze (aus Readme + Code-Check)
- **Web-App (Next.js 14 / App Router)** unter `web/` mit API-Routen für Admin, Watchlist, Sendungen, Excel-Upload/Download und Cron-Triggern.
- **Scraper API (Python/Flask)** wird über Webhook-Endpunkte (`/webhook/run-scraper`, `/webhook/check-containers`) von der Web-App getriggert.
- **Container-Worker (Node/TS)** verarbeitet Containerstatus, inkl. ETA-begrenzter Auswahl.
- **DB/Auth** über Supabase (`vessel_watches`, `upload_logs`, `user_roles`, `scraper_runs`, etc.).

### 2) Lokales Setup / Skripte / Checks
- Root-Skripte: `npm test`, `npm run typecheck`, `npm run check-containers`.
- Web-Skripte: `npm run dev`, `npm run build` (in `web/`).
- Ergebnis im Onboarding:
  - `npm test` **grün**.
  - `npm run typecheck` **rot** (fehlende AWS-SDK Types + DOM-Typfehler in Scraper-Providern) → kein blocker für Plan, aber als Stabilitäts-Risiko dokumentiert.

### 3) Relevante Module (ohne invasive Änderungen)
- **User-Create + Admin UI**
  - `web/src/app/api/admin/users/route.ts`
  - `web/src/app/admin/users/page.tsx`
- **Waitlist + Invite-Flow**
  - `web/src/app/actions/waitlist.ts`
  - `web/src/app/watchlist/page.tsx`
  - `web/src/app/api/watchlist/test-email/route.ts`
  - `web/src/app/api/watchlist/test-email-status/route.ts`
- **Excel Upload/Download/Formatierung**
  - `web/src/app/api/update-excel/route.ts`
  - `web/src/lib/excel.ts`
  - `web/src/app/api/download/[jobId]/route.ts`
  - `web/src/lib/tmpFiles.ts`
- **Listen/Watchlist/Container/Stückgut**
  - `web/src/app/sendungen/page.tsx`
  - `web/src/app/api/sendungen/route.ts`
  - `web/src/app/watchlist/page.tsx`
  - `web/src/app/api/watchlist/route.ts`
- **ETA Handling / Queries / Background**
  - `web/src/app/api/sendungen/route.ts`
  - `src/jobs/checkContainers.ts`
- **Scraper Run / HTTP-Client / Endpoints**
  - `web/src/app/api/admin/trigger-scraper/route.ts`
  - `web/src/app/api/cron/trigger-scraper/route.ts`
  - `web/src/app/api/cron/check-containers/route.ts`
  - `web/src/lib/security.ts` (`getValidatedScraperUrl`)

### 4) Risiken & Abhängigkeiten
- **DB-Schema-Risiken**
  - Neue Archiv-/Statusfelder (`archivedAt` oder `status`) + neue Waitlist/Invite-Felder erfordern additive, idempotente Migrationen.
  - Bulk Delete braucht serverseitige Autorisierung + evtl. Audit-Log-Tabelle.
- **Export-Library-Risiken**
  - Excel-Erhalt von Styles läuft über ExcelJS In-Place-Update. Regression-Risiko bei Formeln/Datumszellen/führenden Nullen.
- **UI-only Risiken**
  - Admin-Tabs, Checkbox/Bulk-UX, Entfernen Test-Email-Button primär frontendseitig; dennoch Backend-Endpunkte sauber entfernen/deaktivieren.
- **Integrations-Risiken**
  - Scraper-404 kann aus URL-Normalisierung, falschem Endpoint-Pfad, Secret/Auth oder Proxy-Rewrite stammen.

---

## B) Priorisierte To-Do Liste (inkl. T-Shirt-Größe)

1. **P0 / S**: Bugfix „Database error saving new user“ inkl. klare UI-Fehlertexte + Test.
2. **P0 / M**: Scraper-404 robust behandeln (URL-Building, Error-Mapping, Logging, Mock-Test).
3. **P0 / M**: Test-Email vollständig entfernen (UI + Endpoints) und Admin-Waitlist-Tab vorbereiten.
4. **P1 / M**: Watchlist-Erweiterung (S-Nr. required, Shipper optional) inkl. Validation/UI.
5. **P1 / M**: ETA-Archivierungslogik (archived statt delete) in Queries + UI-Filter + Job-Strategie.
6. **P1 / L**: Bulk Delete (4 Bereiche) admin-only, Confirm/Audit/soft-delete.
7. **P2 / M**: Excel-Dateiname mit Datumsersetzung (`dd.mm.yyyy`) beim Speichern/Download.
8. **P2 / L**: Excel-Download-Formatierungs-Hardening inkl. Regressions-Testmatrix.
9. **P2 / S**: Dokumentation (Runbook, ENV-Keys, Rollback-Checkliste) aktualisieren.

---

## C) Schritt-für-Schritt Implementierungsplan (kleine PRs, Flags, Rollback)

### PR-1: Stabilisierung User-Create + Fehleroberfläche
- Additive Validierung (z. B. Duplicate-Email, missing config, Auth-API Fehlercodes).
- Strukturierte Fehler-Mappings (409/422/500) statt generischer 500.
- UI zeigt freundliche Meldung + technische Korrelation-ID in Logs.
- **Rollback:** API-Handler revertierbar, kein Schemachange.

### PR-2: Scraper-404 Hardening
- URL Join Helper (`joinUrl(base, path)`) ohne Double-/Missing-Slash.
- Fehlerklassifizierung: 404 → „Endpoint nicht gefunden/konfiguriert“, 401/403 → Secret/Auth.
- Log-Felder: `baseUrl`, `endpoint`, `requestId`, status.
- Optional Retry nur für 429/5xx.
- **Rollback:** Feature-Flag `SCRAPER_STRICT_ERROR_MAPPING=false`.

### PR-3: Waitlist Tab + Invite Links + Test-Email Removal
- Admin-Tab „Waitlist“ mit Name/Email/Datum/Status.
- Invite Token (hash + expiry) + Versand + Statusupdate.
- `test-email` UI-Button entfernen; API-Route deprecaten und danach löschen.
- **Rollback:** `FEATURE_WAITLIST_TAB=false`.

### PR-4: Watchlist Input-Regeln (S-Nr. Pflicht, Shipper optional)
- Request Schema erweitern: `shipmentReference` required, `shipper` optional.
- UI Form + Inline Validierung + Filter/Suche erweitern.
- Migration additiv (`shipper` column nullable).
- **Rollback:** `FEATURE_WATCHLIST_SHIPPER=false`.

### PR-5: ETA erreicht => archivieren
- Additive Felder: `archived_at`, optional `status`.
- Read-Queries standardmäßig `archived_at IS NULL`.
- Hintergrundjob/cron markiert Datensätze bei `now >= eta` (TZ-aware).
- UI: Archiv-Filter / Completed-View.
- **Rollback:** Flag `FEATURE_ARCHIVE_ON_ETA=false` + Query fallback.

### PR-6: Bulk Delete admin-only
- Einheitlicher Bulk-Endpoint pro Ressource mit serverseitigem Admin-Check.
- Soft-delete bevorzugt (Auditfähigkeit), Hard-delete nur begründet.
- UI mit Select-all, Counter, Confirm.
- **Rollback:** `FEATURE_BULK_DELETE=false`.

### PR-7: Excel-Namens- und Format-Fixes
- Filename-Normalisierung mit Datumsersetzung.
- Download verwendet normalisierten Namen statt JobID-Dateiname.
- Regressionssuite für Styles/Formats/Frozen Panes/Leading Zeros.
- **Rollback:** `FEATURE_EXCEL_FILENAME_DATE=false`.

---

## D) Code-/Pseudo-Code-Beispiele pro Kernpunkt

### 1) User-Fix (DB error saving new user)
```ts
try {
  const link = await admin.auth.admin.generateLink({ type: 'invite', email });
  if (link.error) return fail(mapSupabaseAuthError(link.error));

  const roleRes = await admin.from('user_roles').upsert({ user_id: link.data.user.id, role });
  if (roleRes.error) return fail(mapDbError(roleRes.error));

  return ok();
} catch (e) {
  log.error({ e, requestId }, 'create-user failed');
  return fail({ status: 500, message: 'Benutzer konnte nicht angelegt werden.' });
}
```

### 2) Waitlist + Invites
```ts
const token = randomBytes(32).toString('hex');
const tokenHash = sha256(token);
await db.insert('waitlist_invites', { email, token_hash: tokenHash, expires_at });
await mail.send({ to: email, template: 'invite', link: `${APP_URL}/invite?token=${token}` });
await db.update('waitlist', { status: 'invited', invited_at: now });
```

### 3) Filename Date Replace
```ts
// Rottenburg Container Liste 20.01.2026 -> Rottenburg Container Liste 27.02.2026
const DATE_RE = /\b\d{2}\.\d{2}\.\d{4}\b/;
function normalizeFilename(name: string, today: string) {
  return DATE_RE.test(name) ? name.replace(DATE_RE, today) : `${stripExt(name)} ${today}.xlsx`;
}
```

### 4) Excel Export Styles erhalten
```ts
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(inputBuffer); // preserve
// nur cell.value anpassen, style/numFmt/fill/font/width/freeze/filter unangetastet
sheet.getCell(row, etaCol).value = newEtaDate;
const out = await wb.xlsx.writeBuffer();
```

### 5) Bulk Delete Admin-only
```ts
if (!isAdmin(session.user.id)) return forbidden();
const ids = z.array(z.string().uuid()).parse(body.ids);
await db.from(table).update({ archived_at: now, archived_by: session.user.id }).in('id', ids);
await audit.log('bulk_delete', { table, count: ids.length, actor: session.user.id });
```

### 6) ETA Archivierung
```ts
await db.from('vessel_watches')
  .update({ archived_at: now, status: 'ARCHIVED' })
  .is('archived_at', null)
  .lte('last_known_eta', nowIso);

// Query default:
query.is('archived_at', null);
```

### 7) Watchlist Felder
```ts
const schema = z.object({
  vesselName: z.string().min(1),
  shipmentReference: z.string().regex(/^S\d{8}$/), // required
  shipper: z.string().max(120).optional().nullable(),
});
```

### 8) Scraper 404 Handling
```ts
const endpoint = joinUrl(scraperBaseUrl, '/webhook/run-scraper');
const res = await fetch(endpoint, { method: 'POST', headers });
if (res.status === 404) {
  return fail(502, 'Scraper endpoint nicht gefunden. Bitte URL/Version prüfen.');
}
if (res.status >= 500 || res.status === 429) retryWithBackoff();
```

---

## E) Testplan (Unit / Integration / E2E + Edge Cases)

### Unit
- Error mapper (Supabase/Auth/DB Codes → UI-Message).
- Filename-Datumsersetzung (`mit Datum`, `ohne Datum`, `mehrere Datumsfragmente`).
- URL Join & Scraper Error Mapping (404/401/403/429/5xx).
- Role-Guard für bulk delete Endpoints.

### Integration
- Admin create user: success, duplicate email, role upsert fail.
- Waitlist invite flow inkl. expiry + status tracking.
- ETA archive job markiert korrekt, aktive Views blenden aus.
- Excel roundtrip: Styles/format/freeze/filter bleiben erhalten.

### E2E
- Admin sieht Waitlist-Tab, kann Invite senden.
- Nicht-Admin sieht keine Bulk-Delete UI und bekommt 403 serverseitig.
- Watchlist Add ohne S-Nr. zeigt Validierungsfehler.
- Scraper manuell triggern: 404 zeigt klare Fehlermeldung statt generic crash.

### Edge Cases
- ETA exakt jetzt (`now == eta`) und TZ-Wechsel (DST).
- Mehrfach-Upload mit gleichem Dateinamen am selben Tag.
- Führende Nullen in Excel (z. B. Referenzen) bleiben Strings.
- Große Bulk-Operationen (Limitierung, chunking, timeout).

---

## Offene Constraints zur finalen Umsetzung
Vor Umsetzung bestätigen/ergänzen:
1. Exakter Auth-/Rollencheck (Quelle der Admin-Wahrheit: `user_roles` bleibt gesetzt?).
2. Gewünschte Archiv-UI (eigener Tab vs. Filter in bestehenden Views).
3. Verbindliche Regel bei Dateinamen **ohne Datum** (anhängen vs. unverändert).
4. Verwendeter Email-Provider in allen Umgebungen (Resend only?).
5. Scraper Base-URL/Versionierungs-Konzept (statisch vs. env-basiert je Stage).
