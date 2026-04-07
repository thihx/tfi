# Settled Replay Prompt Evaluation

- Generated: 2026-04-07T17:41:01.116Z
- Scenarios: 35
- Post-parse recommendation policy: applied (production parity)
- Prompt versions: v8-market-balance-followup-j

## v8-market-balance-followup-j

- Push rate: 51.43%
- No-bet rate: 48.57%
- Goals Under share: 11.11%
- Directional accuracy: 61.11% (11/18)
- Avg odds: 2.01
- Avg break-even required: 50.29%
- Total staked: 74.00 units
- Replay P/L: 18.78 units
- Replay ROI: 25.38%

### Side markets KPI (1X2 / Asian Handicap)

- 1X2 pushes: 0 (0.00% of actionable pushes, 0.00% of cohort)
- Asian Handicap pushes: 0 (0.00% of actionable pushes, 0.00% of cohort)

| Cohort | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Minute 00-29 | 8 | 5 | 3 | 0 | 1 | 0.00% | 60.00% | 1.87 | 53.67% | 8.18 | 43.05% |
| Minute 30-44 | 14 | 4 | 10 | 0 | 4 | 0.00% | 25.00% | 1.94 | 51.47% | -7.20 | -48.00% |
| Minute 45-59 | 6 | 2 | 4 | 0 | 0 | 0.00% | 100.00% | 2.17 | 47.03% | 7.90 | 112.86% |
| Minute 60-74 | 6 | 6 | 0 | 1 | 2 | 33.33% | 83.33% | 2.06 | 48.91% | 13.90 | 47.93% |
| Minute 75+ | 1 | 1 | 0 | 0 | 1 | 0.00% | 0.00% | 2.30 | 43.48% | -4.00 | -100.00% |

### Fine time windows (hotspot diagnosis)

| Window | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 15-29 | 8 | 5 | 3 | 0 | 1 | 0.00% | 60.00% | 1.87 | 53.67% | 8.18 | 43.05% |
| 30-36 | 8 | 1 | 7 | 0 | 1 | 0.00% | 0.00% | 2.00 | 50.00% | -3.00 | -100.00% |
| 37-44 | 6 | 3 | 3 | 0 | 3 | 0.00% | 33.33% | 1.93 | 51.96% | -4.20 | -35.00% |
| 45-52 | 4 | 2 | 2 | 0 | 0 | 0.00% | 100.00% | 2.17 | 47.03% | 7.90 | 112.86% |
| 53-59 | 2 | 0 | 2 | 0 | 0 | 0.00% | 0.00% | 0.00 | 0.00% | 0.00 | 0.00% |
| 60-69 | 4 | 4 | 0 | 1 | 1 | 50.00% | 75.00% | 2.13 | 47.17% | 6.15 | 34.17% |
| 70-74 | 2 | 2 | 0 | 0 | 1 | 0.00% | 100.00% | 1.93 | 52.38% | 7.75 | 70.45% |
| 75+ | 1 | 1 | 0 | 0 | 1 | 0.00% | 0.00% | 2.30 | 43.48% | -4.00 | -100.00% |

### By Evidence Mode

| Evidence Mode | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full_live_data | 35 | 18 | 17 | 1 | 8 | 11.11% | 61.11% | 2.01 | 50.29% | 18.78 | 25.38% |

### By Market Availability

| Availability | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| playable_side_market | 6 | 5 | 1 | 1 | 2 | 33.33% | 60.00% | 2.05 | 49.01% | 2.42 | 12.13% |
| side_market_unplayable | 6 | 4 | 2 | 0 | 0 | 0.00% | 75.00% | 2.20 | 45.99% | 8.90 | 59.33% |
| totals_only | 23 | 9 | 14 | 0 | 6 | 0.00% | 55.56% | 1.90 | 52.91% | 7.45 | 19.11% |

### By market family (actionable pushes only)

| Family | Pushes | Share of pushes | Push % of cohort | Wins | Losses | Win rate | Avg odds | Staked | P/L | ROI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| goals_over | 8 | 44.44% | 22.86% | 3 | 5 | 37.50% | 1.98 | 35.00 | -7.80 | -22.29% |
| corners | 5 | 27.78% | 14.29% | 5 | 0 | 100.00% | 2.11 | 22.00 | 23.63 | 107.39% |
| btts | 4 | 22.22% | 11.43% | 2 | 2 | 50.00% | 1.94 | 13.00 | 0.95 | 7.34% |
| goals_under | 1 | 5.56% | 2.86% | 1 | 0 | 100.00% | 2.00 | 4.00 | 2.00 | 50.00% |

### Top canonical markets (actionable pushes)

