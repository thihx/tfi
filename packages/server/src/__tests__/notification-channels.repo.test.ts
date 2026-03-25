import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import {
  getNotificationChannelConfigs,
  saveNotificationChannelConfig,
} from '../repos/notification-channels.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notification channels repository', () => {
  test('returns default configs for supported channels when no rows exist', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    const result = await getNotificationChannelConfigs('user-1');
    const webPush = result.find((row) => row.channelType === 'web_push');

    expect(result).toHaveLength(4);
    expect(result.map((row) => row.channelType)).toEqual(['telegram', 'zalo', 'web_push', 'email']);
    expect(result[0]?.metadata).toMatchObject({ senderImplemented: true });
    expect(webPush).toMatchObject({
      enabled: false,
      status: 'draft',
      address: null,
      metadata: {
        senderImplemented: true,
        setupState: 'requires_browser_subscription',
      },
    });
  });

  test('keeps web push in draft when enabled without an address', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'user-1',
          channel_type: 'web_push',
          enabled: true,
          status: 'draft',
          address: null,
          config: {},
          metadata: { senderImplemented: true, setupState: 'requires_browser_subscription' },
        }],
      } as never);

    const result = await saveNotificationChannelConfig('user-1', 'web_push', {
      enabled: true,
    });

    expect(result).toMatchObject({
      channelType: 'web_push',
      enabled: true,
      status: 'draft',
      address: null,
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO user_notification_channel_configs'),
      [
        'user-1',
        'web_push',
        true,
        'draft',
        null,
        JSON.stringify({}),
        JSON.stringify({ setupState: 'requires_browser_subscription', senderImplemented: true }),
      ],
    );
  });

  test('upserts a channel config and derives pending status when enabled with address', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'user-1',
          channel_type: 'email',
          enabled: true,
          status: 'pending',
          address: 'user@example.com',
          config: { format: 'html' },
          metadata: { senderImplemented: false },
        }],
      } as never);

    const result = await saveNotificationChannelConfig('user-1', 'email', {
      enabled: true,
      address: 'user@example.com',
      config: { format: 'html' },
    });

    expect(result.status).toBe('pending');
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO user_notification_channel_configs'),
      [
        'user-1',
        'email',
        true,
        'pending',
        'user@example.com',
        JSON.stringify({ format: 'html' }),
        JSON.stringify({ setupState: 'reserved', senderImplemented: false }),
      ],
    );
  });
});