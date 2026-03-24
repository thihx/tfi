# Live Monitor Unification Design

Date: 2026-03-24

## 1. Problem Statement

The current system contains two live-monitor execution paths:

1. A frontend pipeline and scheduler under `src/features/live-monitor`.
2. A server-side auto pipeline triggered by `check-live-trigger`.

This creates four concrete problems:

1. Decision drift: frontend and backend do not share the same save/push behavior.
2. Cost duplication: the frontend fetches live data, then asks the server to rebuild prompt context again.
3. Operational ambiguity: users can control a browser scheduler that is not the production source of truth.
4. Test fragmentation: frontend has deeper condition-trigger tests than the production server path.

## 2. Target Outcome

The system must have exactly one execution engine for live analysis:

- The server pipeline is the only production execution engine.
- Auto-run, manual single-match analysis, and future replay modes all use the same server core.
- The `Live Monitor` tab becomes a monitoring dashboard and control surface only.

In short:

- One engine
- Multiple triggers
- One decision contract
- One persistence path

## 3. Scope

This refactor includes:

1. Remove frontend execution responsibility from `LiveMonitorTab`.
2. Move manual single-match Ask AI flow to the server pipeline.
3. Add a server-facing dashboard API for Live Monitor status/results.
4. Keep monitor configuration in existing settings storage.
5. Preserve existing server scheduler job `check-live-trigger` as the auto-run source.

This refactor does not include:

1. Rewriting the core decision logic of `server-pipeline.ts`.
2. Removing all legacy frontend live-monitor files in this pass.
3. Reworking Telegram/email policy beyond what is needed for pipeline unification.

## 4. Architectural Decision

### 4.1 Canonical Execution Engine

The canonical engine is:

- `packages/server/src/lib/server-pipeline.ts`

All execution flows must use this engine directly or through a thin server route.

### 4.2 Trigger Modes

The following trigger modes are supported:

1. Auto run
   - Triggered by job `check-live-trigger`
   - Uses scheduler-managed cadence

2. Manual single-match analysis
   - Triggered from UI Ask AI buttons
   - Calls the same server pipeline core for one match
   - Bypasses staleness gate so the user gets a fresh answer
   - Uses force-analyze semantics where necessary for debugging/operator workflows

3. Dashboard-triggered live scan
   - Triggered from Live Monitor tab
   - Calls the existing `check-live-trigger` job through server job management

### 4.3 Live Monitor UI Role

The `Live Monitor` tab is redefined as:

- a monitoring dashboard
- a read model over job status and most recent run results
- a manual trigger surface for `check-live-trigger`

It is not:

- a pipeline runner
- a second scheduler
- a separate source of truth for analysis logic

## 5. Data Flow

### 5.1 Auto Run

1. Scheduler runs `check-live-trigger`
2. `check-live-trigger` identifies candidate live matches
3. `runPipelineBatch()` analyzes each candidate using server pipeline
4. Job progress/result is stored via existing job-progress infrastructure
5. Live Monitor dashboard polls server status and renders the latest result set

### 5.2 Manual Single Match

1. User clicks `Ask AI` in Matches tab
2. Frontend calls a server route dedicated to manual single-match analysis
3. Server loads fixture + watchlist entry
4. Server executes the same core pipeline for one match
5. Server returns a structured result payload to the frontend
6. Frontend renders the result panel from server-owned output

### 5.3 Dashboard Monitoring

1. Frontend calls a new `GET /api/live-monitor/status`
2. Server reads `check-live-trigger` job state via scheduler
3. Server parses the latest job progress/result JSON
4. Server returns dashboard-friendly data:
   - job state
   - progress
   - latest summary
   - flattened match results

## 6. API Design

### 6.1 GET `/api/live-monitor/status`

Purpose:

- Return the current operational view of the canonical live-monitor engine.

Response shape:

