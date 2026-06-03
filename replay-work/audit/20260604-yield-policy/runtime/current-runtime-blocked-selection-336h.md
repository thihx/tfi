# Current Runtime Blocked Selection Review

- Generated: 2026-06-03T15:22:11.801Z
- Lookback hours: 336
- Official prompt version: v10-hybrid-legacy-g
- Max rows scanned: 1000
- Counterfactual stake % per settled row: 1
- Blocked selections: 39
- Unique matches: 5
- Settled rows: 39
- Unresolved rows: 0
- Wins / losses / push-like: 20 / 18 / 1
- Total staked %: 39
- Total P/L %: -2.68
- ROI on staked: -0.0687
- Metadata gaps: llm=39, market=39, save=39, evidence=0

## By Canonical Market

| Key | Total | Settled | Wins | Losses | Push-like | Staked % | P/L % | ROI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| under_1.5 | 19 | 19 | 12 | 7 | 0 | 19 | 1.24 | 0.0653 |
| under_3.75 | 3 | 3 | 0 | 3 | 0 | 3 | -1.5 | -0.5 |
| ht_under_0.5 | 2 | 2 | 0 | 2 | 0 | 2 | -2 | -1 |
| over_1.5 | 2 | 2 | 2 | 0 | 0 | 2 | 1.45 | 0.725 |
| under_3.5 | 2 | 2 | 0 | 2 | 0 | 2 | -2 | -1 |
| under_4.5 | 2 | 2 | 2 | 0 | 0 | 2 | 1.4 | 0.7 |
| 1x2_home | 1 | 1 | 0 | 1 | 0 | 1 | -1 | -1 |
| asian_handicap_home_-0.5 | 1 | 1 | 1 | 0 | 0 | 1 | 0.83 | 0.83 |
| asian_handicap_home_-0.75 | 1 | 1 | 1 | 0 | 0 | 1 | 0.3 | 0.3 |
| asian_handicap_home_-2.5 | 1 | 1 | 0 | 1 | 0 | 1 | -1 | -1 |
| btts_no | 1 | 1 | 1 | 0 | 0 | 1 | 0.83 | 0.83 |
| ht_under_2.5 | 1 | 1 | 0 | 1 | 0 | 1 | -1 | -1 |
| over_2.5 | 1 | 1 | 1 | 0 | 0 | 1 | 0.77 | 0.77 |
| over_4.5 | 1 | 1 | 0 | 1 | 0 | 1 | -1 | -1 |
| under_4 | 1 | 1 | 0 | 0 | 1 | 1 | 0 | 0 |

## By Policy Warning

| Key | Total | Settled | Wins | Losses | Push-like | Staked % | P/L % | ROI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| REQUIRED_CONDITIONS_NOT_MET | 31 | 31 | 20 | 11 | 0 | 31 | 2.82 | 0.091 |
| MEMORY_FLAG_NO_HISTORY | 27 | 27 | 17 | 9 | 1 | 27 | 4.04 | 0.1496 |
| POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL | 25 | 25 | 14 | 11 | 0 | 25 | -0.36 | -0.0144 |
| POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL | 17 | 17 | 13 | 4 | 0 | 17 | 4.63 | 0.2724 |
| POLICY_BLOCK_AH_HOME_CHALK_LOW_SIGNAL_GLOBAL | 3 | 3 | 2 | 1 | 0 | 3 | 0.13 | 0.0433 |
| HIGH_MARGIN_MIDGAME_BLOCK | 2 | 2 | 0 | 1 | 1 | 2 | -0.5 | -0.25 |
| HIGH_RISK_MARKET_BREAKEVEN_TOO_HIGH | 2 | 2 | 2 | 0 | 0 | 2 | 1.6 | 0.8 |
| OVER_1_5_BLOCKED_LATE_MIDGAME | 2 | 2 | 2 | 0 | 0 | 2 | 1.45 | 0.725 |
| POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_LOW_CUSHION_V10D | 2 | 2 | 0 | 1 | 1 | 2 | -0.5 | -0.25 |
| POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_MARGIN_V8D | 2 | 2 | 0 | 1 | 1 | 2 | -0.5 | -0.25 |
| POLICY_BLOCK_GOALS_UNDER_MID_LATE_THIN_CUSHION_LOW_CONF_GLOBAL | 2 | 2 | 0 | 1 | 1 | 2 | -0.5 | -0.25 |
| POLICY_BLOCK_HT_UNDER_TIGHT_LOW_SIGNAL_GLOBAL | 2 | 2 | 0 | 2 | 0 | 2 | -2 | -1 |
| BTTS_NO_BLOCKED_GOAL_MARGIN | 1 | 1 | 1 | 0 | 0 | 1 | 0.83 | 0.83 |
| ONE_GOAL_MIDGAME_INSUFFICIENT_CONFIDENCE | 1 | 1 | 0 | 1 | 0 | 1 | -1 | -1 |
| POLICY_BLOCK_BTTS_NO_PRE60_V10C | 1 | 1 | 1 | 0 | 0 | 1 | 0.83 | 0.83 |
| POLICY_CAP_BTTS_NO_CONFIDENCE | 1 | 1 | 1 | 0 | 0 | 1 | 0.83 | 0.83 |
| POLICY_CAP_BTTS_NO_STAKE | 1 | 1 | 1 | 0 | 0 | 1 | 0.83 | 0.83 |

