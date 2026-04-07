# Prompt Hardening Implementation Plan

Date: 2026-03-21
Scope:
- Core live-analysis prompt
- Supporting prompt that feeds strategic/pre-match context
- Historical-performance prompt context
- Server-side prompt runtime only

## Goal

Harden the core analysis prompt so it behaves like a disciplined football live-betting analyst instead of a generic narrative LLM.

Primary objectives:
- Remove prompt contradictions
- Improve betting calibration
- Reduce narrative bias
- Preserve one central server-side prompt
- Avoid regressions in auto-pipeline and Ask AI flows

## In-Scope Files

- `packages/server/src/lib/live-analysis-prompt.ts`
- `packages/server/src/lib/server-pipeline.ts`
- `packages/server/src/lib/strategic-context.service.ts`
- `packages/server/src/repos/ai-performance.repo.ts`
- `packages/server/src/__tests__/server-pipeline.test.ts`
- `packages/server/src/__tests__/proxy.routes.test.ts`
- `packages/server/src/__tests__/ai-performance.routes.test.ts`
- prompt-focused tests to add under `packages/server/src/__tests__/`

Out of scope for this plan:
- frontend legacy prompt test helpers
- settle prompt unless explicitly revisited after live-analysis hardening

## Design Principles

1. One runtime prompt path only.
2. No instruction duplication unless the blocks are mechanically generated from one source.
3. Betting priors must be data-backed, time-bounded, and sample-size aware.
4. Narrative context must support, not override, live data.
5. Force modes must preserve provenance.
6. Every prompt rule that changes behavior must have a regression test.

## Phase 1: Fix Provenance And Prompt Contradictions

### 1.1 Add explicit execution mode

Problem:
- `forceAnalyze` currently collapses `manual Ask AI` and `watchlist mode F`.

Implementation:
- Add `analysisMode` to prompt input with exact enum:
  - `auto`
  - `system_force`
  - `manual_force`
- Populate it in `server-pipeline.ts`:
  - `manual_force` when Ask AI path explicitly triggers force
  - `system_force` when watchlist mode is `F` but not a manual request
  - `auto` otherwise
- Rewrite the current force block to branch on `analysisMode` instead of raw `forceAnalyze`.

Acceptance criteria:
- Prompt never says “manual user request” for system-triggered force runs.
- Auto runs stay neutral.
- Ask AI remains explicitly marked as manual.

Tests:
- Add prompt unit tests for all 3 execution modes.
- Add server-pipeline tests proving the correct mode is injected.

### 1.2 Unify duplicate/reinforcement policy

Problem:
- Previous-recommendation section and continuity section have conflicting repeat rules.

Implementation:
- Define one single duplicate policy block.
- Policy should explicitly state:
  - exact same `selection + bet_market` requires material change
  - material change must be one of:
    - odds improvement >= configured threshold
    - score change
    - red card
    - meaningful momentum change
    - match minute delta >= configured threshold AND live state materially evolved
- Remove all duplicate rules from other sections and reference only the canonical block.

Acceptance criteria:
- There is exactly one authoritative repetition rule in the prompt.
- Model is not told two different conditions for reissuing a pick.

Tests:
- Prompt string test ensuring only one continuity/duplicate block remains.
- Server-pipeline follow-up analysis test for same pick without meaningful change.

## Phase 2: Replace Static Betting Priors With Governed Dynamic Priors

### 2.1 Remove hardcoded market win-rate claims from core prompt

Problem:
- Static numbers like “1x2_home worst market 35.6%” will drift and can mislead the model.

Implementation:
- Remove all hardcoded historical percentages from `live-analysis-prompt.ts`.
- Keep only structural betting rules that are market-logic based, not stale-stat based.
- Move performance priors into a dedicated dynamic section built entirely from prompt-context data.

Acceptance criteria:
- No hardcoded market performance percentages remain in the prompt.
- Any performance claim in the prompt comes from injected current data.

Tests:
- Prompt snapshot/substring tests that fail if old static percentages remain.

### 2.2 Make dynamic priors sample-size aware

Problem:
- Current performance section can label buckets as strong/reliable with very small samples.

