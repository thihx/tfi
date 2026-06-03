# Remediation Backlog

## Fixed During This Run

### 1. Centralize Football API health probing

Finding: `TFI-AUDIT-001`

`integration-health.ts` previously called API-Football `/status` directly. This was moved through `fetchFootballApiStatus()` in `packages/server/src/lib/football-api.ts`.

Completed:

1. Added `fetchFootballApiStatus()` in `packages/server/src/lib/football-api.ts`.
2. Updated `packages/server/src/lib/integration-health.ts`.
3. Preserved current behavior: daily-limit detection opens circuit, usage message shows current/limit.
4. Updated `packages/server/src/__tests__/integration-health.lib.test.ts`.

Verification:

```powershell
npm run test --prefix packages/server -- src/__tests__/integration-health.lib.test.ts src/__tests__/football-api.test.ts src/__tests__/football-api-quota.test.ts src/__tests__/football-api-circuit.test.ts
```

### 2. Add a repeatable real-provider sampling script

Finding: `TFI-AUDIT-004`

The ad-hoc real-provider script produced a useful artifact but exceeded shell timeout. A checked-in diagnostic script was added:

```text
packages/server/src/scripts/audit-real-provider-samples.ts
```

NPM alias:

```powershell
npm run provider:real-sample --prefix packages/server -- --max-fixtures 3 --max-api-calls 12 --out-json replay-work/audit/<runId>/provider-samples/real-provider-samples.json
```

Supported controls include:

- `--date`
- `--max-fixtures`
- `--max-api-calls`
- `--iterations`
- `--interval-ms`
- `--no-live`
- `--no-near`
- `--no-finished`
- `--out-json`
- `--full-payloads`

Smoke verification:

```powershell
npm run provider:real-sample --prefix packages/server -- --max-fixtures 1 --max-api-calls 4 --out-json ../../replay-work/audit/20260603-120456/provider-samples/real-provider-samples-script-smoke.json
```

Result: used exactly `4` provider calls and wrote a stable summary report.

Repeated-mode smoke verification:

```powershell
npm run provider:real-sample --prefix packages/server -- --max-fixtures 1 --max-api-calls 1 --iterations 2 --interval-ms 1 --no-stats --no-events --no-live-odds --no-prematch-odds --out-json ../../replay-work/audit/20260603-120456/provider-samples/real-provider-samples-iterations-smoke.json
```

Result: wrote `2` iterations, used `1` provider call in total, and skipped the second iteration through the shared API-call budget.

Live-day repeated verification:

```powershell
npm run provider:real-sample --prefix packages/server -- --max-fixtures 1 --max-api-calls 24 --iterations 6 --interval-ms 60000 --no-near --no-finished --no-prematch-odds --out-json ../../replay-work/audit/20260603-120456/provider-samples/real-provider-samples-live-day-6x60s.json
```

Result: used `24` provider calls across `6` one-minute iterations. Events were non-empty in `6/6` samples and raw live odds were present in `6/6`, but statistics were empty in `6/6`. Canonical tradable live odds existed in only `4/6` samples, and BTTS was canonical in only `1/6`. This confirms the sampler can capture real endpoint drift and that provider coverage must remain endpoint/market-specific.

### 3. Preserve replay manifest order and add chunk offset support

Finding: `TFI-AUDIT-005`

Replay scenario manifests preserve export order, but `listReplayScenarioJsonBasenames()` sorted manifest entries alphabetically. This made `--max-scenarios` evaluate the wrong subset whenever the exported folder had more scenarios than the cap.

Completed:

1. Added `--offset` support to `data-driven:replay-batch`.
2. Preserved `_manifest.json` scenario order in `packages/server/src/lib/replay-scenario-files.ts`.
3. Updated `packages/server/src/__tests__/replay-scenario-files.test.ts` to prove manifest order is kept while stale files are ignored.
4. Re-ran real Gemini chunks and wrote a corrected aggregate at `replay-work/audit/20260603-120456/real-llm-aggregate.json`.

Verification:

```powershell
npm run test --prefix packages/server -- src/__tests__/replay-scenario-files.test.ts
npm run typecheck --prefix packages/server
```

## Should Do Next

### 4. Calibrate real Gemini recall before changing prompt or policy

Finding: `TFI-AUDIT-002`

The standard real preset exceeded a 4-minute shell timeout but left partial `llm-cache`. Smaller controlled chunks were run, and a corrected aggregate now covers `35` unique real-Gemini cases:

Artifact:

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

Corrected aggregate:

- Cases: `35`
- Unique recommendation IDs: `35`
- Push/actionable: `0`
- No-bet: `35`
- Provider coverage: `35/35 ok`
- Replay context: `35/35 ok`
- Original wins missed: `17/17`
- Original losses avoided: `13/13`
- Main attribution:
  - `model_no_bet`: `27`
  - `pre_llm_blocked`: `4`
  - `hard_policy_gate`: `2`
  - `model_policy_mismatch`: `2`

Manual review priority:

1. `13398-1504825-67m-btts-yes` - Gemini selected BTTS Yes, policy blocked thin edge, original result win.
2. `13395-1490320-80m-under-4-5` - Gemini selected Under 4.5, line patience/policy blocked thin cushion, original result win.
3. `13381-1535217-61m-over-1-5` - Gemini selected Over 1.5, line patience/policy blocked late-midgame over, original result win.
4. `13375-1523156-77m-under-2-5` - Gemini selected Under 2.5, policy blocked, original result loss.

