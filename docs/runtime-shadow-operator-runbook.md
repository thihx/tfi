# Runtime Shadow Operator Runbook

**Scope:** production/runtime observation for the official TFI live recommendation prompt `v10-hybrid-legacy-g`.

This runbook is for evaluating policy-blocked model selections without changing production behavior. Runtime shadow telemetry, skipped-neighbor telemetry, and current-runtime blocked-selection settlement are evidence only. They must not save recommendations, notify users, or directly promote a policy change.

## When To Run

Run this workflow when one of these is true:

- A new runtime policy-shadow telemetry change has been deployed and live cycles have accumulated.
- Recent saved recommendations are stale or absent, but pipeline audit logs show `v10-hybrid-legacy-g` is active.
- `current-runtime-no-save` shows non-empty model selections blocked before save or push.
- A weekly or manual operator review needs fresh shadow evidence before deciding whether a policy pocket deserves more observation.

Do not run this as a substitute for settled production recommendation performance. If there are not enough live events, the correct result is usually "keep observing".

## Preconditions

- The live writer job, normally `check-live-trigger`, is running or its inactivity is already understood.
- The active runtime prompt is `v10-hybrid-legacy-g`.
- Provider/cache inputs still flow through `packages/server/src/lib/football-api.ts`.
- Shadow telemetry is audit-only and has no save/notify path.
- Settlement evidence uses deterministic supported-market rules or trusted settled recommendation rows.

## Suggested Output Layout

Use a timestamped audit folder:

```powershell
$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$out = "replay-work/audit/$runId"
New-Item -ItemType Directory -Force $out | Out-Null
```

## Step 1 - Prove Runtime Activity

Run liveness before interpreting missing saved rows:

```powershell
npm run data-driven:pipeline-liveness --prefix packages/server -- --lookback-hours 336 --out-json "$out/pipeline-liveness.json" --out-md "$out/pipeline-liveness.md"
```

Read first:

- `pipeline-liveness.md`
- `pipeline-liveness.json`

Interpretation:

- If the job and audit logs are inactive, diagnose deployment/scheduler first.
- If audit logs show active `v10-hybrid-legacy-g` but saved rows are absent or stale, continue to Step 2.
- Do not infer prompt quality from legacy prompt rows or stale saved rows.

## Step 2 - Explain No-Save Behavior

```powershell
npm run data-driven:current-runtime-no-save --prefix packages/server -- --lookback-hours 336 --out-json "$out/current-runtime-no-save.json" --out-md "$out/current-runtime-no-save.md"
```

Read first:

- `current-runtime-no-save.md`
- `current-runtime-no-save.json`

Interpretation:

- Mostly intentional no-bets: no policy loosening signal. Continue observing.
- Market resolution gaps: inspect canonical odds and normalization before changing prompt or policy.
- Non-empty selections blocked by policy/save gates: continue to Step 3.
- Save integrity blocks: fix provider/canonical odds proof before any policy discussion.

## Step 3 - Settle Current Blocked Selections

Use this only when official-prompt audit rows contain non-empty selections that were not saved or pushed:

```powershell
npm run data-driven:current-runtime-blocked-selection --prefix packages/server -- --lookback-hours 336 --max-rows 1000 --stake-percent 1 --out-json "$out/current-runtime-blocked-selection.json" --out-md "$out/current-runtime-blocked-selection.md"
```

Then gate narrow shadow-only candidates:

```powershell
npm run data-driven:check-current-runtime-blocked-selection-gates --prefix packages/server -- --config "$out/current-runtime-blocked-selection-gates.json"
```

Read first:

- `current-runtime-blocked-selection.md`
- `current-runtime-blocked-selection.json`
- gate output

Interpretation:

- Gate fails on minimum rows or settled rate: sample is too small or too unresolved.
- Gate fails on P/L, ROI, win count, or loss limits: do not promote; inspect market and minute pockets.
- Gate passes for a narrow market: candidate is worth runtime shadow observation only.
- Overall negative cohort with tiny positive pockets is not enough for production loosening.

## Step 4 - Run Runtime Shadow Suite

After shadow telemetry has had enough live cycles:

