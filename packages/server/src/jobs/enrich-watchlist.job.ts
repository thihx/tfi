// ============================================================
// Job: Enrich Watchlist with Strategic Context
//
// For each active watchlist entry that is within 2 hours of kickoff
// and still lacks usable strategic context, fetch strategic match context
// (motivation, rotation, injuries) via AI + Google Search.
// Also auto-generates recommended_custom_condition from the context.
// ============================================================

import {
  fetchStrategicContext,
  hasUsableStrategicContext,
  type StrategicContext,
} from '../lib/strategic-context.service.js';
import { mergeStrategicContextWithPredictionFallback } from '../lib/strategic-context-prediction-fallback.js';
import { config } from '../config.js';
import { getRedisClient } from '../lib/redis.js';
import * as matchRepo from '../repos/matches.repo.js';
import * as leaguesRepo from '../repos/leagues.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { getSettings } from '../repos/settings.repo.js';
import { reportJobProgress } from './job-progress.js';

const BROAD_ENRICH_WINDOW_HOURS = 24;
const BROAD_ENRICH_WINDOW_MINUTES = BROAD_ENRICH_WINDOW_HOURS * 60;
const PREMATCH_REFRESH_WINDOW_MINUTES = 2 * 60;
const FINAL_TOP_LEAGUE_REFRESH_WINDOW_MINUTES = 30;
const API_DELAY_MS = 2000;
const FAILURE_BACKOFF_MINUTES = [60, 180, 360, 720] as const;
const POOR_BACKOFF_MINUTES = [360, 720, 1440] as const;
const TOP_LEAGUE_FAILURE_BACKOFF_MINUTES = [15, 30, 60, 120] as const;
const TOP_LEAGUE_POOR_BACKOFF_MINUTES = [30, 60, 120, 240] as const;
const FORCE_KEY = 'job:enrich-watchlist:force-next';

let forceNextMemory = false;

type RefreshStatus = 'good' | 'poor' | 'failed';
type EnrichRefreshWindow = 'broad' | 'prematch' | 'final';

interface EnrichLeagueHints {
  topLeague?: boolean;
  leagueCountry?: string | null;
}

interface StrategicContextMeta {
  refresh_status?: RefreshStatus;
  failure_count?: number;
  last_attempt_at?: string;
  retry_after?: string | null;
  last_error?: string;
  refresh_window?: EnrichRefreshWindow;
}

type StoredStrategicContext = Partial<StrategicContext> & {
  _meta?: StrategicContextMeta;
};

/** Force next run to skip the stale-check and re-enrich all active entries. */
export function setForceEnrich(): void {
  forceNextMemory = true;
  try {
    void getRedisClient().set(FORCE_KEY, '1', 'EX', 60 * 60);
  } catch {
    // ignore — in-memory fallback still works for the current process
  }
}

