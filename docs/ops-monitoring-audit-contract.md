# Ops Monitoring Audit Contract

Updated: 2026-06-06

## Scope

This contract covers the Settings > System > Ops Monitoring screen and its backend source:

- Frontend: `src/components/OpsMonitoringPanel.tsx`
- API: `GET /api/ops/overview`
- Backend snapshot builder: `packages/server/src/repos/ops-monitoring.repo.ts`

The screen is an operator control surface. It must separate true runtime risk from idle/no-workload states, and it must surface the most actionable reasons first.

## Runtime Snapshot Used For This Audit

Snapshot generated at `2026-06-06T04:15:16.258Z` (`2026-06-06 13:15 KST`):

- Pipeline: enabled
- Active watch: `0`
- Live watch: `0`
- Pipeline activity last 2h: `0`
- Pipeline analyzed rows 24h: `6`
- Provider samples last 6h: stats `0`, odds `0`
- Provider samples last 24h: stats `49`, odds `22`
- Latest pipeline complete: `2026-06-06 01:51 KST`
- Job failures 24h: `1` for `fetch-matches`; latest `fetch-matches` run recovered with status `success` at `2026-06-06 13:14 KST`
- Decision funnel 24h: `100` live detected, `49` processed, `22` provider-ready, `6` LLM completed, `0` saved
- LLM blocked 24h: `16`, reason `auto_llm_cooldown_active`
- Prematch high-noise: `6/6` analyzed rows, `100%`
- AI gateway: mode `observe`, `3` open breakers, `5` open incidents, `1` failed call, estimated cost `0.0134`
- Settlement backlog: `0`
- Telegram attempts: `0`, stale pending: `0`

## Findings

### OM-001: Provider sampling false critical

Current behavior treats provider samples as expected when `pipelineEnabled && (liveWatchCount > 0 || analyzed24h > 0)`.

This is wrong because old analyzed rows inside a 24h window do not prove current provider workload. In the audited snapshot there are no active or live watched matches and no pipeline activity in the last 2h, yet stats and odds are shown as critical missing samples.

Contract:

- Provider samples are expected only when the pipeline is enabled and there is current/recent provider workload.
- Current/recent provider workload is true when `liveWatchCount > 0` or `activityLast2h > 0`.
- If there are no samples and no current/recent workload, stats/odds status must be `unknown`, label must be coverage idle, and cards must not be red.
- The detail must not say samples are missing when the state is idle.

### OM-002: Job failure signal lacks recovery context

The screen says `1 job failure event(s) in last 24h`, but the current job history shows `fetch-matches` recovered and is now succeeding.

Contract:

- Job failure status keeps the 24h event count.
- Detail must include whether affected jobs are currently failing or have recovered.
- Recovered limited failures remain `warn`, not `fail`.
- Current repeated failures remain `fail`.

### OM-003: Real quality/operational causes are buried as cards

The audited screen has real non-idle risks:

- Prematch high-noise `100%`
- Actionable funnel `0/100` live detected saved
- LLM cooldown blocks `16`
- AI gateway open breakers/incidents

These are cards, but top operational causes are driven only by checklist items. The false provider critical therefore crowds out the real issues.

Contract:

- Backend checklist must include operational quality items for:
  - prematch high-noise rate
  - actionable funnel save rate
  - LLM block pressure
  - AI gateway open issues
- These items must use the same pass/warn/fail/unknown model as existing checklist rows.
- The first three top causes must be the most severe checklist items after sorting.

### OM-004: Idle states need precise operator wording

Idle is not healthy, but it is also not critical. Operator wording should distinguish:

- disabled sampling
- no current live provider workload
- no recent pipeline activity
- missing provider samples under active workload

Contract:

- Idle provider checks say `coverage is idle`.
- Missing provider samples under live/recent workload say `samples are missing`.
- Pipeline idle remains `unknown` when there is no live workload.

## Signal Thresholds

Provider coverage:

- `fail`: zero samples while provider workload is expected
- `unknown`: zero samples and no provider workload expected
- stats success `pass >= 75%`, `warn >= 55%`, otherwise `fail`
- odds usable and canonical tradable `pass >= 70%`, `warn >= 50%`, otherwise `fail`

Job failures:

- `pass`: zero failures in 24h
- `warn`: failures are limited (`<= 3`) or recovered
- `fail`: more than `3` failure events, or currently failing jobs with repeated failures

Prematch high-noise:

- `unknown`: no analyzed rows
- `pass`: `<= 10%`
- `warn`: `<= 25%`
- `fail`: `> 25%`

Actionable funnel:

- `unknown`: no live detected rows
- `pass`: at least one saved recommendation
- `warn`: live detected rows exist but saved recommendations are `0`

LLM block pressure:

- `pass`: `0` blocked calls
- `warn`: blocked calls exist while at least one LLM call still completed
- `fail`: blocked calls exist and no LLM calls completed

AI gateway:

- `pass`: no failed/blocked calls and no open breakers/incidents
- `warn`: open breakers/incidents or failed calls in observe mode
- `fail`: blocked calls in enforce/block mode or open incidents with blocked calls

## Acceptance Criteria

1. With `pipelineEnabled=true`, `activityLast2h=0`, `liveWatchCount=0`, `analyzed24h>0`, and zero provider samples:
   - `workload.providerSamplesExpected=false`
   - stats checklist status is `unknown`
   - odds checklist status is `unknown`
   - stats/odds cards are not `fail`

2. With live workload and zero provider samples:
   - `workload.providerSamplesExpected=true`
   - stats/odds checklist status is `fail`
   - labels say samples are missing

3. With a recovered job failure:
   - job checklist status is `warn`
   - detail includes recovered/currently failing context

4. With prematch high-noise above 25%:
   - checklist includes `prematch-high-noise`
   - status is `fail`

5. With live detected rows but zero saved recommendations:
   - checklist includes `actionable-funnel`
   - status is `warn`

6. With LLM blocks and completed calls:
   - checklist includes `llm-block-pressure`
   - status is `warn`

7. With open AI gateway breakers/incidents:
   - checklist includes `ai-gateway-health`
   - status is at least `warn`

## Tests

Backend unit tests must lock:

- provider idle is not critical when only stale 24h analyzed rows exist
- provider gaps fail under live workload
- recovered job failures include recovery context
- prematch high-noise, actionable funnel, LLM block, and AI gateway checklist statuses
- `getOpsMonitoringSnapshot()` maps `providerSamplesExpected` using live/recent workload, not stale analyzed rows

Frontend tests must keep:

- health banner driven by sorted checklist statuses
- top operational causes shown from checklist rows

## Non-Goals

- This contract does not change job scheduling intervals.
- This contract does not change recommendation policy, prompt behavior, or AI gateway enforcement.
- This contract does not directly fix provider/API data freshness on Matches; it fixes the System screen signal semantics and operator visibility.
