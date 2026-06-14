import { beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../db/pool.js';
import {
  getProviderFixtureMapping,
  upsertProviderFixtureMapping,
} from '../repos/provider-fixture-mappings.repo.js';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

const mockQuery = vi.mocked(query);

describe('provider-fixture-mappings.repo', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns null when a provider mapping does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await getProviderFixtureMapping('100', 'sportmonks');

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM provider_fixture_mappings'), ['100', 'sportmonks']);
  });

  it('returns the first provider mapping row', async () => {
    const row = {
      id: '1',
      match_id: '100',
      provider: 'sportmonks',
      provider_fixture_id: '19427456',
      confidence: 'high',
      mapping_method: 'date_team_match',
      evidence: { score: 95 },
      first_seen_at: '2026-06-12T00:00:00.000Z',
      last_seen_at: '2026-06-12T00:00:00.000Z',
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    await expect(getProviderFixtureMapping('100', 'sportmonks')).resolves.toEqual(row);
  });

  it('upserts mapping evidence as JSON', async () => {
    const row = {
      id: '1',
      match_id: '100',
      provider: 'sportmonks',
      provider_fixture_id: '19427456',
      confidence: 'high',
      mapping_method: 'date_team_match',
      evidence: { reasons: ['home_name_match'] },
      first_seen_at: '2026-06-12T00:00:00.000Z',
      last_seen_at: '2026-06-12T00:00:00.000Z',
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    const result = await upsertProviderFixtureMapping({
      match_id: '100',
      provider: 'sportmonks',
      provider_fixture_id: '19427456',
      confidence: 'high',
      mapping_method: 'date_team_match',
      evidence: { reasons: ['home_name_match'] },
    });

    expect(result).toEqual(row);
    expect(String(mockQuery.mock.calls[0]?.[0])).toContain('ON CONFLICT (match_id, provider)');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([
      '100',
      'sportmonks',
      '19427456',
      'high',
      'date_team_match',
      JSON.stringify({ reasons: ['home_name_match'] }),
    ]);
  });
});
