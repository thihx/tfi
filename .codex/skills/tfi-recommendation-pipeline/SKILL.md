---
name: tfi-recommendation-pipeline
description: Mandatory project context for changing or auditing the TFI football recommendation pipeline, including live match input data, prompt construction, post-parse policy, save/notify outputs, replay gates, and production deployment guardrails.
---

# TFI Recommendation Pipeline

Use this skill before touching any recommendation, live-monitor, watchlist trigger, prompt, replay, settlement, notification, or recommendation persistence code.

## Required Reading

1. Read `docs/live-recommendation-pipeline-vi.md`.
2. Read `docs/data-driven-pipeline-status.md` when changing replay/eval/gates.
3. Read `docs/agent-onboarding.md` for repo-wide runtime, auth, and provider boundaries.

## Canonical Runtime

- Match processor: `packages/server/src/lib/server-pipeline.ts`
- Prompt builder: `packages/server/src/lib/live-analysis-prompt.ts`
- Post-parse policy: `packages/server/src/lib/recommendation-policy.ts`
- Market normalization: `packages/server/src/lib/normalize-market.ts`
- Odds resolving/canonicalization: `packages/server/src/lib/odds-resolver.ts` plus the canonical odds helpers in `server-pipeline.ts`
- Provider boundary: `packages/server/src/lib/football-api.ts`
- Recommendation persistence: `packages/server/src/repos/recommendations.repo.ts`
- Delivery staging: `packages/server/src/repos/recommendation-deliveries.repo.ts`

The only official live-analysis prompt is `v10-hybrid-legacy-g`. Do not reintroduce retired prompt versions, shadow prompt candidates, or docs that imply multiple active prompts. Invalid env prompt values must resolve to the official prompt.

## Input Contract

The live pipeline may use only these input sources:

- provider fixture/status/score data via backend provider cache and `football-api.ts`
- fixture statistics and events via provider cache
- canonical odds produced by server-side odds resolution
- watchlist custom conditions and recommended condition metadata
- previous recommendations for duplicate/thesis exposure control
- latest snapshots for staleness control
- league/team profiles and strategic context when available
- performance memory and replay-derived segment policies

Browser code must never call the football provider directly.

## Output Contract

Pipeline outputs must preserve this separation:

- `should_push`: user-facing alert intent for AI recommendations or matched watch conditions
- `final_should_bet`: persisted AI recommendation decision after system guards
- condition-triggered persistence: allowed only after odds, confidence, policy, and same-thesis guards pass
- `saved`: true only when a recommendation row is created
- `notified`: true when an alert is staged or delivered; Telegram is queued asynchronously

Never save a recommendation when market normalization is `unknown`, odds are unavailable/below minimum, evidence mode forbids the market, or post-parse policy blocks it.

## Mandatory Guards

- Keep `LIVE_ANALYSIS_PROMPT_VERSION` and checked-in env examples on `v10-hybrid-legacy-g`.
- Do not reintroduce `LIVE_ANALYSIS_ACTIVE_PROMPT_VERSION`, `LIVE_ANALYSIS_SHADOW_PROMPT_VERSION`, `LIVE_ANALYSIS_SHADOW_ENABLED`, or prompt shadow sample-rate env selectors unless a new official prompt baseline is deliberately introduced.
- Preserve provider access through backend routes and `football-api.ts`.
- Treat market normalization as money-critical. Add tests for every new market text shape.
- Preserve strict JSON prompt output requirements.
- Preserve policy gates for evidence mode, break-even, high-risk markets, same-thesis exposure, segment blocklist, and stake caps.
- Advisory/manual prompt-only flows must not save or notify.
- When changing output routing, follow `docs/live-recommendation-output-architecture-vi.md` and gate behavior with `docs/live-recommendation-regression-matrix-vi.md`.

## Audit Checklist

When auditing or changing the pipeline, trace end to end:

1. Watchlist/match selection and stale/proceed gates.
2. Fixture, stats, events, odds, profiles, strategic context, and previous recommendation inputs.
3. Evidence mode and allowed-market tier.
4. Prompt data rendered to the LLM.
5. JSON parse defaults and safety warnings.
6. Odds extraction from the canonical snapshot.
7. Market normalization and line matching.
8. Line patience, recommendation policy, memory, segment block/stake policy.
9. Save decision and recommendation row payload.
10. Delivery staging and web push delivery marking.
11. Audit/debug payloads and replay comparability.

## Verification

Prefer focused checks first:

- `npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts src/__tests__/recommendation-policy.test.ts src/__tests__/normalize-market.test.ts`
- `npm run data-driven:verify-gates-ci --prefix packages/server`

Before handoff, run:

- `npm run verify:ci`

If DB schema/config changed, run:

- `npm run migrate --prefix packages/server`
