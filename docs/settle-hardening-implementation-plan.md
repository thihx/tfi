# Settle Hardening Implementation Plan

Date: 2026-03-21
Scope:
- recommendation settlement
- manual bet settlement
- re-evaluation settlement
- deterministic settle engine
- AI settle fallback prompt and parser

## Goal

Harden the settlement pipeline so it behaves like a sportsbook-grade result engine instead of a best-effort LLM classifier.

Primary objectives:
- correct betting semantics first
- minimize AI usage on standard markets
- prevent data gaps from becoming fake settled outcomes
- keep `ai_performance` clean
- make settlement decisions auditable

## Implementation Status

- Phase 1 complete on 2026-03-21
- Phase 2 complete on 2026-03-21
- Evidence:
  - `npm run typecheck --prefix packages/server`
  - `npm run test --prefix packages/server -- src/__tests__/settle-types.test.ts src/__tests__/auto-settle.test.ts src/__tests__/auto-settle.integration.test.ts src/__tests__/re-evaluate.test.ts`
  - `npm run test --prefix packages/server`

## Core Assumption

Unless product explicitly says otherwise, settlement should follow standard soccer bookmaker semantics:

- standard match markets settle on regular time only
- stoppage time is included
- extra time and penalties are excluded
- quarter-line Asian markets must support split outcomes

If the product wants a different rule, it must be configured explicitly. It should not be inferred from provider status alone.

## In-Scope Files

- `packages/server/src/jobs/auto-settle.job.ts`
- `packages/server/src/jobs/re-evaluate.job.ts`
- `packages/server/src/lib/settle-rules.ts`
- `packages/server/src/lib/normalize-market.ts`
- `packages/server/src/lib/gemini.ts`
- `packages/server/src/__tests__/auto-settle.test.ts`
- `packages/server/src/__tests__/auto-settle.integration.test.ts`
- `packages/server/src/__tests__/re-evaluate.test.ts`

Potential new files:
- `packages/server/src/lib/settle-prompt.ts`
- `packages/server/src/lib/settle-types.ts`
- `packages/server/src/__tests__/settle-rules-quarter-line.test.ts`
- `packages/server/src/__tests__/settle-prompt.test.ts`
- `packages/server/src/scripts/replay-settle-suite.ts`

## Design Principles

1. Deterministic settlement is the default path.
2. AI fallback must only resolve explanation or genuinely unsupported markets.
3. Missing provider data is `unresolved`, not `push`.
4. Market semantics must be explicit and canonical.
5. Settlement type and PnL model must support half outcomes.
6. Every semantic rule change must be test-covered.

## Phase 1: Lock Settlement Semantics

### 1.1 Introduce explicit settlement outcome model

Problem:
- current result enum only supports `win | loss | push`
- quarter-line Asian settlement needs half outcomes

Implementation:
- define a shared settlement outcome model, for example:
  - `win`
  - `loss`
  - `push`
  - `half_win`
  - `half_loss`
  - `void`
  - `unresolved`
- separate:
  - `settlement_outcome`
  - `pnl`
  - user-facing explanation

Acceptance criteria:
- system can represent quarter-line settlement without collapsing into full win/loss/push
- missing-data cases can remain unresolved

Tests:
- unit tests for outcome-to-PnL mapping
- regression tests for existing full win/loss/push paths

### 1.2 Decide and enforce match-time semantics

Problem:
- current code settles `AET/PEN` as ordinary match results

Implementation:
- add explicit settlement context fields:
  - `final_status`
  - `settlement_scope`
- default `settlement_scope = regular_time`
- for standard markets:
  - settle with 90-minute result only
  - reject extra-time/pens inflation
- only future dedicated ET/PEN markets may use a different scope

Acceptance criteria:
- `FT` behaves as today
- `AET/PEN` do not silently alter standard 90-minute market outcomes
- product semantics are encoded in code and tests, not implied by provider status

Tests:
- add tests for FT vs AET vs PEN
- replace current AET test that assumes ordinary over settlement from extra time

## Phase 2: Harden Deterministic Settle Engine

### 2.1 Support quarter-line Asian handicap correctly

Problem:
- current AH logic treats all lines like full-ball/half-ball only

Implementation:
- parse quarter lines:
  - `-0.25`
  - `+0.25`
  - `-0.75`
  - `+0.75`
  - etc.
- split into two adjacent lines and combine sub-results
- compute both:
  - settlement outcome
  - exact PnL multiplier

Acceptance criteria:
- `-0.25 draw` becomes `half_loss`
- `+0.25 draw` becomes `half_win`
- `-0.75 one-goal win` becomes `half_win`
- `+0.75 one-goal loss` becomes `half_loss`

Tests:
- dedicated quarter-line AH test matrix

