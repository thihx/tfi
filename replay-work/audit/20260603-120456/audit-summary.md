# TFI Football AI Recommendation Audit - Run Summary

**Run ID:** 20260603-120456  
**Started:** 2026-06-03 12:04 KST  
**Commit:** ed37322  
**Audit plan:** `docs/football-ai-recommendation-audit-plan.md`

## Environment Readiness

- `FOOTBALL_API_KEY`: configured
- `GEMINI_API_KEY`: configured
- Football API base URL: `https://v3.football.api-sports.io`
- Football daily limit setting: `7000`
- Gemini runtime model: `gemini-3.5-flash`
- Active live-analysis prompt env: default, resolves to official `v10-hybrid-legacy-g`
- Shadow prompt: disabled, sample rate `0`
- Pipeline min confidence: `7`
- Pipeline min odds: `1.5`
- Timezone: `Asia/Seoul`

## Phase 0 Baseline

Focused pipeline tests passed:

```text
npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts src/__tests__/recommendation-policy.test.ts src/__tests__/normalize-market.test.ts src/__tests__/odds-resolver.test.ts
4 files passed, 185 tests passed
```

CI replay gate baselines passed:

```text
npm run data-driven:verify-gates-ci --prefix packages/server
delta gates OK, segment gates OK, quality gates OK
```

Snapshot coverage:

```text
npm run data-driven:coverage --prefix packages/server -- --out-json ../../replay-work/audit/20260603-120456/coverage.json
```

Key numbers:

- 90-day `inWindow`: `1789`
- `actionableNotDup`: `1736`
- `settledActionable`: `1736`
- `exportEligible`: `1736`
- `replayReady`: `1736` / `1736`
- `emptyOddsSnapshot`: `0`
- `emptyStatsSnapshot`: `0`
- `emptyDecisionContext`: `530`
- Empty decision context among export-eligible rows: `30.53%`

Interpretation:

- Historical replay coverage is strong enough for audit.
- Legacy/older prompt cohorts have incomplete `decision_context`, so current-runtime quality should be separated from older historical cohorts when drawing conclusions.

## Phase 1 Static Boundary Scan

Provider call scan initially found one provider-boundary exception outside `football-api.ts`:

- `packages/server/src/lib/integration-health.ts` calls `${config.footballApiBaseUrl}/status` directly with `x-apisports-key`.

This was remediated during the audit run by adding `fetchFootballApiStatus()` to `packages/server/src/lib/football-api.ts` and routing integration health through that helper.

Verification:

```text
npm run test --prefix packages/server -- src/__tests__/integration-health.lib.test.ts src/__tests__/football-api.test.ts src/__tests__/football-api-quota.test.ts src/__tests__/football-api-circuit.test.ts
4 files passed, 57 tests passed

rg -n "footballApiBaseUrl|x-apisports-key" packages/server/src --glob '!packages/server/src/lib/football-api.ts'
No active runtime provider call sites remain outside football-api.ts; matches are config/test fixtures only.
```

No direct API-Football calls were found in active browser runtime code. Frontend fetches use internal backend routes.

## Phase 2 Provider Coverage Audit

Command:

```text
npm run provider:coverage-audit --prefix packages/server -- --lookback-days 180 --limit 500 --out-json ../../replay-work/audit/20260603-120456/provider-coverage-audit.json
npm run provider:coverage-audit --prefix packages/server -- --lookback-days 180 --limit 500 --fail-on-mismatch
```

Result:

- Samples audited: `191`
- OK: `191`
- Stored flag mismatches: `0`
- Recomputed flag mismatches: `0`
- Raw market exists without canonical tradable market: `45`
- Main reasons:
  - `raw_btts_present_but_not_canonical_tradable`: `44`
  - `raw_asian_handicap_present_but_not_canonical_tradable`: `1`

Interpretation:

- Stored provider flags are internally consistent with current recomputation.
- The system correctly distinguishes raw provider market presence from canonical tradable availability. This is an important guardrail and should not be collapsed.

## Phase 3 Real API-Football Sample

Artifact:

```text
replay-work/audit/20260603-120456/provider-samples/real-provider-samples.json
```

The first real-provider sampling run exceeded the shell timeout after writing the artifact. The saved report is usable.

Summary:

- Date: `2026-06-03`
- Timezone: `Asia/Seoul`
- Fixtures for date: `87`
- Selected samples: `3`
- Candidate counts:
  - live: `1`
  - near kickoff: `0`
  - finished: `2`

Sample observations:

- Live sample `1524703`, `Bangers vs Midlakes United`, status `2H`:
  - statistics teams: `0`
  - events: `0`
  - live odds raw: `0`
  - prematch odds raw: `0`
- Finished sample `1521145`, `Naft Gachsaran vs Be'sat Kermanshah`:
  - statistics teams: `0`
  - events: `0`
  - live odds raw: `0`
  - prematch odds raw: `1`
  - prematch canonical coverage: 1X2, O/U, AH, BTTS all true
- Finished sample `1546307`, `Gharraf vs Naft Maysan`:
  - statistics teams: `0`
  - events: `2`
  - live odds raw: `0`
  - prematch odds raw: `1`
  - prematch canonical coverage: 1X2, O/U, AH, BTTS all true

Interpretation:

- Real provider coverage varies per fixture even on the same date.
- The live sample had no usable live data beyond fixture status/score, which supports keeping evidence-mode and no-bet guards strict.
- Finished fixtures can still have prematch odds while live odds are empty; this reinforces the rule that prematch odds must remain `reference-prematch`, not live tradable odds.

## Phase 3B API-Football Documentation Cross-Check

Official docs reviewed:

```text
https://www.api-football.com/documentation-v3
https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide
https://www.api-football.com/news/post/fifa-world-cup-2026-guide-to-using-data-with-api-sports
```

Provider-doc findings relevant to TFI:

- `/fixtures/statistics` is updated every minute for live fixtures and officially lists basic match stats such as shots, possession, corners, cards, passes, and saves. Optional fields seen in real payloads, such as `expected_goals`, must stay treated as optional provider extras, not guaranteed inputs.
- `/fixtures/events` and live fixtures are updated around every 15 seconds. Current provider cache intervals should stay aligned with endpoint-specific cadence rather than overpolling all endpoints equally.
- `/odds/live` has no historical storage from the provider side. Replay quality therefore depends on TFI's own recorded odds snapshots; missing live odds cannot be reconstructed later from API-Football.
- `/odds` is pre-match/reference odds and has limited history. It must not be treated as a live tradable replacement when `/odds/live` is empty.
- `/fixtures?ids=` supports up to 20 fixture IDs and can include embedded events/lineups/statistics/player data. TFI already chunks `ensureFixturesForMatchIds()` into batches of 20 in `provider-insight-cache.ts`.
- API-Football warns that league coverage flags can vary by season and do not guarantee data on every match. This matches the real-provider sample where some fixtures returned zero stats/events/live odds.

Code alignment:

- Provider boundary is centralized through `packages/server/src/lib/football-api.ts`.
- Fixture batch fetches respect the 20-id documented limit through `fetchFixturesInChunks()`.
- Live odds are cached internally through `provider-odds-cache`; this is necessary because API-Football live odds have no provider-side history.
- Replay and policy audit should continue to prefer `recorded` odds and should treat `reference-prematch` as degraded/non-live evidence for in-play decisions.

Provider-doc improvement backlog:

- Use the bounded repeated provider sampler (`--iterations N --interval-ms MS`) for live-day runs that capture `/odds/live`, `/fixtures/events`, and `/fixtures/statistics` on active matches at provider-recommended cadences, then compare actual non-empty coverage against league coverage flags.
- Keep documenting skipped/empty provider payloads as expected integration states, not parser failures, unless the provider response has errors or malformed shape.

## Phase 4 Historical Replay And Real Gemini Smoke

Mock replay command:

```text
npm run data-driven:improvement-run --prefix packages/server
```

