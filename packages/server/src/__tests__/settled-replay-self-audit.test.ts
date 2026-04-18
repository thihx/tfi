import {
  buildReplaySelfAuditPrompt,
  parseReplaySelfAuditResponse,
  summarizeReplaySelfAudit,
} from '../lib/settled-replay-self-audit.js';
import type { SettledReplayScenario } from '../lib/db-replay-scenarios.js';
import type { ReplayRunOutput } from '../lib/pipeline-replay.js';

function makeScenario(): SettledReplayScenario {
  return {
    name: 'sample-45m-under',
    matchId: '1504751',
    fixture: {} as never,
    watchlistEntry: {
      match_id: '1504751',
      league: 'J1 League',
      home_team: 'Machida Zelvia',
      away_team: 'FC Tokyo',
      mode: 'B',
      status: 'active',
      custom_conditions: '',
      date: '2026-04-05',
      kickoff: '12:00',
      strategic_context: null,
    },
    statistics: [
      {
        team: { id: 1, name: 'Machida Zelvia', logo: '' },
        statistics: [
          { type: 'Ball Possession', value: '54%' },
          { type: 'Total Shots', value: '8' },
          { type: 'Shots on Goal', value: '2' },
        ],
      },
      {
        team: { id: 2, name: 'FC Tokyo', logo: '' },
        statistics: [
          { type: 'Ball Possession', value: '46%' },
          { type: 'Total Shots', value: '4' },
          { type: 'Shots on Goal', value: '1' },
        ],
      },
    ],
    mockResolvedOdds: {
      oddsSource: 'live',
      response: [{ bookmakers: [] }],
      oddsFetchedAt: null,
      freshness: 'fresh',
      cacheStatus: 'hit',
    } as never,
    previousRecommendations: [{
      minute: 37,
      odds: 1.91,
      bet_market: 'under_3.0',
      selection: 'Under 3.0 Goals @1.91',
      score: '0-0',
      result: 'win',
      confidence: 6,
      stake_percent: 3,
      reasoning: 'Earlier under thesis.',
    }],
    metadata: {
      recommendationId: 1001,
      originalPromptVersion: 'v6-betting-discipline-c',
      originalAiModel: 'gemini-2.5-flash',
      originalBetMarket: 'under_2.5',
      originalSelection: 'Under 2.5 Goals @1.90',
      originalResult: 'win',
      originalPnl: 2.7,
      minute: 45,
      score: '0-0',
      status: 'HT',
      league: 'J1 League',
      homeTeam: 'Machida Zelvia',
      awayTeam: 'FC Tokyo',
      evidenceMode: 'full_live_data',
      prematchStrength: 'strong',
      profileCoverageBand: 'high',
      overlayCoverageBand: 'moderate',
      policyImpactBand: 'neutral',
    },
    settlementContext: {
      matchId: '1504751',
      homeTeam: 'Machida Zelvia',
      awayTeam: 'FC Tokyo',
      finalStatus: 'FT',
      homeScore: 1,
      awayScore: 0,
      regularHomeScore: 1,
      regularAwayScore: 0,
      settlementStats: [],
    },
  };
}

function makeReplayOutput(): ReplayRunOutput {
  return {
    scenarioName: 'sample-45m-under',
    llmMode: 'real',
    oddsMode: 'mock',
    shadowMode: false,
    sampleProviderData: false,
    assertions: [],
    allPassed: true,
    result: {
      matchId: '1504751',
      success: true,
      decisionKind: 'ai_push',
      shouldPush: true,
      selection: 'Under 2.5 Goals @1.90',
      confidence: 6,
      saved: false,
      notified: false,
      debug: {
        promptVersion: 'v8-market-balance-followup-a',
        prompt: `
========================
LEAGUE PROFILE
========================
TEMPO_TIER: medium

========================
STRATEGIC CONTEXT (FROM PRE-MATCH RESEARCH)
========================
SOURCE_QUALITY: high
QUANTITATIVE_PREMATCH_PRIORS: {"home_clean_sheet_rate":0.3,"away_failed_to_score_rate":0.2}

========================
PREMATCH EXPERT FEATURES V1
========================
{"meta":{"availability":"strong"}}
PREMATCH FEATURE RULES:
- Use PREMATCH_EXPERT_FEATURES_V1 as a secondary prior only.
`,
        parsed: {
          bet_market: 'under_2.5',
          reasoning_en: 'The match is slow and low-event.',
          reasoning_vi: 'Tran dau cham va it bien co.',
          warnings: ['Existing exposure on Under thesis'],
        },
      },
    },
  };
}