```powershell
npm run data-driven:policy-shadow-suite --prefix packages/server -- --lookback-days 14 --settlement-lookback-days 30 --max-rows 1000 --stake-percent 1 --out-dir "$out/runtime-policy-shadow-suite"
```

Read in this order:

1. `runtime-policy-shadow-suite/manifest.json`
2. `runtime-policy-shadow-suite/runtime-policy-shadow-report.md`
3. `runtime-policy-shadow-suite/runtime-policy-shadow-skipped-report.md`
4. `runtime-policy-shadow-suite/runtime-policy-shadow-settlement.md`
5. `runtime-policy-shadow-suite/runtime-policy-shadow-skipped-settlement.md`

Interpretation:

- `matchedEvents=0` and `skippedEvents=0`: not enough runtime shadow evidence yet. This is not a regression if Step 1 proves liveness.
- High unresolved rate: improve market resolution, match-history join, or settlement coverage before judging policy.
- Confidence or market-resolution pockets with poor settlement: keep blocked.
- Positive settled pockets with adequate sample: proceed to gates, then human review.

## Step 5 - Run Settlement Gates

Matched shadow pockets:

```powershell
npm run data-driven:check-policy-shadow-settlement-gates --prefix packages/server -- --config "$out/runtime-policy-shadow-settlement-gates.json"
```

Skipped-neighbor selections:

```powershell
npm run data-driven:check-policy-shadow-skipped-settlement-gates --prefix packages/server -- --config "$out/runtime-policy-shadow-skipped-settlement-gates.json"
```

Use existing audit configs as templates when starting from the current audit:

- `replay-work/audit/20260603-120456/current-runtime-blocked-selection-gates.json`
- `replay-work/audit/20260603-120456/runtime-policy-shadow-settlement-gates-after-telemetry.json`
- `replay-work/audit/20260603-120456/runtime-policy-shadow-skipped-settlement-gates-after-telemetry.json`

Update the report paths inside copied configs before running gates.

## Pass And Fail Meaning

Gate pass means:

- Minimum sample and settled coverage were met.
- Required pockets or markets met configured win/loss/P/L/ROI thresholds.
- The candidate may move to human review or a longer observation window.

Gate pass does not mean:

- Production policy should be loosened automatically.
- Prompt instructions should be softened.
- A new market should be persisted without normal policy, odds, confidence, same-thesis, and segment guards.

Gate fail means:

- The evidence is insufficient, negative, unresolved, or too risky for promotion.
- The next action is usually observe longer, inspect diagnostics, or tighten the candidate definition.

## Hard No-Promote Rules

Do not promote or loosen policy when any of these is true:

- Evidence is replay-only.
- Evidence comes from current-runtime blocked selections but no live shadow settlement exists yet.
- Sample size is below the configured gate threshold.
- Settled rate is below the configured gate threshold.
- Overall cohort is negative and only tiny pockets are positive.
- Market resolution is mostly `unresolved`, `unknown`, or not provable against canonical odds.
- The candidate depends on unsupported deterministic settlement rules.
- The proposed change would bypass minimum odds, confidence, evidence mode, same-thesis, save-integrity, segment blocklist, or stake-cap guards.

## Decision Table

| Observation | Operator Decision |
| --- | --- |
| Liveness inactive | Fix scheduler/deploy/runtime first. |
| Liveness active, no saved rows, model mostly no-bets | Keep observing; no policy action. |
| Liveness active, market resolution gaps | Fix normalization/canonical odds proof before policy action. |
| Blocked-selection gate passes on a tiny pocket only | Add or keep runtime shadow observation; do not promote. |
| Shadow suite has zero matched/skipped events | Wait for live events; not enough evidence. |
| Shadow settlement gate fails on sample size | Extend observation window or wait. |
| Shadow settlement gate fails on ROI/P/L/loss count | Keep policy blocked; document losing segment. |
| Shadow settlement gate passes with sufficient sample | Human review, then design a controlled policy proposal with tests and rollback criteria. |

## Notes To Record

After each run, update the active audit summary with:

- run folder
- lookback windows
- matched and skipped event counts
- settled rate
- best and worst pockets
- gate pass/fail lines
- final decision: observe, diagnose, design new shadow pocket, or propose policy change

The final decision must explicitly state whether evidence is replay-only, current blocked-selection only, runtime shadow only, or settled production recommendation performance.
