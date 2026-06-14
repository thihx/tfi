import { beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../db/pool.js';
import {
  createProviderEventSample,
  createProviderFixtureSample,
} from '../repos/provider-fixture-samples.repo.js';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

const mockQuery = vi.mocked(query);

describe('provider-fixture-samples.repo', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('creates a fixture sample with defaults and JSON payloads', async () => {
    const row = { id: 1, provider_fixture_id: '19427456' };
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    const result = await createProviderFixtureSample({
      provider_fixture_id: '19427456',
      provider: 'sportmonks',
      success: true,
      raw_payload: { data: [{ id: 1 }] },
      normalized_payload: { providerFixtureId: '19427456' },
      coverage_flags: { has_fixture: true },
    });

    expect(result).toEqual(row);
    expect(String(mockQuery.mock.calls[0]?.[0])).toContain('INSERT INTO provider_fixture_samples');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([
      null,
      '19427456',
      'sportmonks',
      'unknown',
      true,
      null,
      null,
      '',
      JSON.stringify({ data: [{ id: 1 }] }),
      JSON.stringify({ providerFixtureId: '19427456' }),
      JSON.stringify({ has_fixture: true }),
    ]);
  });

  it('creates an event sample with match context and defaults', async () => {
    const row = { id: 2, provider_fixture_id: '19427456' };
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    const result = await createProviderEventSample({
      match_id: '100',
      provider_fixture_id: '19427456',
      match_minute: 65,
      provider: 'sportmonks',
      consumer: 'shadow',
      success: false,
      error: 'no access',
    });

    expect(result).toEqual(row);
    expect(String(mockQuery.mock.calls[0]?.[0])).toContain('INSERT INTO provider_event_samples');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([
      '100',
      '19427456',
      65,
      '',
      'sportmonks',
      'shadow',
      false,
      null,
      null,
      'no access',
      JSON.stringify({}),
      JSON.stringify({}),
      JSON.stringify({}),
    ]);
  });
});
