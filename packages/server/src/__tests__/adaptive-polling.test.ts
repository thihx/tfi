// ============================================================
// Tests — Adaptive Polling (computeNextPollDelayMs + skip logic)
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { computeNextPollDelayMs, ADAPTIVE_SKIP_KEY } from '../jobs/fetch-matches.job.js';
import type { MatchScheduleState } from '../repos/matches.repo.js';

// ── Pure function tests ──────────────────────────────────────

describe('computeNextPollDelayMs', () => {
  const BASE = 60_000; // 1 minute
  const MIN = 60_000;

  const state = (overrides: Partial<MatchScheduleState>): MatchScheduleState => ({
    liveCount: 0,
    nsCount: 0,
    minsToNextKickoff: null,
    ...overrides,
  });

  test('returns base interval when there are live matches', () => {
    expect(computeNextPollDelayMs(state({ liveCount: 3, minsToNextKickoff: 0 }), BASE)).toBe(BASE);
    expect(computeNextPollDelayMs(state({ liveCount: 1, minsToNextKickoff: null }), BASE)).toBe(BASE);
  });

  test('returns 30 min when no matches at all', () => {
    expect(computeNextPollDelayMs(state({ minsToNextKickoff: null }), BASE)).toBe(30 * MIN);
  });

  test('returns base interval when kickoff is within 5 minutes', () => {
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 0 }), BASE)).toBe(BASE);
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 5 }), BASE)).toBe(BASE);
  });

  test('returns 2 min when kickoff is between 5 and 120 minutes away', () => {
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 6 }), BASE)).toBe(2 * MIN);
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 30 }), BASE)).toBe(2 * MIN);
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 119 }), BASE)).toBe(2 * MIN);
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 120 }), BASE)).toBe(2 * MIN);
  });

  test('returns 5 min when kickoff is between 2 and 6 hours away', () => {
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 121 }), BASE)).toBe(5 * MIN);
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 360 }), BASE)).toBe(5 * MIN);
  });

  test('returns 30 min when kickoff is more than 6 hours away', () => {
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 361 }), BASE)).toBe(30 * MIN);
    expect(computeNextPollDelayMs(state({ nsCount: 1, minsToNextKickoff: 600 }), BASE)).toBe(30 * MIN);
  });

  test('live matches take priority over upcoming kickoff time', () => {
    // Even if there is a future kickoff, if liveCount > 0 → base interval
    expect(computeNextPollDelayMs(state({ liveCount: 2, nsCount: 1, minsToNextKickoff: 400 }), BASE)).toBe(BASE);
  });

  test('respects custom base interval', () => {
    const customBase = 2 * MIN;
    expect(computeNextPollDelayMs(state({ liveCount: 1 }), customBase)).toBe(customBase);
    expect(computeNextPollDelayMs(state({ minsToNextKickoff: null }), customBase)).toBe(30 * MIN);
  });
});

// ── Skip logic integration tests ────────────────────────────

const mockRedis = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  hget: vi.fn(), hset: vi.fn(), expire: vi.fn(),
};

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => mockRedis,
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
  completeJobProgress: vi.fn(),
  clearJobProgress: vi.fn(),
}));

vi.mock('../repos/leagues.repo.js', () => ({
  getActiveLeagues: vi.fn().mockResolvedValue([{ league_id: 39 }]),
  getTopLeagues: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([]),
  replaceAllMatches: vi.fn().mockResolvedValue(0),
  getMatchScheduleState: vi.fn().mockResolvedValue({ liveCount: 0, nsCount: 0, minsToNextKickoff: null }),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  getExistingWatchlistMatchIds: vi.fn().mockResolvedValue(new Set()),
  syncWatchlistDates: vi.fn().mockResolvedValue(0),
}));

vi.mock('../repos/matches-history.repo.js', () => ({
  archiveFinishedMatches: vi.fn().mockResolvedValue(0),
  getHistoricalMatchesBatch: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
  }),
}));

vi.mock('../lib/football-api.js', () => ({
  fetchFixturesForDate: vi.fn().mockResolvedValue([]),
  fetchFixtureStatistics: vi.fn().mockResolvedValue([]),
}));

vi.mock('../config.js', () => ({
  config: {
    timezone: 'Asia/Seoul',
    jobFetchMatchesMs: 60_000,
    pipelineEnabled: false,
  },
}));

const { fetchMatchesJob } = await import('../jobs/fetch-matches.job.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue('OK');
});

