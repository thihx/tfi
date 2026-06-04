import { describe, expect, test } from 'vitest';

import {
  buildLiveAnalysisPrompt,
  isLiveAnalysisPromptVersion,
  LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION,
  LIVE_ANALYSIS_PROMPT_VERSION,
  type LiveAnalysisPromptInput,
} from '../lib/live-analysis-prompt.js';

const baseInput: LiveAnalysisPromptInput = {
  homeName: 'Team A',
  awayName: 'Team B',
  league: 'Test League',
  minute: 67,
  score: '1-1',
  status: '2H',
  statsCompact: {
    possession: { home: '54%', away: '46%' },
    shots: { home: 12, away: 8 },
    shots_on_target: { home: 5, away: 3 },
    corners: { home: 6, away: 4 },
    fouls: { home: 10, away: 12 },
  },
  statsAvailable: true,
  statsSource: 'api-football',
  evidenceMode: 'full_live_data',
  statsMeta: null,
  eventsCompact: [
    { minute: 23, team: 'Team A', type: 'goal', detail: 'Normal Goal', player: 'Player A' },
    { minute: 55, team: 'Team B', type: 'goal', detail: 'Normal Goal', player: 'Player B' },
  ],
  oddsCanonical: {
    '1x2': { home: 2.2, draw: 3.3, away: 3.6 },
    ou: { line: 2.5, over: 1.85, under: 2.0 },
    ah: { line: -0.25, home: 1.95, away: 1.92 },
    btts: { yes: 1.65, no: 2.15 },
  },
  oddsAvailable: true,
  oddsSource: 'live',
  oddsFetchedAt: '2026-05-25T12:00:00.000Z',
  oddsSanityWarnings: [],
  oddsSuspicious: false,
  derivedInsights: null,
  customConditions: '',
  recommendedCondition: '',
  recommendedConditionReason: '',
  strategicContext: null,
  analysisMode: 'auto',
  forceAnalyze: false,
  isManualPush: false,
  skippedFilters: [],
  originalWouldProceed: true,
  prediction: null,
  currentTotalGoals: 2,
  previousRecommendations: [],
  matchTimeline: [],
  historicalPerformance: null,
  preMatchPredictionSummary: '',
  statsFallbackReason: '',
};

const settings = {
  minConfidence: 7,
  minOdds: 1.5,
  latePhaseMinute: 75,
  veryLatePhaseMinute: 85,
  endgameMinute: 88,
};

describe('buildLiveAnalysisPrompt', () => {
  test('uses one official prompt version', () => {
    expect(LIVE_ANALYSIS_PROMPT_VERSION).toBe('v10-hybrid-legacy-g');
    expect(LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION).toBe(LIVE_ANALYSIS_PROMPT_VERSION);
    expect(isLiveAnalysisPromptVersion(LIVE_ANALYSIS_PROMPT_VERSION)).toBe(true);
    expect(isLiveAnalysisPromptVersion('retired-prompt')).toBe(false);
  });

  test('embeds official version, exact market contract, and core guards', () => {
    const prompt = buildLiveAnalysisPrompt(baseInput, settings);

    expect(prompt).toContain(`PROMPT_VERSION: ${LIVE_ANALYSIS_PROMPT_VERSION}`);
    expect(prompt).toContain('"over_2.5"');
    expect(prompt).toContain('"under_2.5"');
    expect(prompt).toContain('"asian_handicap_home_-0.25"');
    expect(prompt).toContain('OFFICIAL O/U AND MARKET TIMING');
    expect(prompt).toContain('BREAK-EVEN:');
    expect(prompt).toContain('RUNTIME POLICY PREFLIGHT');
    expect(prompt).toContain('Normal automatic bets need break_even_rate < 0.50');
    expect(prompt).toContain('RED CARD PROTOCOL');
    expect(prompt).toContain('OUTPUT - STRICT JSON');
  });

  test('renders pre-match odds as context-only when live odds are unavailable', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      oddsCanonical: {},
      oddsAvailable: false,
      oddsSource: 'none',
      oddsFetchedAt: null,
      referenceOddsSource: 'reference-prematch',
      referenceOddsFetchedAt: '2026-05-25T11:00:00.000Z',
      referenceOddsCanonical: {
        ou: { line: 2.5, over: 1.9, under: 1.95 },
      },
    }, settings);

    expect(prompt).toContain('NO USABLE ODDS AVAILABLE');
    expect(prompt).toContain('REFERENCE_PREMATCH_CONTEXT_ONLY');
    expect(prompt).toContain('MUST NOT be used to output a bet market');
    expect(prompt).not.toContain('"over_2.5"');
  });

  test('retired prompt overrides render the same official prompt', () => {
    const baseline = buildLiveAnalysisPrompt(baseInput, settings);
    const override = buildLiveAnalysisPrompt(baseInput, settings, 'retired-prompt');

    expect(override).toBe(baseline);
  });

  test('includes follow-up lineup context without inventing missing data', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      userQuestion: 'Lineup and H1 AH?',
      lineupsSnapshot: {
        available: true,
        teams: [{
          side: 'home',
          teamName: 'Team A',
          formation: '4-2-3-1',
          confirmedStarters: ['GK A'],
          benchCount: 1,
        }],
      },
    }, settings);

    expect(prompt).toContain('FOLLOW_UP_MODE: advisory_match_scoped');
    expect(prompt).toContain('LINEUPS_SNAPSHOT');
    expect(prompt).toContain('GK A');
    expect(prompt).toContain('bench_count');
    expect(prompt).toContain('Never guess or infer missing lineup details');
  });

  test('renders active policy preflight constraints for one-goal early midgame', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      minute: 39,
      score: '0-1',
      currentTotalGoals: 1,
    }, settings);

    expect(prompt).toContain('CURRENT_POLICY_CONTEXT: minute_band=30-44; score_state=one-goal-margin; evidence_mode=full_live_data; total_goals=1');
    expect(prompt).toContain('ACTIVE SCORE/MINUTE VETO: minute 30-44 with one-goal margin is a danger zone');
    expect(prompt).toContain('high-confidence AH protection pocket');
    expect(prompt).toContain('BTTS No is blocked in this score state before minute 60');
  });

  test('renders the late under 4.5 two-plus-margin rescue pocket', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      minute: 80,
      score: '1-3',
      currentTotalGoals: 4,
      oddsCanonical: {
        ...baseInput.oddsCanonical,
        ou: { line: 4.5, over: 1.8, under: 2.025 },
      },
    }, settings);

    expect(prompt).toContain('CURRENT_POLICY_CONTEXT: minute_band=75+; score_state=two-plus-margin; evidence_mode=full_live_data; total_goals=4');
    expect(prompt).toContain('Late two-plus-margin goals Under with less than one goal of cushion is normally no_bet unless it is exactly under_4.5');
    expect(prompt).toContain('confidence >= 7, value_percent >= 9');
  });
});
