import { readFileSync } from 'node:fs';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from './football-api.js';
import { resolveMatchOdds, type ResolveMatchOddsResult } from './odds-resolver.js';
import { runPipelineForFixture, type MatchPipelineResult } from './server-pipeline.js';
import type { LiveAnalysisPromptVersion, PromptAnalysisMode, PromptEvidenceMode } from './live-analysis-prompt.js';
import type { WatchlistRow } from '../repos/watchlist.repo.js';
import type { RecommendationStudioRuntimeOverride } from './recommendation-studio-runtime.js';

const DEFAULT_MOCK_AI_TEXT = JSON.stringify({
  should_push: true,
  ai_should_push: true,
  selection: 'Over 2.5 Goals @1.85',
  bet_market: 'over_2.5',
  confidence: 8,
  reasoning_en: 'Replay mock output.',
  reasoning_vi: 'Replay mock output.',
  warnings: [],
  value_percent: 10,
  risk_level: 'MEDIUM',
  stake_percent: 3,
  condition_triggered_suggestion: '',
  custom_condition_matched: false,
});

export interface ReplayScenario {
  name: string;
  matchId: string;
  fixture: ApiFixture;
  watchlistEntry?: Partial<WatchlistRow>;
  pipelineOptions?: {
    forceAnalyze?: boolean;
    skipProceedGate?: boolean;
    skipStalenessGate?: boolean;
    modelOverride?: string;
    promptVersionOverride?: LiveAnalysisPromptVersion;
  };
  statistics?: ApiFixtureStat[];
  events?: ApiFixtureEvent[];
  liveOddsResponse?: unknown[];
  preMatchOddsResponse?: unknown[];
  mockAiText?: string;
  mockResolvedOdds?: ResolveMatchOddsResult;
  previousRecommendations?: Array<{
    minute: number | null;
    odds: number | null;
    bet_market: string;
    selection: string;
    score: string;
    result?: string;
    confidence?: number | null;
    stake_percent?: number | null;
    reasoning?: string;
  }> | null;
  previousSnapshot?: {
    minute: number;
    home_score: number;
    away_score: number;
    status?: string | null;
    odds: Record<string, unknown>;
    stats?: Record<string, unknown>;
  } | null;
  expected?: {
    shouldPush?: boolean;
    oddsSource?: string;
    statsSource?: string;
    analysisMode?: PromptAnalysisMode;
    evidenceMode?: PromptEvidenceMode;
    betMarket?: string;
    disallowedBetMarketPrefixes?: string[];
    selectionNotContains?: string;
    warningContains?: string;
    saved?: boolean;
    notified?: boolean;
    selectionContains?: string;
    skippedAt?: 'proceed' | 'staleness';
  };
}

export interface ReplayRunOptions {
  llmMode?: 'real' | 'mock';
  oddsMode?: 'recorded' | 'live' | 'mock';
  shadowMode?: boolean;
  sampleProviderData?: boolean;
  promptVersionOverride?: LiveAnalysisPromptVersion;
  capturedAiText?: string;
  advisoryOnly?: boolean;
  recommendationStudioOverride?: RecommendationStudioRuntimeOverride;
  /** Forward to pipeline: settled replay eval uses approved-trace prompt + skips post-parse policy block. */
  settledReplayApprovedTrace?: boolean;
  /** When true with settledReplayApprovedTrace, run recommendation-policy after parse (production parity). */
  applySettledReplayPolicy?: boolean;
}

export interface ReplayAssertionResult {
  field: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
}

export interface ReplayRunOutput {
  scenarioName: string;
  llmMode: 'real' | 'mock';
  oddsMode: 'recorded' | 'live' | 'mock';
  shadowMode: boolean;
  sampleProviderData: boolean;
  result: MatchPipelineResult;
  assertions: ReplayAssertionResult[];
  allPassed: boolean;
}

function toKickoffParts(dateIso?: string): { date: string | null; kickoff: string | null } {
  if (!dateIso) return { date: null, kickoff: null };
  const dt = new Date(dateIso);
  if (Number.isNaN(dt.getTime())) return { date: null, kickoff: null };
  return {
    date: dt.toISOString().slice(0, 10),
    kickoff: dt.toISOString().slice(11, 16),
  };
}

