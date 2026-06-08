import type { QueryResult, QueryResultRow } from 'pg';
import { query } from '../db/pool.js';
import { evaluateCustomConditionText, type ConditionStatsSnapshot } from '../lib/condition-evaluator.js';
import {
  attachBankrollMetadataForDeliveryIds,
} from './bankroll.repo.js';

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
  recommendation_stake_amount: number | null;
  bankroll_currency: string | null;
  bankroll_unit_multiplier: number | null;
  bankroll_balance_before: number | null;
  bankroll_balance_after: number | null;
  recommendation_reasoning: string | null;
  recommendation_reasoning_vi: string | null;
  recommendation_key_factors: string | null;
  recommendation_warnings: string | null;
  recommendation_home_team: string | null;
  recommendation_away_team: string | null;
  recommendation_league: string | null;
  recommendation_result: string | null;
  recommendation_settlement_status: string | null;
  recommendation_settlement_note: string | null;
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
  status?: string | null;
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
  ai_model?: string | null;
  mode?: string | null;
}

export type AnalysisSignalDeliveryKind = 'watch' | 'no_action';

export interface AnalysisSignalDeliveryStageInput {
  match_id: string;
  signal_kind: AnalysisSignalDeliveryKind;
  signal_label?: string | null;
  signal_detail?: string | null;
  timestamp?: string | null;
  minute?: number | null;
  score?: string | null;
  status?: string | null;
  league?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  selection?: string | null;
  bet_market?: string | null;
  odds?: number | null;
  confidence?: number | null;
  value_percent?: number | null;
  risk_level?: string | null;
  stake_percent?: number | null;
  reasoning?: string | null;
  reasoning_vi?: string | null;
  warnings?: string | null;
  ai_model?: string | null;
  mode?: string | null;
  prompt_version?: string | null;
  evidence_mode?: string | null;
  llm_decision_diagnostic?: string | null;
  market_resolution_status?: string | null;
  policy_warnings?: string[] | null;
  runtime_shadow?: Record<string, unknown> | null;
  dedupe_minutes?: number | null;
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
  deliveryKind?: 'actionable' | 'no_action' | 'all';
}

export interface RecommendationDeliveryListSummary {
  total: number;
  won: number;
  lost: number;
  push: number;
  voided: number;
  pending: number;
  review: number;
  pnl: number;
}

export interface RecommendationDeliveryChartPoint {
  idx: number;
  cumulative: number;
}

const FINAL_DELIVERY_RESULTS_SQL = `'win', 'loss', 'push', 'void', 'half_win', 'half_loss'`;
const DELIVERY_RESULT_SQL = `COALESCE(r.result, NULLIF(d.metadata->>'recommendation_result', ''))`;
const DELIVERY_PNL_SQL = `COALESCE(r.pnl, NULLIF(d.metadata->>'recommendation_pnl', '')::numeric, 0)`;
const DELIVERY_SAVED_RECOMMENDATION_SQL = `d.recommendation_id IS NOT NULL`;
const DELIVERY_WIN_SQL = `${DELIVERY_RESULT_SQL} IN ('win', 'half_win')`;
const DELIVERY_LOSS_SQL = `${DELIVERY_RESULT_SQL} IN ('loss', 'half_loss')`;
const DELIVERY_PENDING_SQL = `(${DELIVERY_RESULT_SQL} IS NULL OR ${DELIVERY_RESULT_SQL} = '' OR ${DELIVERY_RESULT_SQL} NOT IN (${FINAL_DELIVERY_RESULTS_SQL}))`;
const DELIVERY_REVIEW_SQL = `COALESCE(r.settlement_status, NULLIF(d.metadata->>'recommendation_settlement_status', ''), 'pending') = 'unresolved' AND ${DELIVERY_RESULT_SQL} IN (${FINAL_DELIVERY_RESULTS_SQL})`;
const DELIVERY_BET_WIN_SQL = `${DELIVERY_SAVED_RECOMMENDATION_SQL} AND ${DELIVERY_WIN_SQL}`;
const DELIVERY_BET_LOSS_SQL = `${DELIVERY_SAVED_RECOMMENDATION_SQL} AND ${DELIVERY_LOSS_SQL}`;
const DELIVERY_BET_PENDING_SQL = `${DELIVERY_SAVED_RECOMMENDATION_SQL} AND ${DELIVERY_PENDING_SQL}`;
const DELIVERY_BET_REVIEW_SQL = `${DELIVERY_SAVED_RECOMMENDATION_SQL} AND ${DELIVERY_REVIEW_SQL}`;
const DELIVERY_SELECTION_SQL = `COALESCE(r.selection, NULLIF(d.metadata->>'recommendation_selection', ''))`;
const DELIVERY_ODDS_SQL = `COALESCE(r.odds, NULLIF(d.metadata->>'recommendation_odds', '')::numeric)`;
const DELIVERY_STAKE_SQL = `COALESCE(r.stake_percent, NULLIF(d.metadata->>'recommendation_stake_percent', '')::numeric, 0)`;
const DELIVERY_ACTIONABLE_SQL = `(
  ${DELIVERY_SELECTION_SQL} IS NOT NULL
  AND BTRIM(${DELIVERY_SELECTION_SQL}) <> ''
  AND LOWER(BTRIM(${DELIVERY_SELECTION_SQL})) <> 'no bet'
  AND ${DELIVERY_ODDS_SQL} > 1
  AND ${DELIVERY_STAKE_SQL} > 0
)`;

