// ============================================================
// Proxy Service — Context Fetch Tests (Phase 3)
// ============================================================

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchMatchRecommendations, fetchMatchSnapshots } from '../services/proxy.service';

const appConfig = { apiUrl: 'http://localhost:4000', defaultMode: 'L' };

describe('fetchMatchRecommendations', () => {
  const _originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = _originalFetch;
  });

  test('returns mapped recommendations on success', async () => {
    const mockRows = [
      {
        minute: 55,
        selection: 'Over 2.5 @1.90',
        bet_market: 'over_2.5',
        confidence: 7,
        odds: 1.90,
        reasoning: 'Good chances',
        result: '',
        timestamp: '2026-03-17T10:00:00Z',
      },
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRows),
    });

    const result = await fetchMatchRecommendations(appConfig, '12345');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      minute: 55,
      selection: 'Over 2.5 @1.90',
      bet_market: 'over_2.5',
      confidence: 7,
      odds: 1.90,
      reasoning: 'Good chances',
      result: '',
      timestamp: '2026-03-17T10:00:00Z',
    });
  });

  test('returns max 5 recommendations', async () => {
    const mockRows = Array.from({ length: 10 }, (_, i) => ({
      minute: i * 5,
      selection: `Selection ${i}`,
      bet_market: 'over_2.5',
      confidence: 7,
      odds: 1.85,
      reasoning: 'test',
      result: '',
      timestamp: '2026-03-17T10:00:00Z',
    }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRows),
    });

    const result = await fetchMatchRecommendations(appConfig, '12345');
    expect(result).toHaveLength(5);
  });

  test('returns empty array on HTTP error', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await fetchMatchRecommendations(appConfig, '12345');
    expect(result).toEqual([]);
  });

  test('calls correct URL with encoded matchId', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await fetchMatchRecommendations(appConfig, '12345');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/recommendations/match/12345',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });
});

describe('fetchMatchSnapshots', () => {
  const _originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = _originalFetch;
  });

  test('returns mapped snapshots on success', async () => {
    const mockRows = [
      {
        minute: 15,
        home_score: 0,
        away_score: 0,
        stats: { possession: '55-45', shots: '3-1', shots_on_target: '1-0', corners: '2-1' },
        status: '1H',
      },
      {
        minute: 30,
        home_score: 1,
        away_score: 0,
        stats: { possession: '60-40', shots: '6-3', shots_on_target: '3-1', corners: '4-2' },
        status: '1H',
      },
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRows),
    });

    const result = await fetchMatchSnapshots(appConfig, '12345');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      minute: 15,
      score: '0-0',
      possession: '55-45',
      shots: '3-1',
      shots_on_target: '1-0',
      corners: '2-1',
      status: '1H',
    });
    expect(result[1]!.score).toBe('1-0');
  });

  test('returns max 10 latest snapshots', async () => {
    const mockRows = Array.from({ length: 15 }, (_, i) => ({
      minute: i * 5,
      home_score: 0,
      away_score: 0,
      stats: { possession: '50-50', shots: '0-0', shots_on_target: '0-0', corners: '0-0' },
      status: '1H',
    }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRows),
    });

    const result = await fetchMatchSnapshots(appConfig, '12345');
    expect(result).toHaveLength(10);
    // Should be the last 10 (minutes 25-70)
    expect(result[0]!.minute).toBe(25);
  });

  test('returns empty array on HTTP error', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await fetchMatchSnapshots(appConfig, '12345');
    expect(result).toEqual([]);
  });

  test('handles null stats gracefully', async () => {
    const mockRows = [
      {
        minute: 15,
        home_score: 0,
        away_score: 0,
        stats: null,
        status: '1H',
      },
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRows),
    });

    const result = await fetchMatchSnapshots(appConfig, '12345');
    expect(result[0]!.possession).toBe('-');
    expect(result[0]!.shots).toBe('-');
  });
});
