# Live Recommendation Pipeline

**Updated:** 2026-05-25  
**Scope:** source of truth for the current live football recommendation engine.

## Operating Principle

TFI is an investment-decision assistant, not a guarantee engine. The live pipeline must optimize for:

- correct runtime behavior
- conservative bet selection
- replayable evidence
- measurable improvement through settled-result feedback

The official live-analysis prompt is:

```text
v10-hybrid-legacy-g
```

All older prompt versions are retired. Live runtime always uses this single prompt and no longer supports active/shadow prompt selection by env.

Related design contracts:

- [live-recommendation-output-architecture-vi.md](live-recommendation-output-architecture-vi.md) defines the planned output split across money recommendations, stats-only signals, watch insights, shadow candidates, and audited no-action outcomes.
- [live-recommendation-regression-matrix-vi.md](live-recommendation-regression-matrix-vi.md) defines the regression and edge-case matrix that should gate the output-router refactor.
- [odds-first-stats-only-signal-contract-vi.md](odds-first-stats-only-signal-contract-vi.md) defines the current stats-only signal contract when live odds are unavailable.
- [live-data-provider-fusion-contract-vi.md](live-data-provider-fusion-contract-vi.md) defines the draft multi-provider freshness, coverage, consensus, and canonical snapshot contract for live score/events/stats/odds.

## Active Runtime

- Scheduler entry: `packages/server/src/jobs/check-live-trigger.job.ts`
- Match processor: `packages/server/src/lib/server-pipeline.ts`
- Prompt builder: `packages/server/src/lib/live-analysis-prompt.ts`
- Post-parse policy: `packages/server/src/lib/recommendation-policy.ts`
- Market normalization: `packages/server/src/lib/normalize-market.ts`
- Odds resolver: `packages/server/src/lib/odds-resolver.ts`
- Evidence allowlist: `packages/server/src/lib/evidence-mode-market-allowlist.ts`
- Line patience: `packages/server/src/lib/line-patience-policy.ts`
- Thesis watch: `packages/server/src/lib/thesis-watch.service.ts`

## Decision Flow

1. Load fixture, watchlist entry, settings, previous recommendations.
2. Fetch/cache provider fixture insight through backend provider helpers only.
3. Resolve live stats, events, odds, league/team profile, strategic context, and prematch expert features.
4. Derive evidence mode and remove markets that are stale, incomplete, contaminated, or not allowed.
5. Build the single official prompt with live data, odds, prematch context, performance memory, and prior exposure.
6. Parse strict JSON from the LLM.
7. Apply line-ladder patience and thesis-watch gates.
8. Apply post-parse recommendation policy.
9. Route the outcome explicitly as money recommendation, stats-only signal, watch insight, shadow candidate, or audited no-action. The detailed target contract is in [live-recommendation-output-architecture-vi.md](live-recommendation-output-architecture-vi.md).
10. Record runtime policy-shadow telemetry for selected replay-backed pockets when the model picked a market but production policy blocked it. Shadow telemetry includes normalized league/team segment keys for later settlement hotspot review.
11. Save only final actionable recommendations that pass policy and dedup checks, or a narrowly controlled Phase 4 promotion that passes explicit promotion flags, readiness acknowledgement, rollout sampling, pocket allowlist, and save-integrity.
12. Notify eligible users through configured delivery channels.
13. Settle completed recommendations and feed outcomes into replay/performance memory.

## Money-Critical I/O Guards

- Selection text and `bet_market` must normalize to the same canonical market before persistence.
- Signed Home/Away lines such as `Home -0.75 @1.92` or `Away +0.25 @2.10` are Asian Handicap, not 1X2.
- `should_push=true` in this pipeline means an actionable AI recommendation that is eligible for user notification.
- User condition alerts are handled outside this pipeline by the User Match Alert Engine. Do not add condition-only prompt sections, condition-triggered save branches, or condition-only delivery staging back into `server-pipeline.ts`.
- Odds-first stats-only live signals are defined in [odds-first-stats-only-signal-contract-vi.md](odds-first-stats-only-signal-contract-vi.md). They may notify watched users when live odds are unavailable, but they must not call LLM, save a recommendation row, carry stake, or enter settlement/ROI.

## Mandatory Guards

