import type { QueryResult, QueryResultRow } from 'pg';
import { query } from '../db/pool.js';
import { evaluateCustomConditionText, type ConditionStatsSnapshot } from '../lib/condition-evaluator.js';

interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface RecommendationDeliveryRow {
  id: number;
  user_id: string;
  recommendation_id: number | null;
  match_id: string;
  matched_condition: boolean;
  eligibility_status: string;
  delivery_status: string;
  delivery_channels: unknown[];
  delivered_at: string | null;
  hidden: boolean;
  dismissed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  recommendation_timestamp: string | null;
  recommendation_minute: number | null;
  recommendation_score: string | null;
  recommendation_bet_type: string | null;
  recommendation_selection: string | null;
  recommendation_bet_market: string | null;
  recommendation_odds: number | null;
  recommendation_confidence: number | null;
  recommendation_value_percent: number | null;
  recommendation_risk_level: string | null;
  recommendation_stake_percent: number | null;
  recommendation_reasoning: string | null;
  recommendation_reasoning_vi: string | null;
  recommendation_key_factors: string | null;
  recommendation_warnings: string | null;
  recommendation_home_team: string | null;
  recommendation_away_team: string | null;
  recommendation_league: string | null;
  recommendation_result: string | null;
  recommendation_actual_outcome: string | null;
  recommendation_pnl: number | null;
}

export interface RecommendationDeliveryStageInput {
  id: number;
  match_id: string;
  timestamp?: string | null;
  selection?: string | null;
  bet_market?: string | null;
  odds?: number | null;
  confidence?: number | null;
  risk_level?: string | null;
}

export interface ConditionOnlyDeliveryStageInput {
  match_id: string;
  timestamp?: string | null;
  minute?: number | null;
  score?: string | null;
  stats_snapshot?: Record<string, unknown> | string | null;
  league?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  selection?: string | null;
  bet_market?: string | null;
  confidence?: number | null;
  risk_level?: string | null;
  stake_percent?: number | null;
  reasoning?: string | null;
  reasoning_vi?: string | null;
  warnings?: string | null;
  condition_summary_en?: string | null;
  condition_summary_vi?: string | null;
  condition_reason_en?: string | null;
  condition_reason_vi?: string | null;
}

interface RecommendationDeliveryListOptions {
  limit?: number;
  offset?: number;
  matchId?: string;
  eligibilityStatus?: string;
  deliveryStatus?: string;
  includeHidden?: boolean;
  dismissed?: boolean;
  result?: string;
  betType?: string;
  search?: string;
  league?: string;
  dateFrom?: string;
  dateTo?: string;
  riskLevel?: string;
  sortBy?: string;
  sortDir?: string;
}

interface RecommendationDeliveryUpdateFlags {
  hidden?: boolean;
  dismissed?: boolean;
}

export interface EligibleTelegramDeliveryTarget {
  userId: string;
  chatId: string;
}

interface EligibleTelegramDeliveryTargetRow {
  user_id: string;
  chat_id: string;
}

interface PendingConditionDeliveryRow {
  id: number;
  metadata: Record<string, unknown> | null;
}

interface ConditionOnlyDeliveryTargetRow {
  id: number;
  user_id: string;
}

export interface ConditionOnlyDeliveryTarget {
  deliveryId: number;
  userId: string;
}

export interface RecommendationDeliveryConditionEvaluationInput {
  id: number;
  minute: number | null;
  score: string | null;
  stats_snapshot: Record<string, unknown> | string | null;
}

interface DeliveryCountRow {
  count: string;
}

