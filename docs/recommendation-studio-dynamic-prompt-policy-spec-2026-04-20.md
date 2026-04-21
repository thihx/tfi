# Recommendation Studio Dynamic Prompt & Policy Spec

Date: 2026-04-20  
Status: Ready for implementation  
Audience: backend, frontend, QA, ops  
Scope: live recommendation pipeline prompt and rule/policy management via admin UI

## 1. Executive Summary

TFI currently requires source-code edits and redeploys whenever the live recommendation prompt, market-selection wording, or recommendation rules/policies need adjustment. This makes the system slow to operate and leaves admins dependent on engineering for changes that are operational in nature.

This spec defines a new `Recommendation Studio` capability that lets an admin:

1. Edit prompt behavior dynamically through structured prompt sections plus controlled token insertion.
2. Add, edit, enable, disable, and prioritize recommendation rules through a form-based builder.
3. Replay one or many existing recommendations or snapshots with a real LLM before activation.
4. Compare results, metrics, diffs, and historical releases.
5. Activate a release globally and roll back quickly.

This design deliberately does **not** allow the admin to edit core safety-critical runtime behavior such as odds parsing, evidence-mode derivation, settlement invariants, or auth/security constraints.

The goal is operational agility without sacrificing runtime safety.

---

## 2. Problem Statement

### Current Pain

Today, changing any of the following requires code changes:

- live prompt wording
- market-selection instructions
- extra prompt discipline sections
- post-parse market blocking/capping rules
- some cohort-specific guardrails

That has several problems:

- admins are blocked on engineering
- experimentation is slow
- response to live market-quality problems is slow
- replay/testing is script-based and not directly usable from the product UI
- versioning and rollback are code-centric, not operations-centric

### Operational Need

The system needs a first-class admin tool that supports:

- fast changes without code deploys
- safe experimentation
- replay using real LLM calls
- versioning and rollback
- clear auditability

---

## 3. Decisions Already Made

These are settled requirements from product discussions and should be treated as fixed unless explicitly reopened.

### 3.1 Admin Behavior

- Only `admin` users may access and use this feature.
- Admin may activate releases directly.
- No separate approval workflow is required in phase 1.

### 3.2 Activation Model

- Release activation is global across the whole system.
- No `% traffic`, per-league, per-market, or per-user rollout in phase 1.
- No shadow release in phase 1.

### 3.3 Replay / Rerun

- Replay must use a **real LLM**, not mock-only.
- Admin must be able to select one or many prior `recommendations` and/or `match_snapshots` and rerun them.
- The replay result must be evaluated against existing settled outcomes when available.

### 3.4 Prompt Editing Mode

- Phase 1 should **not** allow unconstrained full-prompt freeform editing.
- Phase 1 will use a **hybrid model**:
  - immutable base prompt in code
  - editable prompt sections stored in DB
  - controlled token insertion from a token catalog
  - optional bounded advanced appendix block

### 3.5 Rule Builder

- Rule editing must be form-based.
- No arbitrary code, no arbitrary DSL, no unrestricted JSON scripting in phase 1.

### 3.6 Data Storage

- Configuration must be stored in dedicated tables from day one.
- Do not use `user_settings(default)` as the main storage mechanism.

---

## 4. Goals

### Primary Goals

1. Remove the need for code changes for most prompt/rule tuning.
2. Make admin operations faster and safer.
3. Provide replay validation with real LLM calls before activation.
4. Preserve strict runtime safety around canonical odds, evidence mode, and settlement correctness.
5. Provide release history, diffs, audit trail, and rollback.

### Secondary Goals

1. Improve institutional memory of prompt/rule changes.
2. Make replay-based validation a first-class operational workflow.
3. Reduce accidental regressions from prompt edits.

---

## 5. Non-Goals

These are explicitly out of scope for phase 1.

- Editing odds parsing / canonicalization logic from UI
- Editing evidence-mode derivation from UI
- Editing settlement rules from UI
- Editing authorization or notification routing from UI
- Per-cohort traffic rollout
- Shadow/prompt A/B routing
- User-facing customization of recommendation logic
- Full freeform scripting language for admin policy logic

---

## 6. Current Runtime Architecture

### 6.1 Prompt Construction

Current prompt building is hard-coded in:

