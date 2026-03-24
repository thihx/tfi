# Pipeline Core Fix Plan

Date: 2026-03-24
Status: Planned after live-monitor unification refactor

## 1. Goal

Stabilize the canonical server pipeline so that:

1. every persisted recommendation follows the final system decision, not raw AI intent
2. custom condition trigger flow becomes a first-class execution path inside the same pipeline
3. auto-run and manual single-match flows produce the same decision semantics
4. validation relies on deterministic simulation first, with optional real-LLM smoke checks only where they add signal

## 2. What Is Already Done

The runtime ownership problem is already fixed:

1. Live Monitor is now server-driven dashboard only
2. Matches Ask AI now uses the server pipeline
3. settings drift on the frontend was reduced by making monitor config cache server-canonical on successful save/fetch
4. frontend and backend validation for the refactor are passing

This plan focuses only on remaining pipeline-core findings.

## 3. Findings To Fix

### P0. Persistence uses raw AI intent instead of final decision

Current issue:

- In `packages/server/src/lib/server-pipeline.ts`, persistence is gated by `parsed.ai_should_push`.
- Final recommendation eligibility is computed separately as `parsed.should_push` after system safety gates.
- Result: a blocked recommendation can still be saved into recommendations and AI performance ledgers.

Why this is critical:

- it corrupts the canonical recommendation ledger
- it pollutes settlement and performance tracking
- it breaks trust in the production decision contract

Required fix:

1. make save/notify/performance creation depend on final actionable decision, not raw AI intent
2. keep raw AI intent only as debug/audit metadata
3. ensure `shouldPush`, `saved`, and `notified` stay internally consistent for every result row

Primary files:

1. `packages/server/src/lib/server-pipeline.ts`
2. `packages/server/src/__tests__/server-pipeline.test.ts`
3. `packages/server/src/__tests__/pipeline-replay.test.ts`

### P0. Condition trigger is parsed but not fully connected to pipeline execution

Current issue:

- prompt contract already returns:
  - `custom_condition_matched`
  - `condition_triggered_suggestion`
  - `condition_triggered_reasoning_en/vi`
  - `condition_triggered_confidence`
  - `condition_triggered_stake`
- the pipeline currently only carries a reduced subset and does not promote condition-triggered output into a clear execution branch
- condition-trigger information is therefore informational, not operational

Why this is critical:

- custom condition is one of the core domain mechanisms for live betting workflow
- the system can detect a matched condition but still fail to convert it into a consistent downstream action model
- users cannot distinguish between:
  - AI recommendation path
  - condition-triggered actionable path
  - condition-triggered no-bet path

Required fix:

1. extend parsed response shape so all condition-trigger fields survive parsing
2. define explicit pipeline decision states:
   - `no_action`
   - `ai_recommendation`
   - `condition_recommendation`
   - `condition_no_bet`
3. add a dedicated condition branch in the pipeline after AI parsing
4. decide persistence policy explicitly:
   - actionable condition recommendation: persist and notify through canonical ledger
   - condition matched but no-bet: audit only, do not persist as recommendation
5. surface condition outcome cleanly in route responses and UI result rendering

Primary files:

1. `packages/server/src/lib/server-pipeline.ts`
2. `packages/server/src/lib/live-analysis-prompt.ts`
3. `packages/server/src/routes/live-monitor.routes.ts`
4. `src/features/live-monitor/services/server-monitor.service.ts`
5. `src/app/LiveMonitorTab.tsx`
6. `src/app/MatchesTab.tsx`

### P1. Decision contract is overloaded into booleans only

Current issue:

- `ai_should_push` and `should_push` are not enough to represent the full domain state anymore
- custom-condition outcomes need richer state than a boolean plus free text

Required fix:

1. introduce a structured decision contract in pipeline result debug payload, for example:
   - `decisionKind`
   - `decisionSource`
   - `actionable`
   - `persistable`
   - `notifiable`
2. keep current booleans temporarily for compatibility
3. migrate UI and tests to the richer contract first, then reduce boolean ambiguity later

Primary files:

1. `packages/server/src/lib/server-pipeline.ts`
2. `packages/server/src/routes/live-monitor.routes.ts`
3. `src/features/live-monitor/services/server-monitor.service.ts`

### P1. Provider contract mismatch remains in config surface

Current issue:

- legacy config types still allow `claude`
- production server path is effectively aligned around Gemini
- this mismatch encourages invalid operator expectations

Required fix:

