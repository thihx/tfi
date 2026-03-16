-- ============================================================
-- TFI PostgreSQL Schema — V002 Phase 1: Data Layer Upgrade
-- ============================================================
-- 1. bets — User decisions, separate from AI recommendations
-- 2. match_snapshots — Multi-point live data per match
-- 3. odds_movements — Track odds changes over time
-- 4. ai_performance — Track AI model accuracy
-- 5. Upgrade recommendations: TEXT→JSONB, better indexes
-- 6. matches_history — Archive before TRUNCATE
-- ============================================================

BEGIN;

-- ============================================================
-- 1. BETS — User betting decisions (decoupled from recommendations)
-- ============================================================
-- A bet = "I decided to place this wager based on recommendation X"
-- One recommendation can lead to 0 or 1 bet.
-- A bet can also be placed without a recommendation (manual bet).
-- ============================================================
CREATE TABLE bets (
  id                  SERIAL PRIMARY KEY,
  recommendation_id   INTEGER     REFERENCES recommendations(id),
  match_id            TEXT        NOT NULL,
  placed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- What was bet
  bet_market          TEXT        NOT NULL,       -- e.g. 'over_2.5', '1x2_home'
  selection           TEXT        NOT NULL,       -- e.g. 'Over 2.5 Goals @1.85'
  odds                NUMERIC(8,3) NOT NULL,
  stake_percent       NUMERIC(5,2) NOT NULL DEFAULT 0,
  stake_amount        NUMERIC(10,2),              -- actual money if tracked
  bookmaker           TEXT        NOT NULL DEFAULT '',

  -- Context at time of bet
  match_minute        SMALLINT,
  match_score         TEXT        NOT NULL DEFAULT '',
  match_status        TEXT        NOT NULL DEFAULT '',

  -- Settlement
  result              TEXT        NOT NULL DEFAULT '',    -- win, loss, push, void, cashout
  pnl                 NUMERIC(10,2) NOT NULL DEFAULT 0,
  settled_at          TIMESTAMPTZ,
  settled_by          TEXT        NOT NULL DEFAULT '',    -- 'auto', 'manual'
  final_score         TEXT        NOT NULL DEFAULT '',    -- FT score at settlement

  -- Meta
  notes               TEXT        NOT NULL DEFAULT '',
  created_by          TEXT        NOT NULL DEFAULT 'system'
);

CREATE INDEX idx_bets_match ON bets (match_id);
CREATE INDEX idx_bets_result ON bets (result);
CREATE INDEX idx_bets_placed ON bets (placed_at DESC);
CREATE INDEX idx_bets_recommendation ON bets (recommendation_id) WHERE recommendation_id IS NOT NULL;
CREATE INDEX idx_bets_market ON bets (bet_market);

-- ============================================================
-- 2. MATCH SNAPSHOTS — Multi-point live data capture
-- ============================================================
-- Each row = state of a match at a specific minute.
-- Allows tracking progression: stats at 55', 65', 75', etc.
-- ============================================================
CREATE TABLE match_snapshots (
  id              SERIAL PRIMARY KEY,
  match_id        TEXT        NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          TEXT        NOT NULL DEFAULT 'api',  -- 'api', 'pipeline', 'manual'

  -- Match state
  minute          SMALLINT    NOT NULL,
  status          TEXT        NOT NULL DEFAULT '',
  home_score      SMALLINT    NOT NULL DEFAULT 0,
  away_score      SMALLINT    NOT NULL DEFAULT 0,

  -- Live stats (JSONB for flexibility + queryability)
  stats           JSONB       NOT NULL DEFAULT '{}',
  -- Expected shape: { possession: {home,away}, shots: {home,away}, shots_on_target: {home,away},
  --                   corners: {home,away}, fouls: {home,away}, ... }

  -- Events since last snapshot
  events          JSONB       NOT NULL DEFAULT '[]',
  -- Array of {minute, team, type, detail, player}

  -- Odds at this point
  odds            JSONB       NOT NULL DEFAULT '{}',
  -- Shape: { "1x2": {home,draw,away}, "ou": {line,over,under}, "ah": {line,home,away}, ... }

  -- Dedup: one snapshot per match per minute
  CONSTRAINT uq_snapshot_match_minute UNIQUE (match_id, minute)
);

CREATE INDEX idx_snapshots_match ON match_snapshots (match_id);
CREATE INDEX idx_snapshots_match_time ON match_snapshots (match_id, minute);
CREATE INDEX idx_snapshots_captured ON match_snapshots (captured_at DESC);