```ts
interface LiveMonitorStatusResponse {
  job: {
    name: 'check-live-trigger';
    intervalMs: number;
    enabled: boolean;
    running: boolean;
    lastRun: string | null;
    lastError: string | null;
    runCount: number;
  };
  progress: {
    step: string;
    message: string;
    percent: number;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
  summary: {
    liveCount: number;
    candidateCount: number;
    processed: number;
    pushed: number;
    errors: number;
  } | null;
  results: MatchPipelineResult[];
}
```

Behavior rules:

1. `results` are flattened from the latest completed `check-live-trigger` result payload.
2. If no completed payload exists, `summary` is null and `results` is empty.
3. `progress` mirrors the current in-flight job progress if available.

### 6.2 POST `/api/live-monitor/check-live/trigger`

Purpose:

- Manually trigger the canonical auto-run job.

Behavior rules:

1. Wrap existing `triggerJob('check-live-trigger')`.
2. Return 409 when already running.
3. Return 404 only if job registration is missing.

### 6.3 POST `/api/live-monitor/matches/:matchId/analyze`

Purpose:

- Run manual single-match analysis using the canonical server pipeline.

Response shape:

```ts
interface LiveMonitorManualAnalyzeResponse {
  result: MatchPipelineResult;
}
```

Behavior rules:

1. The route must use the same server pipeline core, not the deprecated frontend pipeline.
2. The route bypasses stale gating for operator/manual use.
3. The route returns structured pipeline result data, including parsed debug payload when available.

## 7. Frontend Design

### 7.1 Live Monitor Tab

The tab will display:

1. Engine status
   - enabled/disabled
   - running/idle
   - interval
   - last run
   - run count

2. Current progress
   - stage
   - message
   - percent

3. Latest run summary
   - live count
   - candidate count
   - processed
   - pushed
   - errors

4. Latest match results
   - selection
   - confidence
   - save/notified flags
   - warnings/reasoning when available

The tab will not:

1. hold a local scheduler state machine
2. run the pipeline in the browser
3. own live-monitor config editing

Configuration remains in Settings.

### 7.2 Matches Tab Ask AI

The Ask AI button will:

1. call the new manual-analysis server route
2. cache and display the returned server result
3. stop importing or using the frontend pipeline runner

## 8. Backward Compatibility Strategy

This pass intentionally keeps legacy frontend pipeline files in place but unused.

Reason:

1. minimize blast radius
2. make rollback simpler
3. reduce refactor scope to runtime ownership and API flow first

Expected follow-up cleanup after stabilization:

1. remove `useScheduler.ts`
2. remove browser `scheduler.ts`
3. remove or archive frontend pipeline execution path

## 9. Testing Strategy

### 9.1 Backend

Add route tests for:

1. `GET /api/live-monitor/status`
2. `POST /api/live-monitor/check-live/trigger`
3. `POST /api/live-monitor/matches/:matchId/analyze`

### 9.2 Frontend

Add unit tests for:

1. client API wrapper for live-monitor dashboard/analyze calls
2. result adaptation/parsing utilities used by Live Monitor tab and Matches tab

### 9.3 Validation

Run at minimum:

1. frontend targeted tests
2. server targeted tests
3. frontend typecheck
4. server typecheck

## 10. Acceptance Criteria

The refactor is accepted when all of the following are true:

1. `LiveMonitorTab` no longer imports or uses browser scheduler/pipeline execution.
2. `MatchesTab` no longer imports or calls the frontend pipeline runner.
3. Manual Ask AI uses server pipeline and returns structured result data.
4. Auto live monitoring continues to run through `check-live-trigger`.
5. Live Monitor dashboard renders status/results from server-owned job data.
6. Tests and typechecks pass for the modified surfaces.

## 11. Implementation Notes

To keep the refactor safe, the preferred order is:

1. add server routes
2. add frontend client service
3. swap Matches tab Ask AI to new service
4. replace Live Monitor tab with server dashboard
5. add tests
6. validate
