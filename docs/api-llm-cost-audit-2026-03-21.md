# API And LLM Cost Audit

Date: 2026-03-21

## Scope

Audit objective:

1. Find the code paths that are most likely burning `Football API` quota.
2. Find the code paths where `LLM` usage is redundant or materially higher than it needs to be.

This audit combines:

- code-path inspection
- production config inspection
- production DB aggregates from the current runtime state

## Production Snapshot Used In This Audit

Current production DB snapshot at audit time:

- `matches`
  - `NS = 244`
  - `1H = 1`
  - `2H = 5`
  - `P = 1`
- `watchlist`
  - `active = 87`
  - `expired = 89`
- active watchlist by current match status
  - `NS = 83`
  - `1H = 1`
  - `2H = 3`
- active `NS` watchlist entries with prediction already present: `83 / 83`
- active `NS` watchlist entries with strategic context already present: `83 / 83`
- active `NS` watchlist entries auto-added by top-league flow: `82 / 83`
- pipeline audit last 24h
  - `PIPELINE_MATCH_ANALYZED = 208`
  - `PIPELINE_MATCH_SKIPPED = 72`
  - `PIPELINE_MATCH_ERROR = 8`
- manual AI proxy calls last 24h
  - `AI_CALL = 15`
- settle usage last 7d
  - `settlement_method = ai` on recommendations: `3`
  - `settlement_method = ai` on `ai_performance`: `2`

## Executive Summary

The Football API quota burn is explained primarily by three interacting paths:

1. `fetch-matches` baseline polling and per-live-match stats enrichment
2. `update-predictions` repeatedly refetching predictions for every `NS` watchlist match even though predictions already exist
3. `auto-pipeline` fetching stats/events/odds for live watchlist matches every `5` minutes

The LLM burn is explained primarily by:

1. `enrich-watchlist` refreshing strategic context for large numbers of `NS` auto-added matches
2. the multi-step structure of `fetchStrategicContext()` itself, where one logical refresh can consume `2-4` Gemini calls

The strongest single root cause is not one endpoint in isolation. It is this combination:

- `fetch-matches` auto-adds top-league `NS` fixtures into watchlist
- `update-predictions` then refetches predictions for all those auto-added matches every `30` minutes
- `enrich-watchlist` also refreshes LLM strategic context for those same auto-added matches

That means the system is spending Football API and LLM on matches that, in most cases, were not explicitly user-selected.

## Lower-Bound Football API Budget

Using current production counts and current default scheduler cadence:

- `update-predictions`
  - `83` active `NS` watchlist matches
  - runs every `30 min`
  - lower bound: `83 * 48 = 3,984` Football API calls/day
- `fetch-matches` baseline
  - always calls `/fixtures` for `today + tomorrow`
  - current default interval during live slate is `1 min`
  - lower bound: `2 * 60 * 24 = 2,880` calls/day
- `auto-pipeline` analyzed matches observed in last 24h
  - `208` analyzed rows
  - each analyzed row implies at least:
    - `1` statistics call
    - `1` events call
    - `1` odds call
  - lower bound: `208 * 3 = 624` Football API calls/day

Lower-bound subtotal:

- `3,984 + 2,880 + 624 = 7,488 calls/day`

This already almost exhausts a `7,500/day` plan, before counting:

- `fetch-matches` live `/fixtures/statistics` calls for every live match
- `72` skipped pipeline rows that still consumed pre-LLM Football API calls
- Football API retries on transient failure / `429`
- manual scout endpoints
- manual Ask AI support calls
- settle fallback calls for cache misses

That is enough to explain why the quota can be gone by late morning on a busy slate.

## Football API Findings

### 1. `update-predictions` is the biggest obvious quota leak

Severity: High

Code:

- [update-predictions.job.ts](c:/tfi/packages/server/src/jobs/update-predictions.job.ts#L22)
- [config.ts](c:/tfi/packages/server/src/config.ts#L64)

Behavior:

- Every `30` minutes, the job loads the full watchlist.
- It filters to matches with status `NS`.
- It then calls `fetchPrediction(entry.match_id)` for each one.
- It does this even if the watchlist row already has a prediction.

Relevant code:

- loop over all `NS` rows: [update-predictions.job.ts](c:/tfi/packages/server/src/jobs/update-predictions.job.ts#L40)
- unconditional prediction fetch: [update-predictions.job.ts](c:/tfi/packages/server/src/jobs/update-predictions.job.ts#L58)
- no TTL / no freshness check / no `prediction is null` gate: same block

Production evidence:

- active `NS` watchlist matches: `83`
- active `NS` matches with prediction already present: `83 / 83`

Interpretation:

- Right now, this job is paying again and again for data it already has.
- With current state, it is spending about `3,984/day` by itself.
- This is the single clearest Football API waste in the codebase.

### 2. `fetch-matches` baseline polling is intrinsically expensive

Severity: High

Code:

- [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts#L151)
- [config.ts](c:/tfi/packages/server/src/config.ts#L63)

Behavior:

- On each run, it fetches fixtures for `today` and `tomorrow`.
- When there are live matches, `computeNextPollDelayMs()` returns the base interval.
- Production base interval is `1 minute`.

Relevant code:

- two `/fixtures` calls every run: [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts#L153)
- live slate keeps base cadence: [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts#L319)
- base interval config: [config.ts](c:/tfi/packages/server/src/config.ts#L63)

Interpretation:

- During any live slate, the system pays `2 calls/minute` just to keep the `matches` table fresh.
- That is `2,880/day` if the job remains in its `1-minute` mode.
- This is not a bug, but it is a very expensive default.

### 3. `fetch-matches` adds another Football API call per live match every minute

Severity: High

Code:

- [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts#L186)

Behavior:

- After the fixture list is loaded, every live row triggers `fetchFixtureStatistics(match_id)`.
- This is done only to enrich reds/yellows in the `matches` table.

Relevant code:

- live row detection: [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts#L187)
- per-live-match stats call: [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts#L194)

Production evidence:

- current live matches in `matches`: `6`

Interpretation:

- At audit time, this path alone is worth `6 calls/minute` while those matches are live.
- That is `360 calls/hour`.
- Even a `3-hour` busy live window adds roughly `1,080` calls on top of the baseline.

This is likely the second-biggest real quota burner after `update-predictions`.

### 4. `fetch-matches` auto-adds top-league `NS` matches, which multiplies downstream API spend

Severity: High

Code:

- [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts#L266)

Behavior:

- All top-league `NS` matches are auto-added to watchlist with `added_by = 'top-league-auto'`.

Relevant code:

- select top-league `NS` rows: [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts#L271)
- create watchlist entry automatically: [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts#L281)

Production evidence:

- active `NS` watchlist entries: `83`
- auto-added top-league `NS` entries: `82`

Interpretation:

- This is the multiplier behind both `update-predictions` and `enrich-watchlist`.
- The system is effectively treating “top-league fixture exists” as “deserves prediction refresh + strategic LLM enrichment”.
- That is a product choice, but from a quota perspective it is extremely expensive.

### 5. `server-pipeline` is not the top Football API culprit, but it still has measurable waste

Severity: Medium

Code:

- [check-live-trigger.job.ts](c:/tfi/packages/server/src/jobs/check-live-trigger.job.ts#L14)
- [server-pipeline.ts](c:/tfi/packages/server/src/lib/server-pipeline.ts#L1148)
- [server-pipeline.ts](c:/tfi/packages/server/src/lib/server-pipeline.ts#L1322)

Behavior:

- Every `5` minutes, `check-live-trigger` finds live watchlist matches and runs `runPipelineBatch()`.
- For each match, the pipeline fetches:
  - statistics
  - events
  - odds
- It does stats/events before the proceed gate.
- It does odds before the staleness gate.

Relevant code:

- trigger cadence and batching: [check-live-trigger.job.ts](c:/tfi/packages/server/src/jobs/check-live-trigger.job.ts#L51)
- stats/events fetch before proceed: [server-pipeline.ts](c:/tfi/packages/server/src/lib/server-pipeline.ts#L1148)
- odds fetch before staleness: [server-pipeline.ts](c:/tfi/packages/server/src/lib/server-pipeline.ts#L1316)

Production evidence:

- `PIPELINE_MATCH_ANALYZED = 208` in last 24h
- `PIPELINE_MATCH_SKIPPED = 72` in last 24h
- top skip reasons include:
  - `Early game with poor stats`
  - `Minute 90' beyond maximum window (85')`
  - `no_significant_change`
  - `Status HT not live`

Interpretation:

- The analyzed path is expected product behavior.
- The wasted part is that a non-trivial number of rows are only rejected after Football API work is already done.
- For the `72` skipped rows, the system still paid at least stats/events, and in some cases odds too.

This is real waste, but it is still smaller than the `update-predictions + fetch-matches` combination.

### 6. Odds resolver cost is real but not the main reason the daily quota is disappearing

Severity: Low-Medium

Code:

- [odds-resolver.ts](c:/tfi/packages/server/src/lib/odds-resolver.ts#L164)

Behavior:

- For every odds resolution attempt, it first calls API-Football live odds.
- If live odds are unusable, it may then try The Odds API, then API-Football pre-match odds.

Relevant code:

- mandatory live odds attempt: [odds-resolver.ts](c:/tfi/packages/server/src/lib/odds-resolver.ts#L171)

Interpretation:

- This is a real Football API consumer.
- But based on current data, it is not the dominant quota burn compared with prediction refresh and fetch-matches polling.

### 7. Settle is no longer the main Football API problem

Severity: Low

Code:

- [auto-settle.job.ts](c:/tfi/packages/server/src/jobs/auto-settle.job.ts#L548)
- [auto-settle.job.ts](c:/tfi/packages/server/src/jobs/auto-settle.job.ts#L601)
- [re-evaluate.job.ts](c:/tfi/packages/server/src/jobs/re-evaluate.job.ts#L293)
- [re-evaluate.job.ts](c:/tfi/packages/server/src/jobs/re-evaluate.job.ts#L330)

Behavior:

- Settle now reads `matches_history` first for stats and regular-time score.
- Football API is only used on cache miss.

Production evidence:

- recent AI settlement usage is tiny
- no sign that settle is dominating quota anymore

Interpretation:

- The recent local-first settle cache work is doing its job.
- This is not where the 7,500/day quota is being lost.

### 8. There is still a duplicate client-side pipeline available in the UI

Severity: Medium operational risk

Code:

- [LiveMonitorTab.tsx](c:/tfi/src/app/LiveMonitorTab.tsx#L447)
- [scheduler.ts](c:/tfi/src/features/live-monitor/scheduler.ts#L77)
- [pipeline.ts](c:/tfi/src/features/live-monitor/services/pipeline.ts)

Behavior:

- The UI still exposes a client-side scheduler and `Run Once`.
- That legacy frontend pipeline fetches live fixtures, odds, context, and AI through server proxy routes.

Interpretation:

- It is not auto-started, so it is not the default daily leak.
- But if an operator leaves that screen running, it can duplicate the server job behavior and consume extra Football API and LLM budget.

## LLM Findings

### 1. `enrich-watchlist` is the biggest current LLM spender

Severity: High

Code:

- [enrich-watchlist.job.ts](c:/tfi/packages/server/src/jobs/enrich-watchlist.job.ts#L218)
- [enrich-watchlist.job.ts](c:/tfi/packages/server/src/jobs/enrich-watchlist.job.ts#L239)
- [enrich-watchlist.job.ts](c:/tfi/packages/server/src/jobs/enrich-watchlist.job.ts#L277)
- [strategic-context.service.ts](c:/tfi/packages/server/src/lib/strategic-context.service.ts#L1153)

Behavior:

- Every hour, the job scans active watchlist entries.
- For `NS` entries, “good” context becomes stale after `6h`.
- Once eligible, it calls `fetchStrategicContext()` again.

Relevant code:

- stale window for good context: [enrich-watchlist.job.ts](c:/tfi/packages/server/src/jobs/enrich-watchlist.job.ts#L18)
- eligibility logic: [enrich-watchlist.job.ts](c:/tfi/packages/server/src/jobs/enrich-watchlist.job.ts#L239)
- actual LLM call site: [enrich-watchlist.job.ts](c:/tfi/packages/server/src/jobs/enrich-watchlist.job.ts#L277)

Production evidence:

- active `NS` watchlist rows: `83`
- active `NS` rows with context already present: `83 / 83`
- active `NS` rows refreshed in last `6h`: `35`
- active `NS` rows refreshed in last `12h`: `83`
- active `NS` refresh outcomes in last `24h`:
  - `failed = 25`
  - `good = 21`
  - `poor = 18`
  - `none = 19`

Interpretation:

- The system is re-running strategic enrichment across almost the entire `NS` watchlist even though context already exists.
- Because `82 / 83` of these rows are auto-added, the LLM is spending heavily on non-user-curated matches.

### 2. One strategic-context refresh can cost multiple Gemini calls

Severity: High

Code:

- [strategic-context.service.ts](c:/tfi/packages/server/src/lib/strategic-context.service.ts#L864)
- [strategic-context.service.ts](c:/tfi/packages/server/src/lib/strategic-context.service.ts#L889)
- [strategic-context.service.ts](c:/tfi/packages/server/src/lib/strategic-context.service.ts#L915)
- [strategic-context.service.ts](c:/tfi/packages/server/src/lib/strategic-context.service.ts#L1167)

Behavior:

Per logical refresh:

1. grounded Gemini + Google Search draft
2. structured JSON synthesis
3. optional JSON repair pass
4. grounded draft is retried up to `2` times on failure

Relevant code:

- grounded search pass: [strategic-context.service.ts](c:/tfi/packages/server/src/lib/strategic-context.service.ts#L864)
- structured pass: [strategic-context.service.ts](c:/tfi/packages/server/src/lib/strategic-context.service.ts#L889)
- repair pass: [strategic-context.service.ts](c:/tfi/packages/server/src/lib/strategic-context.service.ts#L915)
- outer grounded retry loop: [strategic-context.service.ts](c:/tfi/packages/server/src/lib/strategic-context.service.ts#L1169)

Interpretation:

- Best case: `2` Gemini calls per match refresh
- Common case with parse failure: `3` calls
- Failure case with grounded retry: `2` grounded calls before returning null

With `83` active `NS` rows refreshed within `12h`, the lower-bound spend is already about:

- `83 * 2 = 166 Gemini calls / 12h`

before counting repair passes.

### 3. `auto-pipeline` LLM usage is material, but mostly aligned with product behavior

Severity: Medium

Code:

- [check-live-trigger.job.ts](c:/tfi/packages/server/src/jobs/check-live-trigger.job.ts#L51)
- [server-pipeline.ts](c:/tfi/packages/server/src/lib/server-pipeline.ts#L1479)

Production evidence:

- `PIPELINE_MATCH_ANALYZED = 208` in last 24h

Interpretation:

- That means roughly `208` Gemini recommendation calls from the server-side live pipeline in a day.
- This is not tiny, but it is directly tied to the core product behavior.
- Compared with enrichment, this is less clearly “waste” and more “expected operating cost”.

### 4. Manual Ask AI is not the current LLM problem

Severity: Low

Code:

- [proxy.routes.ts](c:/tfi/packages/server/src/routes/proxy.routes.ts#L143)

Production evidence:

- `AI_CALL = 15` in last 24h

Interpretation:

- Manual AI usage exists, but it is small relative to the strategic enrichment volume.

### 5. Auto-settle AI fallback is not currently a meaningful LLM burner

Severity: Low

Production evidence:

- `settlement_method = ai` on recommendations in last 7 days: `3`
- `ai_method` rows in `ai_performance` in last 7 days: `2`

Interpretation:

- Settle AI usage is now rare.
- It should not be treated as a current cost problem.

## Most Likely Explanation For The Quota Burn

If we take only the hard lower-bound numbers already visible today:

- `update-predictions`: `3,984/day`
- `fetch-matches` baseline: `2,880/day`
- `auto-pipeline analyzed` lower bound: `624/day`

Total:

- `7,488/day`

That already reaches the plan limit.

So the quota burn does not require a hidden bug.
The current normal runtime behavior is already expensive enough to do it.

The most probable dominant chain is:

1. top-league auto-add fills watchlist with `NS` matches
2. `update-predictions` refreshes all of them every `30 min`
3. `fetch-matches` keeps polling `today + tomorrow` every minute during live slate
4. `fetch-matches` also refetches statistics for every live fixture every minute
5. `auto-pipeline` adds another live stats/events/odds layer on top

## Recommended Priorities

### P0: Stop the Football API burn

1. Add a real prediction TTL to `update-predictions`, and skip when `prediction` already exists and kickoff/date has not materially changed.
2. Stop refreshing predictions for `top-league-auto` rows by default, or move them to a lighter tier than user-added watchlist rows.
3. Reduce `fetch-matches` live card enrichment frequency, or cache `/fixtures/statistics` for a short TTL per live fixture instead of refetching every minute.
4. Consider reducing `fetch-matches` from `today + tomorrow every minute` to a more selective window during live slate.

### P0: Stop the LLM burn

1. Do not run strategic enrichment on every auto-added `NS` match.
2. Raise good-context TTL well above `6h` for stable pre-match rows, especially when the match is already enriched and kickoff has not materially changed.
3. Restrict strategic enrichment to:
   - user-added watchlist rows
   - high-priority rows
   - rows close to kickoff
4. Keep the multi-step grounded + structured flow, but only for rows that actually deserve it.

### P1: Trim secondary Football API waste

1. Pre-filter `check-live-trigger` more aggressively before entering `server-pipeline`.
2. Skip obvious non-eligible minute/status windows earlier so stats/events are not fetched only to return `PIPELINE_MATCH_SKIPPED`.
3. Review whether the UI `LiveMonitorTab` legacy scheduler should stay exposed in production.

## Bottom Line

Football API:

- The quota burn is real and fully explainable from current code.
- The main problem is not a single runaway endpoint.
- The main problem is the interaction between `auto-add watchlist`, `prediction refresh`, and `fixture polling cadence`.

LLM:

- The clearest redundant LLM spend is `strategic enrichment` on large volumes of already-enriched `NS` auto-added matches.
- Core live-analysis LLM usage is material, but it is not the first place I would cut.