function normalizeDeliveryChannels(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapDeliveryRow(row: RecommendationDeliveryRow): RecommendationDeliveryRow {
  return {
    ...row,
    delivery_channels: normalizeDeliveryChannels(row.delivery_channels),
    metadata: normalizeMetadata(row.metadata),
  };
}

function parseScore(score: string | null | undefined): { homeGoals: number; awayGoals: number } | null {
  if (typeof score !== 'string') return null;
  const match = score.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return null;
  return {
    homeGoals: Number(match[1]),
    awayGoals: Number(match[2]),
  };
}

function normalizeStatsSnapshot(value: Record<string, unknown> | string | null | undefined): ConditionStatsSnapshot {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return normalizeStatsSnapshot(parsed);
    } catch {
      return {};
    }
  }
  return value as ConditionStatsSnapshot;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function stageRecommendationDeliveries(
  db: QueryExecutor,
  recommendation: RecommendationDeliveryStageInput,
): Promise<number> {
  const result = await db.query(
    `INSERT INTO user_recommendation_deliveries (
        user_id,
        recommendation_id,
        match_id,
        matched_condition,
        eligibility_status,
        delivery_status,
        delivery_channels,
        metadata,
        created_at
     )
     SELECT
       s.user_id,
       $1,
       s.match_id,
       CASE
         WHEN s.notify_enabled = FALSE THEN FALSE
         WHEN s.auto_apply_recommended_condition = TRUE THEN TRUE
         WHEN NULLIF(BTRIM(s.custom_condition_text), '') IS NULL THEN TRUE
         ELSE FALSE
       END AS matched_condition,
       CASE
         WHEN s.notify_enabled = FALSE THEN 'notifications_disabled'
         WHEN s.auto_apply_recommended_condition = TRUE THEN 'eligible'
         WHEN NULLIF(BTRIM(s.custom_condition_text), '') IS NULL THEN 'eligible'
         ELSE 'pending_condition'
       END AS eligibility_status,
       CASE
         WHEN s.notify_enabled = FALSE THEN 'suppressed'
         ELSE 'pending'
       END AS delivery_status,
       '[]'::jsonb,
       jsonb_strip_nulls(jsonb_build_object(
         'subscription_mode', s.mode,
         'subscription_priority', s.priority,
         'custom_condition_text', s.custom_condition_text,
         'subscription_source', s.source,
         'recommendation_timestamp', $3::text,
         'selection', $4::text,
         'bet_market', $5::text,
         'odds', $6::numeric,
         'confidence', $7::numeric,
         'risk_level', $8::text
       )),
       COALESCE($3::timestamptz, NOW())
     FROM user_watch_subscriptions s
     WHERE s.match_id = $2
       AND s.status = 'active'
     ON CONFLICT (user_id, recommendation_id) DO UPDATE
       SET matched_condition = EXCLUDED.matched_condition,
           eligibility_status = EXCLUDED.eligibility_status,
           delivery_status = EXCLUDED.delivery_status,
           metadata = user_recommendation_deliveries.metadata || EXCLUDED.metadata`,
    [
      recommendation.id,
      recommendation.match_id,
      recommendation.timestamp ?? null,
      recommendation.selection ?? null,
      recommendation.bet_market ?? null,
      recommendation.odds ?? null,
      recommendation.confidence ?? null,
      recommendation.risk_level ?? null,
    ],
  );

  return result.rowCount ?? 0;
}