Case review completed:

```text
replay-work/audit/20260603-120456/missed-winner-case-review.md
replay-work/audit/20260603-120456/case-review-source.json
```

Review result:

- Strong calibration candidates: `3` (`13398`, `13395`, `13381`)
- Moderate review candidates: `3` (`13402`, `13367`, `13370`)
- Correct no-bet / thin-lucky historical winners: `9`
- Evidence-limited no-bets: `2`
- Policy-saved loss: `1` (`13375`)

Replay metrics completed:

```text
replay-work/audit/20260603-120456/real-llm-aggregate-eval-cases.json
replay-work/audit/20260603-120456/real-llm-aggregate-replay-vs-original.json
replay-work/audit/20260603-120456/real-llm-aggregate-segment-hotspots.json
replay-work/audit/20260603-120456/real-llm-aggregate-action-plan.json
replay-work/audit/20260603-120456/real-llm-aggregate-cases-flat.csv
```

Implemented:

1. `replay-vs-original.json` now includes `opportunityTradeoff`.
2. `segment-action-plan.json` now includes `qualityBlockers.modelSelectedPolicyBlocked`.
3. `qualityBlockers.opportunityRecall` now includes original-loss avoidance.
4. Candidate rescue detection covers the three reviewed pockets: BTTS Yes, late Under 4.5, and Over 1.5.

Verification:

```powershell
npm run test --prefix packages/server -- src/lib/__tests__/data-driven-replay-gates.test.ts src/lib/__tests__/segment-policy-action-plan.test.ts src/lib/__tests__/replay-vs-original-analysis.test.ts src/lib/__tests__/data-driven-quality-gates.test.ts
npm run typecheck --prefix packages/server
```

Replay-only candidate policy experiment completed:

```text
replay-work/audit/20260603-120456/real-llm-policy-experiment.json
```

Implemented:

1. Added `npm run data-driven:policy-experiment`.
2. Added replay-only counterfactual report logic for trusted policy-blocked selections where replay market equals original market.
3. Default experiment pockets:
   - BTTS Yes, 60-74, two-plus margin, odds `>= 2.05`, `1%` stake cap.
   - Late Under 4.5, 75+, two-plus margin, odds `>= 2.00`, `1%` stake cap.
   - Over 1.5, 60-74, one-goal margin, odds `>= 1.50`, `1%` stake cap.

Result on the 35-case aggregate:

- Trusted counterfactual candidates: `4`
- Configured selections: `3`
- Skipped policy-saved loss: `13375` Under 2.5, outside configured pockets.
- Simulated stake: `3%`
- Simulated PnL: `+2.775%`
- Simulated ROI: `92.5%`
- Original wins rescued: `3`
- Original losses reintroduced: `0`

Expanded real-LLM validation completed:

```text
replay-work/audit/20260603-120456/real-llm-expanded-eval-cases.json
replay-work/audit/20260603-120456/real-llm-expanded-replay-vs-original.json
replay-work/audit/20260603-120456/real-llm-expanded-action-plan.json
replay-work/audit/20260603-120456/real-llm-expanded-policy-experiment.json
```

