# Recommendation Guard / Policy Review

**Date:** 2026-06-04  
**Scope:** current live recommendation runtime guard inventory for deciding whether policy can be relaxed.

## Short Conclusion

The current TFI recommendation pipeline is conservative by design and has multiple independent blocking layers. The most important distinction:

- `should_push` can mean a user-facing alert, including a Watch condition.
- `final_should_bet` means a saveable AI bet candidate.
- `saved=true` happens only after odds, market normalization, line patience, post-parse policy, memory/segment rules, same-thesis exposure, and save-integrity all pass.

The safest relaxation path is not to remove hard money-critical guards. It is to test narrow, replay/runtime-backed pockets and keep them behind shadow/gates before promotion.

## Runtime Guard Order

### 1. Auto pipeline scheduling and proceed gates

Source:

- `packages/server/src/config.ts`
- `packages/server/src/lib/server-pipeline-gates.ts`
- `packages/server/src/lib/server-pipeline.ts`

Current defaults:

| Guard | Current value / behavior | Effect |
| --- | --- | --- |
| `PIPELINE_MIN_CONFIDENCE` | `7` | Parsed AI bet and condition-triggered bet must meet this before save. |
| `PIPELINE_MIN_ODDS` | `1.5` | Any saved recommendation must have mapped provider odds >= 1.5. |
| `PIPELINE_MIN_MINUTE` | `5` | Auto pipeline does not run before minute 5. |
| `PIPELINE_MAX_MINUTE` | `85` | Auto pipeline does not run after minute 85. |
| `PIPELINE_SECOND_HALF_START_MINUTE` | `5` | 2H effective minimum is `45 + 5 = 50`. |
| `PIPELINE_REANALYZE_MIN_MINUTES` | `10`, dynamically lowered by phase | Avoids repeated LLM calls when nothing meaningful changed. |
| `PIPELINE_STALENESS_ODDS_DELTA` | `0.1` | Odds movement above threshold can reopen analysis. |

Proceed/staleness blockers:

- Status must be live (`1H`, `2H`) in `checkShouldProceedServer`.
- Minute must be inside configured window.
- Early poor stats can block auto analysis.
- Re-analysis is skipped when score/status/stats/odds have not changed enough.
- Goals, red cards, score change, phase change, odds movement, or enough time elapsed can reopen analysis.

Relaxation read:

- These are mostly cost and freshness guards, not betting policy.
- Relaxing them increases LLM calls and Watch/No Action volume more than bet volume.
- Good candidate after runtime data: shorter cooldown / broader staleness reopen for watched matches only.

## 2. LLM eligibility gateway

Source:

- `resolveLlmEligibility()` in `packages/server/src/lib/server-pipeline.ts`

Auto LLM is blocked when:

- No active watch subscription.
- Match is not live for auto pipeline.
- Minute is outside auto window.
- Evidence mode is `low_evidence` and no custom condition / structured prematch Ask AI.
- Evidence mode is not `full_live_data` and no custom condition / structured prematch Ask AI.
- No tradable canonical market is available.
- Auto LLM cooldown is active after recent no-bet or policy-blocked output.

Manual/force/shadow/replay flows bypass parts of this gateway.

Relaxation read:

- This layer is a good place to improve product presence without creating unsafe bets.
- Candidate: allow more degraded-evidence LLM calls only as Watch/No Action, while keeping `final_should_bet=false` unless full save guards pass.
- Do not bypass `no_tradable_canonical_market` for saved recommendations.

## 3. Evidence mode and market allowlist

Source:

- `deriveEvidenceMode()` in `packages/server/src/lib/server-pipeline.ts`
- `packages/server/src/lib/evidence-mode-market-allowlist.ts`
- prompt evidence tier sections in `packages/server/src/lib/live-analysis-prompt.ts`

Runtime evidence modes:

| Evidence mode | Condition | Current market allowance |
| --- | --- | --- |
| `full_live_data` | stats + odds | All supported markets may be considered, still subject to policy. |
| `stats_only` | stats but no odds | No odds-dependent market is allowed by server allowlist. |
| `odds_events_only_degraded` | odds + events, no stats | Only `over_*`, `under_*`, `asian_handicap_*`. |
| `events_only_degraded` | events only | No actionable market. |
| `low_evidence` | no useful stats/odds/events | No actionable market. |

