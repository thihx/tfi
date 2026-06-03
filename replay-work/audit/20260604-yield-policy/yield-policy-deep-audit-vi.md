# Yield / Guard Policy Deep Audit

**Date:** 2026-06-04  
**Scope:** official live recommendation prompt/policy `v10-hybrid-legacy-g`, runtime silence, policy loosen candidates, replay evidence.

## Executive Summary

Hệ thống đang hoạt động, nhưng gần như không tạo recommendation mới dưới official prompt. Đây không phải chỉ là vấn đề UI hay scheduler:

- Scheduler và pipeline audit còn sống.
- Official prompt đang được gọi.
- Saved recommendations gần đây đều là prompt cũ, không phải `v10-hybrid-legacy-g`.
- Real LLM replay áp production policy cho 11 cached case cho kết quả `0/11` actionable.
- Mock production-parity replay cho 15 case cho kết quả `1/15` actionable.
- Runtime blocked-selection counterfactual tổng thể âm ROI, nên không có cơ sở nới policy toàn cục.

Kết luận nghiệp vụ: vấn đề lớn nhất hiện tại là **product yield**, không phải chỉ là model accuracy. Nếu giữ nguyên nhãn “chỉ có bet mới là đầu ra”, hệ thống sẽ im lặng quá nhiều. Hướng cải thiện nên tách rõ:

- **Bet:** chỉ save khi qua đầy đủ money-critical guard.
- **Watch:** có thesis nhưng cần điều kiện xác nhận, odds/line/flow tốt hơn, hoặc chờ thời điểm.
- **No Action:** phân tích có giá trị nhưng không đủ điều kiện vào tiền.

## Evidence Collected

### Runtime liveness

Artifact:

- `replay-work/audit/20260604-yield-policy/runtime/pipeline-liveness-336h.md`
- `replay-work/audit/20260604-yield-policy/runtime/prompt-adoption-14d.md`
- `replay-work/audit/20260604-yield-policy/runtime/current-runtime-no-save-336h.md`
- `replay-work/audit/20260604-yield-policy/runtime/current-runtime-blocked-selection-336h.md`

Key findings:

| Check | Result | Interpretation |
| --- | ---: | --- |
| Job runs, 336h | 2,318 total, 1,151 success | Scheduler alive. |
| Pipeline complete events | 197 | Pipeline active. |
| Match analyzed events | 133 | Official prompt path producing analyses. |
| Saved from match analyzed | 0 | Current official flow produces no saved recommendations. |
| Recent saved rows | 15 | All stale/old prompt. |
| Official prompt saved rows | 0 | Cannot infer `v10-hybrid-legacy-g` quality from saved rows. |
| Parse diagnostics sampled | 5 | All `no_bet_intentional`. |
| Runtime blocked selections | 39 across 5 matches | Enough for hypothesis, not enough for promote. |

Top runtime policy warnings:

| Warning | Count | Read |
| --- | ---: | --- |
| `MARKET_UNRESOLVED` | 99 | Many analyses do not become a mapped market. Some are legitimate no-bets, some need better diagnostics. |
| `REQUIRED_CONDITIONS_NOT_MET` | 31 | Main post-parse global gate is strict. |
| `MEMORY_FLAG_NO_HISTORY` | 27 | Memory coverage gap; not a hard block by itself. |
| `POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL` | 25 | Major Under blocker. |
| `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL` | 17 | Major edge/risk blocker. |

### Current runtime blocked-selection counterfactual

Artifact:

- `replay-work/audit/20260604-yield-policy/runtime/current-runtime-blocked-selection-336h.md`

Overall:

| Metric | Value |
| --- | ---: |
| Blocked selections | 39 |
| Unique matches | 5 |
| Wins / losses / push-like | 20 / 18 / 1 |
| Counterfactual ROI | `-6.87%` |

Important slices:

| Slice | Total | ROI | Decision |
| --- | ---: | ---: | --- |
| All blocked selections | 39 | `-6.87%` | Do not globally loosen. |
| `full_live_data` | 24 | `-53.42%` | Strong no-promote signal. |
| `odds_events_only_degraded` | 15 | `+67.60%` | Interesting, but tiny and match-concentrated. Shadow only. |
| `under_1.5` | 19 | `+6.53%` | Weak positive, needs better segmentation. |
| `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL` | 17 | `+27.24%` | Best policy hypothesis, not enough for direct loosen. |
| `OVER_1_5_BLOCKED_LATE_MIDGAME` | 2 | `+72.50%` | Too small. Shadow only. |
| `POLICY_BLOCK_HT_UNDER_TIGHT_LOW_SIGNAL_GLOBAL` | 2 | `-100%` | Keep blocked. |
| Confidence 7 blocked | 6 | `-100%` | Do not assume confidence 7 is safe. |

