# Profile System V2 Design

## Scope

This design covers the slow-moving profile layer used by prematch and live analysis:

- `league_profile` as the competition or market-environment prior
- `team_profile` as the club prior

This design does **not** cover match-level enrichment. Match enrichment remains a separate layer that produces per-fixture context and must not overwrite profile priors.

## Problem Statement

The current system mixes three different concepts:

1. slow-moving priors at league level
2. slow-moving priors at team level
3. match-specific enrichment

This creates three risks:

- a single match can distort a slow-moving prior
- profile fields are treated as if they all have the same source quality
- expensive LLM/search work gets used where structured historical derivation would be more reliable

The system also needs a profile layer that:

- is structurally stable
- can be recomputed on a schedule
- uses trustworthy sources
- is limited to `top_league = true`
- can be audited and backfilled

## Core Principles

### 1. API-Football and historical settled data stay primary

The profile system should be built from:

- `matches_history`
- `settlement_stats`
- league/team directory data
- existing trusted competition metadata

LLM is not the source of truth for the profile core.

### 2. Profiles are priors, not match outputs

Profiles represent stable tendencies over a rolling sample window.

They must not be mutated directly by:

- one-off watchlist enrichments
- one single important match
- one grounded web search result

### 3. Top leagues only

Profile derivation and maintenance should only run for leagues with `top_league = true`.

Rationale:

- better data quality
- more stable priors
- lower compute cost
- less noise from low-coverage competitions

### 4. Structured first, narrative second

Every profile field must be classified as one of:

- auto-derived from structured match history
- curated overlay
- optional narrative note

If a field cannot be derived reliably, it must not be silently fabricated.

## Terminology

### League Profile

`league_profile` is the system prior for competition environment.

This corresponds to what product discussions may call:

- market profile
- league environment
- scoring environment

For implementation, the canonical object remains `league_profile`.

### Team Profile

`team_profile` is the system prior for club-level tendencies.

It should be split conceptually into:

- `quantitative_core`
- `tactical_overlay`

The existing JSONB storage can still be used, but the schema should reflect this distinction.

## Current Schema Assessment

### Current `league_profile` fields

Current shape from [league-profiles.repo.ts](C:/tfi/packages/server/src/repos/league-profiles.repo.ts):

- `tempo_tier`
- `goal_tendency`
- `home_advantage_tier`
- `corners_tendency`
- `cards_tendency`
- `volatility_tier`
- `data_reliability_tier`
- `avg_goals`
- `over_2_5_rate`
- `btts_rate`
- `late_goal_rate_75_plus`
- `avg_corners`
- `avg_cards`

Assessment:

- almost entirely suitable for auto-derivation
- no need for LLM deep research for the core
- only `late_goal_rate_75_plus` is currently unfilled in the existing derive path

### Current `team_profile` fields

Current shape from [team-profiles.repo.ts](C:/tfi/packages/server/src/repos/team-profiles.repo.ts):

- `attack_style`
- `defensive_line`
- `pressing_intensity`
- `set_piece_threat`
- `home_strength`
- `form_consistency`
- `squad_depth`
- `avg_goals_scored`
- `avg_goals_conceded`
- `clean_sheet_rate`
- `btts_rate`
- `over_2_5_rate`
- `avg_corners_for`
- `avg_corners_against`
- `avg_cards`
- `first_goal_rate`
- `late_goal_rate`
- `data_reliability_tier`

Assessment:

- quantitative fields are suitable for scheduled auto-derivation
- `set_piece_threat`, `home_strength`, `form_consistency` can also be derived heuristically from quantitative history
- `attack_style`, `defensive_line`, `pressing_intensity`, `squad_depth` should not be auto-derived from the current historical dataset alone

These tactical fields require either:

- curated human input
- or a separate, clearly marked LLM-assisted overlay workflow

## Target Data Model

## League Profile V2

League profiles should remain mostly auto-derived and structured.

Recommended logical shape:

```json
{
  "version": 2,
  "source_mode": "auto_derived",
  "window": {
    "lookback_days": 180,
    "sample_matches": 74,
    "updated_at": "2026-03-31T00:00:00Z"
  },
  "core": {
    "tempo_tier": "high",
    "goal_tendency": "balanced",
    "home_advantage_tier": "high",
    "corners_tendency": "balanced",
    "cards_tendency": "low",
    "volatility_tier": "balanced",
    "data_reliability_tier": "high"
  },
  "quantitative": {
    "avg_goals": 2.87,
    "over_2_5_rate": 0.55,
    "btts_rate": 0.51,
    "late_goal_rate_75_plus": 0.39,
    "avg_corners": 9.4,
    "avg_cards": 4.1
  }
}
```

### League profile source rules

- all fields are machine-derived from settled history
- no LLM-generated league profile values
- notes may summarize the derivation but may not introduce new facts

## Team Profile V2

Team profile should become explicitly hybrid.

Recommended logical shape:

```json
{
  "version": 2,
  "source_mode": "hybrid",
  "window": {
    "lookback_days": 180,
    "sample_matches": 22,
    "sample_home_matches": 11,
    "sample_away_matches": 11,
    "updated_at": "2026-03-31T00:00:00Z"
  },
  "quantitative_core": {
    "avg_goals_scored": 1.64,
    "avg_goals_conceded": 0.91,
    "clean_sheet_rate": 0.36,
    "btts_rate": 0.45,
    "over_2_5_rate": 0.50,
    "avg_corners_for": 5.7,
    "avg_corners_against": 4.1,
    "avg_cards": 2.0,
    "first_goal_rate": 0.59,
    "late_goal_rate": 0.34,
    "home_strength": "strong",
    "form_consistency": "consistent",
    "set_piece_threat": "medium",
    "data_reliability_tier": "high"
  },
  "tactical_overlay": {
    "attack_style": "mixed",
    "defensive_line": "medium",
    "pressing_intensity": "medium",
    "squad_depth": "medium",
    "source_mode": "curated_or_llm_assisted",
    "source_confidence": "low",
    "updated_at": null
  }
}
```

### Team profile source rules

#### Auto-derived fields

- `avg_goals_scored`
- `avg_goals_conceded`
- `clean_sheet_rate`
- `btts_rate`
- `over_2_5_rate`
- `avg_corners_for`
- `avg_corners_against`
- `avg_cards`
- `first_goal_rate`
- `late_goal_rate`
- `home_strength`
- `form_consistency`
- `set_piece_threat`
- `data_reliability_tier`

#### Overlay-only fields

- `attack_style`
- `defensive_line`
- `pressing_intensity`
- `squad_depth`

These must remain distinct from the quantitative core even if stored in the same JSONB object.

## Source and Derivation Strategy

## Primary source

Primary source remains internal structured history derived from the main football provider:

- `matches_history`
- `settlement_stats`

This is preferred because it is:

- repeatable
- auditable
- already normalized into runtime data

## What should be derived automatically

### League

- average goals
- over and BTTS rates
- corners and cards averages
- volatility
- home advantage
- late goal rate
- reliability tier

### Team

- goals scored and conceded
- clean sheets
- BTTS and over rates
- corners and cards
- first goal rate
- late goal rate
- form consistency
- home strength
- set piece threat
- reliability tier

## What should not be auto-derived from current data alone

- attack style
- defensive line
- pressing intensity
- squad depth

These need either:

- manual curation
- or an explicit overlay pipeline using curated trusted sources

## Optional LLM-assisted overlay

If the product wants tactical overlays, use a separate job with strict boundaries:

- only for top leagues and top teams
- only against whitelisted sources
- only to populate overlay fields
- never to overwrite quantitative core

This job should output structured JSON, not freeform text.

