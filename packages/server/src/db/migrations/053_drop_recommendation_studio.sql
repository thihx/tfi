-- Remove Recommendation Studio tables (feature removed from application runtime).
-- Depends on 050_recommendation_studio.sql and 051_recommendation_studio_hardening.sql.

BEGIN;

DROP TABLE IF EXISTS recommendation_replay_run_items;
DROP TABLE IF EXISTS recommendation_replay_runs;
DROP TABLE IF EXISTS recommendation_release_audit_logs;
DROP TABLE IF EXISTS recommendation_releases;
DROP TABLE IF EXISTS recommendation_rules;
DROP TABLE IF EXISTS recommendation_prompt_sections;
DROP TABLE IF EXISTS recommendation_rule_sets;
DROP TABLE IF EXISTS recommendation_prompt_templates;

COMMIT;