async function consumeForceEnrich(): Promise<boolean> {
  let forced = forceNextMemory;
  forceNextMemory = false;
  try {
    const redis = getRedisClient();
    const raw = await redis.get(FORCE_KEY);
    if (raw) {
      forced = true;
      await redis.del(FORCE_KEY);
    }
  } catch {
    // ignore — in-memory fallback already applied
  }
  return forced;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasStructuredStrategicContext(ctx: StoredStrategicContext | null): boolean {
  return !!ctx
    && ctx.version === 2
    && !!ctx.source_meta
    && typeof ctx.source_meta === 'object';
}

function hasUsableContext(
  ctx: StoredStrategicContext | null,
  options: EnrichLeagueHints = {},
): boolean {
  if (!ctx) return false;
  const refreshStatus = String(ctx._meta?.refresh_status ?? '').trim().toLowerCase();
  if (refreshStatus === 'poor' || refreshStatus === 'failed') return false;
  if (!hasStructuredStrategicContext(ctx)) return false;
  return hasUsableStrategicContext(ctx, { topLeague: options.topLeague });
}

function normalizeCondition(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

function canAutoApplyCondition(
  currentCustomCondition: string,
  previousRecommendedCondition: string,
): boolean {
  const current = normalizeCondition(currentCustomCondition);
  if (!current) return true;
  const previous = normalizeCondition(previousRecommendedCondition);
  return !!previous && current === previous;
}

function getRetryAfter(ctx: StoredStrategicContext | null): number | null {
  const retryAt = ctx?._meta?.retry_after;
  if (!retryAt) return null;
  const ts = Date.parse(retryAt);
  return Number.isFinite(ts) ? ts : null;
}

function getTargetRefreshWindow(
  minsToKickoff: number | null | undefined,
  options: EnrichLeagueHints = {},
): EnrichRefreshWindow | null {
  if (minsToKickoff == null || minsToKickoff < 0 || minsToKickoff > BROAD_ENRICH_WINDOW_MINUTES) {
    return null;
  }
  if (options.topLeague && minsToKickoff <= FINAL_TOP_LEAGUE_REFRESH_WINDOW_MINUTES) return 'final';
  if (minsToKickoff <= PREMATCH_REFRESH_WINDOW_MINUTES) return 'prematch';
  return 'broad';
}

function getStoredRefreshWindow(ctx: StoredStrategicContext | null): EnrichRefreshWindow | null {
  const raw = String(ctx?._meta?.refresh_window ?? '').trim().toLowerCase();
  if (raw === 'broad' || raw === 'prematch' || raw === 'final') return raw;
  return null;
}

function pickBackoffMinutes(
  kind: 'poor' | 'failed',
  failureCount: number,
  options: EnrichLeagueHints = {},
): number {
  const table = options.topLeague
    ? (kind === 'poor' ? TOP_LEAGUE_POOR_BACKOFF_MINUTES : TOP_LEAGUE_FAILURE_BACKOFF_MINUTES)
    : (kind === 'poor' ? POOR_BACKOFF_MINUTES : FAILURE_BACKOFF_MINUTES);
  const index = Math.min(Math.max(failureCount - 1, 0), table.length - 1);
  return table[index]!;
}

function buildBasePoorContext(attemptedAt: string): StoredStrategicContext {
  return {
    home_motivation: '',
    away_motivation: '',
    league_positions: '',
    fixture_congestion: '',
    home_fixture_congestion: '',
    away_fixture_congestion: '',
    rotation_risk: '',
    key_absences: '',
    home_key_absences: '',
    away_key_absences: '',
    h2h_narrative: '',
    summary: 'No data found',
    home_motivation_vi: '',
    away_motivation_vi: '',
    league_positions_vi: '',
    fixture_congestion_vi: '',
    home_fixture_congestion_vi: '',
    away_fixture_congestion_vi: '',
    rotation_risk_vi: '',
    key_absences_vi: '',
    home_key_absences_vi: '',
    away_key_absences_vi: '',
    h2h_narrative_vi: '',
    summary_vi: 'Không tìm thấy dữ liệu',
    searched_at: attemptedAt,
    version: 2,
    competition_type: '',
    ai_condition: '',
    ai_condition_reason: '',
    ai_condition_reason_vi: '',
    qualitative: {
      en: {
        home_motivation: '',
        away_motivation: '',
        league_positions: '',
        fixture_congestion: '',
        home_fixture_congestion: '',
        away_fixture_congestion: '',
        rotation_risk: '',
        key_absences: '',
        home_key_absences: '',
        away_key_absences: '',
        h2h_narrative: '',
        summary: 'No data found',
      },
      vi: {
        home_motivation: '',
        away_motivation: '',
        league_positions: '',
        fixture_congestion: '',
        home_fixture_congestion: '',
        away_fixture_congestion: '',
        rotation_risk: '',
        key_absences: '',
        home_key_absences: '',
        away_key_absences: '',
        h2h_narrative: '',
        summary: 'Không tìm thấy dữ liệu',
      },
    },
    quantitative: {
      home_last5_points: null,
      away_last5_points: null,
      home_last5_goals_for: null,
      away_last5_goals_for: null,
      home_last5_goals_against: null,
      away_last5_goals_against: null,
      home_home_goals_avg: null,
      away_away_goals_avg: null,
      home_over_2_5_rate_last10: null,
      away_over_2_5_rate_last10: null,
      home_btts_rate_last10: null,
      away_btts_rate_last10: null,
      home_clean_sheet_rate_last10: null,
      away_clean_sheet_rate_last10: null,
      home_failed_to_score_rate_last10: null,
      away_failed_to_score_rate_last10: null,
    },
    source_meta: {
      search_quality: 'unknown',
      web_search_queries: [],
      sources: [],
      trusted_source_count: 0,
      rejected_source_count: 0,
      rejected_domains: [],
    },
  };
}

function buildRetryContext(
  current: StoredStrategicContext | null,
  kind: 'poor' | 'failed',
  attemptedAt: string,
  refreshWindow: EnrichRefreshWindow,
  seedContext: StoredStrategicContext | null = null,
  errorMessage = '',
  options: EnrichLeagueHints = {},
): StoredStrategicContext {
  const existing = current ?? null;
  const usable = hasUsableContext(existing, options);
  const previousFailures = Math.max(0, Number(existing?._meta?.failure_count ?? 0));
  const failureCount = previousFailures + 1;
  const retryMinutes = pickBackoffMinutes(kind, failureCount, options);
  const retryAfter = new Date(Date.parse(attemptedAt) + retryMinutes * 60 * 1000).toISOString();

  return {
    ...(usable ? existing! : (seedContext ?? buildBasePoorContext(attemptedAt))),
    _meta: {
      refresh_status: kind,
      failure_count: failureCount,
      last_attempt_at: attemptedAt,
      retry_after: retryAfter,
      last_error: errorMessage || undefined,
      refresh_window: refreshWindow,
    },
  };
}

function buildSuccessfulContext(
  context: StrategicContext,
  attemptedAt: string,
  refreshWindow: EnrichRefreshWindow,
): StoredStrategicContext {
  return {
    ...context,
    _meta: {
      refresh_status: 'good',
      failure_count: 0,
      last_attempt_at: attemptedAt,
      retry_after: null,
      refresh_window: refreshWindow,
    },
  };
}

async function persistRetryState(
  entry: watchlistRepo.WatchlistRow,
  kind: 'poor' | 'failed',
  attemptedAt: string,
  refreshWindow: EnrichRefreshWindow,
  seedContext: StoredStrategicContext | null = null,
  errorMessage = '',
  options: EnrichLeagueHints = {},
): Promise<void> {
  const existingContext = (entry.strategic_context as StoredStrategicContext | null) ?? null;
  const retryContext = buildRetryContext(existingContext, kind, attemptedAt, refreshWindow, seedContext, errorMessage, options);
  const updateFields: Partial<watchlistRepo.WatchlistRow> = {
    strategic_context: retryContext as unknown,
  };

  if (!hasUsableContext(existingContext, options)) {
    updateFields.strategic_context_at = attemptedAt;
  }

  await watchlistRepo.updateOperationalWatchlistEntry(entry.match_id, updateFields);
}

export async function enrichWatchlistJob(): Promise<{ checked: number; enriched: number }> {
  const JOB = 'enrich-watchlist';

  await reportJobProgress(JOB, 'load', 'Loading matches and watchlist...', 5);
  const allMatches = await matchRepo.getAllMatches();
  const allLeagues = await leaguesRepo.getAllLeagues().catch(() => []);
  const statusMap = new Map<string, string>();
  const matchMap = new Map(allMatches.map((match) => [match.match_id, match] as const));
  const leagueMap = new Map(allLeagues.map((league) => [league.league_id, league] as const));
  for (const match of allMatches) {
    statusMap.set(match.match_id, match.status.toUpperCase());
  }

  const watchlist = await watchlistRepo.getActiveOperationalWatchlist();
  const settings = await getSettings().catch(() => ({}));
  const autoApplyDefault =
    (settings as Record<string, unknown>).AUTO_APPLY_RECOMMENDED_CONDITION !== false;
  if (watchlist.length === 0) {
    console.log('[enrichWatchlistJob] Watchlist empty, skip.');
    return { checked: 0, enriched: 0 };
  }

  const force = await consumeForceEnrich();
  if (force) console.log('[enrichWatchlistJob] Force mode - skipping stale check');

  const now = Date.now();
  const kickoffMinutesByMatchId = force
    ? new Map<string, number | null>()
    : await watchlistRepo.getKickoffMinutesForMatchIds(
      watchlist.map((entry) => entry.match_id),
      config.timezone,
    );
  const eligible = watchlist.filter((entry) => {
    const matchStatus = statusMap.get(entry.match_id)?.toUpperCase() ?? '';
    if (matchStatus !== 'NS' && matchStatus !== '') return false;
    if (force) return true;

    const ctx = (entry.strategic_context as StoredStrategicContext | null) ?? null;
    const match = matchMap.get(entry.match_id);
    const leagueMeta = match?.league_id != null ? leagueMap.get(match.league_id) : null;
    const hints: EnrichLeagueHints = {
      topLeague: leagueMeta?.top_league === true,
      leagueCountry: leagueMeta?.country ?? null,
    };
    const minsToKickoff = kickoffMinutesByMatchId.get(entry.match_id);
    const targetWindow = getTargetRefreshWindow(minsToKickoff, hints);
    if (!targetWindow) return false;

    const hasUsable = hasUsableContext(ctx, hints);
    const existingWindow = getStoredRefreshWindow(ctx);
    if (hasUsable && existingWindow === targetWindow) return false;

    const retryAfter = getRetryAfter(ctx);
    if (retryAfter && retryAfter > now && existingWindow === targetWindow && !hints.topLeague) return false;

    return true;
  }).sort((left, right) => {
    const leftMatch = matchMap.get(left.match_id);
    const rightMatch = matchMap.get(right.match_id);
    const leftLeague = leftMatch?.league_id != null ? leagueMap.get(leftMatch.league_id) : null;
    const rightLeague = rightMatch?.league_id != null ? leagueMap.get(rightMatch.league_id) : null;
    const leftTop = leftLeague?.top_league === true ? 1 : 0;
    const rightTop = rightLeague?.top_league === true ? 1 : 0;
    if (leftTop !== rightTop) return rightTop - leftTop;
    const leftWindow = getTargetRefreshWindow(
      kickoffMinutesByMatchId.get(left.match_id),
      { topLeague: leftTop === 1, leagueCountry: leftLeague?.country ?? null },
    );
    const rightWindow = getTargetRefreshWindow(
      kickoffMinutesByMatchId.get(right.match_id),
      { topLeague: rightTop === 1, leagueCountry: rightLeague?.country ?? null },
    );
    const windowPriority = (value: EnrichRefreshWindow | null) => {
      if (value === 'final') return 3;
      if (value === 'prematch') return 2;
      if (value === 'broad') return 1;
      return 0;
    };
    if (windowPriority(leftWindow) !== windowPriority(rightWindow)) {
      return windowPriority(rightWindow) - windowPriority(leftWindow);
    }
    const leftKickoff = kickoffMinutesByMatchId.get(left.match_id) ?? Number.POSITIVE_INFINITY;
    const rightKickoff = kickoffMinutesByMatchId.get(right.match_id) ?? Number.POSITIVE_INFINITY;
    return leftKickoff - rightKickoff;
  });

  let checked = 0;
  let enriched = 0;
  const JOB_SOFT_DEADLINE_MS = 25 * 60_000; // stop accepting new matches after 25 min
  const jobStarted = Date.now();

  for (const entry of eligible) {
    if (Date.now() - jobStarted > JOB_SOFT_DEADLINE_MS) {
      console.warn(`[enrichWatchlistJob] Soft deadline reached after ${Math.round((Date.now() - jobStarted) / 60_000)}m, stopping early (${checked}/${eligible.length} processed)`);
      break;
    }
    checked++;
    await reportJobProgress(
      JOB,
      'enrich',
      `Enriching ${checked}/${eligible.length}: ${entry.home_team} vs ${entry.away_team}`,
      5 + (checked / eligible.length) * 90,
    );

    const attemptedAt = new Date().toISOString();
    const match = matchMap.get(entry.match_id);
    const leagueMeta = match?.league_id != null ? leagueMap.get(match.league_id) : null;
    const hints: EnrichLeagueHints = {
      topLeague: leagueMeta?.top_league === true,
      leagueCountry: leagueMeta?.country ?? null,
    };
    const minsToKickoff = force
      ? kickoffMinutesByMatchId.get(entry.match_id) ?? null
      : kickoffMinutesByMatchId.get(entry.match_id);
    const refreshWindow = force
      ? (hints.topLeague ? 'final' : 'prematch')
      : getTargetRefreshWindow(minsToKickoff, hints);
    if (!refreshWindow) continue;

    try {
      const context = await fetchStrategicContext(
        entry.home_team,
        entry.away_team,
        entry.league,
        entry.date,
        hints,
      );

      if (!context) {
        await persistRetryState(entry, 'failed', attemptedAt, refreshWindow, null, 'empty_response', hints);
        await sleep(API_DELAY_MS);
        continue;
      }

      const enrichedContext = mergeStrategicContextWithPredictionFallback(context, {
        homeTeam: entry.home_team,
        awayTeam: entry.away_team,
        prediction: entry.prediction,
      });

      if (!hasUsableContext(enrichedContext, hints)) {
        await persistRetryState(entry, 'poor', attemptedAt, refreshWindow, enrichedContext, '', hints);
        await sleep(API_DELAY_MS);
        continue;
      }

      const updateFields: Partial<watchlistRepo.WatchlistRow> = {
        strategic_context: buildSuccessfulContext(enrichedContext, attemptedAt, refreshWindow) as unknown,
        strategic_context_at: attemptedAt,
      };

      const existingCond = (entry.recommended_custom_condition || '').trim();
      const isEvaluable = existingCond.startsWith('(');
      const allowRecommendationRefresh = canAutoApplyCondition(
        entry.custom_conditions || '',
        entry.recommended_custom_condition || '',
      );
      if (force || !existingCond || !isEvaluable || allowRecommendationRefresh) {
        const aiCond = (enrichedContext.ai_condition || '').trim();
        const aiCondIsEvaluable = aiCond.startsWith('(');

        if (aiCondIsEvaluable) {
          const autoApplyEnabled = entry.auto_apply_recommended_condition ?? autoApplyDefault;
          (updateFields as Record<string, unknown>).recommended_custom_condition = aiCond;
          (updateFields as Record<string, unknown>).recommended_condition_reason = enrichedContext.ai_condition_reason || '';
          (updateFields as Record<string, unknown>).recommended_condition_reason_vi = enrichedContext.ai_condition_reason_vi || '';
          if (
            autoApplyEnabled
            && canAutoApplyCondition(entry.custom_conditions || '', entry.recommended_custom_condition || '')
          ) {
            (updateFields as Record<string, unknown>).custom_conditions = aiCond;
          }
          console.log(`[enrichWatchlistJob] AI condition: ${aiCond}`);
        } else {
          console.log(`[enrichWatchlistJob] AI did not generate evaluable condition for ${entry.home_team} vs ${entry.away_team}`);
        }
      }

      await watchlistRepo.updateOperationalWatchlistEntry(entry.match_id, updateFields);
      enriched++;
      console.log(`[enrichWatchlistJob] Enriched ${entry.home_team} vs ${entry.away_team}`);
    } catch (err) {
      console.error(`[enrichWatchlistJob] Error for match ${entry.match_id}:`, err);
      await persistRetryState(
        entry,
        'failed',
        attemptedAt,
        refreshWindow,
        null,
        err instanceof Error ? err.message : String(err),
        hints,
      );
    }

    await sleep(API_DELAY_MS);
  }

  console.log(`[enrichWatchlistJob] Checked ${checked}, enriched ${enriched}`);
  return { checked, enriched };
}
