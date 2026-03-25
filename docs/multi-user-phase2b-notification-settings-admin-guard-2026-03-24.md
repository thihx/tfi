# Multi-User Phase 2B: Notification Settings and Admin Operational Guards

Date: 2026-03-24

## 1. Scope

This slice closes the two deferred gaps left intentionally after phase 2a:

- add a dedicated self-service `user_notification_settings` API
- enforce `admin` or `owner` access on global operational endpoints
- preserve existing frontend settings consumers through a transition layer instead of a UI-wide contract rewrite

## 2. Notification Settings

### 2.1 Backend

- new route: `GET/PUT /api/notification-settings`
- new repo: `packages/server/src/repos/notification-settings.repo.ts`
- storage source of truth is `user_notification_settings`
- if the user does not yet have a dedicated notification-settings row, reads fall back to legacy values from `user_settings`

### 2.2 Frontend Transition

- `src/features/live-monitor/config.ts` still exposes the same `fetchMonitorConfig()` and `persistMonitorConfig()` contract
- notification-specific keys are split out internally and persisted through `/api/notification-settings`
- merged config is still written to the local cache so existing UI code keeps working

### 2.3 Transitional Compatibility

This slice does not yet refactor the shared server pipeline to consume per-user notification settings. That remains a later delivery-layer step.

The compatibility goal here is narrower:

1. users can own their notification preferences now
2. existing settings UI does not need a broad rewrite now
3. prompt logic and shared recommendation generation remain unchanged

## 3. Admin Operational Guards

The following global operational route groups now require `admin` or `owner`:

- `/api/jobs/*`
- `/api/ops/*`
- `/api/integrations/health`
- `/api/pipeline-runs/*`
- `/api/reports/*`
- `GET /api/audit-logs`
- `GET /api/audit-logs/stats`
- `DELETE /api/audit-logs/purge`

`POST /api/audit-logs` remains available to any authenticated user because it is still used for user-originated audit writes.

## 4. Files Added or Updated

- [packages/server/src/repos/notification-settings.repo.ts](packages/server/src/repos/notification-settings.repo.ts)
- [packages/server/src/routes/notification-settings.routes.ts](packages/server/src/routes/notification-settings.routes.ts)
- [packages/server/src/lib/authz.ts](packages/server/src/lib/authz.ts)
- [packages/server/src/routes/jobs.routes.ts](packages/server/src/routes/jobs.routes.ts)
- [packages/server/src/routes/ops.routes.ts](packages/server/src/routes/ops.routes.ts)
- [packages/server/src/routes/integrations.routes.ts](packages/server/src/routes/integrations.routes.ts)
- [packages/server/src/routes/pipeline-runs.routes.ts](packages/server/src/routes/pipeline-runs.routes.ts)
- [packages/server/src/routes/reports.routes.ts](packages/server/src/routes/reports.routes.ts)
- [packages/server/src/routes/audit-logs.routes.ts](packages/server/src/routes/audit-logs.routes.ts)
- [packages/server/src/index.ts](packages/server/src/index.ts)
- [src/lib/services/notification-settings.ts](src/lib/services/notification-settings.ts)
- [src/features/live-monitor/config.ts](src/features/live-monitor/config.ts)

## 5. API Contract Note

This slice originally introduced notification-settings behavior on `/api/notification-settings` as the compatibility route used by the existing frontend.

To stay aligned with the target design, `/api/me/notification-settings` is now also available and should be treated as the canonical self-service contract going forward.

## 6. Still Deferred After Phase 2B

1. user watch subscriptions
2. user recommendation deliveries
3. user bets and admin/global bet views
4. billing and entitlements
5. eventual route/path separation for explicit `/api/admin/*` surfaces