describe('settled replay self audit', () => {
  test('buildReplaySelfAuditPrompt includes prior sections from the replay prompt', () => {
    const prompt = buildReplaySelfAuditPrompt(makeScenario(), makeReplayOutput());

    expect(prompt).toContain('PROMPT_PRIOR_CONTEXT');
    expect(prompt).toContain('QUANTITATIVE_PREMATCH_PRIORS');
    expect(prompt).toContain('PREMATCH EXPERT FEATURES V1');
    expect(prompt).toContain('LEAGUE PROFILE');
    expect(prompt).toContain('STRATEGIC CONTEXT (FROM PRE-MATCH RESEARCH)');
  });

  test('parseReplaySelfAuditResponse normalizes the structured JSON output', () => {
    const parsed = parseReplaySelfAuditResponse(
      JSON.stringify({
        primary_decision_driver: 'generic_under_fallback',
        secondary_drivers: ['low tempo', 'continuity'],
        considered_markets: ['under_2.5', '1x2_home'],
        rejected_markets: ['1x2_home', 'asian_handicap_home'],
        under_fallback_detected: true,
        generic_reasoning_detected: true,
        priors_role: 'ignored',
        live_evidence_weight: 'primary',
        odds_availability_issue: false,
        continuity_block: true,
        policy_restriction: false,
        why_not_1x2: 'Home win lacked a clean enough edge.',
        why_not_asian_handicap: 'AH was weaker than the generic under read.',
        notes: 'Example audit.',
      }),
      makeScenario(),
      makeReplayOutput(),
    );

    expect(parsed.primaryDecisionDriver).toBe('generic_under_fallback');
    expect(parsed.underFallbackDetected).toBe(true);
    expect(parsed.genericReasoningDetected).toBe(true);
    expect(parsed.priorsRole).toBe('ignored');
    expect(parsed.continuityBlock).toBe(true);
    expect(parsed.replayBetMarket).toBe('under_2.5');
  });

  test('summarizeReplaySelfAudit counts replay under/no-bet and driver tallies', () => {
    const summary = summarizeReplaySelfAudit([
      {
        scenarioName: 'case-a',
        recommendationId: 1,
        promptVersion: 'v8-market-balance-followup-a',
        originalBetMarket: 'under_2.5',
        replayBetMarket: 'under_2.5',
        replayShouldPush: true,
        primaryDecisionDriver: 'generic_under_fallback',
        secondaryDrivers: [],
        consideredMarkets: [],
        rejectedMarkets: [],
        underFallbackDetected: true,
        genericReasoningDetected: true,
        priorsRole: 'ignored',
        liveEvidenceWeight: 'primary',
        oddsAvailabilityIssue: false,
        continuityBlock: false,
        policyRestriction: false,
        whyNot1x2: '',
        whyNotAsianHandicap: '',
        notes: '',
      },
      {
        scenarioName: 'case-b',
        recommendationId: 2,
        promptVersion: 'v8-market-balance-followup-a',
        originalBetMarket: '1x2_home',
        replayBetMarket: 'unknown',
        replayShouldPush: false,
        primaryDecisionDriver: 'continuity_guard',
        secondaryDrivers: [],
        consideredMarkets: [],
        rejectedMarkets: [],
        underFallbackDetected: false,
        genericReasoningDetected: false,
        priorsRole: 'contradicting',
        liveEvidenceWeight: 'balanced',
        oddsAvailabilityIssue: false,
        continuityBlock: true,
        policyRestriction: true,
        whyNot1x2: '',
        whyNotAsianHandicap: '',
        notes: '',
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.replayUnderCount).toBe(1);
    expect(summary.replayNoBetCount).toBe(1);
    expect(summary.underFallbackDetected).toBe(1);
    expect(summary.genericReasoningDetected).toBe(1);
    expect(summary.priorsIgnored).toBe(1);
    expect(summary.priorsContradicting).toBe(1);
    expect(summary.primaryDrivers).toEqual([
      { key: 'continuity_guard', count: 1 },
      { key: 'generic_under_fallback', count: 1 },
    ]);
  });
});