function buildReplayWatchlistEntry(scenario: ReplayScenario): WatchlistRow {
  const fixture = scenario.fixture;
  const kickoff = toKickoffParts(fixture.fixture?.date);
  const base: WatchlistRow = {
    id: 0,
    match_id: scenario.matchId,
    date: kickoff.date,
    league: fixture.league?.name || '',
    home_team: fixture.teams?.home?.name || '',
    away_team: fixture.teams?.away?.name || '',
    home_logo: fixture.teams?.home?.logo || '',
    away_logo: fixture.teams?.away?.logo || '',
    kickoff: kickoff.kickoff,
    prediction: null,
    recommended_custom_condition: '',
    recommended_condition_reason: '',
    recommended_condition_reason_vi: '',
    recommended_condition_at: null,
    custom_conditions: '',
    added_at: new Date(0).toISOString(),
    added_by: 'replay',
    last_checked: null,
    total_checks: 0,
    recommendations_count: 0,
    strategic_context: null,
    strategic_context_at: null,
  };
  return {
    ...base,
    ...scenario.watchlistEntry,
    match_id: scenario.matchId,
    league: scenario.watchlistEntry?.league || base.league,
    home_team: scenario.watchlistEntry?.home_team || base.home_team,
    away_team: scenario.watchlistEntry?.away_team || base.away_team,
  };
}

function recordedLiveOddsForFetch(scenario: ReplayScenario): unknown[] {
  const live = scenario.liveOddsResponse;
  if (Array.isArray(live) && live.length > 0) return live;
  const fromResolved = scenario.mockResolvedOdds?.response;
  if (Array.isArray(fromResolved) && fromResolved.length > 0) return fromResolved;
  return Array.isArray(live) ? live : [];
}

function buildRecordedOddsResolver(scenario: ReplayScenario) {
  return async (input: Parameters<typeof resolveMatchOdds>[0]) => resolveMatchOdds(input, {
    fetchLiveOdds: async () => recordedLiveOddsForFetch(scenario),
    fetchPreMatchOdds: async () => scenario.preMatchOddsResponse ?? [],
  });
}

function evaluateAssertions(
  expected: ReplayScenario['expected'],
  result: MatchPipelineResult,
): ReplayAssertionResult[] {
  if (!expected) return [];

  const assertions: ReplayAssertionResult[] = [];
  const parsed = (result.debug?.parsed ?? {}) as Record<string, unknown>;
  const betMarket = String(parsed.bet_market || '');
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [];
  if (expected.shouldPush !== undefined) {
    assertions.push({
      field: 'shouldPush',
      pass: result.shouldPush === expected.shouldPush,
      expected: expected.shouldPush,
      actual: result.shouldPush,
    });
  }
  if (expected.oddsSource !== undefined) {
    assertions.push({
      field: 'oddsSource',
      pass: result.debug?.oddsSource === expected.oddsSource,
      expected: expected.oddsSource,
      actual: result.debug?.oddsSource,
    });
  }
  if (expected.statsSource !== undefined) {
    assertions.push({
      field: 'statsSource',
      pass: result.debug?.statsSource === expected.statsSource,
      expected: expected.statsSource,
      actual: result.debug?.statsSource,
    });
  }
  if (expected.analysisMode !== undefined) {
    assertions.push({
      field: 'analysisMode',
      pass: result.debug?.analysisMode === expected.analysisMode,
      expected: expected.analysisMode,
      actual: result.debug?.analysisMode,
    });
  }
  if (expected.evidenceMode !== undefined) {
    assertions.push({
      field: 'evidenceMode',
      pass: result.debug?.evidenceMode === expected.evidenceMode,
      expected: expected.evidenceMode,
      actual: result.debug?.evidenceMode,
    });
  }
  if (expected.betMarket !== undefined) {
    assertions.push({
      field: 'betMarket',
      pass: betMarket === expected.betMarket,
      expected: expected.betMarket,
      actual: betMarket,
    });
  }
  if (expected.disallowedBetMarketPrefixes !== undefined) {
    assertions.push({
      field: 'disallowedBetMarketPrefixes',
      pass: !expected.disallowedBetMarketPrefixes.some((prefix) => betMarket.startsWith(prefix)),
      expected: expected.disallowedBetMarketPrefixes,
      actual: betMarket,
    });
  }
  if (expected.saved !== undefined) {
    assertions.push({
      field: 'saved',
      pass: result.saved === expected.saved,
      expected: expected.saved,
      actual: result.saved,
    });
  }
  if (expected.notified !== undefined) {
    assertions.push({
      field: 'notified',
      pass: result.notified === expected.notified,
      expected: expected.notified,
      actual: result.notified,
    });
  }
  if (expected.selectionContains !== undefined) {
    assertions.push({
      field: 'selectionContains',
      pass: result.selection.includes(expected.selectionContains),
      expected: expected.selectionContains,
      actual: result.selection,
    });
  }
  if (expected.selectionNotContains !== undefined) {
    assertions.push({
      field: 'selectionNotContains',
      pass: !result.selection.includes(expected.selectionNotContains),
      expected: expected.selectionNotContains,
      actual: result.selection,
    });
  }
  if (expected.warningContains !== undefined) {
    assertions.push({
      field: 'warningContains',
      pass: warnings.some((warning) => warning.includes(expected.warningContains!)),
      expected: expected.warningContains,
      actual: warnings,
    });
  }
  if (expected.skippedAt !== undefined) {
    assertions.push({
      field: 'skippedAt',
      pass: result.debug?.skippedAt === expected.skippedAt,
      expected: expected.skippedAt,
      actual: result.debug?.skippedAt,
    });
  }

  return assertions;
}

