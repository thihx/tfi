import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/pool.js';
import {
  buildRuntimePolicyShadowSkippedSettlementReport,
  formatRuntimePolicyShadowSkippedSettlementMarkdown,
} from '../runtime-policy-shadow-skipped-settlement-report.js';

const mockQuery = vi.mocked(query);

describe('runtime policy shadow skipped settlement report', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('settles skipped neighbor selections and calculates counterfactual P/L', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 21,
          timestamp: '2026-06-03T12:30:00.000Z',
          audit_match_id: null,
          metadata: {
            matchId: 'm-1',
            matchDisplay: 'Home A vs Away A',
            selection: 'BTTS Yes @1.70',
            betMarket: 'btts_yes',
            canonicalMarket: 'btts_yes',
            skippedReason: 'BTTS Yes shadow excluded: requires odds >= 2.05; actual odds=1.7.',
            minute: 61,
            minuteBand: '60-74',
            score: '0-2',
            odds: 1.7,
          },
          history_match_id: 'm-1',
          final_status: 'FT',
          home_score: 1,
          away_score: 2,
          regular_home_score: null,
          regular_away_score: null,
          halftime_home: null,
          halftime_away: null,
          settlement_stats: [],
        },
        {
          id: 20,
          timestamp: '2026-06-03T12:25:00.000Z',
          audit_match_id: 'm-2',
          metadata: {
            matchDisplay: 'Home B vs Away B',
            selection: 'Over 1.5 Goals @2.00',
            betMarket: 'over_1.5',
            canonicalMarket: 'over_1.5',
            skippedReason: 'Over 1.5 shadow excluded: requires minuteBand=60-74.',
            minute: 79,
            minuteBand: '75+',
            score: '0-1',
            odds: 2,
          },
          history_match_id: 'm-2',
          final_status: 'FT',
          home_score: 1,
          away_score: 0,
          regular_home_score: null,
          regular_away_score: null,
          halftime_home: null,
          halftime_away: null,
          settlement_stats: [],
        },
        {
          id: 19,
          timestamp: '2026-06-03T12:20:00.000Z',
          audit_match_id: null,
          metadata: {
            matchId: 'm-3',
            matchDisplay: 'Home C vs Away C',
            selection: 'Under 2.5 Goals @1.85',
            betMarket: 'under_2.5',
            canonicalMarket: 'under_2.5',
            skippedReason: 'Goals Under excluded: strict late-under pocket only covers under_4.5.',
            minute: 80,
            minuteBand: '75+',
            score: '1-1',
            odds: 1.85,
          },
          history_match_id: null,
          final_status: null,
          home_score: null,
          away_score: null,
          regular_home_score: null,
          regular_away_score: null,
          halftime_home: null,
          halftime_away: null,
          settlement_stats: [],
        },
      ],
    } as never);

    const report = await buildRuntimePolicyShadowSkippedSettlementReport({
      lookbackDays: 30,
      maxRows: 500,
      stakePercent: 1,
    });

    expect(String(mockQuery.mock.calls[0]?.[0])).toContain('PIPELINE_POLICY_SHADOW_SKIPPED');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([30, 500]);
    expect(report.totalEvents).toBe(3);
    expect(report.stakePercent).toBe(1);
    expect(report.settledRows).toBe(2);
    expect(report.unresolvedRows).toBe(1);
    expect(report.wins).toBe(1);
    expect(report.losses).toBe(1);
    expect(report.totalStakedPercent).toBe(2);
    expect(report.totalPnlPercent).toBe(-0.3);
    expect(report.roiOnStaked).toBe(-0.15);
    expect(report.rows.map((row) => [row.canonicalMarket, row.status, row.result, row.pnlPercent])).toEqual([
      ['btts_yes', 'settled_rules', 'win', 0.7],
      ['over_1.5', 'settled_rules', 'loss', -1],
      ['under_2.5', 'missing_match_history', null, null],
    ]);
    expect(report.byCanonicalMarket).toContainEqual({
      key: 'btts_yes',
      total: 1,
      settled: 1,
      wins: 1,
      losses: 0,
      pushLike: 0,
      totalStakedPercent: 1,
      totalPnlPercent: 0.7,
      roiOnStaked: 0.7,
    });

    const markdown = formatRuntimePolicyShadowSkippedSettlementMarkdown(report);
    expect(markdown).toContain('# Runtime Policy Shadow Skipped Settlement Report');
    expect(markdown).toContain('| btts_yes | 1 | 1 | 1 | 0 | 0 | 1 | 0.7 | 0.7 |');
    expect(markdown).toContain('missing_match_history');
  });

  it('handles empty skipped settlement reports', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const report = await buildRuntimePolicyShadowSkippedSettlementReport({
      lookbackDays: 30,
      maxRows: 1000,
      stakePercent: 1,
    });

    expect(report.totalEvents).toBe(0);
    expect(report.byCanonicalMarket).toEqual([]);
    expect(formatRuntimePolicyShadowSkippedSettlementMarkdown(report)).toContain('| (none) | 0 | 0 | 0 |');
  });
});
