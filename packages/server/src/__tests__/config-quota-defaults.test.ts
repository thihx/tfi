import { afterEach, describe, expect, test, vi } from 'vitest';

describe('provider quota protective defaults', () => {
  afterEach(() => {
    vi.doUnmock('dotenv');
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('does not opt into public refresh by default while keeping interested matches realtime', async () => {
    vi.doMock('dotenv', () => ({
      default: { config: vi.fn() },
      config: vi.fn(),
    }));
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_MAX_PUBLIC_MATCHES', '');
    vi.stubEnv('JOB_CHECK_LIVE_MS', '');
    vi.resetModules();

    const { config } = await import('../config.js');

    expect(config.jobRefreshLiveMatchesMs).toBe(3_000);
    expect(config.jobCheckMatchAlertsMs).toBe(3_000);
    expect(config.jobDeliverTelegramNotificationsMs).toBe(3_000);
    expect(config.jobRefreshLiveMatchesMaxPublicMatches).toBe(0);
    expect(config.jobCheckLiveMs).toBe(2 * 60_000);
  });

  test('still allows an explicit public refresh cap when the operator opts in', async () => {
    vi.doMock('dotenv', () => ({
      default: { config: vi.fn() },
      config: vi.fn(),
    }));
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_MAX_PUBLIC_MATCHES', '3');
    vi.stubEnv('JOB_CHECK_LIVE_MS', '30000');
    vi.resetModules();

    const { config } = await import('../config.js');

    expect(config.jobRefreshLiveMatchesMaxPublicMatches).toBe(3);
    expect(config.jobCheckLiveMs).toBe(30_000);
  });
});