Important caveat: old `PIPELINE_MATCH_ANALYZED` metadata missed minute/status/market diagnostic fields for many rows, so this report is useful as a directional audit, not final promotion evidence.

### Mock production-parity replay

Artifact:

- `packages/server/replay-work/data-driven-runs/2026-06-03T15-23-26-478Z/eval-summary.md`
- `packages/server/replay-work/data-driven-runs/2026-06-03T15-23-26-478Z/replay-vs-original.json`

Result:

| Metric | Value |
| --- | ---: |
| Scenarios | 15 |
| Push count | 1 |
| No-bet count | 14 |
| Push rate | `6.67%` |
| Replay ROI | `+82.50%` on 1 settled directional |

Read: very conservative and too small for quality confidence. It confirms silence, not profitability.

### Real LLM replay from cached responses

The full real preset timed out before evaluation, but produced 11 cached Gemini responses. I evaluated exactly those 11 cached cases with production replay policy, avoiding additional Gemini calls.

Artifacts:

- `packages/server/replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/eval-summary-11cached.md`
- `packages/server/replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/replay-vs-original-11cached.json`
- `packages/server/replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/cases-flat-11cached.csv`
- `packages/server/replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/segment-hotspots-11cached.json`

Result:

| Metric | Value |
| --- | ---: |
| Cached real LLM cases | 11 |
| Production-policy pushes | 0 |
| No-bet rate | `100%` |
| Original directional wins missed | 6 / 6 |
| Original directional losses avoided | 5 / 5 |

Raw Gemini selected a market in 2/11 cases, but replay policy reduced both to no-bet:

| Scenario | Raw LLM candidate | Replay warnings | Original result |
| --- | --- | --- | --- |
| `13395-1490320-80m-under-4-5` | `Under 4.5 Goals @2.025`, conf 7, value 10 | `LLP_BLOCK_UNDER_THIN_CUSHION_NO_REMAP`, `POLICY_CAP_GOALS_UNDER_THIN_CUSHION_STAKE_GLOBAL` | win |
| `13396-1490321-45m-asian-handicap-home-0-25` | `Home -0.5 @2.2`, conf 7, value 10 | `LLP_BLOCK_AH_WAIT_OU_OVER_LINE`, `POLICY_BLOCK_AH_HOME_CHALK_LOW_SIGNAL_GLOBAL`, `MEMORY_FLAG_NO_HISTORY` | half_loss |

Read:

- The silence is not only model refusal.
- Prompt preflight causes many no-bets.
- Post-parse policy/line-patience blocks selected markets.
- One blocked selected winner exists, but the other selected candidate lost; this supports narrow review, not broad loosen.

## Root Cause Map

### 1. Product output is tied too tightly to saveable bets

Today the user mostly sees value when a recommendation survives the full money-critical path. That is too strict for live betting where many useful states are legitimately not bettable yet.

Impact:

- Good analysis can disappear as `no_bet`.
- Watch-worthy states do not become visible enough.
- Users perceive silence even when the system spent LLM cost and reasoned correctly.

### 2. Prompt preflight is doing policy enforcement before server policy

The prompt tells Gemini to return no-bet for many conditions:

- non-`full_live_data`
- break-even not strict enough
- midgame volatility
- BTTS and corners restrictions
- late thin-cushion Under restrictions

This reduces invalid candidates, but it also prevents us from measuring “LLM wanted this but policy blocked it” for many cases.

Impact:

- Great for safety.
- Bad for yield observability.
- Makes replay undercount latent Watch/Lean opportunities.

### 3. Global post-parse policy is strict and sometimes overlapping

Important layers overlap:

- required conditions
- line-ladder patience
- thin-cushion Under
- medium-risk thin edge
- AH chalk low signal
- memory no-history
- same-thesis exposure

Impact:

- A market can be simultaneously blocked by several conservative reasons.
- Some blocks are correct, but broad combinations create low output.

### 4. Current evidence does not justify global loosening

The strongest counterargument to immediate loosen:

- all blocked selections ROI is negative
- full-live-data blocked cohort is strongly negative
- confidence 7 blocked cohort is strongly negative
- only small pockets look positive

So the right move is not “lower min confidence to 6” or “remove break-even guard.” The right move is productizing visible signals first, then running narrow shadow experiments.

### 5. Audit metadata had gaps

`PIPELINE_MATCH_ANALYZED` did not record enough fields for robust future blocked-selection settlement. I patched this in `packages/server/src/lib/server-pipeline.ts` so future rows include:

- `minute`
- `score`
- `status`
- `homeName`
- `awayName`
- `league`
- `rawSelection`
- `rawBetMarket`
- `betMarket`
- `mappedOdd`
- `odds`
- `valuePercent`
- `riskLevel`

Focused tests passed.

## Improvement Plan

### Phase 1: Fix visible yield without loosening money policy

