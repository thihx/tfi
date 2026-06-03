# Real LLM 74-Case Review

**Run:** `20260603-120456`  
**Source cohort:** `real-llm-74-eval-cases.json`  
**Prompt:** `v10-hybrid-legacy-g`  
**Policy mode:** settled replay policy applied  
**Date:** 2026-06-03

## Executive Conclusion

The 74-case cohort confirms that the live replay stack is conservative by design, not failing because of provider coverage or broad market-normalization errors.

Key points:

- `74/74` cases ended as no-bet.
- Directional original winners missed: `38/38`.
- Directional original losers avoided: `33/33`.
- Provider coverage was clean: `74/74 ok`.
- Replay context was mostly clean: `73/74 ok`, `1/74 replay_memory_missing`.
- `MARKET_UNRESOLVED` appeared `55` times, but all `55/55` had empty replay selection. This is better interpreted as no market requested by the model, not a resolver failure.
- The only replay-selected markets were `5` policy-blocked cases: `3` original wins and `2` original losses.
- The three trusted rescue pockets remain unchanged and still pass shadow gate, but they are rare: only `3` selected cases across `74`.

Decision: do not loosen global prompt or policy. Continue with shadow-only tracking and improve diagnostics around no-bet reasons.

## Missed Winner Breakdown

Directional original winners: `38`.

By original market family:

| Market family | Missed winners | Notes |
|---|---:|---|
| Goals under | 20 | Largest recall gap; many are late unders, but several are degraded-evidence pre-LLM skips or thin-cushion no-bets. |
| Goals over | 7 | Mostly low-price or volatile score-state no-bets; one trusted rescue is `over_1.5` at minute 61. |
| Asian handicap | 7 | Several full-live no-bets due same-thesis exposure, danger-zone veto, or weak shot quality. |
| BTTS | 3 | One trusted rescue: `BTTS Yes` at minute 67 with two-plus margin. |
| 1X2 | 1 | No-bet due heavy existing exposure and late-game risk. |

By replay attribution:

| Attribution | Missed winners | Interpretation |
|---|---:|---|
| `model_no_bet` | 27 | Gemini intentionally declined; usually exposure, low odds, red card, danger zone, or weak evidence. |
| `pre_llm_blocked` | 8 | The eligibility firewall skipped LLM, all in degraded `odds_events_only_degraded` evidence mode. |
| `hard_policy_gate` | 2 | Model selected a market, but post-parse policy blocked it. Both are trusted rescue candidates. |
| `model_policy_mismatch` | 1 | Model selected a market in a zone already constrained by policy context. This is also a trusted rescue candidate. |

## MARKET_UNRESOLVED Root Cause

`MARKET_UNRESOLVED` is currently misleading in this report.

Observed facts:

- `MARKET_UNRESOLVED` count: `55`.
- Empty replay selection among those rows: `55/55`.
- Market resolution status among those rows: effectively `not_requested`.
- Representative LLM cache entries show valid strict JSON with `should_push=false`, `selection=""`, and an explicit no-bet rationale.

Representative examples:

| Case | Original market/result | Replay state | LLM rationale |
|---|---|---|---|
| `13402-1545451-83m-corners-under-14-5` | Corners Under 14.5, win | `selection=""` | Existing Home +0.25 exposure, balanced late state, Under 2.5 below min odds, corner/over risk too high. |
| `13392-1490319-50m-under-4` | Under 4, win | `selection=""` | Conflicting signals, trailing home team blocks Corners Under, goals under too volatile in high-scoring MLS state. |
| `13369-1544856-38m-asian-handicap-home-0` | AH Home 0, win | `selection=""` | Existing H1 Home 0 exposure; adding FT AH would compound same-thesis risk. |
| `13333-1492599-81m-1x2-home` | 1X2 Home, win | `selection=""` | Heavy existing exposure across AH, corners, and goals; no extra late-game laddering. |

Conclusion:

- This does not look like a canonical market resolver defect.
- It is a diagnostic naming issue: when the model intentionally returns no selection, the replay report should separate `no_market_requested` from actual `market_unresolved_after_selection`.

Recommended improvement:

1. Keep `MARKET_UNRESOLVED` only when replay had a non-empty selection that failed normalization/resolution.
2. Add a separate warning/diagnostic such as `NO_MARKET_REQUESTED_MODEL_NO_BET` for intentional no-bets.
3. Keep no-bet rationales visible in case review output because they are business-critical evidence.

## Pre-LLM Blocked Review

`pre_llm_blocked`: `13` cases.

Outcome split:

- Original wins missed: `8`.
- Original losses avoided: `5`.

All `13` were `odds_events_only_degraded`, with no LLM call requested.

Representative cases:

| Case | Market/result | Minute/score | Evidence |
|---|---|---|---|
| `13391-1516858-70m-under-0-5` | Under 0.5, win | 70, 0-0 | Degraded evidence; very late ultra-thin under. |
| `13390-1403861-83m-under-1-5` | Under 1.5, win | 83, 0-1 | Degraded evidence; late under. |
| `13363-1516841-82m-under-2-5` | Under 2.5, win | 82, 1-1 | Degraded evidence; late thin-cushion under. |
| `13362-1516840-82m-under-2-5` | Under 2.5, loss | 82, 1-1 | Degraded evidence; same type of trade as above, but lost. |
| `13357-1516837-74m-under-0-5` | Under 0.5, loss | 74, 0-0 | Degraded evidence; ultra-thin under. |

Conclusion:

- The firewall is not obviously too strict; it avoided several similar degraded-evidence losses.
- Do not open degraded late unders globally.
- If this area is explored, it should be a separate shadow experiment for degraded late unders with strong price and league filters, not part of the three current full-live-data pockets.

