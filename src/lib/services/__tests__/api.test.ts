// ============================================================
// Tests — Frontend API Service (bets, snapshots, odds, AI perf)
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  fetchBets,
  fetchBetsByMatch,
  fetchBetStats,
  fetchBetStatsByMarket,
  createBet,
  fetchSnapshotsByMatch,
  fetchLatestSnapshot,
  fetchOddsHistory,
  fetchAiStats,
  fetchAiStatsByModel,
} from '@/lib/services/api';

const config = { apiUrl: 'http://localhost:4000' } as Parameters<typeof fetchBets>[0];

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('bets API', () => {
  test('fetchBets calls GET /api/bets', async () => {
    const data = [{ id: 1, match_id: '123' }];
    globalThis.fetch = mockFetch(data);

    const result = await fetchBets(config);

    expect(result).toEqual(data);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/bets',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('fetchBetsByMatch URL-encodes matchId', async () => {
    globalThis.fetch = mockFetch([]);
    await fetchBetsByMatch(config, '12345');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/bets/match/12345',
      expect.anything(),
    );
  });

  test('fetchBetStats returns stats object', async () => {
    const stats = { total: 10, won: 5, lost: 3, pending: 2, total_pnl: 1.5, roi: 15 };
    globalThis.fetch = mockFetch(stats);

    const result = await fetchBetStats(config);
    expect(result).toEqual(stats);
  });

  test('fetchBetStatsByMarket returns array', async () => {
    const data = [{ market: 'ou', total: 5, won: 3, lost: 1, pending: 1, total_pnl: 0.5, roi: 10 }];
    globalThis.fetch = mockFetch(data);

    const result = await fetchBetStatsByMarket(config);
    expect(result).toEqual(data);
  });

  test('createBet calls POST /api/bets', async () => {
    const bet = { recommendation_id: 1, match_id: '123', market: 'ou', selection: 'over', odds: 1.85, stake: 10, bookmaker: 'test' };
    globalThis.fetch = mockFetch({ id: 1, ...bet });

    const result = await createBet(config, bet);

    expect(result.id).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/bets',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('snapshots API', () => {
  test('fetchSnapshotsByMatch returns snapshot array', async () => {
    const snaps = [{ id: 1, match_id: '123', minute: 45 }];
    globalThis.fetch = mockFetch(snaps);

    const result = await fetchSnapshotsByMatch(config, '123');
    expect(result).toEqual(snaps);
  });

  test('fetchLatestSnapshot returns null when no snapshot', async () => {
    globalThis.fetch = mockFetch({ snapshot: null });

    const result = await fetchLatestSnapshot(config, '123');
    expect(result).toBeNull();
  });

  test('fetchLatestSnapshot returns snapshot when exists', async () => {
    const snap = { id: 1, match_id: '123', minute: 60 };
    globalThis.fetch = mockFetch(snap);

    const result = await fetchLatestSnapshot(config, '123');
    expect(result).toEqual(snap);
  });
});

describe('odds history API', () => {
  test('fetchOddsHistory without market filter', async () => {
    globalThis.fetch = mockFetch([]);
    await fetchOddsHistory(config, '123');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/odds/match/123',
      expect.anything(),
    );
  });

  test('fetchOddsHistory with market filter', async () => {
    globalThis.fetch = mockFetch([]);
    await fetchOddsHistory(config, '123', '1x2');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/odds/match/123?market=1x2',
      expect.anything(),
    );
  });
});

describe('AI performance API', () => {
  test('fetchAiStats returns accuracy stats', async () => {
    const stats = { total: 20, correct: 12, incorrect: 5, pending: 3, accuracy: 70.59 };
    globalThis.fetch = mockFetch(stats);

    const result = await fetchAiStats(config);
    expect(result).toEqual(stats);
  });

  test('fetchAiStatsByModel returns per-model stats', async () => {
    const data = [{ model: 'gemini', total: 10, correct: 7, accuracy: 70 }];
    globalThis.fetch = mockFetch(data);

    const result = await fetchAiStatsByModel(config);
    expect(result).toEqual(data);
  });
});

describe('error handling', () => {
  test('throws on non-ok response', async () => {
    globalThis.fetch = mockFetch('Not found', 404);

    await expect(fetchBets(config)).rejects.toThrow('HTTP 404');
  });
});
