// ============================================================
// Unit tests — Update Predictions Job
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({
    hget: vi.fn(),
    hset: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([
    { match_id: '100', status: 'NS' },
    { match_id: '200', status: '1H' },
    { match_id: '300', status: 'NS' },
  ]),
}));

const mockWatchlist = [
  { match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea', prediction: null },
  { match_id: '200', home_team: 'Liverpool', away_team: 'Man City', prediction: null },
  { match_id: '300', home_team: 'Barca', away_team: 'Real', prediction: null },
];

vi.mock('../repos/watchlist.repo.js', () => ({
  getActiveOperationalWatchlist: vi.fn().mockResolvedValue(mockWatchlist),
  updateOperationalWatchlistEntry: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/provider-insight-cache.js', () => ({
  ensureFixturePrediction: vi.fn().mockImplementation((matchId: string) => {
    if (matchId === '100') {
      return Promise.resolve({ payload: { predictions: { winner: { name: 'Arsenal' } } } });
    }
    if (matchId === '300') {
      return Promise.resolve({ payload: null });
    }
    return Promise.resolve({ payload: null });
  }),
}));

vi.mock('../lib/football-api.js', () => ({
  buildSlimPrediction: vi.fn().mockReturnValue({ winner: 'Arsenal', advice: 'Home win' }),
}));

const { updatePredictionsJob, setForcePredictionRefresh } = await import('../jobs/update-predictions.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updatePredictionsJob', () => {
  test('processes only NS matches in the watchlist', async () => {
    const result = await updatePredictionsJob();
    // match 100 = NS, match 200 = 1H (skip), match 300 = NS
    expect(result.checked).toBe(2);
  });

  test('updates prediction when API returns data', async () => {
    const result = await updatePredictionsJob();
    expect(result.updated).toBe(1); // only match 100 has prediction

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({ prediction: { winner: 'Arsenal', advice: 'Home win' } }),
    );
  });

  test('clears prediction when API returns null', async () => {
    await updatePredictionsJob();
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '300',
      expect.objectContaining({ prediction: null }),
    );
  });

  test('returns 0 checked when watchlist is empty', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([]);

    const result = await updatePredictionsJob();
    expect(result).toEqual({ checked: 0, updated: 0 });
  });

  test('handles API errors gracefully per match', async () => {
    const providerInsight = await import('../lib/provider-insight-cache.js');
    vi.mocked(providerInsight.ensureFixturePrediction).mockRejectedValue(new Error('API limit'));

    const result = await updatePredictionsJob();
    expect(result.checked).toBe(2);
    expect(result.updated).toBe(0); // all failed
  });

  test('reports progress for each match', async () => {
    await updatePredictionsJob();
    const { reportJobProgress } = await import('../jobs/job-progress.js');
    // At least load step + 2 predict steps (for 2 NS entries)
    expect(reportJobProgress).toHaveBeenCalledWith('update-predictions', 'load', expect.any(String), 5);
    expect(reportJobProgress).toHaveBeenCalledWith(
      'update-predictions', 'predict',
      expect.stringContaining('Arsenal vs Chelsea'),
      expect.any(Number),
    );
  });

  test('skips NS entries that already have cached prediction data', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      { match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea', prediction: { predictions: { advice: 'Home win' } } },
      { match_id: '300', home_team: 'Barca', away_team: 'Real', prediction: null },
    ] as never);

    const footballApi = await import('../lib/football-api.js');
    const providerInsight = await import('../lib/provider-insight-cache.js');
    const result = await updatePredictionsJob();

    expect(result.checked).toBe(1);
    expect(vi.mocked(providerInsight.ensureFixturePrediction)).not.toHaveBeenCalledWith('100', expect.anything());
    expect(vi.mocked(providerInsight.ensureFixturePrediction)).toHaveBeenCalledWith('300', expect.objectContaining({ status: 'NS' }));
    expect(footballApi.buildSlimPrediction).toHaveBeenCalledTimes(0);
  });

  test('force mode refreshes cached prediction rows', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      { match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea', prediction: { predictions: { advice: 'Home win' } } },
    ] as never);

    const providerInsight = await import('../lib/provider-insight-cache.js');
    setForcePredictionRefresh();
    const result = await updatePredictionsJob();

    expect(result.checked).toBe(1);
    expect(vi.mocked(providerInsight.ensureFixturePrediction)).toHaveBeenCalledWith('100', expect.objectContaining({ status: 'NS' }));
  });
});
