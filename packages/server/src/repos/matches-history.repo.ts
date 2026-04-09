// ============================================================
// Matches History Repository — Archive finished matches
// ============================================================

import { query } from '../db/pool.js';
import type { MatchRow } from './matches.repo.js';
import type { SettlementStatRow } from '../lib/settlement-stat-cache.js';

export interface MatchHistoryRow {
  match_id: string;
  date: string;
  kickoff: string;
  kickoff_at_utc?: string | null;
  league_id: number;
  league_name: string;
  home_team_id?: number | null;
  home_team: string;
  away_team_id?: number | null;
  away_team: string;
  venue: string;
  final_status: string;
  home_score: number;
  away_score: number;
  regular_home_score?: number | null;
  regular_away_score?: number | null;
  halftime_home?: number | null;
  halftime_away?: number | null;
  result_provider?: string;
  settlement_stats?: SettlementStatRow[] | null;
  settlement_event_summary?: unknown;
  settlement_stats_provider?: string;
  settlement_stats_updated_at?: string | null;
  settlement_stats_fetched_at?: string | null;
  archived_at: string;
}

export interface MatchHistoryArchiveInput {
  match_id: string;
  date: string;
  kickoff: string;
  kickoff_at_utc?: string | null;
  league_id: number;
  league_name: string;
  home_team_id?: number | null;
  home_team: string;
  away_team_id?: number | null;
  away_team: string;
  venue: string;
  final_status: string;
  home_score: number;
  away_score: number;
  regular_home_score?: number | null;
  regular_away_score?: number | null;
  halftime_home?: number | null;
  halftime_away?: number | null;
  result_provider?: string;
  settlement_stats?: SettlementStatRow[];
  settlement_event_summary?: unknown;
  settlement_stats_provider?: string;
  /** Set to NOW() when stats were fetched (even if empty). Null = not attempted. */
  settlement_stats_fetched_at?: string | null;
}

/**
 * Archive FT/AET/PEN matches from the live matches table before TRUNCATE.
 * Uses ON CONFLICT to avoid duplicates if the same match is archived again.
 */