- [packages/server/src/lib/live-analysis-prompt.ts](/C:/tfi/packages/server/src/lib/live-analysis-prompt.ts)

This file currently contains:

- prompt version registry
- prompt section builders
- exact market output contract
- evidence hierarchy wording
- market-selection wording
- follow-up/Ask AI prompt logic
- multiple cohort-targeted discipline sections

### 6.2 Recommendation Runtime

Core runtime lives in:

- [packages/server/src/lib/server-pipeline.ts](/C:/tfi/packages/server/src/lib/server-pipeline.ts)

This pipeline currently:

1. loads fixture, watchlist, profiles, strategic context, lineups
2. derives stats/odds/events and `evidenceMode`
3. builds the prompt
4. calls LLM
5. parses response
6. applies safety checks
7. applies recommendation policy
8. persists recommendation
9. sends notification

### 6.3 Policy Layer

Post-parse gates currently live in:

- [packages/server/src/lib/recommendation-policy.ts](/C:/tfi/packages/server/src/lib/recommendation-policy.ts)

This layer handles:

- block decisions
- warning generation
- confidence adjustment
- stake adjustment
- some cohort-specific restrictions

### 6.4 Settings Infrastructure

The repo already has JSON settings infrastructure:

- [packages/server/src/repos/settings.repo.ts](/C:/tfi/packages/server/src/repos/settings.repo.ts)
- [packages/server/src/routes/settings.routes.ts](/C:/tfi/packages/server/src/routes/settings.routes.ts)

This is useful for admin/system settings patterns, but it is **not sufficient** as the primary storage model for prompt/rule/release management.

---

## 7. Architectural Design

## 7.1 High-Level Design

Introduce a new subsystem called `Recommendation Studio`.

It consists of:

1. `Prompt Studio`
2. `Rule Studio`
3. `Replay Lab`
4. `Release Manager`

### 7.1.1 Runtime Principle

At runtime, the recommendation pipeline should execute in this order:

1. load active release
2. build prompt context from existing live data
3. apply `pre_prompt` rules
4. compile final prompt from base template + editable sections + tokens
5. call LLM
6. parse LLM response
7. apply immutable hard safety
8. apply `post_parse` rules
9. persist + notify

This preserves the current pipeline shape while inserting dynamic behavior safely.

---

## 8. Safety Boundary: What Must Remain Hard-Coded

The following must remain immutable in code in phase 1:

1. odds canonical parsing and normalization
2. evidence-mode derivation
3. output JSON schema requirements
4. no invented odds / no invented markets constraints
5. persistence invariants
6. settlement invariants
7. authz rules
8. system routing / notification dispatch

Reason:

- these are not “operational tuning”; they are safety-critical runtime mechanics

Recommendation Studio may influence behavior around these mechanics, but not redefine them.

---

## 9. Prompt Design Model

## 9.1 Why Not Full Prompt Freeform

Full prompt freeform editing seems flexible, but is unsafe because an admin could:

- remove required output instructions
- remove required tokens
- break exact market enums
- accidentally destroy follow-up behavior
- create inconsistent H1/FT wording
- remove safety statements

This would make the runtime fragile and increase silent regressions.

## 9.2 Phase 1 Prompt Model: Hybrid

Prompt assembly should be:

`effectivePrompt = immutableBaseTemplate + editableSections + advancedAppendix + runtimeTokens`

### 9.2.1 Immutable Base Template

Stored in code and not editable through UI.

It contains:

- role/system framing
- required output contract
- non-removable safety contract
- fixed prompt scaffolding

### 9.2.2 Editable Sections

Stored in DB and editable by admin.

These are named sections such as:

- `market_selection_discipline`
- `goals_ou_rules`
- `btts_rules`
- `corners_rules`
- `continuity_rules`
- `follow_up_answer_rules`
- `lineup_answer_rules`
- `reasoning_style_guidance`

Each section has:

- label
- key
- markdown/plain-text content
- enabled
- ordering
- notes

### 9.2.3 Advanced Appendix

An optional bounded freeform text block.

Purpose:

- allow admin to inject a limited extra instruction block when section editing is not enough

Constraints:

- size cap
- cannot contain forbidden raw tokens outside token picker
- cannot disable mandatory base contract

### 9.2.4 Token Catalog

