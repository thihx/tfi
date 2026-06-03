import { query } from '../db/pool.js';
import type { ApiFixture, ApiFixtureStat } from './football-api.js';
import type { ReplayPerformanceMemorySnapshot, ReplayScenario } from './pipeline-replay.js';
import type { ResolveMatchOddsResult } from './odds-resolver.js';
import { buildOddsCanonical } from './server-pipeline.js';
import { parseStoredSettlementStats, type SettlementStatRow } from './settlement-stat-cache.js';
import { normalizeMarket } from './normalize-market.js';
import {
  buildPerformanceMemoryKey,
  deriveMinuteBand,
  deriveScoreState,
  type PerformanceMemoryRecord,
  type PerformanceMinuteBand,
  type PerformanceScoreState,
} from '../repos/ai-performance.repo.js';

type JsonObject = Record<string, unknown>;

interface CompactPair {
  home?: string | number | null;
  away?: string | number | null;
}

export interface CompactStatsSnapshot {
  possession?: CompactPair;
  shots?: CompactPair;
  shots_on_target?: CompactPair;
  corners?: CompactPair;
  fouls?: CompactPair;
  offsides?: CompactPair;
  yellow_cards?: CompactPair;
  red_cards?: CompactPair;
  goalkeeper_saves?: CompactPair;
  blocked_shots?: CompactPair;
  total_passes?: CompactPair;
  passes_accurate?: CompactPair;
  shots_off_target?: CompactPair;
  shots_inside_box?: CompactPair;
  shots_outside_box?: CompactPair;
  expected_goals?: CompactPair;
  goals_prevented?: CompactPair;
  passes_percent?: CompactPair;
}

export interface SettledReplayScenarioMetadata {
  recommendationId: number;
  originalPromptVersion: string;
  originalAiModel: string;
  originalBetMarket: string;
  originalSelection: string;
  originalResult: string;
  originalPnl: number;
  minute: number | null;
  score: string;
  status: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  evidenceMode: string;
  prematchStrength: string;
  profileCoverageBand: string;
  overlayCoverageBand: string;
  policyImpactBand: string;
  performanceMemoryKey: string;
  performanceMemoryStatus: 'found' | 'no_history' | 'missing';
}

export interface SettledReplayScenarioSettlementContext {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  finalStatus: string;
  homeScore: number;
  awayScore: number;
  regularHomeScore: number;
  regularAwayScore: number;
  settlementStats: SettlementStatRow[];
}

export interface SettledReplayScenario extends ReplayScenario {
  metadata: SettledReplayScenarioMetadata;
  settlementContext: SettledReplayScenarioSettlementContext;
}

export interface SettledReplayScenarioFilters {
  limit?: number;
  lookbackDays?: number;
  promptVersion?: string;
  marketFamily?: 'all' | 'goals_totals' | 'goals_under' | 'goals_over' | 'first_half';
  recommendationIds?: number[];
  matchIds?: string[];
}

interface SettledReplaySourceRow {
  recommendation_id: number;
  match_id: string;
  timestamp: string;
  league: string;
  home_team: string;
  away_team: string;
  status: string;
  minute: number | null;
  score: string;
  selection: string;
  bet_market: string;
  odds: number | null;
  confidence: number | null;
  stake_percent: number | null;
  reasoning: string;
  reasoning_vi: string;
  ai_model: string;
  mode: string;
  result: string;
  pnl: number;
  prompt_version: string;
  odds_snapshot: JsonObject | string;
  stats_snapshot: JsonObject | string;
  decision_context: JsonObject | string;
  league_id: number | null;
  league_name: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  kickoff_at_utc: string | null;
  date: string | null;
  kickoff: string | null;
  venue: string | null;
  final_status: string | null;
  home_score: number | null;
  away_score: number | null;
  regular_home_score: number | null;
  regular_away_score: number | null;
  halftime_home: number | null;
  halftime_away: number | null;
  settlement_stats: unknown;
}

interface PreviousRecommendationSeed {
  id: number;
  match_id: string;
  timestamp: string;
  minute: number | null;
  odds: number | null;
  bet_market: string;
  selection: string;
  score: string;
  status: string;
  result: string;
  confidence: number | null;
  stake_percent: number | null;
  reasoning: string;
}