Prompt also tells Gemini:

- Tier 1 full live data is the normal path.
- Tier 2 stats-only is analytical/watch-oriented.
- Tier 3 odds+events is degraded and limited.
- Tier 4/low evidence is no-bet.

Relaxation read:

- Do not let `stats_only`, `events_only`, or `low_evidence` save bets without reliable odds.
- Possible narrow relaxation: allow `odds_events_only_degraded` AH/O-U with very small stake cap, but only after replay/runtime settlement proves it.

## 4. Prompt preflight and parse safety

Source:

- `buildRuntimePolicyPreflightSection()` in `packages/server/src/lib/live-analysis-prompt.ts`
- `parseAiResponse()` / parsed response normalization in `packages/server/src/lib/server-pipeline.ts`

Prompt tells Gemini not to output candidates that violate known hard gates. Server then enforces parse-level warnings:

| Warning | Meaning |
| --- | --- |
| `NO_SELECTION` | `should_push=true` but no selection. |
| `NO_BET_MARKET` | `should_push=true` but no market. |
| `ODDS_INVALID` | Selection cannot map to provider odds. |
| `CONFIDENCE_BELOW_MIN` | Confidence below min threshold. |
| `HIGH_RISK` | AI risk is `HIGH`. |
| `EDGE_BELOW_MIN` | Value percent below 3. |
| `MARKET_NOT_ALLOWED_FOR_EVIDENCE` | Market disallowed for evidence mode. |
| `1X2_TOO_EARLY` | Legacy early 1X2 guard in parse path. |

These warnings make `system_should_bet=false` and then `final_should_bet=false`.

Relaxation read:

- `HIGH_RISK`, `ODDS_INVALID`, `NO_SELECTION`, `NO_BET_MARKET`, and evidence mismatch should stay hard.
- `CONFIDENCE_BELOW_MIN` is tunable, but broad lowering from `7` to `6` is high-risk. Prefer market/segment-specific experiment with stake caps.
- `EDGE_BELOW_MIN` could be revisited only if value percent is noisy/unreliable, but then stake should be capped.

## 5. Line Ladder Patience

Source:

- `packages/server/src/lib/line-patience-policy.ts`
- optional override via `LINE_PATIENCE_CONFIG_PATH`

Default config:

| Guard | Default |
| --- | --- |
| Exceptional bypass | `full_live_data`, confidence >= `9`, value >= `8`. |
| Post-event cooldown | 3 minutes after goal/red card. |
| Goals Under blocked quarter lines | `0.5`, `0.75`. |
| Goals Under remap min minute | 60. |
| Goals Under min cushion | 1.0 for 45-74, 0.5 for 75+. |
| Goals Under block if remap fails | true. |
| Goals Over max conservative line | 1.0. |
| Corners Over preferred max line | 7.5. |
| AH chalk waits for O/U over line | main O/U over line must compress to <= 1.0. |

Important behavior:

- Under thin cushion can remap to a safer higher line or block.
- Over aggressive line can remap down or block.
- Corners Over above preferred line blocks.
- AH chalk blocks until the O/U ladder confirms compressed scoring runway.
- Some LLP blocks register a pending `thesis_watch` instead of killing the thesis forever.

Relaxation read:

- This is one of the better places to tune because it already has an override JSON and thesis-watch fallback.
- Safer candidates:
  - Increase `cornersOverPreferredMaxLine` only for segments with proven runtime ROI.
  - Adjust post-event cooldown per market rather than disabling it.
  - Keep Under cushion guards unless settlement data strongly supports a specific line/minute pocket.

## 6. Post-parse recommendation policy

Source:

- `packages/server/src/lib/recommendation-policy.ts`

### Global required conditions

For current prompt-policy spec, saveable bets generally require:

- `evidenceMode === full_live_data`
- directional gate satisfied
- break-even rate below `POLICY_REQUIRED_BREAKEVEN_MAX` default `0.50`
- late-game relaxation adds `0.05` in minute band `75+`

