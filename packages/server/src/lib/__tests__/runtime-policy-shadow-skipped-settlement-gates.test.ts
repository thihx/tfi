import { describe, expect, it } from 'vitest';
import { evaluateRuntimePolicyShadowSkippedSettlementGates } from '../runtime-policy-shadow-skipped-settlement-gates.js';
import type { RuntimePolicyShadowSkippedSettlementReport } from '../runtime-policy-shadow-skipped-settlement-report.js';

function report(
  partial: Partial<RuntimePolicyShadowSkippedSettlementReport> = {},
): RuntimePolicyShadowSkippedSettlementReport {
  return {
    generatedAt: '2026-06-03T00:00:00.000Z',
    lookbackDays: 30,
    maxRows: 1000,
    stakePercent: 1,
    totalEvents: 30,
    settledRows: 25,
    unresolvedRows: 5,
    wins: 18,
    losses: 1,
    pushLike: 6,
    totalStakedPercent: 25,
    totalPnlPercent: 8.5,
    roiOnStaked: 0.34,
    byCanonicalMarket: [
      {
        key: 'btts_yes',
        total: 10,
        settled: 8,
        wins: 6,
        losses: 1,
        pushLike: 1,
        totalStakedPercent: 8,
        totalPnlPercent: 2.8,
        roiOnStaked: 0.35,
      },
      {
        key: 'over_1.5',
        total: 10,
        settled: 9,
        wins: 7,
        losses: 0,
        pushLike: 2,
        totalStakedPercent: 9,
        totalPnlPercent: 3.6,
        roiOnStaked: 0.4,
      },
    ],
    bySkippedReason: [
      {
        key: 'BTTS Yes shadow excluded: requires odds >= 2.05; actual odds=1.7.',
        total: 10,
        settled: 8,
        wins: 6,
        losses: 1,
        pushLike: 1,
        totalStakedPercent: 8,
        totalPnlPercent: 2.8,
        roiOnStaked: 0.35,
      },
    ],
    byLeagueSegment: [],
    byTeamSegment: [],
    rows: [],
    ...partial,
  };
}

describe('evaluateRuntimePolicyShadowSkippedSettlementGates', () => {
  it('passes when skipped-neighbor settlement metrics satisfy review gates', () => {
    const result = evaluateRuntimePolicyShadowSkippedSettlementGates(
      {
        skippedSettlementReportPath: 'report.json',
        minTotalEvents: 30,
        minSettledRows: 20,
        minSettledRate: 0.8,
        minWins: 15,
        maxLosses: 2,
        minTotalPnlPercent: 5,
        minRoiOnStaked: 0.25,
        requiredMarkets: [
          {
            key: 'btts_yes',
            minTotalRows: 10,
            minSettledRows: 8,
            minSettledRate: 0.8,
            minWins: 5,
            maxLosses: 1,
            minTotalPnlPercent: 2,
            minRoiOnStaked: 0.25,
          },
        ],
        requiredSkippedReasons: [
          {
            key: 'BTTS Yes shadow excluded: requires odds >= 2.05; actual odds=1.7.',
            minSettledRows: 8,
            maxLosses: 1,
          },
        ],
      },
      report(),
    );

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.metrics.settledRate).toBe(0.8333);
  });

  it('fails when the combined skipped-neighbor cohort is too small, unsettled, lossy, or unprofitable', () => {
    const result = evaluateRuntimePolicyShadowSkippedSettlementGates(
      {
        skippedSettlementReportPath: 'report.json',
        minTotalEvents: 30,
        minSettledRows: 20,
        minSettledRate: 0.8,
        maxLosses: 0,
        maxUnresolvedRows: 5,
        minTotalPnlPercent: 5,
        minRoiOnStaked: 0.25,
      },
      report({
        totalEvents: 12,
        settledRows: 6,
        unresolvedRows: 6,
        losses: 2,
        totalPnlPercent: -1.25,
        roiOnStaked: -0.2083,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'totalEvents 12 < minTotalRows 30',
      'settledRows 6 < minSettledRows 20',
      'settledRate 0.5 < minSettledRate 0.8',
      'losses 2 > maxLosses 0',
      'unresolvedRows 6 > maxUnresolvedRows 5',
      'totalPnlPercent -1.25 < minTotalPnlPercent 5',
      'roiOnStaked -0.2083 < minRoiOnStaked 0.25',
    ]);
  });

  it('fails when required market or skipped reason cohorts are missing or weak', () => {
    const result = evaluateRuntimePolicyShadowSkippedSettlementGates(
      {
        skippedSettlementReportPath: 'report.json',
        requiredMarkets: [
          {
            key: 'btts_yes',
            minTotalRows: 10,
            minSettledRows: 9,
            minSettledRate: 0.9,
            minWins: 7,
            maxLosses: 0,
            maxUnresolvedRows: 0,
            minTotalPnlPercent: 3,
            minRoiOnStaked: 0.5,
          },
          { key: 'under_2.5', minSettledRows: 8 },
        ],
        requiredSkippedReasons: [
          {
            key: 'late over excluded',
            minSettledRows: 8,
          },
        ],
      },
      report(),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'market:btts_yes.settledRows 8 < minSettledRows 9',
      'market:btts_yes.settledRate 0.8 < minSettledRate 0.9',
      'market:btts_yes.wins 6 < minWins 7',
      'market:btts_yes.losses 1 > maxLosses 0',
      'market:btts_yes.unresolvedRows 2 > maxUnresolvedRows 0',
      'market:btts_yes.totalPnlPercent 2.8 < minTotalPnlPercent 3',
      'market:btts_yes.roiOnStaked 0.35 < minRoiOnStaked 0.5',
      'required market under_2.5 missing',
      'required skippedReason late over excluded missing',
    ]);
  });
});
