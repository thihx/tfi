# Recommendation Pipeline Liveness Report

- Generated: 2026-06-03T15:22:12.284Z
- Lookback hours: 336
- Job: check-live-trigger
- Official prompt version: v10-hybrid-legacy-g

## Diagnosis

- Job has recent runs: yes
- Pipeline has recent complete audit: yes
- Recommendations have recent rows: yes
- Official prompt observed: no

## Job

- Total runs: 2318
- Success runs: 1151
- Failure runs: 86
- Skipped runs: 1081
- Degraded runs: 0
- Latest started at: 2026-06-03T15:15:38.842Z
- Latest completed at: 2026-06-03T15:15:38.983Z
- Latest completed age hours: 0.11
- Latest status: success
- Latest error: (none)

## Pipeline Audit

- Total events: 1423
- Complete events: 197
- Latest complete at: 2026-06-03T01:08:03.856Z
- Latest complete age hours: 14.24
- Match analyzed events: 133
- Match skipped events: 5
- Match error events: 2
- Saved from analyzed events: 0

## Recommendations

- Total rows: 15
- Latest row at: 2026-05-25T02:59:20.806Z
- Latest row age hours: 228.38
- Official prompt rows: 0
- Latest official prompt row at: (none)
- Latest official prompt row age hours: (none)
- Non-official prompt rows: 15

## Pipeline Actions

| Action | Outcome | Count | Latest at |
| --- | --- | ---: | --- |
| LLM_CALL_STARTED | SUCCESS | 363 | 2026-06-03T10:21:20.340Z |
| LLM_CALL_COMPLETED | SUCCESS | 351 | 2026-06-03T10:21:17.384Z |
| LLM_PARSE_DIAGNOSTIC | SKIPPED | 344 | 2026-06-03T10:21:17.386Z |
| PIPELINE_COMPLETE | SUCCESS | 195 | 2026-06-03T01:08:03.856Z |
| PIPELINE_MATCH_ANALYZED | SKIPPED | 133 | 2026-06-03T01:08:03.830Z |
| LLM_CALL_BLOCKED | SKIPPED | 25 | 2026-06-02T20:32:40.351Z |
| PIPELINE_MATCH_SKIPPED | SKIPPED | 5 | 2026-06-02T17:51:59.665Z |
| LLM_PARSE_DIAGNOSTIC | SUCCESS | 2 | 2026-06-03T03:08:58.112Z |
| PIPELINE_COMPLETE | PARTIAL | 2 | 2026-06-01T17:45:23.517Z |
| PIPELINE_MATCH_ERROR | FAILURE | 2 | 2026-06-01T17:45:23.508Z |
| LLM_CALL_COMPLETED | FAILURE | 1 | 2026-06-03T06:29:24.977Z |

## Audit Prompt Versions

| Action | Prompt version | Count | Latest at |
| --- | --- | ---: | --- |
| LLM_CALL_STARTED | v10-hybrid-legacy-g | 363 | 2026-06-03T10:21:20.340Z |
| LLM_CALL_COMPLETED | v10-hybrid-legacy-g | 352 | 2026-06-03T10:21:17.384Z |
| LLM_PARSE_DIAGNOSTIC | v10-hybrid-legacy-g | 346 | 2026-06-03T10:21:17.386Z |
| PIPELINE_MATCH_ANALYZED | v10-hybrid-legacy-g | 133 | 2026-06-03T01:08:03.830Z |
| LLM_CALL_BLOCKED | (empty) | 25 | 2026-06-02T20:32:40.351Z |

## Recent Job Runs

| ID | Started at | Completed at | Status | Duration ms | Summary |
| ---: | --- | --- | --- | ---: | --- |
| 1070364 | 2026-06-03T15:15:38.842Z | 2026-06-03T15:15:38.983Z | success | 141 | {"liveCount":0} |
| 1070325 | 2026-06-03T15:05:38.860Z | 2026-06-03T15:05:39.003Z | success | 143 | {"liveCount":0} |
| 1070286 | 2026-06-03T14:55:38.854Z | 2026-06-03T14:55:39.114Z | success | 260 | {"liveCount":0} |
| 1070245 | 2026-06-03T14:45:38.852Z | 2026-06-03T14:45:38.991Z | success | 139 | {"liveCount":0} |
| 1070207 | 2026-06-03T14:35:38.851Z | 2026-06-03T14:35:38.980Z | success | 129 | {"liveCount":0} |
| 1070167 | 2026-06-03T14:25:38.853Z | 2026-06-03T14:25:38.996Z | success | 143 | {"liveCount":0} |
| 1070128 | 2026-06-03T14:15:38.845Z | 2026-06-03T14:15:38.952Z | success | 107 | {"liveCount":0} |
| 1070089 | 2026-06-03T14:05:38.843Z | 2026-06-03T14:05:39.040Z | success | 197 | {"liveCount":0} |
| 1070049 | 2026-06-03T13:55:38.836Z | 2026-06-03T13:55:38.972Z | success | 136 | {"liveCount":0} |
| 1070010 | 2026-06-03T13:45:38.853Z | 2026-06-03T13:45:39.002Z | success | 149 | {"liveCount":0} |
| 1069969 | 2026-06-03T13:35:38.872Z | 2026-06-03T13:35:38.968Z | success | 96 | {"liveCount":0} |
| 1069932 | 2026-06-03T13:25:38.852Z | 2026-06-03T13:25:39.092Z | success | 240 | {"liveCount":0} |
| 1069890 | 2026-06-03T13:15:38.844Z | 2026-06-03T13:15:38.949Z | success | 105 | {"liveCount":0} |
| 1069853 | 2026-06-03T13:05:38.843Z | 2026-06-03T13:05:39.058Z | success | 215 | {"liveCount":0} |
| 1069812 | 2026-06-03T12:55:38.858Z | 2026-06-03T12:55:38.983Z | success | 125 | {"liveCount":0} |
| 1069773 | 2026-06-03T12:45:38.842Z | 2026-06-03T12:45:39.012Z | success | 170 | {"liveCount":0} |
| 1069735 | 2026-06-03T12:35:38.847Z | 2026-06-03T12:35:38.981Z | success | 134 | {"liveCount":0} |
| 1069694 | 2026-06-03T12:25:38.845Z | 2026-06-03T12:25:38.967Z | success | 122 | {"liveCount":0} |
| 1069654 | 2026-06-03T12:15:38.844Z | 2026-06-03T12:15:38.986Z | success | 142 | {"liveCount":0} |
| 1069615 | 2026-06-03T12:05:38.856Z | 2026-06-03T12:05:38.979Z | success | 123 | {"liveCount":0} |
| 1069576 | 2026-06-03T11:55:38.839Z | 2026-06-03T11:55:38.947Z | success | 108 | {"liveCount":0} |
| 1069537 | 2026-06-03T11:45:38.836Z | 2026-06-03T11:45:38.966Z | success | 130 | {"liveCount":0} |
| 1069496 | 2026-06-03T11:35:38.845Z | 2026-06-03T11:35:38.995Z | success | 150 | {"liveCount":0} |
| 1069456 | 2026-06-03T11:25:38.832Z | 2026-06-03T11:25:38.972Z | success | 140 | {"liveCount":0} |
| 1069417 | 2026-06-03T11:15:38.850Z | 2026-06-03T11:15:38.987Z | success | 137 | {"liveCount":0} |