Run root:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T03-08-25-273Z
```

Key result:

- Scenarios: `18`
- Push count: `1`
- No-bet count: `17`
- Push rate: `5.56%`
- Single actionable market: `corners_under_6.5`
- Settled directional: `1`
- Win: `1`
- ROI on replay stake: `82.5%`

Interpretation:

- Current replay policy is highly conservative.
- One winning push is not enough to prove edge, but it shows the replay stack can produce actionable output when policy and canonical market pass.

Real Gemini full preset:

```text
npm run data-driven:improvement-run-real --prefix packages/server
```

This exceeded the shell timeout after creating partial artifacts:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T03-17-49-070Z
```

Partial useful evidence:

- Scenario export completed.
- `llm-cache` contains 9 real Gemini responses.
- Final summary was not produced due timeout.

Real Gemini small smoke:

```text
npm run data-driven:replay-batch --prefix packages/server -- --lookback-days 14 --limit 20 --max-scenarios 5 --llm real --allow-real-llm --delay-ms 300 --odds recorded --apply-replay-policy
```

Run root:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T03-22-52-162Z
```

Key result:

- Scenarios: `5`
- Push count: `0`
- No-bet count: `5`
- Provider coverage: `5/5 ok`
- Replay context: `5/5 ok`
- Quality attribution:
  - `model_no_bet`: `3`
  - `pre_llm_blocked`: `2`
- Original result distribution:
  - original wins: `2`
  - original losses: `2`
  - original half-loss: `1`
- Opportunity recall:
  - original wins missed: `2/2`
  - candidate rescue count: `0`

LLM-cache review:

- Gemini produced valid strict JSON.
- Gemini no-bet decisions were intentional, not parse failures.
- Gemini used prompt-provided advanced stats and performance memory; the apparent `xG` references were backed by `ADVANCED QUANT STATS.expected_goals`.

Interpretation:

- Small real-LLM smoke shows very conservative behavior.
- The missed original wins are not automatically a bug, because the sample is tiny and original recommendations can be bad or lucky.
- This does justify a larger controlled real-LLM recall/calibration audit before any prompt loosening.

Follow-up real Gemini chunk:

```text
npm run data-driven:replay-batch --prefix packages/server -- --lookback-days 14 --limit 40 --max-scenarios 10 --llm real --allow-real-llm --delay-ms 300 --odds recorded --apply-replay-policy
```

Run root:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T03-51-25-300Z
```

Key result:

- Scenarios: `10`
- Push count: `0`
- No-bet count: `10`
- Provider coverage: `10/10 ok`
- Replay context: `10/10 ok`
- Quality attribution:
  - `model_no_bet`: `5`
  - `pre_llm_blocked`: `4`
  - `hard_policy_gate`: `1`
- Original wins missed: `5/5`
- Candidate rescue count: `1`, blocked by line patience / hard post-parse policy.

Interpretation:

- The low-recall signal persisted at 10 scenarios.
- This is still not enough to loosen policy, but it is enough to prioritize a dedicated real-LLM recall/calibration audit across 30-50 cases.
- The one `hard_policy_gate` case should be reviewed manually because Gemini found a candidate market (`under_4.5`) but runtime guards blocked it.

Corrected multi-chunk real Gemini aggregate:

During chunking, the audit found that replay scenario evaluation was not preserving `_manifest.json` order when `--max-scenarios` was used. That bug is documented as `TFI-AUDIT-005` and fixed in this run. After the fix, the corrected aggregate is:

```text
replay-work/audit/20260603-120456/real-llm-aggregate.json
```

