# Real Production Readiness Validation

- Generated at: 2026-03-21T03:44:23.706Z
- Pending migrations: 0
- Live matches tested: 3
- Upcoming enrichment matches tested: 3

## Migrations

- Pending: (none)
- Applied tail: 007_audit_logs.sql, 008_match_enrichment.sql, 009_provider_samples.sql, 010_watchlist_logos.sql, 011_settlement_audit.sql

## Enrichment

- Job result: checked=3, enriched=2

| Match ID | Match | Source Quality | Trusted Sources | Quant Coverage | Usable Summary |
| --- | --- | --- | --- | --- | --- |
| 1469684 | Brisbane Roar vs Wellington Phoenix | unknown | 0 | 0 | yes |
| 1504719 | Fagiano Okayama vs V-varen Nagasaki | medium | 2 | 1 | yes |
| 1506920 | Daejeon Citizen vs Jeonbuk Motors | unknown | 0 | 0 | no |

## Ask AI

- matchId: 1469683
- httpStatus: 200
- responseLength: 1648

## Live Pipeline

| Match ID | Mode | Shadow | Status | Minute | Push | Selection | Saved | Notified | Odds Source | Stats Source | Evidence | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1469683 | auto | yes | 2H | 85 | no |  | no | no |  | api-football |  |  |
| 1469683 | system_force | yes | 2H | 85 | no |  | no | no | live | api-football | full_live_data |  |
| 1469683 | manual_force | yes | 2H | 85 | no |  | no | no | live | api-football | full_live_data |  |
| 1489154 | auto | yes | 2H | 78 | no |  | no | no | live | api-football | odds_events_only_degraded |  |
| 1489154 | system_force | yes | 2H | 78 | no |  | no | no | live | api-football | odds_events_only_degraded |  |
| 1489154 | manual_force | yes | 2H | 78 | no |  | no | no | live | api-football | odds_events_only_degraded |  |
| 1492563 | auto | yes | 1H | 36 | no |  | no | no | live | api-football | full_live_data |  |
| 1492563 | system_force | yes | 1H | 36 | no |  | no | no | live | api-football | full_live_data |  |
| 1492563 | manual_force | yes | 1H | 36 | no |  | no | no | live | api-football | full_live_data |  |

## Batch Run

- matchIds: 1469683, 1489154, 1492563
- totalMatches=3, processed=3, errors=0, shouldPushCount=0, savedCount=0

## Save And Notify

- matchId: (none)
- pipelineResult: (none)
- recommendationRow: (none)

## Provider Samples

- stats: [{"provider":"api-football","consumer":"replay","sample_count":28},{"provider":"api-football","consumer":"server-pipeline","sample_count":37},{"provider":"live-score-api","consumer":"replay","sample_count":28},{"provider":"live-score-api","consumer":"server-pipeline","sample_count":8}]
- odds: [{"provider":"api-football","source":"live","consumer":"replay","sample_count":25},{"provider":"api-football","source":"live","consumer":"server-pipeline","sample_count":27}]

## Settle

- autoSettle: settled=0, skipped=2, errors=0
- recent real re-settle report exists: yes
