# Profile And Settings Split

## Goal

Move user-scoped configuration out of `Settings` and into a profile entry point, while keeping system and operations controls inside `Settings`.

## Field Classification

### Profile Identity

These are part of the user's personal identity in the product:

- `display_name`
- `email` read-only
- `avatar_url` read-only for now

`display_name` is editable.
`email` and `avatar_url` remain identity-provider driven until a separate manual avatar flow exists.

### User Preferences

These are not identity fields, but they are still owned by a single user and should not live in the shared Settings area:

- `UI_LANGUAGE`
- `USER_TIMEZONE`
- `USER_TIMEZONE_CONFIRMED`
- `TELEGRAM_ENABLED`
- `WEB_PUSH_ENABLED`
- `NOTIFICATION_LANGUAGE`
- notification channel addresses and verification status
- `AUTO_APPLY_RECOMMENDED_CONDITION`

These move into `Profile Edit` under separate sections so they are not confused with identity.

### Settings Area After Split

`Settings` should only keep app-wide or ops/admin concerns:

- scheduler and job controls
- system and integration health
- audit
- user and subscription management for admins

## Backend Rules

- Add `/api/me/profile` for self-service profile reads and writes.
- Allow self-service edits only for `display_name`.
- Stop overwriting `display_name` on every Google login after the user row already exists.
- Continue refreshing `email` and `avatar_url` from the identity provider.

## Frontend Rules

- The profile dropdown becomes the entry point for `Profile Edit`.
- `Profile Edit` contains separate sections:
  - Personal info
  - Preferences
  - Notifications
  - Watchlist defaults
- `Settings` no longer exposes the self-service General tab.