Source runs:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T04-38-56-521Z
packages/server/replay-work/data-driven-runs/2026-06-03T04-37-08-222Z
packages/server/replay-work/data-driven-runs/2026-06-03T04-15-00-372Z
packages/server/replay-work/data-driven-runs/2026-06-03T04-19-58-034Z
```

Key result:

- Cases: `35`
- Unique recommendation IDs: `35`
- Duplicate scenario names: `0`
- Push/actionable: `0`
- No-bet: `35`
- Provider coverage: `35/35 ok`
- Replay context: `35/35 ok`
- Original wins missed: `17/17`
- Original losses avoided: `13/13`
- Attribution:
  - `model_no_bet`: `27`
  - `pre_llm_blocked`: `4`
  - `hard_policy_gate`: `2`
  - `model_policy_mismatch`: `2`

Resolved candidate markets blocked by policy:

- `13398-1504825-67m-btts-yes`: Gemini selected `BTTS Yes @2.2`, original result `win`, blocked by thin-edge policy.
- `13395-1490320-80m-under-4-5`: Gemini selected `Under 4.5 Goals @2.025`, original result `win`, blocked by late under thin-cushion line/policy guards.
- `13381-1535217-61m-over-1-5`: Gemini selected `Over 1.5 Goals @1.55`, original result `win`, blocked by late-midgame over and thin-edge guards.
- `13375-1523156-77m-under-2-5`: Gemini selected `Under 2.5 Goals @1.7`, original result `loss`, blocked by thin-cushion/low-confidence guards.

Interpretation:

- This is no longer just a tiny-sample signal. The real-LLM stack is extremely conservative across 35 clean cases.
- The system avoided all original losers in this sample, which is valuable, but it also missed every original winner.
- Prompt or policy should not be loosened globally until the 17 missed original winners are classified as strong edge, thin/lucky, stale-line, or correct no-bet.

## Follow-up Implementation

Added a repeatable real-provider sampling script:

```text
npm run provider:real-sample --prefix packages/server -- --max-fixtures 1 --max-api-calls 4 --out-json ../../replay-work/audit/20260603-120456/provider-samples/real-provider-samples-script-smoke.json
```

Repeated live-day sampling mode:

```text
npm run provider:real-sample --prefix packages/server -- --max-fixtures 1 --max-api-calls 1 --iterations 2 --interval-ms 1 --no-stats --no-events --no-live-odds --no-prematch-odds --out-json ../../replay-work/audit/20260603-120456/provider-samples/real-provider-samples-iterations-smoke.json
```

Script:

```text
packages/server/src/scripts/audit-real-provider-samples.ts
```

Smoke result:

- API calls used: `4`
- Fixtures for date: `87`
- Selected fixtures: `1`
- Live sample: `Bangers vs Midlakes United`, status `2H`
- Stats/events/live odds returned successfully but with zero rows.
- Prematch odds was skipped by API-call budget, proving budget enforcement.

Repeated-mode smoke result:

- Iterations requested: `2`
- API calls used: `1`
- Iteration 1 fetched the fixture list and selected one live sample.
- Iteration 2 was skipped by the shared API-call budget, proving the budget applies across all iterations.

Live-day repeated sample:

```text
npm run provider:real-sample --prefix packages/server -- --max-fixtures 1 --max-api-calls 24 --iterations 6 --interval-ms 60000 --no-near --no-finished --no-prematch-odds --out-json ../../replay-work/audit/20260603-120456/provider-samples/real-provider-samples-live-day-6x60s.json
```

Artifact:

```text
replay-work/audit/20260603-120456/provider-samples/real-provider-samples-live-day-6x60s.json
```

Live-day result:

- API calls used: `24`
- Iterations: `6`
- Selected live samples: `6`
- Live fixture candidates changed from `5` to `4` across the run.
- Non-empty statistics: `0/6`
- Non-empty events: `6/6`
- Raw live odds: `6/6`
- Canonical tradable live odds, any market: `4/6`
- Canonical 1X2: `3/6`
- Canonical O/U: `2/6`
- Canonical AH: `2/6`
- Canonical BTTS: `1/6`

Provider interpretation:

- Live odds can be present at the raw provider level while the canonical tradable market set shrinks rapidly late in a match.
- In the tracked Portugal U19 vs Kazakhstan U19 fixture, live odds moved from 9 priced bets to 2 priced bets, then to 0 priced bets across five one-minute samples in stoppage time.
- Statistics stayed empty in every live sample even though events and odds were available, reinforcing that API-Football coverage should be treated endpoint-by-endpoint and fixture-by-fixture.
- This supports keeping evidence-mode guards strict: a live market can be considered only when the canonical odds snapshot for that exact market/line is present in the current tick.

Added replay audit chunking support:

- `data-driven:replay-batch` now accepts `--offset`.
- `run-spec.json` and scenario `_manifest.json` record the offset.
- `_manifest.json` order is preserved by `listReplayScenarioJsonBasenames()` so `--max-scenarios` caps the intended cohort.

Verification:

```text
npm run test --prefix packages/server -- src/__tests__/replay-scenario-files.test.ts
npm run typecheck --prefix packages/server
```

Added runtime policy-shadow telemetry for replay-backed pockets:

- New classifier: `packages/server/src/lib/runtime-policy-shadow.ts`
- Pipeline integration: `PIPELINE_POLICY_SHADOW_CANDIDATE` audit events on matched policy-blocked pockets.
- Debug payload: `debug.runtimePolicyShadow`
- Scope: strict BTTS Yes clean-context, late Under 4.5, and Over 1.5 replay pockets.
- Safety: telemetry only; it does not change `final_should_bet`, `shouldSave`, `shouldNotify`, recommendation persistence, or delivery staging.
- Shadow report: `npm run data-driven:policy-shadow-report` aggregates live shadow audit events by pocket, canonical market, minute band, score state, and market availability bucket.
- Shadow settlement report: `npm run data-driven:policy-shadow-settlement` joins shadow audit events to `matches_history`, settles supported markets using deterministic rules only, and calculates shadow P/L without writing any rows or calling Gemini.
- Shadow audit suite: `npm run data-driven:policy-shadow-suite` writes matched, skipped-neighbor, matched-settlement, skipped-settlement reports plus `manifest.json` in one output folder.

Initial runtime shadow report:

```text
npm run data-driven:policy-shadow-report --prefix packages/server -- --lookback-days 14 --max-rows 1000 --out-json ../../replay-work/audit/20260603-120456/runtime-policy-shadow-report.json --out-md ../../replay-work/audit/20260603-120456/runtime-policy-shadow-report.md
```

Result:

- Shadow audit events: `0`
- Pocket matches: `0`
- Unique matches: `0`

Interpretation: expected baseline because runtime policy-shadow telemetry was just introduced; rerun after live pipeline cycles and settlement windows accumulate.

Initial runtime shadow skipped-neighbor report:

```text
npm run data-driven:policy-shadow-skipped-report --prefix packages/server -- --lookback-days 14 --max-rows 1000 --out-json ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-report.json --out-md ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-report.md
```

Result:

- Skipped shadow audit events: `0`
- Unique matches: `0`

Interpretation: expected baseline because `PIPELINE_POLICY_SHADOW_SKIPPED` telemetry was just introduced. This report is meant to review policy-blocked model selections that missed configured pockets, such as low-price BTTS, late Over 1.5 after minute 75, late Under 2.5 level-score candidates, or non-clean BTTS contexts.

Initial runtime shadow skipped-neighbor settlement report:

```text
npm run data-driven:policy-shadow-skipped-settlement --prefix packages/server -- --lookback-days 30 --max-rows 1000 --stake-percent 1 --out-json ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-report.json --out-md ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-report.md
```

Result:

- Skipped shadow audit events: `0`
- Settled rows: `0`
- Unresolved rows: `0`
- Wins / losses / push-like: `0 / 0 / 0`
- Counterfactual P/L at 1% stake: `0`

Interpretation: expected baseline because skipped-neighbor telemetry was just introduced. Once events accumulate, this report quantifies whether excluded neighbor candidates were mostly policy-saved losses or missed winners before any new pocket definition is considered.

Runtime shadow skipped-neighbor settlement gate:

```text
npm run data-driven:check-policy-shadow-skipped-settlement-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-gates-baseline.json
```

Result:

- `total=0`
- `settled=0`
- `unresolved=0`
- `losses=0`
- `pnl=0`
- `roi=0`
- gate status: `OK`

Interpretation: this baseline gate proves the skipped-neighbor settlement gate plumbing works on the current zero-event artifact. It is not evidence for adding a new pocket. The example gate requires non-trivial sample size, settled-rate, bounded losses, P/L, ROI, and optional required market/skipped-reason thresholds.

Runtime shadow audit suite:

```text
npm run data-driven:policy-shadow-suite --prefix packages/server -- --lookback-days 14 --settlement-lookback-days 30 --max-rows 1000 --stake-percent 1 --out-dir ../../replay-work/audit/20260603-120456/runtime-policy-shadow-suite
```

Artifact folder:

```text
replay-work/audit/20260603-120456/runtime-policy-shadow-suite/
```

Manifest summary:

- matched events: `0`
- matched settled rows: `0`
- matched P/L: `0`
- skipped events: `0`
- skipped settled rows: `0`
- skipped P/L: `0`

Interpretation: the suite is the preferred periodic operator entrypoint once telemetry has been live for a while. The current zero-event result is expected and confirms bundle generation only.

Initial runtime shadow settlement report:

```text
npm run data-driven:policy-shadow-settlement --prefix packages/server -- --lookback-days 30 --max-rows 1000 --out-json ../../replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-report.json --out-md ../../replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-report.md
```

Result:

- Shadow audit events: `0`
- Pocket rows: `0`
- Settled rows: `0`
- Shadow P/L: `0`

Interpretation: expected baseline until runtime shadow events exist and their matches are archived in `matches_history`.

Runtime shadow settlement gate:

```text
npm run data-driven:check-policy-shadow-settlement-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-gates-baseline.json
```

Result:

- `total=0`
- `settled=0`
- `unresolved=0`
- `losses=0`
- `pnl=0`
- `roi=0`
- gate status: `OK`

Interpretation: this baseline gate proves the new CLI/config/report plumbing works on the current zero-event artifact. It is not promotion evidence. The production-promotion example config requires non-trivial sample size, settled-rate, loss, P/L, ROI, and required-pocket thresholds before any pocket can be considered for policy relaxation.

Verification:

```text
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow.test.ts src/lib/__tests__/replay-policy-experiment.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-report.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-skipped-report.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-skipped-settlement-report.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-skipped-settlement-gates.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-settlement-report.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-settlement-gates.test.ts
npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts
npm run typecheck --prefix packages/server
```

## Initial Findings

See `findings.json` for machine-readable findings.

Summary:

1. `TFI-AUDIT-001` - Provider health probe bypasses centralized provider boundary. Fixed in this run.
2. `TFI-AUDIT-002` - Corrected real Gemini cohorts show zero actionable output; strict replay-backed policy pockets are now observable through runtime shadow telemetry only.
3. `TFI-AUDIT-003` - Legacy cohorts have missing decision context.
4. `TFI-AUDIT-004` - Real provider sample confirms sparse live data for some fixtures.
5. `TFI-AUDIT-005` - Replay evaluator sorted manifest scenarios alphabetically, causing chunk/cap sampling drift. Fixed in this run.
6. `TFI-AUDIT-006` - `MARKET_UNRESOLVED` conflated intentional no-bets with true resolver failures. Fixed in diagnostics-v2.
7. `TFI-AUDIT-007` - Recent saved recommendations still use retired prompt `v10-hybrid-legacy-b`; investigate deployment/runtime prompt adoption before using production deltas as current prompt evidence.
8. `TFI-AUDIT-008` - API-Football docs confirm live odds must be cached internally and prematch odds must remain degraded/reference evidence for in-play decisions; repeated provider sampling now shows live endpoint availability is endpoint-specific and changes within minutes.

## Case-Level Review

Case-level review completed:

```text
replay-work/audit/20260603-120456/missed-winner-case-review.md
replay-work/audit/20260603-120456/case-review-source.json
```

Outcome:

- Strong calibration candidates: `3` (`13398`, `13395`, `13381`)
- Moderate review candidates: `3` (`13402`, `13367`, `13370`)
- Correct no-bet / thin-lucky historical winners: `9`
- Evidence-limited no-bets: `2`
- Policy-saved loss: `1` (`13375`)

## Replay Metrics

Replay metrics implemented and aggregate reports regenerated:

```text
replay-work/audit/20260603-120456/real-llm-aggregate-eval-cases.json
replay-work/audit/20260603-120456/real-llm-aggregate-replay-vs-original.json
replay-work/audit/20260603-120456/real-llm-aggregate-segment-hotspots.json
replay-work/audit/20260603-120456/real-llm-aggregate-action-plan.json
replay-work/audit/20260603-120456/real-llm-aggregate-cases-flat.csv
```

New metrics:

- `replay-vs-original.json` now reports `opportunityTradeoff`.
- `segment-action-plan.json` now reports `qualityBlockers.modelSelectedPolicyBlocked`.
- `opportunityRecall` now includes original-loss avoidance in addition to original-win misses.

Aggregate output:

- Directional original winners missed: `18/18`
- Directional original losers avoided: `15/15`
- Model-selected-policy-blocked: `4`
- Candidate rescue examples: `3`
- Policy-saved loss example: `1`

## Replay Policy Experiment

Replay-only experiment completed:

```text
replay-work/audit/20260603-120456/real-llm-policy-experiment.json
```

Experiment result:

- Trusted policy-blocked counterfactual candidates: `4`
- Configured pocket selections: `3`
- Skipped policy-saved loss: `13375` (`under_2.5`) because it is not one of the configured candidate pockets.
- Combined simulated stake: `3%`
- Combined simulated PnL: `+2.775%`
- ROI on simulated stake: `92.5%`
- Original wins rescued: `3`
- Original losses reintroduced: `0`

Per pocket:

- BTTS Yes 60-74 two-plus margin: `1/1` win, `+1.2%` PnL at `1%` stake.
- Late Under 4.5 75+ two-plus margin: `1/1` win, `+1.025%` PnL at `1%` stake.
- Over 1.5 60-74 one-goal margin: `1/1` win, `+0.55%` PnL at `1%` stake.

Interpretation:

- The experiment supports further investigation of these three narrow pockets.
- The sample is only three selected cases, so this is not enough for production loosening.
- The counterfactual is trusted only where replay-selected market equals original market.

## Expanded Real-LLM Validation

The three candidate pockets were validated on an expanded real-Gemini cohort without changing production policy.

Expanded artifacts:

```text
replay-work/audit/20260603-120456/real-llm-expanded-eval-cases.json
replay-work/audit/20260603-120456/real-llm-expanded-replay-vs-original.json
replay-work/audit/20260603-120456/real-llm-expanded-segment-hotspots.json
replay-work/audit/20260603-120456/real-llm-expanded-action-plan.json
replay-work/audit/20260603-120456/real-llm-expanded-policy-experiment.json
replay-work/audit/20260603-120456/real-llm-expanded-cases-flat.csv
```

Additional source runs:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T06-22-06-503Z
packages/server/replay-work/data-driven-runs/2026-06-03T06-25-07-353Z
```

