// ============================================================
// Watchlist Repository
// ============================================================

import { query } from '../db/pool.js';
import { config } from '../config.js';

export interface WatchlistRow {
  id: number;
  match_id: string;
  date: string | null;
  kickoff_at_utc?: string | null;
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
  auto_apply_recommended_condition?: boolean;
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

interface SubscriptionWatchlistQueryRow {
  subscription_id: number;
  user_id: string;
  match_id: string;
  mode: string;
  priority: number;
  custom_condition_text: string;
  auto_apply_recommended_condition: boolean;
  notify_enabled: boolean;
  status: string;
  source: string;
  created_at: string;
  subscriber_count: number | null;
  metadata: Record<string, unknown> | null;
  match_date: string | null;
  match_kickoff: string | null;
  match_kickoff_at_utc: string | null;
  match_league: string | null;
  home_team: string | null;
  away_team: string | null;
  home_logo: string | null;
  away_logo: string | null;
  match_status: string | null;
}

interface AggregatedWatchlistQueryRow {
  match_id: string;
  mode: string;
  priority: number;
  custom_condition_text: string | null;
  auto_apply_recommended_condition: boolean;
  status: string;
  source: string;
  created_at: string;
  subscriber_count: number;
  metadata: Record<string, unknown> | null;
  match_date: string | null;
  match_kickoff: string | null;
  match_kickoff_at_utc: string | null;
  match_league: string | null;
  home_team: string | null;
  away_team: string | null;
  home_logo: string | null;
  away_logo: string | null;
  match_status: string | null;
}

const LIVE_MATCH_STATUSES = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'] as const;

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function buildWatchlistRow(
  base: {
    match_id: string;
    date: string | null;
    kickoff: string | null;
    kickoff_at_utc?: string | null;
    league: string | null;
    home_team: string | null;
    away_team: string | null;
    home_logo?: string | null;
    away_logo?: string | null;
    match_status?: string | null;
  },
  subscription: {
    id?: number | null;
    mode?: string | null;
    priority?: number | null;
    custom_conditions?: string | null;
    auto_apply_recommended_condition?: boolean | null;
    status?: string | null;
    added_at?: string | null;
    added_by?: string | null;
  },
  sharedMetadata: Record<string, unknown>,
): WatchlistRow & { match_status?: string } {
  const prediction = sharedMetadata.prediction ?? null;
  const strategicContext = sharedMetadata.strategic_context ?? null;
  const totalChecks = normalizeNullableNumber(sharedMetadata.total_checks) ?? 0;
  const recommendationsCount = normalizeNullableNumber(sharedMetadata.recommendations_count) ?? 0;

  return {
    id: subscription.id ?? 0,
    match_id: base.match_id,
    date: base.date ?? normalizeNullableString(sharedMetadata.date),
    kickoff_at_utc: base.kickoff_at_utc ?? normalizeNullableString(sharedMetadata.kickoff_at_utc),
    league: base.league ?? normalizeNullableString(sharedMetadata.league) ?? '',
    home_team: base.home_team ?? normalizeNullableString(sharedMetadata.home_team) ?? '',
    away_team: base.away_team ?? normalizeNullableString(sharedMetadata.away_team) ?? '',
    home_logo: base.home_logo ?? normalizeNullableString(sharedMetadata.home_logo) ?? '',
    away_logo: base.away_logo ?? normalizeNullableString(sharedMetadata.away_logo) ?? '',
    kickoff: base.kickoff ?? normalizeNullableString(sharedMetadata.kickoff),
    mode: subscription.mode ?? 'B',
    prediction,
    recommended_custom_condition: normalizeNullableString(sharedMetadata.recommended_custom_condition) ?? '',
    recommended_condition_reason: normalizeNullableString(sharedMetadata.recommended_condition_reason) ?? '',
    recommended_condition_reason_vi: normalizeNullableString(sharedMetadata.recommended_condition_reason_vi) ?? '',
    recommended_condition_at: normalizeNullableString(sharedMetadata.recommended_condition_at),
    auto_apply_recommended_condition: subscription.auto_apply_recommended_condition ?? true,
    custom_conditions: subscription.custom_conditions ?? '',
    priority: subscription.priority ?? 0,
    status: subscription.status ?? 'active',
    added_at: subscription.added_at ?? new Date(0).toISOString(),
    added_by: subscription.added_by ?? 'user',
    last_checked: normalizeNullableString(sharedMetadata.last_checked),
    total_checks: totalChecks,
    recommendations_count: recommendationsCount,
    strategic_context: strategicContext,
    strategic_context_at: normalizeNullableString(sharedMetadata.strategic_context_at),
    mins_to_kickoff: null,
    match_status: base.match_status ?? undefined,
  };
}

function extractSharedMetadata(fields: Partial<WatchlistRow>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const keys: Array<keyof WatchlistRow> = [
    'prediction',
    'recommended_custom_condition',
    'recommended_condition_reason',
    'recommended_condition_reason_vi',
    'recommended_condition_at',
    'strategic_context',
    'strategic_context_at',
    'last_checked',
    'total_checks',
    'recommendations_count',
    'date',
    'kickoff_at_utc',
    'league',
    'home_team',
    'away_team',
    'home_logo',
    'away_logo',
    'kickoff',
  ];

  for (const key of keys) {
    if (key in fields) {
      metadata[key] = fields[key] ?? null;
    }
  }
  return metadata;
}

function extractOperationalMetadata(fields: Partial<WatchlistRow>): Record<string, unknown> {
  const metadata = extractSharedMetadata(fields);
  const keys: Array<keyof WatchlistRow> = [
    'mode',
    'custom_conditions',
    'priority',
    'status',
    'added_at',
    'added_by',
    'auto_apply_recommended_condition',
  ];

  for (const key of keys) {
    if (key in fields) {
      metadata[key] = fields[key] ?? null;
    }
  }

  return metadata;
}

function hasOwnKeys(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length > 0;
}

async function upsertMonitoredMatch(matchId: string, metadata: Record<string, unknown>): Promise<void> {
  await query(
    `INSERT INTO monitored_matches (match_id, subscriber_count, runtime_status, last_interest_at, metadata)
     VALUES ($1, 0, 'idle', NOW(), $2::jsonb)
     ON CONFLICT (match_id) DO UPDATE
       SET last_interest_at = NOW(),
           metadata = monitored_matches.metadata || EXCLUDED.metadata`,
    [matchId, JSON.stringify(metadata)],
  );
}

async function updateMonitoredMetadata(matchId: string, metadata: Record<string, unknown>): Promise<void> {
  if (!hasOwnKeys(metadata)) return;
  await query(
    `INSERT INTO monitored_matches (match_id, subscriber_count, runtime_status, last_interest_at, metadata)
     VALUES ($1, 0, 'idle', NOW(), $2::jsonb)
     ON CONFLICT (match_id) DO UPDATE
       SET metadata = monitored_matches.metadata || EXCLUDED.metadata`,
    [matchId, JSON.stringify(metadata)],
  );
}

async function refreshSubscriberCount(matchId: string): Promise<void> {
  await query(
    `INSERT INTO monitored_matches (match_id, subscriber_count, runtime_status, last_interest_at, metadata)
     VALUES ($1, 0, 'idle', NOW(), '{}'::jsonb)
     ON CONFLICT (match_id) DO UPDATE
       SET subscriber_count = (
         SELECT COUNT(*)::int
         FROM user_watch_subscriptions s
         WHERE s.match_id = $1
       ),
           last_interest_at = NOW()`,
    [matchId],
  );
}

async function getUserWatchlistRows(
  userId: string,
): Promise<(WatchlistRow & { match_status?: string })[]> {
  const result = await query<SubscriptionWatchlistQueryRow>(
    `SELECT
        s.id AS subscription_id,
        s.user_id,
        s.match_id,
        s.mode,
        s.priority,
        s.custom_condition_text,
        s.auto_apply_recommended_condition,
        s.notify_enabled,
        s.status,
        s.source,
        s.created_at,
        mm.subscriber_count,
        mm.metadata,
        m.date::text AS match_date,
        to_char(m.kickoff, 'HH24:MI') AS match_kickoff,
        m.kickoff_at_utc::text AS match_kickoff_at_utc,
        m.league_name AS match_league,
        m.home_team,
        m.away_team,
        m.home_logo,
        m.away_logo,
        m.status AS match_status
      FROM user_watch_subscriptions s
      LEFT JOIN monitored_matches mm ON mm.match_id = s.match_id
      LEFT JOIN matches m ON m.match_id::text = s.match_id
      WHERE s.user_id = $1
      ORDER BY s.priority DESC, match_date NULLS LAST, match_kickoff NULLS LAST`,
    [userId],
  );

  return result.rows.map((row) => buildWatchlistRow(
    {
      match_id: row.match_id,
      date: row.match_date,
      kickoff: row.match_kickoff,
      kickoff_at_utc: row.match_kickoff_at_utc,
      league: row.match_league,
      home_team: row.home_team,
      away_team: row.away_team,
      home_logo: row.home_logo,
      away_logo: row.away_logo,
      match_status: row.match_status,
    },
    {
      id: row.subscription_id,
      mode: row.mode,
      priority: row.priority,
      custom_conditions: row.custom_condition_text,
      auto_apply_recommended_condition: row.auto_apply_recommended_condition,
      status: row.status,
      added_at: row.created_at,
      added_by: row.source,
    },
    normalizeObject(row.metadata),
  ));
}

async function getLegacyWatchlistByMatchId(matchId: string): Promise<WatchlistRow | null> {
  const r = await query<WatchlistRow>('SELECT * FROM watchlist WHERE match_id = $1', [matchId]);
  return r.rows[0] ?? null;
}

async function getMonitoredOperationalWatchlist(
  activeOnly: boolean,
): Promise<(WatchlistRow & { match_status?: string })[]> {
  const result = await query<AggregatedWatchlistQueryRow>(
    `WITH ranked AS (
       SELECT
         s.match_id,
         s.mode,
         s.priority,
         s.custom_condition_text,
         s.auto_apply_recommended_condition,
         s.status,
         s.source,
         s.created_at,
         ROW_NUMBER() OVER (
           PARTITION BY s.match_id
           ORDER BY CASE WHEN UPPER(s.mode) = 'F' THEN 1 ELSE 0 END DESC,
                    s.priority DESC,
                    s.created_at ASC
         ) AS row_rank
       FROM user_watch_subscriptions s
      WHERE ($1::boolean = false OR s.status = 'active')
     )
     SELECT
       mm.match_id,
       COALESCE(ranked.mode, NULLIF(mm.metadata->>'mode', ''), 'B') AS mode,
       COALESCE(ranked.priority, NULLIF(mm.metadata->>'priority', '')::int, 0) AS priority,
       COALESCE(ranked.custom_condition_text, NULLIF(mm.metadata->>'custom_conditions', '')) AS custom_condition_text,
       COALESCE(ranked.auto_apply_recommended_condition, (mm.metadata->>'auto_apply_recommended_condition')::boolean, true) AS auto_apply_recommended_condition,
       COALESCE(ranked.status, NULLIF(mm.metadata->>'status', ''), 'active') AS status,
       COALESCE(ranked.source, NULLIF(mm.metadata->>'added_by', ''), 'system') AS source,
       COALESCE(ranked.created_at::text, NULLIF(mm.metadata->>'added_at', ''), mm.last_interest_at::text) AS created_at,
       COALESCE(mm.subscriber_count, 0) AS subscriber_count,
       mm.metadata,
       m.date::text AS match_date,
       to_char(m.kickoff, 'HH24:MI') AS match_kickoff,
      m.kickoff_at_utc::text AS match_kickoff_at_utc,
       m.league_name AS match_league,
       m.home_team,
       m.away_team,
       m.home_logo,
       m.away_logo,
       m.status AS match_status
     FROM monitored_matches mm
     LEFT JOIN ranked ON ranked.match_id = mm.match_id AND ranked.row_rank = 1
     LEFT JOIN matches m ON m.match_id::text = mm.match_id
     WHERE ($1::boolean = false OR COALESCE(ranked.status, NULLIF(mm.metadata->>'status', ''), 'active') = 'active')
     ORDER BY COALESCE(ranked.priority, NULLIF(mm.metadata->>'priority', '')::int, 0) DESC,
              match_date NULLS LAST,
              match_kickoff NULLS LAST`,
    [activeOnly],
  );

  return result.rows.map((row) => {
    const metadata = normalizeObject(row.metadata);
    return buildWatchlistRow(
      {
        match_id: row.match_id,
        date: row.match_date,
        kickoff: row.match_kickoff,
        kickoff_at_utc: row.match_kickoff_at_utc,
        league: row.match_league,
        home_team: row.home_team,
        away_team: row.away_team,
        home_logo: row.home_logo,
        away_logo: row.away_logo,
        match_status: row.match_status,
      },
      {
        id: 0,
        mode: row.mode,
        priority: row.priority,
        custom_conditions: row.custom_condition_text ?? normalizeNullableString(metadata.custom_conditions) ?? '',
        auto_apply_recommended_condition: normalizeBoolean(row.auto_apply_recommended_condition, true),
        status: row.status,
        added_at: row.created_at,
        added_by: row.source,
      },
      metadata,
    );
  });
}

async function getMonitoredOperationalWatchlistByMatchId(matchId: string): Promise<WatchlistRow | null> {
  const rows = await getMonitoredOperationalWatchlist(false);
  return rows.find((row) => row.match_id === matchId) ?? null;
}

export async function backfillOperationalWatchlistFromLegacy(): Promise<number> {
  const result = await query(
    `INSERT INTO monitored_matches (match_id, subscriber_count, runtime_status, last_interest_at, metadata)
     SELECT
       w.match_id,
       0,
       'idle',
       NOW(),
       jsonb_strip_nulls(jsonb_build_object(
         'date', w.date,
         'kickoff_at_utc', CASE
           WHEN w.date IS NOT NULL AND w.kickoff IS NOT NULL
             THEN (((w.date + w.kickoff) AT TIME ZONE current_setting('TIMEZONE'))::text)
           ELSE NULL
         END,
         'league', NULLIF(w.league, ''),
         'home_team', NULLIF(w.home_team, ''),
         'away_team', NULLIF(w.away_team, ''),
         'home_logo', NULLIF(w.home_logo, ''),
         'away_logo', NULLIF(w.away_logo, ''),
         'kickoff', w.kickoff,
         'mode', NULLIF(w.mode, ''),
         'prediction', w.prediction,
         'recommended_custom_condition', NULLIF(w.recommended_custom_condition, ''),
         'recommended_condition_reason', NULLIF(w.recommended_condition_reason, ''),
         'recommended_condition_reason_vi', NULLIF(w.recommended_condition_reason_vi, ''),
         'recommended_condition_at', w.recommended_condition_at,
         'auto_apply_recommended_condition', w.auto_apply_recommended_condition,
         'custom_conditions', NULLIF(w.custom_conditions, ''),
         'priority', w.priority,
         'status', NULLIF(w.status, ''),
         'added_at', w.added_at,
         'added_by', NULLIF(w.added_by, ''),
         'last_checked', w.last_checked,
         'total_checks', w.total_checks,
         'recommendations_count', w.recommendations_count,
         'strategic_context', w.strategic_context,
         'strategic_context_at', w.strategic_context_at
       ))
     FROM watchlist w
     LEFT JOIN monitored_matches mm ON mm.match_id = w.match_id
     WHERE mm.match_id IS NULL
     ON CONFLICT (match_id) DO NOTHING`,
  );

  return result.rowCount ?? 0;
}

async function mirrorLegacyWatchlistEntryToMonitored(row: WatchlistRow): Promise<void> {
  await upsertMonitoredMatch(row.match_id, extractOperationalMetadata(row));
}

export async function getAllOperationalWatchlist(): Promise<(WatchlistRow & { match_status?: string })[]> {
  await backfillOperationalWatchlistFromLegacy();
  return getMonitoredOperationalWatchlist(false);
}

export async function getActiveOperationalWatchlist(): Promise<WatchlistRow[]> {
  await backfillOperationalWatchlistFromLegacy();
  return getMonitoredOperationalWatchlist(true);
}

export async function getOperationalWatchlistByMatchId(matchId: string): Promise<WatchlistRow | null> {
  const monitored = await getMonitoredOperationalWatchlistByMatchId(matchId);
  if (monitored) return monitored;

  const legacy = await getLegacyWatchlistByMatchId(matchId);
  if (!legacy) return null;

  await mirrorLegacyWatchlistEntryToMonitored(legacy);
  const mirrored = await getMonitoredOperationalWatchlistByMatchId(matchId);
  if (mirrored) return mirrored;

  return legacy;
}

export async function updateOperationalWatchlistEntry(
  matchId: string,
  fields: Partial<WatchlistRow>,
): Promise<WatchlistRow | null> {
  const operationalMetadata = extractOperationalMetadata(fields);
  await updateMonitoredMetadata(matchId, operationalMetadata);
  return getOperationalWatchlistByMatchId(matchId);
}

export async function createOperationalWatchlistEntry(
  w: Partial<WatchlistCreate>,
): Promise<WatchlistRow> {
  const metadata = extractOperationalMetadata(w as Partial<WatchlistRow>);
  await upsertMonitoredMatch(w.match_id!, metadata);
  return (await getOperationalWatchlistByMatchId(w.match_id!))!;
}

export async function getAllWatchlist(userId?: string): Promise<(WatchlistRow & { match_status?: string })[]> {
  if (userId) {
    return getUserWatchlistRows(userId);
  }

  return getAllOperationalWatchlist();
}

export async function getKickoffMinutesForMatchIds(
  matchIds: string[],
  timezone: string = config.timezone,
): Promise<Map<string, number | null>> {
  if (matchIds.length === 0) return new Map();
  const r = await query<{ match_id: string; mins_to_kickoff: string | null }>(
    `SELECT ids.match_id,
            CASE
              WHEN COALESCE(
                m.kickoff_at_utc,
                NULLIF(mm.metadata->>'kickoff_at_utc', '')::timestamptz,
                CASE
                  WHEN COALESCE(m.date, NULLIF(mm.metadata->>'date', '')::date) IS NULL
                    OR COALESCE(m.kickoff, NULLIF(mm.metadata->>'kickoff', '')::time) IS NULL THEN NULL
                  ELSE (
                    COALESCE(m.date, NULLIF(mm.metadata->>'date', '')::date)
                    + COALESCE(m.kickoff, NULLIF(mm.metadata->>'kickoff', '')::time)
                  ) AT TIME ZONE $2
                END
              ) IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (
                COALESCE(
                  m.kickoff_at_utc,
                  NULLIF(mm.metadata->>'kickoff_at_utc', '')::timestamptz,
                  (
                    COALESCE(m.date, NULLIF(mm.metadata->>'date', '')::date)
                    + COALESCE(m.kickoff, NULLIF(mm.metadata->>'kickoff', '')::time)
                  ) AT TIME ZONE $2
                ) - NOW()
              )) / 60
            END AS mins_to_kickoff
       FROM unnest($1::text[]) AS ids(match_id)
       LEFT JOIN matches m ON m.match_id::text = ids.match_id
       LEFT JOIN monitored_matches mm ON mm.match_id = ids.match_id`,
    [matchIds, timezone],
  );
  return new Map(r.rows.map((row) => [
    row.match_id,
    row.mins_to_kickoff != null ? Number(row.mins_to_kickoff) : null,
  ]));
}

export async function getWatchlistByMatchId(matchId: string, userId: string): Promise<WatchlistRow | null> {
  const rows = await query<SubscriptionWatchlistQueryRow>(
    `SELECT
        s.id AS subscription_id,
        s.user_id,
        s.match_id,
        s.mode,
        s.priority,
        s.custom_condition_text,
        s.auto_apply_recommended_condition,
        s.notify_enabled,
        s.status,
        s.source,
        s.created_at,
        mm.subscriber_count,
        mm.metadata,
        m.date::text AS match_date,
        to_char(m.kickoff, 'HH24:MI') AS match_kickoff,
        m.kickoff_at_utc::text AS match_kickoff_at_utc,
        m.league_name AS match_league,
        m.home_team,
        m.away_team,
        m.home_logo,
        m.away_logo,
        m.status AS match_status
      FROM user_watch_subscriptions s
      LEFT JOIN monitored_matches mm ON mm.match_id = s.match_id
      LEFT JOIN matches m ON m.match_id::text = s.match_id
      WHERE s.user_id = $1 AND s.match_id = $2
      LIMIT 1`,
    [userId, matchId],
  );
  const row = rows.rows[0];
  if (row) {
    return buildWatchlistRow(
      {
        match_id: row.match_id,
        date: row.match_date,
        kickoff: row.match_kickoff,
        kickoff_at_utc: row.match_kickoff_at_utc,
        league: row.match_league,
        home_team: row.home_team,
        away_team: row.away_team,
        home_logo: row.home_logo,
        away_logo: row.away_logo,
        match_status: row.match_status,
      },
      {
        id: row.subscription_id,
        mode: row.mode,
        priority: row.priority,
        custom_conditions: row.custom_condition_text,
        auto_apply_recommended_condition: row.auto_apply_recommended_condition,
        status: row.status,
        added_at: row.created_at,
        added_by: row.source,
      },
      normalizeObject(row.metadata),
    );
  }

  return null;
}

export async function getWatchSubscriptionById(subscriptionId: number, userId: string): Promise<WatchlistRow | null> {
  const rows = await query<SubscriptionWatchlistQueryRow>(
    `SELECT
        s.id AS subscription_id,
        s.user_id,
        s.match_id,
        s.mode,
        s.priority,
        s.custom_condition_text,
        s.auto_apply_recommended_condition,
        s.notify_enabled,
        s.status,
        s.source,
        s.created_at,
        mm.subscriber_count,
        mm.metadata,
        m.date::text AS match_date,
        to_char(m.kickoff, 'HH24:MI') AS match_kickoff,
        m.kickoff_at_utc::text AS match_kickoff_at_utc,
        m.league_name AS match_league,
        m.home_team,
        m.away_team,
        m.home_logo,
        m.away_logo,
        m.status AS match_status
      FROM user_watch_subscriptions s
      LEFT JOIN monitored_matches mm ON mm.match_id = s.match_id
      LEFT JOIN matches m ON m.match_id::text = s.match_id
      WHERE s.user_id = $1 AND s.id = $2
      LIMIT 1`,
    [userId, subscriptionId],
  );

  const row = rows.rows[0];
  if (!row) return null;

  return buildWatchlistRow(
    {
      match_id: row.match_id,
      date: row.match_date,
      kickoff: row.match_kickoff,
      kickoff_at_utc: row.match_kickoff_at_utc,
      league: row.match_league,
      home_team: row.home_team,
      away_team: row.away_team,
      home_logo: row.home_logo,
      away_logo: row.away_logo,
      match_status: row.match_status,
    },
    {
      id: row.subscription_id,
      mode: row.mode,
      priority: row.priority,
      custom_conditions: row.custom_condition_text,
      auto_apply_recommended_condition: row.auto_apply_recommended_condition,
      status: row.status,
      added_at: row.created_at,
      added_by: row.source,
    },
    normalizeObject(row.metadata),
  );
}

/** Returns a Set of match_ids that already exist in the watchlist — single query for N ids. */
export async function getExistingWatchlistMatchIds(matchIds: string[]): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set();
  const r = await query<{ match_id: string }>(
    `SELECT match_id FROM watchlist WHERE match_id = ANY($1)
     UNION
     SELECT match_id FROM monitored_matches WHERE match_id = ANY($1)
     UNION
     SELECT match_id FROM user_watch_subscriptions WHERE match_id = ANY($1)`,
    [matchIds],
  );
  return new Set(r.rows.map((row) => row.match_id));
}

