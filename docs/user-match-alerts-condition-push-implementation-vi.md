# User Match Alerts & Condition Push Implementation

**Updated:** 2026-06-05  
**Scope:** triển khai 2 nhóm tính năng notification mới:

1. User chọn trận/đội yêu thích/giải yêu thích để nhận thông báo khi trận bắt đầu.
2. Tách luồng push khi điều kiện live thỏa khỏi AI Recommendation Pipeline, đồng thời thêm preset điều kiện mặc định có thể cấu hình theo user.

## Mục Tiêu

Tạo một lớp **User Match Alert Engine** nhẹ, nhanh, rẻ và tách khỏi luồng AI recommendation nặng. Engine này chịu trách nhiệm phát hiện các tín hiệu nghiệp vụ như kickoff, thẻ đỏ, đội khách ghi bàn trước, áp lực tấn công tăng mạnh, hoặc các rule rình kèo mà user chọn.

AI Recommendation Pipeline hiện tại vẫn giữ vai trò phân tích đầu tư đầy đủ: LLM prompt chính thức, odds canonical, market normalization, policy guard, memory/segment guard, recommendation persistence và settlement/replay.

## Quyết Định Kiến Trúc

Hai yêu cầu có liên quan ở tầng notification, user preference, match selection và delivery queue; không nên liên quan ở tầng trigger logic.

- **Match start alert** là trigger theo lịch/trạng thái trận.
- **Condition signal alert** là trigger theo live facts: score, events, cards, stats, odds snapshot.
- Cả hai dùng chung:
  - user alert settings
  - alert rule registry
  - alert delivery queue
  - channel delivery Web Push/Telegram
  - cooldown/dedupe
  - notification click mở Match hub/Matches tab
- Cả hai không phụ thuộc vào `server-pipeline.ts` để gửi alert.
- Chỉ khi user hoặc system muốn biến một signal thành recommendation/pick chính thức thì mới đi qua shared recommendation guards.

## Hiện Trạng Liên Quan

Backend:

- Web Push subscription: `packages/server/src/routes/push.routes.ts`, `packages/server/src/repos/push-subscriptions.repo.ts`, `packages/server/src/lib/web-push.ts`.
- Notification channel config: `packages/server/src/routes/notification-channels.routes.ts`, `packages/server/src/repos/notification-channels.repo.ts`.
- Notification settings: `packages/server/src/routes/notification-settings.routes.ts`, `packages/server/src/repos/notification-settings.repo.ts`.
- Watch subscriptions: `packages/server/src/routes/watchlist.routes.ts`, `packages/server/src/repos/watchlist.repo.ts`.
- Legacy custom condition evaluator: `packages/server/src/lib/condition-evaluator.ts`.
- AI Recommendation Pipeline: `packages/server/src/lib/server-pipeline.ts`; condition-only prompt/save/delivery logic has been removed from this path.
- Current delivery queue for recommendations: `packages/server/src/repos/recommendation-deliveries.repo.ts`.
- Live refresh and pipeline jobs: `packages/server/src/jobs/refresh-live-matches.job.ts`, `packages/server/src/jobs/check-live-trigger.job.ts`, `packages/server/src/jobs/scheduler.ts`.

Frontend:

- Profile notification settings: `src/components/profile/ProfileEditModal.tsx`.
- Watchlist condition UI: `src/components/ui/WatchlistEditModal.tsx`.
- Matches watchlist actions: `src/app/MatchesTab.tsx`.
- Service worker notification click contract: `src/sw.ts`, `src/app/App.tsx`.

Important guardrail:

- Browser must not call API-Sports directly.
- Provider access remains centralized through backend helpers and `football-api.ts`.
- The only official AI recommendation prompt remains `v10-hybrid-legacy-g`.

## Target Runtime Shape

```text
fetch/refresh matches
  -> matches table + provider fixture/stats/events/odds cache
  -> User Match Alert Engine
      -> evaluate match_start rules
      -> evaluate condition_signal rules
      -> enqueue user_match_alert_deliveries
      -> send web_push immediately / telegram via async job

AI Recommendation Pipeline
  -> unchanged for investment decisions
  -> no longer required for condition-only alert delivery
  -> still owns recommendation save/policy/settlement
  -> does not evaluate or push user condition alerts
```

## Data Model

Add one unified alert-rule model instead of separate models for kickoff and condition alerts. This keeps requirement 1 and 2 consistent.

