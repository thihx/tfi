import { describe, expect, it } from 'vitest';
import { evaluateCurrentRuntimeBlockedSelectionGates } from '../current-runtime-blocked-selection-gates.js';
import type { CurrentRuntimeBlockedSelectionReview } from '../current-runtime-blocked-selection-review.js';

function report(partial: Partial<CurrentRuntimeBlockedSelectionReview> = {}): CurrentRuntimeBlockedSelectionReview {
  return {
    generatedAt: '2026-06-03T00:00:00.000Z',
    lookbackHours: 336,
    maxRows: 1000,
    stakePercent: 1,
    officialPromptVersion: 'v10-hybrid-legacy-g',
    totalSelections: 39,
    uniqueMatches: 5,
    settledRows: 39,
    unresolvedRows: 0,
    wins: 20,
    losses: 18,
    pushLike: 1,
    totalStakedPercent: 39,
    totalPnlPercent: -2.68,
    roiOnStaked: -0.0687,
    metadataCompleteness: {
      missingLlmDecisionDiagnostic: 39,
      missingMarketResolutionStatus: 39,
      missingSaveIntegrityStatus: 39,
      missingEvidenceMode: 0,
    },
    byCanonicalMarket: [
      {
        key: 'over_1.5',
        total: 2,
        settled: 2,
        wins: 2,
        losses: 0,
        pushLike: 0,
        totalStakedPercent: 2,
        totalPnlPercent: 1.45,
        roiOnStaked: 0.725,
      },
      {
        key: 'under_4.5',
        total: 2,
        settled: 2,
        wins: 2,
        losses: 0,
        pushLike: 0,
        totalStakedPercent: 2,
        totalPnlPercent: 1.4,
        roiOnStaked: 0.7,
      },
      {
        key: 'under_3.5',
        total: 2,
        settled: 2,
        wins: 0,
        losses: 2,
        pushLike: 0,
        totalStakedPercent: 2,
        totalPnlPercent: -2,
        roiOnStaked: -1,
      },
    ],
    byPolicyWarning: [],
    byEvidenceMode: [],
    byConfidenceBand: [],
    byMatch: [],
    rows: [],
    ...partial,
  };
}

describe('evaluateCurrentRuntimeBlockedSelectionGates', () => {
  it('passes shadow-candidate gates for required profitable markets', () => {
    const result = evaluateCurrentRuntimeBlockedSelectionGates(
      {
        blockedSelectionReportPath: 'blocked-selection.json',
        minTotalSelections: 30,
        minSettledRows: 30,
        minSettledRate: 1,
        requiredMarkets: [
          {
            id: 'over_1.5',
            minTotalRows: 2,
            minSettledRows: 2,
            minWins: 2,
            maxLosses: 0,
            maxUnresolvedRows: 0,
            minTotalPnlPercent: 1,
            minRoiOnStaked: 0.5,
          },
          {
            id: 'under_4.5',
            minTotalRows: 2,
            minSettledRows: 2,
            minWins: 2,
            maxLosses: 0,
            minTotalPnlPercent: 1,
            minRoiOnStaked: 0.5,
          },
        ],
      },
      report(),
    );

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.metrics.settledRate).toBe(1);
  });

  it('fails when the combined blocked-selection cohort misses configured gates', () => {
    const result = evaluateCurrentRuntimeBlockedSelectionGates(
      {
        blockedSelectionReportPath: 'blocked-selection.json',
        minTotalSelections: 40,
        minSettledRows: 40,
        minSettledRate: 1,
        maxLosses: 10,
        maxUnresolvedRows: 0,
        minTotalPnlPercent: 0,
        minRoiOnStaked: 0,
      },
      report(),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'totalSelections 39 < minTotalRows 40',
      'settledRows 39 < minSettledRows 40',
      'losses 18 > maxLosses 10',
      'totalPnlPercent -2.68 < minTotalPnlPercent 0',
      'roiOnStaked -0.0687 < minRoiOnStaked 0',
    ]);
  });

  it('fails when a required market is missing or misses market-level thresholds', () => {
    const result = evaluateCurrentRuntimeBlockedSelectionGates(
      {
        blockedSelectionReportPath: 'blocked-selection.json',
        requiredMarkets: [
          {
            id: 'under_3.5',
            minTotalRows: 2,
            minSettledRows: 2,
            minWins: 1,
            maxLosses: 0,
            minTotalPnlPercent: 0,
            minRoiOnStaked: 0,
          },
          { id: 'btts_yes', minSettledRows: 2 },
        ],
      },
      report(),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'under_3.5.wins 0 < minWins 1',
      'under_3.5.losses 2 > maxLosses 0',
      'under_3.5.totalPnlPercent -2 < minTotalPnlPercent 0',
      'under_3.5.roiOnStaked -1 < minRoiOnStaked 0',
      'required market btts_yes missing',
    ]);
  });
});
