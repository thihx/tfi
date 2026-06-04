# BTTS Yes Medium-Edge Policy Audit

**Date:** 2026-06-04  
**Scope:** BTTS Yes, medium risk, value around 6-7, odds >= 2.0, especially minute 60-74 with a two-plus goal margin.

## Why this audit exists

The prematch profile real-LLM experiment surfaced one important case:

- `13398-1504825-67m-btts-yes`
- minute 67, score `0-2`
- market `btts_yes`
- odds `2.2`
- original result `win`

In the profile experiment:

- `full`: model selected `BTTS Yes @2.2`, policy blocked.
- `league-only`: model selected `BTTS Yes @2.20`, policy blocked.
- `team-only`: model selected `BTTS Yes @2.2`, policy passed and settled win.
- `none`: model did not select this market.

The decisive difference was small: `full` had `value_percent=6`, while `team-only` had `value_percent=7`. The global medium-risk thin-edge guard blocks `MEDIUM` selections with `0 < value_percent < 7`, so a 1-point LLM value estimate swing changed the final outcome.

## Commands run

Real LLM profile experiment:

```powershell
npm run data-driven:prematch-profile-experiment --prefix packages/server -- --lookback-days 60 --limit 160 --max-scenarios 20 --llm real --allow-real-llm --odds recorded --delay-ms 1200
```

The original command timed out after terminal timeout, but artifacts were partially written. Missing modes were resumed manually with the same scenario directory and `gemini-3.5-flash`.

Policy experiment on the real-LLM outputs:

```powershell
npm run data-driven:policy-experiment --prefix packages/server -- --cases-json replay-work/data-driven-runs/2026-06-04T08-21-57-125Z/prematch-profile-experiment/full/eval-cases.json --out-json replay-work/data-driven-runs/2026-06-04T08-21-57-125Z/prematch-profile-experiment/full/policy-experiment.json --stake-cap btts_yes_60_74_two_plus=1
```

Current-runtime blocked-selection review:

```powershell
npm run data-driven:current-runtime-blocked-selection --prefix packages/server -- --lookback-hours 1440 --max-rows 1000 --stake-percent 1 --out-json replay-work/btts-edge-audit-20260604/current-runtime-blocked-selection.json --out-md replay-work/btts-edge-audit-20260604/current-runtime-blocked-selection.md
```

## Primary artifacts

```text
packages/server/replay-work/data-driven-runs/2026-06-04T08-21-57-125Z/prematch-profile-experiment/
packages/server/replay-work/btts-edge-audit-20260604/current-runtime-blocked-selection.json
packages/server/replay-work/btts-edge-audit-20260604/current-runtime-blocked-selection.md
```

## Real-LLM profile experiment result

20 settled scenarios, recorded odds, no live Football API calls:

| Mode | Push | No Bet | Win | Loss | ROI | PnL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `full` | 0 | 20 | 0 | 0 | 0 | 0 |
| `none` | 0 | 20 | 0 | 0 | 0 | 0 |
| `league-only` | 0 | 20 | 0 | 0 | 0 | 0 |
| `team-only` | 1 | 19 | 1 | 0 | 1.2 | 3 |

This is not enough sample to promote a policy change. It is enough to identify a narrow shadow candidate.

## Policy experiment result

On `full/eval-cases.json`:

- trusted counterfactual candidates: 2
- strict BTTS Yes pocket selected: 1
- strict BTTS Yes result: 1 win, 0 loss
- stake cap: 1%
- BTTS Yes pocket PnL: `+1.2%`
- warning: `POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL`

The selected BTTS Yes candidate:

```text
scenario: 13398-1504825-67m-btts-yes
minute: 67
score: 0-2
market: btts_yes
odds: 2.2
result: win
```

## Wider artifact scan

A scan across existing `eval-cases.json` artifacts found:

- raw target rows: 24
- unique target recommendations after dedupe: 5
- unique wins/losses: 2 wins, 3 losses
- unique strict pocket rows: 2
- unique strict pocket result: 1 win, 1 loss

Strict pocket means:

```text
canonicalMarket = btts_yes
minuteBand = 60-74
scoreState = two-plus-margin
evidenceMode = full_live_data
prematchStrength = strong
marketAvailabilityBucket = totals_only
odds >= 2.05
```

Unique strict rows:

| Recommendation | Minute | Score | Odds | Result |
| --- | ---: | --- | ---: | --- |
| `13398` | 67 | `0-2` | 2.20 | win |
| `13045` | 72 | `0-2` | 2.25 | loss |

This weakens the case for immediate policy relaxation.

## Current-runtime evidence

The 60-day current-runtime blocked-selection review found:

- total blocked selections: 39
- settled: 39
- total ROI: `-0.0687`
- BTTS rows: 1
- BTTS Yes rows: 0
- BTTS No rows: 1, settled win

So there is no current-runtime BTTS Yes settlement evidence yet. The BTTS Yes evidence is replay-only and small-sample.

## Conclusion

Do not loosen production policy yet.

The right next step is runtime shadow observation, not promotion:

- Keep current production save policy unchanged.
- Keep or add shadow tracking for `btts_yes_60_74_two_plus`.
- Require more settled runtime shadow rows before allowing save/notify.
- Treat `value_percent=6` vs `7` as a sensitivity issue worth monitoring, not as proof that the threshold is wrong.

Suggested promotion gate before considering policy relaxation:

```text
min settled strict BTTS Yes rows: 20
max losses: 7
min ROI on 1% stake cap: 0.15
required evidence source: runtime shadow settlement, not replay only
```

## Product implication

This pocket is a good candidate for `Watch` / `Signal` behavior:

- Do not promote directly to `Bet`.
- Show as watch alert when the model selects BTTS Yes but value is just below the policy edge threshold.
- Label the reason clearly: strong live pressure, price >= 2.05, but medium-risk edge is still near threshold.
