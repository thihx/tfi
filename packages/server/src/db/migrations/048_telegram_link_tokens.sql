-- One-time deep-link tokens for linking Telegram chat_id to a user (t.me/bot?start=TOKEN).

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user_pending
  ON telegram_link_tokens (user_id)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_expires
  ON telegram_link_tokens (expires_at)
  WHERE consumed_at IS NULL;
