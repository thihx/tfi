# Missed Winner And Policy Block Case Review

**Run ID:** 20260603-120456  
**Scope:** 17 original winners missed by corrected real-Gemini replay, plus 1 original loser where Gemini selected a market but policy blocked it.  
**Source artifacts:**

- `replay-work/audit/20260603-120456/real-llm-aggregate.json`
- `replay-work/audit/20260603-120456/case-review-source.json`

## Executive Read

The 35-case aggregate shows zero actionable recommendations, but the 17 missed original winners should not be treated as 17 prompt failures.

Case-level review suggests:

- Strong calibration candidates: `3`
- Moderate review candidates: `3`
- Correct no-bet or likely thin/lucky historical wins: `9`
- Data/evidence-limited cases where strict no-bet remains justified: `2`
- Policy correctly saved a loss: `1`

Recommended posture: do not loosen global prompt or policy. Add targeted diagnostics and evaluate a small set of guarded exceptions.

## Classification Summary

| Bucket | Count | Cases | Interpretation |
|---|---:|---|---|
| Strong calibration candidate | 3 | `13398`, `13395`, `13381` | Gemini found a plausible value market or the live data strongly supports review. These deserve policy/prompt calibration experiments. |
| Moderate review candidate | 3 | `13402`, `13367`, `13370` | There is a plausible missed angle, but each has caveats: corner variance, same-thesis exposure, or market-specific policy risk. |
| Correct no-bet / thin-lucky winner | 9 | `13394`, `13392`, `13377`, `13378`, `13380`, `13385`, `13387`, `13369`, `13372` | Historical result was win, but pre-bet evidence was too thin, odds/value was weak, or exposure rules were doing useful risk control. |
| Evidence-limited no-bet | 2 | `13391`, `13390` | Memory was favorable, but live stats were unavailable. No global relaxation should be made from these cases. |
| Policy saved loss | 1 | `13375` | Gemini selected Under 2.5, policy blocked it, and original result lost. This supports keeping thin-cushion gates. |

## Strong Calibration Candidates

### `13398` - BTTS Yes, Fagiano Okayama vs Cerezo Osaka

- Minute/score: `67`, `0-2`
- Original market/result: `btts_yes`, `win`
- Gemini selection: `BTTS Yes @2.2`
- Policy result: blocked by `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL`
- Live evidence: home trailing but active, `10` shots, `4` shots on target, `6` corners; away had `3` shots on target.
- Memory: `btts_yes|60-74|two-plus-margin`, reliable, `13W/12L`, win rate `52%`.
- Odds: `2.20`, break-even about `45.5%`.

Assessment: this is the best BTTS calibration candidate. The edge is not huge, but the price plus trailing-team pressure makes the block worth reviewing.

Recommendation: test a narrow BTTS Yes exception only when odds are `>= 2.05`, trailing team has at least `4` shots on target or equivalent pressure, both teams have at least `2` shots on target, and memory is reliable. Keep stake capped.

### `13395` - Under 4.5, Portland Timbers vs San Jose Earthquakes

- Minute/score: `80`, `1-3`
- Original market/result: `under_4.5`, `win`
- Gemini selection: `Under 4.5 Goals @2.025`
- Policy result: blocked by `LLP_BLOCK_UNDER_THIN_CUSHION_NO_REMAP` and stake-cap policy.
- Live evidence: Portland had possession but only `4` shots on target from `11` attempts; San Jose already defending a two-goal lead.
- Memory: `under_4.5|75+|two-plus-margin`, reliable, `10W/4L`, win rate `71.4%`.
- Odds: `2.025`, break-even about `49.4%`.

Assessment: this is a real policy calibration candidate. The current hard block may be too strict when memory is reliable and price is above evens, but the market is still a late thin-cushion Under.

Recommendation: do not remove the thin-cushion guard. Test converting this exact pocket from hard block to low stake cap, for example max `1%`, only with reliable memory and odds `>= 2.00`.

### `13381` - Over 1.5, Sao Paulo vs Millonarios

- Minute/score: `61`, `1-0`
- Original market/result: `over_1.5`, `win`
- Gemini selection: `Over 1.5 Goals @1.55`
- Policy result: blocked by `LLP_BLOCK_OVER_AGGRESSIVE_LINE`, `OVER_1_5_BLOCKED_LATE_MIDGAME`, and thin-edge policy.
- Live evidence: combined xG about `2.11`, both teams had `3` shots on target, trailing away side still attacking.
- Memory: `over_1.5|60-74|one-goal-margin`, reliable, `72W/48L`, win rate `60%`.
- Odds: `1.55`, break-even about `64.5%`.

