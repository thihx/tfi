# Current Runtime No-Save Diagnostics

- Generated: 2026-06-03T15:22:11.929Z
- Lookback hours: 336
- Official prompt version: v10-hybrid-legacy-g
- Parse diagnostics: 5
- Parse actionable: 0
- Parse skipped: 5
- Match analyzed: 133
- Match analyzed saved: 0
- Match analyzed should push: 0
- Match analyzed save blocked: 0

## LLM Decision Diagnostics

| Diagnostic | Count | Latest at |
| --- | ---: | --- |
| no_bet_intentional | 5 | 2026-06-03T01:08:03.819Z |

## Market Resolution

| Status | Count | Latest at |
| --- | ---: | --- |
| not_requested | 5 | 2026-06-03T01:08:03.819Z |

## Evidence Modes

| Mode | Count | Latest at |
| --- | ---: | --- |
| full_live_data | 71 | 2026-06-03T01:08:03.830Z |
| odds_events_only_degraded | 64 | 2026-06-02T18:26:54.036Z |
| events_only_degraded | 3 | 2026-06-02T13:29:07.137Z |

## Policy Warnings

| Warning | Count | Latest at |
| --- | ---: | --- |
| MARKET_UNRESOLVED | 99 | 2026-06-03T01:08:03.830Z |
| REQUIRED_CONDITIONS_NOT_MET | 31 | 2026-06-02T17:44:16.582Z |
| MEMORY_FLAG_NO_HISTORY | 27 | 2026-06-02T16:41:07.441Z |
| POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL | 25 | 2026-06-02T17:44:16.582Z |
| POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL | 17 | 2026-06-02T17:44:16.582Z |
| POLICY_BLOCK_AH_HOME_CHALK_LOW_SIGNAL_GLOBAL | 3 | 2026-06-01T17:24:10.039Z |
| HIGH_MARGIN_MIDGAME_BLOCK | 2 | 2026-06-01T18:17:57.629Z |
| HIGH_RISK_MARKET_BREAKEVEN_TOO_HIGH | 2 | 2026-06-02T17:11:26.942Z |
| OVER_1_5_BLOCKED_LATE_MIDGAME | 2 | 2026-06-02T17:35:21.521Z |
| POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_LOW_CUSHION_V10D | 2 | 2026-06-01T18:17:57.629Z |
| POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_MARGIN_V8D | 2 | 2026-06-01T18:17:57.629Z |
| POLICY_BLOCK_GOALS_UNDER_MID_LATE_THIN_CUSHION_LOW_CONF_GLOBAL | 2 | 2026-06-01T18:17:57.629Z |
| POLICY_BLOCK_HT_UNDER_TIGHT_LOW_SIGNAL_GLOBAL | 2 | 2026-06-02T16:32:27.266Z |
| BTTS_NO_BLOCKED_GOAL_MARGIN | 1 | 2026-06-02T17:11:26.942Z |
| ONE_GOAL_MIDGAME_INSUFFICIENT_CONFIDENCE | 1 | 2026-06-02T16:41:07.441Z |
| POLICY_BLOCK_BTTS_NO_PRE60_V10C | 1 | 2026-06-02T17:11:26.942Z |
| POLICY_CAP_BTTS_NO_CONFIDENCE | 1 | 2026-06-02T17:11:26.942Z |
| POLICY_CAP_BTTS_NO_STAKE | 1 | 2026-06-02T17:11:26.942Z |

## Parse Cross Breakdown

| Diagnostic | Market status | Policy blocked | Evidence mode | Count | Latest at |
| --- | --- | --- | --- | ---: | --- |
| no_bet_intentional | not_requested | true | full_live_data | 5 | 2026-06-03T01:08:03.819Z |

## Pipeline Outcome Breakdown

| Saved | Should push | Save integrity | Provider coverage | Diagnostic | Count | Latest at |
| --- | --- | --- | --- | --- | ---: | --- |
| false | false | unknown | unknown | unknown | 125 | 2026-06-02T17:46:17.921Z |
| false | false | not_attempted | unknown | no_bet_intentional | 8 | 2026-06-03T01:08:03.830Z |

## Recent Samples

