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
- reasoning_en: PSV is dominating the match early on with 68% possession, 11 shots (4 on target), and 6 corners by minute 28. Utrecht's defense is under severe pressure, evidenced by their 8 fouls and an early yellow card to a defender. With over 60 minutes left to play, the offensive output strongly supports multi...
- warnings: ["Early game stage (minute 28) requires the teams to maintain current attacking intensity to clear the Over 1.5 line."]
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
- reasoning_en: At minute 64, the score is 1-1 and the match statistics are perfectly balanced (Possession 51-49%, Shots 9-8, SOT 3-3). The current tempo (17 shots in 64 minutes) is average and does not indicate a heavily attacking open game. For Over 2.5 Goals at odds of 1.93, the break-even rate is roughly 51.8%....
- warnings: ["Match stats are perfectly balanced, making 1X2 entirely unpredictable.","Shot tempo is average, offering no clear mathematical edge for Over 2.5 goals at the current price."]
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
- reasoning_en: The match is at the 74th minute with a 1-1 scoreline. The canonical odds for Over 2.5 goals are 1.92, which is exceptionally low for this late stage of the match (normally expected around 2.50 to 3.00+). This implies the market strongly anticipates another goal, possibly due to a recent penalty awar...
- warnings: ["Suspicious odds: Over 2.5 at 1.92 in the 74th minute at 1-1 is highly anomalous.","Data degradation: Tier 3 mode means no live stats to verify market expectations."]
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
- reasoning_en: The match is in its final moments (89th minute). While Atalanta recently suffered a red card (84') but managed to equalize (87'), the time remaining is extremely limited. The endgame protocol strictly advises against new investments after the 88th minute due to the unpredictable nature of stoppage t...
- warnings: ["Minute >= 88: Endgame phase, high unpredictability.","Red card detected for Atalanta at 84'."]
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
- reasoning_en: Following up on the previous recommendation at minute 58 for Over 2.5 Goals, the match conditions have remained highly favorable for a third goal. The current offensive output is extraordinary, with 29 total shots and 12 on target. Both sides are actively pushing for a winner, validating the pre-mat...
- warnings: ["Late mid-half phase: Only 24 minutes plus stoppage time remain to secure the single required goal."]
- assertions: pass
