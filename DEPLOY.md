# Shipscoper — Vollständiger Deploy-Guide

> Stack: **Next.js 14** (Vercel) + **Python Flask Scraper** (Railway) + **Supabase** (PostgreSQL + Auth)

---

## Inhaltsverzeichnis

1. [Voraussetzungen](#1-voraussetzungen)
2. [Supabase einrichten](#2-supabase-einrichten)
3. [Railway Deploy (Python Scraper)](#3-railway-deploy-python-scraper)
4. [Vercel Deploy (Next.js Frontend)](#4-vercel-deploy-nextjs-frontend)
5. [Domain auf Vercel zeigen lassen](#5-domain-auf-vercel-zeigen-lassen)
6. [Cloudflare Setup](#6-cloudflare-setup)
7. [Security-Checkliste](#7-security-checkliste)
8. [Umgebungsvariablen Übersicht](#8-umgebungsvariablen-übersicht)
9. [Nach dem Deploy testen](#9-nach-dem-deploy-testen)

---

## 1. Voraussetzungen

- [ ] GitHub-Konto mit dem Repository
- [ ] [Vercel-Konto](https://vercel.com) (kostenloser Hobby-Plan reicht für Start)
- [ ] [Railway-Konto](https://railway.app) (Starter-Plan, ~$5/Monat)
- [ ] [Supabase-Konto](https://supabase.com) (kostenloser Free-Plan reicht)
- [ ] [Resend-Konto](https://resend.com) für E-Mail-Versand
- [ ] Domain (z.B. bei Cloudflare, Namecheap, GoDaddy)
- [ ] [Cloudflare-Konto](https://cloudflare.com) (kostenlos)

---

## 2. Supabase einrichten

### 2.1 Neues Projekt anlegen

1. **dashboard.supabase.com** → "New Project"
2. Organisation wählen, Name: `shipscoper`, Region: `eu-central-1` (Frankfurt)
3. Starkes Datenbankpasswort generieren und speichern

### 2.2 Datenbank-Migrationen ausführen

Im Supabase-Dashboard → **SQL Editor** → in **dieser Reihenfolge** ausführen:

```sql
-- 1. Kern-Schema
-- Inhalt von: web/supabase_schema.sql

-- 2. Auth-Schema & RLS-Policies
-- Inhalt von: web/supabase_auth_schema.sql

-- 3. Watchlist & Notifications
-- Inhalt von: web/supabase_watchlist_schema.sql

-- 4. Container-Tracking
-- Inhalt von: migrations/20260221_container_tracking.sql

-- 5. Container-SNR-Pairs
-- Inhalt von: migrations/20260223_container_snr_pairs.sql
```

> **Wichtig:** Alle Migrationen sind idempotent (`IF NOT EXISTS`) — bei Fehler einfach nochmal ausführen.

### 2.3 API-Keys sammeln

**Supabase Dashboard → Settings → API:**

| Variable | Wo zu finden |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (z.B. `https://xyz.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` / `public` Key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` Key (**geheim halten!**) |

### 2.4 Auth konfigurieren

**Supabase Dashboard → Authentication → URL Configuration:**

```
Site URL:          https://deine-domain.de
Redirect URLs:     https://deine-domain.de/**
                   https://deine-vercel-app.vercel.app/**
```

**Email Templates** (optional): Eigene Einladungs-E-Mails unter Authentication → Email Templates anpassen.

### 2.5 Ersten Admin-User anlegen

```sql
-- Im SQL Editor ausführen, nachdem der User sich registriert hat:
INSERT INTO user_roles (user_id, role)
VALUES ('<user-uuid-aus-auth.users>', 'admin')
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
```

---

## 3. Railway Deploy (Python Scraper)

### 3.1 Neues Railway-Projekt

1. [railway.app](https://railway.app) → "New Project" → "Deploy from GitHub repo"
2. Repository auswählen → **Root Directory: `/`** (nicht `web/`)
3. Railway erkennt `nixpacks.toml` automatisch

### 3.2 Umgebungsvariablen in Railway setzen

**Railway Dashboard → dein Service → Variables:**

```env
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
WEBHOOK_SECRET=<zufälliger-langer-string-min-32-zeichen>

# E-Mail (Resend empfohlen)
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=Shipscoper <hello@deine-domain.de>

# Worker-Einstellungen
MAX_CONCURRENCY=2
HEADLESS=true
SKIP_DELIVERED=false
```

> **WEBHOOK_SECRET generieren:**
> ```bash
> openssl rand -hex 32
> ```

### 3.3 Custom Domain in Railway (optional)

**Railway → Settings → Networking → Custom Domain:** Deine Subdomain eintragen (z.B. `api.shipscoper.de`).

### 3.4 Deployment überprüfen

Nach dem Deploy sollte `/health` erreichbar sein:

```bash
curl https://deine-app.up.railway.app/health
# Erwartet: {"ok": true, "timestamp": "..."}
```

> **Wichtig:** `/status` ist jetzt durch `X-Webhook-Secret` geschützt — kein öffentlicher Zugriff mehr.

---

## 4. Vercel Deploy (Next.js Frontend)

### 4.1 Neues Vercel-Projekt

1. [vercel.com](https://vercel.com) → "New Project" → GitHub-Repo importieren
2. **Root Directory: `web`** (wichtig!)
3. Framework: **Next.js** (wird automatisch erkannt)
4. Build Command: `npm run build` (Standard)

### 4.2 Umgebungsvariablen in Vercel

**Vercel Dashboard → dein Projekt → Settings → Environment Variables:**

Alle Variablen für **Production**, **Preview** und **Development** setzen:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Railway Scraper
RAILWAY_SCRAPER_URL=https://deine-app.up.railway.app

# Shared Secret (muss mit Railway übereinstimmen!)
WEBHOOK_SECRET=<gleicher-string-wie-in-railway>

# Vercel Cron-Schutz
CRON_SECRET=<weiterer-zufälliger-string>

# E-Mail
RESEND_API_KEY=re_...
EMAIL_FROM=Shipscoper <hello@deine-domain.de>

# Optionale Einstellungen
MATCH_THRESHOLD=0.85
MAX_FILE_MB=10
TMP_TTL_MIN=30
```

> **CRON_SECRET generieren:**
> ```bash
> openssl rand -hex 32
> ```

### 4.3 Cron Jobs verifizieren

Die `web/vercel.json` konfiguriert automatisch:

| Cron | Schedule | Zweck |
|------|----------|-------|
| `/api/cron/trigger-scraper` | `0 6 * * *` | Täglich 06:00 UTC: Schiffsplan scrapen |
| `/api/cron/check-containers` | `0 */2 * * *` | Alle 2h: Container-Status prüfen |

**Vercel Dashboard → dein Projekt → Cron Jobs** — dort sind beide sichtbar.

### 4.4 Erstes Deployment

```bash
# Lokal testen vor dem Push:
cd web
npm run build

# Dann Push → Vercel deployed automatisch
git push origin main
```

---

## 5. Domain auf Vercel zeigen lassen

### 5.1 Domain in Vercel hinzufügen

1. **Vercel Dashboard → Projekt → Settings → Domains**
2. Klick auf "Add Domain"
3. Domain eingeben: `shipscoper.de` (und `www.shipscoper.de`)
4. Vercel zeigt dir DNS-Records an

### 5.2 DNS bei deinem Registrar / Cloudflare eintragen

**Für Root-Domain (`shipscoper.de`)** — A-Record oder ALIAS:

| Typ | Name | Wert |
|-----|------|------|
| `A` | `@` | `76.76.21.21` (Vercel IP) |

Oder wenn Cloudflare als DNS-Provider: CNAME flattening funktioniert:

| Typ | Name | Wert |
|-----|------|------|
| `CNAME` | `@` | `cname.vercel-dns.com` |

**Für `www`-Subdomain:**

| Typ | Name | Wert |
|-----|------|------|
| `CNAME` | `www` | `cname.vercel-dns.com` |

### 5.3 SSL-Zertifikat

Vercel stellt automatisch ein **Let's Encrypt**-Zertifikat aus sobald DNS propagiert ist (~5 Minuten bis 48h).

> **Hinweis:** Wenn du Cloudflare als Proxy nutzt (orangene Wolke), stelle den SSL/TLS-Modus auf **"Full (strict)"** ein.

---

## 6. Cloudflare Setup

### 6.1 Domain zu Cloudflare hinzufügen

1. **Cloudflare Dashboard** → "Add a Site" → Domain eingeben
2. Free-Plan auswählen
3. Cloudflare scannt bestehende DNS-Records
4. **Nameserver** bei deinem Domain-Registrar auf die Cloudflare-Nameserver umstellen:
   - `ada.ns.cloudflare.com`
   - `ben.ns.cloudflare.com`
   (Namen variieren pro Account)
5. Warten bis DNS propagiert (~1-48h)

### 6.2 DNS-Records in Cloudflare

Nach dem Nameserver-Transfer alle Records eintragen/prüfen:

| Typ | Name | Wert | Proxy |
|-----|------|------|-------|
| `A` | `@` (shipscoper.de) | `76.76.21.21` | ☁️ Ja (orange) |
| `CNAME` | `www` | `cname.vercel-dns.com` | ☁️ Ja (orange) |
| `CNAME` | `api` (optional) | `deine-app.up.railway.app` | ☁️ Ja (orange) |

> **Proxy aktivieren** (orangene Wolke) = Traffic läuft durch Cloudflare → DDoS-Schutz, Caching, WAF aktiv.

### 6.3 SSL/TLS konfigurieren

**Cloudflare → SSL/TLS → Overview:**

```
Encryption mode: Full (strict)
```

> **Nie "Flexible" verwenden** — das würde HTTP zwischen Cloudflare und Vercel erzwingen.

**SSL/TLS → Edge Certificates:**
- [ ] "Always Use HTTPS" → **Ein**
- [ ] "Automatic HTTPS Rewrites" → **Ein**
- [ ] "Minimum TLS Version" → **TLS 1.2**
- [ ] "TLS 1.3" → **Ein**
- [ ] "HSTS" → `max-age=31536000; includeSubDomains; preload` (nach Tests aktivieren)

### 6.4 Cloudflare WAF (Web Application Firewall)

**Cloudflare → Security → WAF:**

**Empfohlene Managed Rules (Free Plan):**
- "Cloudflare Managed Ruleset" → **Ein** (blockiert SQLi, XSS, bekannte Exploits)
- "Cloudflare OWASP Core Ruleset" → **Ein** (OWASP Top 10 Schutz)

**Custom Rules erstellen (Free Plan):**

```
# Rate Limit: API-Endpunkte schützen
Rule: "Rate limit API"
When: (http.request.uri.path contains "/api/") AND (rate > 100 per 1 minute per IP)
Action: Block

# Bot-Schutz für Login
Rule: "Protect Login"
When: (http.request.uri.path eq "/login") AND (rate > 10 per 1 minute per IP)
Action: Challenge (CAPTCHA)
```

### 6.5 Cloudflare Speed / Performance

**Cloudflare → Speed → Optimization:**
- [ ] "Auto Minify" → JS, CSS, HTML **Ein**
- [ ] "Brotli" → **Ein**
- [ ] "Rocket Loader" → **Aus** (kann Next.js stören!)
- [ ] "Early Hints" → **Ein**

**Cloudflare → Caching → Configuration:**
- Browser Cache TTL: **4 Stunden**
- Caching Level: **Standard**

**Page Rules für statische Assets** (oder Cache Rules):

```
URL: shipscoper.de/_next/static/*
Cache Level: Cache Everything
Edge Cache TTL: 1 Month
Browser TTL: 1 Day
```

### 6.6 Cloudflare Security Level

**Security → Settings:**
- Security Level: **Medium** (oder High bei Angriffen)
- Challenge Passage: **30 Minuten**
- Browser Integrity Check: **Ein**
- Hotlink Protection: **Ein** (verhindert Bilddiebstahl)

### 6.7 Cloudflare Email-Schutz (optional)

**Email → Email Routing:** Weiterleitung von `hello@shipscoper.de` zu deiner privaten E-Mail.

**Email → Email Obfuscation → Ein** (schützt E-Mail-Adressen auf der Website vor Spam-Bots).

---

## 7. Security-Checkliste

### 7.1 Kritische Punkte (vor Go-Live pflichtend)

- [ ] **Keine Secrets im Code** — alle Keys nur als Umgebungsvariablen
- [ ] **`SUPABASE_SERVICE_ROLE_KEY`** ist niemals im Client-Code oder als `NEXT_PUBLIC_*` gesetzt
- [ ] **`WEBHOOK_SECRET`** ist identisch in Vercel und Railway (min. 32 Zeichen Zufallsstring)
- [ ] **`CRON_SECRET`** ist gesetzt und stark (min. 32 Zeichen)
- [ ] **Supabase RLS** ist auf allen Tabellen aktiv (überprüfen: Authentication → Policies)
- [ ] **Supabase Auth → Email Confirmations** aktiviert (verhindert Spam-Accounts)
- [ ] **SSL "Full (strict)"** in Cloudflare — niemals "Flexible"
- [ ] **HSTS** im Code aktiviert (✅ bereits in `middleware.ts`)

### 7.2 Supabase RLS überprüfen

Im SQL Editor prüfen ob RLS aktiv ist:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
-- rowsecurity muss für alle Tabellen "true" sein
```

Policies prüfen:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
```

### 7.3 Was dieser Deploy schützt

| Angriff | Schutz | Wo |
|---------|--------|----|
| SQL Injection | Supabase Prepared Statements + Zod-Validierung | `security.ts` |
| XSS | CSP Header ohne `unsafe-eval` + Input-Sanitization | `middleware.ts` |
| CSRF | Same-Origin + Supabase-Session Cookie (HttpOnly) | Supabase Auth |
| Path Traversal | UUID-Regex-Validierung für Download-URLs und Job-IDs | `download/route.ts`, `test-email-status` |
| SSRF | Feste `RAILWAY_SCRAPER_URL` aus Env + UUID-Validierung | `test-email-status` |
| DDoS | Cloudflare WAF + Rate Limiting (100 req/min) | Cloudflare + `middleware.ts` |
| Brute Force | Rate Limiting auf `/login` via Cloudflare Rule | Cloudflare |
| Credential Leak | Service Role Key nur server-side, nie im Client | Vercel Env |
| Unauthorized Scraper Trigger | `WEBHOOK_SECRET` Header-Prüfung | `scraper_api.py` |
| Unauthorized Cron Trigger | Bearer `CRON_SECRET` | `cron/trigger-scraper` |
| Clickjacking | `X-Frame-Options: DENY` | `middleware.ts` |
| MITM Downgrade | HSTS + Cloudflare Always-HTTPS | `middleware.ts` + Cloudflare |
| Data Leakage | RLS-Policies: User sieht nur eigene Daten | Supabase |
| Email Injection | HTML-Escaping von User-Content in E-Mails | `auto-dispo/route.ts` |
| Internal State Leak | `/status` Endpoint jetzt auth-geschützt | `scraper_api.py` |
| File Upload Abuse | MIME-Type-Prüfung, 10 MB Limit, 30-min TTL | `security.ts` |
| Enumeration | UUID-basierte Job-IDs (keine inkrementellen IDs) | `update-excel/route.ts` |

### 7.4 Bekannte verbleibende Einschränkungen

> Diese Punkte sind bewusste Kompromisse oder erfordern kostenpflichtige Infrastruktur:

1. **In-Memory Rate Limiting** — Wird bei mehreren Vercel-Instanzen umgangen. Für Production mit hohem Traffic: Redis (Upstash) verwenden.
2. **`unsafe-inline` in CSP** — Nötig für Tailwind CSS / Radix UI inline styles in Next.js. Vollständige Nonce-basierte CSP würde Custom Server benötigen.
3. **Excel-Dateien unverschlüsselt in `/tmp`** — Vercel isoliert `/tmp` pro Instanz. Bei besonders sensiblen Daten: S3 mit SSE-S3 verwenden.
4. **Kein Redis für Sessions** — Supabase-Sessions laufen über Cookies; kein serverseitiges Session-Invalidierungs-Register.

---

## 8. Umgebungsvariablen Übersicht

### Vercel (Next.js) — `web/.env.local`

```env
# === Supabase ===
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# === Railway ===
RAILWAY_SCRAPER_URL=https://deine-app.up.railway.app

# === Secrets ===
WEBHOOK_SECRET=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 32>

# === E-Mail ===
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Shipscoper <hello@deine-domain.de>

# === App-Einstellungen ===
MATCH_THRESHOLD=0.85
MAX_FILE_MB=10
TMP_TTL_MIN=30
```

### Railway (Python Scraper)

```env
# === Supabase ===
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# === Secrets (identisch mit Vercel!) ===
WEBHOOK_SECRET=<gleicher-string-wie-in-vercel>

# === E-Mail ===
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Shipscoper <hello@deine-domain.de>

# === Worker ===
MAX_CONCURRENCY=2
HEADLESS=true
SKIP_DELIVERED=false
```

---

## 9. Nach dem Deploy testen

### 9.1 Health Checks

```bash
# Railway Scraper
curl https://deine-app.up.railway.app/health
# Erwartet: {"ok": true, "timestamp": "2026-..."}

# Vercel API
curl https://deine-domain.de/api/health
# Erwartet: {"ok": true}

# Status (muss jetzt 401 zurückgeben ohne Secret)
curl https://deine-app.up.railway.app/status
# Erwartet: {"error": "Unauthorized"} mit HTTP 401
```

### 9.2 Security Headers überprüfen

```bash
curl -I https://deine-domain.de
# Prüfen ob folgende Headers vorhanden:
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# X-Frame-Options: DENY
# X-Content-Type-Options: nosniff
# Content-Security-Policy: ...
```

Oder online: [securityheaders.com](https://securityheaders.com) → URL eingeben.

### 9.3 SSL-Zertifikat prüfen

```bash
curl -v https://deine-domain.de 2>&1 | grep -E "SSL|TLS|certificate"
```

Oder: [ssllabs.com/ssltest](https://www.ssllabs.com/ssltest/) → sollte **A** oder **A+** ergeben.

### 9.4 Cron Jobs testen

```bash
# Scraper-Cron manuell triggern (erfordert CRON_SECRET)
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://deine-domain.de/api/cron/trigger-scraper

# Container-Check manuell triggern
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://deine-domain.de/api/cron/check-containers
```

### 9.5 Vollständiger Smoke-Test

1. [ ] Login-Seite erreichbar: `https://deine-domain.de/login`
2. [ ] Login mit Test-User funktioniert
3. [ ] `/eta-updater` ist nach Login erreichbar
4. [ ] Excel-Upload funktioniert (Test-Datei hochladen)
5. [ ] Admin-Bereich erreichbar für Admin-User: `/admin`
6. [ ] Railway Health-Check grün
7. [ ] Vercel Deployment-Status grün
8. [ ] Cron Jobs in Vercel-Dashboard sichtbar

---

## Schnellübersicht: Deploy-Reihenfolge

```
1. Supabase Projekt erstellen
   └── SQL-Migrationen ausführen (in Reihenfolge)
   └── API-Keys kopieren

2. Railway deployen
   └── Umgebungsvariablen setzen
   └── /health prüfen

3. Vercel deployen
   └── Root Directory: "web" setzen
   └── Alle Env-Variablen eintragen
   └── Build prüfen

4. Domain konfigurieren
   └── DNS-Records eintragen (A/CNAME für Vercel)
   └── Warten auf Propagation

5. Cloudflare einrichten
   └── Site hinzufügen + Nameserver umstellen
   └── SSL: Full (strict)
   └── WAF Managed Rules aktivieren
   └── Always Use HTTPS + HSTS

6. Smoke-Tests durchführen
   └── Health Checks
   └── Security Headers
   └── SSL-Rating
   └── Funktionstest
```

---

*Erstellt für Shipscoper — Stand: Februar 2026*
