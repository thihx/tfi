# Prompt Replay Suite Report

- Total scenarios: 5
- Passed assertions: 5/5

| Scenario | Analysis Mode | Evidence Mode | Odds Source | Bet Market | Should Push | Selection | Confidence | Assertions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-early-full-data-no-1x2 | auto | full_live_data | live | over_1.5 | yes | Over 1.5 Goals @1.8 | 7 | pass |
| 02-low-trust-context-no-bet | auto | full_live_data | live | (none) | no | (none) | 0 | pass |
| 03-degraded-disallowed-markets | auto | odds_events_only_degraded | live | (none) | no | (none) | 0 | pass |
| 04-late-chaos-no-bet | auto | full_live_data | live | (none) | no | (none) | 0 | pass |
| 05-reinforcement-strengthened-edge | auto | full_live_data | live | over_2.5 | yes | Over 2.5 Goals @1.94 | 7 | pass |

## Details

### 01-early-full-data-no-1x2
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: full_live_data
- statsSource: api-football
- oddsSource: live
- betMarket: over_1.5
- shouldPush: true
- saved: false
- notified: false
- selection: Over 1.5 Goals @1.8
- confidence: 7
- reasoning_en: PSV is completely dominating the game with 68% possession, 11 shots (4 on target), and 6 corners within just 28 minutes. Utrecht is absorbing immense pressure and already has a defender on a yellow card. The match tempo is very high, producing nearly one shot every two minutes. Given the sheer volum...
- warnings: ["Early game (minute 28): match state is still settling, but shot volume heavily favors goals."]
- assertions: pass

### 02-low-trust-context-no-bet
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: full_live_data
- statsSource: api-football
- oddsSource: live
- betMarket: 
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- reasoning_en: The match is perfectly balanced at 1-1 with both teams having similar possession (51% vs 49%), shots (9 vs 8), and shots on target (3 vs 3). Neither team is demonstrating a clear edge that would justify backing a winner. Furthermore, the odds data shows BTTS Yes at 1.52 despite the score already bei...
- warnings: ["Suspicious BTTS odds (1.52 for BTTS Yes when score is already 1-1).","No clear momentum or statistical advantage for either team."]
- assertions: pass

### 03-degraded-disallowed-markets
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: odds_events_only_degraded
- statsSource: api-football
- oddsSource: live
- betMarket: 
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- reasoning_en: The match is currently in Tier 3 degraded mode with no live statistics (such as shots, possession, or dangerous attacks) available. The event timeline shows a 1-1 scoreline at minute 74, but the market odds for Under 2.5 Goals are unusually high (1.94) for this late stage. This discrepancy heavily i...
- warnings: ["Live match statistics are missing (Tier 3 degraded mode).","Under 2.5 Goals odds are suspiciously high for minute 74, indicating potential hidden match dynamics."]
- assertions: pass

### 04-late-chaos-no-bet
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: full_live_data
- statsSource: api-football
- oddsSource: live
- betMarket: 
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- reasoning_en: The match is in the 89th minute (endgame). Atalanta recently equalized at 87' despite being down to 10 men due to an 84' red card. The available odds for a Napoli win (2.22) or Over 4.5 goals (1.70) do not offer sufficient value given the extremely limited time remaining. Strict endgame parameters p...
- warnings: ["Endgame threshold reached (minute >= 88)","Red card: Atalanta received a red card at minute 84"]
- assertions: pass

### 05-reinforcement-strengthened-edge
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: full_live_data
- statsSource: api-football
- oddsSource: live
- betMarket: over_2.5
- shouldPush: true
- saved: false
- notified: false
- selection: Over 2.5 Goals @1.94
- confidence: 7
- reasoning_en: Following up on our previous recommendation for Over 2.5 Goals at minute 58 (when odds were 1.78), the underlying conditions have only solidified while the price has drifted to a very attractive 1.94. The match tempo remains exceptionally high with a combined 29 shots and 12 shots on target. Both Ma...
- warnings: ["Approaching the final 20 minutes, fatigue could start to impact the quality of finishing in transitions."]
- assertions: pass
