# Recommendation Studio Usage Guide

This guide is for admins operating `Settings > System > Recommendation Studio`.

## What Recommendation Studio Controls

Recommendation Studio lets admins:

- edit prompt overlays on top of the immutable safety prompt
- create `pre_prompt` and `post_parse` rules
- replay settled recommendations or snapshots with the **real LLM**
- activate or roll back a release globally

It does **not** let admins change:

- odds parsing / canonicalization
- evidence-mode derivation
- exact-output schema
- settlement rules
- auth / persistence invariants

Those remain code-backed safety controls.

## Basic Workflow

1. Clone the current prompt or create a new prompt draft.
2. Edit sections and appendix using only supported tokens.
3. Create or edit a rule set.
4. Build a release from the prompt + rule set.
5. Run replay against settled recommendations or snapshots.
6. Review metrics, case deltas, and diffs.
7. Activate globally only after replay validation passes.
8. Roll back immediately if live behavior regresses.

## Prompt Editing Rules

- Do not remove the core overlay tokens:
  - `{{MATCH_CONTEXT}}`
  - `{{LIVE_STATS_COMPACT}}`
  - `{{LIVE_ODDS_CANONICAL}}`
- Use the token picker only. Unknown tokens are blocked.
- `{{EXACT_OUTPUT_ENUMS}}` is available for advanced overlays when needed, but it should not be duplicated.
- If a prompt or rule set is part of the active release, it becomes read-only. Clone it first.

## Rule Builder Notes

### `pre_prompt`

Use for:

- hiding market families
- appending extra guidance
- marking a zone exceptional-only

Do not use `pre_prompt` for odds, line, or risk filters. Those are blocked by validation because no specific parsed market exists yet.

### `post_parse`

Use for:

- `block`
- `forceNoBet`
- `capConfidence`
- `capStakePercent`
- `raiseMinEdge`
- `warning`

Use `raiseMinEdge` when a market should only survive if replay value is above a hard floor.

## Replay Guidance

- Replay uses the **real LLM** and costs tokens.
- Use small batches first.
- A replay batch can mix recommendations and snapshots.
- If a replay run is canceled, the associated release returns to `not_validated`.
- A run may finish as `completed_with_errors` if some items fail while others complete.

## Required Review Before Activation

Check:

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

Also inspect case-level deltas:

- original recommendation
- replayed recommendation
- original settled result
- replayed simulated result
- decision changed or not
- P/L delta

## Rollback

- `Rollback Clone` creates a new draft release copied from a prior release.
- `Rollback` activates an already validated prior release directly.
- After activation or rollback, runtime reads the active release directly from the database.

## Operational Warnings

- Do not activate a release that has not been replay-validated.
- Do not treat `completed_with_errors` as equivalent to a clean validation run; inspect failed items.
- Use diff views before activation to avoid accidental changes.
- Keep release notes meaningful so audit logs stay useful.
