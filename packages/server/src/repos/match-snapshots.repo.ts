// ============================================================
// Match Snapshots Repository — Multi-point live data capture
// ============================================================

import { query } from '../db/pool.js';

export interface MatchSnapshotRow {
  id: number;
  match_id: string;
  captured_at: string;
  source: string;
  minute: number;
  status: string;
  home_score: number;
  away_score: number;
  stats: Record<string, unknown>;
  events: unknown[];
  odds: Record<string, unknown>;
}

export async function createSnapshot(snap: {
  match_id: string;
  minute: number;
  status?: string;
  home_score?: number;
  away_score?: number;
  stats?: Record<string, unknown>;
  events?: unknown[];
  odds?: Record<string, unknown>;
  source?: string;
}): Promise<MatchSnapshotRow> {
  const r = await query<MatchSnapshotRow>(
    `INSERT INTO match_snapshots (match_id, minute, status, home_score, away_score, stats, events, odds, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (match_id, minute)
     DO UPDATE SET
       status = EXCLUDED.status,
       home_score = EXCLUDED.home_score,
       away_score = EXCLUDED.away_score,
       stats = EXCLUDED.stats,
       events = EXCLUDED.events,
       odds = EXCLUDED.odds,
       captured_at = NOW()
     RETURNING *`,
    [
      snap.match_id,
      snap.minute,
      snap.status ?? '',
      snap.home_score ?? 0,
      snap.away_score ?? 0,
      JSON.stringify(snap.stats ?? {}),
      JSON.stringify(snap.events ?? []),
      JSON.stringify(snap.odds ?? {}),
      snap.source ?? 'pipeline',
    ],
  );
  return r.rows[0]!;
}

export async function getSnapshotsByMatch(matchId: string): Promise<MatchSnapshotRow[]> {
  const r = await query<MatchSnapshotRow>(
    'SELECT * FROM match_snapshots WHERE match_id = $1 ORDER BY minute',
    [matchId],
  );
  return r.rows;
}

export async function getLatestSnapshot(matchId: string): Promise<MatchSnapshotRow | null> {
  const r = await query<MatchSnapshotRow>(
    'SELECT * FROM match_snapshots WHERE match_id = $1 ORDER BY minute DESC LIMIT 1',
    [matchId],
  );
  return r.rows[0] ?? null;
}

export async function getLatestSnapshotsForMatches(matchIds: string[]): Promise<Map<string, MatchSnapshotRow>> {
  if (matchIds.length === 0) return new Map();
  const r = await query<MatchSnapshotRow>(
    `SELECT DISTINCT ON (match_id) *
     FROM match_snapshots
     WHERE match_id = ANY($1)
     ORDER BY match_id, minute DESC, captured_at DESC`,
    [matchIds],
  );
  return new Map(r.rows.map((row) => [row.match_id, row] as const));
}

export async function purgeMatchSnapshots(keepDays: number): Promise<number> {
  if (keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM match_snapshots
     WHERE captured_at < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
