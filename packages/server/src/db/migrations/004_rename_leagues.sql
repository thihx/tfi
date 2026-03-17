-- ============================================================
-- TFI PostgreSQL Schema — V004 Rename approved_leagues → leagues
-- ============================================================

BEGIN;

ALTER TABLE approved_leagues RENAME TO leagues;

ALTER INDEX idx_leagues_active  RENAME TO idx_leagues_active_new;
ALTER INDEX idx_leagues_country RENAME TO idx_leagues_country_new;

COMMIT;
