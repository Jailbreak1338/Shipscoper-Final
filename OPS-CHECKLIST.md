# OPS Checklist (External Settings)

Use this checklist for settings that cannot be fully enforced by repository code.

## 1. Vercel Cron (P0-1)

1. Open Vercel Dashboard -> Project -> `Settings` -> `Cron Jobs`.
2. Verify the route exists: `/api/cron/trigger-scraper`.
3. Verify schedule is exactly: `0 6,12,18 * * *` (UTC).
4. Open Vercel Dashboard -> Project -> `Settings` -> `Environment Variables`.
5. Verify `CRON_SECRET`, `RAILWAY_SCRAPER_URL`, and `WEBHOOK_SECRET` are set.
6. Redeploy the latest commit after any env or cron change.
7. Validate manually:
   - `GET /api/health` returns 200.
   - Trigger cron endpoint with `Authorization: Bearer <CRON_SECRET>` and check a successful webhook trigger.

## 2. Railway Webhook Consistency

1. Open Railway Dashboard -> Service -> `Variables`.
2. Verify `WEBHOOK_SECRET` matches Vercel.
3. Verify `SUPABASE_SERVICE_ROLE_KEY` and URL variables are set.
4. Check `/health` and `/status` endpoints on the deployed service.

## 3. Supabase SQL Order

1. Open Supabase -> SQL Editor.
2. Run in order:
   - `web/supabase_schema.sql`
   - `web/supabase_auth_schema.sql`
   - `web/supabase_watchlist_schema.sql`
3. Confirm tables/views exist and RLS policies are active where expected.