export async function archiveFinishedMatches(
  matches: Array<MatchHistoryArchiveInput | MatchRow>,
): Promise<number> {
  const finished = matches
    .map((match) => normalizeArchiveInput(match))
    .filter((match): match is MatchHistoryArchiveInput => Boolean(match));
  if (finished.length === 0) return 0;

  // Single multi-row INSERT per chunk (max 500 rows to stay well within pg's 65535 param limit)
  const COLS = 23;
  const CHUNK = 500;
  let totalArchived = 0;

  for (let offset = 0; offset < finished.length; offset += CHUNK) {
    const chunk = finished.slice(offset, offset + CHUNK);
    const placeholders = chunk.map((_, i) =>
      `($${i*COLS+1},$${i*COLS+2},$${i*COLS+3},$${i*COLS+4},$${i*COLS+5},$${i*COLS+6},$${i*COLS+7},$${i*COLS+8},$${i*COLS+9},$${i*COLS+10},$${i*COLS+11},$${i*COLS+12},$${i*COLS+13},$${i*COLS+14},$${i*COLS+15},$${i*COLS+16},$${i*COLS+17},$${i*COLS+18},$${i*COLS+19},$${i*COLS+20},$${i*COLS+21},$${i*COLS+22},$${i*COLS+23})`,
    ).join(',');
    const params = chunk.flatMap((m) => [
      m.match_id, m.date, m.kickoff, m.kickoff_at_utc ?? null, m.league_id, m.league_name ?? '',
      m.home_team_id ?? null, m.home_team ?? '', m.away_team_id ?? null, m.away_team ?? '', m.venue ?? 'TBD', m.final_status,
      m.home_score ?? 0, m.away_score ?? 0, m.regular_home_score ?? null,
      m.regular_away_score ?? null, m.halftime_home ?? null, m.halftime_away ?? null, m.result_provider ?? '', JSON.stringify(m.settlement_stats ?? []), m.settlement_event_summary == null ? null : JSON.stringify(m.settlement_event_summary),
      m.settlement_stats_provider ?? '', m.settlement_stats_fetched_at ?? null,
    ]);
    const result = await query(
      `INSERT INTO matches_history (
         match_id, date, kickoff, kickoff_at_utc, league_id, league_name, home_team_id, home_team, away_team_id, away_team, venue,
         final_status, home_score, away_score, regular_home_score, regular_away_score, halftime_home, halftime_away,
         result_provider, settlement_stats, settlement_event_summary, settlement_stats_provider, settlement_stats_fetched_at
       )
       VALUES ${placeholders}
       ON CONFLICT (match_id) DO UPDATE SET
         kickoff_at_utc = COALESCE(EXCLUDED.kickoff_at_utc, matches_history.kickoff_at_utc),
         home_team_id = COALESCE(EXCLUDED.home_team_id, matches_history.home_team_id),
         away_team_id = COALESCE(EXCLUDED.away_team_id, matches_history.away_team_id),
         final_status = EXCLUDED.final_status,
         home_score   = EXCLUDED.home_score,
         away_score   = EXCLUDED.away_score,
         regular_home_score = COALESCE(EXCLUDED.regular_home_score, matches_history.regular_home_score),
         regular_away_score = COALESCE(EXCLUDED.regular_away_score, matches_history.regular_away_score),
         halftime_home = COALESCE(EXCLUDED.halftime_home, matches_history.halftime_home),
         halftime_away = COALESCE(EXCLUDED.halftime_away, matches_history.halftime_away),
         result_provider = CASE
           WHEN EXCLUDED.result_provider <> '' THEN EXCLUDED.result_provider
           ELSE matches_history.result_provider
         END,
         settlement_stats = CASE
           WHEN jsonb_array_length(EXCLUDED.settlement_stats) > 0 THEN EXCLUDED.settlement_stats
           ELSE matches_history.settlement_stats
         END,
         settlement_event_summary = COALESCE(EXCLUDED.settlement_event_summary, matches_history.settlement_event_summary),
         settlement_stats_provider = CASE
           WHEN EXCLUDED.settlement_stats_provider <> '' THEN EXCLUDED.settlement_stats_provider
           ELSE matches_history.settlement_stats_provider
         END,
         settlement_stats_updated_at = CASE
           WHEN jsonb_array_length(EXCLUDED.settlement_stats) > 0 THEN NOW()
           ELSE matches_history.settlement_stats_updated_at
         END,
         settlement_stats_fetched_at = COALESCE(EXCLUDED.settlement_stats_fetched_at, matches_history.settlement_stats_fetched_at),
         archived_at  = NOW()`,
      params,
    );
    totalArchived += result.rowCount ?? 0;
  }
  return totalArchived;
}

