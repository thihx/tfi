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

  it('enqueues no-save live insights through a draft system rule', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 456 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const repo = await import('../repos/match-alert-deliveries.repo.js');

    const result = await repo.enqueueNoSaveLiveInsightDeliveries({
      matchId: '100',
      homeTeam: 'Home FC',
      awayTeam: 'Away FC',
      league: 'J1 League',
      status: '2H',
      minute: 63,
      score: '1-1',
      kickoffAtUtc: null,
      insightType: 'degraded_evidence',
      triggerKey: 'insight:degraded_evidence:100:1-1:60',
      summaryEn: 'No actionable bet: live evidence is incomplete.',
      summaryVi: 'Khong co keo actionable: du lieu live chua day du.',
      evidenceMode: 'odds_events_only_degraded',
      reasons: ['evidence_mode=odds_events_only_degraded', 'stats_available=false'],
      marketFamilyHint: 'goals_ou',
    });

    const sql = String(mockQuery.mock.calls[0]?.[0] ?? '');
    const params = mockQuery.mock.calls[0]?.[1] as unknown[];
    const triggerSnapshot = JSON.parse(String(params[2]));
    const metadata = JSON.parse(String(params[3]));

    expect(result).toEqual({ enqueued: 1, deliveryIds: [456] });
    expect(sql).toContain('FROM user_watch_subscriptions s');
    expect(sql).toContain("'live_insight'");
    expect(sql).toContain("'no-save-live-insight'");
    expect(sql).toContain('ON CONFLICT (rule_id, trigger_key) DO NOTHING');
    expect(params).toEqual(expect.arrayContaining([
      '100',
      'insight:degraded_evidence:100:1-1:60',
    ]));
    expect(triggerSnapshot).toEqual(expect.objectContaining({
      summaryEn: 'No actionable bet: live evidence is incomplete.',
      suggestedAction: 'avoid_chasing',
      facts: expect.objectContaining({
        insightType: 'degraded_evidence',
        evidenceMode: 'odds_events_only_degraded',
        noActionableBet: true,
        saveRecommendation: false,
      }),
    }));
    expect(metadata).toEqual(expect.objectContaining({
      notificationKind: 'match_insight',
      noActionableBet: true,
      saveRecommendation: false,
      signalContractVersion: 'no-save-live-insight-v1',
    }));
  });

  it('loads latest stats-only live signal deliveries for live trigger cooldown checks', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        match_id: '100',
        created_at: '2026-06-14T12:00:00.000Z',
        trigger_key: 'stats_only:pressure_no_lead:100:0-0:65',
        delivery_status: 'delivered',
      }],
    });

    const repo = await import('../repos/match-alert-deliveries.repo.js');
    const result = await repo.getLatestStatsOnlySignalDeliveriesByMatchIds(['100', '100', '  ', '200']);

    const sql = String(mockQuery.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('SELECT DISTINCT ON (match_id)');
    expect(sql).toContain("trigger_key LIKE 'stats_only:%'");
    expect(sql).toContain("metadata->>'signalContractVersion' = 'odds-first-stats-only-live-signal-v1'");
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([['100', '200']]);
    expect(result.get('100')).toEqual({
      matchId: '100',
      createdAt: '2026-06-14T12:00:00.000Z',
      triggerKey: 'stats_only:pressure_no_lead:100:0-0:65',
      deliveryStatus: 'delivered',
    });
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
        notificationKind: 'match_alert',
      }),
    }));
  });

  it('labels stats-only native push as a no-save match insight, not a bet recommendation', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          channel_id: 12,
          delivery_id: 124,
          user_id: 'user-1',
          match_id: '100',
          alert_kind: 'condition_signal',
          trigger_key: 'stats_only:pressure_no_lead:100:0-0:65',
          trigger_snapshot: {
            summaryEn: 'Home pressure is building, but no live odds are available.',
            facts: {
              noActionableOdds: true,
            },
          },
          metadata: {
            matchDisplay: 'Home FC vs Away FC',
            noActionableOdds: true,
            signalContractVersion: 'odds-first-stats-only-live-signal-v1',
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ delivery_id: 124 }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGetNativePushDevicesByUserId.mockResolvedValueOnce([
      { provider: 'fcm', token: 'fcm-token' },
    ]);

    const repo = await import('../repos/match-alert-deliveries.repo.js');
    const result = await repo.deliverPendingNativePushMatchAlerts();

    expect(result).toEqual({ pending: 1, delivered: 1, failed: 0 });
    expect(mockSendFcmNotification).toHaveBeenCalledWith('fcm-token', expect.objectContaining({
      title: 'TFI MATCH INSIGHT',
      body: expect.stringContaining('No live odds available - stats-only insight.'),
      data: expect.objectContaining({
        channelType: 'native_push',
        matchId: '100',
        triggerKey: 'stats_only:pressure_no_lead:100:0-0:65',
        notificationKind: 'stats_only_insight',
        actionableBet: 'false',
        saveRecommendation: 'false',
        evidenceMode: 'stats_only',
      }),
    }));
  });

  it('labels degraded-evidence native push as a no-save match insight, not a bet recommendation', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          channel_id: 13,
          delivery_id: 125,
          user_id: 'user-1',
          match_id: '100',
          alert_kind: 'condition_signal',
          trigger_key: 'insight:degraded_evidence:100:1-1:60',
          trigger_snapshot: {
            summaryEn: 'No actionable bet: live evidence is incomplete.',
            facts: {
              noActionableBet: true,
            },
          },
          metadata: {
            matchDisplay: 'Home FC vs Away FC',
            notificationKind: 'match_insight',
            insightType: 'degraded_evidence',
            evidenceMode: 'odds_events_only_degraded',
            noActionableBet: true,
            saveRecommendation: false,
            signalContractVersion: 'no-save-live-insight-v1',
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ delivery_id: 125 }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGetNativePushDevicesByUserId.mockResolvedValueOnce([
      { provider: 'fcm', token: 'fcm-token' },
    ]);

    const repo = await import('../repos/match-alert-deliveries.repo.js');
    const result = await repo.deliverPendingNativePushMatchAlerts();

    expect(result).toEqual({ pending: 1, delivered: 1, failed: 0 });
    expect(mockSendFcmNotification).toHaveBeenCalledWith('fcm-token', expect.objectContaining({
      title: 'TFI MATCH INSIGHT',
      body: expect.stringContaining('No actionable bet - limited live evidence.'),
      data: expect.objectContaining({
        channelType: 'native_push',
        matchId: '100',
        triggerKey: 'insight:degraded_evidence:100:1-1:60',
        notificationKind: 'match_insight',
        actionableBet: 'false',
        saveRecommendation: 'false',
        evidenceMode: 'odds_events_only_degraded',
        insightType: 'degraded_evidence',
      }),
    }));
  });
});