## By Evidence Mode

| Key | Total | Settled | Wins | Losses | Push-like | Staked % | P/L % | ROI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full_live_data | 24 | 24 | 5 | 18 | 1 | 24 | -12.82 | -0.5342 |
| odds_events_only_degraded | 15 | 15 | 15 | 0 | 0 | 15 | 10.14 | 0.676 |

## By Confidence Band

| Key | Total | Settled | Wins | Losses | Push-like | Staked % | P/L % | ROI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | 29 | 29 | 17 | 11 | 1 | 29 | 2.05 | 0.0707 |
| 7 | 6 | 6 | 0 | 6 | 0 | 6 | -6 | -1 |
| <6 | 4 | 4 | 3 | 1 | 0 | 4 | 1.27 | 0.3175 |

## By Match

| Key | Total | Settled | Wins | Losses | Push-like | Staked % | P/L % | ROI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Croatia vs Belgium | 13 | 13 | 3 | 10 | 0 | 13 | -7.72 | -0.5938 |
| Norway vs Sweden | 11 | 11 | 2 | 8 | 1 | 11 | -5.1 | -0.4636 |
| Bulgaria vs Montenegro | 7 | 7 | 7 | 0 | 0 | 7 | 4.48 | 0.64 |
| Vanraure Hachinohe vs Fukushima United | 5 | 5 | 5 | 0 | 0 | 5 | 3.76 | 0.752 |
| Slovakia vs Malta | 3 | 3 | 3 | 0 | 0 | 3 | 1.9 | 0.6333 |

## Rows