Assessment: this is a borderline value case. Gemini estimated true probability around `70%`, but memory alone is below break-even. The policy block is defensible unless xG/pressure features are explicitly trusted.

Recommendation: keep the existing block by default. If experimenting, require stronger live evidence than this case: high combined xG, both teams active, trailing team pressure, and confidence `>= 8`.

## Moderate Review Candidates

### `13402` - Corners Under 14.5, U.N.A.M. Pumas vs Cruz Azul

- Minute/score: `83`, `1-1`
- Original market/result: `corners_under_14.5`, `win`
- Current corners: `12`
- Odds: `1.975`
- Memory: `1W/0L`, not reliable.
- Prior exposure: existing Asian Handicap position from minute `55`.
- Gemini reason: chose to avoid new exposure and did not meaningfully evaluate the corners-under line.

Assessment: possible prompt attention gap for high-line late corners Under. However, memory is not reliable and corner markets are high variance.

Recommendation: add this to manual review, but do not change policy from one case. Improve replay diagnostics so "market unresolved/not requested" distinguishes true absence from model ignoring an available original market.

### `13367` - Corners Over 10.5, Nashville SC vs Los Angeles FC

- Minute/score: `60`, `3-1`
- Original market/result: `corners_over_10.5`, `win`
- Current corners: home `2`, away `5`, total `7`
- Odds: `2.10`
- Live evidence: LAFC chasing, `13` shots, `6` shots on target, `5` corners.
- Memory: `1W/0L`, not reliable.
- Prior exposure: existing H1 Over winner.

Assessment: plausible attacking/corner pressure, but the edge depends on a volatile corner market and unreliable memory.

Recommendation: review as a corners-specific calibration candidate only after collecting more corner-market cases. No global prompt change.

### `13370` - BTTS No, U.N.A.M. Pumas vs CF Pachuca

- Minute/score: `58`, `1-0`
- Original market/result: `btts_no`, `win`
- Odds: `1.80`
- Live evidence: away side had `1` shot, `1` shot on target, xG `0.01`; home dominated possession.
- Memory: reliable, `25W/16L`, win rate `61%`.
- Prior exposure: existing Home AH position already aligned with home-control thesis.
- Gemini reason: BTTS No blocked by one-goal-margin runtime policy and same-match exposure discipline.

Assessment: this looks like a valid micro-pocket, but it overlaps an existing home-control thesis. It is a better candidate for a stake-cap/exposure rule than for prompt loosening.

Recommendation: consider a BTTS No exception only if exposure-aware: allow tiny stake only when away xG is near zero, away shot volume is extremely low, and existing same-thesis exposure remains below cap.

## Correct No-Bet Or Thin-Lucky Historical Wins

### `13394` - Corners Under 6.5, San Diego vs Vancouver Whitecaps

- Minute/score: `76`, `1-4`
- Current corners: `4`
- Odds: `1.825`
- Caveats: red card, previous Goals Under exposure had already been breached, memory not reliable.

Assessment: despite winning, no-bet was prudent. Avoid chasing after breached thesis.

### `13392` - Under 4.0, Colorado Rapids vs FC Dallas

- Minute/score: `50`, `1-2`
- Odds: `3.10`
- Live evidence: MLS, trailing home team chasing, away highly efficient, `40+` minutes left.
- Memory: `4W/1L`, not reliable.

Assessment: final score made this look good, but pre-bet risk was high. Correct no-bet.

### `13377` - Under 2.5, Sichuan Jiuniu vs Dalian Zhixing

- Minute/score: `81`, `1-1`
- Odds: `1.625`
- Memory: reliable `60%`, break-even about `61.5%`.
- Prior exposure: earlier corner thesis had stalled.

Assessment: no value margin. Correct no-bet.

### `13378` - Away +0.5 AH, Qingdao Youth Island vs Beijing Guoan

- Minute/score: `64`, `0-0`
- Live evidence: away possession `65%` but only `1` shot on target.
- Memory: `1W/0L`, not reliable.
- Prior exposure: existing Away 0 position from minute `42`.

Assessment: same-thesis stacking guard is working. Correct no-bet.

### `13380` - Over 1.5, Qingdao Youth Island vs Beijing Guoan