type PerformanceMemoryRow = {
  key: string;
  canonical_market: string;
  minute_band: string;
  score_state: string;
  total: string;
  wins: string;
  losses: string;
  half_wins: string;
  half_losses: string;
  pushes: string;
  empirical_win_rate: string;
  sample_reliable: boolean;
  last_updated: string;
};

const STATS_SNAPSHOT_TO_API_TYPES: Array<[keyof CompactStatsSnapshot, string]> = [
  ['possession', 'Ball Possession'],
  ['shots', 'Total Shots'],
  ['shots_on_target', 'Shots on Goal'],
  ['corners', 'Corner Kicks'],
  ['fouls', 'Fouls'],
  ['offsides', 'Offsides'],
  ['yellow_cards', 'Yellow Cards'],
  ['red_cards', 'Red Cards'],
  ['goalkeeper_saves', 'Goalkeeper Saves'],
  ['blocked_shots', 'Blocked Shots'],
  ['total_passes', 'Total passes'],
  ['passes_accurate', 'Passes accurate'],
  ['shots_off_target', 'Shots off Goal'],
  ['shots_inside_box', 'Shots insidebox'],
  ['shots_outside_box', 'Shots outsidebox'],
  ['expected_goals', 'expected_goals'],
  ['goals_prevented', 'goals_prevented'],
  ['passes_percent', 'Passes %'],
];

function parseJsonObject(input: JsonObject | string | null | undefined): JsonObject {
  if (!input) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as JsonObject
        : {};
    } catch {
      return {};
    }
  }
  return input;
}

const HT_CANONICAL_MERGE_KEYS = [
  'ht_1x2',
  'ht_ou',
  'ht_ou_adjacent',
  'ht_ah',
  'ht_ah_adjacent',
  'ht_btts',
] as const;

/**
 * Fills missing H1 canonical keys from `provider_odds_cache.response` for the same match.
 * Odds may reflect a later refresh than the original recommendation minute; use for replay
 * coverage / audits when historical `odds_snapshot` omitted half-time ladders.
 */
export function mergeHtMarketsIntoSnapshot(
  snapshot: JsonObject | string,
  providerOddsResponse: unknown[] | null | undefined,
): JsonObject {
  const base = { ...parseJsonObject(snapshot) };
  if (!providerOddsResponse || !Array.isArray(providerOddsResponse) || providerOddsResponse.length === 0) {
    return base;
  }
  const { canonical } = buildOddsCanonical(providerOddsResponse);
  for (const key of HT_CANONICAL_MERGE_KEYS) {
    const incoming = canonical[key as keyof typeof canonical];
    if (incoming == null) continue;
    if (base[key] != null) continue;
    base[key] = incoming as JsonObject[string];
  }
  return base;
}

async function loadProviderOddsCacheByMatchIds(matchIds: string[]): Promise<Map<string, unknown[]>> {
  const unique = [...new Set(matchIds.filter((id) => id.length > 0))];
  if (unique.length === 0) return new Map();
  const result = await query<{ match_id: string; response: unknown }>(
    `SELECT match_id, response FROM provider_odds_cache WHERE match_id = ANY($1::text[])`,
    [unique],
  );
  const map = new Map<string, unknown[]>();
  for (const row of result.rows) {
    const r = row.response;
    map.set(row.match_id, Array.isArray(r) ? (r as unknown[]) : []);
  }
  return map;
}

function coerceStatValue(value: string | number | null | undefined): string | number | null {
  if (value == null || value === '') return null;
  return value;
}

function parseScore(score: string): { home: number; away: number } {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return { home: 0, away: 0 };
  return {
    home: Number(match[1] ?? 0),
    away: Number(match[2] ?? 0),
  };
}

function toTimestampSeconds(iso: string | null | undefined): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 0;
  return Math.floor(parsed / 1000);
}

