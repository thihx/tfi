import { describe, expect, test } from 'vitest';
import { evaluateRecommendationSnapshotCoverageGates } from '../recommendation-snapshot-coverage-gates.js';
import type { RecommendationSnapshotCoverageReport } from '../recommendation-snapshot-coverage.js';

function coverageReport(partial?: Partial<RecommendationSnapshotCoverageReport>): RecommendationSnapshotCoverageReport {
  return {
    generatedAt: '2026-06-03T00:00:00.000Z',
    lookbackDays: 90,
    settledResults: ['win', 'loss', 'push', 'half_win', 'half_loss', 'void'],
    totals: {
      inWindow: 120,
      actionableNotDup: 100,
      settledActionable: 100,
      exportEligible: 100,
      settledActionableMissingHistory: 0,
    },
    snapshotQuality: {
      amongSettledActionable: {
        total: 100,
        emptyOddsSnapshot: 0,
        emptyStatsSnapshot: 0,
        emptyDecisionContext: 10,
        replayReady: 100,
      },
      amongExportEligible: {
        total: 100,
        emptyDecisionContext: 10,
      },
    },
    slim: {
      inWindowSlimTrue: 0,
      inWindowSlimFalse: 120,
    },
    currentRuntime: {
      officialPromptVersion: 'v10-hybrid-legacy-g',
      amongExportEligible: {
        total: 100,
        officialPrompt: 40,
        officialPromptWithDecisionContext: 35,
        officialPromptMissingDecisionContext: 5,
        nonOfficialPrompt: 50,
        emptyPromptVersion: 10,
        emptyDecisionContext: 15,
        currentRuntimeReady: 35,
        currentRuntimeReadyPct: 35,
      },
      cohorts: [],
    },
    topPromptVersions: [],
    topAiModels: [],
    hints: {
      exportEligibleMatchesReplayLoader: 'same filters',
      emptyDecisionContextAmongExportEligiblePct: 10,
      replayReadyAmongSettledActionablePct: 100,
    },
    ...partial,
  };
}

describe('evaluateRecommendationSnapshotCoverageGates', () => {
  test('passes when current-runtime coverage clears configured thresholds', () => {
    const result = evaluateRecommendationSnapshotCoverageGates(
      {
        coveragePath: 'coverage.json',
        officialPromptVersion: 'v10-hybrid-legacy-g',
        minExportEligible: 50,
        minCurrentRuntimeReady: 20,
        minCurrentRuntimeReadyRate: 0.25,
        maxEmptyDecisionContextRate: 0.2,
        maxEmptyPromptVersionRate: 0.15,
      },
      coverageReport(),
    );

    expect(result.ok).toBe(true);
    expect(result.metrics.currentRuntimeReadyRate).toBe(0.35);
    expect(result.failures).toEqual([]);
  });

  test('fails when official current prompt has no settled-ready cohort', () => {
    const result = evaluateRecommendationSnapshotCoverageGates(
      {
        coveragePath: 'coverage.json',
        officialPromptVersion: 'v10-hybrid-legacy-g',
        minCurrentRuntimeReady: 1,
        minCurrentRuntimeReadyRate: 0.01,
      },
      coverageReport({
        currentRuntime: {
          officialPromptVersion: 'v10-hybrid-legacy-g',
          amongExportEligible: {
            total: 100,
            officialPrompt: 0,
            officialPromptWithDecisionContext: 0,
            officialPromptMissingDecisionContext: 0,
            nonOfficialPrompt: 90,
            emptyPromptVersion: 10,
            emptyDecisionContext: 20,
            currentRuntimeReady: 0,
            currentRuntimeReadyPct: 0,
          },
          cohorts: [],
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'currentRuntimeReady 0 < minCurrentRuntimeReady 1',
      'currentRuntimeReady rate 0.0000 < minCurrentRuntimeReadyRate 0.01',
    ]);
  });
});
