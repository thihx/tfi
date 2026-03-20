import { beforeEach, describe, expect, test, vi } from 'vitest';

const { clientQuery } = vi.hoisted(() => ({
  clientQuery: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(async (cb: (client: { query: typeof clientQuery }) => Promise<unknown>) => cb({ query: clientQuery })),
}));

import { query } from '../db/pool.js';
import {
  bulkCreateRecommendations,
  createRecommendation,
} from '../repos/recommendations.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recommendations repository prompt versioning', () => {
  test('createRecommendation inserts prompt_version', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: 1, prompt_version: 'v4-evidence-hardened' }],
    } as never);

    await createRecommendation({
      match_id: '100',
      selection: 'Over 2.5 Goals @1.85',
      bet_market: 'over_2.5',
      prompt_version: 'v4-evidence-hardened',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('prompt_version'),
      expect.arrayContaining(['v4-evidence-hardened']),
    );
  });

  test('bulkCreateRecommendations inserts prompt_version', async () => {
    clientQuery.mockResolvedValueOnce({ rowCount: 1 } as never);

    await bulkCreateRecommendations([
      {
        match_id: '100',
        selection: 'Over 2.5 Goals @1.85',
        bet_market: 'over_2.5',
        prompt_version: 'v4-evidence-hardened',
      },
    ]);

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('prompt_version'),
      expect.arrayContaining(['v4-evidence-hardened']),
    );
  });
});
