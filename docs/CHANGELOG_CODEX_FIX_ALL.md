# Changelog - codex-fix-all

Date: 2026-02-19
Branch: `codex-fix-all`

## 1. Fixes by topic

### B) RUNBOOK + source of truth
- Added `docs/RUNBOOK.md` with:
  - local/prod run paths
  - env variable catalog (web/python)
  - final cron schedule
  - auth/RLS operating mode
  - troubleshooting
- Added root `.env.example`.
- Expanded `web/.env.example` with scraper/cron integration variables.

### P0-1 Cron consistency
- Updated `web/vercel.json` schedule to `0 6,12,18 * * *`.
- Added `OPS-CHECKLIST.md` with Vercel/Railway/Supabase external verification steps.

### P0-2 ENV consistency (Supabase URL)
- Updated Python Supabase client init to support:
  - primary: `SUPABASE_URL`
  - fallback: `NEXT_PUBLIC_SUPABASE_URL`
- Updated docs to reflect accepted env names.

### P0-3 Auth/RLS mode
- Removed contradictory RLS disable directives from `web/supabase_schema.sql`.
- Documented SQL execution order and RLS ownership in:
  - `web/README.md`
  - `docs/DEPLOYMENT.md`
  - `docs/RUNBOOK.md`

### P0-4 Windows scheduler BAT paths
- Reworked `deployment/run_pipeline.bat` and `deployment/run_email.bat`:
  - no hard-coded absolute paths
  - use `%~dp0` relative pathing
  - venv existence check
  - proper exit code handling for Task Scheduler

### P0-5 TMP_TTL implementation
- Added `web/src/lib/tmpFiles.ts`.
- Implemented stale file cleanup before write in `web/src/app/api/update-excel/route.ts`.
- Added TTL expiration check and cleanup in `web/src/app/api/download/[jobId]/route.ts`.

### P1-1 Normalization consistency
- Added shared Python normalizer: `utils/normalization.py`.
- Reused in:
  - `scraper/supabase_writer.py`
  - `processor/excel_processor.py`
- Added normalization test: `tests/test_normalization.py` (5 cases).

### P1-2 HHLA retry robustness
- Added retry loop with backoff and progressive timeout in `scraper/hhla_scraper.py`.

### P1-3 Mail workflow semantics
- Clarified workflow semantics in `orchestrator/email_handler.py`:
  - incoming attachment is archived trigger artifact
  - reply contains fresh live-scrape report
- Updated docs (`README.md`, `docs/RUNBOOK.md`) to match implemented behavior.

### P2-1 CI
- Added GitHub Actions workflow: `.github/workflows/ci.yml`.
- Includes Python checks + web build.

### P2-2 Encoding policy
- Added `.editorconfig`.
- Added `.gitattributes`.

### D) Quality assurance
- Added unified local smoke test script: `scripts/smoke_test.ps1`.
- Updated docs with exact smoke-test command.

## 2. Files changed (high level)

- Root/docs/config:
  - `.env.example`
  - `.editorconfig`
  - `.gitattributes`
  - `OPS-CHECKLIST.md`
  - `README.md`
  - `docs/RUNBOOK.md`
  - `docs/DEPLOYMENT.md`
  - `docs/CHANGELOG_CODEX_FIX_ALL.md`
- Python:
  - `scraper/supabase_writer.py`
  - `scraper/hhla_scraper.py`
  - `orchestrator/email_handler.py`
  - `processor/excel_processor.py`
  - `utils/normalization.py`
  - `tests/test_normalization.py`
  - `tests/test_processor.py`
  - `deployment/run_pipeline.bat`
  - `deployment/run_email.bat`
- Web:
  - `web/vercel.json`
  - `web/.env.example`
  - `web/src/lib/tmpFiles.ts`
  - `web/src/app/api/update-excel/route.ts`
  - `web/src/app/api/download/[jobId]/route.ts`
  - `web/supabase_schema.sql`
  - `web/README.md`
- CI/automation:
  - `.github/workflows/ci.yml`
  - `scripts/smoke_test.ps1`

## 3. Tests executed and results

Executed locally:

1. `python -m py_compile scraper/supabase_writer.py`
   - Result: pass
2. `npm --prefix web run build`
   - Result: pass
3. `python -m tests.test_normalization`
   - Result: pass (`Normalization test passed (5 cases).`)
4. `python -m py_compile scraper/hhla_scraper.py`
   - Result: pass
5. `python -m py_compile main.py scraper_api.py orchestrator/pipeline.py scraper/hhla_scraper.py`
   - Result: pass
6. `powershell -ExecutionPolicy Bypass -File scripts/smoke_test.ps1`
   - Result: pass (all 4 stages completed)

Notes:
- First `npm --prefix web run build` failed before dependencies were installed (`next` not found).
- Resolved by running `npm --prefix web install`, then build passed.
