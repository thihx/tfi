import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/pool.js';
import {
  buildRuntimePolicyShadowSkippedReport,
  formatRuntimePolicyShadowSkippedReportMarkdown,
} from '../runtime-policy-shadow-skipped-report.js';

const mockQuery = vi.mocked(query);

describe('runtime policy shadow skipped report', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('aggregates skipped policy-blocked selections by risk-neighbor context', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 21,
          timestamp: '2026-06-03T12:30:00.000Z',
          match_id: null,
          metadata: {
            matchId: 'm-1',
            matchDisplay: 'Home A vs Away A',
            canonicalMarket: 'btts_yes',
            selection: 'BTTS Yes @1.70',
            minute: 61,
            minuteBand: '60-74',
            score: '0-2',
            scoreState: 'two-plus-margin',
            odds: 1.7,
            confidence: 6,
            valuePercent: 4,
            valueBand: '0-4',
            riskLevel: 'MEDIUM',
            stakePercent: 2,
            watchSignalKey: 'none',
            watchSignalLabel: 'none',
            evidenceMode: 'full_live_data',
            marketResolutionStatus: 'resolved',
            prematchStrength: 'strong',
            marketAvailabilityBucket: 'totals_only',
            skippedReason: 'BTTS Yes shadow excluded: requires odds >= 2.05; actual odds=1.7.',
            policyWarnings: ['POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL'],
          },
        },
        {
          id: 20,
          timestamp: '2026-06-03T12:25:00.000Z',
          match_id: 'm-2',
          metadata: {
            matchDisplay: 'Home B vs Away B',
            canonicalMarket: 'over_1.5',
            selection: 'Over 1.5 Goals @2.00',
            minute: 79,
            minuteBand: '75+',
            score: '0-1',
            scoreState: 'one-goal-margin',
            odds: 2,
            confidence: 7,
            valuePercent: 7,
            valueBand: '6-7',
            riskLevel: 'MEDIUM',
            stakePercent: 2,
            watchSignalKey: 'none',
            watchSignalLabel: 'none',
            evidenceMode: 'full_live_data',
            marketResolutionStatus: 'resolved',
            prematchStrength: 'moderate',
            marketAvailabilityBucket: 'totals_only',
            skippedReason: 'Over 1.5 shadow excluded: requires minuteBand=60-74.',
            policyWarnings: ['OVER_1_5_BLOCKED_LATE_MIDGAME'],
          },
        },
      ],
    } as never);

    const report = await buildRuntimePolicyShadowSkippedReport({ lookbackDays: 30, maxRows: 500 });

    expect(String(mockQuery.mock.calls[0]?.[0])).toContain('PIPELINE_POLICY_SHADOW_SKIPPED');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([30, 500]);
    expect(report.totalEvents).toBe(2);
    expect(report.uniqueMatches).toBe(2);
    expect(report.byCanonicalMarket).toEqual([
      { key: 'btts_yes', count: 1, avgOdds: 1.7, minOdds: 1.7, maxOdds: 1.7 },
      { key: 'over_1.5', count: 1, avgOdds: 2, minOdds: 2, maxOdds: 2 },
    ]);
    expect(report.byMinuteBand).toEqual([
      { key: '60-74', count: 1, avgOdds: 1.7, minOdds: 1.7, maxOdds: 1.7 },
      { key: '75+', count: 1, avgOdds: 2, minOdds: 2, maxOdds: 2 },
    ]);
    expect(report.bySkippedReason[0]?.key).toContain('BTTS Yes shadow excluded');
    expect(report.byConfidenceBand).toEqual([
      { key: '6', count: 1, avgOdds: 1.7, minOdds: 1.7, maxOdds: 1.7 },
      { key: '7', count: 1, avgOdds: 2, minOdds: 2, maxOdds: 2 },
    ]);
    expect(report.byValueBand).toEqual([
      { key: '0-4', count: 1, avgOdds: 1.7, minOdds: 1.7, maxOdds: 1.7 },
      { key: '6-7', count: 1, avgOdds: 2, minOdds: 2, maxOdds: 2 },
    ]);
    expect(report.byRiskLevel).toEqual([
      { key: 'MEDIUM', count: 2, avgOdds: 1.85, minOdds: 1.7, maxOdds: 2 },
    ]);
    expect(report.byWatchSignal).toEqual([
      { key: 'none', count: 2, avgOdds: 1.85, minOdds: 1.7, maxOdds: 2 },
    ]);
    expect(report.byMarketResolutionStatus).toEqual([
      { key: 'resolved', count: 2, avgOdds: 1.85, minOdds: 1.7, maxOdds: 2 },
    ]);
    expect(report.recent[0]).toMatchObject({
      id: 21,
      matchId: 'm-1',
      canonicalMarket: 'btts_yes',
      selection: 'BTTS Yes @1.70',
      confidence: 6,
      valuePercent: 4,
      riskLevel: 'MEDIUM',
      stakePercent: 2,
      marketResolutionStatus: 'resolved',
      skippedReason: 'BTTS Yes shadow excluded: requires odds >= 2.05; actual odds=1.7.',
    });

    const markdown = formatRuntimePolicyShadowSkippedReportMarkdown(report);
    expect(markdown).toContain('# Runtime Policy Shadow Skipped Report');
    expect(markdown).toContain('Home A vs Away A');
    expect(markdown).toContain('BTTS Yes shadow excluded');
  });

  it('handles empty reports', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const report = await buildRuntimePolicyShadowSkippedReport({ lookbackDays: 14, maxRows: 1000 });

    expect(report.totalEvents).toBe(0);
    expect(report.byCanonicalMarket).toEqual([]);
    expect(formatRuntimePolicyShadowSkippedReportMarkdown(report)).toContain('| (none) | 0 |');
  });
});
