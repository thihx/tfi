# Historical Yield Replay

**Date:** 2026-06-04  
**Scope:** historical settled snapshots because recent runtime workload was low.  
**Prompt/policy tested:** `v10-hybrid-legacy-g` with recorded odds and production replay policy.

## Why This Run

Recent 1-2 weeks had low match workload, so current-runtime samples are too small for policy decisions. This run uses historical settled snapshots to stress-test yield and policy behavior on past data.

Important limitation:

- These historical recommendation rows are not official-prompt production rows.
- They are replay-ready snapshots from older prompt versions or empty prompt versions.
- Therefore, this evidence is valid for **stress-testing current prompt/policy on past contexts**, not for claiming production quality of `v10-hybrid-legacy-g`.

## Coverage

Command:

```powershell
npm run data-driven:coverage --prefix packages/server -- --lookback-days 180 --out-json ../../replay-work/audit/20260604-historical-yield/coverage-180d.json --out-md ../../replay-work/audit/20260604-historical-yield/coverage-180d.md
```

Key result:

| Metric | Value |
| --- | ---: |
| In 180-day window | 3,862 |
| Settled actionable | 2,748 |
| Export eligible | 2,748 |
| Replay-ready | 2,748 |
| Official prompt rows | 0 |

Read: historical sample depth is good, but it is not official-prompt production history.

## Historical Mock Replay

Two non-overlapping historical chunks were replayed:

| Run | Lookback | Offset | Limit | Max scenarios | LLM | Result |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `2026-06-03T17-44-21-561Z` | 180d | 0 | 300 | 120 | mock | 3/120 actionable |
| `2026-06-03T17-50-00-681Z` | 180d | 300 | 300 | 120 | mock | 0/120 actionable |

Commands:

```powershell
npm run data-driven:replay-batch --prefix packages/server -- --lookback-days 180 --limit 300 --max-scenarios 120 --llm mock --delay-ms 0 --odds recorded --apply-replay-policy

npm run data-driven:replay-batch --prefix packages/server -- --lookback-days 180 --limit 300 --offset 300 --max-scenarios 120 --llm mock --delay-ms 0 --odds recorded --apply-replay-policy
```

Combined result:

| Metric | Value |
| --- | ---: |
| Total scenarios | 240 |
| Actionable | 3 |
| Push rate | 1.25% |
| Original directional wins | 113 |
| Original directional losses | 114 |
| Original wins replayed | 2 |
| Original losses replayed | 0 |
| Win recall | 1.77% |
| Loss replay rate | 0% |

Read:

- Current policy is extremely conservative on historical data too.
- It avoids losses very well in this sample.
- It also misses almost all historical winners.
- This confirms product-yield risk independent of recent low workload.

## Broad Policy Loosen Simulation

Across both historical chunks, there were 210 trusted policy-blocked candidates: model/structural replay had a resolved market matching the original market, but production policy blocked it.

If all trusted policy-blocked candidates were hypothetically allowed at 1% stake:

| Metric | Value |
| --- | ---: |
| Candidates | 210 |
| Wins / losses / push | 95 / 103 / 12 |
| P/L | -19.7625% |
| ROI | -9.41% |

Read: broad loosening is not justified. The current policy blocks a lot of losing exposure.

By family:

| Family | Total | Wins | Losses | Push | ROI |
| --- | ---: | ---: | ---: | ---: | ---: |
| corners | 60 | 27 | 30 | 3 | -8.01% |
| goals_under | 49 | 22 | 27 | 0 | -4.34% |
| goals_over | 48 | 22 | 26 | 0 | -29.37% |
| asian_handicap | 28 | 9 | 10 | 9 | -4.82% |
| btts | 24 | 14 | 10 | 0 | +6.94% |

## Narrow Pocket Experiments

Policy experiment commands:

```powershell
npm run data-driven:policy-experiment --prefix packages/server -- --cases-json replay-work/data-driven-runs/2026-06-03T17-44-21-561Z/eval-cases.json --out-json replay-work/data-driven-runs/2026-06-03T17-44-21-561Z/policy-experiment.json

npm run data-driven:policy-experiment --prefix packages/server -- --cases-json replay-work/data-driven-runs/2026-06-03T17-50-00-681Z/eval-cases.json --out-json replay-work/data-driven-runs/2026-06-03T17-50-00-681Z/policy-experiment.json
```

Combined configured-pocket results:

| Pocket | Count | Wins | Losses | P/L | ROI | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `over_15_60_74_one_goal` | 6 | 5 | 1 | +1.815% | +30.25% | Shadow/watch candidate, not promote. |
| `btts_yes_60_74_two_plus` | 2 | 1 | 1 | +0.20% | +10.00% | Too unstable. |
| `late_under_45_two_plus` | 1 | 1 | 0 | +1.025% | +102.50% | Too small. |

The most credible historical hypothesis is:

- `Over 1.5`
- minute band `60-74`
- `one-goal-margin`
- resolved model/policy mismatch
- odds >= 1.50
- stake cap 1%

However, it still has only 6 matched historical candidates across the two chunks, so it does not meet promotion requirements.

## Real Gemini Targeted Check

To avoid relying only on mock replay, I ran a small real Gemini replay targeted to historical `goals_over`.

Command:

```powershell
npm run data-driven:replay-batch --prefix packages/server -- --lookback-days 180 --limit 120 --market-family goals_over --max-scenarios 8 --llm real --allow-real-llm --delay-ms 500 --odds recorded --apply-replay-policy
```

Run:

- `packages/server/replay-work/data-driven-runs/2026-06-03T17-56-12-270Z`

Result:

| Metric | Value |
| --- | ---: |
| Scenarios | 8 |
| Actionable | 0 |
| Policy experiment trusted candidates | 0 |
| `model_no_bet` | 6 |
| `pre_llm_blocked` | 2 |

Read:

- The positive mock `Over 1.5` pocket does not automatically survive real Gemini behavior.
- Real Gemini mostly returns intentional no-bet for these historical `goals_over` contexts.
- Therefore, this pocket should become a Watch/shadow prompt experiment, not a production policy loosen.

## Decision

Do not loosen global policy.

Do next:

1. Productize `Bet / Watch / No Action` so historical/current no-bet analyses still produce visible value.
2. Add a shadow/watch experiment for `Over 1.5`, minute `60-74`, one-goal margin.
3. Keep broad goals-over, corners, thin-cushion under, BTTS No, and confidence-below-min blocks active.
4. Require real runtime settlement before any promotion:
   - at least 20 settled candidates
   - at least 5 unique matches
   - positive ROI after 1% stake cap
   - no single match contributes more than 35% of pocket P/L
   - real Gemini must produce candidates, not only mock replay.

