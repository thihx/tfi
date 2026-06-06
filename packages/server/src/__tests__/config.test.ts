import { afterEach, describe, expect, test, vi } from 'vitest';

const originalLiveStatuses = process.env['LIVE_STATUSES'];

afterEach(() => {
  if (originalLiveStatuses == null) {
    delete process.env['LIVE_STATUSES'];
  } else {
    process.env['LIVE_STATUSES'] = originalLiveStatuses;
  }
  vi.resetModules();
});

describe('config defaults', () => {
  test('uses the full canonical live-status set by default', async () => {
    process.env['LIVE_STATUSES'] = '';
    vi.resetModules();

    const { config, DEFAULT_LIVE_STATUSES } = await import('../config.js');

    expect(config.liveStatuses).toEqual([...DEFAULT_LIVE_STATUSES]);
  });
});
