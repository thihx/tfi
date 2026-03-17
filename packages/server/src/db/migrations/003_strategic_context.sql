-- Migration 003: Add strategic_context to watchlist
-- Stores pre-match strategic intelligence from Google Search grounding
-- (team motivation, fixture congestion, squad rotation, etc.)

ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS strategic_context JSONB;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS strategic_context_at TIMESTAMPTZ;
