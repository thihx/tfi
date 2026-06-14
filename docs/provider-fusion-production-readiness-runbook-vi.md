# Provider Fusion Production Readiness Runbook

**Status:** operational runbook for PRD readiness validation
**Updated:** 2026-06-14
**Scope:** validate multi-provider live data fusion before production rollout. This runbook does not enable runtime promotion by itself.

## 1. Goal

Provider Fusion is production-ready only when the code contract, provider data contract, AI Gateway controls, telemetry contract, and rollback posture all pass together.

The target validation flow is:

```text
Static/unit/coverage gates
  -> real API-Football bounded sample
  -> real Sportmonks bounded shadow sample
  -> provider fusion shadow snapshot on mapped matches
  -> real LLM replay smoke through AI Gateway
  -> official non-shadow controlled live run
  -> live telemetry readiness gate
  -> human rollout decision
```

## 2. Non-Negotiable Guards

- Do not deploy from this runbook.
- Do not paste provider or LLM tokens into commands, logs, docs, or artifacts.
- Real LLM calls must go through AI Gateway with cost caps.
- Real provider calls must use low `--max-api-calls` / `--max-calls` budgets first.
- Provider Fusion promotion flags stay off for baseline sampling. For official validation, enable promotion flags only in a bounded controlled run with AI Gateway cost caps, provider allowlists, rollout 100 for the selected test match, and rollback flags documented.
- API-Football, Sportmonks, and future providers are inputs behind adapters; raw provider shape must not leak into prompt/policy/save logic.

## 3. Required Environment

For static and DB-only checks:

```powershell
npm install
```

For API-Football real samples, the existing API-Football env must be configured.

For Sportmonks real samples, configure secrets outside source control:

```text
SPORTMONKS_ENABLED=true
SPORTMONKS_SHADOW_ENABLED=true
SPORTMONKS_API_TOKEN=<set securely outside command history>
SPORTMONKS_SHADOW_MAX_CALLS_PER_RUN=3
```

For real LLM smoke:

```text
AI_GATEWAY_MODE=enforce
AI_GATEWAY_MAX_ESTIMATED_COST_USD_PER_CALL=0.05
AI_GATEWAY_LOOP_CALL_THRESHOLD=2
GEMINI_API_KEY=<set securely outside command history>
```

## 4. Hard Gates

Run after every provider-fusion code change:

```powershell
npm run typecheck --prefix packages/server
npm run test --prefix packages/server
npm run data-driven:verify-gates-ci --prefix packages/server
npm run test:coverage:provider-fusion --prefix packages/server
npm run check:coverage:provider-fusion --prefix packages/server
```

Acceptance:

- all commands exit `0`;
- provider-fusion coverage gate passes configured thresholds;
- no provider-fusion test uses live network by default;
- no snapshots contain provider auth data.

## 5. Real API-Football Sample

Use a bounded sample first:

```powershell
npm run provider:real-sample --prefix packages/server -- `
  --date 2026-06-14 `
  --max-fixtures 1 `
  --max-api-calls 5 `
  --no-prematch-odds `
  --out-json replay-work/prd-readiness/<runId>/api-football-real-sample.json
```

Acceptance:

- real quota budget is respected;
- live/near/finished sampling records endpoint status;
- daily-limit, circuit-open, empty stats, missing odds, and provider errors are findings, not silent pass conditions.

Current 2026-06-14 finding:

- API-Football real sampling returned `football_api_daily_limit`; real API-Football PRD validation must be retried after the circuit closes.

## 6. Real Sportmonks Shadow Sample

Run only after `SPORTMONKS_API_TOKEN` is available through secure local/deployment env:

```powershell
npm run provider:sportmonks-shadow --prefix packages/server -- `
  --date 2026-06-14 `
  --max-calls 3 `
  --out-json replay-work/prd-readiness/<runId>/sportmonks-shadow.json
```

If checking in-play odds entitlement:

```powershell
npm run provider:sportmonks-shadow --prefix packages/server -- `
  --date 2026-06-14 `
  --max-calls 3 `
  --include-inplay-odds `
  --out-json replay-work/prd-readiness/<runId>/sportmonks-shadow-inplay-odds.json
```

Acceptance:

- token is not printed;
- rate-limit metadata is captured;
- coverage summary records participants, scores, events, statistics, periods, and odds flags;
- World Cup entitlement/no-access is captured as provider coverage, not as an internal system error;
- samples remain shadow-only unless a later rollout explicitly enables promotion.