-- ============================================================
-- 3. ODDS MOVEMENTS — Track odds changes per match per market
-- ============================================================
-- Lighter than full snapshots — specifically for odds tracking.
-- Useful for detecting market shifts, steam moves, etc.
-- ============================================================
CREATE TABLE odds_movements (
  id              SERIAL PRIMARY KEY,
  match_id        TEXT        NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_minute    SMALLINT,
  market          TEXT        NOT NULL,          -- '1x2', 'ou_2.5', 'ah_-0.5', 'btts'
  bookmaker       TEXT        NOT NULL DEFAULT 'api-football',

  -- Market values
  line            NUMERIC(6,2),                  -- e.g. 2.5 for O/U, -0.5 for AH
  price_1         NUMERIC(8,3),                  -- home / over / yes
  price_2         NUMERIC(8,3),                  -- away / under / no
  price_x         NUMERIC(8,3),                  -- draw (1x2 only)

  -- Change from previous capture
  prev_price_1    NUMERIC(8,3),
  prev_price_2    NUMERIC(8,3),

  -- Dedup: one reading per match per market per minute
  CONSTRAINT uq_odds_match_market_minute UNIQUE (match_id, market, match_minute)
);

CREATE INDEX idx_odds_match ON odds_movements (match_id);
CREATE INDEX idx_odds_match_market ON odds_movements (match_id, market);
CREATE INDEX idx_odds_captured ON odds_movements (captured_at DESC);

-- ============================================================
-- 4. AI PERFORMANCE — Track AI accuracy per model/prompt/config
-- ============================================================
CREATE TABLE ai_performance (
  id                SERIAL PRIMARY KEY,
  recommendation_id INTEGER     NOT NULL REFERENCES recommendations(id),
  bet_id            INTEGER     REFERENCES bets(id),
  match_id          TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- AI output
  ai_model          TEXT        NOT NULL DEFAULT '',
  prompt_version    TEXT        NOT NULL DEFAULT '',
  ai_confidence     SMALLINT,
  ai_should_push    BOOLEAN     NOT NULL DEFAULT FALSE,

  -- What AI predicted
  predicted_market  TEXT        NOT NULL DEFAULT '',
  predicted_selection TEXT      NOT NULL DEFAULT '',
  predicted_odds    NUMERIC(8,3),

  -- Actual outcome
  actual_result     TEXT        NOT NULL DEFAULT '',   -- win, loss, push
  actual_pnl        NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Performance flags
  was_correct       BOOLEAN,                          -- null until settled
  confidence_calibrated BOOLEAN,                      -- was confidence level appropriate?

  -- Context for analysis
  match_minute      SMALLINT,
  match_score       TEXT        NOT NULL DEFAULT '',
  league            TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX idx_aiperf_model ON ai_performance (ai_model);
CREATE INDEX idx_aiperf_market ON ai_performance (predicted_market);
CREATE INDEX idx_aiperf_correct ON ai_performance (was_correct) WHERE was_correct IS NOT NULL;
CREATE INDEX idx_aiperf_rec ON ai_performance (recommendation_id);

-- ============================================================
-- 5. MATCHES HISTORY — Archive finished matches
-- ============================================================
-- Before TRUNCATE on matches, archive FT matches here.
-- Preserves historical scores for auto-settlement.
-- ============================================================
CREATE TABLE matches_history (
  match_id       TEXT PRIMARY KEY,
  date           DATE        NOT NULL,
  kickoff        TIME        NOT NULL,
  league_id      INTEGER     NOT NULL,
  league_name    TEXT        NOT NULL DEFAULT '',
  home_team      TEXT        NOT NULL,
  away_team      TEXT        NOT NULL,
  venue          TEXT        NOT NULL DEFAULT 'TBD',
  final_status   TEXT        NOT NULL DEFAULT 'FT',
  home_score     SMALLINT    NOT NULL DEFAULT 0,
  away_score     SMALLINT    NOT NULL DEFAULT 0,
  archived_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mh_date ON matches_history (date);
CREATE INDEX idx_mh_league ON matches_history (league_id);

-- ============================================================
-- 6. UPGRADE RECOMMENDATIONS — Better types + indexes
-- ============================================================

-- Convert TEXT JSON columns to JSONB for queryability
-- Must drop default first, then alter type, then set new default
ALTER TABLE recommendations ALTER COLUMN odds_snapshot DROP DEFAULT;
ALTER TABLE recommendations ALTER COLUMN stats_snapshot DROP DEFAULT;

ALTER TABLE recommendations
  ALTER COLUMN odds_snapshot TYPE JSONB USING
    CASE WHEN odds_snapshot = '' THEN '{}'::jsonb ELSE odds_snapshot::jsonb END,
  ALTER COLUMN stats_snapshot TYPE JSONB USING
    CASE WHEN stats_snapshot = '' THEN '{}'::jsonb ELSE stats_snapshot::jsonb END;

-- Set proper defaults for JSONB columns
ALTER TABLE recommendations
  ALTER COLUMN odds_snapshot SET DEFAULT '{}'::jsonb,
  ALTER COLUMN stats_snapshot SET DEFAULT '{}'::jsonb;

-- Add prompt_version tracking
ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS prompt_version TEXT NOT NULL DEFAULT '';

-- Add compound index for better dedup checking
CREATE INDEX IF NOT EXISTS idx_rec_match_market_minute
  ON recommendations (match_id, bet_market, minute);

-- Add index for unsettled recs (auto-settle query)
CREATE INDEX IF NOT EXISTS idx_rec_unsettled
  ON recommendations (match_id)
  WHERE result = '' OR result IS NULL;

COMMIT;
