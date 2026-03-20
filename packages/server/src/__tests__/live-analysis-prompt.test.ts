import { describe, expect, test } from 'vitest';

import {
  buildLiveAnalysisPrompt,
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
  oddsFetchedAt: '2026-03-21T12:00:00.000Z',
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
  mode: 'B',
  statsFallbackReason: '',
};

const settings = {
  minConfidence: 5,
  minOdds: 1.5,
  latePhaseMinute: 75,
  veryLatePhaseMinute: 85,
  endgameMinute: 88,
};

describe('buildLiveAnalysisPrompt', () => {
  test('embeds explicit prompt version for auditability', () => {
    const prompt = buildLiveAnalysisPrompt(baseInput, settings);

    expect(prompt).toContain(`PROMPT_VERSION: ${LIVE_ANALYSIS_PROMPT_VERSION}`);
  });

  test('keeps auto mode free of force-analysis instructions', () => {
    const prompt = buildLiveAnalysisPrompt(baseInput, settings);

    expect(prompt).toContain('- Analysis Mode: auto');
    expect(prompt).toContain('- Trigger Provenance: scheduled automatic analysis');
    expect(prompt).not.toContain('FORCE ANALYZE MODE - SPECIAL INSTRUCTIONS');
  });

  test('labels system_force without claiming a manual request', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      analysisMode: 'system_force',
      forceAnalyze: true,
      isManualPush: false,
      skippedFilters: ['Minute 3 below minimum (BYPASSED)'],
      originalWouldProceed: false,
    }, settings);

    expect(prompt).toContain('ANALYSIS_MODE: system_force');
    expect(prompt).toContain('This analysis was triggered by watchlist/system force mode, not by a direct manual Ask AI request.');
    expect(prompt).toContain('- Analysis Mode: system_force');
    expect(prompt).toContain('- Trigger Provenance: watchlist/system force mode');
    expect(prompt).toContain('- Is Manual Push: NO');
    expect(prompt).not.toContain('MANUAL USER REQUEST');
  });

  test('labels manual_force as an explicit Ask AI request', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      analysisMode: 'manual_force',
      forceAnalyze: true,
      isManualPush: true,
    }, settings);

    expect(prompt).toContain('ANALYSIS_MODE: manual_force');
    expect(prompt).toContain('This analysis was explicitly requested by a user from the Ask AI flow.');
    expect(prompt).toContain('- Analysis Mode: manual_force');
    expect(prompt).toContain('- Trigger Provenance: manual Ask AI request');
    expect(prompt).toContain('- Is Manual Push: YES');
  });

  test('defines a single consistent reinforcement and duplicate policy', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      previousRecommendations: [
        {
          minute: 61,
          selection: 'Over 2.5 Goals @1.82',
          bet_market: 'over_2.5',
          confidence: 7,
          odds: 1.82,
          reasoning: 'Tempo already strong',
        },
      ],
    }, settings);

    expect(prompt).toContain('Use these records as context. The authoritative reinforcement / duplicate policy is defined in ANALYSIS CONTINUITY RULES below.');
    expect(prompt).toContain('REINFORCEMENT VS DUPLICATE');
    expect(prompt).toContain('There is a material match-state change (goal, red card, clear momentum shift, meaningful stat swing)');
    expect(prompt).toContain('Match minute advanced >= 5 AND the evidence is materially stronger than before');
    expect(prompt).toContain('Never repeat the same pick solely because time passed.');
    expect(prompt).toContain('No significant strengthening since last recommendation at minute [X].');
    expect(prompt).not.toContain('Do NOT repeat the exact same selection + bet_market unless odds have improved by >= 0.10.');
  });

  test('renders dynamic priors only when sample size is sufficient', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      historicalPerformance: {
        overall: { settled: 18, correct: 11, accuracy: 61.11 },
        byMarket: [
          { market: 'over_2.5', settled: 10, correct: 7, accuracy: 70 },
          { market: '1x2_home', settled: 9, correct: 4, accuracy: 44.44 },
          { market: 'btts_yes', settled: 4, correct: 3, accuracy: 75 },
        ],
        byConfidenceBand: [
          { band: '8-10 (high)', settled: 11, correct: 8, accuracy: 72.73 },
          { band: '1-5 (low)', settled: 5, correct: 2, accuracy: 40 },
        ],
        byMinuteBand: [
          { band: '60-74 (late)', settled: 9, correct: 6, accuracy: 66.67 },
        ],
        byOddsRange: [
          { range: '1.70-1.99', settled: 12, correct: 7, accuracy: 58.33 },
        ],
        byLeague: [
          { league: 'Test League', settled: 8, correct: 5, accuracy: 62.5 },
        ],
      },
    }, settings);

    expect(prompt).toContain('DYNAMIC PERFORMANCE PRIORS (SELF-LEARNING DATA)');
    expect(prompt).toContain('Only buckets with settled >= 8 are shown below.');
    expect(prompt).toContain('over_2.5: 70% (7/10) [supportive prior]');
    expect(prompt).toContain('1x2_home: 44.44% (4/9) [caution prior]');
    expect(prompt).toContain('Conf 8-10 (high): 72.73% (8/11) [supportive prior]');
    expect(prompt).toContain('Odds 1.70-1.99: 58.33% (7/12) [neutral prior]');
    expect(prompt).toContain('Test League: 62.5% (5/8) [supportive prior]');
    expect(prompt).not.toContain('btts_yes: 75% (3/4)');
    expect(prompt).not.toContain('Conf 1-5 (low): 40% (2/5)');
  });

  test('removes static betting priors when dynamic priors are used', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      historicalPerformance: {
        overall: { settled: 18, correct: 11, accuracy: 61.11 },
        byMarket: [{ market: 'over_2.5', settled: 10, correct: 7, accuracy: 70 }],
        byConfidenceBand: [{ band: '8-10 (high)', settled: 11, correct: 8, accuracy: 72.73 }],
        byMinuteBand: [],
        byOddsRange: [],
        byLeague: [],
      },
    }, settings);

    expect(prompt).not.toContain('1x2_home worst market (35.6% win rate)');
    expect(prompt).not.toContain('BTTS YES: 54.5% win rate');
    expect(prompt).not.toContain('BTTS NO: 55.5% win rate');
    expect(prompt).not.toContain('confidence 5->40%, 6->50.2%, 7->51.2%, 8->57.1%');
    expect(prompt).toContain('If DYNAMIC PERFORMANCE PRIORS are present and the chosen market is tagged as a caution prior');
  });

  test('renders structured strategic context v2 with source quality and quantitative priors', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      strategicContext: {
        summary: 'Strong home attack prior.',
        competition_type: 'domestic_league',
        qualitative: {
          en: {
            home_motivation: 'Home side is still in the title race.',
            away_motivation: 'Away side is fighting relegation.',
            league_positions: '2nd vs 18th in the same domestic league.',
            fixture_congestion: 'Home has a cup semifinal in three days.',
            rotation_risk: 'Moderate home rotation risk.',
            key_absences: 'Away missing a starting center back.',
            h2h_narrative: 'Home won three of the last four meetings.',
            summary: 'Strong home attack prior.',
          },
          vi: {
            home_motivation: 'Chu nha dang dua vo dich.',
            away_motivation: 'Doi khach dang dua tru hang.',
            league_positions: 'Thu 2 vs thu 18 cung giai.',
            fixture_congestion: 'Chu nha da cup sau ba ngay.',
            rotation_risk: 'Rui ro xoay tua vua phai.',
            key_absences: 'Doi khach mat trung ve chinh.',
            h2h_narrative: 'Chu nha thang 3/4 lan gap gan nhat.',
            summary: 'Tien de tan cong cua chu nha tot.',
          },
        },
        quantitative: {
          home_last5_points: 11,
          away_last5_points: 4,
          home_last5_goals_for: 9,
          away_last5_goals_for: 4,
        },
        source_meta: {
          search_quality: 'high',
          web_search_queries: ['Premier League table', 'team injuries'],
          sources: [
            { domain: 'reuters.com', trust_tier: 'tier_1' },
            { domain: 'fbref.com', trust_tier: 'tier_2' },
          ],
        },
      } as unknown as Record<string, unknown>,
    }, settings);

    expect(prompt).toContain('SOURCE_QUALITY: high');
    expect(prompt).toContain('TRUSTED_SOURCE_DOMAINS: reuters.com, fbref.com');
    expect(prompt).toContain('QUANTITATIVE_PREMATCH_PRIORS: {"home_last5_points":11,"away_last5_points":4,"home_last5_goals_for":9,"away_last5_goals_for":4}');
    expect(prompt).toContain('Treat strategic context as secondary pre-match prior.');
    expect(prompt).toContain('High Over 2.5 / BTTS rates may support attacking markets only if current tempo and shots agree.');
  });

  test('remains backward compatible with legacy flat strategic context', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      strategicContext: {
        home_motivation: 'Home side still needs points.',
        away_motivation: 'Away side has little to play for.',
        league_positions: '4th vs 14th',
        fixture_congestion: 'No notable congestion.',
        rotation_risk: 'Low rotation risk.',
        key_absences: 'No major absences.',
        h2h_narrative: 'Even recent H2H.',
        summary: 'Legacy flat context still available.',
      },
    }, settings);

    expect(prompt).toContain('HOME_MOTIVATION: Home side still needs points.');
    expect(prompt).toContain('SUMMARY: Legacy flat context still available.');
  });

  test('defines authoritative evidence hierarchy for degraded odds-events mode', () => {
    const prompt = buildLiveAnalysisPrompt({
      ...baseInput,
      statsAvailable: false,
      evidenceMode: 'odds_events_only_degraded',
      derivedInsights: { intensity: 'high' },
    }, settings);

    expect(prompt).toContain('- EVIDENCE_TIER: tier_3 (Usable odds + event timeline, but no usable live stats)');
    expect(prompt).toContain('CURRENT TIER FOR THIS MATCH: tier_3');
    expect(prompt).toContain('Allowed markets in this tier: O/U and selective AH only');
    expect(prompt).toContain('Forbidden markets in this tier: 1X2, BTTS, Corners, Double Chance');
    expect(prompt).toContain('BTTS Yes requires at least Tier 1 evidence. Do NOT recommend BTTS from Tier 3 or Tier 4.');
    expect(prompt).toContain('Corners markets require Tier 1 live stats and live corners data. No corners recommendation in Tier 2-4.');
  });

  test('uses rounded break-even wording instead of fake exact-probability wording', () => {
    const prompt = buildLiveAnalysisPrompt(baseInput, settings);

    expect(prompt).toContain('Report valuation using exact break-even from odds plus a rounded fair-value estimate or range.');
    expect(prompt).toContain('Preferred wording style in reasoning_en: "Break-even about X%. My fair range is around Y-Z%. Edge looks about W%."');
    expect(prompt).not.toContain('MUST include EXACT text in reasoning_en: "Break-even: X%, My estimate: Y%, Edge: Z%"');
  });
});
