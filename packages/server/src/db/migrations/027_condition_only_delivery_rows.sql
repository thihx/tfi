BEGIN;

ALTER TABLE user_recommendation_deliveries
  ALTER COLUMN recommendation_id DROP NOT NULL;

COMMIT;