Admins must insert tokens from a controlled picker, not type arbitrary runtime placeholders.

Examples:

- `{{MATCH_CONTEXT}}`
- `{{LIVE_STATS_COMPACT}}`
- `{{LIVE_ODDS_CANONICAL}}`
- `{{EVENTS_COMPACT}}`
- `{{PREMATCH_EXPERT_FEATURES}}`
- `{{LINEUPS_SNAPSHOT}}`
- `{{EVIDENCE_MODE_RULE}}`
- `{{PREVIOUS_RECOMMENDATIONS}}`
- `{{EXACT_OUTPUT_ENUMS}}`

The system must validate:

- unknown token
- required token missing
- token duplicated where not allowed

---

## 10. Rule Design Model

## 10.1 Stages

The architecture must support both:

- `pre_prompt`
- `post_parse`

### 10.1.1 Why both are needed

If only `post_parse` exists:

- admin can block or cap after the LLM speaks
- but cannot control what the model sees and considers

If only `pre_prompt` exists:

- admin can hide or bias prompt inputs
- but cannot hard-stop a parsed pick after LLM output

The architecture therefore must support both stages immediately.

## 10.2 Phase 1 UI Exposure

Phase 1 should allow:

### `pre_prompt`

- hide market families in certain cohorts
- inject exceptional-only guidance
- raise no-bet bias in specific zones
- hide H1/FT families conditionally

### `post_parse`

- block
- force no bet
- cap stake
- cap confidence
- add warning
- raise minimum edge requirement

---

## 11. Rule Builder Form Model

Rules must be form-based, not code-based.

Each rule has:

- `name`
- `description`
- `enabled`
- `stage`
- `priority`
- `conditions`
- `actions`
- `notes`

## 11.1 Conditions Supported in Phase 1

- minute band
- match period (`H1`, `FT`, `either`)
- score state
- evidence mode
- market family
- canonical market
- prematch strength
- risk level
- odds range
- line range
- current goals range
- current corners range
- prompt version / release

## 11.2 Actions Supported in Phase 1

- `block`
- `force_no_bet`
- `cap_confidence`
- `cap_stake`
- `raise_min_edge`
- `warning`
- `hide_market_family_from_prompt`
- `mark_exceptional_only`

## 11.3 Conditions and Actions Not Supported in Phase 1

- arbitrary boolean expressions typed by admin
- JS/TS snippets
- arbitrary SQL
- unrestricted JSON DSL

---

## 12. Release Model

Configuration must be versioned as a release.

A release is the atomic activation unit.

Each release binds:

- one prompt template
- one rule set
- one replay validation result set
- activation metadata

Statuses:

- `draft`
- `validated`
- `active`
- `archived`

Rules:

- only one active release at a time
- active release cannot be edited directly
- clone-to-draft is required for changes
- rollback must activate a previous release record, not mutate active in place

---

## 13. Replay Lab Requirements

Replay is not optional. It is a required step before release activation.

## 13.1 Replay Inputs

Admin can replay:

- one or many `recommendations`
- one or many `match_snapshots`
- saved replay sets

Selection methods:

- explicit row selection
- date range
- market family
- H1/FT
- league
- score state
- minute band
- settled result

## 13.2 Replay Execution

Replay must use:

- real LLM
- selected prompt/rule release draft
- current replay harness rules
- existing snapshot data

Replay must support:

- single rerun
- bulk rerun

## 13.3 Replay Outputs

Replay results must include:

- push rate
- no-bet rate
- under share
- accuracy
- average odds
- average break-even
- total stake
- P/L
- ROI
- by market family
- by H1 vs FT
- by minute band
- by score state
- by prematch strength

For each replayed item:

- original recommendation
- replayed recommendation
- original settled outcome
- replayed simulated settled outcome
- delta in decision
- delta in P/L

## 13.4 Replay Cost Guardrails

Replay uses real LLM and therefore must have:

- concurrency cap
- batch size cap
- per-run item limit
- admin warning before execution
- persistent replay job record
- visible cost warning in UI

---

## 14. Diff and Audit Requirements

The system must support diff views for:

- prompt template version vs prompt template version
- rule set vs rule set
- release vs release

Minimum diff requirements:

- added / removed / changed prompt sections
- changed rule conditions
- changed rule actions
- changed enable/disable status
- changed priorities

