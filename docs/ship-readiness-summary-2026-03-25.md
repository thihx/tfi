# Ship Readiness Summary

Date: 2026-03-25

## Current Assessment

Assessment: conditionally ship-ready for the repository state validated in this session.

What is green:

- frontend lint passes
- frontend production build passes
- frontend test suite passes: 38 test files, 694 tests
- backend validation from the immediately preceding stabilization pass was green:
  - `npm run typecheck --prefix packages/server`
  - `npm run build --prefix packages/server`
  - `npm run test --prefix packages/server`

What changed in the final pass:

- `src/app/App.tsx` keeps `MatchDetailModal` lazy-loaded from the app shell
- `src/components/ui/MatchDetailModal.tsx` no longer imports `recharts` directly
- chart-heavy match-detail tabs were extracted into `src/components/ui/MatchDetailChartViews.tsx`
- `timeline` and `odds` views now load only when those tabs are actually opened

## Build Impact

Measured production-build outcome after the final modal chart split:

- main entry chunk: about `659.25 kB` -> about `238.69 kB`
- `MatchDetailModal` chunk: about `32.84 kB` -> about `20.16 kB`
- new deferred `MatchDetailChartViews` chunk: about `13.98 kB`
- shared cartesian chart chunk: about `341.86 kB` -> about `331.06 kB`
- Vite no longer emits the `Some chunks are larger than 500 kB after minification` warning

Practical effect:

- initial app load is materially smaller
- opening match detail on non-chart tabs no longer pulls chart code immediately
- chart code is now paid only when the user actually visits `timeline` or `odds`

## Validation Evidence

Latest directly confirmed commands in this pass:

- `npm run lint` -> pass
- `npm run build` -> pass
- `npm run test` -> pass

Latest confirmed frontend test result:

- test files: `38 passed`
- tests: `694 passed`
- duration: about `53.37s`

Previously confirmed backend status in the same stabilization session:

- server typecheck: pass
- server build: pass
- server tests: pass

## Residual Risks

These are the remaining cautions, not known release blockers:

1. The workspace is still dirty with many unrelated unstaged changes. The summary reflects the currently validated workspace, not a clean tagged release commit.
2. Backend was not rerun after the final chart-only frontend split because the last code change was isolated to frontend modal/chart files. That is a reasonable engineering shortcut, but it is still a shortcut.
3. Previous production-readiness docs already show that real-enrichment quality is weaker than the core analysis/save/notify path. Core engine readiness is stronger than the enrichment-as-premium-signal story.

## Recommendation

If the release goal is a runnable post-refactor version with low regression risk, the repo is in a good ship candidate state.

Release confidence is strongest for:

- canonical self-service flows
- notification/channel settings behavior
- watch subscription ownership behavior
- frontend build/test stability
- reduced frontend first-load footprint

Release confidence is weaker for:

- premium-quality enrichment expectations on real external data
- any unverified behavior inside unrelated dirty working-tree changes that were not part of the latest validation sweep