export async function createWatchlistEntry(
  w: Partial<WatchlistCreate>,
  userId: string,
): Promise<WatchlistRow> {
  const metadata = extractSharedMetadata(w as Partial<WatchlistRow>);
  await upsertMonitoredMatch(w.match_id!, metadata);

  await query(
    `INSERT INTO user_watch_subscriptions (
        user_id, match_id, mode, priority, custom_condition_text,
        auto_apply_recommended_condition, notify_enabled, status, source, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, NOW())
     ON CONFLICT (user_id, match_id) DO UPDATE
       SET mode = EXCLUDED.mode,
           priority = EXCLUDED.priority,
           custom_condition_text = EXCLUDED.custom_condition_text,
           auto_apply_recommended_condition = EXCLUDED.auto_apply_recommended_condition,
           status = EXCLUDED.status,
           source = EXCLUDED.source,
           updated_at = NOW()`,
    [
      userId,
      w.match_id,
      w.mode ?? 'B',
      w.priority ?? 0,
      w.custom_conditions ?? '',
      w.auto_apply_recommended_condition ?? true,
      w.status ?? 'active',
      w.added_by ?? 'manual',
    ],
  );

  await refreshSubscriberCount(w.match_id!);
  return (await getWatchlistByMatchId(w.match_id!, userId))!;
}