- Minimum confidence default is `7`.
- Minimum odds default is `1.5`.
- `1x2_home` is blocked before minute 75.
- `1x2_draw` is blocked.
- `over_0.5` is blocked after minute 75.
- `over_1.5` is blocked from minute 85 onward; minute 60-74 one-goal states are not hard-blocked by the dedicated Over 1.5 late-midgame rule, but still need full evidence and all normal policy gates.
- `under_2.5` is blocked before minute 75.
- BTTS, 1X2, corners, AH, and high-price totals require evidence-specific gates.
- High-risk outputs are not persisted.
- Thin edge near break-even is blocked.
- Same-thesis stacking is capped by count and total stake.
- Segment blocklist and segment stake caps can override or reduce exposure.
- Runtime policy-shadow pockets for strict BTTS, late Under 4.5, Over 1.5, medium-risk thin-edge, and odds-events degraded candidates are telemetry by default. Policy-blocked selections that miss those pocket definitions can also be recorded as skipped-neighbor telemetry. No shadow path may save or notify unless the Phase 4 controlled promotion guard is explicitly enabled with readiness acknowledgement, pocket allowlist, rollout, and kill switch controls.

## Evidence Modes

- `full_live_data`: all supported markets may be considered, subject to policy.
- `stats_only`: no odds-dependent action unless the market can be mapped safely.
- `odds_events_only`: only markets explicitly allowed by evidence policy.
- `odds_only`: heavily restricted; prefer no bet unless the edge is unambiguous.
- `none`: no recommendation.

The browser must never call API-Sports directly. Frontend code must use backend routes such as `/api/matches` and `/api/proxy/football/*`. Server-side provider calls stay centralized in `packages/server/src/lib/football-api.ts`.

Provider roadmap: API-Football is currently the active provider, but live recommendation should move toward the multi-provider fusion contract in [live-data-provider-fusion-contract-vi.md](live-data-provider-fusion-contract-vi.md). Until that is implemented, provider limitations such as empty statistics responses or delayed live clocks must be represented as provider coverage/freshness warnings, not as internal system failures.

## Replay And Improvement Loop

Use replay to change the system deliberately:

```powershell
npm run data-driven:improvement-run --prefix packages/server
npm run data-driven:verify-gates-ci --prefix packages/server
```

For runtime shadow pockets, `data-driven:policy-shadow-suite` is the periodic entrypoint for matched, skipped-neighbor, settlement, and Phase 3 readiness artifacts. Shadow audit and settlement rows carry normalized `leagueSegmentKey` and `teamSegmentKeys`, and readiness can gate top league/team concentration before Phase 4. Then run `data-driven:check-policy-shadow-skipped-settlement-gates` for nearby skipped policy-blocked selections, `data-driven:check-policy-shadow-settlement-gates` for matched pockets, and `data-driven:check-policy-shadow-readiness-gates` for aggregate hard no-promote checks; passing these gates is evidence only and does not automatically change production policy. Phase 4 controlled promotion remains off until `RUNTIME_POLICY_PROMOTION_ENABLED=true`, `RUNTIME_POLICY_PROMOTION_EVIDENCE_ACK=ready_for_human_review`, a pocket allowlist, rollout percentage, owner, and kill-switch posture are deliberately configured.

Operator procedure: [runtime-shadow-operator-runbook.md](runtime-shadow-operator-runbook.md). Use it for the read order, pass/fail interpretation, and hard no-promote rules before changing prompt or policy.

Before using production rows as evidence for the current prompt, run `data-driven:prompt-adoption`, then `data-driven:check-prompt-adoption-gates`. This checks recent saved recommendations before settlement filters, including latest-row recency. If recent rows exist but `officialPromptRows=0`, or if the latest row is stale, investigate deployment/env/job adoption first; do not infer `v10-hybrid-legacy-g` production quality from rows stamped with retired prompt versions.

When saved rows are stale, run `data-driven:pipeline-liveness` before assuming the scheduler is down. Pipeline audit logs can prove that `v10-hybrid-legacy-g` is active even when current model/policy decisions produce no saved recommendations.

If liveness shows active `v10-hybrid-legacy-g` calls but no saves, run `data-driven:current-runtime-no-save` to separate model no-bets, policy blocks, market-resolution gaps, evidence modes, and save-integrity blocks from one another. If that report shows non-empty selections blocked before save/push, run `data-driven:current-runtime-blocked-selection` to settle those selections as counterfactual audit evidence, then `data-driven:check-current-runtime-blocked-selection-gates` for any narrow shadow-only pocket candidates before considering any prompt or policy loosening.

Read these first from each run:

- `replay-vs-original.json`
- `segment-hotspots.json`
- `cases-flat.csv`

When intentionally changing expected quality metrics, update:

- `packages/server/ci-baselines/data-driven-gates/replay-vs-original.ci.json`
- `packages/server/ci-baselines/data-driven-gates/segment-hotspots.ci.json`
- matching gate configs under `packages/server/ci-baselines/data-driven-gates/`

## Database

Migrations live under:

```text
packages/server/src/db/migrations/
```

Run:

```powershell
npm run migrate --prefix packages/server
```

## Environment

Recommended prompt baseline:

```env
PIPELINE_MIN_CONFIDENCE=7
```

Do not configure retired prompt versions or prompt shadow execution. Start new prompt work by editing/evaluating the single official baseline deliberately.