### Migration 062: User Match Alert Rules

Create `user_match_alert_rules`.

Suggested columns:

```sql
CREATE TABLE IF NOT EXISTS user_match_alert_rules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT,
  alert_kind TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  compiled_status TEXT NOT NULL DEFAULT 'compiled',
  cooldown_minutes INTEGER NOT NULL DEFAULT 0,
  once_per_match BOOLEAN NOT NULL DEFAULT TRUE,
  channel_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Allowed `alert_kind`:

- `match_start`
- `condition_signal`

Recommended indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_user_match_alert_rules_match_kind
  ON user_match_alert_rules (match_id, alert_kind, enabled);

CREATE INDEX IF NOT EXISTS idx_user_match_alert_rules_user_kind
  ON user_match_alert_rules (user_id, alert_kind, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_match_alert_rules_unique_match_start
  ON user_match_alert_rules (user_id, match_id, alert_kind, source)
  WHERE alert_kind = 'match_start';
```

Notes:

- `match_id` is required for manual match rules.
- Auto favorite-team/favorite-league materialization creates concrete match-level rows so delivery can be idempotent.
- `source_ref` stores `{ teamId }`, `{ leagueId }`, or `{ presetId }`.

### Migration 063: User Match Alert Deliveries

Create `user_match_alert_deliveries`.

```sql
CREATE TABLE IF NOT EXISTS user_match_alert_deliveries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id BIGINT NOT NULL REFERENCES user_match_alert_rules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  alert_kind TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  trigger_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivered_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Important unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_match_alert_deliveries_trigger
  ON user_match_alert_deliveries (rule_id, trigger_key);
```

`trigger_key` examples:

- `match_start:1396482`
- `red_card:1396482:home:54`
- `away_scores_first:1396482:18`
- `pressure_no_goal:1396482:home:63`

### Migration 064: User Match Alert Delivery Channels

Create `user_match_alert_delivery_channels`.

```sql
CREATE TABLE IF NOT EXISTS user_match_alert_delivery_channels (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id BIGINT NOT NULL REFERENCES user_match_alert_deliveries(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_match_alert_delivery_channels UNIQUE (delivery_id, channel_type)
);
```

Use the same channel vocabulary as notification channel configs:

- `web_push`
- `telegram`

### Migration 065: User Alert Presets

Add per-user configurable preset storage. Prefer a dedicated table if presets need enable/disable/order/category; prefer `user_settings` JSON only if we want the lightest MVP.

Recommended table:

```sql
CREATE TABLE IF NOT EXISTS user_condition_alert_presets (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'custom',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_cooldown_minutes INTEGER NOT NULL DEFAULT 0,
  default_once_per_match BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);
```

Seed defaults lazily in repo response: return system defaults plus user overrides. This avoids mass inserts for every user.

## Rule JSON Contract

Rules should be structured and deterministic. Natural language is allowed in UI only after compilation.

Example:

```json
{
  "version": 1,
  "id": "away_scores_first",
  "label": "Away scores first",
  "all": [
    { "field": "events.first_goal.side", "op": "=", "value": "away" },
    { "field": "minute", "op": "<=", "value": 70 }
  ],
  "severity": "high",
  "suggestedAction": "review_live_market"
}
```

Supported expression shape:

- `all`: all clauses must match
- `any`: at least one clause must match
- `not`: negated nested clause
- leaf: `{ field, op, value }`

Supported operators:

- `=`, `!=`, `>`, `>=`, `<`, `<=`
- `exists`
- `changed`
- `in`
- `contains`

MVP fields:

- `minute`
- `status`
- `score.home`
- `score.away`
- `score.total`
- `score.state`: `draw`, `home_leading`, `away_leading`
- `stats.shots.home`, `stats.shots.away`
- `stats.shots_on_target.home`, `stats.shots_on_target.away`
- `stats.corners.home`, `stats.corners.away`
- `stats.red_cards.home`, `stats.red_cards.away`
- `stats.yellow_cards.home`, `stats.yellow_cards.away`
- `events.first_goal.side`
- `events.last_goal.side`
- `events.last_goal.minute`
- `events.red_card.side`
- `events.red_card.minute`
- `derived.sot_diff.home`
- `derived.sot_diff.away`
- `derived.corners_total`
- `derived.recent_goal_minutes`
- `derived.btts`

Phase 2 fields:

