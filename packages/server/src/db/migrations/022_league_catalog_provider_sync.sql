BEGIN;

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS provider_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leagues_provider_synced_at
  ON leagues (provider_synced_at);

COMMIT;