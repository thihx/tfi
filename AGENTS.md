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

## Recommendation Pipeline Ground Truth

- Before changing recommendation, live monitor, prompt, replay, watchlist trigger, settlement, or delivery code, read `docs/live-recommendation-pipeline-vi.md`.
- Codex agents should also use `.codex/skills/tfi-recommendation-pipeline/`.
- The only official live-analysis prompt is `v10-hybrid-legacy-g`; do not reintroduce retired prompt versions or shadow candidates without intentionally creating a new official baseline.
- Money-critical flow: provider/cache inputs -> canonical odds -> prompt -> JSON parse -> market normalization -> policy/memory/segment guards -> recommendation save/delivery staging.

## Data-driven replay (recommendation quality)

- Tiến độ % và điều kiện “xong” MVP: [docs/data-driven-pipeline-status.md](docs/data-driven-pipeline-status.md).
- Snapshot coverage (DB): `npm run data-driven:coverage --prefix packages/server` (`--lookback-days`, `--out-json`).
- Full batch (coverage + export + eval + replay-vs-original summary + segment hotspots): `npm run data-driven:replay-batch --prefix packages/server` (under `packages/server/replay-work/data-driven-runs/<runId>/`; `--no-post-summarize` skips delta CSV/JSON; `--no-post-segment-hotspots` skips `segment-hotspots.json`). Real LLM: `--llm real --allow-real-llm`. Policy parity: `--apply-replay-policy`.
- Recent prompt adoption canary: `npm run data-driven:prompt-adoption --prefix packages/server -- --lookback-days 14 --out-json <path> --out-md <path>`, then gate with `npm run data-driven:check-prompt-adoption-gates --prefix packages/server -- --config <config>`. Use this before treating production rows as current official prompt evidence; it also surfaces stale live-writer activity via latest-row age.
- Live writer liveness: `npm run data-driven:pipeline-liveness --prefix packages/server -- --lookback-hours 336 --out-json <path> --out-md <path>` combines `job_run_history`, pipeline `audit_logs`, and recommendation recency before diagnosing deployment/job inactivity.
- Current official no-save diagnostics: `npm run data-driven:current-runtime-no-save --prefix packages/server -- --lookback-hours 336 --out-json <path> --out-md <path>` explains why active `v10-hybrid-legacy-g` audit activity has no saved recommendation cohort.
- Current official blocked-selection review: `npm run data-driven:current-runtime-blocked-selection --prefix packages/server -- --lookback-hours 336 --out-json <path> --out-md <path>` settles non-empty official-prompt selections that were not pushed/saved as counterfactual audit evidence.
- Current official blocked-selection gates: `npm run data-driven:check-current-runtime-blocked-selection-gates --prefix packages/server -- --config <config>` checks settled coverage and required canonical-market thresholds for shadow-only candidate evidence.
- Runtime shadow operator runbook: [docs/runtime-shadow-operator-runbook.md](docs/runtime-shadow-operator-runbook.md) defines when to run liveness/no-save/blocked-selection/shadow-suite checks, which files to read first, pass/fail meaning, and hard no-promote rules.
- Tuned preset for improvement analysis (mock LLM, recorded odds, policy): `npm run data-driven:improvement-run --prefix packages/server` → same folder layout; read `replay-vs-original.json` and `segment-hotspots.json` first.
- Real LLM preset (costs API quota): `npm run data-driven:improvement-run-real --prefix packages/server` — check `replay-work/data-driven-runs/<runId>/llm-cache/` for full prompts and `aiText` when diagnosing all-`no_bet` runs.
- Step 2 on existing `eval-cases.json`: `npm run data-driven:summarize-vs-original --prefix packages/server -- --cases-json <path> [--out-json ...] [--out-csv ...]`.
- Step 3 gates on `replay-vs-original.json`: copy `packages/server/data-driven-replay-gates.example.json` to `data-driven-replay-gates.json`, edit paths/thresholds, then `npm run data-driven:check-gates --prefix packages/server`.
- Segment hotspots from existing `eval-cases.json`: `npm run data-driven:segment-hotspots --prefix packages/server -- --cases-json <path>`.
- Segment gates on `segment-hotspots.json`: copy `packages/server/data-driven-segment-gates.example.json` to `data-driven-segment-gates.json`, then `npm run data-driven:check-segment-gates --prefix packages/server`.
- **CI baselines** (checked on every server CI job): `packages/server/ci-baselines/data-driven-gates/` — `npm run data-driven:verify-gates-ci --prefix packages/server` runs replay-delta + segment gate configs against those JSON files (no DB/LLM). Update the baselines when you intentionally change expected cohort metrics.
- **Optional baseline smoke** (lightweight): `.github/workflows/data-driven-baselines-smoke.yml` — `workflow_dispatch` or weekly schedule; runs only `data-driven:verify-gates-ci` (not the full server test suite).
- **Optional DB coverage artifact**: `.github/workflows/data-driven-db-coverage.yml` — `workflow_dispatch`; Postgres + migrate + `data-driven:coverage` → download artifact `data-driven-snapshot-coverage` from the run.
- Optional live blocklist: `SEGMENT_POLICY_BLOCKLIST_PATH` → JSON per `segment-policy-blocklist.example.json`; draft keys from a run via `npm run data-driven:suggest-segment-blocklist --prefix packages/server -- --hotspots-json <path>`.
- Optional segment stake ceiling: `SEGMENT_POLICY_STAKE_CAP_PATH` → `segment-policy-stake-cap.example.json`.

