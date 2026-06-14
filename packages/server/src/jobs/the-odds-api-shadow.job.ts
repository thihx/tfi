import { config } from '../config.js';
import {
  buildCanonicalFixtureIdentity,
  buildCanonicalScoreClock,
  buildProviderEnvelope,
  type CanonicalFixtureIdentity,
  type CanonicalScoreClock,
  type ProviderEnvelope,
  type ProviderMappingConfidence,
} from '../lib/canonical/provider-domain.js';
import {
  buildTheOddsApiErrorEnvelope,
  buildTheOddsApiOddsEnvelope,
  THE_ODDS_API_PROVIDER,
  type TheOddsApiEventLike,
} from '../lib/canonical/the-odds-api-adapter.js';
import {
  resolveProviderFixtureMapping,
  type ProviderFixtureMappingCandidate,
  type ProviderFixtureMappingSource,
} from '../lib/provider-fixture-mapping-service.js';
import {
  buildLiveProviderFusionSnapshot,
  compactFusionSnapshotForAudit,
  type ProviderFusionSourceEnvelopes,
} from '../lib/provider-fusion-snapshot.js';
import { recordProviderOddsSampleSafe } from '../lib/provider-sampling.js';
import {
  fetchTheOddsApiOdds,
  inferTheOddsApiQuotaState,
  type TheOddsApiCallResult,
  type TheOddsApiQuota,
} from '../lib/the-odds-api.js';
import * as favoriteTeamsRepo from '../repos/favorite-teams.repo.js';
import * as leaguesRepo from '../repos/leagues.repo.js';
import type { LeagueRow } from '../repos/leagues.repo.js';
import * as matchRepo from '../repos/matches.repo.js';
import type { MatchRow } from '../repos/matches.repo.js';
import { createProviderFixtureSample } from '../repos/provider-fixture-samples.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { reportJobProgress } from './job-progress.js';

const JOB = 'the-odds-api-shadow';
const PRIMARY_PROVIDER = 'api-football';
const MATCH_WINDOW_PAST_MINUTES = 4 * 60;
const DEFAULT_MATCH_WINDOW_HOURS = 24;

export interface TheOddsApiShadowMetrics {
  checked: number;
  selected: number;
  sampled: number;
  mapped: number;
  unmapped: number;
  errors: number;
  logicalCalls: number;
  quotaCost: number;
  quotaRemaining: number | null;
  quotaState: string;
  skipped: {
    disabled: number;
    noWatchlist: number;
    missingMatch: number;
    outsideFavoriteScope: number;
    outsideWindow: number;
    unsupportedStatus: number;
    callBudget: number;
  };
  limits: {
    maxMatchesPerRun: number;
    maxCallsPerRun: number;
    windowHours: number;
  };
}

export interface TheOddsApiShadowResult {
  checked: number;
  sampled: number;
  metrics: TheOddsApiShadowMetrics;
  skipped?: true;
  skipReason?: string;
}

interface SelectedMatch {
  match: MatchRow;
  league: LeagueRow | null;
  minsToKickoff: number | null;
}

interface BudgetedOddsResult {
  result: TheOddsApiCallResult<TheOddsApiEventLike>;
}

function positiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : fallback;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : fallback;
}

