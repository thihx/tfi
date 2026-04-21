BEGIN;

ALTER TABLE recommendation_releases
  ADD COLUMN IF NOT EXISTS activation_scope TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS replay_validation_status TEXT NOT NULL DEFAULT 'not_validated';

ALTER TABLE recommendation_replay_runs
  ADD COLUMN IF NOT EXISTS release_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS llm_model TEXT NOT NULL DEFAULT '';

ALTER TABLE recommendation_replay_run_items
  ADD COLUMN IF NOT EXISTS original_decision_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS replayed_decision_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evaluation_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE recommendation_release_audit_logs
  ADD COLUMN IF NOT EXISTS before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

COMMIT;
