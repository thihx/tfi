import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/pool.js';
import {
  buildRuntimePolicyShadowReport,
  formatRuntimePolicyShadowReportMarkdown,
} from '../runtime-policy-shadow-report.js';

const mockQuery = vi.mocked(query);

describe('runtime policy shadow report', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('aggregates shadow candidates by pocket and context buckets', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          timestamp: '2026-06-03T12:00:00.000Z',
          match_id: null,
          metadata: {
            matchId: 'm-1',
            matchDisplay: 'Home A vs Away A',
            canonicalMarket: 'under_4.5',
            minute: 82,
            minuteBand: '75+',
            score: '3-1',
            scoreState: 'two-plus-margin',
            odds: 2.05,
            confidence: 7,
            valuePercent: 8,
            valueBand: '8+',
            riskLevel: 'MEDIUM',
            stakePercent: 3,
            watchSignalKey: 'none',
            watchSignalLabel: 'none',
            evidenceMode: 'full_live_data',
            marketResolutionStatus: 'resolved',
            prematchStrength: 'moderate',
            marketAvailabilityBucket: 'totals_only',
            policyWarnings: ['POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL'],
            matchedPockets: [{ id: 'late_under_45_two_plus' }],
          },
        },
        {
          id: 10,
          timestamp: '2026-06-03T11:55:00.000Z',
          match_id: 'm-2',
          metadata: {
            matchDisplay: 'Home B vs Away B',
            canonicalMarket: 'btts_yes',
            minute: 70,
            minuteBand: '60-74',
            score: '3-1',
            scoreState: 'two-plus-margin',
            odds: 2.2,
            confidence: 8,
            valuePercent: 6,
            valueBand: '6-7',
            riskLevel: 'MEDIUM',
            stakePercent: 2,
            watchSignalKey: 'btts_yes_medium_edge_6_7_odds_2_plus',
            watchSignalLabel: 'BTTS Yes MEDIUM edge 6-7 odds>=2.0',
            evidenceMode: 'full_live_data',
            marketResolutionStatus: 'resolved',
            prematchStrength: 'strong',
            marketAvailabilityBucket: 'totals_only',
            policyWarnings: ['LATE_MIDGAME_INSUFFICIENT_CONFIDENCE'],
            matchedPockets: [{ id: 'btts_yes_60_74_two_plus' }],
          },
        },
      ],
    } as never);

    const report = await buildRuntimePolicyShadowReport({ lookbackDays: 30, maxRows: 500 });

    expect(mockQuery.mock.calls[0]?.[1]).toEqual([30, 500]);
    expect(report.totalEvents).toBe(2);
    expect(report.totalPocketMatches).toBe(2);
    expect(report.uniqueMatches).toBe(2);
    expect(report.byPocket).toEqual([
      { key: 'btts_yes_60_74_two_plus', count: 1, avgOdds: 2.2, minOdds: 2.2, maxOdds: 2.2 },
      { key: 'late_under_45_two_plus', count: 1, avgOdds: 2.05, minOdds: 2.05, maxOdds: 2.05 },
    ]);
    expect(report.byMarketAvailabilityBucket).toEqual([
      { key: 'totals_only', count: 2, avgOdds: 2.125, minOdds: 2.05, maxOdds: 2.2 },
    ]);
    expect(report.byConfidenceBand).toEqual([
      { key: '7', count: 1, avgOdds: 2.05, minOdds: 2.05, maxOdds: 2.05 },
      { key: '8+', count: 1, avgOdds: 2.2, minOdds: 2.2, maxOdds: 2.2 },
    ]);
    expect(report.byValueBand).toEqual([
      { key: '6-7', count: 1, avgOdds: 2.2, minOdds: 2.2, maxOdds: 2.2 },
      { key: '8+', count: 1, avgOdds: 2.05, minOdds: 2.05, maxOdds: 2.05 },
    ]);
    expect(report.byRiskLevel).toEqual([
      { key: 'MEDIUM', count: 2, avgOdds: 2.125, minOdds: 2.05, maxOdds: 2.2 },
    ]);
    expect(report.byWatchSignal).toEqual([
      {
        key: 'btts_yes_medium_edge_6_7_odds_2_plus',
        count: 1,
        avgOdds: 2.2,
        minOdds: 2.2,
        maxOdds: 2.2,
      },
      { key: 'none', count: 1, avgOdds: 2.05, minOdds: 2.05, maxOdds: 2.05 },
    ]);
    expect(report.byMarketResolutionStatus).toEqual([
      { key: 'resolved', count: 2, avgOdds: 2.125, minOdds: 2.05, maxOdds: 2.2 },
    ]);
    expect(report.recent[0]).toMatchObject({
      id: 11,
      matchId: 'm-1',
      pocketIds: ['late_under_45_two_plus'],
      canonicalMarket: 'under_4.5',
      minuteBand: '75+',
      confidence: 7,
      valuePercent: 8,
      riskLevel: 'MEDIUM',
      stakePercent: 3,
      marketResolutionStatus: 'resolved',
    });

    const markdown = formatRuntimePolicyShadowReportMarkdown(report);
    expect(markdown).toContain('# Runtime Policy Shadow Report');
    expect(markdown).toContain('| btts_yes_60_74_two_plus | 1 | 2.2 | 2.2 | 2.2 |');
    expect(markdown).toContain('| btts_yes_medium_edge_6_7_odds_2_plus | 1 | 2.2 | 2.2 | 2.2 |');
    expect(markdown).toContain('Home A vs Away A');
  });

  it('handles empty reports', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const report = await buildRuntimePolicyShadowReport({ lookbackDays: 14, maxRows: 1000 });

    expect(report.totalEvents).toBe(0);
    expect(report.byPocket).toEqual([]);
    expect(formatRuntimePolicyShadowReportMarkdown(report)).toContain('| (none) | 0 |');
  });
});
