-- ============================================================
-- TFI PostgreSQL Schema — V001 Initial
-- ============================================================
-- Migrated from Google Sheets: Approved_Leagues, Matches,
-- Watchlist, Recommendations
-- ============================================================

BEGIN;

-- ============================================================
-- 1. APPROVED LEAGUES — Master data from Football API
-- ============================================================
CREATE TABLE approved_leagues (
  league_id   INTEGER PRIMARY KEY,
  league_name TEXT    NOT NULL,
  country     TEXT    NOT NULL DEFAULT '',
  tier        TEXT    NOT NULL DEFAULT '',      -- 'International','1','2','3','Cup','Other'
  active      BOOLEAN NOT NULL DEFAULT FALSE,
  type        TEXT    NOT NULL DEFAULT '',      -- 'League','Cup'
  logo        TEXT    NOT NULL DEFAULT '',
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leagues_active ON approved_leagues (active) WHERE active = TRUE;
CREATE INDEX idx_leagues_country ON approved_leagues (country);

-- ============================================================
-- 2. MATCHES — Ephemeral: today + tomorrow (full-refresh)
-- ============================================================
CREATE TABLE matches (
  match_id       TEXT PRIMARY KEY,
  date           DATE        NOT NULL,
  kickoff        TIME        NOT NULL,
  league_id      INTEGER     NOT NULL REFERENCES approved_leagues(league_id),
  league_name    TEXT        NOT NULL DEFAULT '',
  home_team      TEXT        NOT NULL,
  away_team      TEXT        NOT NULL,
  home_logo      TEXT        NOT NULL DEFAULT '',
  away_logo      TEXT        NOT NULL DEFAULT '',
  venue          TEXT        NOT NULL DEFAULT 'TBD',
  status         TEXT        NOT NULL DEFAULT 'NS',   -- NS,1H,HT,2H,FT,ET,BT,P,INT
  home_score     SMALLINT,
  away_score     SMALLINT,
  current_minute SMALLINT,
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_matches_date ON matches (date);
CREATE INDEX idx_matches_status ON matches (status);
CREATE INDEX idx_matches_league ON matches (league_id);

-- ============================================================
-- 3. WATCHLIST — User-tracked matches for live monitoring
-- ============================================================
CREATE TABLE watchlist (
  id                              SERIAL PRIMARY KEY,
  match_id                        TEXT        NOT NULL,
  date                            DATE,
  league                          TEXT        NOT NULL DEFAULT '',
  home_team                       TEXT        NOT NULL DEFAULT '',
  away_team                       TEXT        NOT NULL DEFAULT '',
  kickoff                         TIME,
  mode                            TEXT        NOT NULL DEFAULT 'B',
  prediction                      JSONB,               -- pre-match prediction JSON
  recommended_custom_condition    TEXT        NOT NULL DEFAULT '',
  recommended_condition_reason    TEXT        NOT NULL DEFAULT '',
  recommended_condition_reason_vi TEXT        NOT NULL DEFAULT '',
  recommended_condition_at        TIMESTAMPTZ,
  custom_conditions               TEXT        NOT NULL DEFAULT '',
  priority                        SMALLINT    NOT NULL DEFAULT 0,
  status                          TEXT        NOT NULL DEFAULT 'active', -- active, pause, expired
  added_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by                        TEXT        NOT NULL DEFAULT 'user',
  last_checked                    TIMESTAMPTZ,
  total_checks                    INTEGER     NOT NULL DEFAULT 0,
  recommendations_count           INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT uq_watchlist_match UNIQUE (match_id)
);

CREATE INDEX idx_watchlist_status ON watchlist (status);
CREATE INDEX idx_watchlist_date ON watchlist (date);

-- ============================================================
-- 4. RECOMMENDATIONS — AI analysis history (full log)
-- ============================================================
CREATE TABLE recommendations (
  id                            SERIAL PRIMARY KEY,
  unique_key                    TEXT        NOT NULL UNIQUE,  -- match_id + timestamp
  match_id                      TEXT        NOT NULL,
  timestamp                     TIMESTAMPTZ NOT NULL,
  league                        TEXT        NOT NULL DEFAULT '',
  home_team                     TEXT        NOT NULL DEFAULT '',
  away_team                     TEXT        NOT NULL DEFAULT '',
  status                        TEXT        NOT NULL DEFAULT '',  -- match status at time of rec
  condition_triggered_suggestion TEXT       NOT NULL DEFAULT '',
  custom_condition_raw          TEXT        NOT NULL DEFAULT '',
  execution_id                  TEXT        NOT NULL DEFAULT '',

  -- Snapshots (stored as JSON strings for flexibility)
  odds_snapshot                 TEXT        NOT NULL DEFAULT '',
  stats_snapshot                TEXT        NOT NULL DEFAULT '',
  pre_match_prediction_summary  TEXT        NOT NULL DEFAULT '',
  custom_condition_matched      BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Match context
  minute                        SMALLINT,
  score                         TEXT        NOT NULL DEFAULT '',

  -- Bet recommendation
  bet_type                      TEXT        NOT NULL DEFAULT '',
  selection                     TEXT        NOT NULL DEFAULT '',
  odds                          NUMERIC(8,3),
  confidence                    SMALLINT,            -- 0-10
  value_percent                 NUMERIC(6,2),
  risk_level                    TEXT        NOT NULL DEFAULT 'HIGH',  -- LOW, MEDIUM, HIGH
  stake_percent                 NUMERIC(5,2),
  stake_amount                  NUMERIC(10,2),
  reasoning                     TEXT        NOT NULL DEFAULT '',
  key_factors                   TEXT        NOT NULL DEFAULT '',
  warnings                      TEXT        NOT NULL DEFAULT '',  -- JSON array as string
  ai_model                      TEXT        NOT NULL DEFAULT '',
  mode                          TEXT        NOT NULL DEFAULT 'B',
  bet_market                    TEXT        NOT NULL DEFAULT '',

  -- Notification
  notified                      TEXT        NOT NULL DEFAULT '',   -- 'yes'/'no'
  notification_channels         TEXT        NOT NULL DEFAULT '',   -- 'email,telegram'

  -- Settlement
  result                        TEXT        NOT NULL DEFAULT '',   -- win, loss, push, duplicate
  actual_outcome                TEXT        NOT NULL DEFAULT '',
  pnl                           NUMERIC(10,2) NOT NULL DEFAULT 0,
  settled_at                    TIMESTAMPTZ,
  _was_overridden               BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_rec_match_id ON recommendations (match_id);
CREATE INDEX idx_rec_timestamp ON recommendations (timestamp);
CREATE INDEX idx_rec_result ON recommendations (result);
CREATE INDEX idx_rec_match_time ON recommendations (match_id, timestamp DESC);

-- ============================================================
-- 5. PIPELINE RUNS — Track scheduler executions
-- ============================================================
CREATE TABLE pipeline_runs (
  id            SERIAL PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  triggered_by  TEXT        NOT NULL DEFAULT 'manual',  -- manual, scheduled, webhook
  status        TEXT        NOT NULL DEFAULT 'running',  -- running, complete, error
  matches_count INTEGER     NOT NULL DEFAULT 0,
  analyzed      INTEGER     NOT NULL DEFAULT 0,
  notified      INTEGER     NOT NULL DEFAULT 0,
  saved         INTEGER     NOT NULL DEFAULT 0,
  error         TEXT
);

CREATE INDEX idx_pipeline_runs_started ON pipeline_runs (started_at DESC);

COMMIT;
