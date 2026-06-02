-- Remove API-Football pre-match prediction storage and derived recommendation/watchlist fields.

ALTER TABLE IF EXISTS watchlist
  DROP COLUMN IF EXISTS prediction;

ALTER TABLE IF EXISTS recommendations
  DROP COLUMN IF EXISTS pre_match_prediction_summary;

DROP TABLE IF EXISTS provider_fixture_prediction_cache;