| Market | Family | Pushes | Push % of cohort | Wins | Losses | Win rate | Avg odds | Staked | P/L | ROI |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| over_2.25 | goals_over | 3 | 8.57% | 1 | 2 | 33.33% | 1.93 | 12.00 | -2.20 | -18.33% |
| btts_no | btts | 2 | 5.71% | 1 | 1 | 50.00% | 1.73 | 4.00 | -0.55 | -13.65% |
| btts_yes | btts | 2 | 5.71% | 1 | 1 | 50.00% | 2.15 | 9.00 | 1.50 | 16.67% |
| corners_under_8.5 | corners | 2 | 5.71% | 2 | 0 | 100.00% | 1.91 | 7.00 | 6.33 | 90.36% |
| corners_over_15 | corners | 1 | 2.86% | 1 | 0 | 100.00% | 2.25 | 4.00 | 5.00 | 125.00% |
| corners_over_7 | corners | 1 | 2.86% | 1 | 0 | 100.00% | 2.50 | 3.00 | 4.50 | 150.00% |
| corners_under_7.5 | corners | 1 | 2.86% | 1 | 0 | 100.00% | 1.98 | 8.00 | 7.80 | 97.50% |
| over_0.75 | goals_over | 1 | 2.86% | 1 | 0 | 100.00% | 2.05 | 6.00 | 3.15 | 52.50% |
| over_3 | goals_over | 1 | 2.86% | 0 | 1 | 0.00% | 1.95 | 4.00 | -4.00 | -100.00% |
| over_3.5 | goals_over | 1 | 2.86% | 0 | 1 | 0.00% | 2.30 | 4.00 | -4.00 | -100.00% |
| over_3.75 | goals_over | 1 | 2.86% | 1 | 0 | 100.00% | 1.75 | 6.00 | 2.25 | 37.50% |
| over_4.25 | goals_over | 1 | 2.86% | 0 | 1 | 0.00% | 2.00 | 3.00 | -3.00 | -100.00% |
| under_3.25 | goals_under | 1 | 2.86% | 1 | 0 | 100.00% | 2.00 | 4.00 | 2.00 | 50.00% |

### Minute band × market family (push rate in band, win rate, ROI)

| Minute | Family | Pushes | Band total | Push % in band | Wins | Losses | Win rate | Staked | P/L | ROI |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 00-29 | btts | 2 | 8 | 25.00% | 1 | 1 | 50.00% | 4.00 | -0.55 | -13.65% |
| 00-29 | corners | 2 | 8 | 25.00% | 2 | 0 | 100.00% | 11.00 | 10.72 | 97.50% |
| 00-29 | goals_over | 1 | 8 | 12.50% | 0 | 1 | 0.00% | 4.00 | -2.00 | -50.00% |
| 30-44 | goals_over | 4 | 14 | 28.57% | 1 | 3 | 25.00% | 15.00 | -7.20 | -48.00% |
| 45-59 | corners | 2 | 6 | 33.33% | 2 | 0 | 100.00% | 7.00 | 7.90 | 112.86% |
| 60-74 | btts | 2 | 6 | 33.33% | 1 | 1 | 50.00% | 9.00 | 1.50 | 16.67% |
| 60-74 | goals_over | 2 | 6 | 33.33% | 2 | 0 | 100.00% | 12.00 | 5.40 | 45.00% |
| 60-74 | corners | 1 | 6 | 16.67% | 1 | 0 | 100.00% | 4.00 | 5.00 | 125.00% |
| 60-74 | goals_under | 1 | 6 | 16.67% | 1 | 0 | 100.00% | 4.00 | 2.00 | 50.00% |
| 75+ | goals_over | 1 | 1 | 100.00% | 0 | 1 | 0.00% | 4.00 | -4.00 | -100.00% |

### Score state × market family

| Score state | Family | Pushes | Slice total | Push % in slice | Wins | Losses | Win rate | Staked | P/L | ROI |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0-0 | goals_over | 3 | 9 | 33.33% | 2 | 1 | 66.67% | 14.00 | 4.95 | 35.36% |
| 0-0 | btts | 2 | 9 | 22.22% | 1 | 1 | 50.00% | 4.00 | -0.55 | -13.65% |
| level | corners | 1 | 5 | 20.00% | 1 | 0 | 100.00% | 8.00 | 7.80 | 97.50% |
| level | goals_over | 1 | 5 | 20.00% | 0 | 1 | 0.00% | 3.00 | -3.00 | -100.00% |
| level | goals_under | 1 | 5 | 20.00% | 1 | 0 | 100.00% | 4.00 | 2.00 | 50.00% |
| one-goal-margin | goals_over | 4 | 15 | 26.67% | 1 | 3 | 25.00% | 18.00 | -9.75 | -54.17% |
| one-goal-margin | corners | 2 | 15 | 13.33% | 2 | 0 | 100.00% | 7.00 | 7.92 | 113.21% |
| two-plus-margin | btts | 2 | 6 | 33.33% | 1 | 1 | 50.00% | 9.00 | 1.50 | 16.67% |
| two-plus-margin | corners | 2 | 6 | 33.33% | 2 | 0 | 100.00% | 7.00 | 7.90 | 112.86% |
