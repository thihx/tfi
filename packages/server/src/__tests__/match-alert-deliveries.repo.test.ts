import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockGetNativePushDevicesByUserId = vi.fn();
const mockDeleteNativePushDeviceByToken = vi.fn();
const mockSendFcmNotification = vi.fn();

vi.mock('../db/pool.js', () => ({
  query: mockQuery,
}));

vi.mock('../lib/web-push.js', () => ({
  isWebPushConfigured: vi.fn().mockReturnValue(false),
  sendWebPushNotification: vi.fn(),
}));

vi.mock('../repos/native-push-devices.repo.js', () => ({
  getNativePushDevicesByUserId: mockGetNativePushDevicesByUserId,
  deleteNativePushDeviceByToken: mockDeleteNativePushDeviceByToken,
}));

vi.mock('../lib/native-push.js', () => ({
  sendFcmNotification: mockSendFcmNotification,
}));

vi.mock('../lib/twilio.js', () => ({
  sendSmsNotification: vi.fn(),
  sendVoiceNotification: vi.fn(),
}));

vi.mock('../lib/critical-fallback-policy.js', () => ({
  evaluateCriticalFallbackPolicy: vi.fn().mockResolvedValue({ allowed: true }),
}));

describe('match alert deliveries repo', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetNativePushDevicesByUserId.mockReset();
    mockDeleteNativePushDeviceByToken.mockReset();
    mockSendFcmNotification.mockReset();
    mockSendFcmNotification.mockResolvedValue({ ok: true });
  });

  it('enqueues stats-only live signals through a draft system rule', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 123 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const repo = await import('../repos/match-alert-deliveries.repo.js');

    const result = await repo.enqueueStatsOnlyLiveSignalDeliveries({
      matchId: '100',
      homeTeam: 'Home FC',
      awayTeam: 'Away FC',
      league: 'J1 League',
      status: '2H',
      minute: 62,
      score: '0-0',
      kickoffAtUtc: null,
      referenceMarketKeys: ['1x2', 'ou'],
      signal: {
        triggered: true,
        signalType: 'zero_zero_pressure_after_55',
        strength: 'medium',
        triggerKey: 'stats_only:zero_zero_pressure_after_55:100:0-0:60',
        summaryEn: 'Stats-only live signal.',
        summaryVi: 'Tin hieu stats-only.',
        suggestedAction: 'review_live_market',
        marketFamilyHint: 'goals_ou',
        reasons: ['score=0-0'],
      },
    });

    const sql = String(mockQuery.mock.calls[0]?.[0] ?? '');
    expect(result).toEqual({ enqueued: 1, deliveryIds: [123] });
    expect(sql).toContain('FROM user_watch_subscriptions s');
    expect(sql).toContain('COALESCE(settings.condition_alerts_enabled, TRUE) = TRUE');
    expect(sql).toContain("'stats_only_signal'");
    expect(sql).toContain("'draft'");
    expect(sql).toContain('ON CONFLICT (rule_id, trigger_key) DO NOTHING');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      '100',
      'stats_only:zero_zero_pressure_after_55:100:0-0:60',
    ]));
  });

  it('sends native push match alerts with the native_push channel contract', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          channel_id: 11,
          delivery_id: 123,
          user_id: 'user-1',
          match_id: '100',
          alert_kind: 'condition_signal',
          trigger_key: 'red_card:100:away:54',
          trigger_snapshot: {
            summaryVi: 'The away team received a red card.',
          },
          metadata: {
            matchDisplay: 'Home FC vs Away FC',
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ delivery_id: 123 }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGetNativePushDevicesByUserId.mockResolvedValueOnce([
      { provider: 'fcm', token: 'fcm-token' },
    ]);

    const repo = await import('../repos/match-alert-deliveries.repo.js');
    const result = await repo.deliverPendingNativePushMatchAlerts();

    expect(result).toEqual({ pending: 1, delivered: 1, failed: 0 });
    expect(mockSendFcmNotification).toHaveBeenCalledWith('fcm-token', expect.objectContaining({
      data: expect.objectContaining({
        channelType: 'native_push',
        matchId: '100',
        triggerKey: 'red_card:100:away:54',
      }),
    }));
  });
});