| Timestamp | Match | Market | Selection | Minute | Confidence | Odds | Result | P/L % | Status | Warnings |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| 2026-06-02T17:44:16.582Z | Croatia vs Belgium | under_1.5 | Under 1.5 Goals @1.525 |  | 7 | 1.525 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL |
| 2026-06-02T17:43:25.156Z | Croatia vs Belgium | under_1.5 | Under 1.5 Goals @1.6 |  | 6 | 1.6 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 2026-06-02T17:42:22.822Z | Croatia vs Belgium | under_1.5 | Under 1.5 Goals @1.625 |  | 7 | 1.625 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 2026-06-02T17:41:17.479Z | Croatia vs Belgium | under_1.5 | Under 1.5 Goals @1.675 |  | 7 | 1.675 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 2026-06-02T17:39:21.575Z | Croatia vs Belgium | under_1.5 | Under 1.5 Goals @1.775 |  | 7 | 1.775 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 2026-06-02T17:36:52.982Z | Croatia vs Belgium | under_1.5 | Under 1.5 Goals @1.85 |  | 6 | 1.85 | loss | -1 | settled_rules | POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 2026-06-02T17:35:21.521Z | Croatia vs Belgium | over_1.5 | Over 1.5 Goals @1.9 |  | 6 | 1.9 | win | 0.9 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; OVER_1_5_BLOCKED_LATE_MIDGAME; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL |
| 2026-06-02T17:33:20.670Z | Croatia vs Belgium | under_1.5 | Under 1.5 Goals @1.95 |  | 6 | 1.95 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 2026-06-02T17:25:25.248Z | Croatia vs Belgium | over_1.5 | Over 1.5 Goals @1.55 |  | 6 | 1.55 | win | 0.55 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; OVER_1_5_BLOCKED_LATE_MIDGAME |
| 2026-06-02T17:11:26.942Z | Croatia vs Belgium | btts_no | BTTS No @1.833 |  | 6 | 1.833 | win | 0.83 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; HIGH_RISK_MARKET_BREAKEVEN_TOO_HIGH; BTTS_NO_BLOCKED_GOAL_MARGIN; POLICY_BLOCK_BTTS_NO_PRE60_V10C |
| 2026-06-02T16:41:07.441Z | Croatia vs Belgium | 1x2_home | Home 1.25 @1.55 |  | 7 | 1.55 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; ONE_GOAL_MIDGAME_INSUFFICIENT_CONFIDENCE; MEMORY_FLAG_NO_HISTORY |
| 2026-06-02T16:32:27.266Z | Croatia vs Belgium | ht_under_0.5 | H1 Under 0.5 Goals @1.525 |  | 6 | 1.525 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_HT_UNDER_TIGHT_LOW_SIGNAL_GLOBAL |
| 2026-06-02T16:27:28.550Z | Croatia vs Belgium | ht_under_0.5 | H1 Under 0.5 Goals @1.727 |  | 6 | 1.727 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_HT_UNDER_TIGHT_LOW_SIGNAL_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL |
| 2026-06-01T18:44:36.682Z | Norway vs Sweden | under_4.5 | Under 4.5 Goals @1.6 |  | 6 | 1.6 | win | 0.6 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T18:40:51.035Z | Norway vs Sweden | under_4.5 | Under 4.5 Goals @1.8 |  | 6 | 1.8 | win | 0.8 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T18:39:15.806Z | Norway vs Sweden | over_4.5 | Over 4.5 Goals @1.85 |  | 6 | 1.85 | loss | -1 | settled_rules | POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T18:35:38.121Z | Norway vs Sweden | under_3.5 | Under 3.5 Goals @2.15 |  | 5 | 2.15 | loss | -1 | settled_rules | POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T18:32:16.474Z | Norway vs Sweden | under_3.75 | Under 3.75 Goals @2.1 |  | 6 | 2.1 | half_loss | -0.5 | settled_rules | POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T18:29:41.220Z | Norway vs Sweden | under_3.5 | Under 3.5 Goals @2.5 |  | 6 | 2.5 | loss | -1 | settled_rules | POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T18:27:39.880Z | Norway vs Sweden | under_3.75 | Under 3.75 Goals @2.15 |  | 6 | 2.15 | half_loss | -0.5 | settled_rules | POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T18:17:57.629Z | Norway vs Sweden | under_3.75 | Under 3.75 Goals @3.1 |  | 6 | 3.1 | half_loss | -0.5 | settled_rules | HIGH_MARGIN_MIDGAME_BLOCK; POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_MARGIN_V8D; POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_LOW_CUSHION_V10D; POLICY_BLOCK_GOALS_UNDER_MID_LATE_THIN_CUSHION_LOW_CONF_GLOBAL |
| 2026-06-01T18:13:43.422Z | Norway vs Sweden | under_4 | Under 4 Goals @3 |  | 6 | 3 | push | 0 | settled_rules | HIGH_MARGIN_MIDGAME_BLOCK; POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_MARGIN_V8D; POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_LOW_CUSHION_V10D; POLICY_BLOCK_GOALS_UNDER_MID_LATE_THIN_CUSHION_LOW_CONF_GLOBAL |
| 2026-06-01T17:40:23.326Z | Bulgaria vs Montenegro | under_1.5 | Under 1.5 Goals @1.5 |  | 5 | 1.5 | win | 0.5 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:39:33.749Z | Bulgaria vs Montenegro | under_1.5 | Under 1.5 Goals @1.525 |  | 6 | 1.525 | win | 0.52 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:38:33.269Z | Bulgaria vs Montenegro | under_1.5 | Under 1.5 Goals @1.575 |  | 6 | 1.575 | win | 0.57 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:37:22.406Z | Bulgaria vs Montenegro | under_1.5 | Under 1.5 Goals @1.625 |  | 6 | 1.625 | win | 0.63 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:35:31.204Z | Bulgaria vs Montenegro | under_1.5 | Under 1.5 Goals @1.675 |  | 6 | 1.675 | win | 0.68 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:34:07.425Z | Slovakia vs Malta | over_2.5 | Over 2.5 Goals @1.775 |  | 5 | 1.775 | win | 0.77 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; HIGH_RISK_MARKET_BREAKEVEN_TOO_HIGH; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:33:31.103Z | Bulgaria vs Montenegro | under_1.5 | Under 1.5 Goals @1.727 |  | 6 | 1.727 | win | 0.73 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:32:08.915Z | Norway vs Sweden | ht_under_2.5 | H1 Under 2.5 Goals @1.85 |  | 6 | 1.85 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:31:34.052Z | Bulgaria vs Montenegro | under_1.5 | Under 1.5 Goals @1.85 |  | 6 | 1.85 | win | 0.85 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:24:10.039Z | Norway vs Sweden | asian_handicap_home_-2.5 | Home -2.5 @1.925 |  | 7 | 1.925 | loss | -1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_AH_HOME_CHALK_LOW_SIGNAL_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T17:22:12.689Z | Slovakia vs Malta | asian_handicap_home_-0.5 | Home -0.5 @1.825 |  | 6 | 1.825 | win | 0.83 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_AH_HOME_CHALK_LOW_SIGNAL_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T16:44:41.722Z | Slovakia vs Malta | asian_handicap_home_-0.75 | Home -0.75 @1.6 |  | 6 | 1.6 | half_win | 0.3 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_AH_HOME_CHALK_LOW_SIGNAL_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T11:41:50.794Z | Vanraure Hachinohe vs Fukushima United | under_1.5 | Under 1.5 Goals @1.575 |  | 6 | 1.575 | win | 0.57 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T11:40:55.728Z | Vanraure Hachinohe vs Fukushima United | under_1.5 | Under 1.5 Goals @1.625 |  | 6 | 1.625 | win | 0.63 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T11:38:54.427Z | Vanraure Hachinohe vs Fukushima United | under_1.5 | Under 1.5 Goals @1.727 |  | 6 | 1.727 | win | 0.73 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T11:36:55.961Z | Vanraure Hachinohe vs Fukushima United | under_1.5 | Under 1.5 Goals @1.825 |  | 6 | 1.825 | win | 0.83 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 2026-06-01T11:31:58.448Z | Vanraure Hachinohe vs Fukushima United | under_1.5 | Under 1.5 Goals @2.0 |  | 5 | 2 | win | 1 | settled_rules | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |

