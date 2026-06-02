import { query } from '../db/pool.js';
import type {
  ThesisWatchAuditSnapshot,
  ThesisWatchIntent,
  ThesisWatchPromoteReason,
  ThesisWatchRow,
} from '../lib/thesis-watch-types.js';

function mapRow(row: Record<string, unknown>): ThesisWatchRow {
  return {
    id: Number(row.id),
    match_id: String(row.match_id ?? ''),
    watch_key: String(row.watch_key ?? ''),
    status: String(row.status ?? 'pending') as ThesisWatchRow['status'],
    gate_type: String(row.gate_type ?? '') as ThesisWatchRow['gate_type'],
    gate_payload: (row.gate_payload ?? {}) as ThesisWatchRow['gate_payload'],
    selection: String(row.selection ?? ''),
    bet_market: String(row.bet_market ?? ''),
    confidence: Number(row.confidence ?? 0),
    value_percent: Number(row.value_percent ?? 0),
    stake_percent: Number(row.stake_percent ?? 0),
    risk_level: String(row.risk_level ?? 'MEDIUM'),
    reasoning_en: String(row.reasoning_en ?? ''),
    reasoning_vi: String(row.reasoning_vi ?? ''),
    source: String(row.source ?? 'llp_defer'),
    last_block_reason: String(row.last_block_reason ?? ''),
    initial_snapshot: (row.initial_snapshot ?? {}) as ThesisWatchAuditSnapshot,
    promote_snapshot: (row.promote_snapshot ?? {}) as ThesisWatchAuditSnapshot,
    promote_reason: (row.promote_reason ?? {}) as ThesisWatchPromoteReason,
    promoted_recommendation_id: row.promoted_recommendation_id != null
      ? Number(row.promoted_recommendation_id)
      : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    expires_at: String(row.expires_at ?? ''),
    promoted_at: row.promoted_at != null ? String(row.promoted_at) : null,
  };
}

export async function upsertPendingThesisWatch(
  matchId: string,
  intent: ThesisWatchIntent,
  expiresAt: Date,
): Promise<ThesisWatchRow> {
  await query(
    `DELETE FROM match_thesis_watch
     WHERE match_id = $1 AND watch_key = $2 AND status = 'pending'`,
    [matchId, intent.watchKey],
  );
  const result = await query<Record<string, unknown>>(
    `INSERT INTO match_thesis_watch (
      match_id, watch_key, status, gate_type, gate_payload,
      selection, bet_market, confidence, value_percent, stake_percent,
      risk_level, reasoning_en, reasoning_vi, source, last_block_reason,
      initial_snapshot, expires_at, updated_at
    ) VALUES (
      $1, $2, 'pending', $3, $4::jsonb,
      $5, $6, $7, $8, $9,
      $10, $11, $12, 'llp_defer', $13,
      $14::jsonb, $15, NOW()
    )
    RETURNING *`,
    [
      matchId,
      intent.watchKey,
      intent.gateType,
      JSON.stringify(intent.gatePayload),
      intent.selection,
      intent.betMarket,
      intent.confidence,
      intent.valuePercent,
      intent.stakePercent,
      intent.riskLevel,
      intent.reasoningEn,
      intent.reasoningVi,
      intent.lastBlockReason,
      JSON.stringify(intent.initialSnapshot ?? {}),
      expiresAt.toISOString(),
    ],
  );
  return mapRow(result.rows[0] ?? {});
}

export async function getPendingThesisWatchesByMatchId(matchId: string): Promise<ThesisWatchRow[]> {
  const result = await query<Record<string, unknown>>(
    `SELECT *
     FROM match_thesis_watch
     WHERE match_id = $1
       AND status = 'pending'
       AND expires_at > NOW()
     ORDER BY updated_at DESC`,
    [matchId],
  );
  return result.rows.map(mapRow);
}

export async function markThesisWatchPromoted(
  id: number,
  details: {
    recommendationId?: number | null;
    promoteSnapshot?: ThesisWatchAuditSnapshot;
    promoteReason?: ThesisWatchPromoteReason;
  } = {},
): Promise<void> {
  await query(
    `UPDATE match_thesis_watch
     SET status = 'promoted',
         promoted_at = NOW(),
         updated_at = NOW(),
         promoted_recommendation_id = $2,
         promote_snapshot = $3::jsonb,
         promote_reason = $4::jsonb
     WHERE id = $1`,
    [
      id,
      details.recommendationId ?? null,
      JSON.stringify(details.promoteSnapshot ?? {}),
      JSON.stringify(details.promoteReason ?? {}),
    ],
  );
}

export async function expirePendingThesisWatchesForMatch(matchId: string): Promise<void> {
  await query(
    `UPDATE match_thesis_watch
     SET status = 'expired', updated_at = NOW()
     WHERE match_id = $1 AND status = 'pending'`,
    [matchId],
  );
}

export async function expireDueThesisWatches(): Promise<number> {
  const result = await query(
    `UPDATE match_thesis_watch
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND expires_at <= NOW()`,
  );
  return result.rowCount ?? 0;
}

export async function purgeOldThesisWatches(keepDays: number): Promise<number> {
  if (!Number.isFinite(keepDays) || keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM match_thesis_watch
     WHERE status IN ('expired', 'cancelled', 'promoted')
       AND updated_at < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
