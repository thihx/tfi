# Settled Replay Prompt Evaluation

- Generated: 2026-04-07T15:28:06.981Z
- Scenarios: 4
- Prompt versions: v8-market-balance-followup-h, v10-hybrid-legacy-b

## v8-market-balance-followup-h

- Push rate: 75.00%
- No-bet rate: 25.00%
- Goals Under share: 33.33%
- Directional accuracy: 66.67% (2/3)
- Avg odds: 1.94
- Avg break-even required: 51.57%
- Total staked: 9.00 units
- Replay P/L: 2.73 units
- Replay ROI: 30.33%

| Cohort | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Minute 30-44 | 1 | 0 | 1 | 0 | 0 | 0.00% | 0.00% | 0.00 | 0.00% | 0.00 | 0.00% |
| Minute 45-59 | 2 | 2 | 0 | 1 | 1 | 50.00% | 100.00% | 1.96 | 51.18% | 5.73 | 95.50% |
| Minute 60-74 | 1 | 1 | 0 | 0 | 1 | 0.00% | 0.00% | 1.91 | 52.36% | -3.00 | -100.00% |

### Fine time windows (hotspot diagnosis)

| Window | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 37-44 | 1 | 0 | 1 | 0 | 0 | 0.00% | 0.00% | 0.00 | 0.00% | 0.00 | 0.00% |
| 45-52 | 2 | 2 | 0 | 1 | 1 | 50.00% | 100.00% | 1.96 | 51.18% | 5.73 | 95.50% |
| 60-69 | 1 | 1 | 0 | 0 | 1 | 0.00% | 0.00% | 1.91 | 52.36% | -3.00 | -100.00% |

### By Evidence Mode

| Evidence Mode | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full_live_data | 4 | 3 | 1 | 1 | 2 | 33.33% | 66.67% | 1.94 | 51.57% | 2.73 | 30.33% |

### By Market Availability

| Availability | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| totals_only | 4 | 3 | 1 | 1 | 2 | 33.33% | 66.67% | 1.94 | 51.57% | 2.73 | 30.33% |

### By market family (actionable pushes only)

| Family | Pushes | Share of pushes | Push % of cohort | Wins | Losses | Win rate | Avg odds | Staked | P/L | ROI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| goals_over | 2 | 66.67% | 50.00% | 1 | 1 | 50.00% | 1.91 | 6.00 | -0.27 | -4.50% |
| goals_under | 1 | 33.33% | 25.00% | 1 | 0 | 100.00% | 2.00 | 3.00 | 3.00 | 100.00% |

### Top canonical markets (actionable pushes)

| Market | Family | Pushes | Push % of cohort | Wins | Losses | Win rate | Avg odds | Staked | P/L | ROI |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| over_2.5 | goals_over | 2 | 50.00% | 1 | 1 | 50.00% | 1.91 | 6.00 | -0.27 | -4.50% |
| under_3.5 | goals_under | 1 | 25.00% | 1 | 0 | 100.00% | 2.00 | 3.00 | 3.00 | 100.00% |

### Minute band × market family (push rate in band, win rate, ROI)

| Minute | Family | Pushes | Band total | Push % in band | Wins | Losses | Win rate | Staked | P/L | ROI |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 45-59 | goals_over | 1 | 2 | 50.00% | 1 | 0 | 100.00% | 3.00 | 2.73 | 91.00% |
| 45-59 | goals_under | 1 | 2 | 50.00% | 1 | 0 | 100.00% | 3.00 | 3.00 | 100.00% |
| 60-74 | goals_over | 1 | 1 | 100.00% | 0 | 1 | 0.00% | 3.00 | -3.00 | -100.00% |

### Score state × market family

| Score state | Family | Pushes | Slice total | Push % in slice | Wins | Losses | Win rate | Staked | P/L | ROI |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| level | goals_over | 2 | 3 | 66.67% | 1 | 1 | 50.00% | 6.00 | -0.27 | -4.50% |
| level | goals_under | 1 | 3 | 33.33% | 1 | 0 | 100.00% | 3.00 | 3.00 | 100.00% |

