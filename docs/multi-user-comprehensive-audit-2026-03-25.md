# Multi-User Comprehensive Audit

Date: 2026-03-25

## Scope

This audit reviews the current repository state after the large single-user to multi-user refactor.

Focus areas reviewed:

- auth principal propagation
- self-service user-owned routes
- watch subscription ownership and lifecycle
- notification and delivery fan-out behavior
- favorite-team auto-add behavior
- shared versus user-owned data boundaries
- transitional schema and route compatibility

This report is based on static code review of the current workspace state and existing tests/docs. It is intended to be used as a finding-oriented engineering review so another developer can validate or dispute each item from primary evidence.

## Method

Reviewed sources included:

- target design and conformance documents under `docs/`
- backend routes, repositories, jobs, and pipeline code under `packages/server/src/`
- frontend state and settings UX where it affects multi-user semantics under `src/`
- relevant backend/frontend tests already present in the repo

## Findings

### Finding 1

Severity: High

Title: Any authenticated user can mutate or delete shared team profiles

#### Why this matters

`team_profiles` behave as shared analysis inputs, not per-user private data. If any authenticated member can update or delete them, one user can alter the prompt context and analytical behavior seen by other users.

This is a direct multi-user isolation failure at the authorization layer.

#### Evidence

The route file exposes team-profile endpoints without `requireCurrentUser` or `requireAdminOrOwner` checks on the handler paths themselves:

- [packages/server/src/routes/team-profiles.routes.ts](packages/server/src/routes/team-profiles.routes.ts#L103)
- [packages/server/src/routes/team-profiles.routes.ts](packages/server/src/routes/team-profiles.routes.ts#L109)
- [packages/server/src/routes/team-profiles.routes.ts](packages/server/src/routes/team-profiles.routes.ts#L113)
- [packages/server/src/routes/team-profiles.routes.ts](packages/server/src/routes/team-profiles.routes.ts#L117)

The global JWT hook only authenticates the caller and attaches `req.currentUser`; it does not apply route-specific authorization automatically:

- [packages/server/src/index.ts](packages/server/src/index.ts#L129)

By comparison, user-owned routes such as favorites explicitly enforce current-user scoping:

- [packages/server/src/routes/favorite-teams.routes.ts](packages/server/src/routes/favorite-teams.routes.ts#L15)
- [packages/server/src/routes/favorite-teams.routes.ts](packages/server/src/routes/favorite-teams.routes.ts#L24)
- [packages/server/src/routes/favorite-teams.routes.ts](packages/server/src/routes/favorite-teams.routes.ts#L36)

Existing tests currently normalize this unsafe behavior instead of catching it. The team-profile route tests build the app without any authenticated user context and still expect `200` success on read/write/delete:

- [packages/server/src/__tests__/team-profiles.routes.test.ts](packages/server/src/__tests__/team-profiles.routes.test.ts#L42)
- [packages/server/src/__tests__/team-profiles.routes.test.ts](packages/server/src/__tests__/team-profiles.routes.test.ts#L58)
- [packages/server/src/__tests__/team-profiles.routes.test.ts](packages/server/src/__tests__/team-profiles.routes.test.ts#L93)
- [packages/server/src/__tests__/team-profiles.routes.test.ts](packages/server/src/__tests__/team-profiles.routes.test.ts#L101)

#### Impact

- any logged-in member can overwrite shared profile assumptions for a team
- any logged-in member can delete shared team profile state
- downstream recommendation quality and prompt behavior can be influenced by unauthorized users
- current test coverage gives false confidence because it encodes the insecure behavior as passing

#### Validation path

1. Authenticate as a non-admin member.
2. Call `PUT /api/me/favorite-teams/:teamId/profile` for a team not owned or curated by that user.
3. Observe that the route accepts the request and writes the profile.
4. Repeat with `DELETE`.

#### Assessment

This finding is valid unless the product intentionally allows every authenticated member to curate global team profiles, which would still conflict with the rest of the multi-user ownership model and should be documented explicitly.

### Finding 2

Severity: Medium

Title: Favorite-team auto-add ignores each user's own AUTO_APPLY_RECOMMENDED_CONDITION setting

#### Why this matters

`AUTO_APPLY_RECOMMENDED_CONDITION` is treated elsewhere as a user-owned self-service setting. It directly affects delivery eligibility behavior because subscriptions with auto-apply enabled move into the immediately eligible path.

If favorite-team auto-add uses one shared setting value for all users, then subscriptions generated for different users will not reflect their own preference.

#### Evidence

Manual self-service watch creation correctly reads the setting from the authenticated user:

- [packages/server/src/routes/watchlist.routes.ts](packages/server/src/routes/watchlist.routes.ts#L34)

But the favorite-team auto-add logic in `fetch-matches.job.ts` reads settings once using the default/shared settings read and then reuses that single value for all auto-created user subscriptions:

- [packages/server/src/jobs/fetch-matches.job.ts](packages/server/src/jobs/fetch-matches.job.ts#L304)
- [packages/server/src/jobs/fetch-matches.job.ts](packages/server/src/jobs/fetch-matches.job.ts#L414)

The same shared `autoApplyRecommendedCondition` variable is applied to all `favorite-team-auto` rows regardless of which user the row is being created for.

Existing test coverage currently asserts this shared behavior rather than flagging it as incorrect:

- [packages/server/src/__tests__/fetch-matches.job.test.ts](packages/server/src/__tests__/fetch-matches.job.test.ts#L437)
- [packages/server/src/__tests__/fetch-matches.job.test.ts](packages/server/src/__tests__/fetch-matches.job.test.ts#L453)

#### Impact

- user A and user B can receive favorite-team auto-added subscriptions with the same auto-apply behavior even when their personal settings differ
- delivery staging semantics can become incorrect for auto-added subscriptions
- notification behavior can drift from what the user configured in settings
- current tests can conceal the regression because they lock the shared behavior in place

#### Validation path

1. Create two users with different `AUTO_APPLY_RECOMMENDED_CONDITION` values.
2. Make both users favorite the same team.
3. Let `fetch-matches` auto-add a new `NS` match for that team.
4. Inspect `user_watch_subscriptions.auto_apply_recommended_condition` for both users.
5. The current implementation will use the shared value instead of per-user values.

#### Assessment

This is a valid multi-user behavioral regression. It does not necessarily leak data across users, but it violates user-owned preference semantics.

### Finding 3

Severity: Medium

Title: Team-profile data model was not fully reconciled after favorite_teams became per-user

#### Why this matters

Before the refactor, `team_profiles` was modeled as 1:1 with `favorite_teams(team_id)`. After `favorite_teams` became keyed by `(user_id, team_id)`, that assumption no longer holds.

If the old relation is partially removed but query logic still joins through `favorite_teams` by `team_id` only, list endpoints can duplicate rows and integrity guarantees disappear.

#### Evidence

Original schema tied `team_profiles.team_id` directly to `favorite_teams(team_id)`:

- [packages/server/src/db/migrations/019_team_profiles.sql](packages/server/src/db/migrations/019_team_profiles.sql#L8)

Migration 024 drops the team-profile foreign key, then changes `favorite_teams` primary key to `(user_id, team_id)`, but does not replace the old 1:1 constraint with a new ownership-independent relation:

- [packages/server/src/db/migrations/024_user_owned_settings_push_favorites.sql](packages/server/src/db/migrations/024_user_owned_settings_push_favorites.sql#L47)
- [packages/server/src/db/migrations/024_user_owned_settings_push_favorites.sql](packages/server/src/db/migrations/024_user_owned_settings_push_favorites.sql#L53)
- [packages/server/src/db/migrations/024_user_owned_settings_push_favorites.sql](packages/server/src/db/migrations/024_user_owned_settings_push_favorites.sql#L59)

The current list query still joins `team_profiles` to `favorite_teams` by `team_id` only:

- [packages/server/src/repos/team-profiles.repo.ts](packages/server/src/repos/team-profiles.repo.ts#L54)

#### Consequences of the current shape

- if multiple users favorite the same team, the same profile can appear multiple times in the list response
- if the last favorite row disappears, a team profile can remain orphaned in `team_profiles`
- the previous cascade-delete semantics no longer exist
- the current query shape makes the output depend on user favorite rows even though profiles appear to be shared artifacts

#### Validation path

1. Insert one `team_profiles` row for a team.
2. Insert two `favorite_teams` rows for that same `team_id` under two different users.
3. Call the list route backed by `getAllTeamProfiles()`.
4. Observe duplicate rows for the same profile.

#### Assessment

This is a valid schema/query drift issue caused by the multi-user refactor. Whether it becomes user-visible depends on how widely `/api/team-profiles` is consumed, but the model itself is inconsistent now.

## Secondary Notes

The following were reviewed and did not rise to confirmed blocker findings in this pass:

- self-service watch-subscription routes do use user-scoped repo calls
- web-push pipeline fan-out does filter by eligible user ids before sending
- notification channel `pending` semantics currently appear intentional in code/tests even though the future design remains transitional

## Testing Gaps

These are not counted above as code findings, but they materially reduce confidence:

1. There is no meaningful end-to-end two-user isolation scenario covering favorite-team auto-add, watch subscriptions, and delivery behavior together.
2. Team-profile tests currently reinforce insecure route behavior instead of asserting authentication and authorization requirements.
3. The repository lacks a test demonstrating list behavior when multiple users favorite the same team and a shared team profile exists.

## Recommended Follow-Up

1. Lock down team-profile routes with explicit authorization rules and update tests accordingly.
2. Decide and document whether team profiles are shared admin-curated artifacts or user-owned artifacts.
3. Refactor favorite-team auto-add to resolve `AUTO_APPLY_RECOMMENDED_CONDITION` per user, not once globally.
4. Redesign the team-profile persistence relationship so it no longer depends on user favorite rows for identity or listing.
