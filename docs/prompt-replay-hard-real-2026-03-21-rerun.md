# Prompt Replay Suite Report

- Total scenarios: 5
- Passed assertions: 4/5

| Scenario | Analysis Mode | Evidence Mode | Odds Source | Bet Market | Should Push | Selection | Confidence | Assertions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-early-full-data-no-1x2 |  |  |  | (none) | no | (none) | 0 | fail |
| 02-low-trust-context-no-bet | auto | full_live_data | live | (none) | no | (none) | 0 | pass |
| 03-degraded-disallowed-markets | auto | odds_events_only_degraded | live | (none) | no | (none) | 0 | pass |
| 04-late-chaos-no-bet | auto | full_live_data | live | (none) | no | (none) | 0 | pass |
| 05-reinforcement-strengthened-edge | auto | full_live_data | live | over_2.5 | yes | Over 2.5 Goals @1.94 | 7 | pass |

## Details

### 01-early-full-data-no-1x2
- llmMode: real
- oddsMode: recorded
- analysisMode: 
- evidenceMode: 
- statsSource: 
- oddsSource: 
- betMarket: 
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- assertions: fail

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
- reasoning_en: At minute 64 with the score tied 1-1, both Trabzonspor and Kasimpasa display nearly identical statistics (9 vs 8 shots, 3 vs 3 shots on target, 51% vs 49% possession). The match tempo is moderate, suggesting neither team has a distinct attacking advantage. The Over/Under 2.5 line is perfectly balanc...
- warnings: ["Match is perfectly balanced; lacking statistical anomalies to exploit.","BTTS market is already resolved at 1-1; odds shown are anomalous or stale.","No market offers a mathematical edge of >3%."]
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
- reasoning_en: The match is tied 1-1 at minute 74. Operating under degraded evidence mode (Tier 3) without detailed live statistics such as shots on target, possession, or expected goals, we cannot confidently evaluate the remaining allowed markets (Asian Handicap or Over/Under). To justify Over 2.5 at 1.92, we wo...
- warnings: ["Degraded evidence mode (no live stats)","Approaching late game phase (minute 74)","Insufficient data to calculate true probabilities"]
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
- reasoning_en: The match is at minute 89. Atalanta equalized at 87' despite being down to 10 men following a red card at 84'. At this very late stage, any investment is extremely high risk and heavily dependent on stoppage time variance. According to strict endgame rules (minute >= 88), we do not push investments ...
- warnings: ["Minute >= 88 (Endgame: too late to bet)","Red card for Atalanta at 84'","Match state is highly chaotic with late goal"]
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
- reasoning_en: At minute 58, Over 2.5 Goals was recommended at 1.78. The match conditions remain incredibly open and justify continuity. By minute 66, the teams have accumulated a massive 29 combined shots and 12 shots on target. The attacking intensity hasn't dropped, but the odds for Over 2.5 have improved nicel...
- warnings: ["Second half progression - time is running down but chance creation remains exceptionally high."]
- assertions: pass