### 2.2 Support Asian totals / quarter-line O/U if product uses them

Problem:
- goal totals currently assume simple whole/half lines only

Implementation:
- clarify whether recommendations/bets can contain:
  - `over_2.25`
  - `under_2.75`
- if yes, support split-line deterministic settlement
- if not, explicitly reject them rather than silently mis-settle

Acceptance criteria:
- no quarter-line totals are mis-settled as simple full lines

Tests:
- quarter-line totals matrix or explicit unsupported-market tests

### 2.3 Expand deterministic coverage before AI fallback

Problem:
- standard markets can still leak to AI because normalization/canonicalization is weak

Implementation:
- make `normalizeMarket()` canonicalize friendly labels like:
  - `Over/Under 2.5`
  - `BTTS`
  - `Both Teams To Score`
  - `Home Win`
- add deterministic support where safe for:
  - `1x2`
  - `BTTS`
  - standard O/U
  - corners O/U when official stats exist
  - standard AH

Acceptance criteria:
- standard markets do not hit AI because of naming drift

Tests:
- normalization tests for common legacy labels
- integration tests proving deterministic path is used

## Phase 3: Reframe AI Fallback

### 3.1 AI must not convert missing data into fake push

Problem:
- current prompt says no stats for corners/cards => push

Implementation:
- missing stats for stats-dependent markets should become:
  - `unresolved`
  - or explicit `needs_manual_review`
- AI may explain why settlement is unresolved
- AI must not manufacture settlement from missing provider evidence

Acceptance criteria:
- provider data gaps no longer write fake push results

Tests:
- prompt tests for missing corners/cards stats
- integration tests proving unresolved path is used

### 3.2 Narrow the AI role

Implementation:
- AI fallback should only run when:
  - market is truly unsupported by deterministic engine
  - or explanation enrichment is needed after deterministic result
- consider two AI modes:
  - `explanation_only`
  - `unsupported_market_resolution`

Acceptance criteria:
- standard settlement no longer depends on AI judgment

Tests:
- call-count tests
- path tests showing AI not called for deterministic markets

### 3.3 Harden settle prompt and parser

Implementation:
- move settle prompt into dedicated file
- version the settle prompt
- request strict JSON output
- validate:
  - exact number of items
  - unique IDs only
  - allowed result enum only
  - explanation length/sanity
- reject malformed partial arrays instead of silently accepting a subset

Acceptance criteria:
- settle AI path is parser-stable and auditable

Tests:
- malformed JSON tests
- duplicate ID tests
- missing item tests
- real-LLM replay tests

## Phase 4: Data Quality and Auditability

### 4.1 Distinguish resolved vs unresolved vs corrected

Implementation:
- keep audit trail for:
  - deterministic settlement
  - AI fallback settlement
  - unresolved settlement
  - re-evaluation correction
- store settlement method and optionally settle prompt version

Acceptance criteria:
- later audits can answer:
  - which results came from rules
  - which came from AI
  - which were unresolved
  - which were later corrected

Tests:
- repo/route tests if persistence changes are added

### 4.2 Protect `ai_performance` from bad settlement inputs

Implementation:
- only write `ai_performance` when settlement is final and trustworthy
- do not treat unresolved data-gap outcomes as valid settle labels
- define exact behavior for:
  - `push`
  - `half_win`
  - `half_loss`
  - `void`
  - `unresolved`

Acceptance criteria:
- feedback loop reflects valid settled truth, not provider holes

Tests:
- ai-performance integration tests per outcome type

## Phase 5: Real-LLM Settle Replay Suite

Implementation:
- add settle replay harness similar to live-analysis replay
- run in shadow mode against synthetic fixtures
- include hard scenarios:
  - quarter-line AH draw
  - quarter-line AH one-goal margin
  - quarter-line totals
  - missing corners stats
  - AET vs 90-minute scope
  - malformed/ambiguous legacy market labels

Acceptance criteria:
- prompt and parser survive hard cases with real LLM
- unsupported scenarios are rejected or marked unresolved, not mis-settled

Tests:
- replay harness tests
- report output for real LLM runs

## Recommended Rollout Order

1. Phase 1
2. Phase 2.1 and 2.3
3. Phase 3.1 and 3.2
4. Phase 3.3
5. Phase 4
6. Phase 5

This order fixes semantic correctness before prompt polish.

## Sign-Off Criteria

- Quarter-line AH is settled correctly.
- Standard match markets obey configured time scope.
- Missing corners/cards stats do not become fake push.
- Standard markets settle deterministically without AI.
- AI fallback is strict, narrow, and versioned.
- `ai_performance` no longer ingests low-trust settlement labels.
- Full targeted settle suites pass.
- Real-LLM settle replay suite passes hard scenarios.
