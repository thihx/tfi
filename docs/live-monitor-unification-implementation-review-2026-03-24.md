# Live Monitor Unification Implementation Review

Date: 2026-03-24
Design Reference: `docs/live-monitor-unification-design-2026-03-24.md`

## 1. Review Outcome

Status: Accepted with minor follow-up cleanup.

The refactor now satisfies the runtime unification goal:

1. The server pipeline is the only execution path used by active UI surfaces.
2. `Live Monitor` is now a server-driven dashboard instead of a browser scheduler.
3. `Matches` manual Ask AI now calls the server pipeline.
4. Route tests, frontend service tests, frontend typecheck, and server typecheck all pass.

## 2. Design Traceability

### 2.1 Canonical execution engine

Design requirement:

- `packages/server/src/lib/server-pipeline.ts` is the single production execution engine.

Implementation:

- Added `runManualAnalysisForMatch()` in `packages/server/src/lib/server-pipeline.ts`.
- This reuses the same server pipeline core and loads the fixture plus watchlist entry before execution.

Result:

- Satisfied.

### 2.2 Trigger modes

Design requirement:

1. Auto run through `check-live-trigger`
2. Manual single-match analysis through the same server pipeline
3. Dashboard-triggered live scan through the canonical job

Implementation:

- Auto run remains unchanged on `check-live-trigger`.
- Added `POST /api/live-monitor/matches/:matchId/analyze` in `packages/server/src/routes/live-monitor.routes.ts`.
- Added `POST /api/live-monitor/check-live/trigger` in `packages/server/src/routes/live-monitor.routes.ts`.

Result:

- Satisfied.

### 2.3 Live Monitor dashboard role

Design requirement:

- `LiveMonitorTab` must become a monitoring dashboard only.
- It must not run a browser scheduler or browser pipeline.

Implementation:

- Replaced the old tab implementation in `src/app/LiveMonitorTab.tsx`.
- The tab now polls `GET /api/live-monitor/status`.
- The tab can only refresh state and trigger the canonical server job.
- The old `useScheduler` and browser-run pipeline imports are removed from app surfaces.

Result:

- Satisfied.

### 2.4 Matches Ask AI flow

Design requirement:

- `MatchesTab` must stop using the frontend pipeline runner.
- It must use a server route and render server-owned output.

Implementation:

- Updated `src/app/MatchesTab.tsx` to call `analyzeMatchWithServerPipeline()` from `src/features/live-monitor/services/server-monitor.service.ts`.
- Result rendering now reads parsed debug output from the returned server pipeline payload.

Result:

- Satisfied.

### 2.5 Dashboard API contract

Design requirement:

1. `GET /api/live-monitor/status`
2. `POST /api/live-monitor/check-live/trigger`
3. `POST /api/live-monitor/matches/:matchId/analyze`

Implementation:

- Added all three routes in `packages/server/src/routes/live-monitor.routes.ts`.
- Registered route module in `packages/server/src/index.ts`.
- `status` parses job progress and flattens batch results for dashboard consumption.

Result:

- Satisfied.

### 2.6 Testing strategy

Design requirement:

- Add backend route tests.
- Add frontend service tests.
- Run frontend and server typechecks.

Implementation:

- Added `packages/server/src/__tests__/live-monitor.routes.test.ts`.
- Added `src/features/live-monitor/services/server-monitor.service.test.ts`.
- Ran root typecheck successfully.
- Ran server typecheck successfully.
- Ran both new targeted test files successfully.

Result:

- Satisfied.

## 3. Validation Completed

Completed checks:

1. `npm run typecheck`
2. `npm run typecheck --prefix packages/server`
3. `npm test -- --run src/features/live-monitor/services/server-monitor.service.test.ts`
4. `npm run test --prefix packages/server -- --run src/__tests__/live-monitor.routes.test.ts`

Result:

- All passed.

## 4. Residual Gaps

### 4.1 Legacy frontend pipeline code still exists

The legacy browser scheduler and browser pipeline files still exist under `src/features/live-monitor`.

Current status:

- They are no longer used by active app surfaces.
- They are still referenced by legacy tests for the old browser execution path.

Assessment:

- This is acceptable for the current safe migration pass.
- It matches the design's backward-compatibility strategy.

### 4.2 Full legacy cleanup is still a separate pass

Recommended later cleanup:

1. remove `src/features/live-monitor/useScheduler.ts`
2. remove or archive browser `scheduler.ts`
3. remove or archive frontend execution tests that no longer represent production runtime

Assessment:

- Not required to accept this refactor.

## 5. Final Acceptance Decision

Acceptance criteria status:

1. `LiveMonitorTab` no longer uses browser scheduler or browser pipeline: Pass
2. `MatchesTab` no longer uses frontend `runPipelineForMatch`: Pass
3. Manual Ask AI uses server pipeline: Pass
4. Auto live monitoring continues through `check-live-trigger`: Pass
5. Live Monitor dashboard reads server-owned job state: Pass
6. Tests and typechecks for modified surfaces pass: Pass

Final decision:

- Accepted for this refactor scope.
