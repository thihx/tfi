# Ask AI V8 And Match Follow-Up Design

Date: 2026-04-05
Status: In progress

## Goals

1. Reduce the current machine-like bias toward `goals_under` selections.
2. Re-open viable room for `1x2_home` and `asian_handicap` when live evidence and priors align.
3. Keep live evidence as the primary driver.
4. Use priors only as:
   - confirmation
   - contradiction
   - tiebreak support
5. Add match-scoped Ask AI follow-up so a user can ask a question about the current match context without creating extra saved recommendations.

## Observed Problems

### Market mix drift

Recent runtime behavior shows:

- `goals_under` dominates the market mix
- `1x2` and `asian_handicap` are almost absent
- many `Under` recommendations rely on generic reasons:
  - slow tempo
  - few shots
  - low xG
  - low event count

This produces:

- repeated generic reasoning
- valid short streaks of wins or losses that depend too much on broad heuristics
- weak differentiation by team and league context

### Prompt / policy asymmetry

Current behavior is skewed by:

- strong early blocking for `1x2_home`
- strict discipline for `BTTS No`
- multiple prompt hints that make `goals_under` the easiest surviving market family

### Ask AI follow-up gap

`Ask AI` currently returns one structured answer for a match, but there is no grounded follow-up path for questions like:

- `If I want Over 3.5 here, is it reasonable?`
- `Would home -0.25 be better than Under?`
- `Why not 1x2 home?`

## V8 Design

Prompt version:

- `v8-market-balance-followup-a`

### Core market-balance rules

V8 must add these rules on top of current betting discipline:

1. `goals_under` must not become the default fallback just because:
   - tempo is slow
   - shots are low
   - xG is modest
2. Before minute 60, generic low-event evidence is not enough for `goals_under` on its own.
3. For `goals_under`, the model must explicitly classify priors as:
   - aligned
   - neutral
   - contradictory
4. If priors strongly contradict an under thesis and live evidence is not overwhelming:
   - return `should_push=false`
5. If the match supports a favourite/control thesis:
   - consider `1x2_home` or `asian_handicap_home` before falling back to generic `goals_under`
6. If no market has a clean edge:
   - return `No bet`

### Priors policy

Allowed priors:

- `league_profile`
- `team_profile.quantitative_core`
- `prematch expert features`
- `tactical_overlay` only when provenance is strong

Disallowed as core priors:

- tipster commentary
- crowd opinion
- betting picks from third parties
- rumor-driven narratives

### Hard policy adjustment

Policy should be relaxed only narrowly for V8:

- `1x2_home` no longer blocked until minute 75 in V8
- instead, block before minute 60

This keeps the active policy intact for older prompt versions while allowing V8 replay to test a less extreme market mix.

## Match-Scoped Ask AI Follow-Up

### Scope

Follow-up chat is limited to one specific match.

It must not behave as a general chatbot.

### Shared processing model

Normal Ask AI:

- no user question
- current save / notify behavior remains unchanged

Follow-up Ask AI:

- a `userQuestion` is provided
- the same grounded match-analysis pipeline is used
- the same current snapshot is used
- the answer is advisory only

### Advisory-only rules

If `userQuestion` is present:

- do not save a recommendation row
- do not notify Telegram / Web Push
- do not create delivery rows
- do not ladder exposure
- do not alter recommendation statistics directly

The output should still include the normal structured analysis fields so the answer remains grounded and internally consistent.

### Output extension

The prompt and parser should include:

- `follow_up_answer_en`
- `follow_up_answer_vi`

These fields should:

- answer the user question directly
- stay grounded in the current match snapshot
- mention when the requested market is weak, unavailable, or inferior to the main lean

### UI/UX rules

The UI should:

- keep the current `Ask AI` flow
- allow follow-up after a result is shown
- keep the thread scoped to the visible match result panel
- show user and assistant messages in a compact thread below the result
- disable the follow-up send action while a follow-up is in flight

Phase 1 thread behavior:

- in-memory within the current UI session
- match-scoped
- no long-term server persistence required yet

## Testing Strategy

### Prompt / policy

- prompt contract tests for V8 rules and follow-up fields
- policy tests for V8-specific `1x2_home` relaxation

### Backend

- route tests for follow-up request payloads
- server-pipeline tests proving:
  - advisory follow-up does not save
  - advisory follow-up does not notify
  - follow-up still returns grounded parsed output

### Frontend

- `AiAnalysisPanel` follow-up interaction test
- `MatchesTab` test for:
  - showing the result panel
  - sending follow-up
  - rendering assistant follow-up text

### Replay

Replay will focus on V8 only and compare it against existing recorded V6/V7 baselines:

- `under share`
- `1x2/AH presence`
- `no-bet rate`
- `directional accuracy`

## Non-Goals In This Phase

- scheduler-based auto follow-up
- cross-match chat memory
- user-editable system favourite leagues
- full subscription enforcement redesign
- long-term follow-up thread persistence
