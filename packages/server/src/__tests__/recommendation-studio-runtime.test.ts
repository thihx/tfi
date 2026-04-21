import { describe, expect, test } from 'vitest';

import type { LiveAnalysisPromptInput } from '../lib/live-analysis-prompt.js';
import {
  applyRecommendationStudioPostParseRules,
  applyRecommendationStudioPrePromptRules,
  buildPromptFromRecommendationStudioRelease,
} from '../lib/recommendation-studio-runtime.js';
import type { RecommendationReleaseDetail } from '../lib/recommendation-studio-types.js';

const baseInput: LiveAnalysisPromptInput = {
  homeName: 'Team A',
  awayName: 'Team B',
  league: 'Test League',
  minute: 38,
  score: '1-0',
  status: '1H',
  statsCompact: {
    possession: { home: '52%', away: '48%' },
    shots: { home: 8, away: 5 },
    shots_on_target: { home: 3, away: 2 },
    corners: { home: 4, away: 1 },
    fouls: { home: 7, away: 8 },
  },
  statsAvailable: true,
  statsSource: 'api-football',
  evidenceMode: 'full_live_data',
  statsMeta: null,
  eventsCompact: [],
  oddsCanonical: {
    ou: { line: 2.5, over: 1.9, under: 1.95 },
    corners_ou: { line: 8.5, over: 2.0, under: 1.82 },
    ah: { line: -0.25, home: 1.94, away: 1.96 },
  },
  oddsAvailable: true,
  oddsSource: 'live',
  oddsFetchedAt: '2026-04-20T10:00:00.000Z',
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
  currentTotalGoals: 1,
  previousRecommendations: [],
  matchTimeline: [],
  historicalPerformance: null,
  preMatchPredictionSummary: '',
  statsFallbackReason: '',
};

const settings = {
  minConfidence: 5,
  minOdds: 1.5,
  latePhaseMinute: 75,
  veryLatePhaseMinute: 85,
  endgameMinute: 88,
};

function makeRelease(): RecommendationReleaseDetail {
  return {
    id: 1,
    release_key: 'release-1',
    name: 'Release 1',
    prompt_template_id: 11,
    rule_set_id: 21,
    status: 'candidate',
    activation_scope: 'global',
    replay_validation_status: 'not_validated',
    notes: '',
    is_active: false,
    activated_by: null,
    activated_at: null,
    rollback_of_release_id: null,
    created_by: 'admin-1',
    updated_by: 'admin-1',
    created_at: '2026-04-20T00:00:00.000Z',
    updated_at: '2026-04-20T00:00:00.000Z',
    promptTemplate: {
      id: 11,
      template_key: 'prompt-1',
      name: 'Prompt 1',
      base_prompt_version: 'v10-hybrid-legacy-b',
      status: 'draft',
      notes: '',
      advanced_appendix: 'Appendix for {{USER_QUESTION}}',
      created_by: 'admin-1',
      updated_by: 'admin-1',
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:00:00.000Z',
      sections: [
        {
          id: 101,
          template_id: 11,
          section_key: 'market-balance',
          label: 'Market Balance',
          content: 'Focus on {{MATCH_CONTEXT}} and avoid hidden families.\n\n{{EXACT_OUTPUT_ENUMS}}',
          enabled: true,
          sort_order: 0,
          created_at: '2026-04-20T00:00:00.000Z',
          updated_at: '2026-04-20T00:00:00.000Z',
        },
      ],
    },
    ruleSet: {
      id: 21,
      rule_set_key: 'rules-1',
      name: 'Rules 1',
      status: 'draft',
      notes: '',
      created_by: 'admin-1',
      updated_by: 'admin-1',
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:00:00.000Z',
      rules: [
        {
          id: 201,
          rule_set_id: 21,
          name: 'Hide corners in weak 30-44',
          stage: 'pre_prompt',
          priority: 10,
          enabled: true,
          conditions_json: {
            minuteBands: ['30-44'],
            prematchStrengths: ['weak'],
          },
          actions_json: {
            hideMarketFamiliesFromPrompt: ['corners'],
            appendInstruction: 'NO_CORNERS_IN_THIS_ZONE',
          },
          notes: '',
          created_at: '2026-04-20T00:00:00.000Z',
          updated_at: '2026-04-20T00:00:00.000Z',
        },
        {
          id: 202,
          rule_set_id: 21,
          name: 'Cap risky corners under',
          stage: 'post_parse',
          priority: 20,
          enabled: true,
          conditions_json: {
            minuteBands: ['30-44'],
            canonicalMarketPrefixes: ['corners_under_'],
          },
          actions_json: {
            forceNoBet: true,
            capConfidence: 6,
            capStakePercent: 0.6,
            warning: 'Corners under capped in 30-44',
          },
          notes: '',
          created_at: '2026-04-20T00:00:00.000Z',
          updated_at: '2026-04-20T00:00:00.000Z',
        },
      ],
    },
  };
}