- `odds.ou.line`
- `odds.ou.over`
- `odds.ou.under`
- `odds.ah.line`
- `odds.ah.home`
- `odds.ah.away`
- `odds.movement.market`
- `odds.movement.delta`

## Default Presets For Bettors

These presets should be shipped as system defaults and user-configurable.

### Big Events

1. Away scores first
   - `events.first_goal.side = away`
   - Useful for live handicap, BTTS, Over, and favorite comeback markets.

2. Underdog scores first
   - Requires pre-match/team price context in Phase 2.
   - Phase 1 can approximate through favorite team/league profile only if reliable.

3. Red card
   - `events.red_card.side exists`
   - Alert includes side, minute, current score.

4. Leading team receives red card
   - `events.red_card.side = leading_side`
   - Good for opposition draw/no-bet review and momentum flip.

5. Equalizer after minute 60
   - `events.last_goal.type = equalizer`, `minute >= 60`
   - Often changes Over/BTTS/live momentum pricing.

6. Late goal after minute 75
   - `events.last_goal.minute >= 75`
   - Alert only; do not auto-suggest chasing without odds guard.

### Pressure / Rinh Keo

1. 0-0 pressure after minute 55
   - `minute >= 55`
   - `score.total = 0`
   - `stats.shots_on_target.total >= 5 OR stats.corners.total >= 8`
   - Good for Over 0.5/late goal watch, not automatic bet.

2. One-side pressure but no goal
   - `stats.shots_on_target.home - away >= 3`
   - `score.home <= score.away`
   - Mirror for away.

3. Losing team pressure
   - losing side has recent SOT/corners dominance.
   - Good for next goal/Asian handicap review.

4. Corner pressure
   - `minute <= 60`
   - `corners.total >= 7`
   - Useful for corners over watch only.

5. BTTS live setup
   - exactly one team has scored.
   - other team SOT >= 3 or corners >= 5.

### Trap Warnings

1. Early red card
   - `events.red_card.minute <= 35`
   - Warning to avoid blindly trusting pre-match profile.

2. Fresh goal market noise
   - last goal within 3 minutes.
   - Suppress aggressive suggestions until odds stabilize.

3. Data stale
   - provider stats/events cache is stale or missing.
   - Alert can say data unreliable instead of sending betting hint.

## Backend Modules

Add:

- `packages/server/src/lib/match-alert-rule-engine.ts`
- `packages/server/src/lib/match-alert-context.ts`
- `packages/server/src/lib/match-alert-presets.ts`
- `packages/server/src/repos/match-alert-rules.repo.ts`
- `packages/server/src/repos/match-alert-deliveries.repo.ts`
- `packages/server/src/routes/match-alerts.routes.ts`
- `packages/server/src/jobs/materialize-match-alerts.job.ts`
- `packages/server/src/jobs/check-match-alerts.job.ts`
- `packages/server/src/jobs/deliver-match-alert-telegram.job.ts`

### `match-alert-context.ts`

Build alert context from:

1. `matches` row.
2. Latest `match_snapshots` row.
3. Provider fixture/stats/events cache.
4. Provider odds cache only when the selected rule needs odds.

Do not call provider by default. Only refresh via existing provider cache helpers when:

- match has active condition rules,
- status is live,
- cache is stale beyond live TTL,
- quota/circuit allows it.

### `match-alert-rule-engine.ts`

Responsibilities:

- Validate rule JSON.
- Evaluate `all`/`any`/`not`.
- Produce deterministic result:

```ts
interface MatchAlertEvaluationResult {
  matched: boolean;
  supported: boolean;
  triggerKey: string | null;
  summaryEn: string;
  summaryVi: string;
  severity: 'info' | 'medium' | 'high';
  facts: Record<string, unknown>;
}
```

Never produce an investment recommendation here. It can produce a `suggestedAction`, such as:

- `open_match`
- `review_live_market`
- `ask_ai`
- `avoid_chasing`

### `match-alert-deliveries.repo.ts`

Responsibilities:

- Enqueue delivery idempotently by `(rule_id, trigger_key)`.
- Create channel rows for enabled channels.
- Respect user channel configs.
- Respect cooldown/once-per-match.
- Mark channel delivered/failed.
- Delete expired high-growth rows via housekeeping.

### `match-alerts.routes.ts`

Routes:

```text
GET    /api/me/match-alert-settings
PUT    /api/me/match-alert-settings

GET    /api/me/match-alert-presets
PUT    /api/me/match-alert-presets
POST   /api/me/match-alert-presets/reset

GET    /api/me/match-alert-rules?matchId=...
POST   /api/me/match-alert-rules
PATCH  /api/me/match-alert-rules/:id
DELETE /api/me/match-alert-rules/:id

POST   /api/me/match-alert-rules/compile
POST   /api/me/match-alert-rules/evaluate-preview
```

Compatibility aliases can be added later if needed; prefer `/api/me/...` for new self-service routes.

## Jobs

### `materialize-match-alerts.job.ts`

Purpose:

- Create concrete `match_start` rules for:
  - manual selected matches,
  - favorite-team matches,
  - favorite-league matches.
- Create concrete condition rules when user enables default presets globally for favorite team/league matches.

Inputs:

- `matches` table, `favorite_teams`, selected favorite leagues, user alert settings.

Frequency:

- every 1-2 minutes, near `fetch-matches`.

No provider calls.

### `check-match-alerts.job.ts`

Purpose:

- Evaluate all active `match_start` and `condition_signal` rules for live/near-live matches.

Frequency:

- 15-30 seconds.

Implementation:

1. Load candidate rules where:
   - `enabled = true`,
   - match status is `NS` within lead window, or live status,
   - no terminal status.
2. Build context per match once.
3. Evaluate all rules for that match.
4. Enqueue deliveries idempotently.
5. Send Web Push immediately or leave channel pending for a delivery job.

Recommended config:

```env
JOB_CHECK_MATCH_ALERTS_MS=15000
JOB_MATERIALIZE_MATCH_ALERTS_MS=60000
MATCH_ALERTS_ENABLED=true
MATCH_ALERTS_PROVIDER_REFRESH_ENABLED=true
MATCH_ALERTS_PROVIDER_REFRESH_CONCURRENCY=3
MATCH_ALERTS_DEFAULT_COOLDOWN_MINUTES=10
```

### Telegram Delivery

Either:

- extend `deliver-telegram-notifications.job.ts` to read both recommendation and match-alert queues, or
- add `deliver-match-alert-telegram.job.ts`.

Recommendation: separate job for clean ownership and simpler tests.

## Frontend

### Profile Notifications

Update `ProfileEditModal` Notifications tab:

- Add section: `Match Alerts`.
- Controls:
  - Enable match start alerts.
  - Notify manually selected matches.
  - Notify favorite-team matches.
  - Notify favorite-league matches.
  - Timing: at kickoff, 5 minutes before, 10 minutes before.
  - Channels: Web Push, Telegram.
- Add section: `Condition Alerts`.
  - Enable condition alerts.
  - Default cooldown.
  - Default presets enabled.
  - Manage presets.

### Matches Tab

Add a bell control per match:

- Off: no match_start rule.
- On: manual match_start rule enabled.
- Pending/disabled if no channel is configured.

Click should:

1. Ensure Web Push permission if channel selected.
2. Create/delete `match_start` rule.
3. Show compact toast.

### WatchlistEditModal

Replace or extend the current single text condition UX:

- Keep existing text condition field for compatibility.
- Add preset chips grouped by category.
- Allow multiple condition rules per match.
- Show preview using new rule engine.
- Keep `notify_enabled` mapped to alert rules during migration.

ConditionBuilder currently supports `OR` in UI but the server evaluator rejects OR. The new structured builder should support `any` properly or hide OR until server support is complete.

## Migration / Backward Compatibility

Do not remove current `user_watch_subscriptions.custom_condition_text` immediately.

Phase A:

- Add new match alert tables and jobs.
- Existing AI pipeline continues unchanged while the new engine is introduced.
- WatchlistEditModal saves both:
  - legacy `custom_condition_text`
  - new `condition_signal` rule if compilation succeeds.

Phase B:

- `check-match-alerts.job` handles compiled rules.
- AI pipeline should not be responsible for routine condition-only pushes.
- Add telemetry comparing:
  - condition matched by new engine
  - condition matched by AI pipeline
  - duplicate/suppressed deliveries

Phase C:

- Remove condition-only prompt sections, condition-triggered save branches, and condition-only delivery staging from `server-pipeline.ts`.
- Parser compatibility fields such as `condition_triggered_*` may remain for old rows/debug payload shape, but the AI recommendation pipeline must force them to false/empty and must not use them for save/push decisions.
- Recommendation saves are now only from actionable AI recommendations or explicit thesis-watch promotion.

