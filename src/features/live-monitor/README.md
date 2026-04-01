## Live Monitor Boundaries

This feature folder currently contains two different layers:

### Active app runtime surface

These files are part of the current app/runtime flow:

- `config.ts`
- `types.ts`
- `services/server-monitor.service.ts`

They talk to the server-side live monitor and pipeline APIs that run in `packages/server/src/`.

### Client-side simulation / legacy exploratory modules

These files are retained for local simulation, historical tests, and offline reasoning work:

- `scheduler.ts`
- `useScheduler.ts`
- `services/pipeline.ts`
- `services/ai-analysis.service.ts`
- `services/ai-prompt.service.ts`
- `services/filters.service.ts`
- `services/football-api.service.ts`
- `services/match-merger.service.ts`
- `services/notification.service.ts`
- `services/proxy.service.ts`
- `services/recommendation.service.ts`
- `services/staleness.service.ts`
- `services/watchlist.service.ts`

They are not the source of truth for the production pipeline anymore.
When changing live-monitor behavior, prefer inspecting:

1. `packages/server/src/jobs/check-live-trigger.job.ts`
2. `packages/server/src/lib/server-pipeline.ts`
3. `packages/server/src/routes/live-monitor.routes.ts`
4. `src/features/live-monitor/services/server-monitor.service.ts`

The simulator modules remain useful for tests and local experiments, but they should not be treated as the primary runtime implementation.
