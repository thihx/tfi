import { query } from '../db/pool.js';

export interface AiGatewayAdminRecipient {
  userId: string;
  email: string;
  displayName: string;
  telegramEnabled: boolean;
  webPushEnabled: boolean;
  telegramChatId: string | null;
}

export interface AiGatewayIncidentRow {
  id: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  status: string;
  severity: string;
  incident_type: string;
  title: string;
  feature_key: string | null;
  operation: string | null;
  provider: string | null;
  model: string | null;
  match_id: string | null;
  run_id: string | null;
  breaker_id: number | null;
  metadata: Record<string, unknown> | null;
}

export interface AiGatewayBreakerRow {
  id: number;
  created_at: string;
  updated_at: string;
  opened_at: string;
  closed_at: string | null;
  status: string;
  scope_type: string;
  scope_key: string;
  reason: string;
  severity: string;
  opened_by: string;
  metadata: Record<string, unknown> | null;
}

export interface AiGatewayLogRow {
  id: number;
  created_at: string;
  provider: string;
  model: string;
  operation: string;
  feature_key: string;
  mode: string;
  status: string;
  decision: string;
  reason: string | null;
  severity: string;
  match_id: string | null;
  run_id: string | null;
  prompt_version: string | null;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: string | number;
  prompt_chars: number;
  response_chars: number;
  latency_ms: number | null;
  error: string | null;
}

export async function listAiGatewayAdminRecipients(): Promise<AiGatewayAdminRecipient[]> {
  const result = await query<{
    user_id: string;
    email: string;
    display_name: string;
    telegram_enabled: boolean;
    web_push_enabled: boolean;
    telegram_chat_id: string | null;
  }>(
    `SELECT u.id::text AS user_id,
            u.email,
            u.display_name,
            COALESCE(ns.telegram_enabled, FALSE) AS telegram_enabled,
            COALESCE(ns.web_push_enabled, FALSE) AS web_push_enabled,
            BTRIM(tg.address) AS telegram_chat_id
       FROM users u
       LEFT JOIN user_notification_settings ns ON ns.user_id = u.id::text
       LEFT JOIN user_notification_channel_configs tg
         ON tg.user_id = u.id
        AND tg.channel_type = 'telegram'
        AND tg.enabled = TRUE
        AND tg.status <> 'disabled'
        AND tg.address IS NOT NULL
        AND BTRIM(tg.address) <> ''
      WHERE u.status = 'active'
        AND u.role IN ('owner', 'admin')
      ORDER BY CASE u.role WHEN 'owner' THEN 0 ELSE 1 END, LOWER(u.email)`,
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    telegramEnabled: row.telegram_enabled,
    webPushEnabled: row.web_push_enabled,
    telegramChatId: row.telegram_chat_id,
  }));
}

export async function listAiGatewayIncidents(limit = 10): Promise<AiGatewayIncidentRow[]> {
  const result = await query<AiGatewayIncidentRow>(
    `SELECT i.id, i.created_at, i.updated_at, i.resolved_at, i.status, i.severity, i.incident_type, i.title,
            i.feature_key, i.operation, i.provider, i.model, i.match_id, i.run_id, i.breaker_id, i.metadata
       FROM ai_gateway_incidents i
       LEFT JOIN ai_gateway_breakers b ON b.id = i.breaker_id
      WHERE NOT (i.status = 'open' AND i.breaker_id IS NOT NULL AND b.status = 'closed')
      ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, i.created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 50)],
  );
  return result.rows;
}

export async function listAiGatewayBreakers(limit = 10): Promise<AiGatewayBreakerRow[]> {
  const result = await query<AiGatewayBreakerRow>(
    `SELECT id, created_at, updated_at, opened_at, closed_at, status, scope_type, scope_key,
            reason, severity, opened_by, metadata
       FROM ai_gateway_breakers
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 50)],
  );
  return result.rows;
}

export async function listAiGatewayLogs(limit = 20): Promise<AiGatewayLogRow[]> {
  const result = await query<AiGatewayLogRow>(
    `SELECT id, created_at, provider, model, operation, feature_key, mode, status, decision,
            reason, severity, match_id, run_id, prompt_version, estimated_input_tokens,
            estimated_output_tokens, estimated_cost_usd, prompt_chars, response_chars, latency_ms, error
       FROM ai_gateway_logs
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows;
}

export async function updateAiGatewayIncidentStatus(
  id: number,
  status: 'open' | 'acknowledged' | 'resolved',
  actor: string,
  note?: string,
): Promise<AiGatewayIncidentRow | null> {
  const result = await query<AiGatewayIncidentRow>(
    `UPDATE ai_gateway_incidents
        SET status = $2,
            updated_at = NOW(),
            resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END,
            metadata = COALESCE(metadata, '{}'::jsonb)
              || jsonb_build_object('lastActionBy', $3::text, 'lastActionNote', $4::text, 'lastActionAt', NOW())
      WHERE id = $1
      RETURNING id, created_at, updated_at, resolved_at, status, severity, incident_type, title,
                feature_key, operation, provider, model, match_id, run_id, breaker_id, metadata`,
    [id, status, actor, note ?? null],
  );
  return result.rows[0] ?? null;
}

export async function closeAiGatewayBreaker(id: number, actor: string, note?: string): Promise<AiGatewayBreakerRow | null> {
  const result = await query<AiGatewayBreakerRow>(
    `WITH closed AS (
       UPDATE ai_gateway_breakers
          SET status = 'closed',
              updated_at = NOW(),
              closed_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb)
                || jsonb_build_object('closedBy', $2::text, 'closeNote', $3::text, 'closedActionAt', NOW())
        WHERE id = $1
          AND status = 'open'
        RETURNING id, created_at, updated_at, opened_at, closed_at, status, scope_type, scope_key,
                  reason, severity, opened_by, metadata
     ),
     resolved_incidents AS (
       UPDATE ai_gateway_incidents
          SET status = 'resolved',
              updated_at = NOW(),
              resolved_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb)
                || jsonb_build_object('resolvedBy', $2::text, 'resolveNote', $3::text, 'resolvedWithBreakerClose', TRUE, 'resolvedActionAt', NOW())
        WHERE breaker_id = $1
          AND status = 'open'
          AND EXISTS (SELECT 1 FROM closed)
        RETURNING id
     )
     SELECT id, created_at, updated_at, opened_at, closed_at, status, scope_type, scope_key,
            reason, severity, opened_by, metadata
       FROM closed`,
    [id, actor, note ?? null],
  );
  return result.rows[0] ?? null;
}