function buildRecommendationDeliveryListFilters(
  userId: string,
  options: RecommendationDeliveryListOptions,
): { whereSql: string; params: unknown[]; nextIndex: number } {
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
  if (options.deliveryKind === 'actionable') {
    conditions.push(DELIVERY_ACTIONABLE_SQL);
  } else if (options.deliveryKind === 'no_action') {
    conditions.push(`NOT ${DELIVERY_ACTIONABLE_SQL}`);
  }
  if (typeof options.dismissed === 'boolean') {
    conditions.push(`d.dismissed = $${index}`);
    params.push(options.dismissed);
    index++;
  }
  if (options.result) {
    if (options.result === 'correct') {
      conditions.push(DELIVERY_BET_WIN_SQL);
    } else if (options.result === 'incorrect') {
      conditions.push(DELIVERY_BET_LOSS_SQL);
    } else if (options.result === 'neutral') {
      conditions.push(`${DELIVERY_SAVED_RECOMMENDATION_SQL} AND ${DELIVERY_RESULT_SQL} IN ('push', 'void')`);
    } else if (options.result === 'pending') {
      conditions.push(DELIVERY_BET_PENDING_SQL);
    } else if (options.result === 'review') {
      conditions.push(DELIVERY_BET_REVIEW_SQL);
    } else {
      conditions.push(`${DELIVERY_SAVED_RECOMMENDATION_SQL} AND ${DELIVERY_RESULT_SQL} = $${index}`);
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

  return { whereSql: `WHERE ${conditions.join(' AND ')}`, params, nextIndex: index };
}

export async function getRecommendationDeliveriesSummary(
  userId: string,
  options: RecommendationDeliveryListOptions = {},
): Promise<RecommendationDeliveryListSummary> {
  const { whereSql, params } = buildRecommendationDeliveryListFilters(userId, options);
  const r = await query<{
    total: string;
    won: string;
    lost: string;
    push: string;
    voided: string;
    pending: string;
    review: string;
    pnl: string;
  }>(
     `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE ${DELIVERY_BET_WIN_SQL})::text AS won,
       COUNT(*) FILTER (WHERE ${DELIVERY_BET_LOSS_SQL})::text AS lost,
       COUNT(*) FILTER (WHERE ${DELIVERY_SAVED_RECOMMENDATION_SQL} AND r.result = 'push')::text AS push,
       COUNT(*) FILTER (WHERE ${DELIVERY_SAVED_RECOMMENDATION_SQL} AND r.result = 'void')::text AS voided,
       COUNT(*) FILTER (WHERE ${DELIVERY_BET_PENDING_SQL})::text AS pending,
       COUNT(*) FILTER (WHERE ${DELIVERY_BET_REVIEW_SQL})::text AS review,
       COALESCE(SUM(${DELIVERY_PNL_SQL}) FILTER (WHERE ${DELIVERY_SAVED_RECOMMENDATION_SQL}), 0)::text AS pnl
     FROM user_recommendation_deliveries d
     LEFT JOIN recommendations r ON r.id = d.recommendation_id
     ${whereSql}`,
    params,
  );

  const row = r.rows[0]!;
  return {
    total: Number(row.total),
    won: Number(row.won),
    lost: Number(row.lost),
    push: Number(row.push),
    voided: Number(row.voided),
    pending: Number(row.pending),
    review: Number(row.review),
    pnl: Number(row.pnl),
  };
}

export async function getRecommendationDeliveriesChartSeries(
  userId: string,
  options: RecommendationDeliveryListOptions = {},
): Promise<RecommendationDeliveryChartPoint[]> {
  const { whereSql, params } = buildRecommendationDeliveryListFilters(userId, options);
  const r = await query<{ idx: string; cumulative: string }>(
    `SELECT
       ROW_NUMBER() OVER (ORDER BY COALESCE(r.timestamp, d.created_at) ASC, d.id ASC)::text AS idx,
       SUM(${DELIVERY_PNL_SQL}) OVER (
         ORDER BY COALESCE(r.timestamp, d.created_at) ASC, d.id ASC ROWS UNBOUNDED PRECEDING
       )::text AS cumulative
     FROM user_recommendation_deliveries d
     LEFT JOIN recommendations r ON r.id = d.recommendation_id
     ${whereSql}
       AND ${DELIVERY_SAVED_RECOMMENDATION_SQL}
       AND ${DELIVERY_RESULT_SQL} IN (${FINAL_DELIVERY_RESULTS_SQL})
       AND COALESCE(r.timestamp, d.created_at) IS NOT NULL
     ORDER BY COALESCE(r.timestamp, d.created_at) ASC, d.id ASC`,
    params,
  );

  return r.rows.map((row) => ({
    idx: Number(row.idx),
    cumulative: Number(row.cumulative),
  }));
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

export interface PendingTelegramDeliveryRow {
  deliveryId: number;
  userId: string;
  chatId: string;
  notificationLanguage: 'vi' | 'en' | 'both';
  recommendationId: number | null;
  matchId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  recommendationTimestamp: string | null;
  recommendationMinute: number | null;
  recommendationScore: string | null;
  recommendationBetType: string | null;
  recommendationSelection: string | null;
  recommendationBetMarket: string | null;
  recommendationOdds: number | null;
  recommendationConfidence: number | null;
  recommendationValuePercent: number | null;
  recommendationRiskLevel: string | null;
  recommendationStakePercent: number | null;
  recommendationStakeAmount: number | null;
  bankrollCurrency: string | null;
  bankrollUnitMultiplier: number | null;
  bankrollBalanceBefore: number | null;
  bankrollBalanceAfter: number | null;
  recommendationReasoning: string | null;
  recommendationReasoningVi: string | null;
  recommendationWarnings: string | null;
  recommendationHomeTeam: string | null;
  recommendationAwayTeam: string | null;
  recommendationLeague: string | null;
  recommendationStatus: string | null;
  recommendationAiModel: string | null;
  recommendationMode: string | null;
}

interface PendingTelegramDeliveryQueryRow {
  delivery_id: number;
  user_id: string;
  chat_id: string;
  notification_language: string | null;
  recommendation_id: number | null;
  match_id: string;
  metadata: Record<string, unknown> | null;
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
  recommendation_stake_amount: number | null;
  bankroll_currency: string | null;
  bankroll_unit_multiplier: number | null;
  bankroll_balance_before: number | null;
  bankroll_balance_after: number | null;
  recommendation_reasoning: string | null;
  recommendation_reasoning_vi: string | null;
  recommendation_warnings: string | null;
  recommendation_home_team: string | null;
  recommendation_away_team: string | null;
  recommendation_league: string | null;
  recommendation_status: string | null;
  recommendation_ai_model: string | null;
  recommendation_mode: string | null;
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

const rootQueryExecutor: QueryExecutor = { query };

async function recomputeParentDeliveryState(
  db: QueryExecutor,
  deliveryIds: number[],
): Promise<void> {
  if (deliveryIds.length === 0) return;

  await db.query(
    `WITH channel_summary AS (
          SELECT
            d.id AS delivery_id,
            COUNT(c.delivery_id)::int AS channel_count,
            COUNT(*) FILTER (WHERE c.status = 'delivered')::int AS delivered_count,
            COUNT(*) FILTER (WHERE c.status = 'pending')::int AS pending_count,
            COUNT(*) FILTER (WHERE c.status = 'failed')::int AS failed_count,
            COUNT(*) FILTER (WHERE c.status = 'suppressed')::int AS suppressed_count,
            COALESCE(
              jsonb_agg(c.channel_type ORDER BY c.channel_type) FILTER (WHERE c.status = 'delivered'),
              '[]'::jsonb
            ) AS delivered_channels,
            MAX(c.delivered_at) FILTER (WHERE c.status = 'delivered') AS last_delivered_at
          FROM user_recommendation_deliveries d
          LEFT JOIN user_recommendation_delivery_channels c
            ON c.delivery_id = d.id
         WHERE d.id = ANY($1::bigint[])
         GROUP BY d.id
       )
       UPDATE user_recommendation_deliveries d
          SET delivery_status = CASE
                WHEN s.channel_count = 0 THEN d.delivery_status
                WHEN s.delivered_count > 0 THEN 'delivered'
                WHEN s.pending_count > 0 THEN 'pending'
                WHEN s.failed_count > 0 THEN 'failed'
                WHEN s.suppressed_count = s.channel_count THEN 'suppressed'
                ELSE d.delivery_status
              END,
              delivery_channels = s.delivered_channels,
              delivered_at = CASE
                WHEN s.delivered_count > 0 THEN COALESCE(d.delivered_at, s.last_delivered_at, NOW())
                ELSE NULL
              END
         FROM channel_summary s
        WHERE d.id = s.delivery_id`,
    [deliveryIds],
  );
}

async function syncDeliveryChannelStates(
  db: QueryExecutor,
  deliveryIds: number[],
): Promise<void> {
  if (deliveryIds.length === 0) return;

  await db.query(
    `WITH target_deliveries AS (
          SELECT d.id, d.user_id, d.eligibility_status, d.delivery_status
            FROM user_recommendation_deliveries d
           WHERE d.id = ANY($1::bigint[])
       ),
       desired_channels AS (
          SELECT
            td.id AS delivery_id,
            'telegram'::text AS channel_type,
            CASE
              WHEN td.eligibility_status <> 'eligible' OR td.delivery_status = 'suppressed' THEN 'suppressed'
              ELSE 'pending'
            END AS status
          FROM target_deliveries td
          JOIN user_notification_channel_configs c
            ON c.user_id = td.user_id
           AND c.channel_type = 'telegram'
           AND c.enabled = TRUE
           AND c.status <> 'disabled'
           AND c.address IS NOT NULL
           AND BTRIM(c.address) <> ''
          UNION ALL
          SELECT
            td.id AS delivery_id,
            'web_push'::text AS channel_type,
            CASE
              WHEN td.eligibility_status <> 'eligible' OR td.delivery_status = 'suppressed' THEN 'suppressed'
              WHEN EXISTS (
                SELECT 1
                  FROM user_notification_channel_configs wp
                 WHERE wp.user_id = td.user_id
                   AND wp.channel_type = 'web_push'
                   AND (wp.enabled = FALSE OR wp.status = 'disabled')
              ) THEN 'suppressed'
              ELSE 'pending'
            END AS status
          FROM target_deliveries td
          JOIN LATERAL (
            SELECT 1
              FROM push_subscriptions ps
             WHERE ps.user_id = td.user_id::text
             LIMIT 1
          ) active_push ON TRUE
       )
       INSERT INTO user_recommendation_delivery_channels (
         delivery_id,
         channel_type,
         status,
         metadata,
         created_at,
         updated_at
       )
       SELECT
         dc.delivery_id,
         dc.channel_type,
         dc.status,
         '{}'::jsonb,
         NOW(),
         NOW()
       FROM desired_channels dc
       ON CONFLICT (delivery_id, channel_type) DO UPDATE
         SET status = CASE
               WHEN user_recommendation_delivery_channels.status = 'delivered' AND EXCLUDED.status = 'pending'
                 THEN user_recommendation_delivery_channels.status
               ELSE EXCLUDED.status
             END,
             updated_at = NOW(),
             last_error = CASE
               WHEN EXCLUDED.status = 'pending' THEN NULL
               ELSE user_recommendation_delivery_channels.last_error
             END`,
    [deliveryIds],
  );

  await db.query(
    `UPDATE user_recommendation_delivery_channels c
          SET status = 'suppressed',
              updated_at = NOW()
         FROM user_recommendation_deliveries d
        WHERE d.id = c.delivery_id
          AND d.id = ANY($1::bigint[])
          AND c.status <> 'delivered'
          AND (d.eligibility_status <> 'eligible' OR d.delivery_status = 'suppressed')`,
    [deliveryIds],
  );

  await recomputeParentDeliveryState(db, deliveryIds);
}

async function markDeliveryChannelRowsDelivered(
  db: QueryExecutor,
  deliveryIds: number[],
  channel: string,
): Promise<number> {
  if (deliveryIds.length === 0) return 0;

  const result = await db.query<{ delivery_id: number }>(
    `UPDATE user_recommendation_delivery_channels
          SET status = 'delivered',
              delivered_at = COALESCE(delivered_at, NOW()),
              last_attempt_at = NOW(),
              attempt_count = attempt_count + 1,
              last_error = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_delivery_channel', $2, 'last_delivery_at', NOW()),
              updated_at = NOW()
        WHERE delivery_id = ANY($1::bigint[])
          AND channel_type = $2
          AND status <> 'delivered'
      RETURNING delivery_id`,
    [deliveryIds, channel],
  );

  const updatedDeliveryIds = Array.from(new Set(result.rows.map((row) => Number(row.delivery_id))));
  if (updatedDeliveryIds.length === 0) return 0;

  await db.query(
    `UPDATE user_recommendation_deliveries
          SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_delivery_channel', $2, 'last_delivery_at', NOW())
        WHERE id = ANY($1::bigint[])`,
    [updatedDeliveryIds, channel],
  );

  await recomputeParentDeliveryState(db, updatedDeliveryIds);

  return updatedDeliveryIds.length;
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

  const stagedRows = await db.query<{ id: number }>(
    'SELECT id FROM user_recommendation_deliveries WHERE recommendation_id = $1',
    [recommendation.id],
  );
  const stagedDeliveryIds = Array.isArray(stagedRows.rows) ? stagedRows.rows.map((row) => Number(row.id)) : [];
  await attachBankrollMetadataForDeliveryIds(db, stagedDeliveryIds);
  await syncDeliveryChannelStates(db, stagedDeliveryIds);

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
  const updatedDeliveryIds: number[] = [];

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
    if ((result.rowCount ?? 0) > 0) {
      updatedDeliveryIds.push(Number(row.id));
    }
  }

  await attachBankrollMetadataForDeliveryIds(db, updatedDeliveryIds);
  await syncDeliveryChannelStates(db, updatedDeliveryIds);

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
            'recommendation_status', $8::text,
            'recommendation_bet_type', 'CONDITION_ONLY',
            'recommendation_selection', $9::text,
            'recommendation_bet_market', $10::text,
            'recommendation_confidence', $11::numeric,
            'recommendation_risk_level', $12::text,
            'recommendation_stake_percent', $13::numeric,
            'recommendation_reasoning', $14::text,
            'recommendation_reasoning_vi', $15::text,
            'recommendation_warnings', $16::text,
            'recommendation_home_team', $17::text,
            'recommendation_away_team', $18::text,
            'recommendation_league', $19::text,
            'custom_condition_summary_en', $20::text,
            'custom_condition_summary_vi', $21::text,
            'custom_condition_reason_en', $22::text,
            'custom_condition_reason_vi', $23::text,
            'recommendation_ai_model', $24::text,
            'recommendation_mode', $25::text
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
        input.status ?? null,
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
        input.ai_model ?? null,
        input.mode ?? null,
      ],
    );

    const row = result.rows[0];
    if (row) {
      created.push({ deliveryId: row.id, userId: row.user_id });
    }
  }

  await syncDeliveryChannelStates(db, created.map((row) => row.deliveryId));

  await attachBankrollMetadataForDeliveryIds(db, created.map((row) => row.deliveryId));
  return created;
}