Current 2026-06-14 finding:

- Sportmonks token is available for local validation. Real calls to `/livescores`, `/livescores/latest`, and `/fixtures/date/<date>` returned 200 in the local readiness run, but the live Chile test fixture did not map to a Sportmonks fixture, so stats/events promotion correctly stayed blocked.

## 7. Provider Fusion Shadow Snapshot

Run after selecting an API-Football fixture id that is live/recent and likely mappable to Sportmonks:

```powershell
npm run provider:fusion-shadow --prefix packages/server -- `
  --match-id <api-football-fixture-id> `
  --out-json replay-work/prd-readiness/<runId>/provider-fusion-shadow.json
```

Acceptance:

- API-Football provider envelope is included;
- Sportmonks provider envelope is included when enabled and mapped;
- score/minute conflict downgrades evidence;
- API-Football empty stats plus trusted Sportmonks stats can be selected in shadow;
- odds promotion remains blocked unless odds promotion flags and money guards are explicitly enabled.

## 8. Real LLM Smoke Through AI Gateway

Use one or very few replay scenarios:

```powershell
$env:AI_GATEWAY_MODE = 'enforce'
$env:AI_GATEWAY_MAX_ESTIMATED_COST_USD_PER_CALL = '0.05'
$env:AI_GATEWAY_LOOP_CALL_THRESHOLD = '2'
$env:GEMINI_REPLAY_MODEL = 'gemini-3.5-flash'
npm run data-driven:replay-batch --prefix packages/server -- `
  --lookback-days 30 `
  --limit 10 `
  --max-scenarios 1 `
  --llm real `
  --allow-real-llm `
  --delay-ms 0 `
  --odds recorded `
  --apply-replay-policy `
  --eval-prompt-version v10-hybrid-legacy-g `
  --no-post-segment-hotspots
```

Acceptance:

- AI Gateway decision is `allow`;
- feature key and operation are logged;
- estimated cost is below configured cap;
- no direct LLM bypass is used;
- LLM response parses into the current strict JSON contract.

Current 2026-06-14 finding:

- one real LLM replay smoke passed through AI Gateway with low estimated cost and parsed successfully; quality evaluation remains too small for promotion.

## 9. Official Controlled Live Run

Use this only after static gates and bounded provider checks pass. This is not shadow-only: it exercises the production pipeline path and may save/stage delivery rows when the LLM and policy allow it.

Required flags for the selected test run:

```text
AI_GATEWAY_MODE=enforce
AI_GATEWAY_MAX_ESTIMATED_COST_USD_PER_CALL=0.05
AI_GATEWAY_LOOP_CALL_THRESHOLD=2
PROVIDER_FUSION_ENABLED=true
PROVIDER_FUSION_SHADOW_ENABLED=false
PROVIDER_FUSION_PROMOTION_ENABLED=true
PROVIDER_FUSION_STATS_EVENTS_PROMOTION=true
PROVIDER_FUSION_ODDS_PROMOTION=true
PROVIDER_FUSION_ODDS_PROVIDER_ALLOWLIST=api-football,sportmonks
PROVIDER_FUSION_ROLLOUT_PERCENT=100
PROVIDER_FUSION_KILL_SWITCH=false
SPORTMONKS_ENABLED=true
SPORTMONKS_ALLOW_STATS_FALLBACK=true
SPORTMONKS_ALLOW_EVENTS_FALLBACK=true
SPORTMONKS_ALLOW_ODDS_FALLBACK=true
```

Recommended test action:

```text
Run one live watchlist match through the non-shadow pipeline path, then inspect:
- `audit_logs` for `PIPELINE_PROVIDER_FUSION_STATS_EVENTS_PROMOTION` and `PIPELINE_PROVIDER_FUSION_ODDS_PROMOTION`;
- `ai_gateway_logs` for cost, decision, model, operation, and status;
- `recommendations`, `user_recommendation_deliveries`, and `user_recommendation_delivery_channels` for save/notify effects;
- `provider_request_ledger` for Sportmonks/API-Football call provenance and endpoint status.
```

Acceptance:

