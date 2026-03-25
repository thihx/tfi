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
import * as matchRepo from '../repos/matches.repo.js';
import * as leaguesRepo from '../repos/leagues.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { getSettings } from '../repos/settings.repo.js';
import { reportJobProgress } from './job-progress.js';

const PREMATCH_WINDOW_HOURS = 2;
const PREMATCH_WINDOW_MINUTES = PREMATCH_WINDOW_HOURS * 60;
const API_DELAY_MS = 2000;
const FAILURE_BACKOFF_MINUTES = [60, 180, 360, 720] as const;
const POOR_BACKOFF_MINUTES = [360, 720, 1440] as const;
const TOP_LEAGUE_FAILURE_BACKOFF_MINUTES = [15, 30, 60, 120] as const;
const TOP_LEAGUE_POOR_BACKOFF_MINUTES = [30, 60, 120, 240] as const;

let forceNext = false;

type RefreshStatus = 'good' | 'poor' | 'failed';

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
}

type StoredStrategicContext = Partial<StrategicContext> & {
  _meta?: StrategicContextMeta;
};

/** Force next run to skip the stale-check and re-enrich all active entries. */
export function setForceEnrich(): void {
  forceNext = true;
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
    summary_vi: 'Khong tim thay du lieu',
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
        summary: 'Khong tim thay du lieu',
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
    },
  };
}

function buildSuccessfulContext(context: StrategicContext, attemptedAt: string): StoredStrategicContext {
  return {
    ...context,
    _meta: {
      refresh_status: 'good',
      failure_count: 0,
      last_attempt_at: attemptedAt,
      retry_after: null,
    },
  };
}

async function persistRetryState(
  entry: watchlistRepo.WatchlistRow,
  kind: 'poor' | 'failed',
  attemptedAt: string,
  seedContext: StoredStrategicContext | null = null,
  errorMessage = '',
  options: EnrichLeagueHints = {},
): Promise<void> {
  const existingContext = (entry.strategic_context as StoredStrategicContext | null) ?? null;
  const retryContext = buildRetryContext(existingContext, kind, attemptedAt, seedContext, errorMessage, options);
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

  const force = forceNext;
  forceNext = false;
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
    if (hasUsableContext(ctx, hints)) return false;

    const minsToKickoff = kickoffMinutesByMatchId.get(entry.match_id);
    if (minsToKickoff == null || minsToKickoff < 0 || minsToKickoff > PREMATCH_WINDOW_MINUTES) {
      return false;
    }

    const retryAfter = getRetryAfter(ctx);
    if (retryAfter && retryAfter > now && !hints.topLeague) return false;

    return true;
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

    try {
      const context = await fetchStrategicContext(
        entry.home_team,
        entry.away_team,
        entry.league,
        entry.date,
        hints,
      );

      if (!context) {
        await persistRetryState(entry, 'failed', attemptedAt, null, 'empty_response', hints);
        await sleep(API_DELAY_MS);
        continue;
      }

      const enrichedContext = hints.topLeague
        ? mergeStrategicContextWithPredictionFallback(context, {
            homeTeam: entry.home_team,
            awayTeam: entry.away_team,
            prediction: entry.prediction,
          })
        : context;

      if (!hasUsableContext(enrichedContext, hints)) {
        await persistRetryState(entry, 'poor', attemptedAt, enrichedContext, '', hints);
        await sleep(API_DELAY_MS);
        continue;
      }

      const updateFields: Partial<watchlistRepo.WatchlistRow> = {
        strategic_context: buildSuccessfulContext(enrichedContext, attemptedAt) as unknown,
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