## Policy-Blocked Model Selections

The model selected a resolved market in `5` cases.

| Case | Replay selection | Original market/result | Review |
|---|---|---|---|
| `13398-1504825-67m-btts-yes` | BTTS Yes @2.2 | BTTS Yes, win | Trusted rescue candidate. |
| `13395-1490320-80m-under-4-5` | Under 4.5 @2.025 | Under 4.5, win | Trusted rescue candidate. |
| `13381-1535217-61m-over-1-5` | Over 1.5 @1.55 | Over 1.5, win | Trusted rescue candidate. |
| `13375-1523156-77m-under-2-5` | Under 2.5 @1.7 | Under 2.5, loss | Policy saved a loss; keep blocked. |
| `13328-1492598-70m-over-2-75` | Corners Over 8.5 @1.775 | Goals Over 2.75, loss | Not trusted: replay market differs from original market and memory was missing. Keep blocked. |

Conclusion:

- The three existing candidate pockets remain valid for shadow tracking.
- The two policy-blocked losses are strong evidence against broad loosening.
- `13328` is especially important: Gemini changed thesis from goals over to corners over in a missing-memory context. This is exactly the kind of market drift that post-parse policy should catch.

## Case 13350 Diagnostic Gap

Case `13350-1504814-30m-corners-under-7-5` has:

- `replayQualityAttribution=model_no_bet`
- `llmDecisionDiagnostic=""`
- `marketResolutionStatus=""`
- no `llm-cache` file in the 74-case source runs
- original result `win`
- full live data, side market unplayable

This is not enough evidence for prompt or policy tuning. It should be treated as a replay diagnostics gap.

Recommended improvement:

- Ensure every evaluated case receives a non-empty `llmDecisionDiagnostic` and `marketResolutionStatus`.
- When no LLM call/cache exists, distinguish `pre_llm_blocked`, `cache_missing`, and `not_evaluated` explicitly.

## Recommended Next Engineering Step

Implement diagnostics cleanup before any further betting-policy change:

1. Split `MARKET_UNRESOLVED` into:
   - `NO_MARKET_REQUESTED_MODEL_NO_BET`
   - `MARKET_UNRESOLVED_AFTER_SELECTION`
2. Backfill/recompute 74-case action-plan reports with the new diagnostic labels.
3. Add a gate or quality check that fails if any evaluated case has empty `llmDecisionDiagnostic` or empty `marketResolutionStatus`.
4. Keep the three pocket policy experiment as shadow-only.

This will make the next audit much sharper: real market-resolution defects will no longer be hidden among intentional no-bets.

## Diagnostics V2 Follow-Up

Diagnostics cleanup has been implemented and the 74-case report was regenerated without another LLM call.

Artifacts:

```text
real-llm-74-eval-cases-diagnostics-v2.json
real-llm-74-action-plan-diagnostics-v2.json
real-llm-74-quality-gates-diagnostics-v2.json
real-llm-74-policy-experiment-diagnostics-v2.json
real-llm-74-policy-experiment-gates-diagnostics-v2.json
```

Result:

- `MARKET_UNRESOLVED`: `0`
- `NO_MARKET_REQUESTED_MODEL_NO_BET`: `55`
- Empty `llmDecisionDiagnostic`: `0`
- Empty `marketResolutionStatus`: `0`
- `13350` is now classified as `no_bet_intentional` / `not_requested`.
- Shadow policy experiment remained unchanged: `3` selections, `3` wins, `0` losses, `+2.775%` simulated PnL.

## 94-Case Extension Note

The same diagnostics-v2 flow was later extended to `94` real-Gemini cases without changing production policy.

Artifacts:

```text
real-llm-94-eval-cases-diagnostics-v2.json
real-llm-94-action-plan-diagnostics-v2.json
real-llm-94-policy-experiment-diagnostics-v2.json
real-llm-94-quality-gates-diagnostics-v2.json
real-llm-94-policy-experiment-gates-diagnostics-v2.json
```

Result:

- `94/94` cases ended as no-bet.
- Directional original winners missed: `48/48`.
- Directional original losers avoided: `42/42`.
- Provider coverage remained clean: `94/94 ok`.
- Empty diagnostics remained clean: `0` empty `llmDecisionDiagnostic`, `0` empty `marketResolutionStatus`.
- Model-selected policy-blocked cases increased to `7`: `5` original wins and `2` original losses.
- Trusted policy-blocked counterfactual candidates increased to `6`, but configured shadow-pocket selections stayed at `3`.
- Shadow policy experiment still passed: `3` selections, `3` wins, `0` losses, `+2.775%` simulated PnL, `0` original losses reintroduced.

Additional review cases:

| Case | Replay selection | Original result | Review |
|---|---|---|---|
| `13307-1521548-61m-btts-yes` | BTTS Yes @1.7 | win | Trusted but outside current BTTS pocket because price/confidence are weaker than the `>=2.05` pocket. |
| `13297-1536947-79m-over-1-5` | Over 1.5 @2.00 | win | Trusted but outside current Over 1.5 pocket because it is minute `79`, not `60-74`. |
| `13375-1523156-77m-under-2-5` | Under 2.5 @1.7 | loss | Trusted policy-saved loss outside configured pockets. Keep blocked. |
| `13328-1492598-70m-over-2-75` | Corners Over 8.5 @1.775 | loss | Untrusted market drift plus missing replay memory. Keep blocked. |

Updated decision:

- Do not loosen global prompt or production policy.
- Keep the three existing pockets shadow-only.
- Treat lower-price BTTS, 75+ Over 1.5, and late level-score Under 2.5 as separate shadow-review candidates with their own gates.
