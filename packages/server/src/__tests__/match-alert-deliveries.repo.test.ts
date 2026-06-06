import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db/pool.js', () => ({
  query: mockQuery,
}));

vi.mock('../lib/web-push.js', () => ({
  isWebPushConfigured: vi.fn().mockReturnValue(false),
  sendWebPushNotification: vi.fn(),
}));

describe('match alert deliveries repo', () => {
  beforeEach(() => {
    mockQuery.mockReset();
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
});

