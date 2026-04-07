/**
 * Writes minimal settled replay JSON fixtures (UTF-8) for CI/doc workflow checks
 * without a database. Regenerates packages/server/fixtures/settled-replay-structural/
 *
 * Run from repo root:
 *   npx tsx packages/server/src/scripts/emit-structural-settled-replay-fixtures.ts
 */
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiFixture } from '../lib/football-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../../fixtures/settled-replay-structural');

function buildMockOddsResponse(goalsLine: '2.5' | '3.5'): unknown[] {
  const ou =
    goalsLine === '2.5'
      ? [
          { value: 'Over', odd: '1.91', handicap: '2.5' },
          { value: 'Under', odd: '1.93', handicap: '2.5' },
        ]
      : [
          { value: 'Over', odd: '1.88', handicap: '3.5' },
          { value: 'Under', odd: '2.00', handicap: '3.5' },
        ];
  return [
    {
      bookmakers: [
        {
          name: 'Structural Replay',
          bets: [
            { name: 'Over/Under', values: ou },
            {
              name: 'Corners Over/Under',
              values: [
                { value: 'Over', odd: '2.10', handicap: '10' },
                { value: 'Under', odd: '2.20', handicap: '10' },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function aiJson(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    should_push: true,
    ai_should_push: true,
    selection: 'Over 2.5 Goals @1.85',
    bet_market: 'over_2.5',
    confidence: 7,
    reasoning_en: 'Structural replay fixture.',
    reasoning_vi: 'Structural replay fixture.',
    warnings: [],
    value_percent: 8,
    risk_level: 'MEDIUM',
    stake_percent: 3,
    condition_triggered_suggestion: '',
    custom_condition_matched: false,
    ...overrides,
  });
}

interface ScenarioDef {
  name: string;
  recommendationId: number;
  matchId: string;
  minute: number;
  score: string;
  mockAiText: string;
  originalBetMarket: string;
  originalSelection: string;
  originalResult: string;
  originalPnl: number;
  homeScore: number;
  awayScore: number;
  /** Canonical goals O/U line in mock odds (one line per file so buildMainOU maps correctly). */
  goalsTotalsLine: '2.5' | '3.5';
}

const SCENARIOS: ScenarioDef[] = [
  {
    name: 'struct-52-11-under-35',
    recommendationId: 910001,
    matchId: 'struct-910001',
    minute: 52,
    score: '1-1',
    mockAiText: aiJson({
      selection: 'Under 3.5 Goals @2.00',
      bet_market: 'under_3.5',
      confidence: 6,
    }),
    originalBetMarket: 'under_3.5',
    originalSelection: 'Under 3.5 Goals @2.00',
    originalResult: 'win',
    originalPnl: 3,
    homeScore: 2,
    awayScore: 1,
    goalsTotalsLine: '3.5',
  },
  {
    name: 'struct-11-52-over',
    recommendationId: 910002,
    matchId: 'struct-910002',
    minute: 52,
    score: '1-1',
    mockAiText: aiJson({
      selection: 'Over 2.5 Goals @1.91',
      bet_market: 'over_2.5',
      confidence: 7,
    }),
    originalBetMarket: 'over_2.5',
    originalSelection: 'Over 2.5 Goals @1.91',
    originalResult: 'win',
    originalPnl: 2.73,
    homeScore: 2,
    awayScore: 1,
    goalsTotalsLine: '2.5',
  },
  {
    name: 'struct-11-62-over-late',
    recommendationId: 910003,
    matchId: 'struct-910003',
    minute: 62,
    score: '1-1',
    mockAiText: aiJson({
      selection: 'Over 2.5 Goals @1.88',
      bet_market: 'over_2.5',
      confidence: 5,
    }),
    originalBetMarket: 'over_2.5',
    originalSelection: 'Over 2.5 Goals @1.88',
    originalResult: 'loss',
    originalPnl: -3,
    homeScore: 1,
    awayScore: 1,
    goalsTotalsLine: '2.5',
  },
  {
    name: 'struct-nobet-40',
    recommendationId: 910004,
    matchId: 'struct-910004',
    minute: 40,
    score: '0-0',
    mockAiText: aiJson({
      should_push: false,
      ai_should_push: false,
      selection: 'No bet',
      bet_market: '',
      confidence: 4,
    }),
    originalBetMarket: 'under_2.5',
    originalSelection: 'Under 2.5 Goals @1.93',
    originalResult: 'win',
    originalPnl: 0,
    homeScore: 0,
    awayScore: 0,
    goalsTotalsLine: '2.5',
  },
];

/** Pipeline reads `fixture.fixture.status.elapsed` as live minute; `{}` makes minute 0 and breaks real-LLM replay. */
function parseScoreLive(s: string): { home: number; away: number } {
  const m = String(s).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return { home: 0, away: 0 };
  return { home: Number(m[1]), away: Number(m[2]) };
}

function buildMinimalFixture(def: ScenarioDef): ApiFixture {
  const goals = parseScoreLive(def.score);
  const fid = Number.parseInt(String(def.matchId).replace(/\D/g, ''), 10) || 1;
  return {
    fixture: {
      id: fid,
      referee: null,
      timezone: 'UTC',
      date: '2026-04-05T15:00:00.000Z',
      timestamp: 1743865200,
      periods: { first: 45, second: null },
      venue: { id: null, name: null, city: null },
      status: {
        long: 'Second Half',
        short: '2H',
        elapsed: def.minute,
      },
    },
    league: {
      id: 999,
      name: 'Structural Test League',
      country: 'World',
      logo: '',
      flag: null,
      season: 2026,
      round: 'Round 1',
    },
    teams: {
      home: { id: 101, name: 'Alpha FC', logo: '', winner: null },
      away: { id: 102, name: 'Beta United', logo: '', winner: null },
    },
    goals: { home: goals.home, away: goals.away },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
    },
  };
}

function buildScenario(def: ScenarioDef) {
  return {
    name: def.name,
    matchId: def.matchId,
    fixture: buildMinimalFixture(def),
    watchlistEntry: {
      match_id: def.matchId,
      league: 'Structural Test League',
      home_team: 'Alpha FC',
      away_team: 'Beta United',
      mode: 'B',
      status: 'active',
      custom_conditions: '',
      date: '2026-04-05',
      kickoff: '15:00',
      strategic_context: null,
    },
    pipelineOptions: {
      forceAnalyze: true,
      skipProceedGate: true,
      skipStalenessGate: true,
    },
    statistics: [
      {
        team: { id: 1, name: 'Alpha FC', logo: '' },
        statistics: [
          { type: 'Ball Possession', value: '52%' },
          { type: 'Total Shots', value: '9' },
          { type: 'Shots on Goal', value: '3' },
        ],
      },
      {
        team: { id: 2, name: 'Beta United', logo: '' },
        statistics: [
          { type: 'Ball Possession', value: '48%' },
          { type: 'Total Shots', value: '6' },
          { type: 'Shots on Goal', value: '2' },
        ],
      },
    ],
    events: [],
    mockResolvedOdds: {
      oddsSource: 'live',
      response: buildMockOddsResponse(def.goalsTotalsLine),
      oddsFetchedAt: new Date().toISOString(),
      freshness: 'fresh',
      cacheStatus: 'hit',
    },
    mockAiText: def.mockAiText,
    previousRecommendations: [],
    metadata: {
      recommendationId: def.recommendationId,
      originalPromptVersion: 'v8-market-balance-followup-h',
      originalAiModel: 'structural-fixture',
      originalBetMarket: def.originalBetMarket,
      originalSelection: def.originalSelection,
      originalResult: def.originalResult,
      originalPnl: def.originalPnl,
      minute: def.minute,
      score: def.score,
      status: '2H',
      league: 'Structural Test League',
      homeTeam: 'Alpha FC',
      awayTeam: 'Beta United',
      evidenceMode: 'full_live_data',
      prematchStrength: 'strong',
      profileCoverageBand: 'high',
      overlayCoverageBand: 'neutral',
      policyImpactBand: 'none',
    },
    settlementContext: {
      matchId: def.matchId,
      homeTeam: 'Alpha FC',
      awayTeam: 'Beta United',
      finalStatus: 'FT',
      homeScore: def.homeScore,
      awayScore: def.awayScore,
      regularHomeScore: def.homeScore,
      regularAwayScore: def.awayScore,
      settlementStats: [],
    },
  };
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const name of readdirSync(OUT_DIR)) {
    if (name.toLowerCase().endsWith('.json')) {
      unlinkSync(join(OUT_DIR, name));
    }
  }
  const built = SCENARIOS.map(buildScenario);
  for (const s of built) {
    writeFileSync(join(OUT_DIR, `${s.name}.json`), JSON.stringify(s, null, 2), 'utf8');
  }
  const manifest = {
    exportedAt: new Date().toISOString(),
    count: built.length,
    note: 'Synthetic fixtures for structural replay (no DB). Regenerate via emit-structural-settled-replay-fixtures.ts',
    filters: {
      lookbackDays: null,
      limit: built.length,
      promptVersion: null,
      marketFamily: 'structural_lab',
    },
    scenarios: built.map((scenario) => ({
      name: scenario.name,
      recommendationId: scenario.metadata.recommendationId,
      matchId: scenario.matchId,
      minute: scenario.metadata.minute,
      score: scenario.metadata.score,
      originalBetMarket: scenario.metadata.originalBetMarket,
      originalResult: scenario.metadata.originalResult,
      promptVersion: scenario.metadata.originalPromptVersion,
    })),
  };
  writeFileSync(join(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Wrote ${built.length} scenarios to ${OUT_DIR}`);
}

main();

