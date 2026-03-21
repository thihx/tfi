import { readFileSync } from 'node:fs';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from './football-api.js';
import { resolveMatchOdds, type ResolveMatchOddsResult } from './odds-resolver.js';
import { fetchTheOddsLiveDetailed, type TheOddsEvent } from './the-odds-api.js';
import { runPipelineForFixture, type MatchPipelineResult } from './server-pipeline.js';
import type { LiveAnalysisPromptVersion, PromptAnalysisMode, PromptEvidenceMode } from './live-analysis-prompt.js';
import type { WatchlistRow } from '../repos/watchlist.repo.js';

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
  theOddsEventsResponse?: TheOddsEvent[];
  theOddsEventOddsResponse?: TheOddsEvent | null;
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
    reasoning?: string;
  }> | null;
  previousSnapshot?: {
    minute: number;
    home_score: number;
    away_score: number;
    odds: Record<string, unknown>;
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
    mode: 'B',
    prediction: null,
    recommended_custom_condition: '',
    recommended_condition_reason: '',
    recommended_condition_reason_vi: '',
    recommended_condition_at: null,
    custom_conditions: '',
    priority: 0,
    status: 'active',
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

function buildRecordedOddsResolver(scenario: ReplayScenario) {
  return async (input: Parameters<typeof resolveMatchOdds>[0]) => resolveMatchOdds(input, {
    fetchLiveOdds: async () => scenario.liveOddsResponse ?? [],
    fetchPreMatchOdds: async () => scenario.preMatchOddsResponse ?? [],
    fetchTheOddsLiveDetailed: async (homeTeam, awayTeam, fixtureId, kickoffTimestamp, options) => (
      fetchTheOddsLiveDetailed(
        homeTeam,
        awayTeam,
        fixtureId,
        kickoffTimestamp,
        options,
        {
          fetchEventsForSport: async () => scenario.theOddsEventsResponse ?? [],
          fetchEventOddsForMatch: async () => scenario.theOddsEventOddsResponse ?? null,
        },
      )
    ),
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
  };

  if (oddsMode === 'recorded') {
    dependencies.resolveMatchOdds = buildRecordedOddsResolver(scenario);
  } else if (oddsMode === 'mock') {
    dependencies.resolveMatchOdds = async () => (
      scenario.mockResolvedOdds ?? { oddsSource: 'none', response: [], oddsFetchedAt: null }
    );
  }

  if (llmMode === 'mock') {
    dependencies.callGemini = async () => scenario.mockAiText ?? DEFAULT_MOCK_AI_TEXT;
  }

  const result = await runPipelineForFixture(
    scenario.matchId,
    scenario.fixture,
    buildReplayWatchlistEntry(scenario),
    {
      shadowMode,
      sampleProviderData,
      skipSettingsLoad: true,
      forceAnalyze: scenario.pipelineOptions?.forceAnalyze,
      skipProceedGate: scenario.pipelineOptions?.skipProceedGate,
      skipStalenessGate: scenario.pipelineOptions?.skipStalenessGate,
      modelOverride: scenario.pipelineOptions?.modelOverride,
      promptVersionOverride: options.promptVersionOverride ?? scenario.pipelineOptions?.promptVersionOverride,
      previousRecommendations: scenario.previousRecommendations ?? null,
      previousSnapshot: scenario.previousSnapshot ?? null,
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