## v10-hybrid-legacy-b

- Push rate: 75.00%
- No-bet rate: 25.00%
- Goals Under share: 33.33%
- Directional accuracy: 66.67% (2/3)
- Avg odds: 1.94
- Avg break-even required: 51.57%
- Total staked: 9.00 units
- Replay P/L: 2.73 units
- Replay ROI: 30.33%

| Cohort | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Minute 30-44 | 1 | 0 | 1 | 0 | 0 | 0.00% | 0.00% | 0.00 | 0.00% | 0.00 | 0.00% |
| Minute 45-59 | 2 | 2 | 0 | 1 | 1 | 50.00% | 100.00% | 1.96 | 51.18% | 5.73 | 95.50% |
| Minute 60-74 | 1 | 1 | 0 | 0 | 1 | 0.00% | 0.00% | 1.91 | 52.36% | -3.00 | -100.00% |

### Fine time windows (hotspot diagnosis)

| Window | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 37-44 | 1 | 0 | 1 | 0 | 0 | 0.00% | 0.00% | 0.00 | 0.00% | 0.00 | 0.00% |
| 45-52 | 2 | 2 | 0 | 1 | 1 | 50.00% | 100.00% | 1.96 | 51.18% | 5.73 | 95.50% |
| 60-69 | 1 | 1 | 0 | 0 | 1 | 0.00% | 0.00% | 1.91 | 52.36% | -3.00 | -100.00% |

### By Evidence Mode

| Evidence Mode | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full_live_data | 4 | 3 | 1 | 1 | 2 | 33.33% | 66.67% | 1.94 | 51.57% | 2.73 | 30.33% |

### By Market Availability

| Availability | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| totals_only | 4 | 3 | 1 | 1 | 2 | 33.33% | 66.67% | 1.94 | 51.57% | 2.73 | 30.33% |

### By market family (actionable pushes only)

| Family | Pushes | Share of pushes | Push % of cohort | Wins | Losses | Win rate | Avg odds | Staked | P/L | ROI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| goals_over | 2 | 66.67% | 50.00% | 1 | 1 | 50.00% | 1.91 | 6.00 | -0.27 | -4.50% |
| goals_under | 1 | 33.33% | 25.00% | 1 | 0 | 100.00% | 2.00 | 3.00 | 3.00 | 100.00% |

### Top canonical markets (actionable pushes)

| Market | Family | Pushes | Push % of cohort | Wins | Losses | Win rate | Avg odds | Staked | P/L | ROI |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| over_2.5 | goals_over | 2 | 50.00% | 1 | 1 | 50.00% | 1.91 | 6.00 | -0.27 | -4.50% |
| under_3.5 | goals_under | 1 | 25.00% | 1 | 0 | 100.00% | 2.00 | 3.00 | 3.00 | 100.00% |

### Minute band × market family (push rate in band, win rate, ROI)

| Minute | Family | Pushes | Band total | Push % in band | Wins | Losses | Win rate | Staked | P/L | ROI |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 45-59 | goals_over | 1 | 2 | 50.00% | 1 | 0 | 100.00% | 3.00 | 2.73 | 91.00% |
| 45-59 | goals_under | 1 | 2 | 50.00% | 1 | 0 | 100.00% | 3.00 | 3.00 | 100.00% |
| 60-74 | goals_over | 1 | 1 | 100.00% | 0 | 1 | 0.00% | 3.00 | -3.00 | -100.00% |

### Score state × market family

| Score state | Family | Pushes | Slice total | Push % in slice | Wins | Losses | Win rate | Staked | P/L | ROI |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| level | goals_over | 2 | 3 | 66.67% | 1 | 1 | 50.00% | 6.00 | -0.27 | -4.50% |
| level | goals_under | 1 | 3 | 33.33% | 1 | 0 | 100.00% | 3.00 | 3.00 | 100.00% |
