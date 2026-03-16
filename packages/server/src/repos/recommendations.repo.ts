// ============================================================
// Recommendations Repository
// ============================================================

import { query, transaction } from '../db/pool.js';

export interface RecommendationRow {
  id: number;
  unique_key: string;
  match_id: string;
  timestamp: string;
  league: string;
  home_team: string;
  away_team: string;
  status: string;
  condition_triggered_suggestion: string;
  custom_condition_raw: string;
  execution_id: string;
  odds_snapshot: string;
  stats_snapshot: string;
  pre_match_prediction_summary: string;
  custom_condition_matched: boolean;
  minute: number | null;
  score: string;
  bet_type: string;
  selection: string;
  odds: number | null;
  confidence: number | null;
  value_percent: number | null;
  risk_level: string;
  stake_percent: number | null;
  stake_amount: number | null;
  reasoning: string;
  key_factors: string;
  warnings: string;
  ai_model: string;
  mode: string;
  bet_market: string;
  notified: string;
  notification_channels: string;
  result: string;
  actual_outcome: string;
  pnl: number;
  settled_at: string | null;
  _was_overridden: boolean;
}

export type RecommendationCreate = Omit<RecommendationRow, 'id'>;

interface PaginationOpts {
  limit?: number;
  offset?: number;
}

export async function getAllRecommendations(opts: PaginationOpts = {}): Promise<{
  rows: RecommendationRow[];
  total: number;
}> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [data, countRes] = await Promise.all([
    query<RecommendationRow>(
      'SELECT * FROM recommendations ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    ),
    query<{ count: string }>('SELECT COUNT(*)::text as count FROM recommendations'),
  ]);

  return { rows: data.rows, total: Number(countRes.rows[0]?.count ?? 0) };
}

export async function getRecommendationsByMatchId(matchId: string): Promise<RecommendationRow[]> {
  const r = await query<RecommendationRow>(
    'SELECT * FROM recommendations WHERE match_id = $1 ORDER BY timestamp DESC',
    [matchId],
  );
  return r.rows;
}

export async function createRecommendation(
  rec: Partial<RecommendationCreate>,
): Promise<RecommendationRow> {
  const r = await query<RecommendationRow>(
    `INSERT INTO recommendations (
       unique_key, match_id, timestamp, league, home_team, away_team, status,
       condition_triggered_suggestion, custom_condition_raw, execution_id,
       odds_snapshot, stats_snapshot, pre_match_prediction_summary, custom_condition_matched,
       minute, score, bet_type, selection, odds, confidence, value_percent, risk_level,
       stake_percent, stake_amount, reasoning, key_factors, warnings,
       ai_model, mode, bet_market, notified, notification_channels,
       result, actual_outcome, pnl, settled_at, _was_overridden
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37
     )
     ON CONFLICT (unique_key) DO NOTHING
     RETURNING *`,
    [
      rec.unique_key ?? `${rec.match_id}_${rec.timestamp}`,
      rec.match_id,
      rec.timestamp,
      rec.league ?? '',
      rec.home_team ?? '',
      rec.away_team ?? '',
      rec.status ?? '',
      rec.condition_triggered_suggestion ?? '',
      rec.custom_condition_raw ?? '',
      rec.execution_id ?? '',
      rec.odds_snapshot ?? '',
      rec.stats_snapshot ?? '',
      rec.pre_match_prediction_summary ?? '',
      rec.custom_condition_matched ?? false,
      rec.minute ?? null,
      rec.score ?? '',
      rec.bet_type ?? '',
      rec.selection ?? '',
      rec.odds ?? null,
      rec.confidence ?? null,
      rec.value_percent ?? null,
      rec.risk_level ?? 'HIGH',
      rec.stake_percent ?? null,
      rec.stake_amount ?? null,
      rec.reasoning ?? '',
      rec.key_factors ?? '',
      rec.warnings ?? '',
      rec.ai_model ?? '',
      rec.mode ?? 'B',
      rec.bet_market ?? '',
      rec.notified ?? '',
      rec.notification_channels ?? '',
      rec.result ?? '',
      rec.actual_outcome ?? '',
      rec.pnl ?? 0,
      rec.settled_at ?? null,
      rec._was_overridden ?? false,
    ],
  );
  return r.rows[0]!;
}