- `PROVIDER_FUSION_SHADOW_ENABLED=false` is effective;
- AI Gateway decision is `allow` and estimated cost is below the cap;
- odds promotion succeeds only for fresh tradable allowlisted odds;
- stats/events promotion succeeds only when the non-API-Football provider is selected, mapped, trusted, and conflict-free;
- no-action outputs may stage suppressed no-action delivery rows, but must not create money recommendation rows;
- recommendation rows, when created, include provider-fusion decision context and normal save-integrity metadata.

Current 2026-06-14 finding:

- Official non-shadow manual-force run on `1505464` (`Nublense vs Huachipato`, Chile Primera Division) used AI Gateway enforce and `gemini-3.5-flash`; estimated cost was about `$0.00155`.
- `PIPELINE_PROVIDER_FUSION_ODDS_PROMOTION` succeeded with provider `api-football` and `canSaveRecommendation=true`.
- `PIPELINE_PROVIDER_FUSION_STATS_EVENTS_PROMOTION` skipped because Sportmonks did not map/select stats/events for this Chile fixture; blockers included `no_fusion_statistics_data`, `no_sportmonks_events_selected`, and `no_sportmonks_statistics_selected`.
- The LLM returned no-action and policy blocked money save with `MARKET_UNRESOLVED`; the pipeline staged one suppressed no-action delivery and created no recommendation row.

## 10. Live Telemetry Readiness Gate

Run after runtime has produced recent audit rows:

```powershell
npm run data-driven:live-telemetry-readiness --prefix packages/server -- `
  --short-hours 48 `
  --long-hours 168 `
  --max-samples 20 `
  --min-resolved-shadow-candidates 1 `
  --out-json replay-work/prd-readiness/<runId>/live-telemetry-readiness.json `
  --out-md replay-work/prd-readiness/<runId>/live-telemetry-readiness.md
```

Acceptance:

- `telemetryReady=true` in both windows;
- `promotionEvidenceReady=true` in both windows for the configured threshold;
- `missingMinute=0`, `missingScore=0`, `missingEvidenceMode=0`, `missingValuePercent=0`, `missingRiskLevel=0`;
- `missingShadowCandidate=0`;
- `shadowCandidateResolved` meets the configured threshold.

Important interpretation:

- `shadowCandidatePresent=false` is valid when the model explicitly returns `reason_code=no_viable_candidate`.
- Missing shadow telemetry means the contract was not populated or parser defaulted to `not_provided` / `parse_error`.

Current 2026-06-14 finding:

- telemetry readiness passes after fixing the missing-shadow-candidate definition.

## 11. Rollout Decision Gates

Shadow-only is acceptable when:

- hard gates pass;
- real provider samples are bounded and understood;
- telemetry readiness passes;
- provider-specific gaps are documented.

Stats/events promotion can be considered only when:

- API-Football has empty/missing stats/events;
- Sportmonks mapping is verified/high confidence;
- score/minute conflict is absent;
- provider coverage and provenance are present in audit metadata;
- normal odds, evidence, market, policy, dedupe, bankroll, and save guards still pass.

Odds promotion can be considered only when:

- live odds are fresh, tradable, canonical, and provider-allowlisted;
- selected bookmaker/source/line provenance is captured;
- score/minute and odds conflict guards pass;
- `PROVIDER_FUSION_ODDS_PROMOTION=true`, allowlist, rollout, owner, and kill-switch posture are deliberately configured.

## 12. Rollback

Immediate safe rollback:

```text
PROVIDER_FUSION_ENABLED=false
PROVIDER_FUSION_SHADOW_ENABLED=false
PROVIDER_FUSION_STATS_EVENTS_PROMOTION=false
PROVIDER_FUSION_ODDS_SHADOW_ENABLED=false
PROVIDER_FUSION_ODDS_PROMOTION=false
PROVIDER_FUSION_KILL_SWITCH=true
SPORTMONKS_ENABLED=false
SPORTMONKS_SHADOW_ENABLED=false
```

Rollback acceptance:

- API-Football-only pipeline still runs;
- no Sportmonks calls occur;
- no odds-promotion save path is active;
- live no-odds stats-only push/no-save behavior remains intact.

## 13. PRD Readiness Summary Template

Use this template for each run:

```text
Run id:
Date/time:
Commit:
Flags:
Static gates:
Coverage:
API-Football real sample:
Sportmonks real sample:
Fusion shadow sample:
Real LLM Gateway smoke:
Official controlled live run:
Telemetry readiness:
Findings:
Fixes applied:
Residual risks:
Rollout recommendation:
```
