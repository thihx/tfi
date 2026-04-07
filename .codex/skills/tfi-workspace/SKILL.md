---
name: tfi-workspace
description: Onboard Codex to the TFI repository so it can work safely across the React/Vite frontend and the Fastify/Postgres/Redis backend. Use when changing application flows, auth, routes, jobs, live monitor, reports, watchlist, or tests in this repo and when you need the project-specific startup commands, runtime map, and architecture guardrails.
---

# TFI Workspace

Use this skill to rebuild project context quickly before changing code.

## Quick Start

1. Read `references/runtime.md` for the repo map, boot commands, ports, and auth topology.
2. Read `references/testing.md` when touching Playwright, Vitest, or auth-sensitive flows.
3. If the task is E2E-specific, also use `tfi-e2e-playwright`.

## Working Model

1. Treat `src/` as the active frontend and `packages/server/src/` as the active backend.
2. Ignore `legacy/` unless the task explicitly asks for historical reference.
3. For UI changes, inspect the tab component, shared layout component, and the frontend service calling the backend route. For layout, modals, tables, or mobile/desktop behavior, also follow **`tfi-responsive-ui`**.
4. For backend changes, inspect the route, repo/lib layer, tests, and any migration impact.

## TFI Guardrails

- Keep the current dual auth model intact unless the task is an auth refactor.
  The app shell authenticates through `/api/auth/me` using the `tfi_auth_token` cookie.
  Many frontend data calls still attach a bearer token from `localStorage`.
- Expect the backend to require both Postgres and Redis before it can start cleanly.
- Do not assume older Playwright assertions match the current UI copy. Check the rendered tab and current headings first.
- Prefer current runtime files over archived docs if they disagree.

## Task Routing

- Use `references/runtime.md` for architecture and startup context.
- Use `references/testing.md` for test topology and current UI/testing gotchas.
- Use `tfi-e2e-playwright` when you need a fresh admin JWT or Playwright-specific workflow.