export async function bulkCreateRecommendations(
  recs: Partial<RecommendationCreate>[],
): Promise<number> {
  return transaction(async (client) => {
    let inserted = 0;
    for (const rec of recs) {
      const result = await client.query(
        `INSERT INTO recommendations (
           unique_key, match_id, timestamp, league, home_team, away_team, status,
           condition_triggered_suggestion, custom_condition_raw, execution_id,
           odds_snapshot, stats_snapshot, pre_match_prediction_summary, custom_condition_matched,
           minute, score, bet_type, selection, odds, confidence, value_percent, risk_level,
           stake_percent, stake_amount, reasoning, key_factors, warnings,
           ai_model, mode, bet_market, notified, notification_channels,
           result, actual_outcome, pnl, settled_at, _was_overridden
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
           $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37
         )
         ON CONFLICT (unique_key) DO NOTHING`,
        [
          rec.unique_key ?? `${rec.match_id}_${rec.timestamp}`,
          rec.match_id,
          rec.timestamp,
          rec.league ?? '',
          rec.home_team ?? '',
          rec.away_team ?? '',
          rec.status ?? '',
          rec.condition_triggered_suggestion ?? '',
          rec.custom_condition_raw ?? '',
          rec.execution_id ?? '',
          rec.odds_snapshot ?? '',
          rec.stats_snapshot ?? '',
          rec.pre_match_prediction_summary ?? '',
          rec.custom_condition_matched ?? false,
          rec.minute ?? null,
          rec.score ?? '',
          rec.bet_type ?? '',
          rec.selection ?? '',
          rec.odds ?? null,
          rec.confidence ?? null,
          rec.value_percent ?? null,
          rec.risk_level ?? 'HIGH',
          rec.stake_percent ?? null,
          rec.stake_amount ?? null,
          rec.reasoning ?? '',
          rec.key_factors ?? '',
          rec.warnings ?? '',
          rec.ai_model ?? '',
          rec.mode ?? 'B',
          rec.bet_market ?? '',
          rec.notified ?? '',
          rec.notification_channels ?? '',
          rec.result ?? '',
          rec.actual_outcome ?? '',
          rec.pnl ?? 0,
          rec.settled_at ?? null,
          rec._was_overridden ?? false,
        ],
      );
      if ((result.rowCount ?? 0) > 0) inserted++;
    }
    return inserted;
  });
}

export async function settleRecommendation(
  id: number,
  result: string,
  pnl: number,
  actualOutcome: string = '',
): Promise<RecommendationRow | null> {
  const r = await query<RecommendationRow>(
    `UPDATE recommendations SET result = $2, pnl = $3, actual_outcome = $4, settled_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, result, pnl, actualOutcome],
  );
  return r.rows[0] ?? null;
}

interface RecStats {
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  duplicates: number;
  unsettled: number;
  total_pnl: number;
  win_rate: number;
}

export async function getStats(): Promise<RecStats> {
  const r = await query<{
    total: string;
    wins: string;
    losses: string;
    pushes: string;
    duplicates: string;
    unsettled: string;
    total_pnl: string;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE result = 'win')::text AS wins,
       COUNT(*) FILTER (WHERE result = 'loss')::text AS losses,
       COUNT(*) FILTER (WHERE result = 'push')::text AS pushes,
       COUNT(*) FILTER (WHERE result = 'duplicate')::text AS duplicates,
       COUNT(*) FILTER (WHERE result = '' OR result IS NULL)::text AS unsettled,
       COALESCE(SUM(pnl), 0)::text AS total_pnl
     FROM recommendations`,
  );

  const row = r.rows[0]!;
  const total = Number(row.total);
  const wins = Number(row.wins);
  const settled = wins + Number(row.losses) + Number(row.pushes);

  return {
    total,
    wins,
    losses: Number(row.losses),
    pushes: Number(row.pushes),
    duplicates: Number(row.duplicates),
    unsettled: Number(row.unsettled),
    total_pnl: Number(row.total_pnl),
    win_rate: settled > 0 ? Math.round((wins / settled) * 100) : 0,
  };
}
