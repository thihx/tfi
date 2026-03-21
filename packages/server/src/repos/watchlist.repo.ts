// ============================================================
// Watchlist Repository
// ============================================================

import { query } from '../db/pool.js';
import { config } from '../config.js';

export interface WatchlistRow {
  id: number;
  match_id: string;
  date: string | null;
  league: string;
  home_team: string;
  away_team: string;
  home_logo: string;
  away_logo: string;
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
  strategic_context: unknown;
  strategic_context_at: string | null;
  mins_to_kickoff?: number | null;
}

export type WatchlistCreate = Omit<WatchlistRow, 'id' | 'added_at'>;

export async function getAllWatchlist(): Promise<(WatchlistRow & { match_status?: string })[]> {
  const r = await query<WatchlistRow & { match_status: string | null }>(
    `SELECT w.*, m.status AS match_status
     FROM watchlist w
     LEFT JOIN matches m ON w.match_id = m.match_id::text
     ORDER BY w.date, w.kickoff`,
  );
  return r.rows.map(row => ({
    ...row,
    match_status: row.match_status ?? undefined,
  }));
}

export async function getActiveWatchlist(): Promise<WatchlistRow[]> {
  const r = await query<WatchlistRow>(
    "SELECT * FROM watchlist WHERE status = 'active' ORDER BY priority DESC, date, kickoff",
  );
  return r.rows;
}

export async function getKickoffMinutesForMatchIds(
  matchIds: string[],
  timezone: string = config.timezone,
): Promise<Map<string, number | null>> {
  if (matchIds.length === 0) return new Map();
  const r = await query<{ match_id: string; mins_to_kickoff: string | null }>(
    `SELECT match_id,
            CASE
              WHEN date IS NULL OR kickoff IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (
                (date + kickoff) AT TIME ZONE $2 - NOW()
              )) / 60
            END AS mins_to_kickoff
       FROM watchlist
      WHERE match_id = ANY($1)`,
    [matchIds, timezone],
  );
  return new Map(r.rows.map((row) => [
    row.match_id,
    row.mins_to_kickoff != null ? Number(row.mins_to_kickoff) : null,
  ]));
}

export async function getWatchlistByMatchId(matchId: string): Promise<WatchlistRow | null> {
  const r = await query<WatchlistRow>('SELECT * FROM watchlist WHERE match_id = $1', [matchId]);
  return r.rows[0] ?? null;
}

/** Returns a Set of match_ids that already exist in the watchlist — single query for N ids. */
export async function getExistingWatchlistMatchIds(matchIds: string[]): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set();
  const r = await query<{ match_id: string }>(
    'SELECT match_id FROM watchlist WHERE match_id = ANY($1)',
    [matchIds],
  );
  return new Set(r.rows.map((row) => row.match_id));
}

export async function createWatchlistEntry(w: Partial<WatchlistCreate>): Promise<WatchlistRow> {
  const r = await query<WatchlistRow>(
    `INSERT INTO watchlist
       (match_id, date, league, home_team, away_team, home_logo, away_logo, kickoff, mode, prediction,
        recommended_custom_condition, recommended_condition_reason, recommended_condition_reason_vi,
        recommended_condition_at, custom_conditions, priority, status, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      w.match_id,
      w.date ?? null,
      w.league ?? '',
      w.home_team ?? '',
      w.away_team ?? '',
      w.home_logo ?? '',
      w.away_logo ?? '',
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
    'strategic_context', 'strategic_context_at',
  ] as const;

  for (const key of allowed) {
    if (key in fields) {
      const val = (key === 'prediction' || key === 'strategic_context')
        ? JSON.stringify(fields[key])
        : (fields as Record<string, unknown>)[key];
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
    `UPDATE watchlist SET total_checks = total_checks + 1, last_checked = NOW() WHERE match_id = $1`,
    [matchId],
  );
}

/** Batch-increment check counters — single query replacing N individual updates */
export async function incrementChecksForMatches(matchIds: string[]): Promise<void> {
  if (matchIds.length === 0) return;
  await query(
    `UPDATE watchlist SET total_checks = total_checks + 1, last_checked = NOW() WHERE match_id = ANY($1)`,
    [matchIds],
  );
}

export async function expireOldEntries(cutoffMinutes: number = 120): Promise<number> {
  // Re-activate expired entries whose match is still active (NS or LIVE)
  await query(
    `UPDATE watchlist SET status = 'active'
     WHERE status = 'expired'
       AND EXISTS (
         SELECT 1 FROM matches m
         WHERE m.match_id::text = watchlist.match_id
           AND m.status IN ('NS','1H','2H','HT','ET','BT','P','LIVE','INT')
       )`,
  );

  const r = await query(
    `UPDATE watchlist SET status = 'expired'
     WHERE status = 'active' AND date IS NOT NULL AND kickoff IS NOT NULL
       AND ((date + kickoff) AT TIME ZONE $2 + $1 * INTERVAL '1 minute') < NOW()
       AND NOT EXISTS (
         SELECT 1 FROM matches m
         WHERE m.match_id::text = watchlist.match_id
           AND m.status IN ('NS','1H','2H','HT','ET','BT','P','LIVE','INT')
       )`,
    [cutoffMinutes, config.timezone],
  );
  return r.rowCount ?? 0;
}

/** Sync watchlist date/kickoff from matches table (matches refresh may change them) */
export async function syncWatchlistDates(): Promise<number> {
  const r = await query(
    `UPDATE watchlist w
     SET date = m.date, kickoff = m.kickoff
     FROM matches m
     WHERE w.match_id = m.match_id::text
       AND w.status = 'active'
       AND (w.date != m.date OR w.kickoff != m.kickoff)`,
  );
  return r.rowCount ?? 0;
}