- Minute/score: `74`, `1-0`
- Odds: `1.525`
- Memory: reliable `60%`, below break-even.
- Caveats: two existing away AH positions, red card, low price.

Assessment: won historically but not a good new entry. Correct no-bet.

### `13385` - Under 4.5, Deportivo Cuenca vs Deportivo Recoleta

- Minute/score: `69`, `2-2`
- Odds: `2.10`
- Live evidence: total xG `1.63` despite four goals, but one more goal kills the bet.
- Memory: `1W/0L`, not reliable.

Assessment: tempting anomaly bet, but too fragile. Correct no-bet.

### `13387` - Under 2.5, America de Cali vs Tigre

- Minute/score: `76`, `1-1`
- Odds: `1.625`
- Memory: reliable `60%`, below break-even.
- Live evidence: home had `15` shots and large possession, even if shot quality was low.

Assessment: low margin of safety. Correct no-bet.

### `13369` - Home 0 AH, U.N.A.M. Pumas vs CF Pachuca

- Minute/score: `38`, `0-0`
- Odds: `1.775`
- Live evidence: home had `70%` possession and `9` shots but `0` shots on target.
- Memory: not reliable, `3W/2L/3P`.
- Prior exposure: H1 Home 0 already active.

Assessment: same-thesis guard and shot-quality concern justify pass.

### `13372` - Under 1.5, U.N.A.M. Pumas vs CF Pachuca

- Minute/score: `81`, `1-0`
- Odds: `1.675`
- Memory: reliable `72%`.
- Live evidence: combined xG below `1.00`, only `2` total shots on target.
- Prior exposure: multiple active same-match positions, including BTTS No.

Assessment: as a standalone market this is attractive, but given existing BTTS No and AH exposure, no-bet is correct risk control.

## Evidence-Limited No-Bets

### `13391` - Under 0.5, Parceiro Nagano vs Ventforet Kofu

- Minute/score: `70`, `0-0`
- Odds: `1.75`
- Memory: reliable `58.8%`, roughly near break-even.
- Live stats: unavailable in replay scenario.
- Result: pre-LLM blocked.

Assessment: strict no-bet is correct with no live stats and thin edge.

### `13390` - Under 1.5, Dewa United vs Bali United

- Minute/score: `83`, `0-1`
- Odds: `1.75`
- Memory: reliable `72%`.
- Live stats: unavailable in replay scenario.
- Result: pre-LLM blocked.

Assessment: this is the stronger evidence-limited miss. It may justify a separate "reliable memory plus odds-events-only" experiment, but only with explicit degraded-evidence gates and tiny stake caps.

## Policy-Saved Loss

### `13375` - Under 2.5, Tianjin Teda vs Henan Jianye

- Minute/score: `77`, `1-1`
- Original market/result: `under_2.5`, `loss`
- Gemini selection: `Under 2.5 Goals @1.7`
- Policy result: blocked by thin-cushion, required-conditions, low-confidence, and medium-risk thin-edge guards.
- Memory: reliable `60%`, break-even about `58.8%`.
- Final: `1-2`

Assessment: this is an important counterexample. The exact kind of late level-score Under that looks statistically reasonable still lost. The policy block was useful.

## Product/Engineering Recommendations

1. Keep global conservatism for now. The 17 missed winners include many correct passes.
2. Add a replay report section for `model_selected_policy_blocked` cases with final outcome, warnings, odds, memory reliability, and value estimate.
3. Add explicit metrics for original-win recall and original-loss avoidance, but never optimize recall alone.
4. Test narrow candidate policies behind replay only:
   - BTTS Yes, 60-74, two-plus margin, trailing side pressure, odds `>= 2.05`, reliable memory, low stake cap.
   - Late Under 4.5, 75+, two-plus margin, odds `>= 2.00`, reliable memory `>= 65%`, convert hard block to stake cap rather than full allow.
   - Over 1.5, 60-74, one-goal margin, require stronger live xG/shot-on-target conditions and confidence `>= 8`.
5. Do not loosen:
   - same-thesis exposure limits
   - degraded-evidence pre-LLM blocks without stats
   - late level-score Under 2.5 thin-cushion block
   - corners markets based on one-off unreliable memory

## Decision

The current stack is probably over-conservative in a few narrow pockets, not broadly broken. The next implementation step should be metrics and replay experiments for the three strong candidates, not direct production policy loosening.
