# Agent Onboarding

This document is a neutral onboarding layer for coding agents working in the TFI repository.
It is written to be useful even if the agent does not understand Codex-specific skills.

## What This Repo Is

TFI is an application with:

- a React + Vite frontend in `src/`
- a Fastify + PostgreSQL + Redis backend in `packages/server/src/`
- Playwright end-to-end coverage in `e2e/`

The active runtime is the React/Vite app plus the Fastify backend.
`legacy/` is archived reference code and should not be treated as active runtime by default.

## Working Areas

### Frontend

- App shell and tabs: `src/app/`
- Shared UI: `src/components/`
- Hooks/state: `src/hooks/`
- Services/utilities: `src/lib/`
- Feature-specific code: `src/features/`

### Backend

- Server entry: `packages/server/src/index.ts`
- Routes: `packages/server/src/routes/`
- Repos/data access: `packages/server/src/repos/`
- Shared libs/services: `packages/server/src/lib/`
- Live analysis prompt default: `LIVE_ANALYSIS_PROMPT_VERSION` in `packages/server/src/lib/live-analysis-prompt.ts`. Override production/staging with `LIVE_ANALYSIS_ACTIVE_PROMPT_VERSION`. Prompt shadow is **off** in checked-in examples (`LIVE_ANALYSIS_SHADOW_ENABLED=false`, `LIVE_ANALYSIS_SHADOW_SAMPLE_RATE=0`); re-enable A/B only after setting a current `LIVE_ANALYSIS_SHADOW_PROMPT_VERSION` (see `packages/server/.env.example`, `.env.azure.example`).
- Jobs/scheduler: `packages/server/src/jobs/`
- Migrations: `packages/server/src/db/migrations/`

### Tests

- Frontend/unit/integration: `src/**/*.test.ts(x)`
- Backend tests: `packages/server/src/__tests__/`
- E2E/Playwright: `e2e/`

## Local Commands

### Development

- Full stack: `npm run dev`
- Frontend only: `npm run dev:client`
- Backend only: `npm run dev:server`

### Verification

- Frontend tests: `npm run test`
- Frontend build gate: `npm run build`
- E2E tests: `npm run test:e2e`

## Ports And Runtime Assumptions

- Frontend dev server: `http://localhost:3000`
- Backend API used by local app and Playwright: `http://localhost:3001`
- Some code still falls back to `http://localhost:4000` when env is absent

For E2E, the frontend is started by Playwright, but the backend must already be reachable on `3001`.

The backend usually expects:

- PostgreSQL available
- Redis available
- a usable server `.env`

## Auth Topology

This repo currently uses a mixed auth model.

### App boot

- `src/hooks/useAuth.ts` checks `/api/auth/me`
- the boot path depends on the `tfi_auth_token` cookie

### Other frontend API calls

- several frontend services still attach `Authorization: Bearer <token>`
- that bearer token is read from `localStorage.tfi_auth_token`

### Practical impact

If you are fixing auth-sensitive tests or automation:

- do not seed only `localStorage`
- do not seed only the cookie
- for reliable E2E bootstrap, seed both

## E2E Guidance

### Current structure

- Playwright config: `playwright.config.ts`
- Auth bootstrap: `e2e/global-setup.ts`
- Reports and artifacts: `playwright-report/`, `test-results/`

### Common failure modes

1. Backend is not running on `3001`
2. Auth bootstrap only covers one auth channel
3. Assertions are stale because the UI copy changed
4. Tests assume a sub-tab is visible without navigating to it first

### UI labels known to drift

- Dashboard KPIs use `Settled Recommendations`, `Hit Rate (W/L)`, `Total P/L`, `ROI on Stake`
- Investment Tracker uses `Hit Rate (W/L)` and `ROI on Stake`
- Reports overview uses `Recommendations`, `Hit Rate (W/L)`, `P/L`, `ROI on Stake`
- Live Monitor uses `Live Monitor Dashboard`, `Refresh`, `Run Check Live`, `Latest Run Summary`
- Settings defaults to the `General` tab
- Settings sections like `Integration Health` and `Audit Trail` require switching to `System` or `Audit`

Before rewriting a test, read the Playwright `error-context.md` artifact and verify the actual rendered text.

## How To Approach Changes

### For frontend changes

Inspect:

- the tab or page component
- related shared components
- the frontend service or hook used for data
- the relevant tests

### For backend changes

Inspect:

- the route file
- the repo/lib layer behind it
- the relevant tests
- migration impact if schema changes are involved

### For E2E changes

Inspect:

- the current UI component source
- `e2e/global-setup.ts`
- `playwright.config.ts`
- the failing artifact under `test-results/`

## Football / external data provider (API-Sports)

### Frontend (`src/`)

- **Do not** call the provider (api-sports.io) from the browser: no provider API keys in the client, no direct `fetch` to the vendor host.
- Use the Fastify backend instead: e.g. `GET /api/matches` for the matches list, and **`/api/proxy/football/*`** for live-monitor style needs. The live-monitor feature uses `src/features/live-monitor/services/proxy.service.ts` (POST to `/api/proxy/football/live-fixtures`, `/odds`, etc.); `football-api.service.ts` wraps that proxy, not the vendor.
- **AI live recommendations (O/U bias, prompt versions, testing):** see [docs/live-monitor-ai-ou-under-bias.md](live-monitor-ai-ou-under-bias.md).

### Backend (`packages/server/src/`)

- **Centralize** all outbound provider HTTP in **`packages/server/src/lib/football-api.ts`** (the only module that should know the vendor base URL, headers, and retry behaviour).
- Routes and jobs should import helpers from there (or from a thin wrapper that delegates to it). Avoid new one-off `fetch` calls to the provider from random routes or jobs.

## Safety Notes

- Assume the git worktree may already be dirty.
- Do not revert unrelated user changes.
- Prefer focused test runs before broad suites.
- Prefer current runtime code over historical docs if they conflict.

## Optional Codex-Specific Extras

This repo may also contain Codex-oriented skills under `.codex/skills/`.
They can help Codex, but they are not required for agents that do not support that system.
This onboarding doc should remain the neutral source of truth.