export async function updateWatchlistEntry(
  matchId: string,
  fields: Partial<WatchlistRow>,
  userId: string,
): Promise<WatchlistRow | null> {
  const subscriptionFields: Array<keyof WatchlistRow> = [
    'mode',
    'priority',
    'custom_conditions',
    'auto_apply_recommended_condition',
    'status',
  ];
  const shouldUpdateSubscription = subscriptionFields.some((key) => key in fields);
  if (shouldUpdateSubscription) {
    const existing = await query<{ id: number }>(
      'SELECT id FROM user_watch_subscriptions WHERE user_id = $1 AND match_id = $2 LIMIT 1',
      [userId, matchId],
    );
    if (existing.rows[0]) {
      await query(
        `UPDATE user_watch_subscriptions
            SET mode = COALESCE($3, mode),
                priority = COALESCE($4, priority),
                custom_condition_text = COALESCE($5, custom_condition_text),
                auto_apply_recommended_condition = COALESCE($6, auto_apply_recommended_condition),
                status = COALESCE($7, status),
                updated_at = NOW()
          WHERE user_id = $1 AND match_id = $2`,
        [
          userId,
          matchId,
          fields.mode ?? null,
          fields.priority ?? null,
          fields.custom_conditions ?? null,
          fields.auto_apply_recommended_condition ?? null,
          fields.status ?? null,
        ],
      );
      await refreshSubscriberCount(matchId);
    }
  }

  const sharedMetadata = extractSharedMetadata(fields);
  await updateMonitoredMetadata(matchId, sharedMetadata);

  const updated = await getWatchlistByMatchId(matchId, userId);
  if (updated) return updated;

  return null;
}

