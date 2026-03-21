# Production Readiness Audit

Date: 2026-03-21

## Scope

This pass covered real-data validation on the test DB with real Football API calls, real Gemini calls, real Telegram notification delivery, save/settle paths, fallback paths, and provider benchmarking.

Primary evidence files:
- `docs/production-readiness-real-2026-03-21.md`
- `docs/re-settle-recent-10-real-2026-03-21.md`
- `docs/live-smoke-real-2026-03-21.md`
- `docs/prompt-replay-real-2026-03-21-rerun.md`
- `docs/prompt-replay-hard-real-2026-03-21-rerun-retries.md`
- `docs/prompt-replay-adversarial-real-2026-03-21-rerun-retries.md`
- `docs/strategic-context-replay-real-2026-03-21-postfix-v2.md`

## Migration / UI Check

- Context upgrade itself does NOT require a new DB migration. The JSONB storage introduced earlier is sufficient for strategic-context v2.
- On the current test DB, there are no pending migrations. Applied tail ends at:
  - `007_audit_logs.sql`
  - `008_match_enrichment.sql`
  - `009_provider_samples.sql`
  - `010_watchlist_logos.sql`
  - `011_settlement_audit.sql`
- For production rollout, DB must be migrated through `011_settlement_audit.sql`.
- UI does NOT need an emergency compatibility update for the new context shape because legacy flat aliases are still persisted.
- However, the bilingual EN/VI context rendering is NOT wired to user language settings yet. That is a product gap, not a runtime blocker.

## Bugs Found And Fixed During This Pass

### 1. Strategic-context grounded path was too weak on real Gemini

Fixes applied:
- dedicated Gemini config for strategic-context grounded/structured steps
- graceful retry when `thinkingConfig` is rejected by the API
- higher grounded token budget to avoid premature truncation
- better parsing of Google grounding redirect URLs so source trust is classified by the actual source domain instead of `vertexaisearch.cloud.google.com`

Result:
- strategic-context path improved from complete failure to partial usable output
- but real enrichment quality is still inconsistent and often low on quantitative coverage

### 2. Shared Gemini timeout was too low for production prompts

Fix applied:
- shared Gemini timeout is now configurable via `GEMINI_TIMEOUT_MS`, default `90000`

Reason:
- live Ask AI / pipeline calls were aborting with `This operation was aborted` on real fixtures under the old 30s timeout

Result:
- reruns on live fixtures stopped aborting and returned valid real LLM responses

### 3. Telegram success was not persisted back to recommendations

Fix applied:
- pipeline now updates `recommendations.notified='yes'` and `notification_channels='telegram'` after successful Telegram delivery

Verified with real run:
- match `1492563`
- saved recommendation id `11016`
- `selection = Under 2 Goals @1.825`
- DB row persisted:
  - `notified = yes`
  - `notification_channels = telegram`
  - `prompt_version = v4-evidence-hardened`

## Real Validation Results

### Enrichment

Actual targeted enrichment job run on 3 selected upcoming watchlist matches:
- `1469684` Brisbane Roar vs Wellington Phoenix
- `1504719` Fagiano Okayama vs V-varen Nagasaki
- `1506920` Daejeon Citizen vs Jeonbuk Motors

Observed:
- job ran successfully on the selected subset
- `2/3` entries were refreshed
- quality was mixed:
  - one entry reached `source_quality=medium`
  - others remained `unknown`
  - quantitative coverage remained thin

Conclusion:
- enrichment flow is operational
- enrichment quality is not consistently strong enough yet

### Ask AI / Manual Force

Verified with real HTTP route:
- `/api/proxy/ai/analyze`
- status `200`
- real text returned for live match `1469683`

Verified with real non-shadow live save:
- match `1492563`
- manual-force analysis
- real LLM recommendation saved and notified

### Auto / System / Manual Modes

Validated on real live slate during the pass:
- `1469683` Auckland vs Macarthur
- `1489154` Guadalupe FC vs Sporting San Jose
- `1492563` Mazatlán vs Cruz Azul

Coverage achieved:
- `auto`
- `system_force`
- `manual_force`
- `shadow`
- `non-shadow`
- `batch auto path`

Observed:
- batch auto path completed without runtime errors
- current live slate was conservative; most auto/system runs correctly returned no-bet
- manual-force path produced actionable recommendations on live data after timeout fix

### Save DB / Push Notification

Real verified success:
- match `1492563`
- recommendation id `11016`
- Telegram notification delivered
- DB row persisted with notification metadata after bug fix

### Fallbacks / Benchmark

Observed in real validation passes:
- `api-football` live odds used successfully
- `live-score-api` benchmark samples persisted alongside `api-football`
- `the-odds-api` was observed in earlier real/provider-sample passes the same day, though not on the latest 3-match live slate

Conclusion:
- benchmark instrumentation is working
- provider sampling is producing usable evidence for future provider decisions

### Settle

Real re-settle pass already completed earlier in this session:
- recent 10 matches
- 18 recommendations checked
- 13 rows refreshed from legacy provenance
- 2 real corrections found

Important corrected examples:
- `#11011`: `loss -> win`
- `#11010`: full settlement corrected to `half_win`

Additional real AI settle verification:
- legacy malformed label row `#916` re-settled via Gemini and persisted with:
  - `settlement_method = ai`
  - `settle_prompt_version = v2-strict-settle`

Current auto-settle smoke during this pass:
- no runtime crash
- no false mass-settlement

## Test Status

Post-fix verification:
- `npm run test --prefix packages/server` -> pass
- `45` test files
- `436` tests pass
- `npm run typecheck --prefix packages/server` -> pass
- `npm run typecheck` -> pass

## Production Readiness Assessment

### Core live-analysis / notification / settle path

Assessment: **Conditionally ready**

Reason:
- core prompt path has strong replay coverage with real LLM
- live pipeline now survives real load better after timeout fix
- save + Telegram + DB persistence has been verified on real live data
- settle path has been hardened and real historical re-settle found valid corrections

### Strategic enrichment as a production-grade feature

Assessment: **Not fully ready**

Reason:
- real grounded search quality is still inconsistent
- source quality often degrades to `unknown` / thin evidence
- quantitative enrichment remains sparse too often

This is currently safe because the pipeline can operate without strong strategic context, but it is NOT strong enough yet to be considered a reliable premium feature.

### Bilingual context UX

Assessment: **Not ready**

Reason:
- EN/VI data is stored
- UI language-driven rendering is not yet wired

## Final Recommendation

If the release goal is:

### 1. Ship the core betting engine

Recommendation: **YES, with caution**

Conditions:
- production DB is migrated through `011_settlement_audit.sql`
- `GEMINI_TIMEOUT_MS=90000` (or equivalent) is applied
- strategic context is treated as optional soft prior, not as a trusted primary signal
- provider sampling remains enabled for post-release monitoring

### 2. Ship the full product including “strong enrichment context” and bilingual context UX

Recommendation: **NO**

Blockers:
- strategic-context real quality is still too inconsistent
- bilingual context UI is unfinished

## Release Position

My recommendation is:
- **core live-analysis / save / notify / settle:** ready enough to promote to production
- **strategic-context enrichment and bilingual context presentation:** not ready enough to be considered complete

So the honest release posture is:
- **Production-ready for the core recommendation engine**
- **Not production-complete for the full context/enrichment experience**
