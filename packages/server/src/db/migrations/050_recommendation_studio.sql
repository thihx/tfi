BEGIN;

CREATE TABLE IF NOT EXISTS recommendation_prompt_templates (
  id BIGSERIAL PRIMARY KEY,
  template_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  base_prompt_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  advanced_appendix TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_prompt_sections (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES recommendation_prompt_templates(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  label TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_prompt_sections_template
  ON recommendation_prompt_sections (template_id, sort_order, id);

CREATE TABLE IF NOT EXISTS recommendation_rule_sets (
  id BIGSERIAL PRIMARY KEY,
  rule_set_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_rules (
  id BIGSERIAL PRIMARY KEY,
  rule_set_id BIGINT NOT NULL REFERENCES recommendation_rule_sets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stage TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_rules_rule_set
  ON recommendation_rules (rule_set_id, enabled, priority, id);

CREATE TABLE IF NOT EXISTS recommendation_releases (
  id BIGSERIAL PRIMARY KEY,
  release_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  prompt_template_id BIGINT NOT NULL REFERENCES recommendation_prompt_templates(id) ON DELETE RESTRICT,
  rule_set_id BIGINT NOT NULL REFERENCES recommendation_rule_sets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ NULL,
  rollback_of_release_id BIGINT NULL REFERENCES recommendation_releases(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_releases_single_active
  ON recommendation_releases (is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_recommendation_releases_status
  ON recommendation_releases (status, created_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_replay_runs (
  id BIGSERIAL PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  release_id BIGINT NULL REFERENCES recommendation_releases(id) ON DELETE SET NULL,
  prompt_template_id BIGINT NOT NULL REFERENCES recommendation_prompt_templates(id) ON DELETE RESTRICT,
  rule_set_id BIGINT NOT NULL REFERENCES recommendation_rule_sets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued',
  source_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  llm_mode TEXT NOT NULL DEFAULT 'real',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_recommendation_replay_runs_created
  ON recommendation_replay_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_replay_run_items (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES recommendation_replay_runs(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  recommendation_id BIGINT NULL,
  snapshot_id BIGINT NULL,
  match_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_recommendation_replay_run_items_run
  ON recommendation_replay_run_items (run_id, id);

CREATE TABLE IF NOT EXISTS recommendation_release_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_release_audit_logs_entity
  ON recommendation_release_audit_logs (entity_type, entity_id, created_at DESC);

COMMIT;