Expanded cohort:

- Cases: `54`
- Unique recommendation IDs: `54`
- Source runs: `6`
- Prompt version: `v10-hybrid-legacy-g`
- Push/actionable: `0`
- No-bet: `54`
- Provider coverage: `54/54 ok`
- Replay context: `54/54 ok`
- Original result distribution: `28 win`, `1 half_win`, `20 loss`, `2 half_loss`, `3 push`
- Directional original winners missed: `29/29`
- Directional original losers avoided: `22/22`
- Attribution:
  - `model_no_bet`: `38`
  - `pre_llm_blocked`: `12`
  - `hard_policy_gate`: `2`
  - `model_policy_mismatch`: `2`

Expanded policy experiment:

- Trusted policy-blocked counterfactual candidates: `4`
- Configured pocket selections: `3`
- Skipped policy-saved loss: `13375` (`under_2.5`) because it is outside the configured pockets.
- Combined simulated stake: `3%`
- Combined simulated PnL: `+2.775%`
- ROI on simulated stake: `92.5%`
- Original wins rescued: `3`
- Original losses reintroduced: `0`

Interpretation:

- The expanded cohort did not add new policy-blocked rescue pockets.
- It also did not add a counterexample against the three configured replay-only pockets.
- The safety side remains strong: the replay stack avoided all 22 directional historical losers.
- The recall side remains too strict: it missed all 29 directional historical winners.
- Production policy should still not be loosened globally. The safe implementation path is shadow/replay-only tracking for these pockets with explicit gates.

Shadow/replay-only gate implementation:

- `npm run data-driven:check-policy-experiment-gates`
- `packages/server/src/lib/replay-policy-experiment-gates.ts`
- `packages/server/src/scripts/check-replay-policy-experiment-gates.ts`
- `packages/server/replay-policy-experiment-gates.example.json`
- `replay-work/audit/20260603-120456/real-llm-expanded-policy-experiment-gates.json`

The gate checks cohort size, trusted counterfactual count, selected pocket count, ROI/PnL, required pocket coverage, and whether the experiment reintroduces any historical losers.

Verification:

```powershell
npm run test --prefix packages/server -- src/lib/__tests__/replay-policy-experiment-gates.test.ts src/lib/__tests__/replay-policy-experiment.test.ts
npm run typecheck --prefix packages/server
npm run data-driven:check-policy-experiment-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-expanded-policy-experiment-gates.json
```

Gate result: `total=54`, `trusted=4`, `selected=3`, `losses=0`, `pnl=2.7750`, `roi=0.9250`, `rescued=3`, `reintroduced=0`, `OK`.

## 74-Case Older-Cohort Extension