export async function evaluateRecommendationDeliveryConditions(
  db: QueryExecutor,
  recommendation: RecommendationDeliveryConditionEvaluationInput,
): Promise<number> {
  const score = parseScore(recommendation.score);
  if (!score) return 0;

  const stats = normalizeStatsSnapshot(recommendation.stats_snapshot);
  const pendingRows = await db.query<PendingConditionDeliveryRow>(
    `SELECT id, metadata
       FROM user_recommendation_deliveries
      WHERE recommendation_id = $1
        AND eligibility_status = 'pending_condition'`,
    [recommendation.id],
  );

  let updated = 0;

  for (const row of pendingRows.rows) {
    const metadata = normalizeMetadata(row.metadata);
    const conditionText = typeof metadata.custom_condition_text === 'string'
      ? metadata.custom_condition_text.trim()
      : '';
    if (!conditionText) continue;

    const evaluation = evaluateCustomConditionText(conditionText, {
      minute: recommendation.minute,
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      stats,
    });

    if (!evaluation.supported) continue;

    const nextEligibility = evaluation.matched ? 'eligible' : 'condition_not_matched';
    const nextDeliveryStatus = evaluation.matched ? 'pending' : 'suppressed';
    const result = await db.query(
      `UPDATE user_recommendation_deliveries
          SET matched_condition = $3,
              eligibility_status = $4,
              delivery_status = $5,
              metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'condition_evaluation_status', 'evaluated',
                'condition_evaluation_supported', TRUE,
                'condition_evaluation_matched', $3::boolean,
                'condition_evaluation_summary', $6::text
              )
        WHERE id = $1
          AND recommendation_id = $2`,
      [row.id, recommendation.id, evaluation.matched, nextEligibility, nextDeliveryStatus, evaluation.summary],
    );
    updated += result.rowCount ?? 0;
  }

  return updated;
}

export async function stageConditionOnlyDeliveries(
  db: QueryExecutor,
  input: ConditionOnlyDeliveryStageInput,
): Promise<ConditionOnlyDeliveryTarget[]> {
  const score = parseScore(input.score);
  if (!score) return [];

  const stats = normalizeStatsSnapshot(input.stats_snapshot);
  const subscriptions = await db.query<{
    user_id: string;
    custom_condition_text: string;
  }>(
    `SELECT user_id, custom_condition_text
       FROM user_watch_subscriptions
      WHERE match_id = $1
        AND status = 'active'
        AND notify_enabled = TRUE`,
    [input.match_id],
  );

  const created: ConditionOnlyDeliveryTarget[] = [];

  for (const subscription of subscriptions.rows) {
    const conditionText = normalizeNullableString(subscription.custom_condition_text) ?? '';
    if (!conditionText) continue;

    const evaluation = evaluateCustomConditionText(conditionText, {
      minute: input.minute ?? null,
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      stats,
    });

    if (!evaluation.supported || !evaluation.matched) continue;

    const result = await db.query<ConditionOnlyDeliveryTargetRow>(
      `INSERT INTO user_recommendation_deliveries (
          user_id,
          recommendation_id,
          match_id,
          matched_condition,
          eligibility_status,
          delivery_status,
          delivery_channels,
          metadata,
          created_at
       )
       VALUES (
          $1,
          NULL,
          $2,
          TRUE,
          'eligible',
          'pending',
          '[]'::jsonb,
          jsonb_strip_nulls(jsonb_build_object(
            'delivery_kind', 'condition_only',
            'custom_condition_text', $3::text,
            'condition_evaluation_status', 'evaluated',
            'condition_evaluation_supported', TRUE,
            'condition_evaluation_matched', TRUE,
            'condition_evaluation_summary', $4::text,
            'recommendation_timestamp', $5::text,
            'recommendation_minute', $6::integer,
            'recommendation_score', $7::text,
            'recommendation_bet_type', 'CONDITION_ONLY',
            'recommendation_selection', $8::text,
            'recommendation_bet_market', $9::text,
            'recommendation_confidence', $10::numeric,
            'recommendation_risk_level', $11::text,
            'recommendation_stake_percent', $12::numeric,
            'recommendation_reasoning', $13::text,
            'recommendation_reasoning_vi', $14::text,
            'recommendation_warnings', $15::text,
            'recommendation_home_team', $16::text,
            'recommendation_away_team', $17::text,
            'recommendation_league', $18::text,
            'custom_condition_summary_en', $19::text,
            'custom_condition_summary_vi', $20::text,
            'custom_condition_reason_en', $21::text,
            'custom_condition_reason_vi', $22::text
          )),
          COALESCE($5::timestamptz, NOW())
       )
       RETURNING id, user_id`,
      [
        subscription.user_id,
        input.match_id,
        conditionText,
        evaluation.summary,
        input.timestamp ?? null,
        input.minute ?? null,
        input.score ?? null,
        input.selection ?? null,
        input.bet_market ?? null,
        input.confidence ?? null,
        input.risk_level ?? null,
        input.stake_percent ?? null,
        input.reasoning ?? null,
        input.reasoning_vi ?? null,
        input.warnings ?? null,
        input.home_team ?? null,
        input.away_team ?? null,
        input.league ?? null,
        input.condition_summary_en ?? null,
        input.condition_summary_vi ?? null,
        input.condition_reason_en ?? null,
        input.condition_reason_vi ?? null,
      ],
    );

    const row = result.rows[0];
    if (row) {
      created.push({ deliveryId: row.id, userId: row.user_id });
    }
  }

  return created;
}

