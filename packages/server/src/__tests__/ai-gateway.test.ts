import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
  listAiGatewayAdminRecipients: vi.fn(async () => []),
  getSubscriptionsByUserId: vi.fn(async () => []),
  deleteSubscription: vi.fn(async () => undefined),
  updateLastUsed: vi.fn(async () => undefined),
  sendTelegramMessage: vi.fn(async () => undefined),
  sendWebPushNotification: vi.fn(async () => ({ ok: true as const })),
  isWebPushConfigured: vi.fn(() => false),
}));

import {
  createAiGatewayIncident,
  evaluateAiGatewayRequest,
  estimateAiGatewayTokens,
} from '../lib/ai-gateway.js';

vi.mock('../db/pool.js', () => ({
  query: mocks.query,
}));

vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
}));

vi.mock('../repos/ai-gateway.repo.js', () => ({
  listAiGatewayAdminRecipients: mocks.listAiGatewayAdminRecipients,
}));

vi.mock('../repos/push-subscriptions.repo.js', () => ({
  getSubscriptionsByUserId: mocks.getSubscriptionsByUserId,
  deleteSubscription: mocks.deleteSubscription,
  updateLastUsed: mocks.updateLastUsed,
}));

vi.mock('../lib/telegram.js', () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

vi.mock('../lib/web-push.js', () => ({
  isWebPushConfigured: mocks.isWebPushConfigured,
  sendWebPushNotification: mocks.sendWebPushNotification,
}));

describe('ai gateway', () => {
  afterEach(() => {
    delete process.env['AI_GATEWAY_MODE'];
    delete process.env['AI_GATEWAY_DISABLED_FEATURES'];
    delete process.env['AI_GATEWAY_MAX_INPUT_TOKENS'];
    delete process.env['AI_GATEWAY_ALERTS_ENABLED'];
    delete process.env['AI_GATEWAY_LOOP_CALL_THRESHOLD'];
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.listAiGatewayAdminRecipients.mockResolvedValue([]);
    mocks.getSubscriptionsByUserId.mockResolvedValue([]);
    mocks.isWebPushConfigured.mockReturnValue(false);
    mocks.sendWebPushNotification.mockResolvedValue({ ok: true });
  });

  test('estimates tokens without storing raw prompt text', () => {
    expect(estimateAiGatewayTokens('12345678')).toBe(2);
    expect(estimateAiGatewayTokens('   ')).toBe(0);
  });

  test('kill switch blocks even in observe mode', async () => {
    process.env['AI_GATEWAY_MODE'] = 'observe';
    process.env['AI_GATEWAY_DISABLED_FEATURES'] = 'tfi.live_recommendation';

    const result = await evaluateAiGatewayRequest('short prompt', {
      model: 'gemini-3.5-flash',
      operation: 'tfi.live_recommendation',
      featureKey: 'tfi.live_recommendation',
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('block');
    expect(result.reason).toBe('kill_switch');
  });

  test('token threshold observes by default and blocks in enforce mode', async () => {
    process.env['AI_GATEWAY_MAX_INPUT_TOKENS'] = '1';

    const observe = await evaluateAiGatewayRequest('123456789', {
      model: 'gemini-3.5-flash',
      operation: 'tfi.manual_match_analysis',
      featureKey: 'tfi.ai_observation',
    });

    process.env['AI_GATEWAY_MODE'] = 'enforce';
    const enforce = await evaluateAiGatewayRequest('123456789', {
      model: 'gemini-3.5-flash',
      operation: 'tfi.manual_match_analysis',
      featureKey: 'tfi.ai_observation',
    });

    expect(observe.allowed).toBe(true);
    expect(observe.reason).toBe('input_token_limit_exceeded');
    expect(enforce.allowed).toBe(false);
    expect(enforce.reason).toBe('input_token_limit_exceeded');
  });

  test('incident alerts fan out to admin web push channels', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    mocks.listAiGatewayAdminRecipients.mockResolvedValue([
      {
        userId: '11111111-1111-1111-1111-111111111111',
        email: 'admin@example.com',
        displayName: 'Admin',
        telegramEnabled: false,
        webPushEnabled: true,
        telegramChatId: null,
      },
    ]);
    mocks.isWebPushConfigured.mockReturnValue(true);
    mocks.getSubscriptionsByUserId.mockResolvedValue([
      {
        id: 7,
        user_id: '11111111-1111-1111-1111-111111111111',
        endpoint: 'https://push.example/1',
        p256dh: 'p256dh',
        auth: 'auth',
        user_agent: null,
        created_at: new Date().toISOString(),
        last_used_at: null,
      },
    ]);

    await createAiGatewayIncident({
      incidentType: 'loop_detected',
      title: 'Repeated calls',
      severity: 'critical',
      context: {
        model: 'gemini-3.5-flash',
        operation: 'tfi.live_recommendation',
        featureKey: 'tfi.live_recommendation',
      },
      metadata: { reason: 'loop_detected' },
    });

    expect(mocks.sendWebPushNotification).toHaveBeenCalledTimes(1);
    expect(mocks.updateLastUsed).toHaveBeenCalledWith('https://push.example/1');
  });

  test('loop breaker uses run or feature scope instead of global operation when context is tagged', async () => {
    process.env['AI_GATEWAY_MODE'] = 'observe';
    process.env['AI_GATEWAY_LOOP_CALL_THRESHOLD'] = '6';
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '6' }] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 6 }] });

    const result = await evaluateAiGatewayRequest('short prompt', {
      model: 'gemini-3.5-flash',
      operation: 'tfi.tactical_overlay_refresh',
      featureKey: 'tfi.tactical_overlay_refresh',
      runId: 'team:167',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('loop_detected');
    expect(mocks.query.mock.calls[2]?.[1]).toEqual([
      'run',
      'team:167',
      'loop_detected',
      'critical',
      JSON.stringify({ recentCount: 6, loopThreshold: 6 }),
    ]);
  });

  test('loop breaker falls back to feature scope for tagged feature calls without match or run', async () => {
    process.env['AI_GATEWAY_MODE'] = 'observe';
    process.env['AI_GATEWAY_LOOP_CALL_THRESHOLD'] = '6';
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '6' }] })
      .mockResolvedValueOnce({ rows: [{ id: 13 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] });

    await evaluateAiGatewayRequest('short prompt', {
      model: 'gemini-3.5-flash',
      operation: 'tfi.tactical_overlay_refresh',
      featureKey: 'tfi.tactical_overlay_refresh',
    });

    expect(mocks.query.mock.calls[2]?.[1]).toEqual([
      'feature',
      'tfi.tactical_overlay_refresh',
      'loop_detected',
      'critical',
      JSON.stringify({ recentCount: 6, loopThreshold: 6 }),
    ]);
  });
});
