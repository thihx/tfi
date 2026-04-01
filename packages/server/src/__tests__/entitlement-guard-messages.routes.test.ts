import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const CURRENT_USER = {
  userId: 'user-1',
  email: 'user@example.com',
  role: 'member' as const,
  status: 'active' as const,
  displayName: 'User',
  avatarUrl: '',
};

vi.mock('../config.js', () => ({
  config: {
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    timezone: 'Asia/Seoul',
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-test',
    telegramBotToken: 'test-bot-token',
    footballApiKey: 'test-football-key',
    footballApiBaseUrl: 'https://api-football.example.com',
    providerSamplingEnabled: false,
    pipelineMinOdds: 1.5,
    pipelineMinConfidence: 5,
  },
}));

vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
  auditSuccess: vi.fn(),
  auditFailure: vi.fn(),
  auditSkipped: vi.fn(),
  auditWrap: vi.fn(),
}));

vi.mock('../repos/subscriptions.repo.js', () => ({
  getCurrentUserSubscription: vi.fn().mockResolvedValue(null),
  getSubscriptionPlan: vi.fn().mockResolvedValue({
    plan_code: 'free',
    display_name: 'Free',
    description: 'Free tier',
    billing_interval: 'manual',
    price_amount: '0.00',
    currency: 'USD',
    active: true,
    public: true,
    display_order: 0,
    entitlements: {
      'ai.manual.ask.enabled': true,
      'ai.manual.ask.daily_limit': 3,
      'watchlist.active_matches.limit': 5,
      'notifications.channels.allowed_types': ['web_push'],
      'notifications.channels.max_active': 1,
    },
    metadata: {},
    created_at: '2026-03-31T00:00:00.000Z',
    updated_at: '2026-03-31T00:00:00.000Z',
  }),
}));

vi.mock('../repos/entitlement-usage.repo.js', () => ({
  consumeUsageIfAvailable: vi.fn().mockResolvedValue({
    allowed: false,
    usedCount: 3,
  }),
  getUsageCounter: vi.fn().mockResolvedValue(null),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  countActiveWatchSubscriptionsByUser: vi.fn().mockResolvedValue(15),
  getAllWatchlist: vi.fn().mockResolvedValue([]),
  getWatchSubscriptionById: vi.fn().mockResolvedValue(null),
  createWatchlistEntry: vi.fn().mockResolvedValue(null),
  updateWatchSubscriptionById: vi.fn().mockResolvedValue(null),
  deleteWatchSubscriptionById: vi.fn().mockResolvedValue(false),
  deleteWatchlistEntry: vi.fn().mockResolvedValue(false),
  incrementChecks: vi.fn().mockResolvedValue(undefined),
  expireOldEntries: vi.fn().mockResolvedValue(0),
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
  }),
}));

vi.mock('../repos/notification-channels.repo.js', () => ({
  SUPPORTED_NOTIFICATION_CHANNELS: ['telegram', 'zalo', 'web_push', 'email'],
  getNotificationChannelConfigs: vi.fn().mockResolvedValue([
    {
      channelType: 'web_push',
      enabled: true,
      status: 'active',
      address: null,
      config: {},
      metadata: {},
    },
  ]),
  saveNotificationChannelConfig: vi.fn().mockResolvedValue({
    channelType: 'telegram',
    enabled: true,
    status: 'pending',
    address: '123456',
    config: {},
    metadata: {},
  }),
}));

vi.mock('../lib/football-api.js', () => ({
  fetchFixturesByIds: vi.fn().mockResolvedValue([]),
  fetchLiveOdds: vi.fn().mockResolvedValue([]),
  fetchPreMatchOdds: vi.fn().mockResolvedValue([]),
  fetchFixtureLineups: vi.fn().mockResolvedValue([]),
  fetchPrediction: vi.fn().mockResolvedValue(null),
  fetchStandings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/reference-data-provider.js', () => ({
  fetchLeagueFixturesFromReferenceProvider: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/provider-insight-cache.js', () => ({
  ensureFixturesForMatchIds: vi.fn().mockResolvedValue([]),
  ensureScoutInsight: vi.fn().mockResolvedValue({
    fixture: { payload: null, freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    statistics: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    events: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    lineups: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    prediction: { payload: null, freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    standings: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
  }),
}));

vi.mock('../lib/odds-resolver.js', () => ({
  resolveMatchOdds: vi.fn().mockResolvedValue({
    oddsSource: 'none',
    freshness: 'missing',
    cacheStatus: 'miss',
    response: [],
  }),
}));

vi.mock('../lib/gemini.js', () => ({
  callGemini: vi.fn().mockResolvedValue('unused'),
}));

vi.mock('../lib/server-pipeline.js', () => ({
  runPromptOnlyAnalysisForMatch: vi.fn().mockResolvedValue({
    text: 'unused',
    prompt: 'unused',
    result: { success: true },
  }),
}));

vi.mock('../lib/telegram.js', () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue(undefined),
  sendTelegramPhoto: vi.fn().mockResolvedValue(undefined),
}));

let watchlistApp: FastifyInstance;
let proxyApp: FastifyInstance;
let notificationApp: FastifyInstance;

beforeAll(async () => {
  const { watchlistRoutes } = await import('../routes/watchlist.routes.js');
  const { proxyRoutes } = await import('../routes/proxy.routes.js');
  const { notificationChannelsRoutes } = await import('../routes/notification-channels.routes.js');
  watchlistApp = await buildApp([watchlistRoutes], { currentUser: CURRENT_USER });
  proxyApp = await buildApp([proxyRoutes], { currentUser: CURRENT_USER });
  notificationApp = await buildApp([notificationChannelsRoutes], { currentUser: CURRENT_USER });
});

afterAll(async () => {
  await watchlistApp.close();
  await proxyApp.close();
  await notificationApp.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('entitlement guard messages through routes', () => {
  test('returns the real watchlist-capacity message', async () => {
    const res = await watchlistApp.inject({
      method: 'POST',
      url: '/api/me/watch-subscriptions',
      payload: { match_id: '301', home_team: 'PSG', away_team: 'Marseille' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('active watchlist limit on the Free plan');
    expect(res.json().error).toContain('(15/5 used)');
  });

  test('returns the real Manual Ask AI quota message', async () => {
    const res = await proxyApp.inject({
      method: 'POST',
      url: '/api/proxy/ai/analyze',
      payload: { prompt: 'test', provider: 'gemini', model: 'gemini-pro' },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error).toContain('used 3/3 Manual Ask AI requests today on the Free plan');
  });

  test('returns the real notification-channel plan message', async () => {
    const res = await notificationApp.inject({
      method: 'PUT',
      url: '/api/notification-channels/telegram',
      payload: { enabled: true, address: '123456' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('telegram notifications are not included in the Free plan');
  });
});
