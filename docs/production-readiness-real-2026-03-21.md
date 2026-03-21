# Real Production Readiness Validation

- Generated at: 2026-03-21T04:57:06.274Z
- Pending migrations: 0
- Live matches tested: 2
- Upcoming enrichment matches tested: 3

## Migrations

- Pending: (none)
- Applied tail: 007_audit_logs.sql, 008_match_enrichment.sql, 009_provider_samples.sql, 010_watchlist_logos.sql, 011_settlement_audit.sql

## Enrichment

- Job result: checked=3, enriched=1

| Match ID | Match | Source Quality | Trusted Sources | Quant Coverage | Usable Summary |
| --- | --- | --- | --- | --- | --- |
| 1504719 | Fagiano Okayama vs V-varen Nagasaki | low | 0 | 0 | no |
| 1506920 | Daejeon Citizen vs Jeonbuk Motors | medium | 2 | 0 | yes |
| 1516632 | Sagamihara vs Yokohama FC | low | 1 | 0 | no |

## Ask AI

- matchId: 1492563
- httpStatus: 200
- responseLength: 2766

## Live Pipeline

| Match ID | Mode | Shadow | Status | Minute | Push | Selection | Saved | Notified | Odds Source | Stats Source | Evidence | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1492563 | auto | yes | 2H | 88 | no |  | no | no |  | api-football |  |  |
| 1492563 | system_force | yes | 2H | 88 | no |  | no | no | live | api-football | full_live_data |  |
| 1492563 | manual_force | yes | 2H | 88 | no |  | no | no | live | api-football | full_live_data |  |
| 1469684 | auto | yes | HT | 45 | no |  | no | no |  | api-football |  |  |
| 1469684 | system_force | yes | HT | 45 | no |  | no | no | live | api-football | full_live_data |  |
| 1469684 | manual_force | yes | HT | 45 | no |  | no | no | live | api-football | full_live_data |  |

## Batch Run

- matchIds: 1492563, 1469684
- totalMatches=2, processed=2, errors=0, shouldPushCount=0, savedCount=0

## Save And Notify

- matchId: (none)
- pipelineResult: (none)
- recommendationRow: (none)

## Provider Samples

- stats: [{"provider":"api-football","consumer":"replay","sample_count":13},{"provider":"api-football","consumer":"server-pipeline","sample_count":24},{"provider":"live-score-api","consumer":"replay","sample_count":13},{"provider":"live-score-api","consumer":"server-pipeline","sample_count":6}]
- odds: [{"provider":"api-football","source":"live","consumer":"proxy-route","sample_count":2},{"provider":"api-football","source":"live","consumer":"replay","sample_count":11},{"provider":"api-football","source":"live","consumer":"server-pipeline","sample_count":16}]

## Settle

- autoSettle: settled=0, skipped=4, errors=0
- recent real re-settle report exists: yes
