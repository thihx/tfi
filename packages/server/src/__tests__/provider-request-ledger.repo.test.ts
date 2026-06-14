import { beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../db/pool.js';
import {
  recordProviderRequest,
  recordProviderRequestSafe,
} from '../repos/provider-request-ledger.repo.js';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

const mockQuery = vi.mocked(query);

describe('provider-request-ledger.repo', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('records provider request metadata with defaults and error truncation', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never);
    const longError = 'x'.repeat(1100);

    await recordProviderRequest({
      provider: 'sportmonks',
      endpoint: '/fixtures/1',
      params: { include: 'participants' },
      attempt: 1,
      success: false,
      rateLimited: true,
      statusCode: 429,
      latencyMs: 123,
      resultCount: 0,
      quotaCurrent: 0,
      quotaLimit: 2500,
      error: longError,
      responseMeta: { requestedEntity: 'Fixture' },
    });

    expect(String(mockQuery.mock.calls[0]?.[0])).toContain('INSERT INTO provider_request_ledger');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([
      'sportmonks',
      null,
      null,
      '/fixtures/1',
      JSON.stringify({ include: 'participants' }),
      1,
      false,
      true,
      429,
      123,
      0,
      0,
      2500,
      longError.slice(0, 1000),
      JSON.stringify({ requestedEntity: 'Fixture' }),
    ]);
  });

  it('uses safe recorder to swallow ledger write failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error('db unavailable') as never);

    await expect(recordProviderRequestSafe({
      provider: 'sportmonks',
      endpoint: '/livescores',
      attempt: 1,
      success: true,
    })).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      '[provider-request-ledger] Failed to record request:',
      'db unavailable',
    );
    warnSpy.mockRestore();
  });
});