Phase D:

- Migrate UI fully to structured rules.
- Keep legacy text read-only or compile-on-edit.

## Impact On AI Recommendation Pipeline

Expected positive impact:

- Fewer pipeline runs caused only by alert conditions.
- Lower LLM cost.
- Lower latency for user-facing alerts.
- Cleaner separation between “fact alert” and “investment recommendation”.
- Less pressure on prompt to evaluate user conditions.

Required protections:

- Do not let alert engine save recommendations directly.
- If an alert includes a suggested market, label it as informational unless it passes shared recommendation guards.
- Keep `v10-hybrid-legacy-g` as only official recommendation prompt.
- Do not change market normalization/policy gates for this feature.
- Do not call API-Sports from frontend.

Recommended shared extraction from pipeline:

- Move reusable stat/event compact helpers out of `server-pipeline.ts`:
  - `buildStatsCompact`
  - `buildEventsCompact`
  - `deriveInsightsFromEvents`
- New location:
  - `packages/server/src/lib/live-match-context.ts`

This lets both pipelines use the same live fact normalization without coupling alert delivery to AI prompt execution.

## Notification Payloads

Web Push examples:

Match start:

```json
{
  "title": "MATCH STARTED",
  "body": "Arsenal vs Chelsea\nPremier League - 0'\nTap to open match.",
  "tag": "tfi-alert-match-start-1396482",
  "url": "/?tab=matches&match=1396482&matchDisplay=Arsenal%20vs%20Chelsea",
  "icon": "/icons/notification-condition.svg"
}
```

Condition:

```json
{
  "title": "LIVE SIGNAL",
  "body": "Arsenal vs Chelsea\nRed card for Chelsea at 54'. Score 1-1.\nSuggested action: review live market.",
  "tag": "tfi-alert-red-card-1396482-54",
  "url": "/?tab=matches&match=1396482&matchDisplay=Arsenal%20vs%20Chelsea",
  "icon": "/icons/notification-condition.svg"
}
```

Service worker currently extracts match id only from `tfi-rec-` tags. Update it to read `payload.data.matchId` first, then fallback to tag prefixes:

- `tfi-rec-`
- `tfi-alert-match-start-`
- `tfi-alert-`

## Entitlements

Initial recommendation:

- Web Push match start: available to all authenticated users with Web Push channel.
- Telegram alerts: follow existing channel entitlement.
- Active condition rules per user can reuse watchlist active-match limits in MVP, but a separate entitlement is cleaner:
  - `alerts.match_start.enabled`
  - `alerts.condition.enabled`
  - `alerts.condition.max_active_rules`
  - `alerts.channels.allowed_types`

## Tests

Backend unit tests:

- `match-alert-rule-engine.test.ts`
  - first goal side
  - red card side
  - leading team red card
  - 0-0 pressure
  - OR/any support
  - unsupported field
  - stale/missing data

- `match-alert-rules.repo.test.ts`
  - CRUD user-owned rules
  - materialized favorite team/league uniqueness
  - disabled rule ignored

- `match-alert-deliveries.repo.test.ts`
  - idempotent trigger key
  - channel rows created based on channel config
  - cooldown suppresses duplicate
  - delivered/failed state recomputes parent delivery

- `check-match-alerts.job.test.ts`
  - match start enqueue
  - condition signal enqueue
  - no provider call when cache is fresh
  - provider refresh only for active live rules
  - terminal matches ignored

Frontend tests:

- `ProfileEditModal.test.tsx`
  - loads and saves match alert settings
  - manages preset list

- `WatchlistEditModal.test.tsx`
  - preset chips create structured rule
  - legacy condition still saves
  - preview displays matched/unmatched

- `MatchesTab.test.tsx`
  - bell creates/deletes match_start rule

E2E:

- User enables Web Push channel.
- User toggles match start alert for a match.
- Mock/seed match moves into kickoff/live state.
- Job enqueues delivery.
- Notification click opens match in Matches tab.

## Rollout Plan

1. Implement DB migrations and repos.
2. Implement deterministic rule engine and tests.
3. Add routes for settings, presets, rules, preview.
4. Add jobs and scheduler registration behind env flag.
5. Add Web Push delivery for match alerts.
6. Add Profile and Matches UI for match start alerts.
7. Add Watchlist preset UI for condition signals.
8. Add Telegram delivery.
9. Remove AI pipeline condition-only prompt/save/delivery logic after the match-alert engine owns condition delivery.
10. Run focused regression tests proving legacy condition fields are ignored by the AI pipeline.

