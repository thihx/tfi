import { describe, expect, test } from 'vitest';

import {
  buildLiveAnalysisPrompt,
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

  test('supports compact candidate prompt version without changing default baseline', () => {
    const baseline = buildLiveAnalysisPrompt(baseInput, settings);
    const candidate = buildLiveAnalysisPrompt(baseInput, settings, LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION);

    expect(candidate).toContain(`PROMPT_VERSION: ${LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION}`);
    expect(candidate.length).toBeLessThan(baseline.length);
    expect(baseline).toContain(`PROMPT_VERSION: ${LIVE_ANALYSIS_PROMPT_VERSION}`);
  });

  test('candidate prompt enumerates exact canonical market keys and rejects generic aliases', () => {
    const candidate = buildLiveAnalysisPrompt(baseInput, settings, LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION);

    expect(candidate).toContain('EXACT OUTPUT ENUMS:');
    expect(candidate).toContain('"1x2_home"');
    expect(candidate).toContain('"over_2.5"');
    expect(candidate).toContain('"under_2.5"');
    expect(candidate).toContain('"asian_handicap_home_-0.25"');
    expect(candidate).toContain('"asian_handicap_away_-0.25"');
    expect(candidate).toContain('"btts_yes"');
    expect(candidate).toContain('INVALID generic values: "ou", "over/under goals", "1X2", "btts", "asian_handicap", "corners".');
    expect(candidate).toContain('NEVER wrap the JSON in markdown fences like ```json.');
  });

  test('candidate prompt raises an active corners sanity alert for late desync-like lines', () => {
    const candidate = buildLiveAnalysisPrompt({
      ...baseInput,
      minute: 83,
      score: '1-0',
      statsCompact: {
        ...baseInput.statsCompact,
        corners: { home: 4, away: 3 },
      },
      oddsCanonical: {
        corners_ou: { line: 10.5, over: 1.84, under: 1.96 },
      },
    }, settings, LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION);

    expect(candidate).toContain('ACTIVE CORNERS SANITY ALERT: live corners show 7 vs bookmaker line 10.5 at minute 83.');
    expect(candidate).toContain('assume stats desync/delay and skip ALL corners markets.');
  });

  test('betting-discipline candidate treats correlated same-family picks as one position', () => {
    const candidate = buildLiveAnalysisPrompt({
      ...baseInput,
      previousRecommendations: [
        {
          minute: 70,
          selection: 'Under 0.5 Goals @1.92',
          bet_market: 'under_0.5',
          confidence: 7,
          odds: 1.92,
          stake_percent: 3,
        },
        {
          minute: 65,
          selection: 'Under 0.75 Goals @1.90',
          bet_market: 'under_0.75',
          confidence: 7,
          odds: 1.9,
          stake_percent: 4,
        },
        {
          minute: 54,
          selection: 'Under 1 Goals @2.02',
          bet_market: 'under_1',
          confidence: 7,
          odds: 2.02,
          stake_percent: 4,
        },
      ],
    }, settings, LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION);

    expect(candidate).toContain('EXISTING MATCH EXPOSURE');
    expect(candidate).toContain('Goals Under thesis: 3 prior pick(s), total prior stake 11%');
    expect(candidate).toContain('Treat correlated lines in the same direction and market family as ONE existing position');
    expect(candidate).toContain('Experienced football bettors usually prefer one clean entry at the best available line.');
    expect(candidate).toContain('A looser or tighter line on the same unchanged thesis is NOT diversification.');
    expect(candidate).toContain('Multiple nearby lines in the same direction are usually one thesis, not multiple separate bets.');
  });

  test('betting-discipline candidate rejects logically impossible odds feed states', () => {
    const candidate = buildLiveAnalysisPrompt({
      ...baseInput,
      minute: 74,
      score: '1-1',
      oddsCanonical: {
        ou: { line: 2.5, over: 2.08, under: 1.82 },
        btts: { yes: 1.47, no: 2.6 },
      },
    }, settings, LIVE_ANALYSIS_PROMPT_CANDIDATE_VERSION);

    expect(candidate).toContain('If the odds feed contains any market that is logically already settled by the current score/state, treat the entire odds feed as suspect and default to no bet.');
    expect(candidate).toContain('Example of impossible feed state: BTTS Yes/No still quoted after both teams have already scored.');
  });

  test('v6 betting-discipline-b adds ladder alerts and blocks same-thesis rung-by-rung re-entry', () => {
    const candidate = buildLiveAnalysisPrompt({
      ...baseInput,
      previousRecommendations: [
        {
          minute: 45,
          selection: 'Over 3.5 Goals @1.95',
          bet_market: 'over_3.5',
          confidence: 6,
          odds: 1.95,
          stake_percent: 4,
        },
        {
          minute: 63,
          selection: 'Over 3 Goals @2.15',
          bet_market: 'over_3',
          confidence: 6,
          odds: 2.15,
          stake_percent: 4,
        },
      ],
    }, settings, 'v6-betting-discipline-b');

    expect(candidate).toContain('Goals Over thesis: 2 prior pick(s), total prior stake 8%');
    expect(candidate).toContain('[LADDER ALERT]');
    expect(candidate).toContain('If the same thesis already has 2+ entries, do NOT add another rung. Default should_push=false.');
    expect(candidate).toContain('Over 3.5 -> Over 3 -> Over 2.75 -> Over 2.5');
    expect(candidate).toContain('the burden of proof for a second entry is extremely high. In most cases, return should_push=false.');
    expect(candidate).toContain('Do not re-enter the same thesis just because the new line is closer to the current score or looks safer now.');
  });

  test('v6 betting-discipline-b warns against halftime projection and lines still needing two more goals', () => {
    const candidate = buildLiveAnalysisPrompt({
      ...baseInput,
      minute: 45,
      status: 'HT',
      score: '1-1',
      currentTotalGoals: 2,
    }, settings, 'v6-betting-discipline-b');

    expect(candidate).toContain('First-half volume is a prior, not an automatic second-half trigger.');
    expect(candidate).toContain('At HT and in the first 10 minutes of 2H, do NOT project a wild first half straight into a new Over bet unless the early second-half flow confirms it with fresh pressure, shots, or transitions.');
    expect(candidate).toContain('Avoid new bets that still need two or more additional goals/events to win unless the match is truly exceptional.');
    expect(candidate).toContain('if the line still needs two more goals to cash, default should_push=false unless there is a major class mismatch, red-card distortion, or overwhelming full-live evidence.');
    expect(candidate).toContain('At HT / early 2H, a fresh Over 3.5 from 1-1 is usually too demanding.');
  });

  test('v6 betting-discipline-c downgrades corners to a tertiary market and makes corners under exceptional-only', () => {
    const candidate = buildLiveAnalysisPrompt({
      ...baseInput,
      minute: 66,
      score: '0-1',
      oddsCanonical: {
        corners_ou: { line: 8.5, over: 1.95, under: 1.85 },
      },
    }, settings, 'v6-betting-discipline-c');

    expect(candidate).toContain('Goals and AH are primary markets. Corners are tertiary and require cleaner evidence than goals/AH.');
    expect(candidate).toContain('Corners are a tertiary market. They are not a primary read on team quality, true scoring edge, or match motivation.');
    expect(candidate).toContain('Corners Under is exceptional-only. Default should_push=false unless the match is genuinely calm and corner-suppressing.');
    expect(candidate).toContain('Do NOT recommend Corners Under when either team is trailing and likely to chase');
    expect(candidate).toContain('Prefer Corners Over over Corners Under when pressure evidence is strong.');
    expect(candidate).toContain('Corners markets should usually cap at confidence 6 and stake 3%. Corners Under should usually cap at confidence 5 and stake 2% unless the edge is exceptionally clean.');
  });

  test('v6 betting-discipline-c explicitly rejects corners-under laddering as fragile exposure', () => {
    const candidate = buildLiveAnalysisPrompt({
      ...baseInput,
      previousRecommendations: [
        {
          minute: 41,
          selection: 'Corners Under 8.5 @1.85',
          bet_market: 'corners_under_8.5',
          confidence: 8,
          odds: 1.85,
          stake_percent: 5,
        },
        {
          minute: 45,
          selection: 'Corners Under 8 @2.1',
          bet_market: 'corners_under_8',
          confidence: 7,
          odds: 2.1,
          stake_percent: 4,
        },
      ],
      oddsCanonical: {
        corners_ou: { line: 7.5, over: 2.0, under: 1.8 },
      },
    }, settings, 'v6-betting-discipline-c');

    expect(candidate).toContain('Corners Under thesis: 2 prior pick(s), total prior stake 9%');
    expect(candidate).toContain('[LADDER ALERT]');
    expect(candidate).toContain('The same logic applies to corners ladders (example: Under 9.5 -> Under 8.5 -> Under 7.5).');
    expect(candidate).toContain('Treat corners ladders as fragile exposure. Do not staircase Corners Under from 10.5 -> 9.5 -> 8.5 -> 7.5.');
  });

  test('v6 betting-discipline-c treats thin balanced totals as a default pass', () => {
    const candidate = buildLiveAnalysisPrompt({
      ...baseInput,
      minute: 62,
      score: '1-1',
      statsCompact: {
        ...baseInput.statsCompact,
        possession: { home: '50%', away: '50%' },
        shots: { home: '9', away: '8' },
        shots_on_target: { home: '3', away: '3' },
        corners: { home: '4', away: '4' },
      },
      oddsCanonical: {
        ou: { line: 2.5, over: 1.92, under: 1.92 },
      },
    }, settings, 'v6-betting-discipline-c');

    expect(candidate).toContain('Thin balanced totals need a pass unless live evidence is clearly asymmetric.');
    expect(candidate).toContain('Balanced totals are not enough. In 1-1 or 0-0 states around minute 55-70, if possession, shots, and shots on target are broadly even and there is no clear pressure asymmetry, default should_push=false.');
    expect(candidate).toContain('Symmetric prices around 1.90 on both sides usually mean the market sees a thin edge. Do not force an Over or Under just because one more goal would cash.');
  });
});