1. either remove unsupported provider options from active UI/config surfaces
2. or implement a proper backend provider abstraction before exposing multiple providers again

Recommendation:

- remove unsupported provider exposure from active production-facing UI first
- treat multi-provider support as a separate feature, not as a hidden partial capability

Primary files:

1. `src/features/live-monitor/types.ts`
2. `src/features/live-monitor/config.ts`
3. `src/app/SettingsTab.tsx`
4. any backend provider resolver files used by prompt execution

### P2. Notification path needs explicit contract separation

Current issue:

- Telegram flow works, but notification semantics are still tightly coupled to recommendation persistence assumptions
- email remains intentionally deferred

Required fix:

1. define notification eligibility from the final decision contract
2. ensure condition-trigger recommendation path uses the same notification contract
3. keep email deferred until SMTP is real

Out of scope for now:

- SMTP/email implementation

## 4. Recommended Execution Order

### Phase 1. Fix final decision contract

Deliverables:

1. replace `shouldSave = parsed.ai_should_push` with final-actionable gating
2. add regression tests for blocked-but-AI-positive scenarios
3. confirm no recommendation is saved when final decision is blocked

Acceptance:

- every saved recommendation must also have final `shouldPush = true`

### Phase 2. Connect condition-trigger branch

Deliverables:

1. preserve full condition-trigger fields in parsed response
2. implement condition-trigger decision branch
3. decide persistence/notification rules for actionable condition triggers
4. expose this path in dashboard/manual-analysis responses

Acceptance:

- simulation can distinguish and validate condition matched actionable vs condition matched no-bet

### Phase 3. Clean up provider/config contract

Deliverables:

1. remove unsupported provider exposure from active UI
2. align shared config defaults and server capabilities
3. add validation so invalid provider values cannot silently leak into runtime

Acceptance:

- operator-facing settings no longer advertise unsupported provider combinations

### Phase 4. Expand regression coverage

Deliverables:

1. add more replay fixtures around condition-trigger and blocked-save cases
2. add targeted UI assertions for condition-trigger rendering once implemented
3. keep replay suite aligned with production contract

Acceptance:

- deterministic tests cover all decision classes

## 5. Test Strategy

### 5.1 Deterministic simulation baseline

These should remain the main confidence layer:

1. `npm run test --prefix packages/server -- --run src/__tests__/server-pipeline.test.ts`
2. `npm run test --prefix packages/server -- --run src/__tests__/pipeline-replay.test.ts`
3. `npm run test --prefix packages/server -- --run src/__tests__/live-monitor.routes.test.ts`
4. `npm test -- --run src/app/LiveMonitorTab.test.tsx src/app/MatchesTab.test.tsx`

Purpose:

- fast
- deterministic
- safe for CI
- good for edge-case regression

### 5.2 Fixture replay expansion

Use archived replay fixtures to test condition-trigger cases explicitly:

1. actionable condition trigger
2. condition matched but no-bet
3. AI says push but final system blocks
4. unsupported market for current evidence mode
5. odds unavailable or hallucinated

Purpose:

- validate domain decisions against recorded match states

### 5.3 Real LLM smoke tests

Use real LLM only after the deterministic suite is green.

Recommended scope:

1. 3 to 5 curated fixtures only
2. not in CI
3. only when model/API credentials are present
4. store outputs as audit artifacts for manual review

Use real LLM for:

1. prompt contract sanity after condition-trigger changes
2. checking whether parser still receives all required fields
3. validating that final decision and condition branch behave plausibly on real model output

Do not use real LLM for:

1. broad regression coverage
2. pass/fail CI gating
3. unstable nightly verification

## 6. Proposed Immediate Next Patch

The first patch after this plan should do only the following:

1. fix save/notify/performance gating to depend on final actionable decision
2. add regression tests for blocked final decisions
3. keep condition-trigger branch changes out of that patch

Reason:

- smallest high-value correction
- lowest blast radius
- removes ledger corruption before deeper feature work

## 7. Deferred Items

Deferred intentionally:

1. SMTP/email implementation
2. multi-provider backend support beyond Gemini
3. full removal of legacy frontend pipeline simulation code if it is still useful for test replay tooling

## 8. Success Criteria

This findings plan is considered complete when:

1. no blocked recommendation is ever persisted
2. condition-trigger outcomes are first-class pipeline decisions
3. manual and auto paths return the same decision semantics
4. deterministic simulation passes for all decision branches
5. optional real-LLM smoke tests confirm prompt contract health after changes