Audit log must capture:

- who created draft
- who edited prompt section
- who edited rule
- who ran replay
- who activated release
- who rolled back release
- timestamp for every action
- optional release note / reason

---

## 15. Recommended Database Schema

This must be implemented in dedicated tables, not `user_settings`.

## 15.1 `recommendation_prompt_templates`

- `id`
- `key`
- `name`
- `base_template_key`
- `status`
- `advanced_appendix_text`
- `created_by`
- `created_at`
- `updated_at`

## 15.2 `recommendation_prompt_sections`

- `id`
- `prompt_template_id`
- `section_key`
- `section_label`
- `content`
- `enabled`
- `sort_order`
- `created_at`
- `updated_at`

## 15.3 `recommendation_rule_sets`

- `id`
- `key`
- `name`
- `status`
- `created_by`
- `created_at`
- `updated_at`

## 15.4 `recommendation_rules`

- `id`
- `rule_set_id`
- `name`
- `description`
- `stage`
- `priority`
- `enabled`
- `conditions_json`
- `actions_json`
- `notes`
- `created_at`
- `updated_at`

## 15.5 `recommendation_releases`

- `id`
- `key`
- `name`
- `prompt_template_id`
- `rule_set_id`
- `status`
- `activation_scope` (`global` only in phase 1)
- `replay_validation_status`
- `release_notes`
- `created_by`
- `activated_by`
- `created_at`
- `activated_at`
- `rollback_of_release_id`

## 15.6 `recommendation_replay_runs`

- `id`
- `release_id`
- `mode` (`recommendations` / `snapshots` / `saved_set`)
- `status`
- `selection_query_json`
- `llm_model`
- `total_items`
- `completed_items`
- `summary_json`
- `created_by`
- `created_at`
- `completed_at`

## 15.7 `recommendation_replay_run_items`

- `id`
- `replay_run_id`
- `source_type`
- `source_id`
- `match_id`
- `snapshot_id`
- `recommendation_id`
- `original_decision_json`
- `replayed_decision_json`
- `evaluation_json`
- `status`

## 15.8 `recommendation_release_audit_logs`

- `id`
- `actor_user_id`
- `entity_type`
- `entity_id`
- `action`
- `before_json`
- `after_json`
- `notes`
- `created_at`

## 15.9 Optional Phase 2

`recommendation_replay_saved_sets`

- `id`
- `name`
- `selection_json`
- `created_by`
- `created_at`

---

## 16. Backend API Design

These are recommended APIs.

## 16.1 Prompt APIs

- `GET /api/recommendation-studio/prompts`
- `GET /api/recommendation-studio/prompts/:id`
- `POST /api/recommendation-studio/prompts`
- `PUT /api/recommendation-studio/prompts/:id`
- `POST /api/recommendation-studio/prompts/:id/clone`
- `POST /api/recommendation-studio/prompts/:id/compile-preview`

## 16.2 Rule APIs

- `GET /api/recommendation-studio/rule-sets`
- `GET /api/recommendation-studio/rule-sets/:id`
- `POST /api/recommendation-studio/rule-sets`
- `PUT /api/recommendation-studio/rule-sets/:id`
- `POST /api/recommendation-studio/rule-sets/:id/clone`
- `POST /api/recommendation-studio/rules`
- `PUT /api/recommendation-studio/rules/:id`
- `POST /api/recommendation-studio/rules/:id/toggle`

## 16.3 Replay APIs

- `POST /api/recommendation-studio/replay-runs`
- `GET /api/recommendation-studio/replay-runs/:id`
- `GET /api/recommendation-studio/replay-runs/:id/items`
- `POST /api/recommendation-studio/replay-runs/:id/cancel`

## 16.4 Release APIs

- `GET /api/recommendation-studio/releases`
- `GET /api/recommendation-studio/releases/:id`
- `POST /api/recommendation-studio/releases`
- `POST /api/recommendation-studio/releases/:id/activate`
- `POST /api/recommendation-studio/releases/:id/rollback`
- `GET /api/recommendation-studio/releases/:id/diff/:otherId`

## 16.5 Catalog APIs

- `GET /api/recommendation-studio/token-catalog`
- `GET /api/recommendation-studio/rule-metadata`

