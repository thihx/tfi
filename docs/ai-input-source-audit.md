# AI Input Source Audit

Updated: 2026-06-02

## Removed In This Refactor

| Source | Former path | Decision | Reason |
| --- | --- | --- | --- |
| API-Football pre-match predictions | `/predictions`, `provider_fixture_prediction_cache`, `watchlist.prediction`, prompt `PRE-MATCH PREDICTION` block | Removed | It is an opaque third-party model output, not observed match evidence. It can anchor the LLM toward another model's conclusion and duplicate/contaminate TFI's own reasoning. |

## Current Runtime Inputs To AI

| Source | Runtime path | Keep / Change | Notes |
| --- | --- | --- | --- |
| Fixture status, score, minute | `server-pipeline.ts` from provider/cache + local match row | Keep | Core state; required for evidence tier, market eligibility, and settlement context. |
| Live statistics | `ensureMatchInsight` -> `statsCompact` | Keep | Primary live evidence. Missing/stale handling already gates evidence mode. |
| Recent events | `ensureMatchInsight` -> compact event timeline | Keep | Useful fallback when stats lag; also catches goals/cards/substitutions. |
| Canonical odds | `odds-resolver.ts` + canonical helpers | Keep | Money-critical input. Must stay server-side and margin-filtered. |
| Watchlist custom conditions | watchlist subscription fields | Keep | User intent, evaluated separately from AI bet decision. |
| Recommended condition metadata | enrich-watchlist output | Keep with caution | Operationally useful, but should not override live evidence. |
| Previous recommendations | `recommendations.repo.ts` | Keep | Prevents duplicate picks and same-thesis stacking. |
| Latest snapshots/staleness | match snapshots and odds freshness | Keep | Needed to avoid stale recommendations. |
| League/team quantitative profiles | league/team profile repos | Keep | Structured priors can support manual prematch Ask AI and calibrate low-evidence analysis. |
| Strategic context | `strategic-context.service.ts` -> server prompt | Keep constrained | The live prompt now uses structured strategic fields and source-quality metadata instead of raw long-form narrative blocks. |
| Lineups snapshot | provider lineups cache | Keep compressed / conditional | Included only for lineup-focused questions or follow-up history, and compressed to formation, confirmed starters, and bench count. |
| Historical performance memory / segment policies | AI performance + replay outputs | Keep | Own feedback loop; directly tied to measured outcomes and guardrails. |

## Follow-Up Items Implemented

1. Removed the legacy frontend prompt builder path.
   `src/features/live-monitor/services/ai-prompt.service.ts` and its drift-prone frontend prompt tests were deleted. Prompt construction is server-only in `packages/server/src/lib/live-analysis-prompt.ts`.

2. Reduced raw strategic narrative in prompts.
   The live prompt keeps source-quality metadata, trusted source domains, quantitative pre-match priors, and structured strategic signals, while dropping raw `SUMMARY` and `H2H_NARRATIVE` prompt blocks.

3. Compressed `lineupsSnapshot`.
   Lineups are now a conditional Ask AI input, not default prompt ballast. The prompt receives formation, confirmed starters, and bench count only; substitutes/coaches stay out of the model context.
