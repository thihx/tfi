ALTER TABLE watchlist
ADD COLUMN IF NOT EXISTS auto_apply_recommended_condition boolean NOT NULL DEFAULT true;
