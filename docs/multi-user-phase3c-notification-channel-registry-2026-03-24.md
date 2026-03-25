# Multi-User Phase 3C: Notification Channel Registry And Telegram Runtime Hardening

Date: 2026-03-24

## 1. Scope

This slice prepares the notification layer for multiple delivery channels without pretending the senders are already implemented.

Implemented now:

- setup-ready user channel registry for `telegram`, `zalo`, `web_push`, and `email`
- self-service API to view and update per-user channel configuration state
- admin-only system settings API for default operational notification settings
- Telegram runtime no longer falls back to environment chat id when DB settings are missing

## 2. What Was Added

### 2.1 User Notification Channel Registry

New table:

- `user_notification_channel_configs`

Purpose:

1. reserve a first-class place for future multi-channel delivery setup
2. avoid overloading `user_notification_settings.channelPolicy` with provider-specific destination data
3. let future work attach verification and sender status per channel

Supported channels in this slice:

1. `telegram`
2. `zalo`
3. `web_push`
4. `email`

### 2.2 Self-Service Channel API

Routes:

- `GET /api/notification-channels`
- `PUT /api/notification-channels/:channelType`

Current behavior:

1. returns all supported channels even when a user has not configured them yet
2. stores channel `enabled`, `address`, `config`, and `metadata`
3. derives setup status as `draft`, `pending`, `verified`, or `disabled`

### 2.3 Admin System Settings API

Routes:

- `GET /api/settings/system`
- `PUT /api/settings/system`

Purpose:

1. manage the `default` settings row used by shared runtime jobs
2. provide a DB-backed place for operational settings like `TELEGRAM_CHAT_ID`
3. remove the operational dependency on environment fallback for chat delivery targets

## 3. Telegram Runtime Change

Current requirement:

- Telegram bot token still comes from environment secret configuration
- Telegram chat destination must come from DB settings (`default` row)
- if DB `TELEGRAM_CHAT_ID` is missing, Telegram delivery is skipped explicitly

This is intentional.

It prevents hidden production behavior where notifications seem configured only because an environment variable happens to exist.

## 4. Deferred Work

Still deferred after this slice:

1. real sender implementation for `zalo`
2. real sender implementation for `email`
3. user-level Telegram verification and per-user Telegram routing
4. first-class UI for admin system notification settings
5. first-class UI for multi-channel configuration management

## 5. Files Added Or Updated In This Slice

- [packages/server/src/db/migrations/028_notification_channel_configs.sql](packages/server/src/db/migrations/028_notification_channel_configs.sql)
- [packages/server/src/repos/notification-channels.repo.ts](packages/server/src/repos/notification-channels.repo.ts)
- [packages/server/src/routes/notification-channels.routes.ts](packages/server/src/routes/notification-channels.routes.ts)
- [packages/server/src/routes/settings.routes.ts](packages/server/src/routes/settings.routes.ts)
- [packages/server/src/lib/telegram-runtime.ts](packages/server/src/lib/telegram-runtime.ts)
- [packages/server/src/lib/server-pipeline.ts](packages/server/src/lib/server-pipeline.ts)
- [packages/server/src/jobs/integration-health.job.ts](packages/server/src/jobs/integration-health.job.ts)
- [packages/server/src/jobs/health-watchdog.job.ts](packages/server/src/jobs/health-watchdog.job.ts)

## 6. Documentation Maintenance Note

This slice introduced a design-relevant operational constraint: Telegram runtime destination resolution must be DB-backed and must not silently fall back to environment variables.

That constraint is recorded in the target design document and the implementation conformance review so future notification work has a single source of truth for comparison.