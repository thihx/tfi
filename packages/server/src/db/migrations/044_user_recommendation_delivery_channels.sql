BEGIN;

CREATE TABLE IF NOT EXISTS user_recommendation_delivery_channels (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id BIGINT NOT NULL REFERENCES user_recommendation_deliveries(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_recommendation_delivery_channels UNIQUE (delivery_id, channel_type)
);

CREATE INDEX IF NOT EXISTS idx_user_recommendation_delivery_channels_pending
  ON user_recommendation_delivery_channels (channel_type, status, delivery_id);

CREATE INDEX IF NOT EXISTS idx_user_recommendation_delivery_channels_delivery
  ON user_recommendation_delivery_channels (delivery_id, channel_type);

INSERT INTO user_recommendation_delivery_channels (
  delivery_id,
  channel_type,
  status,
  attempt_count,
  delivered_at,
  metadata,
  created_at,
  updated_at
)
SELECT
  d.id,
  delivered.channel_type,
  'delivered',
  1,
  d.delivered_at,
  '{}'::jsonb,
  d.created_at,
  NOW()
FROM user_recommendation_deliveries d
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(d.delivery_channels, '[]'::jsonb)) AS delivered(channel_type)
ON CONFLICT (delivery_id, channel_type) DO NOTHING;

INSERT INTO user_recommendation_delivery_channels (
  delivery_id,
  channel_type,
  status,
  metadata,
  created_at,
  updated_at
)
SELECT
  d.id,
  'telegram',
  'pending',
  '{}'::jsonb,
  d.created_at,
  NOW()
FROM user_recommendation_deliveries d
JOIN user_notification_channel_configs c
  ON c.user_id = d.user_id
 AND c.channel_type = 'telegram'
 AND c.enabled = TRUE
 AND c.status <> 'disabled'
 AND c.address IS NOT NULL
 AND BTRIM(c.address) <> ''
WHERE d.eligibility_status = 'eligible'
  AND d.delivery_status = 'pending'
ON CONFLICT (delivery_id, channel_type) DO NOTHING;

INSERT INTO user_recommendation_delivery_channels (
  delivery_id,
  channel_type,
  status,
  metadata,
  created_at,
  updated_at
)
SELECT
  d.id,
  'web_push',
  'pending',
  '{}'::jsonb,
  d.created_at,
  NOW()
FROM user_recommendation_deliveries d
JOIN LATERAL (
  SELECT 1
  FROM push_subscriptions ps
  WHERE ps.user_id = d.user_id::text
  LIMIT 1
) active_push ON TRUE
WHERE d.eligibility_status = 'eligible'
  AND d.delivery_status = 'pending'
ON CONFLICT (delivery_id, channel_type) DO NOTHING;

COMMIT;
