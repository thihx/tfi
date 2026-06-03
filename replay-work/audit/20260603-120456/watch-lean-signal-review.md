# Watch / Lean Signal Implementation Review

**Scope:** review current implementation of the non-bet-grade signal layer discussed as option 2: watch signals, condition-only alerts, suggested trigger conditions, and user-facing visibility.

## Short Conclusion

TFI already has a meaningful watch/condition signal layer, but it is not yet a strong product-level anti-silent layer.

The backend supports:

- AI-generated suggested watch conditions from prematch/strategic enrichment.
- User/manual custom conditions with live preview.
- Auto-apply of suggested conditions when safe.
- Condition-only alerts that can notify without creating a recommendation row.
- Condition-triggered saved recommendations only when the suggested bet passes odds, confidence, normalization, line-patience, recommendation policy, same-thesis, and save-integrity guards.
- User delivery rows for condition-only signals, separate from shared recommendation rows.

The product gap is that many of these signals are either hidden behind watchlist editing, live monitor/operator screens, or the non-default "My Deliveries" feed. A normal user can still experience the system as mostly silent if no bet-grade recommendation is saved.

## Backend Signal Paths

### 1. Suggested watch condition generation

`enrich-watchlist.job.ts` enriches watchlist entries with strategic context and can generate `recommended_custom_condition`, reasons, and Vietnamese reasons.

Evidence:

- `packages/server/src/jobs/enrich-watchlist.job.ts:7`
- `packages/server/src/jobs/enrich-watchlist.job.ts:490`
- `packages/server/src/jobs/enrich-watchlist.job.ts:501`
- `packages/server/src/jobs/enrich-watchlist.job.ts:522`

Interpretation:

- This is a real pre-live "watch setup" layer.
- It is not a live lean feed by itself; it prepares conditions that may later trigger.

### 2. Live custom-condition evaluation

Users can preview a condition against the latest snapshot/current match row.

Evidence:

- `packages/server/src/routes/watchlist.routes.ts:82`
- `src/components/ui/WatchlistEditModal.tsx:53`
- `src/components/ui/WatchlistEditModal.tsx:63`
- `src/components/ui/WatchlistEditModal.tsx:65`

Interpretation:

- This is good operational UX for users who actively configure watch rules.
- It does not automatically surface "this match is interesting" unless the user opens watch rules or a condition triggers.

### 3. Condition-only runtime branch

Runtime parses `custom_condition_matched` separately from the primary AI bet decision. When the condition is evaluated and matched, `condition_triggered_should_push` becomes true even if `final_should_bet` is false.

Evidence:

- `packages/server/src/lib/server-pipeline.ts:3696`
- `packages/server/src/lib/server-pipeline.ts:3701`
- `packages/server/src/lib/server-pipeline.ts:3704`
- `packages/server/src/lib/server-pipeline.ts:5174`

Interpretation:

- This is the core non-bet signal branch.
- It can produce user-facing push intent without a saved recommendation.
- The branch is intentionally separate from bet-grade persistence.

### 4. Condition-triggered saved bet guard

If the condition-triggered suggestion is a concrete bet, it is still subjected to market normalization, line patience, odds, confidence, recommendation policy, segment policy, and save integrity.

Evidence:

- `packages/server/src/lib/server-pipeline.ts:862`
- `packages/server/src/lib/server-pipeline.ts:907`
- `packages/server/src/lib/server-pipeline.ts:924`
- `packages/server/src/lib/server-pipeline.ts:973`
- `packages/server/src/lib/server-pipeline.ts:988`
- `packages/server/src/lib/server-pipeline.ts:5282`

Interpretation:

- This is correct for money safety.
- It also means condition-only signals may remain alerts rather than investable recommendations.

### 5. Condition-only delivery persistence

Condition-only alerts are staged into `user_recommendation_deliveries` with `recommendation_id = NULL` and metadata such as `delivery_kind = condition_only`, `recommendation_bet_type = CONDITION_ONLY`, condition summary, selection, confidence, stake, teams, and league.

Evidence:

- `packages/server/src/lib/server-pipeline.ts:5198`
- `packages/server/src/lib/server-pipeline.ts:5203`
- `packages/server/src/repos/recommendation-deliveries.repo.ts:794`
- `packages/server/src/repos/recommendation-deliveries.repo.ts:849`
- `packages/server/src/repos/recommendation-deliveries.repo.ts:859`
- `packages/server/src/db/migrations/027_condition_only_delivery_rows.sql:3`

Interpretation:

- The signal is persisted; it is not only a transient push.
- Because it has no recommendation row, it does not participate in normal shared recommendation performance in the same way a bet-grade pick does.

## Frontend Visibility

### Watchlist / match hub

The UI shows system suggestions, recommended/custom conditions, and condition signal context.

Evidence:

- `src/components/ui/WatchlistEditModal.tsx:53`
- `src/components/ui/WatchlistEditModal.tsx:56`
- `src/components/ui/WatchlistEditModal.tsx:63`
- `src/components/ui/matchHubPanels.tsx:65`
- `src/components/ui/matchHubPanels.tsx:110`
- `src/app/LiveMonitorTab.tsx:118`
- `src/app/LiveMonitorTab.tsx:139`

