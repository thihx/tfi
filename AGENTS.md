# TFI Agent Guide

This repository contains the active TFI application.

Read [docs/agent-onboarding.md](docs/agent-onboarding.md) before making non-trivial changes.

## Active Areas

- Frontend: `src/`
- Backend: `packages/server/src/`
- E2E tests: `e2e/`
- Frontend tests: `src/**/*.test.ts(x)`
- Backend tests: `packages/server/src/__tests__/`
- Legacy reference only: `legacy/`

## Quick Start

- Full dev: `npm run dev`
- Frontend only: `npm run dev:client`
- Backend only: `npm run dev:server`
- Frontend tests: `npm run test`
- E2E tests: `npm run test:e2e`

## Important Guardrails

- Do not treat `legacy/` as active runtime code unless explicitly asked.
- The backend must be reachable for E2E and typically depends on both Postgres and Redis.
- Auth is split across cookie and bearer-token usage.
  App boot uses `/api/auth/me` with the `tfi_auth_token` cookie.
  Some frontend service calls still send a bearer token from `localStorage`.
- When changing Playwright tests, verify current visible UI text first.
  Do not assume older labels are still valid.
- **UI runs on desktop and mobile web:** keep layouts responsive, touch-friendly, and scroll-safe (modals, tables, toolbars). Codex skill: `.codex/skills/tfi-responsive-ui/`.
- **Sports data provider:** the browser must not call API-Sports directly; use backend routes (e.g. `/api/matches`, `/api/proxy/football/*`). On the server, outbound provider calls go through `packages/server/src/lib/football-api.ts` only — see [docs/agent-onboarding.md](docs/agent-onboarding.md).

## Change Workflow

- For UI work, inspect the tab/page component, shared layout component, and the frontend API/service call it depends on. Validate narrow viewports and mobile interaction where relevant.
- For backend work, inspect the route, service/lib or repo layer, tests, and any migration impact.
- Prefer focused test runs first, then broader verification.

## Neutrality

This file is intended for any coding agent, not just Codex.
Project-local Codex skills exist in `.codex/skills/`, but they are optional and not required to follow this guide.
