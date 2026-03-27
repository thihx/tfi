BEGIN;

ALTER TABLE matches_history
  ADD COLUMN IF NOT EXISTS kickoff_at_utc TIMESTAMPTZ;

UPDATE matches_history
SET kickoff_at_utc = COALESCE(
  kickoff_at_utc,
  ((date + kickoff) AT TIME ZONE current_setting('TIMEZONE'))
)
WHERE date IS NOT NULL
  AND kickoff IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mh_kickoff_at_utc ON matches_history (kickoff_at_utc);

COMMIT;