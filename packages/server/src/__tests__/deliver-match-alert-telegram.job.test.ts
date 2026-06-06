import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingTelegramMatchAlertRow } from '../repos/match-alert-deliveries.repo.js';

const mockSendTelegramMessage = vi.fn();
const mockGetPendingTelegramMatchAlertDeliveries = vi.fn();
const mockMarkMatchAlertChannelDelivered = vi.fn();
const mockMarkMatchAlertChannelFailed = vi.fn();

vi.mock('../config.js', () => ({
  config: {
    telegramBotToken: 'test-token',
    timezone: 'Asia/Seoul',
  },
}));

vi.mock('../lib/telegram.js', () => ({
  sendTelegramMessage: mockSendTelegramMessage,
}));

vi.mock('../repos/match-alert-deliveries.repo.js', () => ({
  getPendingTelegramMatchAlertDeliveries: mockGetPendingTelegramMatchAlertDeliveries,
  markMatchAlertChannelDelivered: mockMarkMatchAlertChannelDelivered,
  markMatchAlertChannelFailed: mockMarkMatchAlertChannelFailed,
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn().mockResolvedValue(undefined),
}));

function row(overrides: Partial<PendingTelegramMatchAlertRow>): PendingTelegramMatchAlertRow {
  return {
    channelId: 1,
    deliveryId: 10,
    userId: 'user-1',
    chatId: 'chat-1',
    notificationLanguage: 'vi',
    matchId: '100',
    alertKind: 'match_start',
    triggerKey: 'match_start:100',
    triggerSnapshot: {
      summaryVi: 'Match started.',
      suggestedAction: 'open_match',
    },
    metadata: {
      matchDisplay: 'Home FC vs Away FC',
      league: 'J1 League',
      status: '1H',
      minute: 1,
      score: '0-0',
      kickoffAtUtc: '2026-06-06T05:00:00.000Z',
    },
    createdAt: '2026-06-06T05:00:05.000Z',
    ...overrides,
  };
}

describe('deliver match alert telegram job', () => {
  beforeEach(() => {
    mockSendTelegramMessage.mockReset().mockResolvedValue(undefined);
    mockGetPendingTelegramMatchAlertDeliveries.mockReset();
    mockMarkMatchAlertChannelDelivered.mockReset().mockResolvedValue(undefined);
    mockMarkMatchAlertChannelFailed.mockReset().mockResolvedValue(undefined);
  });

  it('groups same-user kickoff alerts at the same kickoff time into one Telegram message', async () => {
    mockGetPendingTelegramMatchAlertDeliveries.mockResolvedValue([
      row({ channelId: 1, deliveryId: 10, matchId: '100', triggerKey: 'match_start:100' }),
      row({
        channelId: 2,
        deliveryId: 11,
        matchId: '200',
        triggerKey: 'match_start:200',
        metadata: {
          matchDisplay: 'Third FC vs Fourth FC',
          league: 'J1 League',
          status: '1H',
          minute: 1,
          score: '0-0',
          kickoffAtUtc: '2026-06-06T05:00:00.000Z',
        },
      }),
    ]);

    const { deliverMatchAlertTelegramJob } = await import('../jobs/deliver-match-alert-telegram.job.js');
    const result = await deliverMatchAlertTelegramJob();

    expect(result).toEqual({ pending: 2, delivered: 2, failed: 0 });
    expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTelegramMessage.mock.calls[0]?.[1]).toContain('Home FC vs Away FC');
    expect(mockSendTelegramMessage.mock.calls[0]?.[1]).toContain('Third FC vs Fourth FC');
    expect(mockMarkMatchAlertChannelDelivered).toHaveBeenCalledWith(1);
    expect(mockMarkMatchAlertChannelDelivered).toHaveBeenCalledWith(2);
  });

  it('keeps condition alerts as individual Telegram messages', async () => {
    mockGetPendingTelegramMatchAlertDeliveries.mockResolvedValue([
      row({ channelId: 1, alertKind: 'condition_signal', triggerKey: 'red_card:100:home:30' }),
      row({ channelId: 2, alertKind: 'condition_signal', triggerKey: 'red_card:200:away:30', matchId: '200' }),
    ]);

    const { deliverMatchAlertTelegramJob } = await import('../jobs/deliver-match-alert-telegram.job.js');
    const result = await deliverMatchAlertTelegramJob();

    expect(result).toEqual({ pending: 2, delivered: 2, failed: 0 });
    expect(mockSendTelegramMessage).toHaveBeenCalledTimes(2);
  });
});
