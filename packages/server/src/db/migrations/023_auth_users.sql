-- ============================================================
-- Migration 023: Internal users + auth identities
-- Establishes durable internal principals for multi-user auth.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'invited')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_users_role
  ON users (role);

CREATE INDEX IF NOT EXISTS idx_users_status
  ON users (status);

CREATE TABLE IF NOT EXISTS user_auth_identities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  provider_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user_id
  ON user_auth_identities (user_id);

COMMIT;