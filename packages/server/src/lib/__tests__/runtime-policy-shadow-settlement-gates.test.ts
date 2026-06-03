import { describe, expect, it } from 'vitest';
import { evaluateRuntimePolicyShadowSettlementGates } from '../runtime-policy-shadow-settlement-gates.js';
import type { RuntimePolicyShadowSettlementReport } from '../runtime-policy-shadow-settlement-report.js';

function report(partial: Partial<RuntimePolicyShadowSettlementReport> = {}): RuntimePolicyShadowSettlementReport {
  return {
    generatedAt: '2026-06-03T00:00:00.000Z',
    lookbackDays: 30,
    maxRows: 1000,
    totalEvents: 28,
    totalPocketRows: 30,
    settledRows: 25,
    unresolvedRows: 5,
    wins: 18,
    losses: 0,
    pushLike: 7,
    totalStakedPercent: 25,
    totalPnlPercent: 9.5,
    roiOnStaked: 0.38,
    byPocket: [
      {
        key: 'btts_yes_60_74_two_plus',
        total: 10,
        settled: 8,
        wins: 6,
        losses: 0,
        pushLike: 2,
        totalStakedPercent: 8,
        totalPnlPercent: 3.2,
        roiOnStaked: 0.4,
      },
      {
        key: 'late_under_45_two_plus',
        total: 10,
        settled: 9,
        wins: 7,
        losses: 0,
        pushLike: 2,
        totalStakedPercent: 9,
        totalPnlPercent: 4.5,
        roiOnStaked: 0.5,
      },
      {
        key: 'over_15_60_74_one_goal',
        total: 10,
        settled: 8,
        wins: 5,
        losses: 0,
        pushLike: 3,
        totalStakedPercent: 8,
        totalPnlPercent: 1.8,
        roiOnStaked: 0.225,
      },
    ],
    byCanonicalMarket: [],
    rows: [],
    ...partial,
  };
}

describe('evaluateRuntimePolicyShadowSettlementGates', () => {
  it('passes when combined and pocket-level settlement metrics satisfy promotion gates', () => {
    const result = evaluateRuntimePolicyShadowSettlementGates(
      {
        settlementReportPath: 'report.json',
        minTotalPocketRows: 30,
        minSettledRows: 20,
        minSettledRate: 0.8,
        maxLosses: 0,
        minTotalPnlPercent: 5,
        minRoiOnStaked: 0.25,
        requiredPockets: [
          {
            id: 'btts_yes_60_74_two_plus',
            minTotalRows: 10,
            minSettledRows: 8,
            minSettledRate: 0.8,
            minWins: 5,
            maxLosses: 0,
            minTotalPnlPercent: 2,
            minRoiOnStaked: 0.25,
          },
          {
            id: 'late_under_45_two_plus',
            minTotalRows: 10,
            minSettledRows: 8,
            maxLosses: 0,
            minRoiOnStaked: 0.25,
          },
        ],
      },
      report(),
    );

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.metrics.settledRate).toBe(0.8333);
  });

  it('fails when the combined shadow cohort is too small, unsettled, lossy, or unprofitable', () => {
    const result = evaluateRuntimePolicyShadowSettlementGates(
      {
        settlementReportPath: 'report.json',
        minTotalPocketRows: 30,
        minSettledRows: 20,
        minSettledRate: 0.8,
        maxLosses: 0,
        maxUnresolvedRows: 5,
        minTotalPnlPercent: 5,
        minRoiOnStaked: 0.25,
      },
      report({
        totalPocketRows: 12,
        settledRows: 6,
        unresolvedRows: 6,
        losses: 1,
        totalPnlPercent: -0.5,
        roiOnStaked: -0.0833,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'totalPocketRows 12 < minTotalRows 30',
      'settledRows 6 < minSettledRows 20',
      'settledRate 0.5 < minSettledRate 0.8',
      'losses 1 > maxLosses 0',
      'unresolvedRows 6 > maxUnresolvedRows 5',
      'totalPnlPercent -0.5 < minTotalPnlPercent 5',
      'roiOnStaked -0.0833 < minRoiOnStaked 0.25',
    ]);
  });

  it('fails when a required pocket is missing or misses pocket-level gates', () => {
    const result = evaluateRuntimePolicyShadowSettlementGates(
      {
        settlementReportPath: 'report.json',
        requiredPockets: [
          {
            id: 'over_15_60_74_one_goal',
            minTotalRows: 10,
            minSettledRows: 9,
            minSettledRate: 0.9,
            minWins: 6,
            maxLosses: 0,
            maxUnresolvedRows: 0,
            minTotalPnlPercent: 2,
            minRoiOnStaked: 0.25,
          },
          { id: 'strict_btts_redesigned', minSettledRows: 8 },
        ],
      },
      report(),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'over_15_60_74_one_goal.settledRows 8 < minSettledRows 9',
      'over_15_60_74_one_goal.settledRate 0.8 < minSettledRate 0.9',
      'over_15_60_74_one_goal.wins 5 < minWins 6',
      'over_15_60_74_one_goal.unresolvedRows 2 > maxUnresolvedRows 0',
      'over_15_60_74_one_goal.totalPnlPercent 1.8 < minTotalPnlPercent 2',
      'over_15_60_74_one_goal.roiOnStaked 0.225 < minRoiOnStaked 0.25',
      'required pocket strict_btts_redesigned missing',
    ]);
  });
});