Implementation:
- Extend `getHistoricalPerformanceContext()` output to include `sample_size` for each bucket.
- Define minimum thresholds:
  - overall: minimum 20 settled
  - by market: minimum 15 settled
  - by minute band: minimum 15 settled
  - by odds band: minimum 15 settled
  - by league: minimum 20 settled
- Only inject bucket-level guidance if threshold is met.
- Replace categorical tags:
  - `RELIABLE`, `WEAK`, `DANGER`
  with softer sample-aware phrasing:
  - “small sample, low confidence”
  - “moderate sample”
  - “well-supported sample”

Acceptance criteria:
- Prompt never calls a bucket reliable without sufficient sample.
- Small-sample buckets are either omitted or clearly marked as low-confidence.

Tests:
- Repo tests for aggregation output with sample sizes.
- Prompt tests for omission of undersized buckets.

## Phase 3: Rework Strategic Context Prompt To Produce Structured Betting Inputs

### 3.1 Reduce narrative-only output

Problem:
- Strategic context currently returns mostly narrative text fields.

Implementation:
- Expand research prompt to ask for structured compact outputs:
  - `HOME_FORM_LAST_5`
  - `AWAY_FORM_LAST_5`
  - `HOME_HOME_SPLIT`
  - `AWAY_AWAY_SPLIT`
  - `HOME_GOALS_FOR_AGAINST`
  - `AWAY_GOALS_FOR_AGAINST`
  - `OVER_2_5_PROFILE`
  - `BTTS_PROFILE`
  - `CLEAN_SHEET_PROFILE`
  - `COME_FROM_BEHIND_PROFILE` if available
- Require “No data found” rather than hallucinated prose when not available.
- Keep narrative summary, but downgrade its importance in the live prompt.

Acceptance criteria:
- Strategic context contains structured quantitative priors in addition to narrative.
- Core prompt can consume pre-match priors without relying on free-form prose.

Tests:
- Unit tests for `parseStrategicResponse()`.
- Golden test with full structured response.

### 3.2 Keep competition-type handling, but make it data-safe

Problem:
- Current competition-type rules are useful, but still allow fuzzy narrative overreach.

Implementation:
- Preserve domestic-vs-cross-league logic.
- Add explicit prohibition:
  - do not compare league positions across leagues
  - do not infer strength solely from brand/reputation
- Add explicit fallback:
  - when competition type is unknown, position-gap logic is disabled

Acceptance criteria:
- Cross-league matches cannot accidentally use invalid league-table comparison.

Tests:
- Prompt tests for european/international cases.

## Phase 4: Rework AI-Generated Monitoring Condition

### 4.1 Stop relying on narrow free-form condition generation

Problem:
- Research prompt can only emit very limited atoms and only `AND`, making conditions generic.

Implementation options:

Preferred:
- Replace `AI_CONDITION` free-form string generation with structured tags:
  - `ALERT_WINDOW_START`
  - `ALERT_WINDOW_END`
  - `PREFERRED_SCORE_STATE`
  - `PREFERRED_GOAL_STATE`
  - `FAVOURED_SIDE`
  - `ALERT_RATIONALE`
- Build final machine condition in code.

Fallback:
- Keep string condition, but expand grammar carefully and validate with parser tests.

Acceptance criteria:
- Monitoring condition logic becomes more expressive without becoming parser-fragile.
- Research prompt no longer has to invent code-like expressions under tight constraints.

Tests:
- Parser/validator tests for all accepted condition shapes.
- End-to-end tests from strategic context output to watchlist condition save path.

## Phase 5: Tighten Betting Logic In Core Prompt

### 5.1 Reframe market-selection rules as evidence hierarchy

Implementation:
- Define explicit evidence hierarchy:
  - Tier 1: live stats + live odds
  - Tier 2: live stats + pre-match priors
  - Tier 3: odds + event timeline only
  - Tier 4: event-only / low evidence
- For each tier, define allowed markets:
  - Tier 1: O/U, AH, BTTS, 1X2
  - Tier 2: O/U, AH, selective BTTS
  - Tier 3: O/U, selective AH only
  - Tier 4: no recommendation
- Make the prompt explicitly forbid lower-tier evidence from recommending high-variance markets.