export async function markDeliveryRowsDelivered(
  deliveryIds: number[],
  channel: string,
): Promise<number> {
  if (deliveryIds.length === 0) return 0;

  const result = await query(
    `UPDATE user_recommendation_deliveries
        SET delivery_status = 'delivered',
            delivered_at = COALESCE(delivered_at, NOW()),
            delivery_channels = CASE
              WHEN COALESCE(delivery_channels, '[]'::jsonb) @> jsonb_build_array($2::text) THEN COALESCE(delivery_channels, '[]'::jsonb)
              ELSE COALESCE(delivery_channels, '[]'::jsonb) || jsonb_build_array($2::text)
            END,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_delivery_channel', $2, 'last_delivery_at', NOW())
      WHERE id = ANY($1::bigint[])
        AND eligibility_status = 'eligible'`,
    [deliveryIds, channel],
  );

  return result.rowCount ?? 0;
}

export async function getRecommendationDeliveriesByUserId(
  userId: string,
  options: RecommendationDeliveryListOptions = {},
): Promise<{ rows: RecommendationDeliveryRow[]; total: number }> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const conditions = ['d.user_id = $1'];
  const params: unknown[] = [userId];
  let index = 2;

  if (!options.includeHidden) {
    conditions.push('d.hidden = FALSE');
  }
  if (options.matchId) {
    conditions.push(`d.match_id = $${index}`);
    params.push(options.matchId);
    index++;
  }
  if (options.eligibilityStatus) {
    conditions.push(`d.eligibility_status = $${index}`);
    params.push(options.eligibilityStatus);
    index++;
  }
  if (options.deliveryStatus) {
    conditions.push(`d.delivery_status = $${index}`);
    params.push(options.deliveryStatus);
    index++;
  }
  if (typeof options.dismissed === 'boolean') {
    conditions.push(`d.dismissed = $${index}`);
    params.push(options.dismissed);
    index++;
  }
  if (options.result) {
    if (options.result === 'pending') {
      conditions.push(`(r.result IS NULL OR r.result = '' OR r.result NOT IN ('win', 'loss', 'push', 'void', 'half_win', 'half_loss'))`);
    } else {
      conditions.push(`r.result = $${index}`);
      params.push(options.result);
      index++;
    }
  }
  if (options.betType) {
    conditions.push(`COALESCE(r.bet_type, NULLIF(d.metadata->>'recommendation_bet_type', '')) = $${index}`);
    params.push(options.betType);
    index++;
  }
  if (options.search) {
    conditions.push(`(
      COALESCE(r.home_team, NULLIF(d.metadata->>'recommendation_home_team', '')) ILIKE $${index}
      OR COALESCE(r.away_team, NULLIF(d.metadata->>'recommendation_away_team', '')) ILIKE $${index}
      OR COALESCE(r.selection, NULLIF(d.metadata->>'recommendation_selection', '')) ILIKE $${index}
    )`);
    params.push(`%${options.search}%`);
    index++;
  }
  if (options.league) {
    conditions.push(`COALESCE(r.league, NULLIF(d.metadata->>'recommendation_league', '')) = $${index}`);
    params.push(options.league);
    index++;
  }
  if (options.dateFrom) {
    conditions.push(`COALESCE(r.timestamp, d.created_at)::date >= $${index}::date`);
    params.push(options.dateFrom);
    index++;
  }
  if (options.dateTo) {
    conditions.push(`COALESCE(r.timestamp, d.created_at)::date <= $${index}::date`);
    params.push(options.dateTo);
    index++;
  }
  if (options.riskLevel) {
    conditions.push(`COALESCE(r.risk_level, NULLIF(d.metadata->>'recommendation_risk_level', '')) = $${index}`);
    params.push(options.riskLevel);
    index++;
  }

  const whereSql = `WHERE ${conditions.join(' AND ')}`;
  const sortMap: Record<string, string> = {
    time: 'COALESCE(r.timestamp, d.created_at)',
    odds: `COALESCE(r.odds, NULLIF(d.metadata->>'recommendation_odds', '')::numeric)`,
    confidence: `COALESCE(r.confidence, NULLIF(d.metadata->>'recommendation_confidence', '')::numeric)`,
    pnl: 'r.pnl',
    league: `COALESCE(r.league, NULLIF(d.metadata->>'recommendation_league', ''))`,
  };
  const sortCol = sortMap[options.sortBy ?? ''] ?? 'd.created_at';
  const sortDir = options.sortDir === 'asc' ? 'ASC' : 'DESC';
  const orderSql = `ORDER BY ${sortCol} ${sortDir} NULLS LAST, d.id DESC`;
  const dataParams = [...params, limit, offset];

  const [rowsResult, countResult] = await Promise.all([
    query<RecommendationDeliveryRow>(
      `SELECT
          d.*,
         COALESCE(r.timestamp, NULLIF(d.metadata->>'recommendation_timestamp', '')::timestamptz) AS recommendation_timestamp,
         COALESCE(r.minute, NULLIF(d.metadata->>'recommendation_minute', '')::integer) AS recommendation_minute,
         COALESCE(r.score, NULLIF(d.metadata->>'recommendation_score', '')) AS recommendation_score,
         COALESCE(r.bet_type, NULLIF(d.metadata->>'recommendation_bet_type', '')) AS recommendation_bet_type,
         COALESCE(r.selection, NULLIF(d.metadata->>'recommendation_selection', '')) AS recommendation_selection,
         COALESCE(r.bet_market, NULLIF(d.metadata->>'recommendation_bet_market', '')) AS recommendation_bet_market,
         COALESCE(r.odds, NULLIF(d.metadata->>'recommendation_odds', '')::numeric) AS recommendation_odds,
         COALESCE(r.confidence, NULLIF(d.metadata->>'recommendation_confidence', '')::numeric) AS recommendation_confidence,
         COALESCE(r.value_percent, NULLIF(d.metadata->>'recommendation_value_percent', '')::numeric) AS recommendation_value_percent,
         COALESCE(r.risk_level, NULLIF(d.metadata->>'recommendation_risk_level', '')) AS recommendation_risk_level,
         COALESCE(r.stake_percent, NULLIF(d.metadata->>'recommendation_stake_percent', '')::numeric) AS recommendation_stake_percent,
         COALESCE(r.reasoning, NULLIF(d.metadata->>'recommendation_reasoning', '')) AS recommendation_reasoning,
         COALESCE(r.reasoning_vi, NULLIF(d.metadata->>'recommendation_reasoning_vi', '')) AS recommendation_reasoning_vi,
         COALESCE(r.key_factors, NULLIF(d.metadata->>'recommendation_key_factors', '')) AS recommendation_key_factors,
         COALESCE(r.warnings, NULLIF(d.metadata->>'recommendation_warnings', '')) AS recommendation_warnings,
         COALESCE(r.home_team, NULLIF(d.metadata->>'recommendation_home_team', '')) AS recommendation_home_team,
         COALESCE(r.away_team, NULLIF(d.metadata->>'recommendation_away_team', '')) AS recommendation_away_team,
         COALESCE(r.league, NULLIF(d.metadata->>'recommendation_league', '')) AS recommendation_league,
          r.result AS recommendation_result,
          r.actual_outcome AS recommendation_actual_outcome,
          r.pnl AS recommendation_pnl
       FROM user_recommendation_deliveries d
       LEFT JOIN recommendations r ON r.id = d.recommendation_id
       ${whereSql}
       ${orderSql}
       LIMIT $${index} OFFSET $${index + 1}`,
      dataParams,
    ),
    query<DeliveryCountRow>(
      `SELECT COUNT(*)::text AS count
       FROM user_recommendation_deliveries d
       LEFT JOIN recommendations r ON r.id = d.recommendation_id
       ${whereSql}`,
      params,
    ),
  ]);

  return {
    rows: rowsResult.rows.map(mapDeliveryRow),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function getEligibleDeliveryUserIds(recommendationId: number): Promise<Set<string>> {
  const result = await query<{ user_id: string }>(
    `SELECT user_id
       FROM user_recommendation_deliveries
      WHERE recommendation_id = $1
        AND eligibility_status = 'eligible'
        AND delivery_status = 'pending'`,
    [recommendationId],
  );
  return new Set(result.rows.map((row) => row.user_id));
}

export async function getEligibleTelegramDeliveryTargets(recommendationId: number): Promise<EligibleTelegramDeliveryTarget[]> {
  const result = await query<EligibleTelegramDeliveryTargetRow>(
    `SELECT d.user_id,
            BTRIM(c.address) AS chat_id
       FROM user_recommendation_deliveries d
       JOIN user_notification_channel_configs c
         ON c.user_id = d.user_id
        AND c.channel_type = 'telegram'
      WHERE d.recommendation_id = $1
        AND d.eligibility_status = 'eligible'
        AND d.delivery_status = 'pending'
        AND c.enabled = TRUE
        AND c.status <> 'disabled'
        AND c.address IS NOT NULL
        AND BTRIM(c.address) <> ''`,
    [recommendationId],
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    chatId: row.chat_id,
  }));
}

