-- Add Vietnamese reasoning column to recommendations
ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS reasoning_vi TEXT NOT NULL DEFAULT '';
