// Legacy watchlist cleanup — Phase 3
import { query, transaction } from '../db/pool.js';
import { config } from '../config.js';
import { MATCH_STATUSES_EXCLUDED_FROM_WATCHLIST_BULK_ADD } from '../repos/matches.repo.js';

const LIVE_GUARD_STATUSES = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'] as const;

export type LegacyWatchlistCleanupReason = 'finished_match' | 'kickoff_stale';
export type LegacyWatchlistCleanupSource = 'legacy_watchlist' | 'monitored_only';

export interface LegacyWatchlistCleanupCandidate {
  match_id: string;
  source: LegacyWatchlistCleanupSource;
  reason: LegacyWatchlistCleanupReason;
  match_status: string | null;
  kickoff_at_utc: string | null;
  home_team: string | null;
  away_team: string | null;
  added_by: string | null;
  has_subscription: boolean;
}

export interface LegacyWatchlistCleanupPreview {
  staleDays: number;
  protectedBySubscription: number;
  candidates: LegacyWatchlistCleanupCandidate[];
  summary: {
    legacyWatchlistRows: number;
    monitoredOnlyRows: number;
    finishedMatch: number;
    kickoffStale: number;
  };
}

export interface LegacyWatchlistCleanupApplyResult {
  deletedLegacyWatchlistRows: number;
  deletedMonitoredMatches: number;
  matchIds: string[];
}

interface CleanupRow {
  match_id: string;
  source: LegacyWatchlistCleanupSource;
  reason: LegacyWatchlistCleanupReason;
  match_status: string | null;
  kickoff_at_utc: string | null;
  home_team: string | null;
  away_team: string | null;
  added_by: string | null;
  has_subscription: boolean;
}

function kickoffResolutionSql(timezoneParam: string): string {
  return `COALESCE(
    m.kickoff_at_utc,
    NULLIF(mm.metadata->>'kickoff_at_utc', '')::timestamptz,
    CASE
      WHEN COALESCE(m.date, w.date, NULLIF(mm.metadata->>'date', '')::date) IS NOT NULL
       AND COALESCE(m.kickoff, w.kickoff, NULLIF(mm.metadata->>'kickoff', '')::time) IS NOT NULL
      THEN (
        COALESCE(m.date, w.date, NULLIF(mm.metadata->>'date', '')::date)
        + COALESCE(m.kickoff, w.kickoff, NULLIF(mm.metadata->>'kickoff', '')::time)
      ) AT TIME ZONE ${timezoneParam}
      ELSE NULL
    END
  )`;
}

function monitoredKickoffResolutionSql(timezoneParam: string): string {
  return `COALESCE(
    m.kickoff_at_utc,
    NULLIF(mm.metadata->>'kickoff_at_utc', '')::timestamptz,
    CASE
      WHEN COALESCE(m.date, NULLIF(mm.metadata->>'date', '')::date) IS NOT NULL
       AND COALESCE(m.kickoff, NULLIF(mm.metadata->>'kickoff', '')::time) IS NOT NULL
      THEN (
        COALESCE(m.date, NULLIF(mm.metadata->>'date', '')::date)
        + COALESCE(m.kickoff, NULLIF(mm.metadata->>'kickoff', '')::time)
      ) AT TIME ZONE ${timezoneParam}
      ELSE NULL
    END
  )`;
}

function summarizeCandidates(candidates: LegacyWatchlistCleanupCandidate[]): LegacyWatchlistCleanupPreview['summary'] {
  return {
    legacyWatchlistRows: candidates.filter((row) => row.source === 'legacy_watchlist').length,
    monitoredOnlyRows: candidates.filter((row) => row.source === 'monitored_only').length,
    finishedMatch: candidates.filter((row) => row.reason === 'finished_match').length,
    kickoffStale: candidates.filter((row) => row.reason === 'kickoff_stale').length,
  };
}

function mapCandidate(row: CleanupRow): LegacyWatchlistCleanupCandidate {
  return {
    match_id: row.match_id,
    source: row.source,
    reason: row.reason,
    match_status: row.match_status,
    kickoff_at_utc: row.kickoff_at_utc,
    home_team: row.home_team,
    away_team: row.away_team,
    added_by: row.added_by,
    has_subscription: row.has_subscription,
  };
}

