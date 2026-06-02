-- Migration 056: actual user investments drive bankroll, not notification delivery alone

BEGIN;

ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS delivery_id BIGINT REFERENCES user_recommendation_deliveries(id) ON DELETE SET NULL;

ALTER TABLE user_bankroll_ledger
  ADD COLUMN IF NOT EXISTS bet_id INTEGER REFERENCES bets(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_bankroll_ledger_entry_type_check'
      AND conrelid = 'user_bankroll_ledger'::regclass
  ) THEN
    ALTER TABLE user_bankroll_ledger
      DROP CONSTRAINT user_bankroll_ledger_entry_type_check;
  END IF;
END $$;

ALTER TABLE user_bankroll_ledger
  ADD CONSTRAINT user_bankroll_ledger_entry_type_check
  CHECK (entry_type IN (
    'reset',
    'deposit',
    'withdrawal',
    'settlement',
    'bet_stake',
    'bet_payout',
    'adjustment'
  ));

CREATE INDEX IF NOT EXISTS idx_bets_user_placed
  ON bets (user_id, placed_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bets_delivery
  ON bets (delivery_id)
  WHERE delivery_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bets_user_recommendation
  ON bets (user_id, recommendation_id)
  WHERE user_id IS NOT NULL AND recommendation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_bankroll_ledger_bet
  ON user_bankroll_ledger (bet_id)
  WHERE bet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_bankroll_ledger_bet_entry
  ON user_bankroll_ledger (user_id, bet_id, entry_type)
  WHERE bet_id IS NOT NULL AND entry_type IN ('bet_stake', 'bet_payout');

COMMIT;
