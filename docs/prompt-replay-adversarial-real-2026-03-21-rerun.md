# Prompt Replay Suite Report

- Total scenarios: 4
- Passed assertions: 3/4

| Scenario | Analysis Mode | Evidence Mode | Odds Source | Bet Market | Should Push | Selection | Confidence | Assertions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-live-overrides-under-context | auto | full_live_data | live | over_2.5 | yes | Over 2.5 Goals @1.89 | 7 | pass |
| 02-threshold-edge-no-bet | auto | full_live_data | live | (none) | no | (none) | 0 | pass |
| 03-suspicious-odds-feed-no-bet | auto | full_live_data | live | (none) | no | (none) | 0 | pass |
| 04-corners-late-no-bet | auto | full_live_data | live | corners_under_10.5 | yes | Corners Under 10.5 @1.96 | 8 | fail |

## Details

### 01-live-overrides-under-context
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
- selection: Over 2.5 Goals @1.89
- confidence: 7
- reasoning_en: The live match data completely shatters the pre-match expectation of a conservative, tactical affair between these two title contenders. By the 63rd minute, we are seeing an astonishing 30 total shots (17-13) and 12 shots on target (7-5), alongside 14 corners. This indicates an incredibly open, high...
- warnings: ["Live play completely contradicts pre-match conservative priors, adapting entirely to live evidence.","Title race pressure could theoretically trigger late caution if neither wants to lose, though current tempo remains very high."]
- assertions: pass

### 02-threshold-edge-no-bet
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
- reasoning_en: The match is perfectly balanced at 1-1 in the 62nd minute, with both teams sharing 50% possession, nearly identical shots (9 vs 8), and equal shots on target (3 vs 3). The Over/Under 2.5 line is priced symmetrically at 1.92, implying a break-even rate of about 52.1%. Given the average match tempo an...
- warnings: ["Match tempo and stats are entirely balanced, reducing predictability.","Calculated edge on O/U 2.5 is less than the required 3% minimum threshold."]
- assertions: pass

### 03-suspicious-odds-feed-no-bet
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
- reasoning_en: At minute 74 with the score tied at 1-1, the BTTS market is already resolved (both teams have scored), rendering those odds irrelevant or anomalous. For the Over/Under 2.5 market, the Under is priced at 1.82 (break-even ~55%). Considering standard goal-expectancy for the remaining 16+ minutes plus s...
- warnings: ["Score is 1-1, rendering BTTS odds irrelevant/decided.","Edge on Under 2.5 is below the 3% minimum threshold."]
- assertions: pass

### 04-corners-late-no-bet
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: full_live_data
- statsSource: api-football
- oddsSource: live
- betMarket: corners_under_10.5
- shouldPush: true
- saved: false
- notified: false
- selection: Corners Under 10.5 @1.96
- confidence: 8
- reasoning_en: Break-even is about 51%. The current corner count is just 7 at minute 83. For the Under 10.5 to lose, there would need to be 4 more corners in the remaining 7 minutes plus stoppage time. The match tempo has produced just 0.08 corners per minute so far. Even with late pressure from Villarreal chasing...
- warnings: ["Late game phase (minute 83), expect higher variance in added time if Villarreal heavily pushes for an equalizer.","Stoppage time could be lengthy due to substitutions or potential delays."]
- assertions: fail
