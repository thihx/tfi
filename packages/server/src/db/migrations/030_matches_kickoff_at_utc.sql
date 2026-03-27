BEGIN;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS kickoff_at_utc TIMESTAMPTZ;

UPDATE matches
SET kickoff_at_utc = COALESCE(
  kickoff_at_utc,
  ((date + kickoff) AT TIME ZONE current_setting('TIMEZONE'))
)
WHERE date IS NOT NULL
  AND kickoff IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_kickoff_at_utc ON matches (kickoff_at_utc);

UPDATE monitored_matches mm
SET metadata = jsonb_set(
  COALESCE(mm.metadata, '{}'::jsonb),
  '{kickoff_at_utc}',
  to_jsonb(m.kickoff_at_utc::text),
  true
)
FROM matches m
WHERE m.match_id::text = mm.match_id
  AND m.kickoff_at_utc IS NOT NULL
  AND NULLIF(mm.metadata->>'kickoff_at_utc', '') IS DISTINCT FROM m.kickoff_at_utc::text;

UPDATE monitored_matches mm
SET metadata = jsonb_set(
  COALESCE(mm.metadata, '{}'::jsonb),
  '{kickoff_at_utc}',
  to_jsonb((((NULLIF(mm.metadata->>'date', '')::date + NULLIF(mm.metadata->>'kickoff', '')::time) AT TIME ZONE current_setting('TIMEZONE'))::text)),
  true
)
WHERE NULLIF(mm.metadata->>'kickoff_at_utc', '') IS NULL
  AND NULLIF(mm.metadata->>'date', '') IS NOT NULL
  AND NULLIF(mm.metadata->>'kickoff', '') IS NOT NULL;

COMMIT;