These return:

- token definitions
- section definitions
- allowed condition fields
- allowed operators
- allowed actions
- validation rules

---

## 17. UI / UX Design

## 17.1 Placement

Add a new admin-only area:

- `Settings > System > Recommendation Studio`

or a separate top-level admin surface if preferred.

## 17.2 Main Tabs

### Tab 1: Prompt

Features:

- list prompt templates
- create draft
- clone
- edit sections
- token picker
- compile preview
- diff vs active

### Tab 2: Rules

Features:

- rule set list
- create/edit/clone
- rule table
- filters by stage / enabled / priority
- form builder
- conflict warnings

### Tab 3: Replay Lab

Features:

- select recommendations/snapshots
- run replay with real LLM
- monitor status
- metrics dashboard
- case diff viewer

### Tab 4: Releases

Features:

- release list
- active release indicator
- compare releases
- activation
- rollback
- audit trail

---

## 18. Runtime Integration Detail

## 18.1 Prompt Compilation

At runtime:

1. load active release
2. load active prompt template
3. load sections sorted by `sort_order`
4. compile prompt:
   - immutable base template
   - enabled editable sections
   - advanced appendix
   - runtime token expansion

If compile fails:

- fail closed
- use current active release unchanged
- log audit event

## 18.2 Rule Application

### `pre_prompt`

Can influence:

- which market families appear in prompt
- whether a market family is “exceptional-only”
- whether extra caution text is injected

### `post_parse`

Can influence:

- block
- no-bet
- confidence/stake caps
- extra warnings

## 18.3 Hard Safety Precedence

Order of precedence:

1. hard safety core
2. release prompt/rules
3. LLM
4. hard safety core again
5. dynamic post-parse rules

Hard safety must always win.

---

## 19. Impact Analysis

## 19.1 Backend Impact

Impacted areas:

- settings/admin route layer
- recommendation runtime load path
- replay orchestration
- release activation / rollback
- audit logging

Non-impacted or minimally impacted:

- auth topology
- odds parser logic
- settlement core
- existing notification transport

## 19.2 Frontend Impact

Impacted areas:

- Settings/System admin UI
- new Prompt/Rules/Replay/Release screens
- new diff UI
- replay progress and result tables

## 19.3 Operational Impact

Positive:

- faster prompt/rule iteration
- safer rollback
- better auditability

Risks:

- replay cost spikes
- admin may over-edit logic
- activation mistakes without replay discipline

---

## 20. Edge Cases

This section is mandatory for implementation.

## 20.1 Prompt Edge Cases

1. Required token missing
2. Unknown token inserted
3. Section disabled that indirectly removes required guidance
4. Advanced appendix tries to contradict mandatory base contract
5. Compiled prompt too large
6. Prompt diff shows no semantic change but ordering changed

Required behavior:

- validate before save
- validate before activation
- fail closed on compile

## 20.2 Rule Edge Cases

1. Two rules with same priority conflict
2. `pre_prompt` hides all markets
3. `post_parse` blocks every possible output
4. Rule set has invalid conditions JSON
5. Rule action references unsupported market family
6. Rule set edited while active

Required behavior:

- validation warnings
- deterministic priority order
- clone-to-draft flow for active content

## 20.3 Replay Edge Cases

1. replay item has missing snapshot data
2. recommendation exists but settle result missing
3. replay run cancelled mid-way
4. LLM error for some items in a batch
5. large replay batch times out
6. replay uses outdated release while a newer one activates

Required behavior:

- item-level status tracking
- partial completion allowed
- clear failure reasons
- immutable replay linkage to release version used at run start

## 20.4 Activation Edge Cases

1. activate with no replay run
2. activate with failed replay run
3. activate release missing prompt sections
4. activate while another activation is in progress
5. rollback to archived/broken release

Required behavior:

- block activation unless validation passes
- lock activation transactionally

## 20.5 Runtime Edge Cases

1. active release cannot be loaded
2. prompt compile fails in production
3. rules load partially
4. replay-created draft contains invalid state not caught in UI
5. admin deactivates all sections accidentally

Required behavior:

- runtime fallback to previous known-good active release snapshot
- strong audit + alerting

---

## 21. Security / Governance

Only admin users can:

