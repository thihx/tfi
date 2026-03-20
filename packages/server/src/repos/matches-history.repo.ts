// ============================================================
// Matches History Repository — Archive finished matches
// ============================================================

import { query } from '../db/pool.js';
import type { MatchRow } from './matches.repo.js';

export interface MatchHistoryRow {
  match_id: string;
  date: string;
  kickoff: string;
  league_id: number;
  league_name: string;
  home_team: string;
  away_team: string;
  venue: string;
  final_status: string;
  home_score: number;
  away_score: number;
  archived_at: string;
}

/**
 * Archive FT/AET/PEN matches from the live matches table before TRUNCATE.
 * Uses ON CONFLICT to avoid duplicates if the same match is archived again.
 */
export async function archiveFinishedMatches(
  matches: MatchRow[],
): Promise<number> {
  const finished = matches.filter((m) =>
    ['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(m.status),
  );
  if (finished.length === 0) return 0;

  // Single multi-row INSERT per chunk (max 500 rows to stay well within pg's 65535 param limit)
  const COLS = 11;
  const CHUNK = 500;
  let totalArchived = 0;

  for (let offset = 0; offset < finished.length; offset += CHUNK) {
    const chunk = finished.slice(offset, offset + CHUNK);
    const placeholders = chunk.map((_, i) =>
      `($${i*COLS+1},$${i*COLS+2},$${i*COLS+3},$${i*COLS+4},$${i*COLS+5},$${i*COLS+6},$${i*COLS+7},$${i*COLS+8},$${i*COLS+9},$${i*COLS+10},$${i*COLS+11})`,
    ).join(',');
    const params = chunk.flatMap((m) => [
      m.match_id, m.date, m.kickoff, m.league_id, m.league_name ?? '',
      m.home_team ?? '', m.away_team ?? '', m.venue ?? 'TBD', m.status,
      m.home_score ?? 0, m.away_score ?? 0,
    ]);
    const result = await query(
      `INSERT INTO matches_history (match_id, date, kickoff, league_id, league_name, home_team, away_team, venue, final_status, home_score, away_score)
       VALUES ${placeholders}
       ON CONFLICT (match_id) DO UPDATE SET
         final_status = EXCLUDED.final_status,
         home_score   = EXCLUDED.home_score,
         away_score   = EXCLUDED.away_score,
         archived_at  = NOW()`,
      params,
    );
    totalArchived += result.rowCount ?? 0;
  }
  return totalArchived;
}

/** Look up final score for a single match */
export async function getHistoricalMatch(matchId: string): Promise<MatchHistoryRow | null> {
  const r = await query<MatchHistoryRow>(
    'SELECT * FROM matches_history WHERE match_id = $1',
    [matchId],
  );
  return r.rows[0] ?? null;
}

/** Batch-fetch historical matches — single query replacing N individual lookups */
export async function getHistoricalMatchesBatch(matchIds: string[]): Promise<Map<string, MatchHistoryRow>> {
  if (matchIds.length === 0) return new Map();
  const r = await query<MatchHistoryRow>(
    'SELECT * FROM matches_history WHERE match_id = ANY($1)',
    [matchIds],
  );
  return new Map(r.rows.map((row) => [row.match_id, row]));
}

/** Get all historical matches for a date range */
export async function getHistoricalMatchesByDate(
  from: string,
  to: string,
): Promise<MatchHistoryRow[]> {
  const r = await query<MatchHistoryRow>(
    'SELECT * FROM matches_history WHERE date >= $1 AND date <= $2 ORDER BY date, kickoff',
    [from, to],
  );
  return r.rows;
}