export async function previewLegacyWatchlistCleanup(
  staleDays: number = config.legacyWatchlistStaleDays,
): Promise<LegacyWatchlistCleanupPreview> {
  const finishedStatuses = [...MATCH_STATUSES_EXCLUDED_FROM_WATCHLIST_BULK_ADD];
  const liveStatuses = [...new Set([...config.liveStatuses, ...LIVE_GUARD_STATUSES])];

  const protectedResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT w.match_id)::text AS count
       FROM watchlist w
      WHERE EXISTS (
        SELECT 1 FROM user_watch_subscriptions s WHERE s.match_id = w.match_id
      )`,
  );

  const legacyResult = await query<CleanupRow>(
    `WITH resolved AS (
       SELECT
         w.match_id,
         'legacy_watchlist'::text AS source,
         m.status AS match_status,
         COALESCE(m.home_team, NULLIF(w.home_team, ''), NULLIF(mm.metadata->>'home_team', '')) AS home_team,
         COALESCE(m.away_team, NULLIF(w.away_team, ''), NULLIF(mm.metadata->>'away_team', '')) AS away_team,
         NULLIF(w.added_by, '') AS added_by,
         ${kickoffResolutionSql('$2')} AS kickoff_at_utc,
         EXISTS (
           SELECT 1 FROM user_watch_subscriptions s WHERE s.match_id = w.match_id
         ) AS has_subscription
       FROM watchlist w
       LEFT JOIN matches m ON m.match_id::text = w.match_id
       LEFT JOIN monitored_matches mm ON mm.match_id = w.match_id
     )
     SELECT
       match_id,
       source,
       CASE
         WHEN COALESCE(match_status, 'NS') = ANY($3::text[]) THEN 'finished_match'
         ELSE 'kickoff_stale'
       END AS reason,
       match_status,
       kickoff_at_utc::text,
       home_team,
       away_team,
       added_by,
       has_subscription
     FROM resolved
     WHERE has_subscription = FALSE
       AND COALESCE(match_status, 'NS') <> ALL($4::text[])
       AND (
         COALESCE(match_status, 'NS') = ANY($3::text[])
         OR (
           kickoff_at_utc IS NOT NULL
           AND kickoff_at_utc < NOW() - ($1::int * INTERVAL '1 day')
         )
       )
     ORDER BY kickoff_at_utc NULLS LAST, match_id`,
    [staleDays, config.timezone, finishedStatuses, liveStatuses],
  );

  const monitoredResult = await query<CleanupRow>(
    `WITH resolved AS (
       SELECT
         mm.match_id,
         'monitored_only'::text AS source,
         m.status AS match_status,
         COALESCE(m.home_team, NULLIF(mm.metadata->>'home_team', '')) AS home_team,
         COALESCE(m.away_team, NULLIF(mm.metadata->>'away_team', '')) AS away_team,
         NULLIF(mm.metadata->>'added_by', '') AS added_by,
         ${monitoredKickoffResolutionSql('$2')} AS kickoff_at_utc,
         EXISTS (
           SELECT 1 FROM user_watch_subscriptions s WHERE s.match_id = mm.match_id
         ) AS has_subscription
       FROM monitored_matches mm
       LEFT JOIN watchlist w ON w.match_id = mm.match_id
       LEFT JOIN matches m ON m.match_id::text = mm.match_id
       WHERE w.match_id IS NULL
         AND COALESCE(mm.subscriber_count, 0) = 0
     )
     SELECT
       match_id,
       source,
       CASE
         WHEN COALESCE(match_status, 'NS') = ANY($3::text[]) THEN 'finished_match'
         ELSE 'kickoff_stale'
       END AS reason,
       match_status,
       kickoff_at_utc::text,
       home_team,
       away_team,
       added_by,
       has_subscription
     FROM resolved
     WHERE has_subscription = FALSE
       AND COALESCE(match_status, 'NS') <> ALL($4::text[])
       AND (
         COALESCE(match_status, 'NS') = ANY($3::text[])
         OR (
           kickoff_at_utc IS NOT NULL
           AND kickoff_at_utc < NOW() - ($1::int * INTERVAL '1 day')
         )
       )
     ORDER BY kickoff_at_utc NULLS LAST, match_id`,
    [staleDays, config.timezone, finishedStatuses, liveStatuses],
  );

  const byMatchId = new Map<string, LegacyWatchlistCleanupCandidate>();
  for (const row of [...legacyResult.rows, ...monitoredResult.rows]) {
    if (byMatchId.has(row.match_id)) continue;
    byMatchId.set(row.match_id, mapCandidate(row));
  }

  const candidates = Array.from(byMatchId.values());
  return {
    staleDays,
    protectedBySubscription: Number(protectedResult.rows[0]?.count ?? '0'),
    candidates,
    summary: summarizeCandidates(candidates),
  };
}

export async function applyLegacyWatchlistCleanup(
  staleDays: number = config.legacyWatchlistStaleDays,
): Promise<LegacyWatchlistCleanupApplyResult> {
  const preview = await previewLegacyWatchlistCleanup(staleDays);
  const matchIds = preview.candidates.map((row) => row.match_id);
  if (matchIds.length === 0) {
    return { deletedLegacyWatchlistRows: 0, deletedMonitoredMatches: 0, matchIds: [] };
  }

  return transaction(async (client) => {
    const legacyDelete = await client.query(
      `DELETE FROM watchlist w
        WHERE w.match_id = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM user_watch_subscriptions s WHERE s.match_id = w.match_id
          )`,
      [matchIds],
    );

    const monitoredDelete = await client.query(
      `DELETE FROM monitored_matches mm
        WHERE mm.match_id = ANY($1::text[])
          AND COALESCE(mm.subscriber_count, 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM user_watch_subscriptions s WHERE s.match_id = mm.match_id
          )`,
      [matchIds],
    );

    return {
      deletedLegacyWatchlistRows: legacyDelete.rowCount ?? 0,
      deletedMonitoredMatches: monitoredDelete.rowCount ?? 0,
      matchIds,
    };
  });
}
