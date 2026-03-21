# Prompt Replay Suite Report

- Total scenarios: 8
- Passed assertions: 8/8

| Scenario | Analysis Mode | Evidence Mode | Odds Source | Bet Market | Should Push | Selection | Confidence | Assertions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-auto-full-live | auto | full_live_data | live | over_2.5 | yes | Over 2.5 Goals @1.86 | 7 | pass |
| 02-stats-only | auto | stats_only | none | (none) | no | (none) | 0 | pass |
| 03-odds-events-only-degraded | auto | odds_events_only_degraded | live | (none) | no | (none) | 0 | pass |
| 04-proceed-skip | auto |  |  | (none) | no | (none) | 0 | pass |
| 05-system-force | system_force | low_evidence | none | (none) | no | (none) | 0 | pass |
| 06-manual-force | manual_force | low_evidence | none | (none) | no | (none) | 0 | pass |
| 07-cross-league-strategic-context | auto | full_live_data | live | under_1.5 | yes | Under 1.5 Goals @1.75 | 7 | pass |
| 08-duplicate-followup-context | auto | full_live_data | live | (none) | no | (none) | 0 | pass |

## Details

### 01-auto-full-live
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
- selection: Over 2.5 Goals @1.86
- confidence: 7
- reasoning_en: Match is tied 1-1 at minute 67. Both teams show strong attacking intent with 22 combined shots and 9 shots on target. Arsenal is pushing for a win to secure Champions League spots, while Chelsea fights for survival, meaning a draw suits neither. Break-even is about 53.8% for Over 2.5 at 1.86. My fai...
- warnings: ["Match is already 1-1; ignoring BTTS odds as the outcome has already essentially occurred."]
- assertions: pass

### 02-stats-only
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: stats_only
- statsSource: api-football
- oddsSource: none
- betMarket: 
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- reasoning_en: The match is currently 0-0 at minute 63. Live statistics show a relatively tight game, with Atletico holding a slight edge in shots (11 vs 7) but low shots on target for both sides (3 vs 2). Crucially, there are no live odds available in our system to calculate break-even probabilities or assess mar...
- warnings: ["No usable odds available","Tier 2 evidence mode strictly limits actionable picks without live market data"]
- assertions: pass

### 03-odds-events-only-degraded
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
- reasoning_en: Match is at minute 71 with the score tied 1-1. We are operating in a degraded data tier with no live stats (shots, possession, corners) available, only basic events. While Over/Under 2.5 and AH markets are available, the derived match intensity is low and momentum neutral. The break-even for Under 2...
- warnings: ["No reliable live stats available (Evidence Tier 3).","Analysis restricted to O/U and AH markets only.","Derived match intensity is low, increasing unpredictability without stats."]
- assertions: pass

### 04-proceed-skip
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: 
- statsSource: api-football
- oddsSource: 
- betMarket: 
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- assertions: pass

### 05-system-force
- llmMode: real
- oddsMode: recorded
- analysisMode: system_force
- evidenceMode: low_evidence
- statsSource: api-football
- oddsSource: none
- betMarket: 
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- reasoning_en: The match is currently in the 3rd minute, which is far too early to establish any solid live tempo or edge. Furthermore, there are no live statistics, no recent events, and crucially, no usable odds available for this match. The evidence tier is classified as tier_4, strictly forbidding any actionab...
- warnings: ["Match is in minute 3, too early for live analysis.","No usable odds available.","Evidence Mode: tier_4 (Low evidence / incomplete data). No actionable betting markets allowed."]
- assertions: pass

### 06-manual-force
- llmMode: real
- oddsMode: recorded
- analysisMode: manual_force
- evidenceMode: low_evidence
- statsSource: api-football
- oddsSource: none
- betMarket: 
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- reasoning_en: This match is in the very early stages (minute 3), which is far too early to gauge the flow of the game, especially in a high-stakes classic like Benfica vs Porto. Furthermore, there are absolutely no live stats, events, or betting odds available at the moment (Tier 4 low evidence). Without data or ...
- warnings: ["Match is in minute 3 (too early to evaluate).","No live stats available.","No usable odds available.","Tier 4 low evidence mode enforces a no-bet rule."]
- assertions: pass

### 07-cross-league-strategic-context
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: full_live_data
- statsSource: api-football
- oddsSource: live
- betMarket: under_1.5
- shouldPush: true
- saved: false
- notified: false
- selection: Under 1.5 Goals @1.75
- confidence: 7
- reasoning_en: At minute 58 with the scoreline 0-0, this match is proving to be a tight, tactical affair exactly as pre-match profiles suggested, with both elite defenses holding firm. The shot count is even (8 vs 7) but clear-cut chances are limited with only 2 shots on target apiece. The odds for Under 1.5 Goals...
- warnings: ["A single goal can significantly alter the match tempo and increase urgency."]
- assertions: pass

### 08-duplicate-followup-context
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
- reasoning_en: Following up on the previous recommendation for Over 2.5 Goals at minute 61. The match remains 1-1 with 18 total shots and 7 on target, indicating an open tempo. However, the odds for Over 2.5 have only marginally increased from 1.82 to 1.84. There has been no material change in the match state or s...
- warnings: ["Duplicate pick blocked: Odds did not improve by >= 0.10 and evidence did not materially strengthen since minute 61."]
- assertions: pass
