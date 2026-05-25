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

All older prompt versions are retired. Runtime env values outside this version are ignored by `isLiveAnalysisPromptVersion()` and fall back to the official default.

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
9. Save only final actionable recommendations that pass policy and dedup checks.
10. Notify eligible users through configured delivery channels.
11. Settle completed recommendations and feed outcomes into replay/performance memory.

## Money-Critical I/O Guards

- Selection text and `bet_market` must normalize to the same canonical market before persistence.
- Signed Home/Away lines such as `Home -0.75 @1.92` or `Away +0.25 @2.10` are Asian Handicap, not 1X2.
- Condition-triggered suggestions follow the same odds, confidence, market normalization, policy, and same-thesis guards as normal AI recommendations before they can be saved.
- `should_push=true` may mean a condition alert; only `saved=true` means a recommendation row exists.

## Mandatory Guards

- Minimum confidence default is `7`.
- Minimum odds default is `1.5`.
- `1x2_home` is blocked before minute 75.
- `1x2_draw` is blocked.
- `over_0.5` is blocked after minute 75.
- `under_2.5` is blocked before minute 75.
- BTTS, 1X2, corners, AH, and high-price totals require evidence-specific gates.
- High-risk outputs are not persisted.
- Thin edge near break-even is blocked.
- Same-thesis stacking is capped by count and total stake.
- Segment blocklist and segment stake caps can override or reduce exposure.

## Evidence Modes

- `full_live_data`: all supported markets may be considered, subject to policy.
- `stats_only`: no odds-dependent action unless the market can be mapped safely.
- `odds_events_only`: only markets explicitly allowed by evidence policy.
- `odds_only`: heavily restricted; prefer no bet unless the edge is unambiguous.
- `none`: no recommendation.

The browser must never call API-Sports directly. Frontend code must use backend routes such as `/api/matches` and `/api/proxy/football/*`. Server-side provider calls stay centralized in `packages/server/src/lib/football-api.ts`.

## Replay And Improvement Loop

Use replay to change the system deliberately:

```powershell
npm run data-driven:improvement-run --prefix packages/server
npm run data-driven:verify-gates-ci --prefix packages/server
```

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

Recommended defaults:

```env
LIVE_ANALYSIS_ACTIVE_PROMPT_VERSION=v10-hybrid-legacy-g
LIVE_ANALYSIS_SHADOW_PROMPT_VERSION=
PIPELINE_MIN_CONFIDENCE=7
```

Shadow prompt execution should remain disabled unless there is a deliberate A/B experiment with the same official prompt contract.