Two additional real-Gemini chunks were run against an older 90-day cohort:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T06-55-43-535Z
packages/server/replay-work/data-driven-runs/2026-06-03T07-02-53-718Z
```

Both shell commands hit the local timeout after writing complete artifacts. Each run produced `10` evaluated cases and `0` actionable recommendations.

To make multi-run evidence repeatable, an eval-case aggregator was added:

```text
npm run data-driven:aggregate-cases
packages/server/src/lib/eval-cases-aggregate.ts
packages/server/src/scripts/aggregate-eval-cases.ts
```

74-case artifacts:

```text
replay-work/audit/20260603-120456/real-llm-74-eval-cases.json
replay-work/audit/20260603-120456/real-llm-74-replay-vs-original.json
replay-work/audit/20260603-120456/real-llm-74-segment-hotspots.json
replay-work/audit/20260603-120456/real-llm-74-action-plan.json
replay-work/audit/20260603-120456/real-llm-74-policy-experiment.json
replay-work/audit/20260603-120456/real-llm-74-policy-experiment-gates.json
replay-work/audit/20260603-120456/real-llm-74-cases-flat.csv
```

Aggregate result:

- Cases: `74`
- Source runs: `8`
- Duplicate scenario names: `0`
- Push/actionable: `0`
- No-bet: `74`
- Provider coverage: `74/74 ok`
- Replay context: `73/74 ok`, `1/74 replay_memory_missing`
- Original result distribution: `37 win`, `1 half_win`, `31 loss`, `2 half_loss`, `3 push`
- Directional original winners missed: `38/38`
- Directional original losers avoided: `33/33`
- Attribution:
  - `model_no_bet`: `56`
  - `pre_llm_blocked`: `13`
  - `model_policy_mismatch`: `3`
  - `hard_policy_gate`: `2`

Policy-blocked model selections:

- Total: `5`
- Original winners: `3`
- Original losses: `2`
- New older-cohort case: `13328-1492598-70m-over-2-75`; Gemini selected `Corners Over 8.5 @1.775`, original market was `over_2.75`, original result `loss`, and replay context had `replay_memory_missing`. This is not a trusted rescue because replay and original markets differ, and it reinforces keeping global policy strict.

74-case policy experiment:

- Trusted policy-blocked counterfactual candidates: `4`
- Configured pocket selections: `3`
- Skipped policy-saved losses: `2` total policy-blocked losses, with `13375` as trusted-but-outside-pocket and `13328` untrusted due market mismatch.
- Combined simulated stake: `3%`
- Combined simulated PnL: `+2.775%`
- ROI on simulated stake: `92.5%`
- Original wins rescued: `3`
- Original losses reintroduced: `0`

Verification:

```powershell
npm run test --prefix packages/server -- src/lib/__tests__/eval-cases-aggregate.test.ts src/lib/__tests__/replay-policy-experiment-gates.test.ts src/lib/__tests__/replay-policy-experiment.test.ts
npm run typecheck --prefix packages/server
npm run data-driven:check-policy-experiment-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-74-policy-experiment-gates.json
```

Gate result: `total=74`, `trusted=4`, `selected=3`, `losses=0`, `pnl=2.7750`, `roi=0.9250`, `rescued=3`, `reintroduced=0`, `OK`.

Interpretation:

- The larger cohort strengthens the conclusion that current real-Gemini plus policy is extremely conservative.
- The additional older cases added no new rescue pocket and added one extra policy-blocked loser that should stay blocked.
- The three candidate pockets remain plausible but rare. They are suitable for shadow tracking, not production policy loosening.

## 74-Case Root Cause Review

Case-level root cause review completed:

```text
replay-work/audit/20260603-120456/real-llm-74-case-review.md
```

Main conclusions:

- `MARKET_UNRESOLVED` is misleading in the 74-case report: all `55/55` rows with that warning had empty replay selection, so this is not evidence of broad canonical market resolver failure.
- Representative `llm-cache` entries show intentional no-bets with concrete reasons: exposure stacking, low odds, red cards, danger-zone score/minute state, or weak shot quality.
- `pre_llm_blocked` covers `13` degraded-evidence cases: `8` original wins missed and `5` original losses avoided. This is not safe to open globally.
- The new policy-blocked case `13328` is a policy-saved loss with market drift (`Corners Over 8.5` selected while original was Goals Over 2.75) and missing replay memory.
- Case `13350` has empty diagnostic fields and no LLM cache in the source runs; this should be treated as a replay diagnostics gap.

Next engineering improvement:

1. Split `MARKET_UNRESOLVED` into `NO_MARKET_REQUESTED_MODEL_NO_BET` and `MARKET_UNRESOLVED_AFTER_SELECTION`.
2. Add a quality gate for empty `llmDecisionDiagnostic` / `marketResolutionStatus`.
3. Recompute the 74-case action-plan after diagnostics cleanup.

Diagnostics cleanup implemented:

```text
npm run data-driven:normalize-diagnostics
packages/server/src/lib/settled-replay-evaluation.ts
packages/server/src/scripts/normalize-eval-case-diagnostics.ts
packages/server/src/lib/data-driven-quality-gates.ts
```

Diagnostics-v2 artifacts:

```text
replay-work/audit/20260603-120456/real-llm-74-eval-cases-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-74-replay-vs-original-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-74-segment-hotspots-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-74-action-plan-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-74-policy-experiment-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-74-quality-gates-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-74-policy-experiment-gates-diagnostics-v2.json
```

Diagnostics-v2 result:

- `MARKET_UNRESOLVED`: `0`
- `NO_MARKET_REQUESTED_MODEL_NO_BET`: `55`
- `llmDecisionDiagnostic`: `56 no_bet_intentional`, `13 pre_llm_blocked`, `5 policy_blocked`, `0 empty`
- `marketResolutionStatus`: `69 not_requested`, `5 resolved`, `0 empty`
- Quality gate: `OK`
- Policy experiment gate: unchanged and `OK`

Verification:

```powershell
npm run test --prefix packages/server -- src/__tests__/settled-replay-evaluation.test.ts src/lib/__tests__/data-driven-quality-gates.test.ts src/lib/__tests__/segment-policy-action-plan.test.ts src/lib/__tests__/replay-policy-experiment.test.ts src/lib/__tests__/replay-policy-experiment-gates.test.ts
npm run typecheck --prefix packages/server
npm run data-driven:check-quality-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-74-quality-gates-diagnostics-v2.json
npm run data-driven:check-policy-experiment-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-74-policy-experiment-gates-diagnostics-v2.json
```

## 94-Case Real-LLM Extension

Two more older-cohort real-Gemini chunks were run and aggregated with the cleaned diagnostics-v2 pipeline:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T08-02-30-661Z
packages/server/replay-work/data-driven-runs/2026-06-03T08-07-30-584Z
```

94-case diagnostics-v2 artifacts:

```text
replay-work/audit/20260603-120456/real-llm-94-eval-cases-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-replay-vs-original-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-segment-hotspots-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-action-plan-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-policy-experiment-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-quality-gates-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-policy-experiment-gates-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-cases-flat-diagnostics-v2.csv
```

Aggregate result:

- Cases: `94`
- Source runs: `10`
- Duplicate scenario names: `0`
- Push/actionable: `0`
- No-bet: `94`
- Provider coverage: `94/94 ok`
- Diagnostics: `0` empty `llmDecisionDiagnostic`, `0` empty `marketResolutionStatus`
- Original result distribution: `46 win`, `2 half_win`, `39 loss`, `3 half_loss`, `4 push`
- Directional original winners missed: `48/48`
- Directional original losers avoided: `42/42`
- Attribution: `74 model_no_bet`, `13 pre_llm_blocked`, `4 model_policy_mismatch`, `3 hard_policy_gate`
- Market resolution: `87 not_requested`, `7 resolved`

Policy-blocked model selections:

- Total: `7`
- Original winners: `5`
- Original losses: `2`
- Trusted counterfactual candidates: `6`
- Configured shadow-pocket selections: `3`
- Skipped trusted/outside-pocket winners: `13307-1521548-61m-btts-yes` (`BTTS Yes @1.7`) and `13297-1536947-79m-over-1-5` (`Over 1.5 @2.00`)
- Skipped trusted/outside-pocket loss: `13375-1523156-77m-under-2-5` (`Under 2.5 @1.7`)
- Untrusted policy-saved loss remains `13328-1492598-70m-over-2-75` because replay selected `Corners Over 8.5` while original was goals over and replay memory was missing.

94-case policy experiment:

- Selected pockets: `3`
- Combined simulated stake: `3%`
- Combined simulated PnL: `+2.775%`
- ROI on simulated stake: `92.5%`
- Original wins rescued: `3`
- Original losses reintroduced: `0`

Gate verification:

```powershell
npm run data-driven:check-quality-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-94-quality-gates-diagnostics-v2.json
npm run data-driven:check-policy-experiment-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-94-policy-experiment-gates-diagnostics-v2.json
```

Gate result:

```text
quality: total=94 providerCoverage=0/94 replayContextGap=0/94 hardPolicyGate=3/94 modelPolicyMismatch=4/94 emptyDiagnostic=0/94 emptyMarketResolution=0/94 OK
policy experiment: total=94 trusted=6 selected=3 losses=0 pnl=2.7750 roi=0.9250 rescued=3 reintroduced=0 OK
```

The policy experiment gate was tightened after the 94-case run. Required pocket rules now support and use pocket-level:

- `minWinCount`
- `minOriginalWinsRescued`
- `minTotalPnlPercent`
- `minRoiOnStaked`
- `maxLossCount`
- `maxOriginalLossesReintroduced`

The stricter 94-case gate still passes, which means each of the three configured pockets individually has at least one rescued win, positive PnL/ROI above the configured floor, and zero reintroduced historical losses.

Interpretation:

- The 94-case extension strengthens the conservative-recall finding: real Gemini plus current policy still emits no actionable recommendations.
- The three existing shadow pockets still have no counterexample, but they remain rare and should not be promoted directly to production policy.
- The two new winning policy-blocked cases are useful review material, but they are outside the current pocket definitions and do not justify global loosening.
- Next work should graduate from broad recall inspection to controlled shadow cohorts with explicit inclusion/exclusion gates per pocket.

## 114-Case Real-LLM Extension

