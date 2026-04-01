# Profile System V2 Rollout Plan

## Objective

Implement a reliable, structured, scheduled profile system for top leagues only:

- `league_profile` as a fully auto-derived league prior
- `team_profile` as an auto-derived quantitative core plus optional tactical overlay

## Current Status

As of 2026-04-01:

- Phase 0: completed
- Phase 1: completed
- Phase 2: completed
- Phase 3: partially completed through the existing `sync-reference-data` orchestration and history backfill
- Phase 4: completed for profile core metadata
- Phase 5: completed
- Phase 6: in progress

Current Phase 6 scope:

- scheduled tactical overlay refresh job for top-league teams only
- overlay-only writes with quantitative core left untouched
- trusted-source provenance and stale refresh rules
- capped per-run volume so cost stays bounded

## Phase 0: Confirm Boundaries

Status:

- design approved

Tasks:

- confirm `top_league only`
- confirm `API-Football/history first`
- confirm no direct mutation from match enrichment
- confirm tactical overlay stays separate from quantitative core

Exit criteria:

- product and engineering agree on the data boundary

## Phase 1: Complete Auto-Derivation Coverage

Goal:

- make the current derive path materially complete for structured fields

Implementation:

- extend [prematch-profile-sync.ts](C:/tfi/packages/server/src/lib/prematch-profile-sync.ts) to compute:
  - `league_profile.late_goal_rate_75_plus`
  - `team_profile.first_goal_rate`
  - `team_profile.late_goal_rate`
- keep current minimum sample logic, but review thresholds:
  - leagues: `20`
  - teams: `8`

Notes:

- `first_goal_rate` should be derived from match score progression when available from stored historical evidence
- if historical evidence is insufficient, field remains `null`
- do not fabricate from heuristics that cannot be audited

Tests:

- unit tests for each new derived metric
- repo tests for upsert results
- regression tests for null behavior when data is insufficient

Exit criteria:

- every quantitative field in league profile is either derived or explicitly null by rule
- every quantitative field in team profile is either derived or explicitly null by rule

## Phase 2: Explicitly Separate Team Quant Core and Tactical Overlay

Goal:

- remove semantic ambiguity from `team_profile`

Implementation choices:

### Option A: nested JSONB, same table

Preferred for low migration risk.

Target payload:

```json
{
  "version": 2,
  "quantitative_core": { ... },
  "tactical_overlay": { ... }
}
```

Required work:

- add read helpers in [team-profiles.repo.ts](C:/tfi/packages/server/src/repos/team-profiles.repo.ts)
- update [prematch-expert-features.ts](C:/tfi/packages/server/src/lib/prematch-expert-features.ts) to unwrap the nested structure
- keep backward compatibility during transition

### Option B: separate physical tables

Not recommended for the first rollout because it increases migration and consumer complexity.

Tests:

- repo tests for read/write compatibility
- prematch features tests confirming nested profiles are consumed correctly

Exit criteria:

- quantitative fields and tactical fields are structurally distinct
- downstream consumers still work

## Phase 3: Split Scheduled Jobs by Responsibility

Goal:

- make recomputation explicit and observable

Jobs to add or refactor:

### `sync-derived-league-profiles`

- input: top leagues only
- recompute all league priors daily

### `sync-derived-team-profiles`

- input: teams in top leagues only
- recompute team quantitative core daily

Recommendation:

- if implementation cost is lower, keep one orchestrator job but expose separate sub-results for league and team phases
- if clarity is more important, split into two job entries in scheduler

Observability:

- leagues scanned
- leagues refreshed
- leagues skipped
- teams scanned
- teams refreshed
- teams skipped
- average sample size
- low-reliability counts

Tests:

- scheduler wiring tests
- job tests with top league filtering
- tests that non-top leagues are excluded

Exit criteria:

- scheduled runs only touch top leagues
- job output is auditable in logs and API

## Phase 4: Profile Metadata and Auditability

Goal:

- make every profile explainable

Implementation:

- add metadata into stored JSON:
  - `version`
  - `source_mode`
  - `window.lookback_days`
  - `window.sample_matches`
  - `window.updated_at`
- for team overlays later:
  - `source_urls`
  - `source_confidence`

Tests:

- upsert tests assert metadata presence
- UI or API contract tests if profile metadata is exposed

Exit criteria:

- any profile row can be explained without external guesswork

## Phase 5: Consumer Alignment

Goal:

- make all consumers read the new profile shape safely

Consumers to verify:

- [prematch-expert-features.ts](C:/tfi/packages/server/src/lib/prematch-expert-features.ts)
- [server-pipeline.ts](C:/tfi/packages/server/src/lib/server-pipeline.ts)
- any routes/UI reading league profile or team profile

Tasks:

- preserve compatibility during transition
- ensure missing overlay does not downgrade the quantitative core
- confirm no match enrichment code path overwrites profile rows

Tests:

- prematch features tests with:
  - only quantitative core
  - quantitative core plus overlay
  - no overlay

Exit criteria:

- all active consumers continue to work
- no dependency on tactical overlay for baseline scoring

## Phase 6: Optional Tactical Overlay System

Goal:

- support tactical fields without polluting the structured core

This phase is optional and should only start after phases 1-5 are stable.

Implementation:

- create a curated source whitelist
- build a structured extraction workflow for:
  - `attack_style`
  - `defensive_line`
  - `pressing_intensity`
  - `squad_depth`
- store output only in `tactical_overlay`

Rules:

- top leagues only
- top-league teams only
- structured output only
- source audit required
- no overwrite of quantitative core

Tests:

- overlay parser tests
- source whitelist tests
- consumer tests ensuring overlay is optional

Exit criteria:

- overlay can be refreshed independently
- overlay failures do not affect quantitative core

Current implementation note:

- `refresh-tactical-overlays` runs independently from `sync-reference-data`
- only existing top-league `team_profile` rows are eligible
- `manual_override` and `curated` overlays are protected from scheduler overwrite
- `default_neutral` overlays are prioritized, followed by stale or metadata-thin `llm_assisted` overlays

## Migration Strategy

Recommended sequence:

1. add read-path compatibility helpers first
2. introduce new JSON structure in write path
3. backfill existing profile rows
4. switch consumers to prefer v2 payloads
5. remove old assumptions after validation

If there is any risk to current runtime:

- use tolerant readers
- keep old flat keys during a temporary bridge period

## Backfill Strategy

For league profiles:

- recompute from historical settled data
- overwrite existing rows because league profile is fully machine-derived

For team profiles:

- populate quantitative core from history
- if legacy tactical fields exist, migrate them into `tactical_overlay`
- if legacy data is ambiguous, move values into overlay with low confidence rather than into the core

## Risk Register

### Risk 1: Team tactical fields look authoritative when they are not

Mitigation:

- keep them in overlay
- attach source metadata
- never blend them into quantitative core

### Risk 2: Non-top league data leaks into profile jobs

Mitigation:

- explicit `top_league` filter in job inputs
- tests proving exclusion

### Risk 3: Profile consumers break on nested JSON

Mitigation:

- add unwrapping helpers
- keep backward-compatible read logic during transition

### Risk 4: Historical data is insufficient for some fields

Mitigation:

- use explicit nulls
- expose reliability tiers and sample sizes

### Risk 5: Match enrichment accidentally overwrites priors

Mitigation:

- no write path from enrichment job to profile tables
- code review and regression tests around repo calls

## Testing Plan

### Unit

- derivation math for league metrics
- derivation math for team metrics
- edge cases with low sample counts

### Integration

- scheduled job filters top leagues only
- upsert payload shape and metadata
- prematch feature builder consumes v2 profiles

### Regression

- existing pipeline behavior unchanged when profiles are absent
- tactical overlay absence does not break prematch features

## Deployment Plan

### Release 1

- phase 1 and 4
- no schema semantics change yet if avoidable

### Release 2

- phase 2 and 5
- nested team profile structure with tolerant readers

### Release 3

- phase 3 scheduler hardening if split jobs are introduced

### Release 4

- optional phase 6 tactical overlay

## Success Criteria

- top-league profile rows refresh automatically on schedule
- quantitative league profile fields are complete and auditable
- quantitative team profile fields are complete and auditable
- tactical fields are clearly separated from core metrics
- prematch analysis uses stable priors without profile contamination from match enrichment

## Recommended Immediate Implementation Order

1. complete missing auto-derived quantitative metrics
2. add profile metadata
3. separate team quantitative core and tactical overlay logically
4. update consumers
5. split scheduler responsibilities if needed
6. defer tactical overlay job until the core is stable