describe('fetchMatchesJob adaptive skip', () => {
  test('runs normally when no skip key exists', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await fetchMatchesJob();
    expect(result).toMatchObject({ saved: 0, leagues: 0 });
    // Should have called the football API
    const footballApi = await import('../lib/football-api.js');
    expect(footballApi.fetchFixturesForDate).toHaveBeenCalled();
  });

  test('skips when next-run-at is in the future', async () => {
    mockRedis.get.mockResolvedValue(String(Date.now() + 5 * 60_000)); // 5 min from now
    const result = await fetchMatchesJob();
    expect(result).toEqual({ saved: 0, leagues: 0 });
    const footballApi = await import('../lib/football-api.js');
    expect(footballApi.fetchFixturesForDate).not.toHaveBeenCalled();
  });

  test('runs when next-run-at has already passed', async () => {
    mockRedis.get.mockResolvedValue(String(Date.now() - 1000)); // 1 sec ago
    const result = await fetchMatchesJob();
    const footballApi = await import('../lib/football-api.js');
    expect(footballApi.fetchFixturesForDate).toHaveBeenCalled();
    expect(result).toMatchObject({ saved: 0, leagues: 0 });
  });

  test('proceeds normally when Redis is unavailable (get throws)', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis connection refused'));
    const result = await fetchMatchesJob();
    const footballApi = await import('../lib/football-api.js');
    expect(footballApi.fetchFixturesForDate).toHaveBeenCalled();
    expect(result).toMatchObject({ saved: 0, leagues: 0 });
  });

  test('sets skip key after successful fetch — no matches → 30 min delay', async () => {
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getMatchScheduleState).mockResolvedValue({
      liveCount: 0, nsCount: 0, minsToNextKickoff: null,
    });

    await fetchMatchesJob();

    expect(mockRedis.set).toHaveBeenCalledWith(
      ADAPTIVE_SKIP_KEY,
      expect.stringMatching(/^\d+$/),
      'PX',
      expect.any(Number),
    );
    // The stored value should be ~30 min from now
    const [, storedValue, , ttl] = mockRedis.set.mock.calls.at(-1) as [string, string, string, number];
    const delay = Number(storedValue) - Date.now();
    expect(delay).toBeGreaterThan(29 * 60_000);
    expect(delay).toBeLessThan(31 * 60_000);
    expect(ttl).toBeGreaterThan(29 * 60_000);
  });

  test('sets skip key after fetch — live matches → base interval (1 min)', async () => {
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getMatchScheduleState).mockResolvedValue({
      liveCount: 2, nsCount: 0, minsToNextKickoff: null,
    });

    await fetchMatchesJob();

    const [, storedValue] = mockRedis.set.mock.calls.at(-1) as [string, string, string, number];
    const delay = Number(storedValue) - Date.now();
    expect(delay).toBeLessThanOrEqual(60_000 + 500); // ~1 min
    expect(delay).toBeGreaterThan(59_000);
  });

  test('sets skip key after fetch — kickoff in 60 min → 2 min delay', async () => {
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getMatchScheduleState).mockResolvedValue({
      liveCount: 0, nsCount: 1, minsToNextKickoff: 60,
    });

    await fetchMatchesJob();

    const [, storedValue] = mockRedis.set.mock.calls.at(-1) as [string, string, string, number];
    const delay = Number(storedValue) - Date.now();
    expect(delay).toBeGreaterThan(1.9 * 60_000);
    expect(delay).toBeLessThan(2.1 * 60_000);
  });

  test('sets 30-min skip key when no active leagues', async () => {
    const leagueRepo = await import('../repos/leagues.repo.js');
    vi.mocked(leagueRepo.getActiveLeagues).mockResolvedValueOnce([]);

    await fetchMatchesJob();

    const footballApi = await import('../lib/football-api.js');
    expect(footballApi.fetchFixturesForDate).not.toHaveBeenCalled();

    expect(mockRedis.set).toHaveBeenCalledWith(
      ADAPTIVE_SKIP_KEY,
      expect.stringMatching(/^\d+$/),
      'PX',
      expect.any(Number),
    );
    const [, storedValue] = mockRedis.set.mock.calls[0] as [string, string, string, number];
    const delay = Number(storedValue) - Date.now();
    expect(delay).toBeGreaterThan(29 * 60_000);
  });

  test('does not crash when set skip key fails (Redis write error)', async () => {
    mockRedis.set.mockRejectedValueOnce(new Error('Redis write failed'));
    // Should not throw
    await expect(fetchMatchesJob()).resolves.toMatchObject({ saved: 0, leagues: 0 });
  });
});

describe('ADAPTIVE_SKIP_KEY export', () => {
  test('is a non-empty string', () => {
    expect(typeof ADAPTIVE_SKIP_KEY).toBe('string');
    expect(ADAPTIVE_SKIP_KEY.length).toBeGreaterThan(0);
  });
});
