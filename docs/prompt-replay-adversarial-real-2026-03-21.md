# Prompt Replay Suite Report

- Total scenarios: 4
- Passed assertions: 4/4

| Scenario | Analysis Mode | Evidence Mode | Odds Source | Bet Market | Should Push | Selection | Confidence | Assertions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-live-overrides-under-context | auto | full_live_data | live | over_2.5 | yes | Over 2.5 Goals @1.89 | 8 | pass |
| 02-threshold-edge-no-bet | auto | full_live_data | live | (none) | no | (none) | 0 | pass |
| 03-suspicious-odds-feed-no-bet | auto | full_live_data | live | (none) | no | (none) | 0 | pass |
| 04-corners-late-no-bet | auto | full_live_data | live | (none) | no | (none) | 0 | pass |

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
- confidence: 8
- reasoning_en: Despite cautious pre-match expectations, the live data reveals an incredibly open match with 30 total shots and 12 shots on target by the 63rd minute. At 1-1, we only need one more goal to clear the 2.5 line. Break-even for Over 2.5 at 1.89 is roughly 53%. Considering the immense attacking output an...
- warnings: ["Pre-match priors indicated a conservative game, but live data strongly overrides this."]
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
- reasoning_en: The match is perfectly balanced at 1-1 with 50-50 possession, 9-8 shots, and 3-3 shots on target. Both teams have scored, but the overall chance creation rate (6 combined shots on target in 62 minutes) is average. The Over/Under 2.5 line is priced at 1.92, giving a break-even of about 52%. My fair v...
- warnings: ["No clear statistical edge","Perfectly balanced match metrics"]
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
- reasoning_en: The match is currently 1-1 at the 74th minute, which means both teams have already scored. However, the odds for BTTS Yes are listed at 1.47 instead of being suspended or close to 1.00. This directly contradicts the live score and indicates a likely delay or glitch in the odds feed. Given this discr...
- warnings: ["Suspicious odds: BTTS Yes is priced at 1.47 despite the current score being 1-1."]
- assertions: pass

### 04-corners-late-no-bet
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
- reasoning_en: The live odds offer a corner line of 10.5 at 1.96, but the live stats indicate only 7 corners have been taken by minute 83. A 3.5-corner gap with only 7 regular minutes remaining is highly anomalous and strongly suggests that the actual corner count is higher (likely 9 or 10) but delayed in the stat...
- warnings: ["Suspicious odds: Line 10.5 vs 7 actual corners at minute 83 implies data latency."]
- assertions: pass
