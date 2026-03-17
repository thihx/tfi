// ============================================================
// Unit tests — Job Progress (Redis-backed progress tracking)
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Build a mock Redis client for all operations
const mockRedis = {
  hget: vi.fn(),
  hset: vi.fn(),
  hgetall: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
};

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => mockRedis,
}));

const { reportJobProgress, completeJobProgress, clearJobProgress, getJobProgress } = await import(
  '../jobs/job-progress.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reportJobProgress', () => {
  test('creates progress hash with startedAt on first call', async () => {
    mockRedis.hget.mockResolvedValue(null); // no existing startedAt
    await reportJobProgress('fetch-matches', 'api', 'Fetching fixtures...', 15);

    expect(mockRedis.hset).toHaveBeenCalledWith(
      'job:progress:fetch-matches',
      expect.objectContaining({ step: 'api', message: 'Fetching fixtures...', percent: '15' }),
    );
    // Should include startedAt since it was the first call
    const data = mockRedis.hset.mock.calls[0]![1] as Record<string, string>;
    expect(data.startedAt).toBeDefined();
    expect(mockRedis.expire).toHaveBeenCalledWith('job:progress:fetch-matches', 600);
  });

  test('preserves existing startedAt on subsequent calls', async () => {
    mockRedis.hget.mockResolvedValue('2026-03-17T10:00:00Z'); // existing
    await reportJobProgress('fetch-matches', 'filter', 'Filtering...', 40);

    const data = mockRedis.hset.mock.calls[0]![1] as Record<string, string>;
    expect(data.startedAt).toBeUndefined();
  });

  test('clamps percent between 0 and 100', async () => {
    mockRedis.hget.mockResolvedValue('exists');

    await reportJobProgress('test-job', 'step', 'msg', 150);
    let data = mockRedis.hset.mock.calls[0]![1] as Record<string, string>;
    expect(data.percent).toBe('100');

    await reportJobProgress('test-job', 'step', 'msg', -10);
    data = mockRedis.hset.mock.calls[1]![1] as Record<string, string>;
    expect(data.percent).toBe('0');
  });

  test('silently ignores Redis errors', async () => {
    mockRedis.hget.mockRejectedValue(new Error('Redis down'));
    await expect(reportJobProgress('j', 's', 'm', 50)).resolves.toBeUndefined();
  });
});

describe('completeJobProgress', () => {
  test('sets completion fields', async () => {
    await completeJobProgress('fetch-matches', { saved: 10, leagues: 5 }, null);

    expect(mockRedis.hset).toHaveBeenCalledWith(
      'job:progress:fetch-matches',
      expect.objectContaining({
        percent: '100',
        step: 'done',
        message: 'Completed',
        error: '',
      }),
    );
    const data = mockRedis.hset.mock.calls[0]![1] as Record<string, string>;
    expect(JSON.parse(data.result!)).toEqual({ saved: 10, leagues: 5 });
    expect(data.completedAt).toBeDefined();
    expect(mockRedis.expire).toHaveBeenCalledWith('job:progress:fetch-matches', 300);
  });

  test('sets error message on failure', async () => {
    await completeJobProgress('fetch-matches', null, 'API timeout');

    const data = mockRedis.hset.mock.calls[0]![1] as Record<string, string>;
    expect(data.error).toBe('API timeout');
    expect(data.message).toBe('Failed: API timeout');
  });

  test('silently ignores Redis errors', async () => {
    mockRedis.hset.mockRejectedValue(new Error('Redis down'));
    await expect(completeJobProgress('j', null, null)).resolves.toBeUndefined();
  });
});

describe('clearJobProgress', () => {
  test('deletes progress key', async () => {
    await clearJobProgress('fetch-matches');
    expect(mockRedis.del).toHaveBeenCalledWith('job:progress:fetch-matches');
  });

  test('silently ignores Redis errors', async () => {
    mockRedis.del.mockRejectedValue(new Error('Redis down'));
    await expect(clearJobProgress('j')).resolves.toBeUndefined();
  });
});

describe('getJobProgress', () => {
  test('returns parsed progress when data exists', async () => {
    mockRedis.hgetall.mockResolvedValue({
      step: 'api',
      message: 'Fetching fixtures...',
      percent: '15',
      startedAt: '2026-03-17T10:00:00Z',
      completedAt: '',
      result: '',
      error: '',
    });

    const progress = await getJobProgress('fetch-matches');
    expect(progress).toEqual({
      step: 'api',
      message: 'Fetching fixtures...',
      percent: 15,
      startedAt: '2026-03-17T10:00:00Z',
      completedAt: null,
      result: null,
      error: null,
    });
  });

  test('returns null when no data exists', async () => {
    mockRedis.hgetall.mockResolvedValue({});
    const progress = await getJobProgress('non-existent');
    expect(progress).toBeNull();
  });

  test('returns null when startedAt is missing', async () => {
    mockRedis.hgetall.mockResolvedValue({ step: 'x' });
    const progress = await getJobProgress('test');
    expect(progress).toBeNull();
  });

  test('returns null on Redis error', async () => {
    mockRedis.hgetall.mockRejectedValue(new Error('Redis down'));
    const progress = await getJobProgress('test');
    expect(progress).toBeNull();
  });
});
