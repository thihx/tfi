// ============================================================
// Watchlist Repository
// ============================================================

import { query } from '../db/pool.js';

export interface WatchlistRow {
  id: number;
  match_id: string;
  date: string | null;
  league: string;
  home_team: string;
  away_team: string;
  kickoff: string | null;
  mode: string;
  prediction: unknown;
  recommended_custom_condition: string;
  recommended_condition_reason: string;
  recommended_condition_reason_vi: string;
  recommended_condition_at: string | null;
  custom_conditions: string;
  priority: number;
  status: string;
  added_at: string;
  added_by: string;
  last_checked: string | null;
  total_checks: number;
  recommendations_count: number;
}

export type WatchlistCreate = Omit<WatchlistRow, 'id' | 'added_at'>;

export async function getAllWatchlist(): Promise<WatchlistRow[]> {
  const r = await query<WatchlistRow>('SELECT * FROM watchlist ORDER BY date, kickoff');
  return r.rows;
}

export async function getActiveWatchlist(): Promise<WatchlistRow[]> {
  const r = await query<WatchlistRow>(
    "SELECT * FROM watchlist WHERE status = 'active' ORDER BY priority DESC, date, kickoff",
  );
  return r.rows;
}

export async function getWatchlistByMatchId(matchId: string): Promise<WatchlistRow | null> {
  const r = await query<WatchlistRow>('SELECT * FROM watchlist WHERE match_id = $1', [matchId]);
  return r.rows[0] ?? null;
}

export async function createWatchlistEntry(w: Partial<WatchlistCreate>): Promise<WatchlistRow> {
  const r = await query<WatchlistRow>(
    `INSERT INTO watchlist
       (match_id, date, league, home_team, away_team, kickoff, mode, prediction,
        recommended_custom_condition, recommended_condition_reason, recommended_condition_reason_vi,
        recommended_condition_at, custom_conditions, priority, status, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      w.match_id,
      w.date ?? null,
      w.league ?? '',
      w.home_team ?? '',
      w.away_team ?? '',
      w.kickoff ?? null,
      w.mode ?? 'B',
      w.prediction ? JSON.stringify(w.prediction) : null,
      w.recommended_custom_condition ?? '',
      w.recommended_condition_reason ?? '',
      w.recommended_condition_reason_vi ?? '',
      w.recommended_condition_at ?? null,
      w.custom_conditions ?? '',
      w.priority ?? 0,
      w.status ?? 'active',
      w.added_by ?? 'user',
    ],
  );
  return r.rows[0]!;
}

export async function updateWatchlistEntry(
  matchId: string,
  fields: Partial<WatchlistRow>,
): Promise<WatchlistRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  const allowed = [
    'mode', 'prediction', 'recommended_custom_condition', 'recommended_condition_reason',
    'recommended_condition_reason_vi', 'recommended_condition_at', 'custom_conditions',
    'priority', 'status', 'last_checked', 'total_checks', 'recommendations_count',
  ] as const;

  for (const key of allowed) {
    if (key in fields) {
      const val = key === 'prediction' ? JSON.stringify(fields[key]) : (fields as Record<string, unknown>)[key];
      sets.push(`${key} = $${idx}`);
      vals.push(val);
      idx++;
    }
  }

  if (sets.length === 0) return getWatchlistByMatchId(matchId);

  vals.push(matchId);
  const r = await query<WatchlistRow>(
    `UPDATE watchlist SET ${sets.join(', ')} WHERE match_id = $${idx} RETURNING *`,
    vals,
  );
  return r.rows[0] ?? null;
}

export async function deleteWatchlistEntry(matchId: string): Promise<boolean> {
  const r = await query('DELETE FROM watchlist WHERE match_id = $1', [matchId]);
  return (r.rowCount ?? 0) > 0;
}

export async function incrementChecks(matchId: string): Promise<void> {
  await query(
    `UPDATE watchlist SET total_checks = total_checks + 1, last_checked = NOW()
     WHERE match_id = $1`,
    [matchId],
  );
}

export async function expireOldEntries(cutoffMinutes: number = 120): Promise<number> {
  const r = await query(
    `UPDATE watchlist SET status = 'expired'
     WHERE status = 'active' AND date IS NOT NULL AND kickoff IS NOT NULL
       AND (date + kickoff + $1 * INTERVAL '1 minute') < NOW()`,
    [cutoffMinutes],
  );
  return r.rowCount ?? 0;
}