export async function markRecommendationDeliveriesDelivered(
  recommendationId: number,
  userIds: string[],
  channel: string,
): Promise<number> {
  if (userIds.length === 0) return 0;

  const result = await query(
    `UPDATE user_recommendation_deliveries
        SET delivery_status = 'delivered',
            delivered_at = COALESCE(delivered_at, NOW()),
            delivery_channels = CASE
              WHEN COALESCE(delivery_channels, '[]'::jsonb) @> jsonb_build_array($3::text) THEN COALESCE(delivery_channels, '[]'::jsonb)
              ELSE COALESCE(delivery_channels, '[]'::jsonb) || jsonb_build_array($3::text)
            END,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_delivery_channel', $3, 'last_delivery_at', NOW())
      WHERE recommendation_id = $1
        AND user_id = ANY($2::uuid[])
        AND eligibility_status = 'eligible'
        AND delivery_status = 'pending'`,
    [recommendationId, userIds, channel],
  );

  return result.rowCount ?? 0;
}

export async function updateRecommendationDeliveryFlags(
  userId: string,
  deliveryId: number,
  flags: RecommendationDeliveryUpdateFlags,
): Promise<boolean> {
  const updates: string[] = [];
  const params: unknown[] = [userId, deliveryId];
  let index = 3;

  if (typeof flags.hidden === 'boolean') {
    updates.push(`hidden = $${index}`);
    params.push(flags.hidden);
    index++;
  }
  if (typeof flags.dismissed === 'boolean') {
    updates.push(`dismissed = $${index}`);
    params.push(flags.dismissed);
    index++;
  }

  if (updates.length === 0) return false;

  const result = await query(
    `UPDATE user_recommendation_deliveries
        SET ${updates.join(', ')}
      WHERE user_id = $1 AND id = $2`,
    params,
  );

  return (result.rowCount ?? 0) > 0;
}