Interpretation:

- The signal is visible, but mostly as configuration/context.
- It is not yet presented as a primary live signal stream.

### Live Monitor

Live Monitor labels `condition_only` as `Condition Only`, shows `Condition Matched` / `Condition Triggered`, and displays condition-triggered suggestion/reasoning.

Evidence:

- `src/app/LiveMonitorTab.tsx:33`
- `src/app/LiveMonitorTab.tsx:231`
- `src/app/LiveMonitorTab.tsx:271`

Interpretation:

- This is the clearest current screen for runtime watch/lean behavior.
- It reads more like an operational dashboard than a user-facing betting signal feed.

### Recommendations / deliveries feed

The Recommendations tab has `Shared Recommendations` and `My Deliveries`. Delivery mode can show `Actionable only`, `All delivered`, or `No-action only`.

Evidence:

- `src/app/RecommendationsTab.tsx:66`
- `src/app/RecommendationsTab.tsx:149`
- `src/app/RecommendationsTab.tsx:210`
- `src/app/RecommendationsTab.tsx:219`
- `src/app/RecommendationsTab.tsx:734`
- `src/app/RecommendationsTab.tsx:783`

Interpretation:

- This is the main persistent user-facing home for condition-only delivery rows.
- The default feed is `Shared Recommendations`, and `My Deliveries` defaults to `Actionable only`.
- Therefore no-action / pure condition-only signals can be effectively hidden unless the user knows to switch modes and filters.

## Important Product Gaps

### Gap 1 - The signal layer is not the default experience

Most users will enter `Recommendations` expecting value. The default is shared bet-grade history, not a live/watch signal feed. If strict policy produces few saved recommendations, the product still feels silent.

### Gap 2 - "Condition-only" is structurally real but semantically weak in UI

Condition-only rows are stored, but mapped back into `RecommendationCard` shape. This can blur the distinction between:

- bet-grade recommendation
- condition alert
- no-action watch signal

Because condition-only rows may have `recommendation_id = NULL`, they cannot use the normal invest/settle path. `canInvest()` requires a real recommendation id.

Evidence:

- `src/app/RecommendationsTab.tsx:149`
- `src/app/RecommendationsTab.tsx:657`

### Gap 3 - Condition matched can notify even when suggestion is empty

Current tests explicitly cover condition-only notification with empty suggestion, zero confidence, and zero stake. That is valid as "condition matched", but it may feel low-value to a betting user if it is not framed as watch/alert rather than investment advice.

Evidence:

- `packages/server/src/__tests__/server-pipeline.test.ts:2170`
- `packages/server/src/__tests__/server-pipeline.test.ts:2179`
- `packages/server/src/__tests__/server-pipeline.test.ts:2190`

### Gap 4 - Not a general lean layer for all interesting matches

The current layer is condition/watchlist driven. It does not yet produce a broad, cheap, rule-based "lean/watch/no bet but monitor" signal for every live candidate. That may be acceptable, but it means #2 only helps matches that are already in watchlist and have usable conditions.

## Practical Read

Option 2 has been implemented technically, but not fully productized.

It is best described as:

> Watchlist condition alerts plus delivery plumbing, with safe escalation to saved recommendation only when a concrete bet passes policy.

It is not yet:

> A default, always-visible live signal feed that makes the system feel useful even when bet-grade recommendations are rare.

## Suggested Next Product Direction

Do not rebuild the backend first. The safer next product move is UI/semantics:

1. Make "My Deliveries" or a dedicated "Live Signals" view more prominent than the shared strict recommendation feed.
2. Rename/filter condition-only rows as "Watch Alert" or "Signal", not "Recommendation".
3. Show three clear statuses: `Bet`, `Watch`, `No Action`.
4. Keep Invest disabled for watch-only signals unless a real recommendation row exists.
5. Add counts to the live summary: bet-grade saved, watch alerts, no-action checks.
6. Later, after a few weeks of runtime data, do the cost-control audit for LLM calls versus useful signal yield.

## Decision For This Audit

No immediate policy loosening is recommended.

The current #2 implementation is real enough to build on, but the next improvement should be product visibility and labeling, not recommendation-policy relaxation.

## Productization Follow-Up - 2026-06-03

Implemented the first UI productization pass for option 2:

- Recommendations now defaults to `My Signals`, making delivered user-specific signals the primary experience.
- Shared bet-grade history is labeled `Shared Bets`.
- Delivery filters are labeled `All signals`, `Bets only`, and `Watch / No Action`.
- Delivery rows are mapped into explicit signal kinds: `Bet`, `Watch`, and `No Action`.
- Condition-only rows with `recommendation_id = NULL` render as watch alerts with no invest action, no fake recommendation id, and no numeric `NaN` confidence/stake display.
- Card and table views both show the signal badge and condition detail where relevant.

Verification:

```text
npm run test -- src/app/RecommendationsTab.test.tsx src/components/ui/RecommendationCard.test.tsx
npm run build
```

Both commands passed.
