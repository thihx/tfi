---
name: tfi-e2e-playwright
description: Run, debug, and update the TFI Playwright E2E suite. Use when working in `e2e/`, triaging Playwright failures, refreshing auth bootstrap, aligning assertions with the current TFI UI copy, or running end-to-end checks against the local Fastify backend.
---

# TFI E2E Playwright

Use this skill when a TFI task needs Playwright reproduction instead of guesswork.

## Quick Start

1. Ensure the backend is running on `http://localhost:3001`.
   Use `npm run dev --prefix packages/server` if it is not already running.
2. Generate a fresh admin JWT:
   `node .codex/skills/tfi-e2e-playwright/scripts/create-e2e-token.mjs`
3. Run Playwright with the generated token:
   PowerShell: `$env:E2E_TOKEN=(node .codex/skills/tfi-e2e-playwright/scripts/create-e2e-token.mjs); npm run test:e2e`
4. For a targeted repro, swap the final command with:
   `npx playwright test e2e/<file>.spec.ts`

## TFI-Specific Rules

- Keep `e2e/global-setup.ts` seeding both the auth cookie and `localStorage`.
- Keep CLI-provided `E2E_TOKEN` higher priority than `.env.e2e`.
- Treat `.env.e2e` as a local fallback, not the primary source of truth.
- Prefer current rendered labels over historical test copy.

## Failure Triage Workflow

1. Reproduce with one spec file first.
2. Read `test-results/**/error-context.md` before changing selectors.
3. Check `references/current-ui.md` to see whether the failure is stale copy or a real regression.
4. Update assertions to the current accessible text and tab flow.
5. Re-run the focused spec before re-running the full suite.

## Current TFI UI Mappings

- Settings opens on `General`; click `Scheduler`, `System`, or `Audit` before asserting those panels.
- Live Monitor uses `Live Monitor Dashboard` and `Run Check Live`.
- Dashboard, Investment Tracker, and Reports use `Hit Rate (W/L)` and `ROI on Stake`.

## Resources

- `scripts/create-e2e-token.mjs`: prints a fresh local admin JWT using the server secret
- `references/current-ui.md`: current labels and routing hints for stale-selector triage