| ID | Timestamp | Action | Match | Diagnostic | Market status | Policy blocked | Selection | Warnings |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1261442 | 2026-06-03T01:08:03.830Z | PIPELINE_MATCH_ANALYZED | Haiti vs New Zealand | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED |
| 1261441 | 2026-06-03T01:08:03.819Z | LLM_PARSE_DIAGNOSTIC | (empty) | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED; MARKET_UNRESOLVED |
| 1260418 | 2026-06-02T20:27:13.208Z | PIPELINE_MATCH_ANALYZED | Wales vs Ghana | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED |
| 1260416 | 2026-06-02T20:27:13.133Z | LLM_PARSE_DIAGNOSTIC | (empty) | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED; MARKET_UNRESOLVED |
| 1260338 | 2026-06-02T20:14:55.800Z | PIPELINE_MATCH_ANALYZED | Wales vs Ghana | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED |
| 1260337 | 2026-06-02T20:14:55.795Z | LLM_PARSE_DIAGNOSTIC | (empty) | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED; Low shot-on-target efficiency from both sides (4 total SOT in 67 minutes).; High volume of substitutions (6 players) around the 60th minute may disrupt match rhythm.; MARKET_UNRESOLVED |
| 1260306 | 2026-06-02T20:10:18.796Z | PIPELINE_MATCH_ANALYZED | Wales vs Ghana | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED |
| 1260304 | 2026-06-02T20:10:18.718Z | LLM_PARSE_DIAGNOSTIC | (empty) | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED; MARKET_UNRESOLVED |
| 1260230 | 2026-06-02T19:57:47.703Z | PIPELINE_MATCH_ANALYZED | Wales vs Ghana | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED |
| 1260229 | 2026-06-02T19:57:47.698Z | LLM_PARSE_DIAGNOSTIC | (empty) | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED; MARKET_UNRESOLVED |
| 1260160 | 2026-06-02T19:42:38.356Z | PIPELINE_MATCH_ANALYZED | Wales vs Ghana | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED |
| 1260141 | 2026-06-02T19:37:02.563Z | PIPELINE_MATCH_ANALYZED | Wales vs Ghana | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED |
| 1259820 | 2026-06-02T18:26:54.036Z | PIPELINE_MATCH_ANALYZED | Georgia vs Romania | no_bet_intentional | not_requested | true | (empty) | MARKET_UNRESOLVED |
| 1259660 | 2026-06-02T17:46:17.921Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259655 | 2026-06-02T17:45:14.656Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259650 | 2026-06-02T17:44:16.582Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Under 1.5 Goals @1.525 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL |
| 1259646 | 2026-06-02T17:43:25.156Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Under 1.5 Goals @1.6 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 1259641 | 2026-06-02T17:42:22.822Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Under 1.5 Goals @1.625 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 1259636 | 2026-06-02T17:41:17.479Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Under 1.5 Goals @1.675 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 1259629 | 2026-06-02T17:39:21.575Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Under 1.5 Goals @1.775 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 1259615 | 2026-06-02T17:36:52.982Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Under 1.5 Goals @1.85 | POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 1259609 | 2026-06-02T17:35:21.521Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Over 1.5 Goals @1.9 | REQUIRED_CONDITIONS_NOT_MET; OVER_1_5_BLOCKED_LATE_MIDGAME; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL |
| 1259601 | 2026-06-02T17:33:20.670Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Under 1.5 Goals @1.95 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL |
| 1259593 | 2026-06-02T17:31:30.782Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259586 | 2026-06-02T17:29:32.612Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259578 | 2026-06-02T17:27:28.347Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259566 | 2026-06-02T17:25:25.248Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Over 1.5 Goals @1.55 | REQUIRED_CONDITIONS_NOT_MET; OVER_1_5_BLOCKED_LATE_MIDGAME |
| 1259559 | 2026-06-02T17:23:24.683Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259549 | 2026-06-02T17:21:31.368Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259543 | 2026-06-02T17:19:31.283Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259534 | 2026-06-02T17:17:25.223Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259524 | 2026-06-02T17:15:34.288Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259517 | 2026-06-02T17:13:31.171Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259508 | 2026-06-02T17:11:26.942Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | BTTS No @1.833 | REQUIRED_CONDITIONS_NOT_MET; HIGH_RISK_MARKET_BREAKEVEN_TOO_HIGH; BTTS_NO_BLOCKED_GOAL_MARGIN; POLICY_BLOCK_BTTS_NO_PRE60_V10C; POLICY_CAP_BTTS_NO_CONFIDENCE; POLICY_CAP_BTTS_NO_STAKE |
| 1259325 | 2026-06-02T16:47:07.983Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259308 | 2026-06-02T16:43:27.054Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259215 | 2026-06-02T16:41:07.441Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | Home 1.25 @1.55 | REQUIRED_CONDITIONS_NOT_MET; ONE_GOAL_MIDGAME_INSUFFICIENT_CONFIDENCE; MEMORY_FLAG_NO_HISTORY |
| 1259200 | 2026-06-02T16:37:25.969Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1259180 | 2026-06-02T16:32:27.266Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | H1 Under 0.5 Goals @1.525 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_HT_UNDER_TIGHT_LOW_SIGNAL_GLOBAL |
| 1259162 | 2026-06-02T16:27:28.550Z | PIPELINE_MATCH_ANALYZED | Croatia vs Belgium | (empty) | (empty) | true | H1 Under 0.5 Goals @1.727 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_HT_UNDER_TIGHT_LOW_SIGNAL_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL |
| 1258039 | 2026-06-02T13:29:07.137Z | PIPELINE_MATCH_ANALYZED | Brunei vs Timor-Leste | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1257936 | 2026-06-02T13:02:36.502Z | PIPELINE_MATCH_ANALYZED | Brunei vs Timor-Leste | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1257874 | 2026-06-02T12:46:07.665Z | PIPELINE_MATCH_ANALYZED | Brunei vs Timor-Leste | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1253808 | 2026-06-01T18:46:32.404Z | PIPELINE_MATCH_ANALYZED | Norway vs Sweden | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1253801 | 2026-06-01T18:45:35.564Z | PIPELINE_MATCH_ANALYZED | Norway vs Sweden | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1253797 | 2026-06-01T18:44:36.682Z | PIPELINE_MATCH_ANALYZED | Norway vs Sweden | (empty) | (empty) | true | Under 4.5 Goals @1.6 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; MEMORY_FLAG_NO_HISTORY |
| 1253792 | 2026-06-01T18:43:42.366Z | PIPELINE_MATCH_ANALYZED | Norway vs Sweden | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1253788 | 2026-06-01T18:42:42.328Z | PIPELINE_MATCH_ANALYZED | Norway vs Sweden | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1253783 | 2026-06-01T18:41:59.472Z | PIPELINE_MATCH_ANALYZED | Norway vs Sweden | (empty) | (empty) | true | (empty) | MARKET_UNRESOLVED |
| 1253778 | 2026-06-01T18:40:51.035Z | PIPELINE_MATCH_ANALYZED | Norway vs Sweden | (empty) | (empty) | true | Under 4.5 Goals @1.8 | REQUIRED_CONDITIONS_NOT_MET; POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL; POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL; MEMORY_FLAG_NO_HISTORY |