Example overlay payload:

```json
{
  "attack_style": "direct",
  "defensive_line": "medium",
  "pressing_intensity": "high",
  "squad_depth": "medium",
  "source_urls": [
    "https://official-club-site.example/...",
    "https://trusted-analysis.example/..."
  ],
  "source_confidence": "medium"
}
```

## Scheduled Jobs

## Job A: `sync-derived-league-profiles`

Purpose:

- recompute league priors for top leagues

Cadence:

- daily

Inputs:

- `leagues.top_league = true`
- `matches_history`
- `settlement_stats`

Outputs:

- refreshed `league_profiles`

Rules:

- skip leagues under minimum sample
- keep sample metadata
- no LLM

## Job B: `sync-derived-team-profiles`

Purpose:

- recompute team quantitative core for teams in top leagues

Cadence:

- daily

Inputs:

- team directory for top leagues
- `matches_history`
- `settlement_stats`

Outputs:

- refreshed `team_profiles.quantitative_core`

Rules:

- skip teams under minimum sample
- do not overwrite tactical overlay
- no LLM

## Job C: `sync-team-profile-overlays` (optional, later)

Purpose:

- populate tactical overlay fields for top-league teams only

Cadence:

- weekly or manual refresh

Inputs:

- top-league teams
- curated source whitelist
- optional LLM normalization

Outputs:

- refreshed `team_profiles.tactical_overlay`

Rules:

- overlay fields only
- retain source audit metadata
- do not overwrite quantitative core

## Data Boundaries With Match Enrichment

Match enrichment may:

- read league profile
- read team profile
- attach profile excerpts into prematch features

Match enrichment may not:

- directly mutate league profile
- directly mutate team profile quantitative core
- derive a league/team prior from a single fixture

This boundary is critical to avoid profile contamination.

## Integration With Existing Prematch Features

[prematch-expert-features.ts](C:/tfi/packages/server/src/lib/prematch-expert-features.ts) already treats:

- strategic context
- league profile
- team profile
- provider prediction

as different sources.

That separation should remain.

Required updates:

- consume `quantitative_core` if team profile moves to nested storage
- keep `league_profile` as the environment prior
- use tactical overlay only as optional signal, never as a required dependency

## Storage Strategy

Current JSONB tables are sufficient and should be retained.

Recommended additions inside stored JSON:

- `version`
- `source_mode`
- `window.lookback_days`
- `window.sample_matches`
- per-layer timestamps if nested

This may be implemented without introducing separate physical tables.

## Reliability and Audit

Every derived profile should carry enough metadata to answer:

- how many matches was this based on
- what lookback window was used
- when was it last refreshed
- was this auto-derived or curated

Minimum metadata:

- `version`
- `source_mode`
- `lookback_days`
- `sample_matches`
- `updated_at`

For tactical overlay:

- `source_urls`
- `source_confidence`
- `overlay_updated_at`

## Rollout Constraints

- top leagues only
- no LLM dependency for the core profile system
- no overwrite from per-match enrichment
- backwards compatibility for current consumers during transition

## Recommended Direction

### Immediate

- make league profile fully auto-derived
- make team profile quantitative core fully auto-derived
- compute missing rates like `late_goal_rate_75_plus`, `first_goal_rate`, `late_goal_rate`

### Next

- split team profile semantics into quantitative core and tactical overlay
- preserve current JSONB table but make schema explicit

### Later

- if needed, add an optional tactical overlay job using curated sources and structured LLM normalization

## Final Recommendation

The system should not use Deep Research as the foundation for profiles.

The correct architecture is:

- `API-Football and settled history` as the structured truth layer
- `auto-derived league/team priors` as the durable profile layer
- `optional curated LLM-assisted overlay` only for tactical fields that cannot be derived reliably

This gives:

- consistency
- auditability
- lower cost
- high implementation feasibility
- clean boundaries with match-level enrichment
