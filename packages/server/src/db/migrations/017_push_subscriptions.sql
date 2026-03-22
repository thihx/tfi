-- ============================================================
-- Migration 017: push_subscriptions
-- Stores Web Push API subscriptions for browser notifications.
-- One row per browser/device subscription endpoint.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions (endpoint);