Two additional older-cohort real-Gemini chunks were run and aggregated into the diagnostics-v2 cohort:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T10-11-57-217Z
packages/server/replay-work/data-driven-runs/2026-06-03T10-16-59-696Z
```

114-case diagnostics-v2 artifacts:

```text
replay-work/audit/20260603-120456/real-llm-114-eval-cases-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-replay-vs-original-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-segment-hotspots-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-action-plan-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-policy-experiment-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-quality-gates-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-policy-experiment-gates-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-cases-flat-diagnostics-v2.csv
```

Aggregate result:

- Cases: `114`
- Source runs: `12`
- Push/actionable: `0`
- No-bet: `114`
- Provider coverage: `114/114 ok`
- Replay context: `111 ok`, `3 replay_memory_missing`
- Diagnostics: `0` empty `llmDecisionDiagnostic`, `0` empty `marketResolutionStatus`
- Original result distribution: `51 win`, `2 half_win`, `52 loss`, `5 half_loss`, `4 push`
- Directional original winners missed: `53/53`
- Directional original losers avoided: `57/57`
- Attribution: `91 model_no_bet`, `13 pre_llm_blocked`, `5 hard_policy_gate`, `5 model_policy_mismatch`
- LLM decision diagnostics: `91 no_bet_intentional`, `13 pre_llm_blocked`, `10 policy_blocked`
- Market resolution: `104 not_requested`, `10 resolved`

Policy-blocked model selections:

- Total: `10`
- Original winners: `5`
- Original losses: `5`
- Trusted counterfactual candidates: `7`
- Configured shadow-pocket selections: `4`
- Candidate rescue examples still identified: `13398` BTTS Yes, `13395` late Under 4.5, and `13381` Over 1.5.
- New counterexample inside the configured BTTS pocket: `13295-1536946-70m-btts-yes`, Gemini selected `BTTS Yes @2.2`, original result `loss`.
- Additional policy-saved losses outside configured safe pockets include late Under 2.5, AH/corners market drift, and early AH mismatch cases.

114-case policy experiment:

- Selected pockets: `4`
- Combined simulated stake: `4%`
- Combined simulated PnL: `+1.775%`
- ROI on simulated stake: `44.38%`
- Original wins rescued: `3`
- Original losses reintroduced: `1`
- BTTS Yes 60-74 two-plus pocket: `2` selections, `1` win, `1` loss, `+0.2%` PnL, `10%` ROI.
- Late Under 4.5 and Over 1.5 pockets remained positive in this cohort, but each still has only one selected case.

Gate verification:

```powershell
npm run data-driven:check-quality-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-114-quality-gates-diagnostics-v2.json
npm run data-driven:check-policy-experiment-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-114-policy-experiment-gates-diagnostics-v2.json
```

Gate result:

```text
quality: total=114 providerCoverage=0/114 replayContextGap=0/114 hardPolicyGate=5/114 modelPolicyMismatch=5/114 emptyDiagnostic=0/114 emptyMarketResolution=0/114 OK
policy promotion gate: FAILED as expected because combined lossCount=1, originalLossesReintroduced=1, and btts_yes_60_74_two_plus violated pocket-level loss/PnL/ROI gates.
```

Interpretation:

- The 114-case extension strengthens the main recall finding: real Gemini plus current policy still emits no actionable recommendations.
- It also weakens the earlier BTTS pocket hypothesis. The exact BTTS Yes 60-74 two-plus pocket now contains both a rescued winner and a reintroduced loser, so it should not be promoted.
- Production policy should remain globally strict. Any future relaxation must be narrower than the current BTTS pocket and must include stronger pressure/shot-quality/context filters.
- The next shadow work should split the pocket hypotheses: keep late Under 4.5 and Over 1.5 under observation, redesign BTTS Yes inclusion criteria, and require larger official-prompt/current-runtime settled coverage before production changes.

Strict BTTS follow-up:

The replay-only BTTS experiment was tightened to require a cleaner context:

- `prematchStrength = strong`
- `marketAvailabilityBucket = totals_only`
- existing BTTS constraints unchanged: `60-74`, `two-plus-margin`, `full_live_data`, odds `>= 2.05`, resolved policy-blocked model selection.

This keeps the winning `13398` candidate and excludes the losing `13295` candidate from the configured pocket while still listing `13295` as a skipped trusted policy-blocked selection for audit visibility.

The policy-experiment report now writes explicit skip reasons for trusted policy-blocked selections. In the 114-case strict report:

- `13375` is excluded because it is `Under 2.5` at a late level score, not the `Under 4.5` two-plus-margin pocket.
- `13297` is excluded because it is `Over 1.5` at minute band `75+`, outside the `60-74` Over pocket.
- `13307` is excluded because BTTS Yes odds are `1.70`, below the strict BTTS price floor.
- `13295` is excluded because BTTS context is `prematchStrength=moderate` and `marketAvailabilityBucket=playable_side_market`, not the clean BTTS context.
- Skipped rows now include `minute`, `score`, `originalResult`, parsed `odds`, policy attribution, LLM diagnostic, and warnings so risk-neighbor review can be done from the policy-experiment artifact alone.

Artifacts:

```text
replay-work/audit/20260603-120456/real-llm-114-policy-experiment-strict-btts.json
replay-work/audit/20260603-120456/real-llm-114-policy-experiment-gates-strict-btts.json
```

Strict-BTTS gate result:

```text
policy experiment strict-btts: total=114 trusted=7 selected=3 losses=0 pnl=2.7750 roi=0.9250 rescued=3 reintroduced=0 OK
```

Implementation/test:

```text
packages/server/src/lib/replay-policy-experiment.ts
packages/server/src/lib/__tests__/replay-policy-experiment.test.ts
```

Interpretation of strict-BTTS follow-up:

- The stricter BTTS shadow definition is a better replay hypothesis than the broad one.
- It is still based on one selected BTTS winner in this cohort, so it remains shadow-only.
- The broad BTTS failure should remain in the audit record because it proves why the added filters matter.

## Current-Runtime Coverage View

`TFI-AUDIT-003` remediation has been implemented in the DB snapshot coverage report.

Change:

- `RecommendationSnapshotCoverageReport` now includes a `currentRuntime` block.
- `currentRuntime.officialPromptVersion` is sourced from the canonical `LIVE_ANALYSIS_PROMPT_VERSION`.
- `currentRuntime.amongExportEligible.currentRuntimeReady` counts export-eligible rows with official prompt `v10-hybrid-legacy-g` and non-empty `decision_context`.
- The report separates `official_current_runtime`, `official_current_missing_decision_context`, `non_official_prompt_version`, and `empty_prompt_version` cohorts.

Files:

```text
packages/server/src/lib/recommendation-snapshot-coverage.ts
packages/server/src/lib/recommendation-snapshot-coverage-gates.ts
packages/server/src/__tests__/recommendation-snapshot-coverage.test.ts
packages/server/src/lib/__tests__/recommendation-snapshot-coverage-gates.test.ts
packages/server/src/scripts/check-recommendation-snapshot-coverage-gates.ts
packages/server/src/scripts/README.md
packages/server/recommendation-snapshot-coverage-gates.example.json
```

Verification:

```powershell
npm run test --prefix packages/server -- src/__tests__/recommendation-snapshot-coverage.test.ts src/lib/__tests__/recommendation-snapshot-coverage-gates.test.ts
npm run typecheck --prefix packages/server
```

DB coverage was then regenerated with the new field:

```powershell
npm run data-driven:coverage --prefix packages/server -- --lookback-days 90 --out-json ../../replay-work/audit/20260603-120456/coverage-current-runtime.json
npm run data-driven:coverage --prefix packages/server -- --lookback-days 365 --out-json ../../replay-work/audit/20260603-120456/coverage-current-runtime-365d.json
```

90-day result:

- Export eligible: `1736`
- Official prompt: `0`
- Current-runtime ready: `0`
- Non-official prompt version: `1620`
- Empty prompt version: `116`
- Empty decision context: `530` (`30.53%`)

365-day result:

- Export eligible: `2748`
- Official prompt: `0`
- Current-runtime ready: `0`
- Non-official prompt version: `1620`
- Empty prompt version: `1128`
- Empty decision context: `1542` (`56.11%`)

Interpretation:

- The current DB has no settled export-eligible cohort for the official prompt `v10-hybrid-legacy-g` in either the 90-day or 365-day coverage windows.
- Historical production rows remain useful for replay counterfactuals and policy stress-testing, but they cannot directly prove production quality of the current official prompt.
- Until current official-prompt rows accumulate and settle, prompt/policy tuning should use shadow replay gates rather than settled-production deltas alone.
- Checked config/stamping path: `.env.azure`, `.env.azure.example`, and `packages/server/.env.example` all point active prompt to `v10-hybrid-legacy-g` or the default. `server-pipeline` resolves invalid/retired env values through `isLiveAnalysisPromptVersion` and falls back to `LIVE_ANALYSIS_PROMPT_VERSION`.
- Added a regression test proving `LIVE_ANALYSIS_ACTIVE_PROMPT_VERSION=v10-hybrid-legacy-b` still saves `prompt_version=v10-hybrid-legacy-g`. This makes `TFI-AUDIT-007` most likely a data-settle/deployment observation, not a current code-path stamping bug.

Recent prompt adoption report:

```powershell
npm run data-driven:prompt-adoption --prefix packages/server -- --lookback-days 14 --max-recent-rows 50 --out-json ../../replay-work/audit/20260603-120456/prompt-adoption-14d.json --out-md ../../replay-work/audit/20260603-120456/prompt-adoption-14d.md
```

14-day result:

- Total rows: `15`
- Actionable rows: `15`
- First row at: `2026-05-21T13:43:35.010Z`
- Latest row at: `2026-05-25T02:59:20.806Z`
- Latest row age: `225.81` hours
- Official prompt rows: `0`
- Latest official prompt row: `(none)`
- Official prompt with decision context: `0`
- Non-official prompt rows: `15`
- Latest non-official prompt row at: `2026-05-25T02:59:20.806Z`
- Empty prompt-version rows: `0`
- Empty decision context rows: `0`
- By prompt version: `v10-hybrid-legacy-b` = `15/15`, with decision context `15/15`, settled `15/15`

Updated interpretation:

- `TFI-AUDIT-007` is not only a settled export lag. Recent saved recommendation rows still use retired prompt `v10-hybrid-legacy-b` even though the official runtime prompt is `v10-hybrid-legacy-g`.
- The latest saved recommendation in this 14-day window is already stale by `225.81` hours, so the next investigation should verify both live-writer/job liveness and deployed prompt adoption.
- Because the current code path has a fallback regression test, the next investigation should verify the deployed container/image, runtime env, scheduler/job path, and whether the live recommendation writer in production is actually running the current server code.
- Prompt/policy quality conclusions for `v10-hybrid-legacy-g` should continue to come from replay and shadow artifacts until production adoption is confirmed.

Pipeline liveness report:

```powershell
npm run data-driven:pipeline-liveness --prefix packages/server -- --lookback-hours 336 --max-recent-rows 25 --out-json ../../replay-work/audit/20260603-120456/pipeline-liveness-336h.json --out-md ../../replay-work/audit/20260603-120456/pipeline-liveness-336h.md
```

336-hour result:

- `check-live-trigger` job runs are active: `2304` total runs, latest completed `2026-06-03T12:55:38.983Z`, latest age `0.09` hours, latest status `success`.
- Pipeline audit is active: `197` `PIPELINE_COMPLETE` events, latest complete `2026-06-03T01:08:03.856Z`, age `11.89` hours.
- LLM/pipeline audit prompt versions show official runtime adoption even without saved recommendation rows:
  - `LLM_CALL_STARTED`: `v10-hybrid-legacy-g` = `363`, latest `2026-06-03T10:21:20.340Z`
  - `LLM_CALL_COMPLETED`: `v10-hybrid-legacy-g` = `352`, latest `2026-06-03T10:21:17.384Z`
  - `PIPELINE_MATCH_ANALYZED`: `v10-hybrid-legacy-g` = `133`, latest `2026-06-03T01:08:03.830Z`
- Latest `PIPELINE_COMPLETE` metadata had `liveCount=1`, `candidateCount=1`, `totalProcessed=1`, `totalLlmEligible=1`, `totalModelNoBet=1`, `totalSavedRecommendations=0`.
- Recommendation table remains stale: latest saved row `2026-05-25T02:59:20.806Z`, age `226.03` hours, official saved rows `0`.

Updated liveness interpretation:

- Scheduler/job liveness is not the current blocker; `check-live-trigger` is running.
- Runtime audit logs show current prompt `v10-hybrid-legacy-g` is being used by LLM/pipeline calls.
- The comparability gap is now narrower and more precise: current official runtime has recent LLM/pipeline activity, but no saved recommendation rows in the 14-day window. Production-quality evidence for `v10-hybrid-legacy-g` still cannot come from saved-row deltas until official-prompt recommendations are actually saved and settle.

Current runtime no-save diagnostics:

```powershell
npm run data-driven:current-runtime-no-save --prefix packages/server -- --lookback-hours 336 --max-samples 60 --out-json ../../replay-work/audit/20260603-120456/current-runtime-no-save-336h.json --out-md ../../replay-work/audit/20260603-120456/current-runtime-no-save-336h.md
```

336-hour result, filtered to `actor=auto-pipeline` and official prompt `v10-hybrid-legacy-g`:

- `LLM_PARSE_DIAGNOSTIC`: `5`
- `parseActionable`: `0`
- `parseSkipped`: `5`
- `PIPELINE_MATCH_ANALYZED`: `133`
- `matchAnalyzedSaved`: `0`
- `matchAnalyzedShouldPush`: `0`
- `matchAnalyzedSaveBlocked`: `0`
- LLM diagnostics: `no_bet_intentional = 5/5`
- Market resolution for those diagnostics: `not_requested = 5/5`
- Evidence modes across parse/match audit rows: `full_live_data=71`, `odds_events_only_degraded=64`, `events_only_degraded=3`
- Pipeline outcome breakdown: `saved=false`, `shouldPush=false`; recent rows with full diagnostic metadata are `saveIntegrityStatus=not_attempted`.

No-save interpretation:

- The latest fully diagnostic official auto-pipeline samples are deliberate model/runtime no-bets, not failed saves.
- No current official samples show `saveIntegrityStatus=blocked`; save-integrity is not the observed blocker in this window.
- Some older `PIPELINE_MATCH_ANALYZED` audit rows in the 336-hour window lack the newer diagnostic metadata, so conclusions about exact blockers should prefer `LLM_PARSE_DIAGNOSTIC` rows and the most recent `PIPELINE_MATCH_ANALYZED` rows with populated diagnostic fields.
- Next audit step should inspect representative `no_bet_intentional` and policy-warning samples to decide whether conservatism is appropriate or whether prompt/policy should create a shadow-only candidate stream for these no-save situations.

Current runtime blocked-selection review:

```powershell
npm run data-driven:current-runtime-blocked-selection --prefix packages/server -- --lookback-hours 336 --max-rows 1000 --stake-percent 1 --out-json ../../replay-work/audit/20260603-120456/current-runtime-blocked-selection-336h.json --out-md ../../replay-work/audit/20260603-120456/current-runtime-blocked-selection-336h.md
```

336-hour result, filtered to official `v10-hybrid-legacy-g` `PIPELINE_MATCH_ANALYZED` rows with non-empty selections but no push/save:

- Blocked selections: `39`
- Unique matches: `5`
- Settled by deterministic rules: `39/39`
- Counterfactual W/L/push-like: `20 / 18 / 1`
- Counterfactual stake: `39%`
- Counterfactual P/L: `-2.68%`
- ROI on staked: `-6.87%`
- Metadata gaps: all `39` older rows are missing `llmDecisionDiagnostic`, `marketResolutionStatus`, and `saveIntegrityStatus`; evidence mode is present.

Market-level signal:

- `under_1.5`: `19` selections, `12W-7L`, `+1.24%`, ROI `6.53%`.
- `over_1.5`: `2` selections, `2W-0L`, `+1.45%`, ROI `72.5%`.
- `under_4.5`: `2` selections, `2W-0L`, `+1.40%`, ROI `70%`.
- `under_3.75`, `under_3.5`, `ht_under_0.5`, `ht_under_2.5`, high-chalk AH, and `1x2_home` pockets contain losses that explain why global loosening is unsafe.
- `full_live_data` blocked selections were materially negative (`24` selections, `5W-18L-1P`, `-12.82%`, ROI `-53.42%`), while `odds_events_only_degraded` was positive in this tiny cohort (`15W-0L`, `+10.14%`). This split is too small and too match-clustered to promote, but it is useful shadow material.

Normalizer fix found during this review:

- The report exposed that first-half selections such as `H1 Under 2.5 Goals @1.85` could be normalized as full-time `under_1` because `H1` was parsed as the numeric line.
- `normalizeMarket()` now recognizes first-half markers (`H1`, `1H`, `First Half`) and maps first-half totals, BTTS, 1X2, and AH to `ht_*` canonical markets before settlement/dedup.
- Regression tests were added in `packages/server/src/__tests__/normalize-market.test.ts`, and the blocked-selection artifact was regenerated after the fix.

Blocked-selection interpretation:

- The aggregate blocked-selection counterfactual is negative, so production policy should remain globally strict.
- The positive `Over 1.5` and `Under 4.5` pockets match earlier replay-shadow hypotheses, but current-runtime sample size is only `2` each and all rows lack newer diagnostic metadata. Keep them shadow-only.
- The report proves why blocked-selection settlement review should become the standard step after no-save diagnostics: it can distinguish policy-saved losses from missed winners without changing runtime behavior.

Current runtime blocked-selection gates:

```powershell
npm run data-driven:check-current-runtime-blocked-selection-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/current-runtime-blocked-selection-gates.json
```

Gate result:

```text
[current-runtime-blocked-selection-gates] total=39 settled=39 unresolved=0 settledRate=1.0000 wins=20 losses=18 pnl=-2.6800 roi=-0.0687
[current-runtime-blocked-selection-gates] OK
```

Interpretation:

- The gate intentionally checks only settled coverage plus required shadow-candidate thresholds for `over_1.5` and `under_4.5`.
- Passing this gate means those two canonical markets are worth continued shadow observation; it does not authorize production policy loosening because the overall blocked-selection cohort is negative and sample size per market is only `2`.
- The reusable example config is `packages/server/current-runtime-blocked-selection-gates.example.json`.

Runtime shadow telemetry enrichment:

- `PIPELINE_POLICY_SHADOW_CANDIDATE` and `PIPELINE_POLICY_SHADOW_SKIPPED` audit events now include `confidence` and `marketResolutionStatus`.
- Matched and skipped shadow reports now summarize by confidence band and market-resolution status in addition to pocket, canonical market, minute band, score state, and market availability.
- This makes the next settlement loop able to distinguish clean resolved markets from weak or unresolved model selections without changing production save/notify behavior.
- Pipeline-level regression coverage now asserts that both matched and skipped shadow audit events include these enriched fields and still do not create recommendations or notifications.

Baseline after telemetry enrichment:

```powershell
npm run data-driven:policy-shadow-suite --prefix packages/server -- --lookback-days 14 --settlement-lookback-days 30 --max-rows 1000 --stake-percent 1 --out-dir ../../replay-work/audit/20260603-120456/runtime-policy-shadow-suite-after-telemetry
```

Result:

```text
matchedEvents=0
matchedPocketRows=0
matchedSettledRows=0
skippedEvents=0
skippedSettledRows=0
```

Interpretation:

- This zero baseline is expected because the richer runtime shadow telemetry only applies to future live pipeline cycles.
- The next operator loop should rerun `data-driven:policy-shadow-suite` after new live events accumulate, then run the matched/skipped settlement gates.

Runtime shadow settlement gates prepared:

```powershell
npm run data-driven:check-policy-shadow-settlement-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-gates-after-telemetry.json
npm run data-driven:check-policy-shadow-skipped-settlement-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-gates-after-telemetry.json
```

Current gate result:

```text
matched gate: FAILED as expected
- totalPocketRows 0 < minTotalRows 20
- required pocket late_under_45_two_plus missing
- required pocket over_15_60_74_one_goal missing