## Acceptance Criteria

MVP is done when:

- User can enable Web Push and select a specific match for kickoff notification.
- User can enable kickoff alerts for favorite teams and favorite leagues.
- User can choose at least 5 default condition presets per watched match.
- Condition presets are evaluated by the deterministic alert engine first, then optionally confirmed by the dedicated fast match-alert LLM.
- Web Push alert opens the match in Matches tab.
- Duplicate alert delivery is prevented by trigger key/cooldown.
- AI Recommendation Pipeline still passes existing focused tests and data-driven gate baselines.
- AI Recommendation Pipeline no longer saves or pushes condition-triggered suggestions; condition alerts are delivered by the match-alert engine.

## Implementation Status - 2026-06-05

Implemented in this iteration:

- Added migration `062_user_match_alerts.sql` with settings, rules, deliveries, delivery channels, and preset overrides.
- Added deterministic alert context/rule engine:
  - `packages/server/src/lib/match-alert-context.ts`
  - `packages/server/src/lib/match-alert-rule-engine.ts`
  - `packages/server/src/lib/match-alert-presets.ts`
- Added backend repos/routes/jobs:
  - `packages/server/src/repos/match-alert-rules.repo.ts`
  - `packages/server/src/repos/match-alert-deliveries.repo.ts`
  - `packages/server/src/routes/match-alerts.routes.ts`
  - `packages/server/src/jobs/materialize-match-alerts.job.ts`
  - `packages/server/src/jobs/check-match-alerts.job.ts`
  - `packages/server/src/jobs/deliver-match-alert-telegram.job.ts`
- Registered routes and scheduler jobs.
- Added Web Push payload `data` support, Telegram match-alert delivery, and Service Worker click handling for `tfi-alert-*` tags.
- Added frontend API wrappers, Profile notification settings, Matches kickoff bell controls, and Watchlist condition preset chips.
- Added focused unit test coverage for the rule engine.
- Added lightweight Gemini adjudication for matched condition alerts:
  - default `GEMINI_MATCH_ALERT_MODEL=gemini-2.5-flash-lite`
  - `MATCH_ALERT_LLM_ENABLED=true`
  - low output budget and `thinkingBudget=0`
  - output is alert-only: no market, odds, stake, bankroll action, or recommendation persistence
- Added Profile -> Notifications -> Match Alerts preset configuration so users can enable/disable condition presets, set default cooldowns, save, and reset them.
- Added real LLM smoke script:
  - `npm run verify:match-alert-real-llm --prefix packages/server`
  - covers every system condition preset with synthetic live contexts and calls the configured Gemini match-alert model.
- Removed condition-only prompt/save/delivery logic from the AI Recommendation Pipeline:
  - no `CUSTOM_CONDITIONS` prompt section,
  - no low-evidence condition guard,
  - no condition-triggered recommendation save branch,
  - no condition-only Telegram/Web Push staging from `server-pipeline.ts`.

Verified:

- `npm run typecheck --prefix packages/server`
- `npm run test --prefix packages/server -- src/__tests__/server-pipeline.test.ts src/__tests__/recommendation-policy.test.ts src/__tests__/normalize-market.test.ts`
- `npm run test --prefix packages/server -- src/__tests__/match-alert-rule-engine.test.ts`
- `npm run test --prefix packages/server -- src/__tests__/match-alert-rule-engine.test.ts src/__tests__/match-alert-llm.test.ts`
- `npm run verify:match-alert-real-llm --prefix packages/server`
- `npm run build`
- `npm run migrate --prefix packages/server`

Remaining follow-ups:

- Provider-cache refresh inside alert jobs; current implementation consumes `matches` and latest `match_snapshots`.
- Alert history UI.
- Full E2E notification click test.

## Open Decisions

- Whether condition presets are enabled globally for all favorite-team/favorite-league matches or only per watched match.
- Whether Telegram condition alerts should be immediate in the same job or batched like current recommendation Telegram delivery.
- Whether alert history should be visible in Recommendations tab, Match hub, or a separate notification center.
- Whether user natural-language rules should be compiled by a fast model synchronously in UI or asynchronously in a background job.
