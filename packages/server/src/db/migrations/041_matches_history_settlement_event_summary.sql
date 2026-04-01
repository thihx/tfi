-- Migration 041: persist compact goal timeline summary for finished matches

ALTER TABLE matches_history
  ADD COLUMN IF NOT EXISTS settlement_event_summary JSONB;
