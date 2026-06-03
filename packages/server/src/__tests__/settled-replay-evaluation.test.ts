import {
  buildEvaluatedReplayCase,
  classifyReplayMarketFamily,
  getReplayFineTimeWindow,
  getReplayMinuteBand,
  getReplayScoreState,
  normalizeEvaluatedReplayCaseDiagnostics,
  summarizeSettledReplayVariant,
} from '../lib/settled-replay-evaluation.js';

describe('settled replay evaluation', () => {
  test('classifies market families for replay stats', () => {
    expect(classifyReplayMarketFamily('under_2.5')).toBe('goals_under');
    expect(classifyReplayMarketFamily('over_3.5')).toBe('goals_over');
    expect(classifyReplayMarketFamily('corners_over_10.5')).toBe('corners');
    expect(classifyReplayMarketFamily('btts_yes')).toBe('btts');
    expect(classifyReplayMarketFamily('1x2_home')).toBe('1x2');
    expect(classifyReplayMarketFamily('asian_handicap_home_-0.25')).toBe('asian_handicap');
  });

  test('classifies replay minute bands and score states', () => {
    expect(getReplayMinuteBand(12)).toBe('00-29');
    expect(getReplayMinuteBand(37)).toBe('30-44');
    expect(getReplayMinuteBand(55)).toBe('45-59');
    expect(getReplayMinuteBand(66)).toBe('60-74');
    expect(getReplayMinuteBand(82)).toBe('75+');

    expect(getReplayFineTimeWindow(10)).toBe('00-14');
    expect(getReplayFineTimeWindow(35)).toBe('30-36');
    expect(getReplayFineTimeWindow(40)).toBe('37-44');

    expect(getReplayScoreState('0-0')).toBe('0-0');
    expect(getReplayScoreState('1-1')).toBe('level');
    expect(getReplayScoreState('1-0')).toBe('one-goal-margin');
    expect(getReplayScoreState('3-0')).toBe('two-plus-margin');
  });

  test('summarizes under share, no-bet rate, and accuracy by cohort', () => {
    const rows = [
      buildEvaluatedReplayCase(
        'v10-hybrid-legacy-g',
        {
          name: 'case-a',
          matchId: '1',
          fixture: {} as never,
          metadata: {
            recommendationId: 1,
            originalPromptVersion: 'v10-hybrid-legacy-g',
            originalAiModel: 'gemini',
            originalBetMarket: 'under_2.5',
            originalSelection: '',
            originalResult: 'win',
            originalPnl: 2,
            minute: 34,
            score: '0-0',
            status: '1H',
            league: 'A',
            homeTeam: 'Home',
            awayTeam: 'Away',
            evidenceMode: 'full_live_data',
            prematchStrength: 'strong',
            profileCoverageBand: 'high',
            overlayCoverageBand: 'low',
            policyImpactBand: 'neutral',
            performanceMemoryKey: 'under_2.5|30-44|0-0',
            performanceMemoryStatus: 'no_history',
          },
          settlementContext: {
            matchId: '1',
            homeTeam: 'Home',
            awayTeam: 'Away',
            finalStatus: 'FT',
            homeScore: 0,
            awayScore: 0,
            regularHomeScore: 0,
            regularAwayScore: 0,
            settlementStats: [],
          },
        },
        {
          scenarioName: 'case-a',
          llmMode: 'mock',
          oddsMode: 'mock',
          shadowMode: false,
          sampleProviderData: false,
          assertions: [],
          allPassed: true,
          result: {
            matchId: '1',
            success: true,
            decisionKind: 'ai_push',
            shouldPush: true,
            selection: 'Under 2.5 Goals @1.90',
            confidence: 6,
            saved: false,
            notified: false,
            debug: { parsed: { bet_market: 'under_2.5' }, shadowMode: false },
          },
        },
        'win',
        1.9,
        3,
        2.7,
        'totals_only',
      ),
      buildEvaluatedReplayCase(
        'v10-hybrid-legacy-g',
        {
          name: 'case-b',
          matchId: '2',
          fixture: {} as never,
          metadata: {
            recommendationId: 2,
            originalPromptVersion: 'v10-hybrid-legacy-g',
            originalAiModel: 'gemini',
            originalBetMarket: 'over_2.5',
            originalSelection: '',
            originalResult: 'loss',
            originalPnl: -3,
            minute: 61,
            score: '1-0',
            status: '2H',
            league: 'A',
            homeTeam: 'Home',
            awayTeam: 'Away',
            evidenceMode: 'full_live_data',
            prematchStrength: 'strong',
            profileCoverageBand: 'high',
            overlayCoverageBand: 'low',
            policyImpactBand: 'neutral',
            performanceMemoryKey: 'over_2.5|60-74|one-goal-margin',
            performanceMemoryStatus: 'no_history',
          },
          settlementContext: {
            matchId: '2',
            homeTeam: 'Home',
            awayTeam: 'Away',
            finalStatus: 'FT',
            homeScore: 3,
            awayScore: 0,
            regularHomeScore: 3,
            regularAwayScore: 0,
            settlementStats: [],
          },
        },
        {
          scenarioName: 'case-b',
          llmMode: 'mock',
          oddsMode: 'mock',
          shadowMode: false,
          sampleProviderData: false,
          assertions: [],
          allPassed: true,
          result: {
            matchId: '2',
            success: true,
            decisionKind: 'no_bet',
            shouldPush: false,
            selection: 'No bet',
            confidence: 0,
            saved: false,
            notified: false,
            debug: { parsed: { bet_market: '' }, shadowMode: false },
          },
        },
        null,
        null,
        null,
        null,
        'limited_odds',
      ),
    ];

    const summary = summarizeSettledReplayVariant('v10-hybrid-legacy-g', rows);

    expect(summary.totalScenarios).toBe(2);
    expect(summary.pushCount).toBe(1);
    expect(summary.noBetCount).toBe(1);
    expect(summary.goalsUnderCount).toBe(1);
    expect(summary.goalsOverCount).toBe(0);
    expect(summary.goalsUnderShare).toBe(1);
    expect(summary.accuracy).toBe(1);
    expect(summary.avgOdds).toBe(1.9);
    expect(summary.avgBreakEvenRate).toBe(0.5263);
    expect(summary.totalStaked).toBe(3);
    expect(summary.totalPnl).toBe(2.7);
    expect(summary.roi).toBe(0.9);
    expect(summary.byMinuteBand).toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: '30-44', goalsUnderCount: 1, avgOdds: 1.9, totalPnl: 2.7 }),
      expect.objectContaining({ bucket: '60-74', noBetCount: 1, totalStaked: 0, totalPnl: 0 }),
    ]));
    expect(summary.byScoreState).toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: '0-0', goalsUnderCount: 1 }),
      expect.objectContaining({ bucket: 'one-goal-margin', noBetCount: 1 }),
    ]));
    expect(summary.byEvidenceMode).toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: 'full_live_data', goalsUnderCount: 1 }),
    ]));
    expect(summary.byMarketAvailability).toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: 'totals_only', goalsUnderCount: 1 }),
      expect.objectContaining({ bucket: 'limited_odds', noBetCount: 1 }),
    ]));
    expect(summary.byMarketFamily).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: 'goals_under',
          pushCount: 1,
          shareOfActionable: 1,
          pushRateOfCohort: 0.5,
        }),
      ]),
    );
    expect(summary.byCanonicalMarketTop.some((m) => m.canonicalMarket === 'under_2.5')).toBe(true);
    expect(summary.byFineTimeWindow.length).toBeGreaterThan(0);
    expect(summary.byMinuteBandMarketFamily.some((c) => c.family === 'goals_under')).toBe(true);
  });

  test('attributes replay blockers to provider coverage and replay context separately', () => {
    const baseScenario = {
      name: 'case-provider',
      matchId: '1',
      fixture: {} as never,
      metadata: {
        recommendationId: 1,
        originalPromptVersion: 'v10-hybrid-legacy-g',
        originalAiModel: 'gemini',
        originalBetMarket: 'under_2.75',
        originalSelection: 'Under 2.75 Goals @2.20',
        originalResult: 'win',
        originalPnl: 2,
        minute: 59,
        score: '1-1',
        status: '2H',
        league: 'A',
        homeTeam: 'Home',
        awayTeam: 'Away',
        evidenceMode: 'full_live_data',
        prematchStrength: 'strong',
        profileCoverageBand: 'high',
        overlayCoverageBand: 'low',
        policyImpactBand: 'neutral',
        performanceMemoryKey: 'under_2.75|45-59|level',
        performanceMemoryStatus: 'no_history' as const,
      },
      settlementContext: {
        matchId: '1',
        homeTeam: 'Home',
        awayTeam: 'Away',
        finalStatus: 'FT',
        homeScore: 1,
        awayScore: 1,
        regularHomeScore: 1,
        regularAwayScore: 1,
        settlementStats: [],
      },
      performanceMemorySnapshot: {
        key: 'under_2.75|45-59|level',
        canonicalMarket: 'under_2.75',
        minuteBand: '45-59' as const,
        scoreState: 'level' as const,
        lookupResult: { status: 'no_history' },
        source: 'db' as const,
      },
    };
    const baseOutput = {
      scenarioName: 'case-provider',
      llmMode: 'mock',
      oddsMode: 'mock',
      shadowMode: false,
      sampleProviderData: false,
      assertions: [],
      allPassed: true,
      result: {
        matchId: '1',
        success: true,
        decisionKind: 'no_bet' as const,
        shouldPush: false,
        selection: 'Under 2.75 Goals @2.20',
        confidence: 4,
        saved: false,
        notified: false,
        debug: {
          shadowMode: false,
          parsed: {
            bet_market: 'under_2.75',
            llm_decision_diagnostic: 'market_not_available_in_odds',
            market_resolution_status: 'odds_unavailable',
            warnings: ['ODDS_INVALID', 'MEMORY_FLAG_NO_HISTORY'],
          },
        },
      },
    };

    const providerCase = buildEvaluatedReplayCase(
      'v10-hybrid-legacy-g',
      baseScenario,
      baseOutput,
      null,
      null,
      null,
      null,
      'totals_only',
    );

    expect(providerCase.providerCoverageStatus).toBe('provider_line_unavailable_or_stale');
    expect(providerCase.replayContextStatus).toBe('memory_no_history');
    expect(providerCase.replayQualityAttribution).toBe('provider_coverage');

    const contextOnlyCase = buildEvaluatedReplayCase(
      'v10-hybrid-legacy-g',
      { ...baseScenario, name: 'case-memory-only' },
      {
        ...baseOutput,
        scenarioName: 'case-memory-only',
        result: {
          ...baseOutput.result,
          selection: 'Over 3.5 Goals @2.40',
          debug: {
            shadowMode: false,
            parsed: {
              bet_market: 'over_3.5',
              llm_decision_diagnostic: 'policy_blocked',
              market_resolution_status: 'resolved',
              warnings: ['MEMORY_FLAG_NO_HISTORY'],
            },
          },
        },
      },
      null,
      null,
      null,
      null,
      'totals_only',
    );

    expect(contextOnlyCase.providerCoverageStatus).toBe('ok');
    expect(contextOnlyCase.replayContextStatus).toBe('replay_memory_missing');
    expect(contextOnlyCase.replayQualityAttribution).toBe('replay_context_gap');

    const productionNoHistoryCase = buildEvaluatedReplayCase(
      'v10-hybrid-legacy-g',
      { ...baseScenario, name: 'case-production-no-history' },
      {
        ...baseOutput,
        scenarioName: 'case-production-no-history',
        result: {
          ...baseOutput.result,
          debug: {
            shadowMode: false,
            parsed: {
              bet_market: 'under_2.75',
              llm_decision_diagnostic: 'policy_blocked',
              market_resolution_status: 'resolved',
              warnings: ['MEMORY_FLAG_NO_HISTORY'],
            },
          },
        },
      },
      null,
      null,
      null,
      null,
      'totals_only',
    );

    expect(productionNoHistoryCase.providerCoverageStatus).toBe('ok');
    expect(productionNoHistoryCase.replayContextStatus).toBe('memory_no_history');
    expect(productionNoHistoryCase.replayQualityAttribution).toBe('replay_context_gap');
  });

  test('attributes preflight-visible policy blocks to model-policy mismatch', () => {
    const scenario = {
      name: 'case-policy-mismatch',
      matchId: '1',
      fixture: {} as never,
      metadata: {
        recommendationId: 1,
        originalPromptVersion: 'v10-hybrid-legacy-g',
        originalAiModel: 'gemini',
        originalBetMarket: 'btts_no',
        originalSelection: 'BTTS No @1.80',
        originalResult: 'loss',
        originalPnl: -3,
        minute: 41,
        score: '0-1',
        status: '1H',
        league: 'A',
        homeTeam: 'Home',
        awayTeam: 'Away',
        evidenceMode: 'full_live_data',
        prematchStrength: 'strong',
        profileCoverageBand: 'high',
        overlayCoverageBand: 'low',
        policyImpactBand: 'neutral',
        performanceMemoryKey: 'btts_no|30-44|one-goal-margin',
        performanceMemoryStatus: 'no_history' as const,
      },
      settlementContext: {
        matchId: '1',
        homeTeam: 'Home',
        awayTeam: 'Away',
        finalStatus: 'FT',
        homeScore: 1,
        awayScore: 2,
        regularHomeScore: 1,
        regularAwayScore: 2,
        settlementStats: [],
      },
      performanceMemorySnapshot: {
        key: 'btts_no|30-44|one-goal-margin',
        canonicalMarket: 'btts_no',
        minuteBand: '30-44' as const,
        scoreState: 'one-goal-margin' as const,
        lookupResult: { status: 'no_history' },
        source: 'db' as const,
      },
    };
    const baseOutput = {
      scenarioName: 'case-policy-mismatch',
      llmMode: 'mock' as const,
      oddsMode: 'mock' as const,
      shadowMode: false,
      sampleProviderData: false,
      assertions: [],
      allPassed: true,
      result: {
        matchId: '1',
        success: true,
        decisionKind: 'no_bet' as const,
        shouldPush: false,
        selection: 'BTTS No @1.80',
        confidence: 6,
        saved: false,
        notified: false,
        debug: {
          shadowMode: false,
          parsed: {
            bet_market: 'btts_no',
            llm_decision_diagnostic: 'policy_blocked',
            market_resolution_status: 'resolved',
            warnings: ['CONFIDENCE_BELOW_MIN', 'BTTS_NO_BLOCKED_GOAL_MARGIN'],
          },
        },
      },
    };

    const mismatchCase = buildEvaluatedReplayCase(
      'v10-hybrid-legacy-g',
      scenario,
      baseOutput,
      null,
      null,
      null,
      null,
      'playable_side_market',
    );

    expect(mismatchCase.replayQualityAttribution).toBe('model_policy_mismatch');

    const hardPolicyCase = buildEvaluatedReplayCase(
      'v10-hybrid-legacy-g',
      { ...scenario, name: 'case-hard-policy' },
      {
        ...baseOutput,
        scenarioName: 'case-hard-policy',
        result: {
          ...baseOutput.result,
          debug: {
            shadowMode: false,
            parsed: {
              bet_market: 'btts_no',
              llm_decision_diagnostic: 'policy_blocked',
              market_resolution_status: 'resolved',
              warnings: ['POLICY_BLOCK_SEGMENT_BLOCKLIST'],
            },
          },
        },
      },
      null,
      null,
      null,
      null,
      'playable_side_market',
    );

    expect(hardPolicyCase.replayQualityAttribution).toBe('hard_policy_gate');
  });

  test('attributes pre-LLM skips separately from model no-bet', () => {
    const scenario = {
      name: 'case-pre-llm',
      matchId: '1',
      fixture: {} as never,
      metadata: {
        recommendationId: 1,
        originalPromptVersion: 'v10-hybrid-legacy-g',
        originalAiModel: 'gemini',
        originalBetMarket: 'under_1.5',
        originalSelection: 'Under 1.5 Goals @1.75',
        originalResult: 'win',
        originalPnl: 2,
        minute: 83,
        score: '0-1',
        status: '2H',
        league: 'A',
        homeTeam: 'Home',
        awayTeam: 'Away',
        evidenceMode: 'odds_events_only_degraded',
        prematchStrength: 'strong',
        profileCoverageBand: 'high',
        overlayCoverageBand: 'low',
        policyImpactBand: 'neutral',
        performanceMemoryKey: 'under_1.5|75+|one-goal-margin',
        performanceMemoryStatus: 'found' as const,
      },
      settlementContext: {
        matchId: '1',
        homeTeam: 'Home',
        awayTeam: 'Away',
        finalStatus: 'FT',
        homeScore: 0,
        awayScore: 1,
        regularHomeScore: 0,
        regularAwayScore: 1,
        settlementStats: [],
      },
    };

    const row = buildEvaluatedReplayCase(
      'v10-hybrid-legacy-g',
      scenario,
      {
        scenarioName: 'case-pre-llm',
        llmMode: 'real',
        oddsMode: 'recorded',
        shadowMode: false,
        sampleProviderData: false,
        assertions: [],
        allPassed: true,
        result: {
          matchId: '1',
          success: true,
          decisionKind: 'no_bet',
          shouldPush: false,
          selection: '',
          confidence: 0,
          saved: false,
          notified: false,
          debug: {
            shadowMode: false,
            skippedAt: 'proceed',
            skipReason: 'Low evidence without custom condition',
          },
        },
      },
      null,
      null,
      null,
      null,
      'playable_side_market',
    );

    expect(row.llmDecisionDiagnostic).toBe('pre_llm_blocked');
    expect(row.marketResolutionStatus).toBe('not_requested');
    expect(row.replayQualityAttribution).toBe('pre_llm_blocked');
  });

  test('separates intentional no-market no-bets from selected-market resolution failures', () => {
    const scenario = {
      name: 'case-no-market',
      matchId: '1',
      fixture: {} as never,
      metadata: {
        recommendationId: 1,
        originalPromptVersion: 'v10-hybrid-legacy-g',
        originalAiModel: 'gemini',
        originalBetMarket: 'corners_under_7.5',
        originalSelection: '',
        originalResult: 'win',
        originalPnl: 2,
        minute: 30,
        score: '1-0',
        status: '1H',
        league: 'A',
        homeTeam: 'Home',
        awayTeam: 'Away',
        evidenceMode: 'full_live_data',
        prematchStrength: 'strong',
        profileCoverageBand: 'high',
        overlayCoverageBand: 'low',
        policyImpactBand: 'neutral',
        performanceMemoryKey: 'corners_under_7.5|30-44|one-goal-margin',
        performanceMemoryStatus: 'found' as const,
      },
      settlementContext: {
        matchId: '1',
        homeTeam: 'Home',
        awayTeam: 'Away',
        finalStatus: 'FT',
        homeScore: 1,
        awayScore: 0,
        regularHomeScore: 1,
        regularAwayScore: 0,
        settlementStats: [],
      },
    };

    const noMarket = buildEvaluatedReplayCase(
      'v10-hybrid-legacy-g',
      scenario,
      {
        scenarioName: 'case-no-market',
        llmMode: 'real',
        oddsMode: 'recorded',
        shadowMode: false,
        sampleProviderData: false,
        assertions: [],
        allPassed: true,
        result: {
          matchId: '1',
          success: true,
          decisionKind: 'no_bet',
          shouldPush: false,
          selection: '',
          confidence: 0,
          saved: false,
          notified: false,
          debug: {
            shadowMode: false,
            parsed: { warnings: ['MARKET_UNRESOLVED'] },
          },
        },
      },
      null,
      null,
      null,
      null,
      'side_market_unplayable',
    );

    expect(noMarket.llmDecisionDiagnostic).toBe('no_bet_intentional');
    expect(noMarket.marketResolutionStatus).toBe('not_requested');
    expect(noMarket.replayWarnings).toContain('NO_MARKET_REQUESTED_MODEL_NO_BET');
    expect(noMarket.replayWarnings).not.toContain('MARKET_UNRESOLVED');

    const unresolvedSelection = buildEvaluatedReplayCase(
      'v10-hybrid-legacy-g',
      scenario,
      {
        scenarioName: 'case-unresolved-selection',
        llmMode: 'real',
        oddsMode: 'recorded',
        shadowMode: false,
        sampleProviderData: false,
        assertions: [],
        allPassed: true,
        result: {
          matchId: '1',
          success: true,
          decisionKind: 'no_bet',
          shouldPush: true,
          selection: 'Mystery Market @2.10',
          confidence: 7,
          saved: false,
          notified: false,
          debug: {
            shadowMode: false,
            parsed: { warnings: ['MARKET_UNRESOLVED'] },
          },
        },
      },
      null,
      null,
      null,
      null,
      'side_market_unplayable',
    );

    expect(unresolvedSelection.llmDecisionDiagnostic).toBe('market_parse_failed');
    expect(unresolvedSelection.marketResolutionStatus).toBe('missing_market');
    expect(unresolvedSelection.replayWarnings).toContain('MARKET_UNRESOLVED_AFTER_SELECTION');
    expect(unresolvedSelection.providerCoverageStatus).toBe('missing_market_or_selection');
  });

  test('normalizes stored eval cases with empty replay diagnostics', () => {
    const row = normalizeEvaluatedReplayCaseDiagnostics({
      promptVersion: 'v10-hybrid-legacy-g',
      scenarioName: 'case-empty-diagnostic',
      recommendationId: 1,
      minute: 30,
      score: '1-0',
      scoreState: 'one-goal-margin',
      minuteBand: '30-44',
      prematchStrength: 'strong',
      evidenceMode: 'full_live_data',
      marketAvailabilityBucket: 'side_market_unplayable',
      shouldPush: false,
      actionable: false,
      canonicalMarket: 'unknown',
      goalsUnder: false,
      goalsOver: false,
      settlementResult: null,
      directionalWin: null,
      replaySelection: '',
      replayOdds: null,
      replayStakePercent: 0,
      breakEvenRate: null,
      replayPnl: null,
      originalBetMarket: 'corners_under_7.5',
      originalResult: 'win',
      decisionKind: 'no_bet',
      llmDecisionDiagnostic: '',
      marketResolutionStatus: '',
      providerCoverageStatus: 'ok',
      replayContextStatus: 'ok',
      replayQualityAttribution: 'model_no_bet',
      replayWarnings: ['MARKET_UNRESOLVED'],
    });

    expect(row.llmDecisionDiagnostic).toBe('no_bet_intentional');
    expect(row.marketResolutionStatus).toBe('not_requested');
    expect(row.providerCoverageStatus).toBe('ok');
    expect(row.replayQualityAttribution).toBe('model_no_bet');
    expect(row.replayWarnings).toEqual(['NO_MARKET_REQUESTED_MODEL_NO_BET']);
  });
});