export async function updateWatchSubscriptionById(
  subscriptionId: number,
  fields: Partial<WatchlistRow>,
  userId: string,
): Promise<WatchlistRow | null> {
  const existing = await query<{ match_id: string }>(
    'SELECT match_id FROM user_watch_subscriptions WHERE user_id = $1 AND id = $2 LIMIT 1',
    [userId, subscriptionId],
  );
  const matchId = existing.rows[0]?.match_id;
  if (!matchId) return null;
  return updateWatchlistEntry(matchId, fields, userId);
}

export async function deleteWatchlistEntry(matchId: string, userId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM user_watch_subscriptions WHERE user_id = $1 AND match_id = $2',
    [userId, matchId],
  );
  if ((result.rowCount ?? 0) > 0) {
    await refreshSubscriberCount(matchId);
    return true;
  }

  return false;
}

export async function deleteWatchSubscriptionById(subscriptionId: number, userId: string): Promise<boolean> {
  const existing = await query<{ match_id: string }>(
    'SELECT match_id FROM user_watch_subscriptions WHERE user_id = $1 AND id = $2 LIMIT 1',
    [userId, subscriptionId],
  );
  const matchId = existing.rows[0]?.match_id;
  if (!matchId) return false;
  return deleteWatchlistEntry(matchId, userId);
}

