import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockQuery = vi.fn();
const mockTransaction = vi.fn();

vi.mock('../config.js', () => ({
  config: {
    timezone: 'Asia/Seoul',
    liveStatuses: ['1H', '2H'],
    legacyWatchlistStaleDays: 7,
  },
}));

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  transaction: (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) => mockTransaction(fn),
}));

const { previewLegacyWatchlistCleanup, applyLegacyWatchlistCleanup } = await import('../lib/legacy-watchlist-cleanup.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (fn) => fn({ query: mockQuery }));
});

describe('legacy-watchlist-cleanup', () => {
  test('preview merges legacy and monitored-only candidates without duplicates', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          match_id: '100',
          source: 'legacy_watchlist',
          reason: 'finished_match',
          match_status: 'FT',
          kickoff_at_utc: '2026-05-10T12:00:00.000Z',
          home_team: 'A',
          away_team: 'B',
          added_by: 'legacy',
          has_subscription: false,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          match_id: '100',
          source: 'monitored_only',
          reason: 'finished_match',
          match_status: 'FT',
          kickoff_at_utc: '2026-05-10T12:00:00.000Z',
          home_team: 'A',
          away_team: 'B',
          added_by: 'top-league-auto',
          has_subscription: false,
        }, {
          match_id: '200',
          source: 'monitored_only',
          reason: 'kickoff_stale',
          match_status: 'NS',
          kickoff_at_utc: '2026-05-01T12:00:00.000Z',
          home_team: 'C',
          away_team: 'D',
          added_by: 'top-league-auto',
          has_subscription: false,
        }],
      });

    const preview = await previewLegacyWatchlistCleanup(7);
    expect(preview.protectedBySubscription).toBe(1);
    expect(preview.candidates).toHaveLength(2);
    expect(preview.summary.legacyWatchlistRows).toBe(1);
    expect(preview.summary.monitoredOnlyRows).toBe(1);
  });

  test('apply deletes legacy and monitored rows inside a transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({
        rows: [{
          match_id: '100',
          source: 'legacy_watchlist',
          reason: 'finished_match',
          match_status: 'FT',
          kickoff_at_utc: null,
          home_team: null,
          away_team: null,
          added_by: null,
          has_subscription: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await applyLegacyWatchlistCleanup(7);
    expect(result).toEqual({
      deletedLegacyWatchlistRows: 1,
      deletedMonitoredMatches: 1,
      matchIds: ['100'],
    });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