## Deploy (Azure Container Apps)

- Full deployment guide: [docs/tfi-azure-aca-deployment-guide.md](docs/tfi-azure-aca-deployment-guide.md)
- Runbook: [docs/deploy-azure-runbook.md](docs/deploy-azure-runbook.md)
- Scripts: `scripts/azure/deploy.ps1` (Windows), `scripts/azure/deploy.sh` (bash/WSL/CI)
- PR/push CI: `.github/workflows/ci.yml` (server: typecheck + vitest + data-driven gate baselines; client: typecheck + vitest). Local mirror: `npm run verify:ci` at repo root.
- Optional CI: `.github/workflows/deploy-azure.yml` (`workflow_dispatch`)

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
- **UI redesign (phases 0–5 done):** read [docs/ui-redesign-audit.md](docs/ui-redesign-audit.md) before broad visual changes. Cursor/agent skills: `.agents/skills/redesign-existing-projects`, `design-taste-frontend`, `minimalist-ui` (Taste Skill). Keep **vanilla CSS** in `public/css/styles.css` and existing `--primary` tokens unless the user requests a stack change. Combine with `tfi-responsive-ui` for all in-app surfaces under `src/`. Shared UI primitives include `.page-toolbar*`, `.bulk-bar*`, `.tab-section`, `.chart-panel*`, `.monitor-list-row*`, `.settings-panel-card`, `.modal--md/lg/xl`, `.empty-state-panel`; components `ViewToggle`, `BulkActionBar`, `EmptyState`, `FeedModeToggle` in `src/components/ui/`. Always validate ~360px / 768px responsive behavior on layout changes.
- **Sports data provider:** the browser must not call API-Sports directly; use backend routes (e.g. `/api/matches`, `/api/proxy/football/*`). On the server, outbound provider calls go through `packages/server/src/lib/football-api.ts` only — see [docs/agent-onboarding.md](docs/agent-onboarding.md).

## Change Workflow

- For UI work, inspect the tab/page component, shared layout component, and the frontend API/service call it depends on. Validate narrow viewports and mobile interaction where relevant.
- For backend work, inspect the route, service/lib or repo layer, tests, and any migration impact.
- Prefer focused test runs first, then broader verification.

## Neutrality

This file is intended for any coding agent, not just Codex.
Project-local Codex skills exist in `.codex/skills/`, but they are optional and not required to follow this guide.
