# Release Candidate Summary

Date: 2026-03-25

## Verdict

Assessment: release-candidate ready for the currently validated workspace state.

No new blocker was found in the final sweep.

## Final Validation Sweep

Validated successfully in this pass:

- `npm run lint`
- `npm run build`
- `npm run test`
- `npm run typecheck --prefix packages/server`
- `npm run build --prefix packages/server`
- `npm run test --prefix packages/server`

Confirmed results:

- frontend test files: `38 passed`
- frontend tests: `694 passed`
- backend test files: `74 passed`
- backend tests: `670 passed`

Bundle state remains consistent with the recent modal/chart split:

- main entry chunk remains about `238.69 kB`
- `MatchDetailModal` chunk remains about `20.16 kB`
- deferred `MatchDetailChartViews` chunk remains about `13.98 kB`
- oversized main-entry warning is still gone

## Dirty Worktree Review

The current working tree contains a large set of multi-user migration changes plus the recent frontend performance work.

What matters from a release-risk perspective:

1. The validated state is internally consistent. The current dirty tree builds, typechecks, and passes both frontend and backend suites.
2. The largest behavioral shifts are intentional architecture changes, not accidental drift:
   - canonical self-service APIs move toward `/api/me/*`
   - watchlist mutation now depends on canonical watch-subscription IDs
   - completed watch subscriptions are treated as temporary operational state instead of durable `expired` history
   - notification preferences and channel setup are split more explicitly between settings, notification settings, and channel registry
3. The recent frontend performance split is isolated and remains low risk after the full sweep.

## Residual Risks

These are the remaining cautions after the final sweep.

### 1. Release Process Risk

The repo is still dirty. That means release confidence applies to the full validated workspace snapshot, not to an unspecified subset of files.

If a release commit excludes part of the current tree, the validation evidence in this summary no longer applies cleanly.

### 2. Contract Compatibility Risk

The repo is now aligned around canonical `/api/me/*` self-service contracts in many areas, while some compatibility aliases still exist.

In-repo callers are covered by tests, but any external scripts, admin tooling, or deployment-time smoke checks that still assume older self-service paths or older watchlist semantics may need updating.

### 3. Watchlist Semantics Risk

`expired` is no longer treated as normal user-facing history in the watchlist flow. Completed subscriptions are cleanup targets, while durable history now lives in recommendations, recommendation deliveries, and bet records.

That is architecturally coherent, but it is still a product/ops compatibility change if anyone outside the tested UI still expects old watchlist-history behavior.

### 4. Migration Hygiene Note

The duplicate numeric prefix has been normalized in the current workspace by renumbering the channel-registry migration to `028_notification_channel_configs.sql`.

Because the server migration runner records full filenames in `_migrations`, this kind of renumbering is only safe when the SQL is idempotent. That constraint is satisfied here because the channel-registry migration uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.

This behavior was verified against the current database environment: after running migrations, `_migrations` retained the previously applied `027_notification_channel_configs.sql` row and also recorded the new `028_notification_channel_configs.sql` row, alongside `027_condition_only_delivery_rows.sql`. That confirms the replay model described above rather than leaving it as a theoretical caution.

## Recommendation

If the goal is the user's stated target of a runnable post-refactor version with minimal errors, this workspace is in RC shape now.

Recommended ship stance:

- acceptable to cut an RC from this exact validated state
- avoid partial cherry-picks from the dirty tree
- treat external contract consumers and deployment smoke checks as the main remaining verification surface