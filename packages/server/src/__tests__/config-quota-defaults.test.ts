import { afterEach, describe, expect, test, vi } from 'vitest';

describe('provider quota protective defaults', () => {
  afterEach(() => {
    vi.doUnmock('dotenv');
    vi.doUnmock('node:fs');
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('does not let package env files override explicit test env values', async () => {
    const dotenvConfig = vi.fn();
    vi.doMock('dotenv', () => ({
      default: { config: dotenvConfig },
      config: dotenvConfig,
    }));
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
    }));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SPORTMONKS_API_TOKEN', 'test-token');
    vi.resetModules();

    const { config } = await import('../config.js');

    expect(config.sportmonksApiToken).toBe('test-token');
    expect(dotenvConfig).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringMatching(/packages[\\/]+server[\\/]+\.env\.local$/),
      override: false,
    }));
  });

  test('keeps public live board refresh enabled by default with a quota cap', async () => {
    vi.doMock('dotenv', () => ({
      default: { config: vi.fn() },
      config: vi.fn(),
    }));
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_MAX_PUBLIC_MATCHES', '');
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_PUBLIC_MS', '');
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_REALTIME_FIXTURE_MS', '');
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_BACKGROUND_FIXTURE_MS', '');
    vi.stubEnv('JOB_CHECK_LIVE_MS', '');
    vi.resetModules();

    const { config } = await import('../config.js');

    expect(config.jobRefreshLiveMatchesMs).toBe(3_000);
    expect(config.jobCheckMatchAlertsMs).toBe(3_000);
    expect(config.jobDeliverTelegramNotificationsMs).toBe(3_000);
    expect(config.jobRefreshLiveMatchesMaxPublicMatches).toBe(20);
    expect(config.jobRefreshLiveMatchesPublicMs).toBe(15_000);
    expect(config.jobRefreshLiveMatchesRealtimeFixtureMs).toBe(5_000);
    expect(config.jobRefreshLiveMatchesBackgroundFixtureMs).toBe(15_000);
    expect(config.jobCheckLiveMs).toBe(2 * 60_000);
  });

  test('still allows explicit public refresh overrides', async () => {
    vi.doMock('dotenv', () => ({
      default: { config: vi.fn() },
      config: vi.fn(),
    }));
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_MAX_PUBLIC_MATCHES', '3');
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_PUBLIC_MS', '5000');
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_REALTIME_FIXTURE_MS', '4000');
    vi.stubEnv('JOB_REFRESH_LIVE_MATCHES_BACKGROUND_FIXTURE_MS', '12000');
    vi.stubEnv('JOB_CHECK_LIVE_MS', '30000');
    vi.resetModules();

    const { config } = await import('../config.js');

    expect(config.jobRefreshLiveMatchesMaxPublicMatches).toBe(3);
    expect(config.jobRefreshLiveMatchesPublicMs).toBe(5_000);
    expect(config.jobRefreshLiveMatchesRealtimeFixtureMs).toBe(4_000);
    expect(config.jobRefreshLiveMatchesBackgroundFixtureMs).toBe(12_000);
    expect(config.jobCheckLiveMs).toBe(30_000);
  });
});
