// ============================================================
// Matches Repository — ephemeral, full-refresh pattern
// ============================================================

import { query, transaction } from '../db/pool.js';
import { config } from '../config.js';
import { kickoffAtUtcFromLocalParts } from '../lib/kickoff-time.js';

export interface MatchRow {
  match_id: string;
  date: string;
  kickoff: string;
  kickoff_at_utc?: string | null;
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
  const result = await query<MatchRow>('SELECT * FROM matches ORDER BY kickoff_at_utc NULLS LAST, date, kickoff');
  return result.rows;
}

export async function getMatchesByIds(ids: string[]): Promise<MatchRow[]> {
  if (ids.length === 0) return [];
  const result = await query<MatchRow>(
    'SELECT * FROM matches WHERE match_id = ANY($1) ORDER BY kickoff_at_utc NULLS LAST, date, kickoff',
    [ids],
  );
  return result.rows;
}

export async function getMatchesByStatus(statuses: string[]): Promise<MatchRow[]> {
  const result = await query<MatchRow>(
    'SELECT * FROM matches WHERE status = ANY($1) ORDER BY kickoff_at_utc NULLS LAST, date, kickoff',
    [statuses],
  );
  return result.rows;
}

export async function getMatchesForLeaguesOnLocalDate(
  leagueIds: number[],
  localDate: string,
  userTimeZone: string,
): Promise<MatchRow[]> {
  if (leagueIds.length === 0) return [];
  const result = await query<MatchRow>(
    `SELECT *
       FROM matches
      WHERE league_id = ANY($1)
        AND status <> ALL($4)
        AND (
          (kickoff_at_utc IS NOT NULL AND (kickoff_at_utc AT TIME ZONE $3)::date = $2::date)
          OR (kickoff_at_utc IS NULL AND date = $2::date)
        )
      ORDER BY kickoff_at_utc NULLS LAST, date, kickoff`,
    [
      leagueIds,
      localDate,
      userTimeZone,
      ['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'PST'],
    ],
  );
  return result.rows;
}

export async function getLiveRefreshCandidates(
  liveStatuses: string[],
  kickoffWindowStartIso: string,
  kickoffWindowEndIso: string,
): Promise<MatchRow[]> {
  const result = await query<MatchRow>(
    `SELECT *
       FROM matches
      WHERE status = ANY($1)
         OR (
           status = 'NS'
           AND kickoff_at_utc IS NOT NULL
           AND kickoff_at_utc >= $2::timestamptz
           AND kickoff_at_utc < $3::timestamptz
         )
      ORDER BY kickoff_at_utc NULLS LAST, date, kickoff`,
    [liveStatuses, kickoffWindowStartIso, kickoffWindowEndIso],
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
           match_id, date, kickoff, kickoff_at_utc, league_id, league_name, home_team, away_team,
           home_logo, away_logo, venue, status, home_score, away_score, current_minute,
           home_team_id, away_team_id, round, halftime_home, halftime_away, referee,
           home_reds, away_reds, home_yellows, away_yellows,
           last_updated
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW())`,
        [
          m.match_id,
          m.date,
          m.kickoff,
          m.kickoff_at_utc ?? kickoffAtUtcFromLocalParts(m.date ?? null, m.kickoff ?? null, config.timezone),
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
         date = COALESCE($2, date),
         kickoff = COALESCE($3, kickoff),
         kickoff_at_utc = COALESCE($4, kickoff_at_utc),
         status = COALESCE($5, status),
         home_score = COALESCE($6, home_score),
         away_score = COALESCE($7, away_score),
         current_minute = COALESCE($8, current_minute),
         home_reds = COALESCE($9, home_reds),
         away_reds = COALESCE($10, away_reds),
         home_yellows = COALESCE($11, home_yellows),
         away_yellows = COALESCE($12, away_yellows),
         last_updated = NOW()
       WHERE match_id = $1`,
      [
        m.match_id,
        m.date ?? null,
        m.kickoff ?? null,
        m.kickoff_at_utc ?? null,
        m.status ?? null,
        m.home_score ?? null,
        m.away_score ?? null,
        m.current_minute ?? null,
        m.home_reds ?? null,
        m.away_reds ?? null,
        m.home_yellows ?? null,
        m.away_yellows ?? null,
      ],
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

export interface MatchScheduleState {
  liveCount: number;
  nsCount: number;
  minsToNextKickoff: number | null; // null = no NS matches
}

/**
 * Cheap single-query snapshot of how "active" the match slate is.
 * Used by fetch-matches to decide how long to wait before the next poll.
 * Prefers canonical kickoff_at_utc and falls back to legacy date+kickoff rows when needed.
 */
export async function getMatchScheduleState(timezone: string): Promise<MatchScheduleState> {
  const r = await query<{ live_count: string; ns_count: string; mins_to_next: string | null }>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('1H','HT','2H','ET','BT','P','LIVE','INT')) AS live_count,
       COUNT(*) FILTER (WHERE status = 'NS')                                          AS ns_count,
       MIN(
         EXTRACT(EPOCH FROM (
           COALESCE(kickoff_at_utc, ((date + kickoff) AT TIME ZONE $1)) - NOW()
         )) / 60
       ) FILTER (WHERE status = 'NS')                                                 AS mins_to_next
     FROM matches`,
    [timezone],
  );
  const row = r.rows[0];
  if (!row) return { liveCount: 0, nsCount: 0, minsToNextKickoff: null };
  return {
    liveCount: Number(row.live_count),
    nsCount: Number(row.ns_count),
    minsToNextKickoff: row.mins_to_next != null ? Number(row.mins_to_next) : null,
  };
}
