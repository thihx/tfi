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

  test('orders historical date queries by canonical kickoff instant first', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    await getHistoricalMatchesByDate('2026-03-01', '2026-03-31');

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain('ORDER BY kickoff_at_utc NULLS LAST, date, kickoff');
  });
});