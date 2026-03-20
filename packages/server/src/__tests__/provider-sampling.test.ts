import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    providerSamplingEnabled: true,
  },
}));

vi.mock('../repos/provider-odds-samples.repo.js', () => ({
  createProviderOddsSample: vi.fn(),
}));

vi.mock('../repos/provider-stats-samples.repo.js', () => ({
  createProviderStatsSample: vi.fn(),
}));

const { recordProviderOddsSampleSafe, recordProviderStatsSampleSafe, extractStatusCode } = await import('../lib/provider-sampling.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('provider-sampling helpers', () => {
  test('extractStatusCode parses numeric HTTP status from error text', () => {
    expect(extractStatusCode(new Error('Football API 429: Too Many Requests'))).toBe(429);
    expect(extractStatusCode('The Odds API 500')).toBe(500);
    expect(extractStatusCode('plain error')).toBeNull();
  });

  test('recordProviderOddsSampleSafe swallows persistence failures', async () => {
    const repo = await import('../repos/provider-odds-samples.repo.js');
    vi.mocked(repo.createProviderOddsSample).mockRejectedValueOnce(new Error('db unavailable'));

    await expect(recordProviderOddsSampleSafe({
      match_id: '100',
      provider: 'api-football',
      source: 'live',
      success: false,
      usable: false,
    })).resolves.toBeUndefined();
  });

  test('recordProviderStatsSampleSafe swallows persistence failures', async () => {
    const repo = await import('../repos/provider-stats-samples.repo.js');
    vi.mocked(repo.createProviderStatsSample).mockRejectedValueOnce(new Error('db unavailable'));

    await expect(recordProviderStatsSampleSafe({
      match_id: '100',
      provider: 'api-football',
      success: false,
    })).resolves.toBeUndefined();
  });
});