- create prompt templates
- edit rules
- run replay
- activate releases
- rollback releases

Requirements:

- route-level authz
- audit all write operations
- record actor ID
- prevent direct DB mutation assumptions in UI

No client-side trust for:

- token validity
- replay permissions
- activation eligibility

Everything must be revalidated on the backend.

---

## 22. Testing Strategy

Testing must be implementation-grade, not aspirational.

## 22.1 Unit Tests

### Prompt compiler

- compile with valid sections
- reject unknown token
- reject missing required token
- bounded appendix validation

### Rule engine

- condition matching
- priority resolution
- conflicting action behavior
- pre_prompt application
- post_parse application

### Release selection

- returns only active release
- clone from active -> draft
- rollback path

## 22.2 Backend Integration Tests

- create prompt template
- create rule set
- create replay run
- replay run item persistence
- activate release
- rollback release
- admin-only authz enforcement

## 22.3 UI Tests

- prompt section editing
- token insertion
- rule builder create/edit/toggle
- replay run creation
- release activation flow
- diff rendering

## 22.4 Replay Validation Tests

Must verify:

- replay can run on one recommendation
- replay can run on many recommendations
- replay can run on selected snapshots
- replay metrics summary is persisted
- original vs replayed decision delta is displayed

## 22.5 Failure-Mode Tests

- compile failure
- LLM failure on subset of replay items
- activation blocked without valid replay
- rollback from prior release succeeds

## 22.6 Manual QA Checklist

Before go-live:

1. create draft prompt from active
2. edit one section
3. preview compiled prompt
4. create rule set with one `post_parse` rule
5. run replay on 5 settled recommendations
6. verify metrics render
7. activate release
8. verify runtime uses new release
9. rollback
10. verify runtime returns to prior release

---

## 23. Acceptance Criteria

The feature is ready only when all criteria below are satisfied.

### Prompt

- admin can create/edit/clone prompt templates
- token picker works
- compile preview works
- invalid tokens are blocked

### Rules

- admin can create/edit/clone rule sets
- form-based conditions/actions validate correctly
- enable/disable works

### Replay

- admin can select one or many recommendations/snapshots
- replay runs with real LLM
- metrics are persisted and viewable
- replay deltas are visible at case level

### Release

- admin can create a release from prompt+rule set
- admin can activate globally
- admin can rollback
- diffs are viewable

### Safety

- active release cannot be edited directly
- activation without validation is blocked
- hard safety core remains in code
- full audit trail exists

---

## 24. Recommended Implementation Order

### Phase 1A: Foundations

- schema
- repos
- backend models
- admin authz

### Phase 1B: Prompt + Rule CRUD

- prompt editor APIs
- rule builder APIs
- token catalog
- rule metadata catalog

### Phase 1C: Replay Lab

- replay run creation
- background execution
- result persistence
- metrics summary

### Phase 1D: Release Manager

- create release
- activation
- rollback
- diff

### Phase 1E: UI

- Prompt tab
- Rules tab
- Replay tab
- Release tab

### Phase 1F: Hardening

- failure-mode tests
- audit trail review
- operational documentation

---

## 25. Open Implementation Notes

1. The replay engine should reuse existing settled replay infrastructure rather than invent a separate evaluator.
2. The release loader should cache active release briefly, with explicit invalidation after activation.
3. Replay runs should be background jobs, not synchronous request/response.
4. The UI should warn that replay uses real LLM and may incur cost.
5. The backend must store the exact release snapshot used by each replay run.

---

## 26. Final Recommendation

Proceed with `Recommendation Studio` as:

- hybrid prompt editing
- form-based rules
- real-LLM replay
- dedicated release model
- global activation
- admin-only access
- dedicated schema from day one

This is the smallest design that is:

- operationally useful
- safe enough for production tuning
- extensible later to shadow releases and segmented rollout

It avoids the two main failure modes:

1. too rigid to be useful  
2. too freeform to be safe

---

## 27. Deliverables Expected From Implementation

Implementation is complete only when it ships with:

1. DB migrations for all required tables
2. backend repos/services/routes
3. admin UI
4. replay execution UI and backend
5. release activation/rollback
6. diff UI
7. audit trail
8. automated tests
9. operator-facing usage guide

This document is intended to be sufficient for implementation and QA without rewriting the spec.
