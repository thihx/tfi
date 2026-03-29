import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import { archiveFinishedMatches, getHistoricalMatchesByDate } from '../repos/matches-history.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('matches history repository', () => {
  test('archives canonical kickoff_at_utc with finished match rows', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1 } as never);

    await archiveFinishedMatches([{
      match_id: '123',
      date: '2026-03-25',
      kickoff: '15:00',
      kickoff_at_utc: '2026-03-25T06:00:00.000Z',
      league_id: 39,
      league_name: 'Premier League',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      venue: 'Emirates',
      final_status: 'FT',
      home_score: 2,
      away_score: 1,
      regular_home_score: 2,
      regular_away_score: 1,
      result_provider: 'api-football',
      settlement_stats: [],
      settlement_stats_provider: '',
    }]);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    const params = vi.mocked(query).mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain('kickoff_at_utc');
    expect(sql).toContain('COALESCE(EXCLUDED.kickoff_at_utc, matches_history.kickoff_at_utc)');
    expect(params).toContain('2026-03-25T06:00:00.000Z');
  });

  test('includes settlement_stats_fetched_at in upsert and uses COALESCE to preserve existing value', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1 } as never);

    await archiveFinishedMatches([{
      match_id: '999',
      date: '2026-03-25',
      kickoff: '20:00',
      kickoff_at_utc: '2026-03-25T11:00:00.000Z',
      league_id: 39,
      league_name: 'Premier League',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      venue: 'Emirates',
      final_status: 'FT',
      home_score: 1,
      away_score: 0,
      result_provider: 'api-football',
      settlement_stats: [],
      settlement_stats_provider: '',
      settlement_stats_fetched_at: '2026-03-25T12:30:00.000Z',
    }]);

    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    const params = vi.mocked(query).mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain('settlement_stats_fetched_at');
    expect(sql).toContain('COALESCE(EXCLUDED.settlement_stats_fetched_at, matches_history.settlement_stats_fetched_at)');
    expect(params).toContain('2026-03-25T12:30:00.000Z');
  });

  test('passes null for settlement_stats_fetched_at when not provided', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1 } as never);

    await archiveFinishedMatches([{
      match_id: '998',
      date: '2026-03-25',
      kickoff: '20:00',
      league_id: 39,
      league_name: 'Premier League',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      venue: 'Emirates',
      final_status: 'FT',
      home_score: 1,
      away_score: 0,
      result_provider: 'api-football',
      settlement_stats: [],
      settlement_stats_provider: '',
      // settlement_stats_fetched_at not provided → null → COALESCE preserves DB value
    }]);

    const params = vi.mocked(query).mock.calls[0]?.[1] as unknown[];
    // 18th param (index 17) for the single row is settlement_stats_fetched_at
    expect(params[17]).toBeNull();
  });

  test('orders historical date queries by canonical kickoff instant first', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    await getHistoricalMatchesByDate('2026-03-01', '2026-03-31');

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain('ORDER BY kickoff_at_utc NULLS LAST, date, kickoff');
  });
});