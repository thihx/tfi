import { query } from '../db/pool.js';
import { deleteSubscription, getSubscriptionsByUserId } from './push-subscriptions.repo.js';
import { deleteNativePushDeviceByToken, getNativePushDevicesByUserId } from './native-push-devices.repo.js';
import type { MatchAlertEvaluationResult } from '../lib/match-alert-rule-engine.js';
import type { MatchAlertRule } from './match-alert-rules.repo.js';
import type { MatchAlertContext } from '../lib/match-alert-rule-engine.js';
import { isWebPushConfigured, sendWebPushNotification, type PushPayload } from '../lib/web-push.js';
import { sendFcmNotification } from '../lib/native-push.js';
import { sendSmsNotification, sendVoiceNotification } from '../lib/twilio.js';
import type { StatsOnlyLiveSignalResult } from '../lib/stats-only-live-signal.js';
import { evaluateCriticalFallbackPolicy } from '../lib/critical-fallback-policy.js';

export interface MatchAlertDelivery {
  id: number;
  ruleId: number;
  userId: string;
  matchId: string;
  alertKind: string;
  triggerKey: string;
  triggerSnapshot: Record<string, unknown>;
  deliveryStatus: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface MatchAlertDeliveryRow {
  id: number;
  rule_id: number;
  user_id: string;
  match_id: string;
  alert_kind: string;
  trigger_key: string;
  trigger_snapshot: Record<string, unknown> | null;
  delivery_status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface PendingWebPushRow {
  channel_id: number;
  delivery_id: number;
  user_id: string;
  match_id: string;
  alert_kind: string;
  trigger_key: string;
  trigger_snapshot: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

interface PendingNativePushRow extends PendingWebPushRow {}

interface PendingFallbackRow extends PendingWebPushRow {
  address: string;
  channel_type: 'sms' | 'voice_call';
}

export interface PendingTelegramMatchAlertRow {
  channelId: number;
  deliveryId: number;
  userId: string;
  chatId: string;
  notificationLanguage: 'vi' | 'en' | 'both';
  matchId: string;
  alertKind: string;
  triggerKey: string;
  triggerSnapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface PendingTelegramMatchAlertQueryRow {
  channel_id: number;
  delivery_id: number;
  user_id: string;
  chat_id: string;
  notification_language: string | null;
  match_id: string;
  alert_kind: string;
  trigger_key: string;
  trigger_snapshot: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface StatsOnlySignalDeliveryRow {
  id: number;
}

export interface EnqueueStatsOnlySignalInput {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  status: string;
  minute: number;
  score: string;
  kickoffAtUtc: string | null;
  signal: StatsOnlyLiveSignalResult;
  referenceMarketKeys?: string[];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapDelivery(row: MatchAlertDeliveryRow): MatchAlertDelivery {
  return {
    id: Number(row.id),
    ruleId: Number(row.rule_id),
    userId: row.user_id,
    matchId: row.match_id,
    alertKind: row.alert_kind,
    triggerKey: row.trigger_key,
    triggerSnapshot: jsonObject(row.trigger_snapshot),
    deliveryStatus: row.delivery_status,
    metadata: jsonObject(row.metadata),
    createdAt: row.created_at,
  };
}

function channelPolicyAllows(
  policy: Record<string, unknown>,
  channel: 'web_push' | 'native_push' | 'telegram' | 'sms' | 'voice_call',
): boolean {
  const value = policy[channel];
  return value !== false;
}

export async function hasRecentMatchAlertDelivery(rule: MatchAlertRule, triggerKey: string): Promise<boolean> {
  if (rule.oncePerMatch) {
    const result = await query<{ exists: boolean }>(
      `SELECT EXISTS (
          SELECT 1
            FROM user_match_alert_deliveries
           WHERE rule_id = $1
             AND match_id = $2
        ) AS exists`,
      [rule.id, rule.matchId],
    );
    if (result.rows[0]?.exists) return true;
  }

  if (rule.cooldownMinutes > 0) {
    const result = await query<{ exists: boolean }>(
      `SELECT EXISTS (
          SELECT 1
            FROM user_match_alert_deliveries
           WHERE rule_id = $1
             AND created_at > NOW() - ($2::int * INTERVAL '1 minute')
             AND trigger_key <> $3
        ) AS exists`,
      [rule.id, rule.cooldownMinutes, triggerKey],
    );
    if (result.rows[0]?.exists) return true;
  }
  return false;
}

async function syncDeliveryChannels(deliveryIds: number[]): Promise<void> {
  if (deliveryIds.length === 0) return;
  await query(
    `WITH target_deliveries AS (
        SELECT d.id, d.user_id, r.channel_policy, d.delivery_status
          FROM user_match_alert_deliveries d
          JOIN user_match_alert_rules r ON r.id = d.rule_id
         WHERE d.id = ANY($1::bigint[])
      ),
      desired_channels AS (
        SELECT
          td.id AS delivery_id,
          'web_push'::text AS channel_type,
          CASE
            WHEN td.delivery_status <> 'pending' THEN 'suppressed'
            WHEN COALESCE((td.channel_policy->>'web_push')::boolean, TRUE) = FALSE THEN 'suppressed'
            ELSE 'pending'
          END AS status
        FROM target_deliveries td
        JOIN LATERAL (
          SELECT 1
            FROM push_subscriptions ps
           WHERE ps.user_id = td.user_id::text
           LIMIT 1
        ) active_push ON TRUE
        WHERE NOT EXISTS (
          SELECT 1
            FROM user_notification_channel_configs wp
          WHERE wp.user_id = td.user_id
             AND wp.channel_type = 'web_push'
             AND (wp.enabled = FALSE OR wp.status = 'disabled')
        )
        UNION ALL
        SELECT
          td.id AS delivery_id,
          'native_push'::text AS channel_type,
          CASE
            WHEN td.delivery_status <> 'pending' THEN 'suppressed'
            WHEN COALESCE((td.channel_policy->>'native_push')::boolean, TRUE) = FALSE THEN 'suppressed'
            ELSE 'pending'
          END AS status
        FROM target_deliveries td
        JOIN LATERAL (
          SELECT 1
            FROM native_push_devices npd
           WHERE npd.user_id = td.user_id
           LIMIT 1
        ) active_native ON TRUE
        WHERE NOT EXISTS (
          SELECT 1
            FROM user_notification_channel_configs np
           WHERE np.user_id = td.user_id
             AND np.channel_type = 'native_push'
             AND (np.enabled = FALSE OR np.status = 'disabled')
        )
        UNION ALL
        SELECT
          td.id AS delivery_id,
          'telegram'::text AS channel_type,
          CASE
            WHEN td.delivery_status <> 'pending' THEN 'suppressed'
            WHEN COALESCE((td.channel_policy->>'telegram')::boolean, TRUE) = FALSE THEN 'suppressed'
            ELSE 'pending'
          END AS status
        FROM target_deliveries td
        JOIN user_notification_channel_configs tg
          ON tg.user_id = td.user_id
         AND tg.channel_type = 'telegram'
         AND tg.enabled = TRUE
         AND tg.status <> 'disabled'
         AND tg.address IS NOT NULL
         AND BTRIM(tg.address) <> ''
        UNION ALL
        SELECT
          td.id AS delivery_id,
          fallback.channel_type,
          CASE
            WHEN td.delivery_status <> 'pending' THEN 'suppressed'
            ELSE 'pending'
          END AS status
        FROM target_deliveries td
        JOIN user_notification_channel_configs cfg
          ON cfg.user_id = td.user_id
         AND cfg.channel_type IN ('sms', 'voice_call')
         AND cfg.enabled = TRUE
         AND cfg.status <> 'disabled'
         AND cfg.address IS NOT NULL
         AND BTRIM(cfg.address) <> ''
        CROSS JOIN LATERAL (
          SELECT cfg.channel_type::text AS channel_type
        ) fallback
        WHERE (
          (cfg.channel_type = 'sms' AND COALESCE((td.channel_policy->>'sms')::boolean, TRUE) <> FALSE)
          OR (cfg.channel_type = 'voice_call' AND COALESCE((td.channel_policy->>'voice_call')::boolean, TRUE) <> FALSE)
        )
      )
      INSERT INTO user_match_alert_delivery_channels (
        delivery_id,
        channel_type,
        status,
        metadata,
        created_at,
        updated_at
      )
      SELECT
        delivery_id,
        channel_type,
        status,
        CASE
          WHEN channel_type IN ('native_push', 'sms', 'voice_call') AND status = 'suppressed'
            THEN jsonb_build_object('reason', 'delivery_suppressed')
          ELSE '{}'::jsonb
        END,
        NOW(),
        NOW()
        FROM desired_channels
      ON CONFLICT (delivery_id, channel_type) DO UPDATE
        SET status = CASE
              WHEN user_match_alert_delivery_channels.status = 'delivered' THEN 'delivered'
              ELSE EXCLUDED.status
            END,
            metadata = CASE
              WHEN EXCLUDED.channel_type IN ('native_push', 'sms', 'voice_call') AND EXCLUDED.status = 'suppressed'
                THEN user_match_alert_delivery_channels.metadata || jsonb_build_object('reason', 'delivery_suppressed')
              ELSE user_match_alert_delivery_channels.metadata
            END,
            updated_at = NOW()`,
    [deliveryIds],
  );
}

async function recomputeParentDelivery(deliveryIds: number[]): Promise<void> {
  if (deliveryIds.length === 0) return;
  await query(
    `WITH channel_summary AS (
       SELECT
         d.id AS delivery_id,
         COUNT(c.id)::int AS channel_count,
         COUNT(*) FILTER (WHERE c.status = 'delivered')::int AS delivered_count,
         COUNT(*) FILTER (WHERE c.status = 'pending')::int AS pending_count,
         COUNT(*) FILTER (WHERE c.status = 'failed')::int AS failed_count,
         COUNT(*) FILTER (WHERE c.status = 'suppressed')::int AS suppressed_count,
         MAX(c.delivered_at) FILTER (WHERE c.status = 'delivered') AS delivered_at
       FROM user_match_alert_deliveries d
       LEFT JOIN user_match_alert_delivery_channels c ON c.delivery_id = d.id
       WHERE d.id = ANY($1::bigint[])
       GROUP BY d.id
     )
     UPDATE user_match_alert_deliveries d
        SET delivery_status = CASE
              WHEN s.channel_count = 0 THEN 'suppressed'
              WHEN s.delivered_count > 0 THEN 'delivered'
              WHEN s.pending_count > 0 THEN 'pending'
              WHEN s.failed_count > 0 THEN 'failed'
              WHEN s.suppressed_count = s.channel_count THEN 'suppressed'
              ELSE d.delivery_status
            END,
            delivered_at = CASE
              WHEN s.delivered_count > 0 THEN COALESCE(d.delivered_at, s.delivered_at, NOW())
              ELSE d.delivered_at
            END
       FROM channel_summary s
      WHERE d.id = s.delivery_id`,
    [deliveryIds],
  );
}

export async function enqueueMatchAlertDelivery(
  rule: MatchAlertRule,
  evaluation: MatchAlertEvaluationResult,
  context: MatchAlertContext,
  metadataPatch: Record<string, unknown> = {},
): Promise<MatchAlertDelivery | null> {
  if (!evaluation.matched || !evaluation.triggerKey || !rule.matchId) return null;
  if (await hasRecentMatchAlertDelivery(rule, evaluation.triggerKey)) return null;

  const policy = rule.channelPolicy;
  const effectivePolicy = {
    web_push: channelPolicyAllows(policy, 'web_push'),
    native_push: channelPolicyAllows(policy, 'native_push'),
    telegram: channelPolicyAllows(policy, 'telegram'),
    sms: channelPolicyAllows(policy, 'sms'),
    voice_call: channelPolicyAllows(policy, 'voice_call'),
  };

  const result = await query<MatchAlertDeliveryRow>(
    `INSERT INTO user_match_alert_deliveries (
        rule_id,
        user_id,
        match_id,
        alert_kind,
        trigger_key,
        trigger_snapshot,
        delivery_status,
        metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
     ON CONFLICT (rule_id, trigger_key) DO NOTHING
     RETURNING *`,
    [
      rule.id,
      rule.userId,
      rule.matchId,
      rule.alertKind,
      evaluation.triggerKey,
      JSON.stringify({
        summaryEn: evaluation.summaryEn,
        summaryVi: evaluation.summaryVi,
        severity: evaluation.severity,
        suggestedAction: evaluation.suggestedAction,
        facts: evaluation.facts,
      }),
      JSON.stringify({
        matchDisplay: `${context.homeTeam} vs ${context.awayTeam}`,
        homeTeam: context.homeTeam,
        awayTeam: context.awayTeam,
        league: context.leagueName,
        status: context.status,
        minute: context.minute,
        score: `${context.score.home}-${context.score.away}`,
        kickoffAtUtc: context.kickoffAtUtc,
        channelPolicy: effectivePolicy,
        ...metadataPatch,
      }),
    ],
  );
  const row = result.rows[0];
  if (!row) return null;
  await syncDeliveryChannels([Number(row.id)]);
  await recomputeParentDelivery([Number(row.id)]);
  return mapDelivery(row);
}

export async function recordSuppressedMatchAlertDelivery(
  rule: MatchAlertRule,
  evaluation: MatchAlertEvaluationResult,
  context: MatchAlertContext,
  metadataPatch: Record<string, unknown> = {},
): Promise<MatchAlertDelivery | null> {
  if (!evaluation.matched || !evaluation.triggerKey || !rule.matchId) return null;
  if (await hasRecentMatchAlertDelivery(rule, evaluation.triggerKey)) return null;

  const result = await query<MatchAlertDeliveryRow>(
    `INSERT INTO user_match_alert_deliveries (
        rule_id,
        user_id,
        match_id,
        alert_kind,
        trigger_key,
        trigger_snapshot,
        delivery_status,
        metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,'suppressed',$7)
     ON CONFLICT (rule_id, trigger_key) DO NOTHING
     RETURNING *`,
    [
      rule.id,
      rule.userId,
      rule.matchId,
      rule.alertKind,
      evaluation.triggerKey,
      JSON.stringify({
        summaryEn: evaluation.summaryEn,
        summaryVi: evaluation.summaryVi,
        severity: evaluation.severity,
        suggestedAction: evaluation.suggestedAction,
        facts: evaluation.facts,
      }),
      JSON.stringify({
        matchDisplay: `${context.homeTeam} vs ${context.awayTeam}`,
        homeTeam: context.homeTeam,
        awayTeam: context.awayTeam,
        league: context.leagueName,
        status: context.status,
        minute: context.minute,
        score: `${context.score.home}-${context.score.away}`,
        kickoffAtUtc: context.kickoffAtUtc,
        suppressed: true,
        ...metadataPatch,
      }),
    ],
  );
  const row = result.rows[0];
  if (!row) return null;
  await syncDeliveryChannels([Number(row.id)]);
  await recomputeParentDelivery([Number(row.id)]);
  return mapDelivery(row);
}

export async function enqueueStatsOnlyLiveSignalDeliveries(
  input: EnqueueStatsOnlySignalInput,
): Promise<{ enqueued: number; deliveryIds: number[] }> {
  if (!input.signal.triggered || !input.signal.triggerKey) {
    return { enqueued: 0, deliveryIds: [] };
  }

  const result = await query<StatsOnlySignalDeliveryRow>(
    `WITH targets AS (
       SELECT DISTINCT
              s.user_id,
              COALESCE(settings.channel_policy, '{}'::jsonb) AS channel_policy
         FROM user_watch_subscriptions s
         LEFT JOIN user_match_alert_settings settings ON settings.user_id = s.user_id
        WHERE s.match_id = $1
          AND s.notify_enabled = TRUE
          AND COALESCE(settings.condition_alerts_enabled, TRUE) = TRUE
     ),
     rules AS (
       INSERT INTO user_match_alert_rules (
          user_id,
          match_id,
          alert_kind,
          enabled,
          source,
          source_ref,
          rule_json,
          compiled_status,
          cooldown_minutes,
          once_per_match,
          channel_policy,
          metadata,
          updated_at
       )
       SELECT
          t.user_id,
          $1,
          'condition_signal',
          TRUE,
          'stats_only_signal',
          jsonb_build_object('matchId', $1, 'contract', 'odds-first-stats-only-live-signal'),
          jsonb_build_object('version', 1, 'id', 'stats_only_live_signal'),
          'draft',
          10,
          FALSE,
          t.channel_policy,
          jsonb_build_object(
            'materializedBy', 'server-pipeline',
            'contract', 'odds-first-stats-only-live-signal',
            'systemDraftRule', TRUE
          ),
          NOW()
         FROM targets t
       ON CONFLICT (user_id, match_id, alert_kind, source)
         WHERE match_id IS NOT NULL
       DO UPDATE
          SET enabled = TRUE,
              compiled_status = 'draft',
              channel_policy = EXCLUDED.channel_policy,
              metadata = EXCLUDED.metadata,
              updated_at = NOW()
       RETURNING id, user_id
     ),
     deliveries AS (
       INSERT INTO user_match_alert_deliveries (
          rule_id,
          user_id,
          match_id,
          alert_kind,
          trigger_key,
          trigger_snapshot,
          delivery_status,
          metadata
       )
       SELECT
          r.id,
          r.user_id,
          $1,
          'condition_signal',
          $2,
          $3::jsonb,
          'pending',
          $4::jsonb
         FROM rules r
       ON CONFLICT (rule_id, trigger_key) DO NOTHING
       RETURNING id
     )
     SELECT id FROM deliveries`,
    [
      input.matchId,
      input.signal.triggerKey,
      JSON.stringify({
        summaryEn: input.signal.summaryEn,
        summaryVi: input.signal.summaryVi,
        severity: input.signal.strength === 'high' ? 'high' : 'medium',
        suggestedAction: input.signal.suggestedAction,
        facts: {
          signalType: input.signal.signalType,
          strength: input.signal.strength,
          marketFamilyHint: input.signal.marketFamilyHint,
          reasons: input.signal.reasons,
          referenceMarketKeys: input.referenceMarketKeys ?? [],
          noActionableOdds: true,
        },
      }),
      JSON.stringify({
        matchDisplay: `${input.homeTeam} vs ${input.awayTeam}`,
        homeTeam: input.homeTeam,
        awayTeam: input.awayTeam,
        league: input.league,
        status: input.status,
        minute: input.minute,
        score: input.score,
        kickoffAtUtc: input.kickoffAtUtc,
        signalType: input.signal.signalType,
        signalStrength: input.signal.strength,
        signalReasons: input.signal.reasons,
        marketFamilyHint: input.signal.marketFamilyHint,
        referenceMarketKeys: input.referenceMarketKeys ?? [],
        noActionableOdds: true,
        signalContractVersion: 'odds-first-stats-only-live-signal-v1',
      }),
    ],
  );
  const deliveryIds = result.rows.map((row) => Number(row.id));
  await syncDeliveryChannels(deliveryIds);
  await recomputeParentDelivery(deliveryIds);
  return { enqueued: deliveryIds.length, deliveryIds };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function buildAlertUrl(matchId: string, metadata: Record<string, unknown>): string {
  const display = asString(metadata.matchDisplay);
  const params = new URLSearchParams({ tab: 'matches', match: matchId });
  if (display) params.set('matchDisplay', display);
  return `/?${params.toString()}`;
}

function buildPushPayload(row: PendingWebPushRow): PushPayload {
  const metadata = jsonObject(row.metadata);
  const snapshot = jsonObject(row.trigger_snapshot);
  const title = row.alert_kind === 'match_start' ? 'MATCH STARTED' : 'LIVE SIGNAL';
  const summary = asString(snapshot.summaryVi) || asString(snapshot.summaryEn) || 'Match alert matched.';
  const matchDisplay = asString(metadata.matchDisplay) || row.match_id;
  const body = `${matchDisplay}\n${summary}`;
  const tag = row.alert_kind === 'match_start'
    ? `tfi-alert-match-start-${row.match_id}`
    : `tfi-alert-${row.trigger_key.replace(/[^a-zA-Z0-9:_-]/g, '-')}`;
  return {
    title,
    body,
    tag,
    url: buildAlertUrl(row.match_id, metadata),
    icon: '/icons/notification-condition.svg',
    critical: true,
    requireInteraction: true,
    duration: null,
    data: {
      channelType: 'native_push',
      matchId: row.match_id,
      alertKind: row.alert_kind,
      deliveryId: row.delivery_id,
      triggerKey: row.trigger_key,
    },
  };
}

export async function getPendingWebPushMatchAlertDeliveries(limit = 50): Promise<PendingWebPushRow[]> {
  const result = await query<PendingWebPushRow>(
    `SELECT
        c.id AS channel_id,
        d.id AS delivery_id,
        d.user_id::text AS user_id,
        d.match_id,
        d.alert_kind,
        d.trigger_key,
        d.trigger_snapshot,
        d.metadata
       FROM user_match_alert_delivery_channels c
       JOIN user_match_alert_deliveries d ON d.id = c.delivery_id
      WHERE c.channel_type = 'web_push'
        AND c.status = 'pending'
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function getPendingNativePushMatchAlertDeliveries(limit = 50): Promise<PendingNativePushRow[]> {
  const result = await query<PendingNativePushRow>(
    `SELECT
        c.id AS channel_id,
        d.id AS delivery_id,
        d.user_id::text AS user_id,
        d.match_id,
        d.alert_kind,
        d.trigger_key,
        d.trigger_snapshot,
        d.metadata
       FROM user_match_alert_delivery_channels c
       JOIN user_match_alert_deliveries d ON d.id = c.delivery_id
      WHERE c.channel_type = 'native_push'
        AND c.status = 'pending'
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function getPendingFallbackMatchAlertDeliveries(
  channelType: 'sms' | 'voice_call',
  limit = 20,
): Promise<PendingFallbackRow[]> {
  const result = await query<PendingFallbackRow>(
    `SELECT
        c.id AS channel_id,
        d.id AS delivery_id,
        d.user_id::text AS user_id,
        d.match_id,
        d.alert_kind,
        d.trigger_key,
        d.trigger_snapshot,
        d.metadata,
        cfg.address,
        c.channel_type::text AS channel_type
       FROM user_match_alert_delivery_channels c
       JOIN user_match_alert_deliveries d ON d.id = c.delivery_id
       JOIN user_notification_channel_configs cfg
         ON cfg.user_id = d.user_id
        AND cfg.channel_type = c.channel_type
        AND cfg.enabled = TRUE
        AND cfg.status <> 'disabled'
        AND cfg.address IS NOT NULL
        AND BTRIM(cfg.address) <> ''
      WHERE c.channel_type = $1
        AND c.status = 'pending'
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT $2`,
    [channelType, limit],
  );
  return result.rows;
}

function normalizeLanguage(value: unknown): 'vi' | 'en' | 'both' {
  return value === 'en' || value === 'both' || value === 'vi' ? value : 'vi';
}

export async function getPendingTelegramMatchAlertDeliveries(limit = 20): Promise<PendingTelegramMatchAlertRow[]> {
  const result = await query<PendingTelegramMatchAlertQueryRow>(
    `SELECT
        c.id AS channel_id,
        d.id AS delivery_id,
        d.user_id::text AS user_id,
        tg.address AS chat_id,
        ns.notification_language,
        d.match_id,
        d.alert_kind,
        d.trigger_key,
        d.trigger_snapshot,
        d.metadata,
        d.created_at
       FROM user_match_alert_delivery_channels c
       JOIN user_match_alert_deliveries d ON d.id = c.delivery_id
       JOIN user_notification_channel_configs tg
         ON tg.user_id = d.user_id
        AND tg.channel_type = 'telegram'
        AND tg.enabled = TRUE
        AND tg.status <> 'disabled'
        AND tg.address IS NOT NULL
        AND BTRIM(tg.address) <> ''
       LEFT JOIN user_notification_settings ns ON ns.user_id = d.user_id::text
      WHERE c.channel_type = 'telegram'
        AND c.status = 'pending'
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    channelId: Number(row.channel_id),
    deliveryId: Number(row.delivery_id),
    userId: row.user_id,
    chatId: row.chat_id,
    notificationLanguage: normalizeLanguage(row.notification_language),
    matchId: row.match_id,
    alertKind: row.alert_kind,
    triggerKey: row.trigger_key,
    triggerSnapshot: jsonObject(row.trigger_snapshot),
    metadata: jsonObject(row.metadata),
    createdAt: row.created_at,
  }));
}

export async function markMatchAlertChannelDelivered(channelId: number): Promise<void> {
  const result = await query<{ delivery_id: number }>(
    `UPDATE user_match_alert_delivery_channels
        SET status = 'delivered',
            attempt_count = attempt_count + 1,
            last_attempt_at = NOW(),
            delivered_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING delivery_id`,
    [channelId],
  );
  await recomputeParentDelivery(result.rows.map((row) => Number(row.delivery_id)));
}

export async function markMatchAlertChannelFailed(channelId: number, error: string): Promise<void> {
  const result = await query<{ delivery_id: number }>(
    `UPDATE user_match_alert_delivery_channels
        SET status = CASE WHEN attempt_count >= 2 THEN 'failed' ELSE 'pending' END,
            attempt_count = attempt_count + 1,
            last_error = $2,
            last_attempt_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING delivery_id`,
    [channelId, error.slice(0, 1000)],
  );
  await recomputeParentDelivery(result.rows.map((row) => Number(row.delivery_id)));
}

export async function markMatchAlertChannelSuppressed(channelId: number, reason: string): Promise<void> {
  const result = await query<{ delivery_id: number }>(
    `UPDATE user_match_alert_delivery_channels
        SET status = 'suppressed',
            last_attempt_at = NOW(),
            last_error = $2,
            metadata = metadata || jsonb_build_object('reason', $2),
            updated_at = NOW()
      WHERE id = $1
        AND status <> 'delivered'
      RETURNING delivery_id`,
    [channelId, reason.slice(0, 1000)],
  );
  await recomputeParentDelivery(result.rows.map((row) => Number(row.delivery_id)));
}

export async function deliverPendingWebPushMatchAlerts(limit = 50): Promise<{ pending: number; delivered: number; failed: number }> {
  const pending = await getPendingWebPushMatchAlertDeliveries(limit);
  if (pending.length === 0) return { pending: 0, delivered: 0, failed: 0 };
  if (!isWebPushConfigured()) {
    for (const row of pending) {
      await markMatchAlertChannelFailed(row.channel_id, 'Web Push is not configured');
    }
    return { pending: pending.length, delivered: 0, failed: pending.length };
  }

  let delivered = 0;
  let failed = 0;
  for (const row of pending) {
    const subscriptions = await getSubscriptionsByUserId(row.user_id);
    if (subscriptions.length === 0) {
      await markMatchAlertChannelFailed(row.channel_id, 'No active Web Push subscription');
      failed += 1;
      continue;
    }

    const payload = buildPushPayload(row);
    let deliveredToAny = false;
    let lastError = '';
    for (const subscription of subscriptions) {
      const result = await sendWebPushNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
      );
      if (result.ok) {
        deliveredToAny = true;
      } else {
        lastError = result.error;
        if (result.gone) {
          await deleteSubscription(subscription.endpoint).catch(() => undefined);
        }
      }
    }

    if (deliveredToAny) {
      await markMatchAlertChannelDelivered(row.channel_id);
      delivered += 1;
    } else {
      await markMatchAlertChannelFailed(row.channel_id, lastError || 'Web Push delivery failed');
      failed += 1;
    }
  }

  return { pending: pending.length, delivered, failed };
}

function buildFallbackText(row: PendingWebPushRow): string {
  const metadata = jsonObject(row.metadata);
  const snapshot = jsonObject(row.trigger_snapshot);
  const kind = row.alert_kind === 'match_start' ? 'MATCH STARTED' : 'LIVE SIGNAL';
  const matchDisplay = asString(metadata.matchDisplay) || row.match_id;
  const summary = asString(snapshot.summaryVi) || asString(snapshot.summaryEn) || 'Match alert matched.';
  const score = asString(metadata.score);
  const minute = metadata.minute == null ? '' : String(metadata.minute);
  const meta = [minute ? `${minute}'` : '', score].filter(Boolean).join(' | ');
  return [kind, matchDisplay, meta, summary].filter(Boolean).join('\n');
}

export async function deliverPendingNativePushMatchAlerts(limit = 50): Promise<{ pending: number; delivered: number; failed: number }> {
  const pending = await getPendingNativePushMatchAlertDeliveries(limit);
  if (pending.length === 0) return { pending: 0, delivered: 0, failed: 0 };

  let delivered = 0;
  let failed = 0;
  for (const row of pending) {
    const devices = await getNativePushDevicesByUserId(row.user_id);
    const fcmDevices = devices.filter((device) => device.provider === 'fcm');
    if (fcmDevices.length === 0) {
      await markMatchAlertChannelFailed(row.channel_id, 'No FCM native push device registered');
      failed += 1;
      continue;
    }

    const metadata = jsonObject(row.metadata);
    const payload = buildPushPayload(row);
    let deliveredToAny = false;
    let lastError = '';
    for (const device of fcmDevices) {
      const result = await sendFcmNotification(device.token, {
        title: payload.title,
        body: payload.body,
        data: {
          ...(payload.data ?? {}),
          url: payload.url,
          matchDisplay: asString(metadata.matchDisplay),
        },
      });
      if (result.ok) {
        deliveredToAny = true;
      } else {
        lastError = result.error;
        if (result.gone) {
          await deleteNativePushDeviceByToken(device.provider, device.token).catch(() => undefined);
        }
      }
    }

    if (deliveredToAny) {
      await markMatchAlertChannelDelivered(row.channel_id);
      delivered += 1;
    } else {
      await markMatchAlertChannelFailed(row.channel_id, lastError || 'Native push delivery failed');
      failed += 1;
    }
  }

  return { pending: pending.length, delivered, failed };
}

export async function deliverPendingFallbackMatchAlerts(
  channelType: 'sms' | 'voice_call',
  limit = 20,
): Promise<{ pending: number; delivered: number; failed: number }> {
  const pending = await getPendingFallbackMatchAlertDeliveries(channelType, limit);
  if (pending.length === 0) return { pending: 0, delivered: 0, failed: 0 };

  let delivered = 0;
  let failed = 0;
  for (const row of pending) {
    const policy = await evaluateCriticalFallbackPolicy(channelType, row.user_id, row.address);
    if (!policy.allowed) {
      await markMatchAlertChannelSuppressed(row.channel_id, policy.reason || 'Critical fallback policy blocked delivery');
      failed += 1;
      continue;
    }

    const message = buildFallbackText(row);
    const result = channelType === 'sms'
      ? await sendSmsNotification(row.address, message)
      : await sendVoiceNotification(row.address, message);
    if (result.ok) {
      await markMatchAlertChannelDelivered(row.channel_id);
      delivered += 1;
    } else {
      await markMatchAlertChannelFailed(row.channel_id, result.error);
      failed += 1;
    }
  }

  return { pending: pending.length, delivered, failed };
}