skipped-neighbor gate: FAILED as expected
- totalEvents 0 < minTotalRows 20
- required market over_1.5 missing
- required market under_4.5 missing
```

Interpretation:

- These configs are now ready for the next live-observation window.
- The current failures mean "not enough runtime shadow evidence yet", not a pipeline regression.
- Promotion remains blocked until matched/skipped settlement gates pass on real future events.
- Operator runbook added at `docs/runtime-shadow-operator-runbook.md`. It defines when to run liveness/no-save/blocked-selection/shadow-suite checks, which files to read first, pass/fail meaning, and hard no-promote rules. It is linked from `docs/live-recommendation-pipeline-vi.md`, `AGENTS.md`, and `packages/server/src/scripts/README.md`.
- Watch/lean signal implementation review added at `replay-work/audit/20260603-120456/watch-lean-signal-review.md`. Current conclusion: option 2 exists technically as watchlist condition alerts plus delivery plumbing, but it is not yet productized as a default live signal feed.

Verification:

```powershell
npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts src/lib/__tests__/runtime-policy-shadow.test.ts src/lib/__tests__/runtime-policy-shadow-report.test.ts src/lib/__tests__/runtime-policy-shadow-skipped-report.test.ts
npm run typecheck --prefix packages/server
```

Result:

```text
4 files passed, 98 tests passed
typecheck passed
```

Prompt adoption gate:

```text
replay-work/audit/20260603-120456/prompt-adoption-gates.json
```

Expected current failure:

```powershell
npm run data-driven:check-prompt-adoption-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/prompt-adoption-gates.json
```

Observed failure:

```text
officialPromptRows 0 < minOfficialPromptRows 1
officialPromptRate 0.0000 < minOfficialPromptRate 0.01
officialPromptWithDecisionContext 0 < minOfficialPromptWithDecisionContext 1
officialPromptWithDecisionContextRate 0.0000 < minOfficialPromptWithDecisionContextRate 0.01
nonOfficialPromptRate 1.0000 > maxNonOfficialPromptRate 0.99
latestRowAgeHours 225.81 > maxLatestRowAgeHours 72
latestOfficialPromptRowAgeHours (missing) > maxLatestOfficialPromptRowAgeHours 72
```

Coverage gate:

```text
replay-work/audit/20260603-120456/coverage-current-runtime-gates.json
```

The gate intentionally fails on the current DB artifact because `currentRuntimeReady=0`:

```powershell
npm run data-driven:check-coverage-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/coverage-current-runtime-gates.json
```

Observed failure:

```text
currentRuntimeReady 0 < minCurrentRuntimeReady 1
currentRuntimeReady rate 0.0000 < minCurrentRuntimeReadyRate 0.001
```

Prompt-version stamping verification:

```powershell
npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts
```

## Recommended Next Step

Do not tune globally. Diagnostics are clean enough for the next audit phase, but DB coverage shows `0` settled export-eligible rows for the current official prompt, the 114-case extension already found a loss inside the broad BTTS shadow pocket, and the current-runtime blocked-selection counterfactual is slightly negative overall. The next highest-value step is to keep blocked selections in shadow/settlement review, let runtime shadow events accumulate, and only then evaluate stricter per-pocket gates before any production allowlist change, while separately monitoring when real current-runtime rows start to settle:

1. Redesign BTTS Yes, 60-74, two-plus margin into a stricter candidate definition with trailing-side pressure, shot quality, no red-card distortion, and odds `>= 2.05`; the broad current pocket should not be promoted.
2. Late Under 4.5, 75+, two-plus margin, reliable memory, odds `>= 2.00`, stake cap instead of full allow.
3. Over 1.5, 60-74, one-goal margin, stronger xG/SOT evidence and confidence `>= 8`.
4. Excluded-but-reviewed candidates: BTTS Yes at lower prices such as `1.70`, late Over 1.5 after minute `75`, and Under 2.5 late level scores. These need separate shadow gates because the 114-case cohort already contains both winners and policy-saved losses nearby.
5. Periodically run `data-driven:policy-shadow-suite`, then `data-driven:check-policy-shadow-skipped-settlement-gates` and `data-driven:check-policy-shadow-settlement-gates` after matches settle; do not promote any pocket from replay evidence alone.