Goal: users should see useful live intelligence even when no bet is saved.

Actions:

1. Create first-class signal states:
   - `Bet`: persisted recommendation, money-critical.
   - `Watch`: thesis exists, condition not mature.
   - `No Action`: analysis completed, no safe action.

2. Stage No Action / Watch deliveries from analysis output:
   - Save as delivery/signal rows, not recommendation rows.
   - Do not count as bet performance.
   - Include reason, active blockers, next trigger condition if available.

3. Add a “visible signal yield” metric:
   - `visible_signal_count = bet + watch + no_action`
   - Track by evidence mode, minute band, market family, league, prompt version.

4. UI should show:
   - Bet separately from Watch / No Action.
   - Watch alerts with “what must change” rather than pretending they are bets.
   - No Action analysis as useful rationale, especially for watched matches.

Policy risk: low. This creates product value without saving unsafe bets.

### Phase 2: Improve observability before policy promotion

Goal: make future loosening decisions evidence-based.

Actions:

1. Use the metadata patch from this audit for new runtime rows.
2. Re-run after enough live volume:
   - `data-driven:current-runtime-no-save`
   - `data-driven:current-runtime-blocked-selection`
   - `data-driven:policy-shadow-suite`
3. Add gates for promotion:
   - minimum 20 settled rows per narrow pocket
   - minimum 5 unique matches
   - positive ROI after stake cap
   - no single match contributes > 35% of pocket P/L
   - loss drawdown reviewed manually

Policy risk: low.

### Phase 3: Shadow-only policy experiments

Candidates to shadow, not promote immediately:

| Candidate | Evidence now | Suggested experiment |
| --- | --- | --- |
| Medium-risk thin-edge block | 17 rows, ROI `+27.24%` | Shadow candidate with stake cap `0.5-1%`, require full market resolution and no same-thesis exposure. |
| Late Over 1.5 midgame | 2 rows, ROI `+72.50%` | Keep telemetry only until >=20 settled rows. |
| Late Under 4.5 two-plus margin | Real replay selected 1 winner; policy has partial rescue but LLP blocked | Review line-patience remap/cushion rule for exact `75+`, total goals 4, line 4.5, odds >2.0. Shadow only. |
| Odds+events degraded O/U/AH | 15 rows, ROI `+67.60%` | Very suspicious positive slice; likely match-concentrated. Shadow-only with strict uniqueness and stake cap. |

Do not loosen yet:

| Guard | Reason |
| --- | --- |
| Global min confidence `7` | Confidence 7 blocked cohort was `-100%`. |
| Full-live-data blocked cohort | ROI `-53.42%`. |
| HT Under tight low signal | ROI `-100%`. |
| Broad BTTS/corners under blocks | Existing samples too small and high variance. |
| Same-thesis exposure cap | Protects bankroll from repeated correlated entries. |

### Phase 4: Only then consider production policy changes

Promotion should require runtime settlement, not only replay:

1. Pass shadow gates for a named pocket.
2. Add config-driven override with stake cap, not hard-code removal.
3. Run replay-batch with `--apply-replay-policy`.
4. Run CI gates.
5. Deploy as limited Watch/Beta if product supports it.

## Replay Commands Run

Mock production-parity replay:

```powershell
npm run data-driven:improvement-run --prefix packages/server
```

Real LLM preset attempt:

```powershell
npm run data-driven:improvement-run-real --prefix packages/server
```

This timed out before final summary but produced 11 `llm-cache` responses.

Cached real LLM evaluation:

```powershell
cd packages/server
npx tsx src/scripts/evaluate-settled-prompt-variants.ts --dir replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/scenarios --prompt-version v10-hybrid-legacy-g --llm real --model gemini-3.5-flash --allow-real-llm --odds recorded --delay-ms 0 --max-scenarios 11 --apply-replay-policy --llm-cache-dir replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/llm-cache --report-json replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/eval-summary-11cached.json --report-md replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/eval-summary-11cached.md --report-cases-json replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/eval-cases-11cached.json
```

Post summaries:

```powershell
npm run data-driven:summarize-vs-original --prefix packages/server -- --cases-json replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/eval-cases-11cached.json --out-json replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/replay-vs-original-11cached.json --out-csv replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/cases-flat-11cached.csv

npm run data-driven:segment-hotspots --prefix packages/server -- --cases-json replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/eval-cases-11cached.json --out-json replay-work/data-driven-runs/2026-06-03T15-27-29-563Z/segment-hotspots-11cached.json
```

Verification:

```powershell
npm run test --prefix packages/server -- src/lib/__tests__/current-runtime-no-save-diagnostics-report.test.ts src/lib/__tests__/current-runtime-blocked-selection-review.test.ts
```

Result: 2 test files passed, 4 tests passed.

