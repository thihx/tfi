# Production Deploy 2026-03-21

## Final Release

- Deployed image tag: `vocs2026.azurecr.io/tfi:prod-20260321-1441-ui`
- Azure Container App: `tfi-app`
- Active revision: `tfi-app--0000034`
- FQDN: `https://tfi-app.ashywave-e4748b53.koreacentral.azurecontainerapps.io`
- Production DB migrations: applied through `011_settlement_audit.sql`

## Env Synced

The production Container App now has the new runtime env keys required by the recent hardening work:

- `GEMINI_TIMEOUT_MS`
- `GEMINI_SETTLE_MODEL` (auto-settle AI fallback; default Flash in app config)
- `GEMINI_STRATEGIC_GROUNDED_MODEL`
- `GEMINI_STRATEGIC_STRUCTURED_MODEL`
- `GEMINI_STRATEGIC_GROUNDED_MAX_OUTPUT_TOKENS`
- `GEMINI_STRATEGIC_STRUCTURED_MAX_OUTPUT_TOKENS`
- `GEMINI_STRATEGIC_GROUNDED_THINKING_BUDGET`
- `GEMINI_STRATEGIC_STRUCTURED_THINKING_BUDGET`
- `LIVE_SCORE_API_KEY`
- `LIVE_SCORE_API_SECRET`
- `LIVE_SCORE_BENCHMARK_ENABLED`
- `LIVE_SCORE_STATS_FALLBACK_ENABLED`
- `PROVIDER_SAMPLING_ENABLED`

## Deploy Incident Fixed

The first rollout on `prod-20260321-1343-1cac023` failed because server runtime imported `strategic-source-policy.base.json` as ESM JSON without the required import attribute in the container runtime.

Fix shipped:

- moved base policy to TypeScript source
- removed runtime JSON import
- reran `server typecheck`, `server build`, and `server test`
- redeployed successfully to revision `0000033`, then rolled frontend language patch to `0000034`

## HTTP Smoke

Verified on the final healthy revision:

- `GET /api/health` -> `200`
- `GET /` -> `200`
- authenticated `GET /api/me/watch-subscriptions` -> `200`
- authenticated `POST /api/proxy/ai/analyze` with real Gemini -> `200`
- authenticated `POST /api/proxy/football/odds` -> `200`
- authenticated `GET /api/settings` -> `200`
- authenticated `PUT /api/settings` persisted `UI_LANGUAGE=vi`

## Production Validation Summary

Using production env + production DB after deploy:

- live matches sampled: `2`
- upcoming enrichment matches sampled: `3`
- `Ask AI` route returned `200`
- pipeline auto/system/manual shadow runs completed without runtime errors
- batch run completed with `processed=2`, `errors=0`
- provider sampling is flowing in production for both `api-football` and `live-score-api`

Recent provider stats sample counts observed in production:

- `api-football / server-pipeline`: `99`
- `live-score-api / server-pipeline`: `29`

## Production-Complete Patch Included

Shipped in final revision `0000034`:

- UI setting `UI_LANGUAGE`
- strategic context display now reads EN/VI data according to user setting
- fallback to legacy fields remains intact

Current DB settings row confirms:

- `UI_LANGUAGE = vi`

## Assessment

Current status: `READY FOR PRODUCTION`

Reasoning:

- production container is running the latest healthy revision
- DB schema is current
- core live-analysis, odds, auth, settings, and scheduler startup paths are healthy
- provider benchmark/fallback instrumentation is live
- bilingual strategic-context display path is now wired end-to-end

Residual non-blocking risk:

- strategic enrichment quality is still weaker than the core prompt path and should continue to be treated as a soft prior, not a primary signal