export async function incrementChecks(matchId: string): Promise<void> {
  await incrementChecksForMatches([matchId]);
}

/** Batch-increment check counters — single query replacing N individual updates */
export async function incrementChecksForMatches(matchIds: string[]): Promise<void> {
  if (matchIds.length === 0) return;
  await query(
    `UPDATE monitored_matches
        SET metadata = jsonb_set(
          jsonb_set(
            metadata,
            '{total_checks}',
            to_jsonb(COALESCE((metadata->>'total_checks')::int, 0) + 1),
            true
          ),
          '{last_checked}',
          to_jsonb(NOW()),
          true
        )
      WHERE match_id = ANY($1)`,
    [matchIds],
  );
}

export async function expireOldEntries(cutoffMinutes: number = 120): Promise<number> {
  await backfillOperationalWatchlistFromLegacy();

  // Resolve kickoff from matches table first, then fall back to monitored_matches.metadata.
  // Many watchlist entries exist only in monitored_matches (not in the matches table), so
  // a plain INNER JOIN on matches would silently skip them and they would never expire.
  const expiredSubscriptions = await query<{ match_id: string }>(
    `DELETE FROM user_watch_subscriptions s
      USING monitored_matches mm
      LEFT JOIN matches m ON m.match_id::text = mm.match_id
      WHERE mm.match_id = s.match_id
        AND COALESCE(
          m.kickoff_at_utc,
          NULLIF(mm.metadata->>'kickoff_at_utc', '')::timestamptz,
          CASE
            WHEN COALESCE(m.date, NULLIF(mm.metadata->>'date', '')::date) IS NOT NULL
             AND COALESCE(m.kickoff, NULLIF(mm.metadata->>'kickoff', '')::time) IS NOT NULL
            THEN (
              COALESCE(m.date, NULLIF(mm.metadata->>'date', '')::date)
              + COALESCE(m.kickoff, NULLIF(mm.metadata->>'kickoff', '')::time)
            ) AT TIME ZONE $2
            ELSE NULL
          END
        ) + $1 * INTERVAL '1 minute' < NOW()
        AND COALESCE(m.status, 'NS') <> ALL($3)
      RETURNING s.match_id`,
    [cutoffMinutes, config.timezone, LIVE_MATCH_STATUSES],
  );

  const expiredMatchIds = Array.from(new Set(expiredSubscriptions.rows.map((row) => row.match_id)));
  for (const matchId of expiredMatchIds) {
    await refreshSubscriberCount(matchId);
  }

  // For monitored_matches: kickoff data is already in metadata (via backfill + syncWatchlistDates).
  // Use a NOT EXISTS guard to keep any match the live-monitor still considers active.
  const monitoredResult = await query(
    `DELETE FROM monitored_matches mm
      WHERE COALESCE(
          NULLIF(mm.metadata->>'kickoff_at_utc', '')::timestamptz,
          CASE
            WHEN NULLIF(mm.metadata->>'date', '')::date IS NOT NULL
             AND NULLIF(mm.metadata->>'kickoff', '')::time IS NOT NULL
            THEN (
              NULLIF(mm.metadata->>'date', '')::date
              + NULLIF(mm.metadata->>'kickoff', '')::time
            ) AT TIME ZONE $2
            ELSE NULL
          END
        ) + $1 * INTERVAL '1 minute' < NOW()
        AND NOT EXISTS (
          SELECT 1 FROM matches m
          WHERE m.match_id::text = mm.match_id
            AND m.status = ANY($3)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM user_watch_subscriptions s
          WHERE s.match_id = mm.match_id
        )`,
    [cutoffMinutes, config.timezone, LIVE_MATCH_STATUSES],
  );

  return Math.max(expiredMatchIds.length, monitoredResult.rowCount ?? 0);
}

/** Sync watchlist date/kickoff from matches table (matches refresh may change them) */
export async function syncWatchlistDates(): Promise<number> {
  const r = await query(
    `UPDATE monitored_matches mm
     SET metadata = jsonb_set(
       jsonb_set(
         jsonb_set(
           COALESCE(mm.metadata, '{}'::jsonb),
           '{date}',
           to_jsonb(m.date::text),
           true
         ),
         '{kickoff}',
         to_jsonb(to_char(m.kickoff, 'HH24:MI')),
         true
       ),
       '{kickoff_at_utc}',
       to_jsonb(m.kickoff_at_utc::text),
       true
     )
     FROM matches m
     WHERE mm.match_id = m.match_id::text
       AND COALESCE(NULLIF(mm.metadata->>'status', ''), 'active') = 'active'
       AND (
         NULLIF(mm.metadata->>'date', '') IS DISTINCT FROM m.date::text
         OR NULLIF(mm.metadata->>'kickoff', '') IS DISTINCT FROM to_char(m.kickoff, 'HH24:MI')
         OR NULLIF(mm.metadata->>'kickoff_at_utc', '') IS DISTINCT FROM m.kickoff_at_utc::text
       )`,
  );
  return r.rowCount ?? 0;
}