export async function stageAnalysisSignalDeliveries(
  db: QueryExecutor,
  input: AnalysisSignalDeliveryStageInput,
): Promise<ConditionOnlyDeliveryTarget[]> {
  const deliveryKind = input.signal_kind === 'watch' ? 'watch_signal' : 'no_action';
  const signalLabel = normalizeNullableString(input.signal_label)
    ?? (input.signal_kind === 'watch' ? 'Watch' : 'No Action');
  const signalDetail = normalizeNullableString(input.signal_detail)
    ?? (input.signal_kind === 'watch' ? 'Watch candidate; no bet staged.' : 'No actionable signal.');
  const selection = normalizeNullableString(input.selection)
    ?? (input.signal_kind === 'watch' ? 'Watch signal' : 'No actionable signal');
  const dedupeMinutes = Math.max(1, Math.min(180, Number(input.dedupe_minutes ?? 10) || 10));

  const subscriptions = await db.query<{ user_id: string }>(
    `SELECT DISTINCT user_id
       FROM user_watch_subscriptions
      WHERE match_id = $1`,
    [input.match_id],
  );

  const created: ConditionOnlyDeliveryTarget[] = [];

  for (const subscription of subscriptions.rows) {
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
       SELECT
          $1,
          NULL,
          $2,
          FALSE,
          'informational',
          'suppressed',
          '[]'::jsonb,
          jsonb_strip_nulls(jsonb_build_object(
            'delivery_kind', $3::text,
            'signal_kind', $4::text,
            'signal_label', $5::text,
            'signal_detail', $6::text,
            'recommendation_timestamp', $7::text,
            'recommendation_minute', $8::integer,
            'recommendation_score', $9::text,
            'recommendation_status', $10::text,
            'recommendation_bet_type', $11::text,
            'recommendation_selection', $12::text,
            'recommendation_bet_market', $13::text,
            'recommendation_odds', $14::numeric,
            'recommendation_confidence', $15::numeric,
            'recommendation_value_percent', $16::numeric,
            'recommendation_risk_level', $17::text,
            'recommendation_stake_percent', $18::numeric,
            'recommendation_reasoning', $19::text,
            'recommendation_reasoning_vi', $20::text,
            'recommendation_warnings', $21::text,
            'recommendation_home_team', $22::text,
            'recommendation_away_team', $23::text,
            'recommendation_league', $24::text,
            'recommendation_ai_model', $25::text,
            'recommendation_mode', $26::text,
            'prompt_version', $27::text,
            'evidence_mode', $28::text,
            'llm_decision_diagnostic', $29::text,
            'market_resolution_status', $30::text,
            'policy_warnings', $31::jsonb,
            'runtime_policy_shadow', $32::jsonb
          )),
          COALESCE($7::timestamptz, NOW())
        WHERE NOT EXISTS (
          SELECT 1
            FROM user_recommendation_deliveries existing
           WHERE existing.user_id = $1
             AND existing.match_id = $2
             AND existing.recommendation_id IS NULL
             AND existing.metadata->>'delivery_kind' = $3
             AND existing.created_at > NOW() - make_interval(mins => $33::integer)
        )
       RETURNING id, user_id`,
      [
        subscription.user_id,
        input.match_id,
        deliveryKind,
        input.signal_kind,
        signalLabel,
        signalDetail,
        input.timestamp ?? null,
        input.minute ?? null,
        input.score ?? null,
        input.status ?? null,
        input.signal_kind === 'watch' ? 'WATCH_SIGNAL' : 'NO_ACTION',
        selection,
        input.bet_market ?? null,
        input.odds ?? null,
        input.confidence ?? null,
        input.value_percent ?? null,
        input.risk_level ?? null,
        input.stake_percent ?? null,
        input.reasoning ?? null,
        input.reasoning_vi ?? null,
        input.warnings ?? null,
        input.home_team ?? null,
        input.away_team ?? null,
        input.league ?? null,
        input.ai_model ?? null,
        input.mode ?? null,
        input.prompt_version ?? null,
        input.evidence_mode ?? null,
        input.llm_decision_diagnostic ?? null,
        input.market_resolution_status ?? null,
        JSON.stringify(input.policy_warnings ?? []),
        JSON.stringify(input.runtime_shadow ?? {}),
        dedupeMinutes,
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
  return markDeliveryChannelRowsDelivered(rootQueryExecutor, deliveryIds, channel);
}

export async function markDeliveryRowsFailed(
  deliveryIds: number[],
  channel: string,
  error: string,
): Promise<number> {
  const ids = deliveryIds.filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return 0;

  const result = await query<{ delivery_id: number }>(
    `UPDATE user_recommendation_delivery_channels
          SET status = CASE
                WHEN attempt_count + 1 >= 3 THEN 'failed'
                ELSE status
              END,
              last_attempt_at = NOW(),
              attempt_count = attempt_count + 1,
              last_error = $3,
              updated_at = NOW()
        WHERE delivery_id = ANY($1::bigint[])
          AND channel_type = $2
          AND status <> 'delivered'
      RETURNING delivery_id`,
    [ids, channel, error.slice(0, 1000)],
  );

  const updatedDeliveryIds = Array.from(new Set(result.rows.map((row) => Number(row.delivery_id))));
  await recomputeParentDeliveryState(rootQueryExecutor, updatedDeliveryIds);

  return updatedDeliveryIds.length;
}

export async function getRecommendationDeliveriesByUserId(
  userId: string,
  options: RecommendationDeliveryListOptions = {},
): Promise<{ rows: RecommendationDeliveryRow[]; total: number }> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const { whereSql, params, nextIndex: index } = buildRecommendationDeliveryListFilters(userId, options);
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
         NULLIF(d.metadata->>'stake_amount', '')::numeric AS recommendation_stake_amount,
         NULLIF(d.metadata->>'bankroll_currency', '') AS bankroll_currency,
         NULLIF(d.metadata->>'bankroll_unit_multiplier', '')::integer AS bankroll_unit_multiplier,
         NULLIF(d.metadata->>'bankroll_balance_before', '')::numeric AS bankroll_balance_before,
         NULLIF(d.metadata->>'bankroll_balance_after', '')::numeric AS bankroll_balance_after,
         COALESCE(r.reasoning, NULLIF(d.metadata->>'recommendation_reasoning', '')) AS recommendation_reasoning,
         COALESCE(r.reasoning_vi, NULLIF(d.metadata->>'recommendation_reasoning_vi', '')) AS recommendation_reasoning_vi,
         COALESCE(r.key_factors, NULLIF(d.metadata->>'recommendation_key_factors', '')) AS recommendation_key_factors,
         COALESCE(r.warnings, NULLIF(d.metadata->>'recommendation_warnings', '')) AS recommendation_warnings,
         COALESCE(r.home_team, NULLIF(d.metadata->>'recommendation_home_team', '')) AS recommendation_home_team,
         COALESCE(r.away_team, NULLIF(d.metadata->>'recommendation_away_team', '')) AS recommendation_away_team,
         COALESCE(r.league, NULLIF(d.metadata->>'recommendation_league', '')) AS recommendation_league,
         ${DELIVERY_RESULT_SQL} AS recommendation_result,
         COALESCE(r.settlement_status, NULLIF(d.metadata->>'recommendation_settlement_status', '')) AS recommendation_settlement_status,
         r.settlement_note AS recommendation_settlement_note,
         COALESCE(r.actual_outcome, NULLIF(d.metadata->>'recommendation_actual_outcome', '')) AS recommendation_actual_outcome,
         ${DELIVERY_PNL_SQL} AS recommendation_pnl
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
    `SELECT DISTINCT d.user_id
       FROM user_recommendation_deliveries d
       JOIN user_recommendation_delivery_channels c
         ON c.delivery_id = d.id
        AND c.channel_type = 'web_push'
      WHERE d.recommendation_id = $1
        AND d.eligibility_status = 'eligible'
        AND c.status = 'pending'
        AND NOT EXISTS (
          SELECT 1
            FROM user_notification_channel_configs wp
           WHERE wp.user_id = d.user_id
             AND wp.channel_type = 'web_push'
             AND (wp.enabled = FALSE OR wp.status = 'disabled')
        )`,
    [recommendationId],
  );
  return new Set(result.rows.map((row) => row.user_id));
}

export async function getEligibleTelegramDeliveryTargets(recommendationId: number): Promise<EligibleTelegramDeliveryTarget[]> {
  const result = await query<EligibleTelegramDeliveryTargetRow>(
    `SELECT DISTINCT d.user_id,
              BTRIM(cfg.address) AS chat_id
         FROM user_recommendation_deliveries d
         JOIN user_recommendation_delivery_channels c
           ON c.delivery_id = d.id
          AND c.channel_type = 'telegram'
          AND c.status = 'pending'
         JOIN user_notification_channel_configs cfg
           ON cfg.user_id = d.user_id
          AND cfg.channel_type = 'telegram'
        WHERE d.recommendation_id = $1
          AND d.eligibility_status = 'eligible'
          AND cfg.enabled = TRUE
          AND cfg.status <> 'disabled'
          AND cfg.address IS NOT NULL
          AND BTRIM(cfg.address) <> ''`,
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

  const result = await query<{ id: number }>(
    `SELECT d.id
       FROM user_recommendation_deliveries d
       JOIN user_recommendation_delivery_channels c
         ON c.delivery_id = d.id
        AND c.channel_type = $3
        AND c.status = 'pending'
      WHERE d.recommendation_id = $1
        AND d.user_id = ANY($2::uuid[])
        AND d.eligibility_status = 'eligible'`,
    [recommendationId, userIds, channel],
  );

  return markDeliveryChannelRowsDelivered(
    rootQueryExecutor,
    Array.isArray(result.rows) ? result.rows.map((row) => Number(row.id)) : [],
    channel,
  );
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

export async function purgeOldDeliveries(keepDays: number): Promise<number> {
  if (keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM user_recommendation_deliveries WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}

export async function getPendingTelegramDeliveries(limit = 20): Promise<PendingTelegramDeliveryRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const result = await query<PendingTelegramDeliveryQueryRow>(
    `SELECT
        d.id AS delivery_id,
        d.user_id,
        BTRIM(cfg.address) AS chat_id,
        ns.notification_language,
        d.recommendation_id,
        d.match_id,
        d.metadata,
        d.created_at::text,
        COALESCE(r.timestamp::text, NULLIF(d.metadata->>'recommendation_timestamp', '')) AS recommendation_timestamp,
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
        NULLIF(d.metadata->>'stake_amount', '')::numeric AS recommendation_stake_amount,
        NULLIF(d.metadata->>'bankroll_currency', '') AS bankroll_currency,
        NULLIF(d.metadata->>'bankroll_unit_multiplier', '')::integer AS bankroll_unit_multiplier,
        NULLIF(d.metadata->>'bankroll_balance_before', '')::numeric AS bankroll_balance_before,
        NULLIF(d.metadata->>'bankroll_balance_after', '')::numeric AS bankroll_balance_after,
        COALESCE(r.reasoning, NULLIF(d.metadata->>'recommendation_reasoning', '')) AS recommendation_reasoning,
        COALESCE(r.reasoning_vi, NULLIF(d.metadata->>'recommendation_reasoning_vi', '')) AS recommendation_reasoning_vi,
        COALESCE(r.warnings, NULLIF(d.metadata->>'recommendation_warnings', '')) AS recommendation_warnings,
        COALESCE(r.home_team, NULLIF(d.metadata->>'recommendation_home_team', '')) AS recommendation_home_team,
        COALESCE(r.away_team, NULLIF(d.metadata->>'recommendation_away_team', '')) AS recommendation_away_team,
        COALESCE(r.league, NULLIF(d.metadata->>'recommendation_league', '')) AS recommendation_league,
        r.status AS recommendation_status,
        r.ai_model AS recommendation_ai_model,
        r.mode AS recommendation_mode
      FROM user_recommendation_deliveries d
      JOIN user_recommendation_delivery_channels c
        ON c.delivery_id = d.id
       AND c.channel_type = 'telegram'
       AND c.status = 'pending'
      JOIN user_notification_channel_configs cfg
        ON cfg.user_id = d.user_id
       AND cfg.channel_type = 'telegram'
       AND cfg.enabled = TRUE
       AND cfg.status <> 'disabled'
       AND cfg.address IS NOT NULL
       AND BTRIM(cfg.address) <> ''
      LEFT JOIN user_notification_settings ns
        ON ns.user_id = d.user_id::text
      LEFT JOIN recommendations r
        ON r.id = d.recommendation_id
      WHERE d.eligibility_status = 'eligible'
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT $1`,
    [safeLimit],
  );

  return result.rows.map((row) => ({
    deliveryId: row.delivery_id,
    userId: row.user_id,
    chatId: row.chat_id,
    notificationLanguage: row.notification_language === 'en' || row.notification_language === 'both' || row.notification_language === 'vi'
      ? row.notification_language
      : 'vi',
    recommendationId: row.recommendation_id,
    matchId: row.match_id,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.created_at,
    recommendationTimestamp: row.recommendation_timestamp,
    recommendationMinute: row.recommendation_minute,
    recommendationScore: row.recommendation_score,
    recommendationBetType: row.recommendation_bet_type,
    recommendationSelection: row.recommendation_selection,
    recommendationBetMarket: row.recommendation_bet_market,
    recommendationOdds: row.recommendation_odds,
    recommendationConfidence: row.recommendation_confidence,
    recommendationValuePercent: row.recommendation_value_percent,
    recommendationRiskLevel: row.recommendation_risk_level,
    recommendationStakePercent: row.recommendation_stake_percent,
    recommendationStakeAmount: row.recommendation_stake_amount,
    bankrollCurrency: row.bankroll_currency,
    bankrollUnitMultiplier: row.bankroll_unit_multiplier,
    bankrollBalanceBefore: row.bankroll_balance_before,
    bankrollBalanceAfter: row.bankroll_balance_after,
    recommendationReasoning: row.recommendation_reasoning,
    recommendationReasoningVi: row.recommendation_reasoning_vi,
    recommendationWarnings: row.recommendation_warnings,
    recommendationHomeTeam: row.recommendation_home_team,
    recommendationAwayTeam: row.recommendation_away_team,
    recommendationLeague: row.recommendation_league,
    recommendationStatus: row.recommendation_status,
    recommendationAiModel: row.recommendation_ai_model,
    recommendationMode: row.recommendation_mode,
  }));
}