High-risk market families require break-even below `POLICY_HIGH_RISK_BREAKEVEN_MAX` default `0.48`, also with late relaxation.

There is a high-confidence AH protection pocket for positive AH lines <= 0.5 when confidence >= 8, value >= 8, full live data, directional gate true, and break-even < 0.55.

### Active hard market blocks

The version flags inside `recommendation-policy.ts` are currently all set to `true`, so these are active runtime rules:

- Unknown/unresolved market: `MARKET_UNRESOLVED`.
- Segment blocklist key match: `POLICY_BLOCK_SEGMENT_BLOCKLIST`.
- `1x2_draw`: always blocked.
- `1x2_home`: blocked before minute 75.
- `over_0.5`: blocked from minute 75 onward.
- `under_2.5`: blocked before minute 75.
- Goals Under 45-59 with two-plus margin.
- Goals Under 30-44 at 0-0 when line > 1.5.
- Goals Under 30-44 level/high-scoring when line > 4.
- Corners Over high lines pre-60 and stricter pre-30.
- Corners Under early high line pre-30.
- Goals Under early one-goal margin high line.
- Goals Under 45-59 at 0-0 low line.
- Goals Over 45-59 at 0-0 low line.
- Corners Over 45-59 one-goal high/extreme line.
- Props hot-zone low edge/confidence for corners and BTTS Yes.
- BTTS No pre-60, 60-74, low/high price, low edge, and both teams on target.
- BTTS Yes 30-59 requires dual threat; global one-side blank / low dual threat blocks.
- Goals Over one-goal margin long-runway pockets.
- `over_1.5` is no longer hard-blocked in minute 60-74 one-goal states by the dedicated late-midgame rule. It still must pass full evidence, confidence, break-even/edge, line-patience, memory, and same-thesis gates.
- `over_1.5` is hard-blocked from minute 85 onward via `POLICY_BLOCK_OVER_1_5_85_PLUS`.
- Goals Under thin-cushion low confidence pockets.
- HT Under tight line pre-22 / after early goal / low signal.
- AH home chalk low signal.
- AH home -0.25 early 0-0 low signal.
- Corners Under midgame goals / late one-goal low line.
- Medium-risk thin edge.
- Same-thesis count/stake cap.
- Goals Under rollover same-thesis block.

### Caps that do not block

- BTTS No confidence capped at 6.
- BTTS No stake capped at 2%.
- Goals Under thin-cushion stake can cap to 2.5%.
- Medium-risk stake can cap to 2.5%.
- Segment stake cap can lower stake by `minuteBand::marketFamily`.

Relaxation read:

- This is the main “silent” source after LLM chooses a market.
- Do not delete large blocks wholesale. The safer path is converting specific `POLICY_BLOCK_*` warnings into shadow candidates and then promoting only a narrow pocket after runtime settlement gates.
- Existing shadow pocket direction already exists for strict BTTS Yes, late Under 4.5, and Over 1.5. These should be the first candidates, not broad confidence lowering.

## 7. Performance memory override

Source:

- `finalizeParsedRecommendation()` in `packages/server/src/lib/server-pipeline.ts`

Runtime memory can block even after policy:

- Reliable sample and win rate < 40% blocks.
- Reliable sample and win rate < 45% blocks when break-even is missing or >= 0.46.
- Small sample win rate < 35% adds warning only.
- Missing memory adds `MEMORY_FLAG_NO_HISTORY`.

Relaxation read:

- Keep this enabled. It is one of the few guards based on TFI's own outcomes.
- If too silent, inspect memory coverage/sample reliability before changing thresholds.

## 8. Condition-triggered save policy

Source:

- `evaluateConditionTriggeredSaveDecision()` in `packages/server/src/lib/server-pipeline.ts`

Watch condition match can alert, but saving a bet requires:

- condition was evaluated and matched
- non-empty `condition_triggered_suggestion`
- suggestion is not `No bet...`
- market normalizes successfully
- line patience passes
- live odds map and odds >= min odds
- condition confidence >= min confidence
- post-parse recommendation policy passes
- save integrity passes

If any save guard fails, it remains a Watch alert / condition-only delivery.

