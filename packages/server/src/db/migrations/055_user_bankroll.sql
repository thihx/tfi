-- Migration 055: per-user bankroll discipline and settlement ledger

BEGIN;

CREATE TABLE IF NOT EXISTS user_bankroll_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'VND',
  unit_multiplier INTEGER NOT NULL DEFAULT 1000,
  initial_balance NUMERIC(14,2) NOT NULL DEFAULT 1000,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 1000,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_bankroll_unit_multiplier_positive CHECK (unit_multiplier > 0),
  CONSTRAINT chk_user_bankroll_initial_balance_nonnegative CHECK (initial_balance >= 0)
);

CREATE TABLE IF NOT EXISTS user_bankroll_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recommendation_id INTEGER REFERENCES recommendations(id) ON DELETE SET NULL,
  delivery_id BIGINT REFERENCES user_recommendation_deliveries(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'reset',
    'deposit',
    'withdrawal',
    'settlement'
  )),
  amount NUMERIC(14,2) NOT NULL,
  balance_before NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'VND',
  note TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_bankroll_ledger_user_created_at
  ON user_bankroll_ledger (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_bankroll_ledger_recommendation
  ON user_bankroll_ledger (recommendation_id)
  WHERE recommendation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_bankroll_ledger_settlement
  ON user_bankroll_ledger (user_id, recommendation_id, entry_type)
  WHERE recommendation_id IS NOT NULL AND entry_type = 'settlement';

COMMIT;