export async function updateHistoricalMatchSettlementData(
  matchId: string,
  patch: {
    regular_home_score?: number | null;
    regular_away_score?: number | null;
    halftime_home?: number | null;
    halftime_away?: number | null;
    result_provider?: string;
    settlement_stats?: SettlementStatRow[];
    settlement_event_summary?: unknown;
    settlement_stats_provider?: string;
  },
): Promise<void> {
  const hasStats = Array.isArray(patch.settlement_stats) && patch.settlement_stats.length > 0;
  await query(
    `UPDATE matches_history
     SET
       regular_home_score = COALESCE($2, regular_home_score),
       regular_away_score = COALESCE($3, regular_away_score),
       halftime_home = COALESCE($4, halftime_home),
       halftime_away = COALESCE($5, halftime_away),
       result_provider = CASE WHEN $6 <> '' THEN $6 ELSE result_provider END,
       settlement_stats = CASE
         WHEN $7::jsonb IS NOT NULL AND jsonb_array_length($7::jsonb) > 0 THEN $7::jsonb
         ELSE settlement_stats
       END,
       settlement_event_summary = COALESCE($8::jsonb, settlement_event_summary),
       settlement_stats_provider = CASE WHEN $9 <> '' THEN $9 ELSE settlement_stats_provider END,
       settlement_stats_updated_at = CASE
         WHEN $7::jsonb IS NOT NULL AND jsonb_array_length($7::jsonb) > 0 THEN NOW()
         ELSE settlement_stats_updated_at
       END,
       archived_at = NOW()
     WHERE match_id = $1`,
    [
      matchId,
      patch.regular_home_score ?? null,
      patch.regular_away_score ?? null,
      patch.halftime_home ?? null,
      patch.halftime_away ?? null,
      patch.result_provider ?? '',
      hasStats ? JSON.stringify(patch.settlement_stats) : null,
      patch.settlement_event_summary != null ? JSON.stringify(patch.settlement_event_summary) : null,
      patch.settlement_stats_provider ?? '',
    ],
  );
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
    'SELECT * FROM matches_history WHERE date >= $1 AND date <= $2 ORDER BY kickoff_at_utc NULLS LAST, date, kickoff',
    [from, to],
  );
  return r.rows;
}

export async function purgeHistoricalMatches(keepDays: number, hardDeleteDays?: number): Promise<number> {
  if (keepDays <= 0) return 0;

  // Soft delete: respect pending recommendations and bets
  const softResult = await query(
    `DELETE FROM matches_history mh
     WHERE mh.archived_at < NOW() - INTERVAL '1 day' * $1
       AND NOT EXISTS (
         SELECT 1
         FROM recommendations r
         WHERE r.match_id = mh.match_id
           AND r.bet_type IS DISTINCT FROM 'NO_BET'
           AND COALESCE(r.settlement_status, 'pending') IN ('pending', 'unresolved')
       )
       AND NOT EXISTS (
         SELECT 1
         FROM bets b
         WHERE b.match_id = mh.match_id
           AND COALESCE(b.settlement_status, 'pending') IN ('pending', 'unresolved')
       )`,
    [keepDays],
  );
  let deleted = softResult.rowCount ?? 0;

  // Hard delete: unconditional cleanup beyond the absolute deadline
  if (hardDeleteDays && hardDeleteDays > keepDays) {
    const hardResult = await query(
      `DELETE FROM matches_history WHERE archived_at < NOW() - INTERVAL '1 day' * $1`,
      [hardDeleteDays],
    );
    deleted += hardResult.rowCount ?? 0;
  }

  return deleted;
}

function normalizeArchiveInput(
  match: MatchHistoryArchiveInput | MatchRow,
): MatchHistoryArchiveInput | null {
  if ('final_status' in match) {
    if (!['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(match.final_status)) return null;
    return {
      ...match,
      result_provider: match.result_provider ?? '',
      settlement_stats: match.settlement_stats ?? [],
      settlement_event_summary: match.settlement_event_summary ?? null,
      settlement_stats_provider: match.settlement_stats_provider ?? '',
    };
  }

  if (!['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(match.status)) return null;
  return {
    match_id: match.match_id,
    date: match.date,
    kickoff: match.kickoff,
    kickoff_at_utc: match.kickoff_at_utc ?? null,
    league_id: match.league_id,
    league_name: match.league_name ?? '',
    home_team_id: match.home_team_id ?? null,
    home_team: match.home_team ?? '',
    away_team_id: match.away_team_id ?? null,
    away_team: match.away_team ?? '',
    venue: match.venue ?? 'TBD',
    final_status: match.status,
    home_score: match.home_score ?? 0,
    away_score: match.away_score ?? 0,
    halftime_home: match.halftime_home ?? null,
    halftime_away: match.halftime_away ?? null,
    result_provider: '',
    settlement_stats: [],
    settlement_event_summary: null,
    settlement_stats_provider: '',
  };
}