function pickSettledReplayTraceMeta(scenario: ReplayScenario): { betMarket?: string; selection?: string } {
  const meta = (scenario as { metadata?: { originalBetMarket?: string; originalSelection?: string } }).metadata;
  if (!meta) return {};
  const betMarket = String(meta.originalBetMarket ?? '').trim();
  const selection = String(meta.originalSelection ?? '').trim();
  return {
    betMarket: betMarket || undefined,
    selection: selection || undefined,
  };
}

export async function runReplayScenario(
  scenario: ReplayScenario,
  options: ReplayRunOptions = {},
): Promise<ReplayRunOutput> {
  const llmMode = options.llmMode ?? 'mock';
  const oddsMode = options.oddsMode ?? 'recorded';
  const shadowMode = options.shadowMode !== false;
  const sampleProviderData = options.sampleProviderData === true;

  const dependencies: NonNullable<Parameters<typeof runPipelineForFixture>[3]>['dependencies'] = {
    fetchFixtureStatistics: async () => scenario.statistics ?? [],
    fetchFixtureEvents: async () => scenario.events ?? [],
    ensureMatchInsight: async () => ({
      fixture: { payload: scenario.fixture, freshness: 'fresh', cacheStatus: 'hit', cachedAt: null, fetchedAt: null, degraded: false },
      statistics: { payload: scenario.statistics ?? [], freshness: 'fresh', cacheStatus: 'hit', cachedAt: null, fetchedAt: null, degraded: false },
      events: { payload: scenario.events ?? [], freshness: 'fresh', cacheStatus: 'hit', cachedAt: null, fetchedAt: null, degraded: false },
    }),
  };

  if (oddsMode === 'recorded') {
    dependencies.resolveMatchOdds = buildRecordedOddsResolver(scenario);
  } else if (oddsMode === 'mock') {
    dependencies.resolveMatchOdds = async () => (
      scenario.mockResolvedOdds ?? {
        oddsSource: 'none',
        response: [],
        oddsFetchedAt: null,
        freshness: 'missing',
        cacheStatus: 'miss',
      }
    );
  }

  if (typeof options.capturedAiText === 'string') {
    dependencies.callGemini = async () => options.capturedAiText as string;
  } else if (llmMode === 'mock') {
    dependencies.callGemini = async () => scenario.mockAiText ?? DEFAULT_MOCK_AI_TEXT;
  }

  const traceMeta = options.settledReplayApprovedTrace ? pickSettledReplayTraceMeta(scenario) : {};
  const result = await runPipelineForFixture(
    scenario.matchId,
    scenario.fixture,
    buildReplayWatchlistEntry(scenario),
    {
      shadowMode,
      sampleProviderData,
      skipSettingsLoad: true,
      advisoryOnly: options.advisoryOnly,
      forceAnalyze: scenario.pipelineOptions?.forceAnalyze,
      skipProceedGate: scenario.pipelineOptions?.skipProceedGate,
      skipStalenessGate: scenario.pipelineOptions?.skipStalenessGate,
      modelOverride: scenario.pipelineOptions?.modelOverride,
      promptVersionOverride: options.promptVersionOverride ?? scenario.pipelineOptions?.promptVersionOverride,
      previousRecommendations: scenario.previousRecommendations ?? null,
      previousSnapshot: scenario.previousSnapshot ?? null,
      settledReplayApprovedTrace: options.settledReplayApprovedTrace === true,
      settledReplayTraceOriginalBetMarket: traceMeta.betMarket,
      settledReplayTraceOriginalSelection: traceMeta.selection,
      applySettledReplayPolicy: options.applySettledReplayPolicy === true,
      recommendationStudioOverride: options.recommendationStudioOverride,
      dependencies,
    },
  );

  const assertions = evaluateAssertions(scenario.expected, result);
  return {
    scenarioName: scenario.name,
    llmMode,
    oddsMode,
    shadowMode,
    sampleProviderData,
    result,
    assertions,
    allPassed: assertions.every((item) => item.pass),
  };
}

export function loadReplayScenarioFromFile(filePath: string): ReplayScenario {
  return JSON.parse(readFileSync(filePath, 'utf8')) as ReplayScenario;
}