Acceptance criteria:
- Market eligibility depends on evidence quality, not loose narrative reasoning.

Tests:
- Prompt tests for each evidence mode.
- Replay tests for odds-only degraded cases.

### 5.2 Reframe break-even requirement to avoid fake precision

Problem:
- Exact “MUST include Break-even: X%, My estimate: Y%, Edge: Z%” can encourage fabricated precision.

Implementation:
- Keep break-even discipline.
- Soften numeric precision requirement:
  - require estimated probability range or rounded estimate
  - keep exact market break-even from odds
- Example:
  - `Break-even 54.1%, my fair estimate about 58-60%, edge positive`

Acceptance criteria:
- Model remains valuation-aware without pretending to have exact calibrated probability.

Tests:
- Parser tests allowing revised wording.
- Output-format tests ensuring JSON contract still parses.

## Phase 6: Prompt Runtime Cleanup

### 6.1 Remove legacy runtime assumptions

Implementation:
- Ensure all live-analysis runtime calls use only server prompt path.
- Keep frontend legacy prompt file for tests only until migration cleanup phase.
- Mark it explicitly as non-runtime or move it under test helpers later.

Acceptance criteria:
- No runtime call path imports frontend prompt builder.

Tests:
- Grep-based test or CI check to ensure runtime services do not import `ai-prompt.service.ts`.

### 6.2 Version prompt explicitly

Implementation:
- Add prompt version constant:
  - e.g. `LIVE_ANALYSIS_PROMPT_VERSION = 'v4-evidence-calibrated'`
- Save it consistently in recommendation and ai-performance records.

Acceptance criteria:
- Future A/B analysis can distinguish results by prompt version.

Tests:
- Recommendation save tests include non-empty prompt version.

## Test Strategy

### Unit tests

- `live-analysis-prompt.test.ts`
  - execution mode blocks
  - duplicate policy
  - evidence-mode restrictions
  - absence of stale hardcoded priors
  - small-sample suppression in historical section

- `strategic-context.service.test.ts`
  - structured response parsing
  - competition-type handling
  - missing-data behavior

- `ai-performance.repo.test.ts`
  - threshold gating
  - sample-size output

### Integration tests

- `server-pipeline.test.ts`
  - auto vs manual vs system-force prompt metadata
  - odds-only degraded mode
  - API-Football-only stats with degraded `odds_events_only_degraded` when stats are missing (no alternate stats provider)
  - repeated recommendation suppression

- `proxy.routes.test.ts`
  - Ask AI path by matchId
  - prompt-only analysis route behavior

### Replay / scenario tests

Add or update fixtures for:
- full live data, normal recommendation
- same pick repeated with no material change
- same pick allowed after real state change
- odds-only degraded no-bet
- odds-only degraded constrained O/U bet
- european competition with cross-league teams
- small-sample historical-performance context

## Rollout Plan

### Step 1
- Implement Phase 1 only.
- Run full tests.
- Smoke-test Ask AI and auto-pipeline on test DB.

### Step 2
- Implement Phase 2 and Phase 5 together.
- Compare prompt diffs and replay outcomes on stored scenarios.

### Step 3
- Implement Phase 3 and Phase 4.
- Re-run enrich-watchlist workflow and validate stored strategic context schema.

### Step 4
- Turn on new prompt version in test environment first.
- Run shadow sampling for 1-3 days.
- Review:
  - recommendation rate
  - no-bet rate
  - duplicate recommendation rate
  - distribution by market
  - later settlement accuracy

## Sign-Off Criteria

- No prompt contradictions remain.
- No stale hardcoded performance percentages remain in runtime prompt.
- Strategic context includes structured quantitative priors.
- Duplicate suppression policy is singular and test-covered.
- Ask AI and auto-pipeline use the same core prompt version.
- Full test suites pass.
- Replay scenarios show no obvious aggression drift or recommendation collapse.

## Recommended Implementation Order

1. Phase 1
2. Phase 2
3. Phase 5
4. Phase 3
5. Phase 4
6. Phase 6

This order minimizes regression risk:
- fix contradictions first
- fix calibration second
- only then expand upstream research complexity