function kickoffIso(match: MatchRow): string | null {
  if (match.kickoff_at_utc) return match.kickoff_at_utc;
  if (!match.date || !match.kickoff) return null;
  const local = new Date(`${match.date}T${match.kickoff}`);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

function kickoffTimestamp(match: MatchRow): number | null {
  const iso = kickoffIso(match);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function periodForStatus(status: string): CanonicalScoreClock['period'] {
  const normalized = status.toUpperCase();
  if (['NS', 'TBD', 'PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(normalized)) return 'pre';
  if (normalized === '1H') return '1h';
  if (['HT', 'BT', 'INT'].includes(normalized)) return 'ht';
  if (normalized === '2H') return '2h';
  if (['ET', 'AET'].includes(normalized)) return 'et';
  if (['P', 'PEN'].includes(normalized)) return 'pen';
  if (normalized === 'FT') return 'ft';
  return 'unknown';
}

function matchMappingSource(match: MatchRow): ProviderFixtureMappingSource {
  return {
    matchId: match.match_id,
    kickoffAtUtc: kickoffIso(match),
    kickoffTimestamp: kickoffTimestamp(match),
    leagueId: match.league_id,
    leagueName: match.league_name,
    homeName: match.home_team,
    awayName: match.away_team,
  };
}

function theOddsEventCandidate(event: TheOddsApiEventLike): ProviderFixtureMappingCandidate {
  const kickoffMs = Date.parse(String(event.commence_time ?? ''));
  return {
    providerFixtureId: String(event.id ?? ''),
    kickoffAtUtc: String(event.commence_time ?? ''),
    kickoffTimestamp: Number.isFinite(kickoffMs) ? Math.floor(kickoffMs / 1000) : null,
    leagueId: String(event.sport_key ?? ''),
    leagueName: String(event.sport_title ?? ''),
    homeName: String(event.home_team ?? ''),
    awayName: String(event.away_team ?? ''),
  };
}

function windowForMatch(match: MatchRow): { from: string; to: string } {
  const kickoff = kickoffTimestamp(match);
  const baseMs = kickoff == null ? Date.now() : kickoff * 1000;
  return {
    from: new Date(baseMs - 6 * 60 * 60_000).toISOString(),
    to: new Date(baseMs + 6 * 60 * 60_000).toISOString(),
  };
}

function isFavoriteScoped(match: MatchRow, league: LeagueRow | null, favoriteTeamIds: Set<string>): boolean {
  const favoriteLeague = league?.top_league === true;
  const favoriteHome = match.home_team_id != null && favoriteTeamIds.has(String(match.home_team_id));
  const favoriteAway = match.away_team_id != null && favoriteTeamIds.has(String(match.away_team_id));
  return favoriteLeague || favoriteHome || favoriteAway;
}

function isWithinWindow(status: string, minsToKickoff: number | null, windowHours: number): boolean {
  if (config.liveStatuses.map((value) => value.toUpperCase()).includes(status)) return true;
  if (minsToKickoff == null) return false;
  return minsToKickoff >= -MATCH_WINDOW_PAST_MINUTES && minsToKickoff <= windowHours * 60;
}

function buildPrimaryProvider(match: MatchRow, fetchedAt: string): ProviderFusionSourceEnvelopes {
  const fixture = buildProviderEnvelope<CanonicalFixtureIdentity>({
    provider: PRIMARY_PROVIDER,
    role: 'fixture_identity',
    providerFixtureId: match.match_id,
    matchId: match.match_id,
    fetchedAt,
    raw: match,
    normalized: buildCanonicalFixtureIdentity({
      matchId: match.match_id,
      providerFixtureIds: { [PRIMARY_PROVIDER]: match.match_id },
      kickoffAtUtc: kickoffIso(match),
      league: {
        id: String(match.league_id),
        name: match.league_name,
        country: null,
        season: null,
        logo: null,
      },
      home: {
        id: match.home_team_id != null ? String(match.home_team_id) : null,
        name: match.home_team,
        logo: match.home_logo,
      },
      away: {
        id: match.away_team_id != null ? String(match.away_team_id) : null,
        name: match.away_team,
        logo: match.away_logo,
      },
      mappingConfidence: 'verified',
    }),
    coverage: { fetched: true, itemCount: 1 },
    freshness: 'fresh',
    quota: 'unknown',
  });

  const scoreClock = buildProviderEnvelope<CanonicalScoreClock>({
    provider: PRIMARY_PROVIDER,
    role: 'fixture_score',
    providerFixtureId: match.match_id,
    matchId: match.match_id,
    fetchedAt,
    raw: match,
    normalized: buildCanonicalScoreClock({
      status: match.status,
      minute: match.current_minute,
      period: periodForStatus(match.status),
      score: { home: match.home_score, away: match.away_score },
    }),
    coverage: { fetched: true, itemCount: 1 },
    freshness: 'fresh',
    quota: 'unknown',
  });

  return { fixture, scoreClock };
}

function buildTheOddsFixtureEnvelope(
  match: MatchRow,
  event: TheOddsApiEventLike,
  fetchedAt: string,
  confidence: ProviderMappingConfidence,
): ProviderEnvelope<CanonicalFixtureIdentity> {
  return buildProviderEnvelope<CanonicalFixtureIdentity>({
    provider: THE_ODDS_API_PROVIDER,
    role: 'fixture_identity',
    providerFixtureId: event.id,
    matchId: match.match_id,
    fetchedAt,
    raw: event,
    normalized: buildCanonicalFixtureIdentity({
      matchId: match.match_id,
      providerFixtureIds: { [THE_ODDS_API_PROVIDER]: String(event.id ?? '') },
      kickoffAtUtc: String(event.commence_time ?? ''),
      league: {
        id: String(event.sport_key ?? ''),
        name: String(event.sport_title ?? ''),
        country: null,
        season: null,
        logo: null,
      },
      home: { id: null, name: String(event.home_team ?? ''), logo: null },
      away: { id: null, name: String(event.away_team ?? ''), logo: null },
      mappingConfidence: confidence,
    }),
    coverage: { fetched: true, itemCount: 1 },
    freshness: 'fresh',
    quota: 'unknown',
  });
}

function createMetrics(): TheOddsApiShadowMetrics {
  return {
    checked: 0,
    selected: 0,
    sampled: 0,
    mapped: 0,
    unmapped: 0,
    errors: 0,
    logicalCalls: 0,
    quotaCost: 0,
    quotaRemaining: null,
    quotaState: 'unknown',
    skipped: {
      disabled: 0,
      noWatchlist: 0,
      missingMatch: 0,
      outsideFavoriteScope: 0,
      outsideWindow: 0,
      unsupportedStatus: 0,
      callBudget: 0,
    },
    limits: {
      maxMatchesPerRun: positiveInt(config.theOddsApiShadowMaxMatchesPerRun, 3),
      maxCallsPerRun: nonNegativeInt(config.theOddsApiShadowMaxCallsPerRun, 6),
      windowHours: positiveInt(config.theOddsApiShadowWindowHours, DEFAULT_MATCH_WINDOW_HOURS),
    },
  };
}

async function persistFixtureSample(input: {
  match: MatchRow;
  providerFixtureId: string;
  fixture: ProviderEnvelope<CanonicalFixtureIdentity>;
  fusionAudit: Record<string, unknown>;
  mapping: Record<string, unknown>;
}): Promise<void> {
  try {
    await createProviderFixtureSample({
      match_id: input.match.match_id,
      provider_fixture_id: input.providerFixtureId,
      provider: THE_ODDS_API_PROVIDER,
      consumer: JOB,
      success: input.fixture.success,
      latency_ms: input.fixture.latencyMs,
      status_code: input.fixture.statusCode,
      raw_payload: input.fixture.raw,
      normalized_payload: input.fixture.normalized,
      coverage_flags: {
        ...input.fixture.coverage,
        mapping: input.mapping,
        fusion: input.fusionAudit,
      },
    });
  } catch (err) {
    console.warn(
      `[${JOB}] fixture sample failed for ${input.match.match_id}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function quotaCost(quota: TheOddsApiQuota): number {
  return quota.requestsLast ?? 1;
}

async function theOddsApiShadowFetch(
  metrics: TheOddsApiShadowMetrics,
  input: Parameters<typeof fetchTheOddsApiOdds>[0],
): Promise<BudgetedOddsResult> {
  if (metrics.limits.maxCallsPerRun > 0 && metrics.logicalCalls >= metrics.limits.maxCallsPerRun) {
    metrics.skipped.callBudget++;
    throw new Error('the_odds_api_shadow_call_budget_exhausted');
  }
  metrics.logicalCalls++;
  const result = await fetchTheOddsApiOdds({
    ...input,
    consumer: JOB,
    jobName: JOB,
  });
  metrics.quotaCost += quotaCost(result.quota);
  metrics.quotaRemaining = result.quota.requestsRemaining;
  const quotaState = inferTheOddsApiQuotaState(result.quota, result.statusCode);
  metrics.quotaState = quotaState;
  return { result };
}

async function buildTheOddsProvider(
  match: MatchRow,
  metrics: TheOddsApiShadowMetrics,
): Promise<{
  provider: ProviderFusionSourceEnvelopes;
  mapping: Record<string, unknown>;
}> {
  const fetchedAt = new Date().toISOString();
  const win = windowForMatch(match);
  const lastFetch: { value: TheOddsApiCallResult<TheOddsApiEventLike> | null } = { value: null };
  const resolved = await resolveProviderFixtureMapping({
    provider: THE_ODDS_API_PROVIDER,
    source: matchMappingSource(match),
    candidateToFixture: theOddsEventCandidate,
    fetchFixtureByProviderId: async (providerFixtureId) => {
      const { result } = await theOddsApiShadowFetch(metrics, {
        sportKey: config.theOddsApiDefaultSoccerSportKey,
        regions: config.theOddsApiRegions,
        markets: config.theOddsApiMarkets,
        bookmakers: config.theOddsApiBookmakers,
        eventIds: [providerFixtureId],
        timeoutMs: config.theOddsApiTimeoutMs,
      });
      lastFetch.value = result;
      return result.data[0] ?? null;
    },
    fetchCandidatesByDate: async () => {
      const { result } = await theOddsApiShadowFetch(metrics, {
        sportKey: config.theOddsApiDefaultSoccerSportKey,
        regions: config.theOddsApiRegions,
        markets: config.theOddsApiMarkets,
        bookmakers: config.theOddsApiBookmakers,
        commenceTimeFrom: win.from,
        commenceTimeTo: win.to,
        timeoutMs: config.theOddsApiTimeoutMs,
      });
      lastFetch.value = result;
      return result.data;
    },
  });

  const mapping = {
    source: resolved.source,
    providerFixtureId: resolved.providerFixtureId,
    confidence: resolved.confidence,
    method: resolved.mappingMethod,
    score: resolved.score,
    canUseForMoneyDecision: resolved.canUseForMoneyDecision,
    reasons: resolved.reasons,
    warnings: resolved.warnings,
    evidence: resolved.evidence,
  };

  if (!resolved.fixture) {
    return {
      provider: {
        odds: buildTheOddsApiErrorEnvelope({
          matchId: match.match_id,
          fetchedAt,
          error: 'the_odds_api_mapping_not_found',
          warnings: resolved.warnings,
        }),
      },
      mapping,
    };
  }

  return {
    provider: {
      fixture: buildTheOddsFixtureEnvelope(match, resolved.fixture, fetchedAt, resolved.confidence),
      odds: buildTheOddsApiOddsEnvelope({
        matchId: match.match_id,
        event: resolved.fixture,
        fetchedAt,
        statusCode: lastFetch.value?.statusCode ?? 200,
        latencyMs: lastFetch.value?.latencyMs ?? null,
        quota: lastFetch.value ? inferTheOddsApiQuotaState(lastFetch.value.quota, lastFetch.value.statusCode) : 'unknown',
        raw: resolved.fixture,
        warnings: resolved.warnings,
      }),
    },
    mapping,
  };
}

function selectMatches(
  watchlist: watchlistRepo.WatchlistRow[],
  matches: MatchRow[],
  leagues: LeagueRow[],
  favoriteTeamIds: Set<string>,
  kickoffMinutes: Map<string, number | null>,
  metrics: TheOddsApiShadowMetrics,
): SelectedMatch[] {
  const matchMap = new Map(matches.map((match) => [match.match_id, match] as const));
  const leagueMap = new Map(leagues.map((league) => [league.league_id, league] as const));
  const liveStatuses = new Set(config.liveStatuses.map((value) => value.toUpperCase()));
  const selected: SelectedMatch[] = [];

  for (const watch of watchlist) {
    metrics.checked++;
    const match = matchMap.get(watch.match_id);
    if (!match) {
      metrics.skipped.missingMatch++;
      continue;
    }
    const status = match.status.toUpperCase();
    if (status !== 'NS' && !liveStatuses.has(status)) {
      metrics.skipped.unsupportedStatus++;
      continue;
    }
    const league = leagueMap.get(match.league_id) ?? null;
    if (!isFavoriteScoped(match, league, favoriteTeamIds)) {
      metrics.skipped.outsideFavoriteScope++;
      continue;
    }
    const minsToKickoff = kickoffMinutes.get(match.match_id) ?? null;
    if (!isWithinWindow(status, minsToKickoff, metrics.limits.windowHours)) {
      metrics.skipped.outsideWindow++;
      continue;
    }
    selected.push({ match, league, minsToKickoff });
  }

  return selected
    .sort((left, right) => {
      const leftTop = left.league?.top_league ? 1 : 0;
      const rightTop = right.league?.top_league ? 1 : 0;
      if (leftTop !== rightTop) return rightTop - leftTop;
      const leftMins = left.minsToKickoff ?? Number.POSITIVE_INFINITY;
      const rightMins = right.minsToKickoff ?? Number.POSITIVE_INFINITY;
      return leftMins - rightMins;
    })
    .slice(0, metrics.limits.maxMatchesPerRun);
}

export async function theOddsApiShadowJob(): Promise<TheOddsApiShadowResult> {
  const metrics = createMetrics();
  if (!config.theOddsApiEnabled || !config.theOddsApiToken) {
    metrics.skipped.disabled = 1;
    return {
      checked: 0,
      sampled: 0,
      metrics,
      skipped: true,
      skipReason: 'the_odds_api_disabled_or_token_missing',
    };
  }

  await reportJobProgress(JOB, 'load', 'Loading operational watchlist for The Odds API shadow...', 5);
  const watchlist = await watchlistRepo.getActiveOperationalWatchlist();
  if (watchlist.length === 0) {
    metrics.skipped.noWatchlist = 1;
    return { checked: 0, sampled: 0, metrics };
  }

  const [matches, leagues, favoriteTeamIds, kickoffMinutes] = await Promise.all([
    matchRepo.getAllMatches(),
    leaguesRepo.getAllLeagues().catch(() => []),
    favoriteTeamsRepo.getFavoriteTeamIds().catch(() => new Set<string>()),
    watchlistRepo.getKickoffMinutesForMatchIds(watchlist.map((row) => row.match_id), config.timezone),
  ]);

  const selected = selectMatches(watchlist, matches, leagues, favoriteTeamIds, kickoffMinutes, metrics);
  metrics.selected = selected.length;
  if (selected.length === 0) {
    return { checked: metrics.checked, sampled: 0, metrics };
  }

  let processed = 0;
  for (const row of selected) {
    if (metrics.limits.maxCallsPerRun > 0 && metrics.logicalCalls >= metrics.limits.maxCallsPerRun) {
      metrics.skipped.callBudget += selected.length - processed;
      break;
    }

    processed++;
    await reportJobProgress(
      JOB,
      'sample',
      `Sampling The Odds API ${processed}/${selected.length}: ${row.match.home_team} vs ${row.match.away_team}`,
      5 + Math.floor((processed / selected.length) * 85),
    );

    const generatedAt = new Date().toISOString();
    const apiFootballProvider = buildPrimaryProvider(row.match, generatedAt);
    let theOddsProvider: ProviderFusionSourceEnvelopes;
    let mapping: Record<string, unknown>;

    try {
      const built = await buildTheOddsProvider(row.match, metrics);
      theOddsProvider = built.provider;
      mapping = built.mapping;
    } catch (err) {
      metrics.errors++;
      const fetchedAt = new Date().toISOString();
      theOddsProvider = {
        odds: buildTheOddsApiErrorEnvelope({
          matchId: row.match.match_id,
          fetchedAt,
          error: err,
          warnings: ['the_odds_api_shadow_fetch_failed'],
        }),
      };
      mapping = {
        source: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const fusion = buildLiveProviderFusionSnapshot({
      matchId: row.match.match_id,
      generatedAt,
      providers: [apiFootballProvider, theOddsProvider],
      warnings: ['the_odds_api_shadow_sample'],
    });
    const fusionAudit = compactFusionSnapshotForAudit(fusion);
    const odds = theOddsProvider.odds;
    const oddsSnapshot = odds?.normalized ?? null;
    const isLiveUsable = Boolean(
      odds?.success
      && oddsSnapshot
      && oddsSnapshot.sourceKind === 'live'
      && oddsSnapshot.selections.length > 0
      && mapping['canUseForMoneyDecision'] === true,
    );

    if (theOddsProvider.fixture) {
      metrics.mapped++;
      await persistFixtureSample({
        match: row.match,
        providerFixtureId: theOddsProvider.fixture.providerFixtureId ?? '',
        fixture: theOddsProvider.fixture,
        fusionAudit,
        mapping,
      });
    } else {
      metrics.unmapped++;
    }

    await recordProviderOddsSampleSafe({
      match_id: row.match.match_id,
      match_minute: row.match.current_minute,
      match_status: row.match.status,
      provider: THE_ODDS_API_PROVIDER,
      source: 'scheduled-shadow',
      consumer: JOB,
      success: Boolean(odds?.success),
      usable: isLiveUsable,
      latency_ms: odds?.latencyMs ?? null,
      status_code: odds?.statusCode ?? null,
      error: odds?.error ?? '',
      raw_payload: odds?.raw ?? {},
      normalized_payload: oddsSnapshot ?? {},
      coverage_flags: {
        fetched: Boolean(odds?.success),
        itemCount: odds?.coverage.itemCount ?? 0,
        hasCanonicalOdds: Boolean(oddsSnapshot && oddsSnapshot.selections.length > 0),
        liveUsable: isLiveUsable,
        sourceKind: oddsSnapshot?.sourceKind ?? 'unknown',
        quotaState: metrics.quotaState,
        quotaRemaining: metrics.quotaRemaining,
        quotaCost: metrics.quotaCost,
        mapping,
        fusion: fusionAudit,
      },
    });

    metrics.sampled++;
  }

  return {
    checked: metrics.checked,
    sampled: metrics.sampled,
    metrics,
  };
}