Relaxation read:

- This is correctly conservative. It should be relaxed only by improving suggestions and line-specific evidence, not by bypassing odds/policy.

## 9. Same-thesis and duplicate controls

Source:

- `getCorrelatedThesis()` and same-thesis gates in `recommendation-policy.ts`
- DB unique-key upsert in `packages/server/src/repos/recommendations.repo.ts`

Current exposure controls:

- Max 2 non-duplicate rows in same correlated thesis.
- Max combined same-thesis stake 10%.
- Duplicate market key upserts existing recommendation instead of creating endless rows.

Relaxation read:

- Keep these. If users want more action, expose more Watch alerts, not repeated same-thesis bets.

## 10. Save integrity

Source:

- `evaluateRecommendationSaveIntegrity()` in `packages/server/src/lib/server-pipeline.ts`

Saved recommendation is blocked when:

- missing selection or market
- mapped provider odd is null
- mapped provider odd is below min odds

If save-integrity fails for a primary AI bet, notification can be disabled. For condition-triggered alert, it can still notify as condition-only.

Relaxation read:

- Do not loosen. This is money-critical provider correctness.

## 11. Segment policy overlays

Source:

- `SEGMENT_POLICY_BLOCKLIST_PATH`
- `SEGMENT_POLICY_STAKE_CAP_PATH`
- `packages/server/src/lib/segment-policy-blocklist.ts`
- `packages/server/src/lib/load-segment-policy-blocklist.ts`
- `packages/server/src/lib/load-segment-policy-stake-cap.ts`

Shape:

- Segment key = `minuteBand::marketFamily`
- Blocklist blocks persistence.
- Stake cap lowers exposure but does not block.

Relaxation read:

- If a segment blocklist exists in production, review it first; it can silently block a whole minute/market family.
- Prefer stake cap over blocklist for uncertain segments.

## Candidate Relaxation Strategy

### Keep hard

Do not relax these without a very explicit product decision:

- unknown market / failed normalization
- missing mapped provider odds
- odds below min odds
- evidence-mode market mismatch
- high risk persistence
- save integrity
- browser/provider boundary
- same-thesis stake/count cap

### Review first

These are likely contributors to silence and can be reviewed with data:

- `POLICY_REQUIRED_BREAKEVEN_MAX` and late relaxation.
- `POLICY_HIGH_RISK_BREAKEVEN_MAX` only for markets currently tagged high risk but showing strong runtime ROI.
- `LINE_PATIENCE_CONFIG_PATH` values for corners-over and over/under remap.
- `PIPELINE_MIN_CONFIDENCE` only via narrow market/segment experiment, not global lowering.
- `resolveLlmEligibility()` degraded-evidence gating for Watch/No Action visibility.
- Runtime policy-shadow pockets:
  - BTTS Yes 60-74, two-plus margin, full live data, odds >= 2.05.
  - Late Under 4.5 75+, two-plus margin, exactly 4 goals, odds >= 2.00.
  - Over 1.5 60-74, one-goal margin, full live data, odds >= 1.50.

### Recommended order

1. Run current-runtime no-save and blocked-selection reports after live data accumulates.
2. Read policy-warning counts before touching thresholds.
3. Pick one narrow pocket, not a global policy.
4. Shadow it first and settle blocked selections.
5. If gates pass, promote with a stake cap.
6. Keep Watch/No Action visible so product utility does not depend solely on bet frequency.

## Operational Commands

Useful read order:

```powershell
npm run data-driven:pipeline-liveness --prefix packages/server
npm run data-driven:current-runtime-no-save --prefix packages/server
npm run data-driven:current-runtime-blocked-selection --prefix packages/server
npm run data-driven:check-current-runtime-blocked-selection-gates --prefix packages/server
npm run data-driven:policy-shadow-suite --prefix packages/server
npm run data-driven:check-runtime-policy-shadow-settlement-gates --prefix packages/server
npm run data-driven:check-runtime-policy-shadow-skipped-settlement-gates --prefix packages/server
```

For replay sanity:

```powershell
npm run data-driven:improvement-run --prefix packages/server
npm run data-driven:verify-gates-ci --prefix packages/server
```
