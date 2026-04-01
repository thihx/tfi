# Testing Notes

## Current Test Topology

- Playwright starts the frontend automatically from `playwright.config.ts`.
- The backend must already be reachable on `http://localhost:3001` for E2E.
- Vitest covers most frontend/backend non-E2E behavior.

## E2E Rules For This Repo

- Prefer role/text selectors that match the current visible UI.
- Read Playwright `error-context.md` before changing selectors.
- Distinguish setup failures from UI regressions.

## Current UI Copy That Commonly Drifts

- Dashboard KPI labels: `Settled Recommendations`, `Hit Rate (W/L)`, `Total P/L`, `ROI on Stake`
- Investment Tracker KPI labels: `Total Investments`, `Hit Rate (W/L)`, `Total P/L`, `ROI on Stake`
- Reports overview: `Recommendations`, `Hit Rate (W/L)`, `P/L`, `ROI on Stake`
- Live Monitor: `Live Monitor Dashboard`, `Refresh`, `Run Check Live`, `Latest Run Summary`
- Settings default tab: `General`
- Settings sub-tabs: `General`, `Scheduler`, `System`, `Audit`

## Settings Tab Routing

- `Scheduler` tab contains job controls such as `Fetch Matches`
- `System` tab contains `Ops Monitoring` and `Integration Health`
- `Audit` tab contains `Audit Trail`

Tests that assert those sections must click the correct tab first.
