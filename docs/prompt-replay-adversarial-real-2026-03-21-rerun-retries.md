# Prompt Replay Suite Report

- Total scenarios: 4
- Passed assertions: 4/4

| Scenario | Analysis Mode | Evidence Mode | Odds Source | Bet Market | Should Push | Selection | Confidence | Assertions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-live-overrides-under-context | auto | full_live_data | live | over_2.5 | yes | Over 2.5 Goals @1.89 | 7 | pass |
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
- confidence: 7
- reasoning_en: Break-even about 53%. My fair range is around 65-70%. Edge looks about 12-17%. Despite pre-match expectations of a cautious, tactical affair between the top two, the live evidence completely contradicts this. By minute 63, we have seen an incredible 30 combined shots, 12 shots on target, and 14 corn...
- warnings: ["Pre-match narrative of a conservative match is strongly contradicted by extreme live attacking statistics."]
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
- reasoning_en: The match is perfectly balanced across all key metrics (50-50 possession, 9-8 shots, 3-3 SOT, 4-4 corners). Neither team is demonstrating a clear momentum advantage or sustained pressure. With the score tied at 1-1 in the 62nd minute, the Over/Under 2.5 lines are evenly priced at 1.92, and the 1X2 m...
- warnings: ["Perfectly balanced match statistics indicate high unpredictability","No clear momentum or pressure detected from either team"]
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
- reasoning_en: The live score is 1-1, meaning both teams have already scored. However, the BTTS Yes market is currently priced at 1.47, which strongly contradicts the live match state and indicates that the odds feed is stale or showing pre-match values. Due to unreliable odds data, no safe investment can be recom...
- warnings: ["Suspicious odds detected: BTTS Yes is 1.47 but the current score is already 1-1. Odds feed is likely stale or displaying pre-match prices."]
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
- reasoning_en: The live stats report 7 total corners at minute 83, yet the corners line is set at 10.5 with even-money odds. A 3.5 corner buffer this late in the game is highly suspicious and strongly suggests the live stats feed is lagging behind the actual match events (the real corner count is likely around 9 o...
- warnings: ["Suspicious odds-stats mismatch detected: corners line 10.5 versus 7 reported corners at minute 83."]
- assertions: pass
