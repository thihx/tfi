# Subscription And Billing Rollout Plan

Date: 2026-03-31

## Phase 1

Deliver the commercial access foundation without public checkout.

### Deliverables

- subscription plan schema
- user subscription schema
- entitlement usage schema
- entitlement catalog in code
- self-service subscription snapshot API
- admin plan and subscription APIs
- admin UI in `Settings > System`
- hard enforcement on manual AI, watchlist capacity, and notification channels

### Acceptance Criteria

- users without paid subscription fall back to `free`
- admin can change plan entitlements without code edits
- admin can assign a plan to any user
- backend blocks disallowed usage even if the frontend is bypassed

## Phase 2

Expand entitlement coverage.

### Candidate additions

- proactive recommendations without watchlist
- advanced reports
- exports
- favorite team limits
- custom watch conditions
- historical data retention windows

## Phase 3

Integrate external payment provider.

### Deliverables

- checkout flow
- webhook ingestion
- provider event replay
- subscription lifecycle sync
- billing portal

## Rollout Notes

- Migrate database before deploy.
- Deploy backend before relying on admin UI.
- Seeded plan defaults must be reviewed by product before public launch.
- Until external billing exists, subscription assignment remains an admin-operated workflow.
