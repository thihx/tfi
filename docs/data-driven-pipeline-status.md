# Data-driven replay pipeline: progress and definition of done

This document tracks the data-driven recommendation replay workstream (coverage, batch, delta vs production, gates, segment analysis, CI). It does not replace [core-pipeline-implementation-checklist.md](./core-pipeline-implementation-checklist.md), which covers a wider scope (harness, provider sampling, live smoke, etc.).

## MVP definition of done

The MVP is **complete** when all of the following are true:

1. Scripted path from snapshot coverage through eval and production delta reporting (`data-driven:replay-batch` and standalone steps).
2. Delta metrics (`replay-vs-original`) and gates runnable in CI (`data-driven:check-gates` plus CI baselines).
3. Segment rollups (`segment-hotspots`) and segment gates (`data-driven:check-segment-gates` plus CI baselines).
4. Unit tests for gate logic (not only script exit codes).
5. CI runs server typecheck, server tests, and data-driven gate baselines; repo root exposes `verify:ci` mirroring most of that matrix.
6. `AGENTS.md` and `packages/server/src/scripts/README.md` document how to repeat the workflow.

**Per these criteria: MVP = 100%.**

## Weighted progress table

| Area | Weight | Status | Notes |
|------|--------|--------|-------|
| Coverage + batch orchestration | 20% | Done | `data-driven:coverage`, `data-driven:replay-batch` |
| Delta vs original (summary / CSV) | 15% | Done | `data-driven:summarize-vs-original` |
| Delta gates + tests | 15% | Done | `data-driven-replay-gates.ts`, `check-data-driven-replay-gates.ts`, `__tests__/data-driven-replay-gates.test.ts` |
| Segment hotspots + gates + tests | 20% | Done | segment hotspot script, `data-driven-segment-gates`, tests |
| Optional policy (blocklist / stake cap) | 10% | Done | `SEGMENT_POLICY_*_PATH`, loaders + example JSON |
| CI baseline gates + `verify:ci` | 20% | Done | `ci-baselines/data-driven-gates/`, workflow, root `verify:ci` |

**Total weight 100%: MVP progress = 100%.**

## Out of MVP scope (does not block plan completion)

| Item | Status |
|------|--------|
| Scheduled job running real batch and auto-updating baselines | Not built; add if you want automation |
| UI/dashboard for `replay-work/` outputs | Not built; product decision |
| Full core-pipeline checklist closure | See [core-pipeline-implementation-checklist.md](./core-pipeline-implementation-checklist.md) |

## Suggested next steps after MVP

1. **Process** (manual): After meaningful prompt/policy changes, run a fixed batch, compare outputs to CI baselines; update `ci-baselines/data-driven-gates/` only when you accept the new metrics.
2. **Automation shipped**: Baseline smoke workflow — `.github/workflows/data-driven-baselines-smoke.yml` (`workflow_dispatch` + weekly schedule).
3. **Encoding shipped**: `.gitattributes` on `packages/server/ci-baselines/**`; still avoid saving those JSON files as UTF-16 in editors.


## Optional automation track (post-MVP)

| Item | Status | Notes |
|------|--------|-------|
| Baseline JSON as normalized text | Done | Root `.gitattributes` → `packages/server/ci-baselines/**` uses `text eol=lf` |
| Scheduled / manual smoke for gate baselines | Done | `.github/workflows/data-driven-baselines-smoke.yml` — `workflow_dispatch` + weekly cron; runs `data-driven:verify-gates-ci` only (no DB) |

Not automated (by design): full `data-driven:replay-batch` against DB, auto-PR to refresh baselines, UI dashboard.

## Stakeholder progress summary

| Track | Scope | Progress |
|-------|-------|----------|
| **A — MVP** | Scripts, delta/segment gates, unit tests, CI on push, `verify:ci`, docs | **100%** |
| **B — Post-MVP automation** | Gitattributes + baseline smoke workflow (this section) | **100%** |

**Overall (A + B, per this document): 100%.**  
*Separate from global [core-pipeline-implementation-checklist.md](./core-pipeline-implementation-checklist.md).*

## How to read percentages for stakeholders

- **Data-driven implementation (this table):** **100%** MVP.
- **Global core pipeline hardening:** separate checklist; many items may still be open (evidence, periodic smoke).
