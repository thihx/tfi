# Prompt Replay Suite Report

- Total scenarios: 8
- Passed assertions: 8/8

| Scenario | Analysis Mode | Evidence Mode | Odds Source | Should Push | Selection | Confidence | Assertions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-auto-full-live | auto | full_live_data | live | yes | Over 2.5 Goals @1.86 | 6 | pass |
| 02-stats-only | auto | stats_only | none | no | (none) | 0 | pass |
| 03-odds-events-only-degraded | auto | odds_events_only_degraded | live | no | (none) | 0 | pass |
| 04-proceed-skip | auto |  |  | no | (none) | 0 | pass |
| 05-system-force | system_force | low_evidence | none | no | (none) | 0 | pass |
| 06-manual-force | manual_force | low_evidence | none | no | (none) | 0 | pass |
| 07-cross-league-strategic-context | auto | full_live_data | live | yes | Under 1.5 Goals @1.75 | 7 | pass |
| 08-duplicate-followup-context | auto | full_live_data | live | no | (none) | 0 | pass |

## Details

### 01-auto-full-live
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: full_live_data
- statsSource: api-football
- oddsSource: live
- shouldPush: true
- saved: false
- notified: false
- selection: Over 2.5 Goals @1.86
- confidence: 6
- warnings: ["Late game variance: A prolonged period without a goal could kill the momentum."]
- assertions: pass

### 02-stats-only
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: stats_only
- statsSource: api-football
- oddsSource: none
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- warnings: ["No usable odds available.","Tier 2 (stats_only) active - requires reliable odds for a recommendation."]
- assertions: pass

### 03-odds-events-only-degraded
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: odds_events_only_degraded
- statsSource: api-football
- oddsSource: live
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- warnings: ["Tier 3 Degraded Mode: No live stats available, relying only on sparse events","Missing attacking pressure metrics to evaluate Over/Under 2.5 probability"]
- assertions: pass

### 04-proceed-skip
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: 
- statsSource: api-football
- oddsSource: 
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
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- warnings: ["Minute 3 is too early for any reliable analysis.","No usable odds available.","Evidence tier 4: no actionable recommendations permitted."]
- assertions: pass

### 06-manual-force
- llmMode: real
- oddsMode: recorded
- analysisMode: manual_force
- evidenceMode: low_evidence
- statsSource: api-football
- oddsSource: none
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- warnings: ["Very early in the match (minute 3).","No live stats available (Tier 4 evidence).","No odds available."]
- assertions: pass

### 07-cross-league-strategic-context
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: full_live_data
- statsSource: api-football
- oddsSource: live
- shouldPush: true
- saved: false
- notified: false
- selection: Under 1.5 Goals @1.75
- confidence: 7
- warnings: ["A single goal could force the losing team to open up, increasing the risk of a late second goal."]
- assertions: pass

### 08-duplicate-followup-context
- llmMode: real
- oddsMode: recorded
- analysisMode: auto
- evidenceMode: full_live_data
- statsSource: api-football
- oddsSource: live
- shouldPush: false
- saved: false
- notified: false
- selection: (none)
- confidence: 0
- warnings: ["Continuity rules triggered: preventing duplicate recommendation."]
- assertions: pass