describe('recommendation studio runtime', () => {
  test('applies pre-prompt hidden-market actions and injects overlay text', () => {
    const release = makeRelease();
    const prePromptDecision = applyRecommendationStudioPrePromptRules(release, {
      minute: 38,
      score: '1-0',
      evidenceMode: 'full_live_data',
      prematchStrength: 'weak',
      promptVersion: 'v10-hybrid-legacy-b',
      releaseId: release.id,
      releaseKey: release.release_key,
      odds: baseInput.oddsCanonical as Record<string, unknown>,
      currentCorners: 5,
      currentGoals: 1,
    });

    expect(prePromptDecision.hiddenMarketFamilies).toContain('corners');
    expect(prePromptDecision.appendedInstructions).toContain('NO_CORNERS_IN_THIS_ZONE');

    const prompt = buildPromptFromRecommendationStudioRelease(
      {
        ...baseInput,
        userQuestion: 'Should we still consider corners?',
      },
      settings,
      'v10-hybrid-legacy-b',
      release,
      prePromptDecision,
    );

    expect(prompt).toContain('ADMIN RELEASE OVERLAY');
    expect(prompt).toContain('Market Balance');
    expect(prompt).toContain('NO_CORNERS_IN_THIS_ZONE');
    expect(prompt).toContain('EXACT OUTPUT ENUMS:');
    expect(prompt).toContain('"over_2.5"');
    expect(prompt).toContain('"under_2.5"');
    expect(prompt).not.toContain('"corners_over_8.5"');
    expect(prompt).not.toContain('"corners_under_8.5"');
  });

  test('applies post-parse caps and force-no-bet warnings', () => {
    const release = makeRelease();

    const decision = applyRecommendationStudioPostParseRules(release, {
      minute: 38,
      score: '1-0',
      evidenceMode: 'full_live_data',
      prematchStrength: 'moderate',
      promptVersion: 'v10-hybrid-legacy-b',
      releaseId: release.id,
      releaseKey: release.release_key,
      selection: 'Under 8.5',
      betMarket: 'Corners O/U',
      odds: 1.88,
      valuePercent: 8,
      confidence: 8,
      stakePercent: 1,
      riskLevel: 'medium',
      currentCorners: 5,
      currentGoals: 1,
    });

    expect(decision.forceNoBet).toBe(true);
    expect(decision.blocked).toBe(false);
    expect(decision.confidence).toBe(6);
    expect(decision.stakePercent).toBe(0.6);
    expect(decision.warnings).toContain('Corners under capped in 30-44');
  });

  test('supports release and prompt scoped conditions plus minimum edge enforcement', () => {
    const release = makeRelease();
    release.ruleSet.rules.push({
      id: 203,
      rule_set_id: 21,
      name: 'Release-specific edge floor',
      stage: 'post_parse',
      priority: 30,
      enabled: true,
      conditions_json: {
        promptVersions: ['v10-hybrid-legacy-b'],
        releaseIds: [release.id],
        releaseKeys: [release.release_key],
      },
      actions_json: {
        raiseMinEdge: 12,
        warning: 'Edge floor enforced',
      },
      notes: '',
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:00:00.000Z',
    });

    const decision = applyRecommendationStudioPostParseRules(release, {
      minute: 38,
      score: '1-0',
      evidenceMode: 'full_live_data',
      prematchStrength: 'moderate',
      promptVersion: 'v10-hybrid-legacy-b',
      releaseId: release.id,
      releaseKey: release.release_key,
      selection: 'Home -0.25',
      betMarket: 'Asian Handicap',
      odds: 1.94,
      valuePercent: 6,
      confidence: 7,
      stakePercent: 1,
      riskLevel: 'medium',
      currentCorners: 5,
      currentGoals: 1,
    });

    expect(decision.forceNoBet).toBe(true);
    expect(decision.warnings).toContain('MIN_EDGE_NOT_MET_12');
    expect(decision.warnings).toContain('Edge floor enforced');
  });
});
