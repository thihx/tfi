# Runtime Map

## Active Areas

- Frontend app: `src/`
- Backend app: `packages/server/src/`
- Playwright E2E: `e2e/`
- Frontend unit/integration tests: `src/**/*.test.ts(x)`
- Backend tests: `packages/server/src/__tests__/`
- Reference-only legacy code: `legacy/`

## Local Commands

- Frontend + backend dev: `npm run dev`
- Frontend only: `npm run dev:client`
- Backend only: `npm run dev:server`
- Frontend typecheck/build gate: `npm run build`
- Frontend unit tests: `npm run test`
- Playwright E2E: `npm run test:e2e`

## Ports

- Frontend dev server: `http://localhost:3000`
- Backend API for Playwright/local app: `http://localhost:3001`
- Backend fallback default when env is absent: `http://localhost:4000`

## Auth Topology

- The app boot path checks `/api/auth/me` from `useAuth`.
- Auth success requires a valid `tfi_auth_token` cookie for the backend.
- Several frontend services also send `Authorization: Bearer <token>` using `localStorage.tfi_auth_token`.
- When E2E bootstraps auth, seed both the cookie and `localStorage`.

## High-Risk Areas

- `src/hooks/useAuth.ts`: boot auth and login redirects
- `e2e/global-setup.ts`: Playwright auth bootstrap
- `src/app/SettingsTab.tsx`: multi-tab settings UI
- `src/app/LiveMonitorTab.tsx`: current live monitor UI copy and actions
- `packages/server/src/index.ts`: backend startup, auth guard, Postgres/Redis readiness