Additional source runs:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T06-22-06-503Z
packages/server/replay-work/data-driven-runs/2026-06-03T06-25-07-353Z
```

Expanded result:

- Cases: `54`
- Source runs: `6`
- Push/actionable: `0`
- No-bet: `54`
- Provider coverage: `54/54 ok`
- Replay context: `54/54 ok`
- Directional original winners missed: `29/29`
- Directional original losers avoided: `22/22`
- Model-selected-policy-blocked cases: `4`
- Candidate rescue examples: `3`
- Policy-saved loss examples: `1`

Expanded policy experiment:

- Trusted counterfactual candidates: `4`
- Configured selections: `3`
- Simulated stake: `3%`
- Simulated PnL: `+2.775%`
- Simulated ROI: `92.5%`
- Original wins rescued: `3`
- Original losses reintroduced: `0`

Decision:

- Do not loosen global prompt or production policy.
- The three pockets remain plausible but rare.
- Shadow-only reporting/gating for these pockets has been implemented, not live recommendation persistence.
- Runtime policy-shadow telemetry now records matched policy-blocked pockets through `PIPELINE_POLICY_SHADOW_CANDIDATE` audit events and `debug.runtimePolicyShadow`. It does not alter `final_should_bet`, recommendation saves, or notifications.

Implemented:

1. Added `npm run data-driven:check-policy-experiment-gates`.
2. Added `packages/server/src/lib/replay-policy-experiment-gates.ts`.
3. Added `packages/server/src/scripts/check-replay-policy-experiment-gates.ts`.
4. Added `packages/server/replay-policy-experiment-gates.example.json`.
5. Added `replay-work/audit/20260603-120456/real-llm-expanded-policy-experiment-gates.json`.
6. Added `packages/server/src/lib/runtime-policy-shadow.ts`.
7. Added runtime audit/debug integration in `packages/server/src/lib/server-pipeline.ts`.
8. Added tests proving shadow pockets do not save or notify.
9. Added `PIPELINE_POLICY_SHADOW_SKIPPED` telemetry plus `npm run data-driven:policy-shadow-skipped-report` for skipped policy-blocked neighbor cases.
10. Added `npm run data-driven:policy-shadow-skipped-settlement` to settle skipped-neighbor cases and calculate counterfactual P/L.
11. Added `npm run data-driven:check-policy-shadow-skipped-settlement-gates` for sample-size, settled-rate, loss, P/L, ROI, market, and skipped-reason gates before designing any new pocket from skipped-neighbor evidence.
12. Added `npm run data-driven:policy-shadow-suite` to generate matched, skipped-neighbor, matched-settlement, skipped-settlement reports and a manifest in one output folder.

Use:

```powershell
Copy-Item packages/server/replay-policy-experiment-gates.example.json packages/server/replay-policy-experiment-gates.json
npm run data-driven:check-policy-experiment-gates --prefix packages/server -- --config replay-policy-experiment-gates.json
```

Runtime shadow verification:

```powershell
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow.test.ts src/lib/__tests__/replay-policy-experiment.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-report.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-skipped-report.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-skipped-settlement-report.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow-skipped-settlement-gates.test.ts
npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts
npm run typecheck --prefix packages/server
```

Runtime shadow report:

```powershell
npm run data-driven:policy-shadow-report --prefix packages/server -- --lookback-days 14 --max-rows 1000 --out-json ../../replay-work/audit/20260603-120456/runtime-policy-shadow-report.json --out-md ../../replay-work/audit/20260603-120456/runtime-policy-shadow-report.md
```

Initial result: `0` events, `0` pocket matches, `0` unique matches. This is the expected baseline immediately after adding telemetry.

Runtime shadow skipped-neighbor report:

```powershell
npm run data-driven:policy-shadow-skipped-report --prefix packages/server -- --lookback-days 14 --max-rows 1000 --out-json ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-report.json --out-md ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-report.md
```

Initial result: `0` skipped shadow events and `0` unique matches. This is expected because skipped-neighbor telemetry was just added. The report is intended to track policy-blocked model selections that miss configured pockets, especially low-price BTTS, late Over 1.5 after minute 75, late Under 2.5 level-score candidates, and non-clean BTTS contexts.

Runtime shadow skipped-neighbor settlement report:

```powershell
npm run data-driven:policy-shadow-skipped-settlement --prefix packages/server -- --lookback-days 30 --max-rows 1000 --stake-percent 1 --out-json ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-report.json --out-md ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-report.md
```

Initial result: `0` skipped shadow events, `0` settled rows, `0` unresolved rows, `0` counterfactual P/L at `1%` stake. This is expected immediately after adding telemetry. Once live events accumulate and matches settle, this report should be used before adding any new pocket from skipped-neighbor evidence.

Runtime shadow skipped-neighbor settlement gate:

```powershell
npm run data-driven:check-policy-shadow-skipped-settlement-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-gates-baseline.json
```

Initial baseline result: `total=0`, `settled=0`, `unresolved=0`, `losses=0`, `pnl=0`, `roi=0`, `OK`.

Implemented:

1. Added `packages/server/src/lib/runtime-policy-shadow-skipped-settlement-gates.ts`.
2. Added `packages/server/src/scripts/check-runtime-policy-shadow-skipped-settlement-gates.ts`.
3. Added `packages/server/runtime-policy-shadow-skipped-settlement-gates.example.json`.
4. Added baseline audit config `replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-gates-baseline.json`.

Decision: the baseline gate only verifies plumbing on the current zero-event artifact. The example gate is for future evidence review before creating a new pocket from skipped-neighbor rows; it is not a runtime policy switch.

Runtime shadow audit suite:

```powershell
npm run data-driven:policy-shadow-suite --prefix packages/server -- --lookback-days 14 --settlement-lookback-days 30 --max-rows 1000 --stake-percent 1 --out-dir ../../replay-work/audit/20260603-120456/runtime-policy-shadow-suite
```

Baseline result: `matchedEvents=0`, `matchedSettledRows=0`, `matchedPnlPercent=0`, `skippedEvents=0`, `skippedSettledRows=0`, `skippedPnlPercent=0`.

Output folder:

```text
replay-work/audit/20260603-120456/runtime-policy-shadow-suite/
```

Decision: use this suite as the periodic operator entrypoint after live shadow telemetry has run. Then run the matched and skipped-neighbor settlement gates against the generated artifacts when enough rows have settled.

Runtime shadow settlement report:

```powershell
npm run data-driven:policy-shadow-settlement --prefix packages/server -- --lookback-days 30 --max-rows 1000 --out-json ../../replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-report.json --out-md ../../replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-report.md
```

Initial result: `0` events, `0` pocket rows, `0` settled rows, `0` shadow P/L. This report is expected to become useful after shadow events exist and their matches are archived into `matches_history`.

Runtime shadow settlement gate:

```powershell
npm run data-driven:check-policy-shadow-settlement-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-gates-baseline.json
```

Initial baseline result: `total=0`, `settled=0`, `unresolved=0`, `losses=0`, `pnl=0`, `roi=0`, `OK`.

Implemented:

1. Added `npm run data-driven:check-policy-shadow-settlement-gates`.
2. Added `packages/server/src/lib/runtime-policy-shadow-settlement-gates.ts`.
3. Added `packages/server/src/scripts/check-runtime-policy-shadow-settlement-gates.ts`.
4. Added `packages/server/runtime-policy-shadow-settlement-gates.example.json`.
5. Added baseline audit config `replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-gates-baseline.json`.

Decision: the baseline gate only verifies plumbing on the current zero-event artifact. The example promotion gate requires real shadow sample size, settled-rate, zero-loss, P/L, ROI, and required-pocket thresholds before any pocket can be considered for production policy relaxation.

The replay-only policy experiment default example requires:

- at least `50` total cases
- at least `4` trusted policy-blocked counterfactual candidates
- at least `3` combined selected pocket cases
- `0` combined losses and `0` original losses reintroduced
- combined ROI on simulated stake at least `25%`
- at least one selected case in each of the three configured pockets

Verification:

```powershell
npm run test --prefix packages/server -- src/lib/__tests__/replay-policy-experiment-gates.test.ts src/lib/__tests__/replay-policy-experiment.test.ts
npm run typecheck --prefix packages/server
npm run data-driven:check-policy-experiment-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-expanded-policy-experiment-gates.json
```

Gate result: `total=54`, `trusted=4`, `selected=3`, `losses=0`, `pnl=2.7750`, `roi=0.9250`, `rescued=3`, `reintroduced=0`, `OK`.

74-case extension completed:

```text
replay-work/audit/20260603-120456/real-llm-74-eval-cases.json
replay-work/audit/20260603-120456/real-llm-74-replay-vs-original.json
replay-work/audit/20260603-120456/real-llm-74-action-plan.json
replay-work/audit/20260603-120456/real-llm-74-policy-experiment.json
replay-work/audit/20260603-120456/real-llm-74-policy-experiment-gates.json
```

Additional source runs:

```text
packages/server/replay-work/data-driven-runs/2026-06-03T06-55-43-535Z
packages/server/replay-work/data-driven-runs/2026-06-03T07-02-53-718Z
```

Implemented repeatable aggregation:

1. Added `npm run data-driven:aggregate-cases`.
2. Added `packages/server/src/lib/eval-cases-aggregate.ts`.
3. Added `packages/server/src/scripts/aggregate-eval-cases.ts`.

74-case result:

- Cases: `74`
- Duplicate scenario names: `0`
- Push/actionable: `0`
- No-bet: `74`
- Directional original winners missed: `38/38`
- Directional original losers avoided: `33/33`
- Model-selected-policy-blocked cases: `5`
- Candidate rescue examples: `3`
- Policy-blocked original losses: `2`

The new policy-blocked older case, `13328-1492598-70m-over-2-75`, is not a trusted rescue: replay selected `Corners Over 8.5 @1.775`, original market was `over_2.75`, original result was `loss`, and replay context had `replay_memory_missing`.

74-case gate result:

```text
total=74 trusted=4 selected=3 losses=0 pnl=2.7750 roi=0.9250 rescued=3 reintroduced=0 OK
```

74-case root cause review completed:

```text
replay-work/audit/20260603-120456/real-llm-74-case-review.md
```

Findings:

- `MARKET_UNRESOLVED` is a misleading diagnostic for intentional no-bets: all `55/55` occurrences had empty replay selection.
- `pre_llm_blocked` is mixed: `8` original wins missed, `5` original losses avoided, all under degraded `odds_events_only_degraded` evidence.
- `13328-1492598-70m-over-2-75` reinforces strict policy because Gemini selected a different market (`Corners Over 8.5`) from the original goals-over market and the case had `replay_memory_missing`.
- `13350-1504814-30m-corners-under-7-5` has empty diagnostics and no LLM cache in the 74-case source runs.

Should do next:

1. Split no-selection no-bets from true market-resolution failures:
   - `NO_MARKET_REQUESTED_MODEL_NO_BET`
   - `MARKET_UNRESOLVED_AFTER_SELECTION`
2. Add a quality gate for empty `llmDecisionDiagnostic` and empty `marketResolutionStatus`.
3. Recompute the 74-case reports after diagnostics cleanup.

Completed diagnostics cleanup:

1. Added replay diagnostic normalization in `packages/server/src/lib/settled-replay-evaluation.ts`.
2. Added `npm run data-driven:normalize-diagnostics`.
3. Added `packages/server/src/scripts/normalize-eval-case-diagnostics.ts`.
4. Extended `data-driven-quality-gates` with:
   - `maxEmptyLlmDecisionDiagnosticCount`
   - `maxEmptyLlmDecisionDiagnosticRate`
   - `maxEmptyMarketResolutionStatusCount`
   - `maxEmptyMarketResolutionStatusRate`
5. Regenerated 74-case diagnostics-v2 artifacts and gates.

Diagnostics-v2 gate result:

```text
quality: total=74 providerCoverage=0/74 replayContextGap=0/74 hardPolicyGate=2/74 modelPolicyMismatch=3/74 emptyDiagnostic=0/74 emptyMarketResolution=0/74 OK
policy experiment: total=74 trusted=4 selected=3 losses=0 pnl=2.7750 roi=0.9250 rescued=3 reintroduced=0 OK
```

94-case extension completed:

```text
replay-work/audit/20260603-120456/real-llm-94-eval-cases-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-replay-vs-original-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-action-plan-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-policy-experiment-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-quality-gates-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-94-policy-experiment-gates-diagnostics-v2.json
```

94-case result:

- Cases: `94`
- Duplicate scenario names: `0`
- Push/actionable: `0`
- No-bet: `94`
- Provider coverage: `94/94 ok`
- Directional original winners missed: `48/48`
- Directional original losers avoided: `42/42`
- Model-selected-policy-blocked cases: `7`
- Trusted policy-blocked counterfactual candidates: `6`
- Configured shadow-pocket selections: `3`
- Policy-blocked original losses: `2`

New 94-case observations:

- `13307-1521548-61m-btts-yes`: replay selected `BTTS Yes @1.7`, original result `win`, but price/confidence are outside the current BTTS pocket.
- `13297-1536947-79m-over-1-5`: replay selected `Over 1.5 @2.00`, original result `win`, but minute `79` is outside the current Over 1.5 60-74 pocket.
- `13375-1523156-77m-under-2-5` remains a trusted policy-blocked loss outside configured pockets.
- `13328-1492598-70m-over-2-75` remains untrusted because replay changed thesis to corners over and replay memory was missing.

94-case gate result:

```text
quality: total=94 providerCoverage=0/94 replayContextGap=0/94 hardPolicyGate=3/94 modelPolicyMismatch=4/94 emptyDiagnostic=0/94 emptyMarketResolution=0/94 OK
policy experiment: total=94 trusted=6 selected=3 losses=0 pnl=2.7750 roi=0.9250 rescued=3 reintroduced=0 OK
```

Stricter per-pocket policy experiment gates completed:

1. `data-driven:check-policy-experiment-gates` now supports pocket-level:
   - `minWinCount`
   - `minOriginalWinsRescued`
   - `minTotalPnlPercent`
   - `minRoiOnStaked`
   - `maxLossCount`
   - `maxOriginalLossesReintroduced`
2. `packages/server/replay-policy-experiment-gates.example.json` and the 94-case gate config use these stricter pocket-level thresholds.
3. The 94-case policy experiment still passes under the stricter gate.

Verification:

```powershell
npm run test --prefix packages/server -- src/lib/__tests__/replay-policy-experiment-gates.test.ts
npm run typecheck --prefix packages/server
npm run data-driven:check-policy-experiment-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-94-policy-experiment-gates-diagnostics-v2.json
```

114-case extension completed:

```text
replay-work/audit/20260603-120456/real-llm-114-eval-cases-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-replay-vs-original-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-action-plan-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-policy-experiment-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-quality-gates-diagnostics-v2.json
replay-work/audit/20260603-120456/real-llm-114-policy-experiment-gates-diagnostics-v2.json
```

114-case result:

- Cases: `114`
- Push/actionable: `0`
- No-bet: `114`
- Provider coverage: `114/114 ok`
- Replay context: `111 ok`, `3 replay_memory_missing`
- Directional original winners missed: `53/53`
- Directional original losers avoided: `57/57`
- Model-selected-policy-blocked cases: `10`
- Trusted policy-blocked counterfactual candidates: `7`
- Configured shadow-pocket selections: `4`
- Policy-blocked original losses: `5`

114-case policy experiment result:

- Combined selected: `4`
- Combined losses: `1`
- Combined PnL: `+1.775%`
- Combined ROI on stake: `44.38%`
- Original wins rescued: `3`
- Original losses reintroduced: `1`
- BTTS Yes 60-74 two-plus pocket now has a counterexample: `13295-1536946-70m-btts-yes`, selected `BTTS Yes @2.2`, original result `loss`.

114-case gate result:

```text
quality: total=114 providerCoverage=0/114 replayContextGap=0/114 hardPolicyGate=5/114 modelPolicyMismatch=5/114 emptyDiagnostic=0/114 emptyMarketResolution=0/114 OK
policy promotion gate: FAILED as expected; combined.lossCount=1, combined.originalLossesReintroduced=1, and btts_yes_60_74_two_plus violates pocket-level loss/PnL/ROI gates.
```

Strict-BTTS shadow filter implemented:

- The replay-only BTTS pocket now requires `prematchStrength=strong` and `marketAvailabilityBucket=totals_only` in addition to the previous minute/score/evidence/odds constraints.
- This keeps `13398-1504825-67m-btts-yes` selected and moves `13295-1536946-70m-btts-yes` to skipped trusted policy-blocked selections.
- Skipped trusted selections now include explicit exclusion reasons, including `Under 2.5` being outside the late `Under 4.5` pocket, `Over 1.5` at minute band `75+` being outside the `60-74` pocket, low-price BTTS at `1.70`, and non-clean BTTS context for `13295`.
- Skipped trusted rows also carry `minute`, `score`, `originalResult`, parsed `odds`, policy attribution, LLM diagnostic, and warnings for direct risk-neighbor review.
- New artifact: `replay-work/audit/20260603-120456/real-llm-114-policy-experiment-strict-btts.json`
- New gate config: `replay-work/audit/20260603-120456/real-llm-114-policy-experiment-gates-strict-btts.json`

Strict-BTTS gate result:

```text
policy experiment strict-btts: total=114 trusted=7 selected=3 losses=0 pnl=2.7750 roi=0.9250 rescued=3 reintroduced=0 OK
```

Verification:

```powershell
npm run test --prefix packages/server -- src/lib/__tests__/replay-policy-experiment.test.ts src/lib/__tests__/replay-policy-experiment-gates.test.ts
npm run data-driven:check-policy-experiment-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/real-llm-114-policy-experiment-gates-strict-btts.json
```

Current decision:

- Do not loosen global prompt or production policy.
- Do not promote the broad BTTS Yes 60-74 two-plus pocket; it now contains both a rescued winner and a reintroduced loser.
- Keep the strict-BTTS version as shadow-only because it has only one selected BTTS winner in the 114-case cohort.
- Keep late Under 4.5 and Over 1.5 as shadow-only hypotheses until larger current-runtime cohorts exist.
- Add stricter review gates before considering lower-price BTTS, late 75+ Over 1.5, late level-score Under 2.5, or any BTTS variant with weaker pressure/shot-quality context.

### 5. Add current-runtime-only coverage view

Finding: `TFI-AUDIT-003`

Status: implemented.

Coverage reporting now separates:

- official current prompt: `v10-hybrid-legacy-g`
- non-official prompt versions, including previous `v10` variants and old prompt versions
- empty prompt version
- rows with empty `decision_context`

Implemented:

1. Added `currentRuntime` to `RecommendationSnapshotCoverageReport` in `packages/server/src/lib/recommendation-snapshot-coverage.ts`.
2. Added current-runtime ready count for export-eligible rows where `prompt_version = v10-hybrid-legacy-g` and `decision_context` is non-empty.
3. Added separate cohorts for:
   - `official_current_runtime`
   - `official_current_missing_decision_context`
   - `non_official_prompt_version`
   - `empty_prompt_version`
4. Added `data-driven:check-coverage-gates` for saved coverage artifacts.
5. Documented the new field and gate in `packages/server/src/scripts/README.md`.

Verification:

```powershell
npm run test --prefix packages/server -- src/__tests__/recommendation-snapshot-coverage.test.ts src/lib/__tests__/recommendation-snapshot-coverage-gates.test.ts
npm run typecheck --prefix packages/server
```

This reduces noise when evaluating current live behavior because prompt/policy conclusions can now be based on the official-prompt, replay-context-complete subset instead of mixed historical cohorts.

### 6. Keep provider integration aligned with API-Football documented limits

Finding: `TFI-AUDIT-008`

Status: documented, bounded repeated sampling mode added, initial live-day sampling completed; more league/time-band sampling still recommended before changing evidence-mode thresholds.

Official API-Football docs confirm several TFI guardrails:

- `/odds/live` has no provider-side history; replay-quality odds must be recorded by TFI during the live match.
- `/odds` is pre-match/reference odds with limited history and should not be treated as live tradable evidence.
- `/fixtures/statistics` is per-minute live data; `/fixtures/events`, live fixtures, and live odds are faster-changing live data.
- `/fixtures?ids=` supports a maximum of `20` fixture IDs; TFI already chunks fixture fetches by `20` in `provider-insight-cache.ts`.
- League coverage flags can vary by season and do not guarantee non-empty data for every fixture.

Current decision:

- Keep `reference-prematch` degraded for in-play recommendations.
- Keep replay runs on recorded odds snapshots when judging betting quality.
- Use `provider:real-sample -- --iterations N --interval-ms MS` for recurring live-day provider sampling before changing evidence-mode thresholds. The shared `--max-api-calls` budget applies across all iterations.
- Treat live provider evidence as endpoint-specific: the first live-day repeated run had events and raw live odds but no fixture statistics, and canonical live market coverage changed within minutes.

DB coverage regenerated:

```text
replay-work/audit/20260603-120456/coverage-current-runtime.json
replay-work/audit/20260603-120456/coverage-current-runtime-365d.json
```

Coverage result:

- 90 days: `1736` export-eligible rows, `0` official prompt rows, `0` current-runtime-ready rows, `1620` non-official prompt rows, `116` empty prompt rows.
- 365 days: `2748` export-eligible rows, `0` official prompt rows, `0` current-runtime-ready rows, `1620` non-official prompt rows, `1128` empty prompt rows.

New finding: `TFI-AUDIT-007`.

Coverage gate:

```text
replay-work/audit/20260603-120456/coverage-current-runtime-gates.json
```

Expected current failure:

```text
currentRuntimeReady 0 < minCurrentRuntimeReady 1
currentRuntimeReady rate 0.0000 < minCurrentRuntimeReadyRate 0.001
```

Prompt-version stamping check:

- `.env.azure`, `.env.azure.example`, and `packages/server/.env.example` point active prompt to `v10-hybrid-legacy-g` or the code default.
- `server-pipeline` resolves invalid active/shadow prompt env values through `isLiveAnalysisPromptVersion`.
- Added regression test: if `LIVE_ANALYSIS_ACTIVE_PROMPT_VERSION` is accidentally set to retired `v10-hybrid-legacy-b`, the saved recommendation still uses `prompt_version=v10-hybrid-legacy-g`.

Recent prompt adoption check implemented:

```text
packages/server/src/lib/recommendation-prompt-adoption-report.ts
packages/server/src/lib/recommendation-prompt-adoption-gates.ts
packages/server/src/scripts/report-recommendation-prompt-adoption.ts
packages/server/src/scripts/check-recommendation-prompt-adoption-gates.ts
packages/server/src/lib/__tests__/recommendation-prompt-adoption-report.test.ts
packages/server/src/lib/__tests__/recommendation-prompt-adoption-gates.test.ts
packages/server/recommendation-prompt-adoption-gates.example.json
```

Command:

```powershell
npm run data-driven:prompt-adoption --prefix packages/server -- --lookback-days 14 --max-recent-rows 50 --out-json ../../replay-work/audit/20260603-120456/prompt-adoption-14d.json --out-md ../../replay-work/audit/20260603-120456/prompt-adoption-14d.md
```

14-day result:

- `15` total/actionable recommendation rows.
- Latest recommendation row: `2026-05-25T02:59:20.806Z`, age `225.81` hours when regenerated.
- `0` official prompt rows for `v10-hybrid-legacy-g`.
- Latest official prompt row: `(none)`.
- `15` non-official prompt rows, all `v10-hybrid-legacy-b`.
- `15/15` rows have decision context and `15/15` are settled.

Adoption gate config:

```text
replay-work/audit/20260603-120456/prompt-adoption-gates.json
```

Current expected failure:

```powershell
npm run data-driven:check-prompt-adoption-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/prompt-adoption-gates.json
```

```text
officialPromptRows 0 < minOfficialPromptRows 1
officialPromptRate 0.0000 < minOfficialPromptRate 0.01
officialPromptWithDecisionContext 0 < minOfficialPromptWithDecisionContext 1
officialPromptWithDecisionContextRate 0.0000 < minOfficialPromptWithDecisionContextRate 0.01
nonOfficialPromptRate 1.0000 > maxNonOfficialPromptRate 0.99
latestRowAgeHours 225.81 > maxLatestRowAgeHours 72
latestOfficialPromptRowAgeHours (missing) > maxLatestOfficialPromptRowAgeHours 72
```

Updated decision:

- Treat `TFI-AUDIT-007` as an open current-runtime comparability gap, not merely a wait-for-settlement gap.
- Pipeline liveness report shows `check-live-trigger` is active and audit logs are using `v10-hybrid-legacy-g`, but saved recommendation rows remain stale.
- Verify why current official runtime activity is producing no saved recommendations before interpreting recent production rows as `v10-hybrid-legacy-g` performance.
- Keep replay/shadow evidence as the main basis for prompt/policy tuning until official prompt adoption is visible in recent saved rows.

Pipeline liveness check implemented:

```text
packages/server/src/lib/recommendation-pipeline-liveness-report.ts
packages/server/src/scripts/report-recommendation-pipeline-liveness.ts
packages/server/src/lib/__tests__/recommendation-pipeline-liveness-report.test.ts
```

Command:

```powershell
npm run data-driven:pipeline-liveness --prefix packages/server -- --lookback-hours 336 --max-recent-rows 25 --out-json ../../replay-work/audit/20260603-120456/pipeline-liveness-336h.json --out-md ../../replay-work/audit/20260603-120456/pipeline-liveness-336h.md
```

Result:

- `check-live-trigger`: `2304` runs, latest completed `2026-06-03T12:55:38.983Z`, age `0.09h`, latest status `success`.
- `PIPELINE_COMPLETE`: `197` events, latest `2026-06-03T01:08:03.856Z`, age `11.89h`.
- Audit prompt versions: `LLM_CALL_STARTED` `v10-hybrid-legacy-g=363`; `PIPELINE_MATCH_ANALYZED` `v10-hybrid-legacy-g=133`.
- Latest pipeline complete: `totalLlmEligible=1`, `totalModelNoBet=1`, `totalSavedRecommendations=0`.
- Saved recommendations: latest row `2026-05-25T02:59:20.806Z`, age `226.03h`, official saved rows `0`.

Current official no-save diagnostics implemented:

```text
packages/server/src/lib/current-runtime-no-save-diagnostics-report.ts
packages/server/src/scripts/report-current-runtime-no-save-diagnostics.ts
packages/server/src/lib/__tests__/current-runtime-no-save-diagnostics-report.test.ts
```

Command:

```powershell
npm run data-driven:current-runtime-no-save --prefix packages/server -- --lookback-hours 336 --max-samples 60 --out-json ../../replay-work/audit/20260603-120456/current-runtime-no-save-336h.json --out-md ../../replay-work/audit/20260603-120456/current-runtime-no-save-336h.md
```

Result:

- Auto-pipeline official `LLM_PARSE_DIAGNOSTIC`: `5`, all skipped.
- `parseActionable=0`, `parseSkipped=5`.
- LLM diagnostics: `no_bet_intentional=5/5`.
- Market resolution: `not_requested=5/5`.
- `PIPELINE_MATCH_ANALYZED=133`, `matchAnalyzedSaved=0`, `matchAnalyzedShouldPush=0`, `matchAnalyzedSaveBlocked=0`.
- Latest fully diagnostic samples are deliberate no-bets, not save failures.

Decision refinement:

- Current official runtime is active and uses `v10-hybrid-legacy-g`.
- Current official runtime has not saved a recommendation because recent auto-pipeline diagnostic samples are no-bet decisions; not because the save-integrity gate is currently blocking actionable selections.
- Next review should classify representative no-bet samples and policy-warning samples before changing prompt/policy.

Current official blocked-selection review implemented:

```text
packages/server/src/lib/current-runtime-blocked-selection-review.ts
packages/server/src/scripts/report-current-runtime-blocked-selection-review.ts
packages/server/src/lib/__tests__/current-runtime-blocked-selection-review.test.ts
```

Current official blocked-selection gates implemented:

```text
packages/server/src/lib/current-runtime-blocked-selection-gates.ts
packages/server/src/scripts/check-current-runtime-blocked-selection-gates.ts
packages/server/src/lib/__tests__/current-runtime-blocked-selection-gates.test.ts
packages/server/current-runtime-blocked-selection-gates.example.json
```

Command:

```powershell
npm run data-driven:current-runtime-blocked-selection --prefix packages/server -- --lookback-hours 336 --max-rows 1000 --stake-percent 1 --out-json ../../replay-work/audit/20260603-120456/current-runtime-blocked-selection-336h.json --out-md ../../replay-work/audit/20260603-120456/current-runtime-blocked-selection-336h.md
```

Result:

- Official-prompt blocked selections with non-empty selection and no push/save: `39`.
- Unique matches: `5`.
- Deterministic settlement coverage: `39/39`.
- Counterfactual W/L/push-like: `20/18/1`.
- Counterfactual P/L: `-2.68%` on `39%` staked; ROI `-6.87%`.
- All `39` rows lack newer `llmDecisionDiagnostic`, `marketResolutionStatus`, and `saveIntegrityStatus`, so this is useful counterfactual settlement evidence but not full diagnostic evidence.
- Positive tiny pockets: `over_1.5` (`2/2`, `+1.45%`) and `under_4.5` (`2/2`, `+1.40%`).
- Negative pockets include `under_3.75`, `under_3.5`, first-half unders, high-chalk AH, and `1x2_home`, supporting no global policy loosening.
- Gate config `replay-work/audit/20260603-120456/current-runtime-blocked-selection-gates.json` passes for settled coverage plus `over_1.5` and `under_4.5` shadow-candidate thresholds. This is not a production promotion gate; it only records that these two pockets deserve continued shadow observation.

Runtime shadow telemetry enrichment:

- `PIPELINE_POLICY_SHADOW_CANDIDATE` and `PIPELINE_POLICY_SHADOW_SKIPPED` audit payloads now include `confidence` and `marketResolutionStatus`.
- `runtime-policy-shadow-report` and `runtime-policy-shadow-skipped-report` now expose `byConfidenceBand`, `byMarketResolutionStatus`, and recent-row confidence/resolution columns.
- Baseline suite after enrichment was written to `replay-work/audit/20260603-120456/runtime-policy-shadow-suite-after-telemetry`; current matched/skipped events remain `0`, expected until future live cycles produce policy-blocked selections.
- `server-pipeline.test.ts` now asserts enriched matched/skipped shadow audit payloads and confirms they still do not save or notify.
- Runtime shadow settlement gate configs are prepared for the next observation window:
  - `replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-gates-after-telemetry.json`
  - `replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-gates-after-telemetry.json`
- Both gates currently fail as expected on the zero-event baseline; this means shadow evidence has not accumulated yet, not that the telemetry implementation regressed.
- Operator runbook added at `docs/runtime-shadow-operator-runbook.md` and linked from the live pipeline doc, agent guide, and server scripts README. It makes the no-promote rule explicit: replay-only evidence, tiny current blocked-selection pockets, and zero-event shadow baselines are observation inputs, not production policy approval.

Normalizer remediation found during blocked-selection review:

- `normalizeMarket()` previously misread first-half text such as `H1 Under 2.5 Goals @1.85` as full-time `under_1`, because `H1` was treated as a line candidate.
- Fixed first-half marker parsing for `H1`, `1H`, and `First Half` totals/BTTS/1X2/AH so blocked-selection settlement and future persistence/dedup use `ht_*` canonical markets.
- Regression coverage added to `packages/server/src/__tests__/normalize-market.test.ts`.

Verification:

```powershell
npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/recommendation-prompt-adoption-report.test.ts src/__tests__/recommendation-snapshot-coverage.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/recommendation-prompt-adoption-gates.test.ts src/lib/__tests__/recommendation-prompt-adoption-report.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/recommendation-pipeline-liveness-report.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/current-runtime-no-save-diagnostics-report.test.ts
npm run test --prefix packages/server -- src/__tests__/normalize-market.test.ts src/lib/__tests__/current-runtime-blocked-selection-review.test.ts src/lib/__tests__/current-runtime-no-save-diagnostics-report.test.ts src/__tests__/first-half-settle.test.ts
npm run test --prefix packages/server -- src/lib/__tests__/current-runtime-blocked-selection-gates.test.ts src/lib/__tests__/current-runtime-blocked-selection-review.test.ts src/__tests__/normalize-market.test.ts
npm run data-driven:check-current-runtime-blocked-selection-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/current-runtime-blocked-selection-gates.json
npm run test --prefix packages/server -- src/lib/__tests__/runtime-policy-shadow.test.ts src/lib/__tests__/runtime-policy-shadow-report.test.ts src/lib/__tests__/runtime-policy-shadow-skipped-report.test.ts src/lib/__tests__/runtime-policy-shadow-settlement-report.test.ts src/lib/__tests__/runtime-policy-shadow-skipped-settlement-report.test.ts
npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts src/lib/__tests__/runtime-policy-shadow.test.ts src/lib/__tests__/runtime-policy-shadow-report.test.ts src/lib/__tests__/runtime-policy-shadow-skipped-report.test.ts
npm run data-driven:policy-shadow-suite --prefix packages/server -- --lookback-days 14 --settlement-lookback-days 30 --max-rows 1000 --stake-percent 1 --out-dir ../../replay-work/audit/20260603-120456/runtime-policy-shadow-suite-after-telemetry
npm run data-driven:check-policy-shadow-settlement-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-gates-after-telemetry.json
npm run data-driven:check-policy-shadow-skipped-settlement-gates --prefix packages/server -- --config ../../replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-gates-after-telemetry.json
npm run typecheck --prefix packages/server
```

Decision:

- Keep using historical rows for replay counterfactuals and policy stress-tests.
- Do not treat historical settled deltas as direct production-quality evidence for `v10-hybrid-legacy-g`.
- Monitor current-runtime coverage after official-prompt rows appear in recent saved recommendations and later settle.

## Observe

### 6. Preserve raw-vs-canonical market distinction

Provider coverage audit showed 45 cases where raw markets existed but canonical tradable markets did not, mostly BTTS. This is good defensive behavior.

Do not replace canonical coverage checks with raw `has_*` flags.
