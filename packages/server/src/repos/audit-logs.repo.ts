// ============================================================
// Audit Logs Repository
// ============================================================

import { query } from '../db/pool.js';

export interface AuditLogRow {
  id: number;
  timestamp: string;
  category: string;
  action: string;
  outcome: string;
  actor: string;
  match_id: string | null;
  duration_ms: number | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
}

export interface AuditLogInput {
  category: string;
  action: string;
  outcome?: string;
  actor?: string;
  match_id?: string | null;
  duration_ms?: number | null;
  metadata?: Record<string, unknown> | null;
  error?: string | null;
}

export async function insertAuditLog(input: AuditLogInput): Promise<void> {
  await query(
    `INSERT INTO audit_logs (category, action, outcome, actor, match_id, duration_ms, metadata, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.category,
      input.action,
      input.outcome ?? 'SUCCESS',
      input.actor ?? 'system',
      input.match_id ?? null,
      input.duration_ms ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.error ?? null,
    ],
  );
}

export async function getAuditLogs(filters: {
  category?: string;
  action?: string;
  outcome?: string;
  matchId?: string;
  prematchStrength?: string;
  prematchNoiseMin?: number;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AuditLogRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters.category) {
    conditions.push(`category = $${paramIdx++}`);
    params.push(filters.category);
  }
  if (filters.action) {
    conditions.push(`action = $${paramIdx++}`);
    params.push(filters.action);
  }
  if (filters.outcome) {
    conditions.push(`outcome = $${paramIdx++}`);
    params.push(filters.outcome);
  }
  if (filters.matchId) {
    conditions.push(`match_id = $${paramIdx++}`);
    params.push(filters.matchId);
  }
  if (filters.prematchStrength) {
    conditions.push(`COALESCE(NULLIF(metadata->>'prematchStrength', ''), 'none') = $${paramIdx++}`);
    params.push(filters.prematchStrength);
  }
  if (typeof filters.prematchNoiseMin === 'number' && Number.isFinite(filters.prematchNoiseMin)) {
    conditions.push(`CASE
      WHEN COALESCE(metadata->>'prematchNoisePenalty', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        THEN (metadata->>'prematchNoisePenalty')::numeric >= $${paramIdx++}
      ELSE FALSE
    END`);
    params.push(filters.prematchNoiseMin);
  }
  if (filters.fromDate) {
    conditions.push(`timestamp >= $${paramIdx++}`);
    params.push(filters.fromDate);
  }
  if (filters.toDate) {
    const datePart = filters.toDate.includes('T') ? filters.toDate.split('T')[0] : filters.toDate;
    conditions.push(`timestamp <= $${paramIdx++}`);
    params.push(datePart + 'T23:59:59.999Z');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const [dataResult, countResult] = await Promise.all([
    query<AuditLogRow>(
      `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs ${where}`,
      params,
    ),
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function getAuditLogStats(): Promise<{
  totalLogs: number;
  last24h: number;
  byCategory: Record<string, number>;
  failureRate: number;
}> {
  const [totalResult, last24hResult, byCategoryResult, failureResult] = await Promise.all([
    query<{ count: string }>('SELECT COUNT(*) as count FROM audit_logs'),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE timestamp > NOW() - INTERVAL '24 hours'`,
    ),
    query<{ category: string; count: string }>(
      `SELECT category, COUNT(*) as count FROM audit_logs GROUP BY category ORDER BY count DESC`,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE outcome = 'FAILURE'`,
    ),
  ]);

  const total = Number(totalResult.rows[0]?.count ?? 0);
  const failures = Number(failureResult.rows[0]?.count ?? 0);

  const byCategory: Record<string, number> = {};
  for (const row of byCategoryResult.rows) {
    byCategory[row.category] = Number(row.count);
  }

  return {
    totalLogs: total,
    last24h: Number(last24hResult.rows[0]?.count ?? 0),
    byCategory,
    failureRate: total > 0 ? Math.round((failures / total) * 10000) / 100 : 0,
  };
}

/** Purge old audit logs (keep last N days) */
export async function purgeAuditLogs(keepDays: number = 30): Promise<number> {
  const result = await query(
    `DELETE FROM audit_logs WHERE timestamp < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
