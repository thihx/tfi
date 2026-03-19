// ============================================================
// Matches Repository — ephemeral, full-refresh pattern
// ============================================================

import { query, transaction } from '../db/pool.js';

export interface MatchRow {
  match_id: string;
  date: string;
  kickoff: string;
  league_id: number;
  league_name: string;
  home_team: string;
  away_team: string;
  home_logo: string;
  away_logo: string;
  venue: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  current_minute: number | null;
  last_updated: string;
  // Enriched from /fixtures (free — no extra API call)
  home_team_id?: number | null;
  away_team_id?: number | null;
  round?: string;
  halftime_home?: number | null;
  halftime_away?: number | null;
  referee?: string | null;
  // Enriched from /fixtures/statistics (live matches only)
  home_reds?: number;
  away_reds?: number;
  home_yellows?: number;
  away_yellows?: number;
}

export async function getAllMatches(): Promise<MatchRow[]> {
  const result = await query<MatchRow>('SELECT * FROM matches ORDER BY date, kickoff');
  return result.rows;
}

export async function getMatchesByIds(ids: string[]): Promise<MatchRow[]> {
  if (ids.length === 0) return [];
  const result = await query<MatchRow>(
    'SELECT * FROM matches WHERE match_id = ANY($1) ORDER BY date, kickoff',
    [ids],
  );
  return result.rows;
}

export async function getMatchesByStatus(statuses: string[]): Promise<MatchRow[]> {
  const result = await query<MatchRow>(
    'SELECT * FROM matches WHERE status = ANY($1) ORDER BY date, kickoff',
    [statuses],
  );
  return result.rows;
}

/** Full-refresh: truncate + insert all */
export async function replaceAllMatches(matches: Partial<MatchRow>[]): Promise<number> {
  return transaction(async (client) => {
    await client.query('TRUNCATE matches CASCADE');

    let count = 0;
    for (const m of matches) {
      if (!m.match_id) continue;
      await client.query(
        `INSERT INTO matches (
           match_id, date, kickoff, league_id, league_name, home_team, away_team,
           home_logo, away_logo, venue, status, home_score, away_score, current_minute,
           home_team_id, away_team_id, round, halftime_home, halftime_away, referee,
           home_reds, away_reds, home_yellows, away_yellows,
           last_updated
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW())`,
        [
          m.match_id,
          m.date,
          m.kickoff,
          m.league_id,
          m.league_name ?? '',
          m.home_team ?? '',
          m.away_team ?? '',
          m.home_logo ?? '',
          m.away_logo ?? '',
          m.venue ?? 'TBD',
          m.status ?? 'NS',
          m.home_score ?? null,
          m.away_score ?? null,
          m.current_minute ?? null,
          m.home_team_id ?? null,
          m.away_team_id ?? null,
          m.round ?? '',
          m.halftime_home ?? null,
          m.halftime_away ?? null,
          m.referee ?? null,
          m.home_reds ?? 0,
          m.away_reds ?? 0,
          m.home_yellows ?? 0,
          m.away_yellows ?? 0,
        ],
      );
      count++;
    }
    return count;
  });
}

/** Update specific matches (e.g., live score updates) */
export async function updateMatches(matches: Partial<MatchRow>[]): Promise<number> {
  let count = 0;
  for (const m of matches) {
    if (!m.match_id) continue;
    const result = await query(
      `UPDATE matches SET
         status = COALESCE($2, status),
         home_score = COALESCE($3, home_score),
         away_score = COALESCE($4, away_score),
         current_minute = COALESCE($5, current_minute),
         last_updated = NOW()
       WHERE match_id = $1`,
      [m.match_id, m.status, m.home_score, m.away_score, m.current_minute],
    );
    if ((result.rowCount ?? 0) > 0) count++;
  }
  return count;
}

export async function deleteMatchesByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await query('DELETE FROM matches WHERE match_id = ANY($1)', [ids]);
  return result.rowCount ?? 0;
}
