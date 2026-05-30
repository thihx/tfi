# TFI UI redesign audit

**Status:** Phases 0-5 complete, including Match Hub modal and mobile modal polish.

## Rollout order

| Phase | Scope | Status |
|-------|--------|--------|
| 0-5 | See prior phases | done |
| Follow-up | Match Hub / Match Detail (same component), modal responsive ~768px | done |

## Match Hub

- `MatchDetailModal` re-exports `MatchHubModal` (single implementation)
- CSS: `.match-hub-notice-banner`, mobile tab row scroll, bets table horizontal scroll, `.modal--xl` full width on narrow viewports
- Loading states use `.loading-panel`

## Validate

- Open match hub from Matches / Watchlist at 375px and 768px
- Tab row scrolls horizontally; refresh stays reachable
- Finished-match notice banner readable

## Changelog

- 2026-05-30: Phases 0-5 + modal follow-up + Match Hub responsive