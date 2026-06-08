# Football AI Recommendation Audit Plan

**Created:** 2026-06-03  
**Scope:** technical, data-quality, AI, and football-betting logic audit for the TFI live recommendation system.  
**Primary runtime source of truth:** [live-recommendation-pipeline-vi.md](./live-recommendation-pipeline-vi.md).  
**Replay source of truth:** [data-driven-pipeline-status.md](./data-driven-pipeline-status.md).  
**Provider documentation:** [API-Football v3 documentation](https://www.api-football.com/documentation-v3).

## 1. Audit Objective

TFI is an investment-decision assistant for football betting, not a guarantee engine. This audit must answer four concrete questions:

1. Is the live pipeline technically correct from provider data to recommendation save/delivery?
2. Is the data sent to Gemini accurate, fresh, canonical, and appropriate for the betting market being analyzed?
3. Are the rule-based guards aligned with football betting reality, especially for odds freshness, market eligibility, lines, timing, and settlement?
4. Do historical replay and real LLM/API samples show measurable edge, or do they expose weak segments that should be blocked, capped, or redesigned?

The audit should produce actionable findings, not broad observations. Every serious finding should include evidence, reproduction steps, affected files, business impact, and a recommended remediation.

## 2. Systems In Scope

### Runtime Pipeline

- Scheduler entry: `packages/server/src/jobs/check-live-trigger.job.ts`
- Match processor: `packages/server/src/lib/server-pipeline.ts`
- Prompt builder: `packages/server/src/lib/live-analysis-prompt.ts`
- Official prompt version: `v10-hybrid-legacy-g`
- Odds resolver: `packages/server/src/lib/odds-resolver.ts`
- Market normalization: `packages/server/src/lib/normalize-market.ts`
- Recommendation policy: `packages/server/src/lib/recommendation-policy.ts`
- Evidence allowlist: `packages/server/src/lib/evidence-mode-market-allowlist.ts`
- Line patience: `packages/server/src/lib/line-patience-policy.ts`
- Thesis watch: `packages/server/src/lib/thesis-watch.service.ts`
- Recommendation persistence: `packages/server/src/repos/recommendations.repo.ts`
- Delivery staging: `packages/server/src/repos/recommendation-deliveries.repo.ts`
- Settlement: `packages/server/src/jobs/auto-settle.job.ts`, `packages/server/src/lib/settle-rules.ts`

### Provider Boundary

- All outbound API-Football calls must go through `packages/server/src/lib/football-api.ts`.
- Browser code must never call API-Football directly.
- Live-monitor frontend should use backend routes such as `/api/matches` and `/api/proxy/football/*`.

### Historical Data And Replay

- `recommendations`
- `ai_performance`
- `match_snapshots`
- `provider_odds_samples`
- `provider_odds_cache`
- `pipeline_runs`
- Replay work under `packages/server/replay-work/data-driven-runs/<runId>/`
- CI baselines under `packages/server/ci-baselines/data-driven-gates/`

## 3. Out Of Scope

- User acquisition, pricing, subscription strategy, or UX redesign.
- Replacing API-Football or Gemini as a product decision.
- Guaranteeing betting profit.
- Treating `legacy/` as active runtime unless a finding explicitly needs historical comparison.

## 4. Provider Contract Risks To Verify

API-Football documentation and official API-Football material call out several details that are money-critical for TFI:

1. Fixture/live match data can update frequently, commonly around 15 seconds for live state.
2. Fixture statistics are typically lower-frequency than score/events and may update around once per minute.
3. In-play odds are available only around the live window, are not historically stored by the live endpoint, and can update in a 5-60 second range.
4. `/odds/live/bets` IDs are not compatible with pre-match `/odds/bets` IDs.
5. Live odds values can have status fields such as stopped, blocked, finished, suspended, and `main`; these must affect tradability.
6. Pre-match odds availability and history are limited; they must not be silently treated as live tradable odds after kickoff.
7. Coverage flags from the provider do not guarantee every fixture has every data type.

Audit implication: provider coverage must be proven per fixture, per market, per line, and per timestamp before a recommendation can be considered actionable.

## 5. Audit Method

The audit runs in six phases. Each phase produces artifacts that later phases can reuse.

### Phase 0: Baseline And Readiness

Goal: confirm the repo, DB, provider keys, and replay data are ready.

Commands:

```powershell
npm run typecheck --prefix packages/server
npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts src/__tests__/recommendation-policy.test.ts src/__tests__/normalize-market.test.ts src/__tests__/odds-resolver.test.ts
npm run data-driven:coverage --prefix packages/server -- --out-json replay-work/audit/coverage.json
npm run data-driven:verify-gates-ci --prefix packages/server
```

Evidence to collect:

- Git commit hash.
- Relevant `.env` values with secrets redacted.
- DB row counts for core audit tables.
- Coverage report.
- Existing gate pass/fail result.

Pass criteria:

- Tests pass or failures are documented as pre-existing blockers.
- Historical data has enough settled recommendations for segment analysis.
- Provider and Gemini keys are present before real API/LLM phases.

### Phase 1: Static Pipeline Audit

Goal: trace the money-critical path by reading code and tests.

Checklist:

1. Watchlist and match selection gates.
2. Fixture/status/score/minute extraction.
3. Stats, events, odds, profiles, strategic context, and performance-memory inputs.
4. Evidence mode derivation.
5. Canonical odds construction and market availability.
6. Prompt rendering and strict JSON contract.
7. Gemini parse defaults and safety warnings.
8. Market normalization and line matching.
9. Line patience and thesis-watch deferrals.
10. Post-parse policy.
11. Save decision and recommendation payload.
12. Delivery staging and async Telegram/web-push marking.
13. Settlement and feedback into `ai_performance` / performance memory.

Special attention:

- `should_push` must not be confused with `saved`.
- Condition-triggered alerts must still pass odds, confidence, policy, and same-thesis guards before persistence.
- Advisory/manual prompt-only flows must not save or notify.
- Signed Home/Away lines must normalize as Asian Handicap, not 1X2.
- Unknown market normalization must block save.

Output:

- Static findings table with severity, file, line/function, risk, and recommended fix.
- Missing test list.

### Phase 2: Provider Data Contract Audit

Goal: prove that TFI's API-Football integration matches the real provider contract.

Checks:

1. Search for direct provider calls outside `football-api.ts`.
2. Confirm request headers, timeout, retry, quota, and circuit-breaker behavior.
3. Validate endpoint usage:
   - `/fixtures`
   - `/fixtures/statistics`
   - `/fixtures/events`
   - `/fixtures/lineups`
   - `/standings`
   - `/teams`
   - `/odds/live`
   - `/odds`
4. Validate live odds fields:
   - blocked/stopped/finished status.
   - suspended values.
   - duplicate values and `main`.
   - bookmaker/bet/value nesting differences between live and prematch payloads.
5. Validate pre-match odds fallback:
   - clearly marked as `reference-prematch`.
   - not used as live tradable odds when real live odds are required.
6. Validate coverage flags:
   - raw market availability versus canonical tradable availability.
   - stored flags versus recomputed flags.

Commands:

```powershell
npm run provider:coverage-audit --prefix packages/server -- --lookback-days 180 --limit 500 --out-json replay-work/audit/provider-coverage-audit.json
npm run provider:coverage-audit --prefix packages/server -- --lookback-days 180 --limit 500 --fail-on-mismatch
```

Output:

- `provider-contract-report.md`
- `provider-coverage-audit.json`
- List of raw payload shapes that need new fixtures/tests.

### Phase 3: Real API Sampling

Goal: spend limited API-Football quota to validate current live and near-live behavior.

Required env:

```env
FOOTBALL_API_KEY=...
FOOTBALL_API_DAILY_LIMIT=...
```

Sample groups:

1. Live fixtures: statuses `1H`, `HT`, `2H`, `ET`, `BT`, `P`, `LIVE`, `INT`.
2. Near kickoff fixtures: 5-30 minutes before start.
3. Recently finished fixtures: within 20 minutes after finish.
4. Settled historical fixtures from recommendations.

Per fixture, collect:

- Fixture status/score/minute.
- Statistics.
- Events.
- Lineups when available.
- Live odds.
- Pre-match odds.
- Normalized odds.
- Canonical markets and lines.
- Provider response timestamps and TFI cache timestamps.

Controls:

- Set a hard per-run call budget.
- Store raw payloads under `replay-work/audit/provider-samples/<runId>/`.
- Redact API keys.
- Do not run uncontrolled polling.

Output:

- `real-provider-sample-report.md`
- Raw and normalized JSON samples.
- Provider mismatch list:
  - missing stats.
  - stale events.
  - missing live odds.
  - blocked/suspended odds treated as usable.
  - pre-match odds used where live odds were required.
  - canonical line unavailable.

### Phase 4: Real Gemini Replay

Goal: evaluate Gemini behavior against historical scenarios and recorded odds.

Required env:

```env
GEMINI_API_KEY=...
ALLOW_REAL_LLM_REPLAY=true
GEMINI_REPLAY_MODEL=...
```

Commands:

```powershell
npm run data-driven:improvement-run-real --prefix packages/server
npm run data-driven:fast-hotspot-real --prefix packages/server
npm run benchmark:gemini-models:smoke --prefix packages/server
```

Read first:

- `replay-vs-original.json`
- `segment-hotspots.json`
- `segment-action-plan.json`
- `cases-flat.csv`
- `llm-cache/*.json`

Failure taxonomy:

1. Model no-bet despite usable canonical edge.
2. Model proposes a market not present in canonical odds.
3. Model proposes stale or unavailable line.
4. Model ignores score/minute/state.
5. Model violates prompt constraints but policy blocks it.
6. Model selects weak high-risk market.
7. Model confidence is not calibrated to odds and break-even.
8. Model is too conservative in segments with proven historical edge.

Output:

- `real-llm-replay-report.md`
- `llm-failure-taxonomy.csv`
- Representative prompt/response examples with secrets and user data redacted.

### Phase 5: Football Betting Logic Audit

Goal: evaluate whether TFI's recommendation logic is sensible for online football betting.

Segment analysis:

- Market family:
  - 1X2
  - Asian Handicap
  - goals totals
  - HT goals totals
  - BTTS
  - corners
- Minute band:
  - 0-15
  - 16-30
  - 31-45
  - HT
  - 46-60
  - 61-75
  - 76-85
  - 86+
- Score state:
  - level.
  - home leading by 1.
  - away leading by 1.
  - home leading by 2+.
  - away leading by 2+.
- Odds band:
  - 1.50-1.69.
  - 1.70-1.99.
  - 2.00-2.49.
  - 2.50+.
- Evidence mode:
  - `full_live_data`.
  - `stats_only`.
  - `odds_events_only`.
  - `odds_only`.
  - `none`.
- Data quality:
  - stats present/missing.
  - events present/missing.
  - odds fresh/stale/missing.
  - canonical market available/unavailable.

Betting-specific checks:

1. Asian Handicap settlement including quarter lines.
2. O/U settlement including push and half-win/half-loss.
3. HT market settlement uses first-half score only.
4. Corners markets are not settled from full-time goals.
5. Late 1X2 and totals guards reflect game state and odds risk.
6. Stake sizing is capped for weak or low-sample segments.
7. Same-thesis stacking does not overexpose one match state.
8. Performance memory does not learn from duplicate, void, unsettled, or low-trust recommendations.

Commands:

```powershell
npm run data-driven:improvement-run --prefix packages/server
npm run data-driven:segment-hotspots --prefix packages/server -- --cases-json <path-to-eval-cases.json> --out-json replay-work/audit/segment-hotspots.json
npm run data-driven:action-plan --prefix packages/server -- --hotspots-json replay-work/audit/segment-hotspots.json --eval-cases-json <path-to-eval-cases.json> --out-json replay-work/audit/segment-action-plan.json
```

Output:

- `betting-quality-report.csv`
- `betting-quality-report.md`
- Proposed segment blocklist/stake caps, if justified.

### Phase 6: Remediation Plan And Verification

Goal: convert audit findings into a ranked engineering backlog.

Severity levels:

- `S0`: can create or save materially wrong betting recommendations.
- `S1`: can distort AI inputs, odds mapping, policy, settlement, or performance memory.
- `S2`: degrades recommendation quality or observability.
- `S3`: documentation, cleanup, or non-critical test coverage.

Each fix should include:

- Affected files.
- Risk and business impact.
- Proposed change.
- Focused tests.
- Replay/real-data verification command.
- Whether CI baselines must be updated.

Final verification commands:

```powershell
npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts src/__tests__/recommendation-policy.test.ts src/__tests__/normalize-market.test.ts src/__tests__/odds-resolver.test.ts src/__tests__/auto-settle.test.ts
npm run data-driven:verify-gates-ci --prefix packages/server
npm run verify:ci
```

## 6. Audit Deliverables

The audit should produce these files under `replay-work/audit/<runId>/` or `docs/` when stable:

1. `audit-summary.md`
2. `static-pipeline-findings.md`
3. `provider-contract-report.md`
4. `real-provider-sample-report.md`
5. `real-llm-replay-report.md`
6. `betting-quality-report.md`
7. `betting-quality-report.csv`
8. `findings.json`
9. `remediation-backlog.md`

Recommended finding shape:

```json
{
  "id": "TFI-AUDIT-001",
  "severity": "S1",
  "area": "odds_integrity",
  "title": "Live odds fallback can use stale prematch price in live context",
  "evidence": "...",
  "affectedFiles": ["packages/server/src/lib/odds-resolver.ts"],
  "businessImpact": "...",
  "reproduction": "...",
  "recommendedFix": "...",
  "verification": ["npm run ..."]
}
```

## 7. Minimum Evidence Standard

A finding is not accepted unless at least one of these is true:

1. Reproduced by a test, replay case, script, or SQL query.
2. Proven by direct source-code trace from input to money-critical output.
3. Proven by real API-Football payload sample.
4. Proven by real Gemini prompt/response replay.
5. Proven by settled recommendation outcome analysis with enough sample size.

For low-sample betting segments, mark the result as `observe` instead of `block` unless the issue is a clear technical bug.

## 8. First Audit Run Checklist

1. Create folder: `replay-work/audit/<YYYYMMDD-HHMM>/`.
2. Record commit hash and env summary.
3. Run Phase 0 baseline.
4. Run provider coverage audit.
5. Review `replay-vs-original.json`, `segment-hotspots.json`, and `segment-action-plan.json`.
6. Run limited real API sampling.
7. Run limited real Gemini replay.
8. Draft findings.
9. Classify findings by severity.
10. Implement only S0/S1 fixes first, then rerun focused tests and replay gates.

## 9. Decision Rules

- Do not tune prompt before provider coverage and canonical odds are proven.
- Do not loosen policy gates based only on a few attractive examples.
- Do not update CI baselines unless the team intentionally accepts the new metrics.
- Do not use API-Football predictions as AI evidence; see [ai-input-source-audit.md](./ai-input-source-audit.md).
- Do not use retired prompt versions or shadow prompt candidates unless creating a deliberate new official baseline.
- Do not treat `should_push=true` as a saved recommendation.
- Do not persist recommendations with unknown market, unavailable odds, odds below minimum, forbidden evidence mode, or hard policy block.
