import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/pool.js';
import {
  buildRuntimePolicyShadowSettlementReport,
  formatRuntimePolicyShadowSettlementMarkdown,
} from '../runtime-policy-shadow-settlement-report.js';

const mockQuery = vi.mocked(query);

describe('runtime policy shadow settlement report', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('settles shadow candidates by deterministic rules and calculates P/L', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          timestamp: '2026-06-03T12:00:00.000Z',
          audit_match_id: null,
          metadata: {
            matchId: 'm-1',
            matchDisplay: 'Home A vs Away A',
            leagueId: 39,
            leagueName: 'Premier League',
            leagueSegmentKey: 'league:39',
            homeTeamId: 1,
            homeTeamName: 'Home A',
            homeTeamSegmentKey: 'team:1',
            awayTeamId: 2,
            awayTeamName: 'Away A',
            awayTeamSegmentKey: 'team:2',
            teamSegmentKeys: ['team:1', 'team:2'],
            matchSegmentKey: 'match:m-1',
            selection: 'Under 4.5 Goals @2.05',
            betMarket: 'under_4.5',
            canonicalMarket: 'under_4.5',
            minute: 82,
            minuteBand: '75+',
            score: '3-1',
            odds: 2.05,
            matchedPockets: [{ id: 'late_under_45_two_plus', stakeCapPercent: 1 }],
          },
          history_match_id: 'm-1',
          final_status: 'FT',
          home_score: 3,
          away_score: 1,
          regular_home_score: null,
          regular_away_score: null,
          halftime_home: null,
          halftime_away: null,
          settlement_stats: [],
        },
        {
          id: 10,
          timestamp: '2026-06-03T11:55:00.000Z',
          audit_match_id: 'm-2',
          metadata: {
            matchDisplay: 'Home B vs Away B',
            leagueId: 39,
            leagueName: 'Premier League',
            leagueSegmentKey: 'league:39',
            homeTeamId: 3,
            homeTeamName: 'Home B',
            homeTeamSegmentKey: 'team:3',
            awayTeamId: 4,
            awayTeamName: 'Away B',
            awayTeamSegmentKey: 'team:4',
            teamSegmentKeys: ['team:3', 'team:4'],
            matchSegmentKey: 'match:m-2',
            selection: 'BTTS Yes @2.20',
            betMarket: 'btts_yes',
            canonicalMarket: 'btts_yes',
            minute: 70,
            minuteBand: '60-74',
            score: '3-1',
            odds: 2.2,
            matchedPockets: [{ id: 'btts_yes_60_74_two_plus', stakeCapPercent: 1 }],
          },
          history_match_id: 'm-2',
          final_status: 'FT',
          home_score: 2,
          away_score: 0,
          regular_home_score: null,
          regular_away_score: null,
          halftime_home: null,
          halftime_away: null,
          settlement_stats: [],
        },
        {
          id: 9,
          timestamp: '2026-06-03T11:50:00.000Z',
          audit_match_id: null,
          metadata: {
            matchId: 'm-3',
            matchDisplay: 'Home C vs Away C',
            leagueId: 140,
            leagueName: 'La Liga',
            leagueSegmentKey: 'league:140',
            homeTeamId: 5,
            homeTeamName: 'Home C',
            homeTeamSegmentKey: 'team:5',
            awayTeamId: 6,
            awayTeamName: 'Away C',
            awayTeamSegmentKey: 'team:6',
            teamSegmentKeys: ['team:5', 'team:6'],
            matchSegmentKey: 'match:m-3',
            selection: 'Over 1.5 Goals @1.55',
            betMarket: 'over_1.5',
            canonicalMarket: 'over_1.5',
            minute: 65,
            minuteBand: '60-74',
            score: '1-0',
            odds: 1.55,
            matchedPockets: [{ id: 'over_15_60_74_one_goal', stakeCapPercent: 1 }],
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

    const report = await buildRuntimePolicyShadowSettlementReport({ lookbackDays: 30, maxRows: 500 });

    expect(mockQuery.mock.calls[0]?.[1]).toEqual([30, 500]);
    expect(report.totalEvents).toBe(3);
    expect(report.totalPocketRows).toBe(3);
    expect(report.settledRows).toBe(2);
    expect(report.unresolvedRows).toBe(1);
    expect(report.wins).toBe(1);
    expect(report.losses).toBe(1);
    expect(report.totalStakedPercent).toBe(2);
    expect(report.totalPnlPercent).toBe(0.05);
    expect(report.roiOnStaked).toBe(0.025);
    expect(report.rows.map((row) => [row.pocketId, row.status, row.result, row.pnlPercent])).toEqual([
      ['late_under_45_two_plus', 'settled_rules', 'win', 1.05],
      ['btts_yes_60_74_two_plus', 'settled_rules', 'loss', -1],
      ['over_15_60_74_one_goal', 'missing_match_history', null, null],
    ]);
    expect(report.byPocket).toContainEqual({
      key: 'late_under_45_two_plus',
      total: 1,
      settled: 1,
      wins: 1,
      losses: 0,
      pushLike: 0,
      totalStakedPercent: 1,
      totalPnlPercent: 1.05,
      roiOnStaked: 1.05,
    });
    expect(report.byLeagueSegment).toContainEqual({
      key: 'league:39',
      total: 2,
      settled: 2,
      wins: 1,
      losses: 1,
      pushLike: 0,
      totalStakedPercent: 2,
      totalPnlPercent: 0.05,
      roiOnStaked: 0.025,
    });
    expect(report.byTeamSegment).toContainEqual({
      key: 'team:1',
      total: 1,
      settled: 1,
      wins: 1,
      losses: 0,
      pushLike: 0,
      totalStakedPercent: 1,
      totalPnlPercent: 1.05,
      roiOnStaked: 1.05,
    });
    expect(report.rows[0]).toMatchObject({
      leagueSegmentKey: 'league:39',
      teamSegmentKeys: ['team:1', 'team:2'],
    });

    const markdown = formatRuntimePolicyShadowSettlementMarkdown(report);
    expect(markdown).toContain('# Runtime Policy Shadow Settlement Report');
    expect(markdown).toContain('| late_under_45_two_plus | 1 | 1 | 1 | 0 | 0 | 1 | 1.05 | 1.05 |');
    expect(markdown).toContain('| league:39 | 2 | 2 | 1 | 1 | 0 | 2 | 0.05 | 0.025 |');
    expect(markdown).toContain('team:1, team:2');
    expect(markdown).toContain('missing_match_history');
  });

  it('handles empty settlement reports', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const report = await buildRuntimePolicyShadowSettlementReport({ lookbackDays: 30, maxRows: 1000 });

    expect(report.totalEvents).toBe(0);
    expect(report.byPocket).toEqual([]);
    expect(formatRuntimePolicyShadowSettlementMarkdown(report)).toContain('| (none) | 0 | 0 | 0 |');
  });
});
