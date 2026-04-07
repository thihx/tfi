import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import {
  createProviderOddsSample,
  getProviderOddsSamplesByMatch,
} from '../repos/provider-odds-samples.repo.js';
import {
  createProviderStatsSample,
  getProviderStatsSamplesByMatch,
} from '../repos/provider-stats-samples.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('provider sample repositories', () => {
  test('createProviderStatsSample persists raw and normalized payloads', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: 1, match_id: '100' }],
    } as never);

    await createProviderStatsSample({
      match_id: '100',
      match_minute: 62,
      provider: 'api-football',
      consumer: 'server-pipeline',
      success: true,
      raw_payload: { statistics: [] },
      normalized_payload: { possession: { home: '55%', away: '45%' } },
      coverage_flags: { has_possession: true },
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO provider_stats_samples'),
      expect.arrayContaining([
        '100',
        62,
        '',
        'api-football',
        'server-pipeline',
        true,
      ]),
    );
  });

  test('createProviderOddsSample persists provider/source/usable flags', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: 2, match_id: '100' }],
    } as never);

    await createProviderOddsSample({
      match_id: '100',
      match_minute: 62,
      provider: 'api-football',
      source: 'pre-match',
      consumer: 'proxy-route',
      success: true,
      usable: false,
      error: 'NO_EXACT_EVENT_MATCH',
      raw_payload: { matched_event: null },
      normalized_payload: [],
      coverage_flags: { bookmaker_count: 0 },
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO provider_odds_samples'),
      expect.arrayContaining([
        '100',
        62,
        '',
        'api-football',
        'pre-match',
        'proxy-route',
        true,
        false,
      ]),
    );
  });

  test('getProviderStatsSamplesByMatch queries latest samples first', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    await getProviderStatsSamplesByMatch('100', 25);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM provider_stats_samples'),
      ['100', 25],
    );
  });

  test('getProviderOddsSamplesByMatch queries latest samples first', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    await getProviderOddsSamplesByMatch('100', 25);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM provider_odds_samples'),
      ['100', 25],
    );
  });
});