function toFixtureId(matchId: string): number {
  const parsed = Number.parseInt(matchId, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactStatsFromUnknown(value: JsonObject | string): CompactStatsSnapshot {
  return parseJsonObject(value) as CompactStatsSnapshot;
}

function compactDecisionContext(value: JsonObject | string): JsonObject {
  return parseJsonObject(value);
}

function buildScenarioName(row: SettledReplaySourceRow): string {
  const minute = row.minute != null ? `${row.minute}m` : 'nominute';
  const market = String(row.bet_market || 'unknown').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `${row.recommendation_id}-${row.match_id}-${minute}-${market || 'unknown'}`;
}

function toPerformanceMemoryRecord(row: PerformanceMemoryRow): PerformanceMemoryRecord {
  return {
    key: row.key,
    canonicalMarket: row.canonical_market,
    minuteBand: row.minute_band as PerformanceMinuteBand,
    scoreState: row.score_state as PerformanceScoreState,
    total: Number(row.total),
    wins: Number(row.wins),
    losses: Number(row.losses),
    halfWins: Number(row.half_wins),
    halfLosses: Number(row.half_losses),
    pushes: Number(row.pushes),
    empiricalWinRate: Number(row.empirical_win_rate),
    sampleReliable: Boolean(row.sample_reliable),
    lastUpdated: row.last_updated,
  };
}

function buildReplayPerformanceMemoryReference(row: SettledReplaySourceRow): {
  key: string;
  canonicalMarket: string;
  minuteBand: PerformanceMinuteBand;
  scoreState: PerformanceScoreState;
} {
  const canonicalMarket = normalizeMarket(row.selection || '', row.bet_market || '');
  const minuteBand = deriveMinuteBand(row.minute);
  const scoreState = deriveScoreState(row.score);
  return {
    key: buildPerformanceMemoryKey(canonicalMarket || 'unknown', minuteBand, scoreState),
    canonicalMarket: canonicalMarket || 'unknown',
    minuteBand,
    scoreState,
  };
}

function buildNoHistoryPerformanceMemorySnapshot(row: SettledReplaySourceRow): ReplayPerformanceMemorySnapshot {
  const ref = buildReplayPerformanceMemoryReference(row);
  return {
    ...ref,
    lookupResult: { status: 'no_history' },
    source: 'db',
  };
}

function buildFoundPerformanceMemorySnapshot(row: SettledReplaySourceRow, record: PerformanceMemoryRecord): ReplayPerformanceMemorySnapshot {
  const ref = buildReplayPerformanceMemoryReference(row);
  return {
    ...ref,
    key: record.key || ref.key,
    canonicalMarket: record.canonicalMarket || ref.canonicalMarket,
    minuteBand: record.minuteBand || ref.minuteBand,
    scoreState: record.scoreState || ref.scoreState,
    lookupResult: { status: 'found', record },
    source: 'db',
  };
}

function buildFixtureFromRow(row: SettledReplaySourceRow): ApiFixture {
  const kickoffIso = row.kickoff_at_utc || row.timestamp;
  const score = parseScore(row.score);
  return {
    fixture: {
      id: toFixtureId(row.match_id),
      referee: null,
      timezone: 'UTC',
      date: kickoffIso,
      timestamp: toTimestampSeconds(kickoffIso),
      periods: { first: null, second: null },
      venue: { id: null, name: row.venue || null, city: null },
      status: {
        long: row.status || '',
        short: row.status || '',
        elapsed: row.minute,
      },
    },
    league: {
      id: row.league_id ?? 0,
      name: row.league_name || row.league || '',
      country: '',
      logo: '',
      flag: null,
      season: 0,
      round: '',
    },
    teams: {
      home: {
        id: row.home_team_id ?? 0,
        name: row.home_team,
        logo: '',
        winner: null,
      },
      away: {
        id: row.away_team_id ?? 0,
        name: row.away_team,
        logo: '',
        winner: null,
      },
    },
    goals: {
      home: score.home,
      away: score.away,
    },
    score: {
      halftime: {
        home: row.halftime_home != null ? Number(row.halftime_home) : null,
        away: row.halftime_away != null ? Number(row.halftime_away) : null,
      },
      fulltime: { home: score.home, away: score.away },
    },
  };
}

export function compactStatsToApiFixtureStats(
  statsSnapshot: CompactStatsSnapshot,
  homeName: string,
  awayName: string,
): ApiFixtureStat[] {
  const homeStats: Array<{ type: string; value: string | number | null }> = [];
  const awayStats: Array<{ type: string; value: string | number | null }> = [];

  for (const [snapshotKey, apiName] of STATS_SNAPSHOT_TO_API_TYPES) {
    const pair = statsSnapshot[snapshotKey];
    if (!pair) continue;
    homeStats.push({ type: apiName, value: coerceStatValue(pair.home) });
    awayStats.push({ type: apiName, value: coerceStatValue(pair.away) });
  }

  return [
    {
      team: { id: 0, name: homeName, logo: '' },
      statistics: homeStats,
    },
    {
      team: { id: 0, name: awayName, logo: '' },
      statistics: awayStats,
    },
  ];
}

export function canonicalOddsToRecordedResponse(snapshot: JsonObject | string): unknown[] {
  const canonical = parseJsonObject(snapshot);
  const bets: Array<{ id: number; name: string; values: Array<{ value: string; odd: string; handicap?: string }> }> = [];
  let nextId = 1;

  const collectOuValues = (keys: string[]): Array<{ value: string; odd: string; handicap: string }> => {
    const values: Array<{ value: string; odd: string; handicap: string }> = [];
    const seen = new Set<string>();
    for (const key of keys) {
      const entry = canonical[key];
      const rows = Array.isArray(entry) ? entry : entry && typeof entry === 'object' ? [entry] : [];
      for (const rawRow of rows) {
        if (!rawRow || typeof rawRow !== 'object') continue;
        const row = rawRow as Record<string, unknown>;
        const line = Number(row.line);
        if (!Number.isFinite(line)) continue;
        for (const [value, odd] of [['Over', row.over], ['Under', row.under]] as const) {
          if (!(Number(odd) > 1)) continue;
          const dedupKey = `${value}:${line}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          values.push({ value, odd: String(odd), handicap: String(line) });
        }
      }
    }
    return values;
  };

  const collectAhValues = (keys: string[]): Array<{ value: string; odd: string; handicap: string }> => {
    const values: Array<{ value: string; odd: string; handicap: string }> = [];
    const seen = new Set<string>();
    for (const key of keys) {
      const entry = canonical[key];
      const rows = Array.isArray(entry) ? entry : entry && typeof entry === 'object' ? [entry] : [];
      for (const rawRow of rows) {
        if (!rawRow || typeof rawRow !== 'object') continue;
        const row = rawRow as Record<string, unknown>;
        const homeLine = Number(row.line);
        if (!Number.isFinite(homeLine)) continue;
        const awayLine = -homeLine;
        const sides = [
          { value: 'Home', odd: row.home, handicap: formatSignedHandicap(homeLine) },
          { value: 'Away', odd: row.away, handicap: formatSignedHandicap(awayLine) },
        ];
        for (const side of sides) {
          if (!(Number(side.odd) > 1)) continue;
          const dedupKey = `${side.value}:${side.handicap}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          values.push({ value: side.value, odd: String(side.odd), handicap: side.handicap });
        }
      }
    }
    return values;
  };

  const oneX2 = canonical['1x2'];
  if (oneX2 && typeof oneX2 === 'object') {
    const row = oneX2 as Record<string, unknown>;
    const values = [
      { value: 'Home', odd: row.home },
      { value: 'Draw', odd: row.draw },
      { value: 'Away', odd: row.away },
    ]
      .filter((entry) => Number(entry.odd) > 1)
      .map((entry) => ({ value: entry.value, odd: String(entry.odd) }));
    if (values.length > 0) bets.push({ id: nextId++, name: 'Match Winner', values });
  }

  const totalValues = collectOuValues(['ou', 'ou_adjacent', 'ou_extra']);
  if (totalValues.length > 0) bets.push({ id: nextId++, name: 'Over/Under', values: totalValues });

  const cornersTotals = canonical.corners_ou;
  if (cornersTotals && typeof cornersTotals === 'object') {
    const row = cornersTotals as Record<string, unknown>;
    const line = Number(row.line);
    const values = [
      { value: 'Over', odd: row.over, handicap: String(line) },
      { value: 'Under', odd: row.under, handicap: String(line) },
    ]
      .filter((entry) => Number(entry.odd) > 1 && Number.isFinite(line))
      .map((entry) => ({ value: entry.value, odd: String(entry.odd), handicap: entry.handicap }));
    if (values.length > 0) bets.push({ id: nextId++, name: 'Corners Over/Under', values });
  }

  const btts = canonical.btts;
  if (btts && typeof btts === 'object') {
    const row = btts as Record<string, unknown>;
    const values = [
      { value: 'Yes', odd: row.yes },
      { value: 'No', odd: row.no },
    ]
      .filter((entry) => Number(entry.odd) > 1)
      .map((entry) => ({ value: entry.value, odd: String(entry.odd) }));
    if (values.length > 0) bets.push({ id: nextId++, name: 'Both Teams Score', values });
  }

  const ahValues = collectAhValues(['ah', 'ah_adjacent', 'ah_extra']);
  if (ahValues.length > 0) bets.push({ id: nextId++, name: 'Asian Handicap', values: ahValues });

  const ht1x2 = canonical['ht_1x2'];
  if (ht1x2 && typeof ht1x2 === 'object') {
    const row = ht1x2 as Record<string, unknown>;
    const values = [
      { value: 'Home', odd: row.home },
      { value: 'Draw', odd: row.draw },
      { value: 'Away', odd: row.away },
    ]
      .filter((entry) => Number(entry.odd) > 1)
      .map((entry) => ({ value: entry.value, odd: String(entry.odd) }));
    if (values.length > 0) bets.push({ id: nextId++, name: '1st Half Match Winner', values });
  }

  const htOuValues = collectOuValues(['ht_ou', 'ht_ou_adjacent', 'ht_ou_extra']);
  if (htOuValues.length > 0) bets.push({ id: nextId++, name: 'Over/Under First Half', values: htOuValues });

  const htBtts = canonical['ht_btts'];
  if (htBtts && typeof htBtts === 'object') {
    const row = htBtts as Record<string, unknown>;
    const values = [
      { value: 'Yes', odd: row.yes },
      { value: 'No', odd: row.no },
    ]
      .filter((entry) => Number(entry.odd) > 1)
      .map((entry) => ({ value: entry.value, odd: String(entry.odd) }));
    if (values.length > 0) {
      bets.push({ id: nextId++, name: 'Both Teams Score - First Half', values });
    }
  }

  const htAhValues = collectAhValues(['ht_ah', 'ht_ah_adjacent', 'ht_ah_extra']);
  if (htAhValues.length > 0) {
    bets.push({ id: nextId++, name: 'Asian Handicap First Half', values: htAhValues });
  }

  if (bets.length === 0) return [];

  return [{
    bookmakers: [{
      id: 0,
      name: 'Replay Mock',
      bets,
    }],
  }];
}

function formatSignedHandicap(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Object.is(value, -0)) value = 0;
  const abs = Math.abs(value);
  const formatted = Number.isInteger(abs) ? String(abs) : String(abs).replace(/\.?0+$/, '');
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '-'}${formatted}`;
}

export function buildMockResolvedOdds(snapshot: JsonObject | string): ResolveMatchOddsResult {
  return {
    oddsSource: 'live',
    response: canonicalOddsToRecordedResponse(snapshot),
    oddsFetchedAt: null,
    freshness: 'fresh',
    cacheStatus: 'hit',
  };
}

function buildReplayMockAiText(row: SettledReplaySourceRow): string {
  const confidence = Number(row.confidence);
  const stakePercent = Number(row.stake_percent);
  const valuePercent = Number((parseJsonObject(row.decision_context)['valuePercent'] as number | string | undefined) ?? 8);
  return JSON.stringify({
    should_push: true,
    ai_should_push: true,
    selection: row.selection || '',
    bet_market: row.bet_market || '',
    confidence: Number.isFinite(confidence) && confidence > 0 ? confidence : 7,
    reasoning_en: row.reasoning || 'Replay mock preserves the original recommendation.',
    reasoning_vi: row.reasoning_vi || row.reasoning || 'Replay mock preserves the original recommendation.',
    warnings: [],
    value_percent: Number.isFinite(valuePercent) ? valuePercent : 8,
    risk_level: 'MEDIUM',
    stake_percent: Number.isFinite(stakePercent) && stakePercent > 0 ? stakePercent : 2,
    condition_triggered_suggestion: '',
    custom_condition_matched: false,
  });
}

export function buildSettledReplayScenario(
  row: SettledReplaySourceRow,
  previousRecommendations: ReplayScenario['previousRecommendations'] = [],
  performanceMemorySnapshot: ReplayPerformanceMemorySnapshot | null = buildNoHistoryPerformanceMemorySnapshot(row),
): SettledReplayScenario {
  const statsSnapshot = compactStatsFromUnknown(row.stats_snapshot);
  const decisionContext = compactDecisionContext(row.decision_context);
  const settlementHomeScore = row.regular_home_score ?? row.home_score ?? 0;
  const settlementAwayScore = row.regular_away_score ?? row.away_score ?? 0;
  const mockResolvedOdds = buildMockResolvedOdds(row.odds_snapshot);

  return {
    name: buildScenarioName(row),
    matchId: row.match_id,
    fixture: buildFixtureFromRow(row),
    watchlistEntry: {
      match_id: row.match_id,
      league: row.league,
      home_team: row.home_team,
      away_team: row.away_team,
      custom_conditions: '',
      date: row.date,
      kickoff: row.kickoff,
      strategic_context: null,
    },
    pipelineOptions: {
      forceAnalyze: true,
      skipProceedGate: true,
      skipStalenessGate: true,
      promptVersionOverride: undefined,
    },
    statistics: compactStatsToApiFixtureStats(statsSnapshot, row.home_team, row.away_team),
    mockResolvedOdds,
    liveOddsResponse: mockResolvedOdds.response,
    mockAiText: buildReplayMockAiText(row),
    previousRecommendations,
    performanceMemorySnapshot,
    metadata: {
      recommendationId: row.recommendation_id,
      originalPromptVersion: row.prompt_version || '',
      originalAiModel: row.ai_model || '',
      originalBetMarket: row.bet_market || '',
      originalSelection: row.selection || '',
      originalResult: row.result || '',
      originalPnl: Number(row.pnl ?? 0),
      minute: row.minute,
      score: row.score || '',
      status: row.status || '',
      league: row.league || '',
      homeTeam: row.home_team || '',
      awayTeam: row.away_team || '',
      evidenceMode: String(decisionContext['evidenceMode'] ?? ''),
      prematchStrength: String(decisionContext['prematchStrength'] ?? ''),
      profileCoverageBand: String(decisionContext['profileCoverageBand'] ?? ''),
      overlayCoverageBand: String(decisionContext['overlayCoverageBand'] ?? ''),
      policyImpactBand: String(decisionContext['policyImpactBand'] ?? ''),
      performanceMemoryKey: performanceMemorySnapshot?.key ?? '',
      performanceMemoryStatus: performanceMemorySnapshot?.lookupResult.status ?? 'missing',
    },
    settlementContext: {
      matchId: row.match_id,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      finalStatus: row.final_status || 'FT',
      homeScore: row.home_score ?? settlementHomeScore,
      awayScore: row.away_score ?? settlementAwayScore,
      regularHomeScore: settlementHomeScore,
      regularAwayScore: settlementAwayScore,
      settlementStats: parseStoredSettlementStats(row.settlement_stats),
    },
  };
}

async function loadPerformanceMemoryByKey(keys: string[]): Promise<Map<string, PerformanceMemoryRecord>> {
  const unique = [...new Set(keys.filter((key) => key.length > 0))];
  if (unique.length === 0) return new Map();

  const tableCheck = await query<{ table_name: string | null }>(
    `SELECT to_regclass('public.recommendation_performance_memory')::text AS table_name`,
  );
  if (!tableCheck.rows[0]?.table_name) return new Map();

  const result = await query<PerformanceMemoryRow>(
    `SELECT key, canonical_market, minute_band, score_state, total, wins, losses,
            half_wins, half_losses, pushes, empirical_win_rate, sample_reliable, last_updated
       FROM recommendation_performance_memory
      WHERE key = ANY($1::text[])`,
    [unique],
  );

  const map = new Map<string, PerformanceMemoryRecord>();
  for (const row of result.rows) {
    map.set(row.key, toPerformanceMemoryRecord(row));
  }
  return map;
}

function marketFamilyWhereClause(filter: SettledReplayScenarioFilters['marketFamily']): string {
  switch (filter) {
    case 'first_half':
      return `AND COALESCE(NULLIF(r.bet_market, ''), '') LIKE 'ht\\_%' ESCAPE '\\'`;
    case 'goals_totals':
      return `AND (
        (COALESCE(NULLIF(r.bet_market, ''), '') LIKE 'under\\_%' ESCAPE '\\' OR COALESCE(NULLIF(r.bet_market, ''), '') LIKE 'over\\_%' ESCAPE '\\')
        AND COALESCE(NULLIF(r.bet_market, ''), '') NOT LIKE 'corners\\_%' ESCAPE '\\'
      )`;
    case 'goals_under':
      return `AND COALESCE(NULLIF(r.bet_market, ''), '') LIKE 'under\\_%' ESCAPE '\\'
              AND COALESCE(NULLIF(r.bet_market, ''), '') NOT LIKE 'corners\\_%' ESCAPE '\\'`;
    case 'goals_over':
      return `AND COALESCE(NULLIF(r.bet_market, ''), '') LIKE 'over\\_%' ESCAPE '\\'
              AND COALESCE(NULLIF(r.bet_market, ''), '') NOT LIKE 'corners\\_%' ESCAPE '\\'`;
    default:
      return '';
  }
}

async function loadSettledReplaySourceRows(filters: SettledReplayScenarioFilters): Promise<SettledReplaySourceRow[]> {
  const params: unknown[] = [];
  let paramIdx = 1;
  const conditions: string[] = [
    `r.bet_type IS DISTINCT FROM 'NO_BET'`,
    `r.result IS DISTINCT FROM 'duplicate'`,
    `r.result IN ('win','loss','push','half_win','half_loss','void')`,
    `COALESCE(r.odds_snapshot, '{}'::jsonb) <> '{}'::jsonb`,
    `COALESCE(r.stats_snapshot, '{}'::jsonb) <> '{}'::jsonb`,
    `mh.match_id IS NOT NULL`,
  ];

  const lookbackDays = filters.lookbackDays ?? 14;
  if (lookbackDays > 0) {
    conditions.push(`r.timestamp >= NOW() - INTERVAL '1 day' * $${paramIdx}`);
    params.push(lookbackDays);
    paramIdx++;
  }

  if (filters.promptVersion) {
    conditions.push(`r.prompt_version = $${paramIdx}`);
    params.push(filters.promptVersion);
    paramIdx++;
  }

  if (filters.recommendationIds && filters.recommendationIds.length > 0) {
    conditions.push(`r.id = ANY($${paramIdx}::bigint[])`);
    params.push(filters.recommendationIds);
    paramIdx++;
  }

  if (filters.matchIds && filters.matchIds.length > 0) {
    conditions.push(`r.match_id = ANY($${paramIdx}::text[])`);
    params.push(filters.matchIds);
    paramIdx++;
  }

  const marketFilterSql = marketFamilyWhereClause(filters.marketFamily ?? 'all');
  const limit = Math.max(1, Math.min(filters.limit ?? 200, 1000));
  params.push(limit);
  const limitParam = `$${params.length}`;

  const result = await query<SettledReplaySourceRow>(
    `SELECT
       r.id AS recommendation_id,
       r.match_id,
       r.timestamp,
       r.league,
       r.home_team,
       r.away_team,
       r.status,
       r.minute,
       r.score,
       r.selection,
       r.bet_market,
       r.odds,
       r.confidence,
       r.stake_percent,
       r.reasoning,
       r.reasoning_vi,
       r.ai_model,
       r.mode,
       r.result,
       r.pnl,
       r.prompt_version,
       r.odds_snapshot,
       r.stats_snapshot,
       r.decision_context,
       mh.league_id,
       mh.league_name,
       mh.home_team_id,
       mh.away_team_id,
       mh.kickoff_at_utc,
       mh.date,
       mh.kickoff,
       mh.venue,
       mh.final_status,
       mh.home_score,
       mh.away_score,
       mh.regular_home_score,
       mh.regular_away_score,
       mh.halftime_home,
       mh.halftime_away,
       mh.settlement_stats
     FROM recommendations r
     LEFT JOIN matches_history mh ON mh.match_id = r.match_id
     WHERE ${conditions.join('\n       AND ')}
       ${marketFilterSql}
     ORDER BY r.timestamp DESC, r.id DESC
     LIMIT ${limitParam}`,
    params,
  );

  return result.rows;
}

async function loadPreviousRecommendationsMap(matchIds: string[]): Promise<Map<string, PreviousRecommendationSeed[]>> {
  if (matchIds.length === 0) return new Map();
  const result = await query<PreviousRecommendationSeed>(
    `SELECT
       id,
       match_id,
       timestamp,
       minute,
       odds,
       bet_market,
       selection,
       score,
       status,
       result,
       confidence,
       stake_percent,
       reasoning
     FROM recommendations
     WHERE match_id = ANY($1::text[])
       AND bet_type IS DISTINCT FROM 'NO_BET'
       AND result IS DISTINCT FROM 'duplicate'
     ORDER BY match_id ASC, timestamp DESC, id DESC`,
    [matchIds],
  );

  const map = new Map<string, PreviousRecommendationSeed[]>();
  for (const row of result.rows) {
    const rows = map.get(row.match_id) ?? [];
    rows.push(row);
    map.set(row.match_id, rows);
  }
  return map;
}

function buildPreviousRecommendationsForRow(
  row: SettledReplaySourceRow,
  previousMap: Map<string, PreviousRecommendationSeed[]>,
): ReplayScenario['previousRecommendations'] {
  const rows = previousMap.get(row.match_id) ?? [];
  const currentTime = Date.parse(row.timestamp);
  return rows
    .filter((candidate) => {
      if (candidate.id === row.recommendation_id) return false;
      const candidateTime = Date.parse(candidate.timestamp);
      if (Number.isNaN(candidateTime) || Number.isNaN(currentTime)) {
        return candidate.id < row.recommendation_id;
      }
      return candidateTime < currentTime || (candidateTime === currentTime && candidate.id < row.recommendation_id);
    })
    .slice(0, 10)
    .map((candidate) => ({
      minute: candidate.minute ?? null,
      odds: candidate.odds ?? null,
      bet_market: candidate.bet_market ?? '',
      selection: candidate.selection ?? '',
      score: candidate.score ?? '',
      status: candidate.status ?? '',
      result: candidate.result ?? '',
      confidence: candidate.confidence ?? null,
      stake_percent: candidate.stake_percent ?? null,
      reasoning: candidate.reasoning ?? '',
    }));
}

export async function buildSettledReplayScenarios(
  filters: SettledReplayScenarioFilters = {},
): Promise<SettledReplayScenario[]> {
  const baseRows = await loadSettledReplaySourceRows(filters);
  const matchIds = [...new Set(baseRows.map((row) => row.match_id))];
  const previousMap = await loadPreviousRecommendationsMap(matchIds);
  const oddsCacheByMatch = await loadProviderOddsCacheByMatchIds(matchIds);
  const memoryByKey = await loadPerformanceMemoryByKey(
    baseRows.map((row) => buildReplayPerformanceMemoryReference(row).key),
  );
  return baseRows.map((row) => {
    const cacheResp = oddsCacheByMatch.get(row.match_id);
    const mergedSnapshot = mergeHtMarketsIntoSnapshot(row.odds_snapshot, cacheResp);
    const enrichedRow: SettledReplaySourceRow = { ...row, odds_snapshot: mergedSnapshot };
    const memoryRef = buildReplayPerformanceMemoryReference(row);
    const memoryRecord = memoryByKey.get(memoryRef.key);
    const memorySnapshot = memoryRecord
      ? buildFoundPerformanceMemorySnapshot(row, memoryRecord)
      : buildNoHistoryPerformanceMemorySnapshot(row);
    return buildSettledReplayScenario(
      enrichedRow,
      buildPreviousRecommendationsForRow(row, previousMap),
      memorySnapshot,
    );
  });
}
