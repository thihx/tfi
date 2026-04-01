// ============================================================
// Tests — Frontend API Service (bets, snapshots, odds, AI perf)
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  fetchBets,
  fetchBetsByMatch,
  fetchBetStats,
  fetchBetStatsByMarket,
  createBet,
  fetchSnapshotsByMatch,
  fetchLatestSnapshot,
  fetchOddsHistory,
  fetchAiStats,
  fetchAiStatsByModel,
  settleRecommendationFinal,
  fetchAdminUsers,
  updateAdminUser,
  fetchEntitlementCatalog,
  fetchSubscriptionPlans,
  updateSubscriptionPlan,
  fetchAdminUserSubscriptions,
  updateAdminUserSubscription,
  fetchCurrentSubscription,
  fetchLeaguesInitData,
} from '@/lib/services/api';

const config = { apiUrl: 'http://localhost:4000' } as Parameters<typeof fetchBets>[0];

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('bets API', () => {
  test('fetchBets calls GET /api/bets', async () => {
    const data = [{ id: 1, match_id: '123' }];
    globalThis.fetch = mockFetch(data);

    const result = await fetchBets(config);

    expect(result).toEqual(data);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/bets',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('fetchBetsByMatch URL-encodes matchId', async () => {
    globalThis.fetch = mockFetch([]);
    await fetchBetsByMatch(config, '12345');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/bets/match/12345',
      expect.anything(),
    );
  });

  test('fetchBetStats returns stats object', async () => {
    const stats = { total: 10, won: 5, lost: 3, pending: 2, total_pnl: 1.5, roi: 15 };
    globalThis.fetch = mockFetch(stats);

    const result = await fetchBetStats(config);
    expect(result).toEqual(stats);
  });

  test('fetchBetStatsByMarket returns array', async () => {
    const data = [{ market: 'ou', total: 5, won: 3, lost: 1, pending: 1, total_pnl: 0.5, roi: 10 }];
    globalThis.fetch = mockFetch(data);

    const result = await fetchBetStatsByMarket(config);
    expect(result).toEqual(data);
  });

  test('createBet calls POST /api/bets', async () => {
    const bet = { recommendation_id: 1, match_id: '123', market: 'ou', selection: 'over', odds: 1.85, stake: 10, bookmaker: 'test' };
    globalThis.fetch = mockFetch({ id: 1, ...bet });

    const result = await createBet(config, bet);

    expect(result.id).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/bets',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('snapshots API', () => {
  test('fetchSnapshotsByMatch returns snapshot array', async () => {
    const snaps = [{ id: 1, match_id: '123', minute: 45 }];
    globalThis.fetch = mockFetch(snaps);

    const result = await fetchSnapshotsByMatch(config, '123');
    expect(result).toEqual(snaps);
  });

  test('fetchLatestSnapshot returns null when no snapshot', async () => {
    globalThis.fetch = mockFetch({ snapshot: null });

    const result = await fetchLatestSnapshot(config, '123');
    expect(result).toBeNull();
  });

  test('fetchLatestSnapshot returns snapshot when exists', async () => {
    const snap = { id: 1, match_id: '123', minute: 60 };
    globalThis.fetch = mockFetch(snap);

    const result = await fetchLatestSnapshot(config, '123');
    expect(result).toEqual(snap);
  });
});

describe('odds history API', () => {
  test('fetchOddsHistory without market filter', async () => {
    globalThis.fetch = mockFetch([]);
    await fetchOddsHistory(config, '123');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/odds/match/123',
      expect.anything(),
    );
  });

  test('fetchOddsHistory with market filter', async () => {
    globalThis.fetch = mockFetch([]);
    await fetchOddsHistory(config, '123', '1x2');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/odds/match/123?market=1x2',
      expect.anything(),
    );
  });
});

describe('AI performance API', () => {
  test('fetchAiStats returns accuracy stats', async () => {
    const stats = {
      total: 20,
      correct: 12,
      incorrect: 5,
      push: 1,
      void: 1,
      neutral: 2,
      pending: 3,
      pendingResult: 1,
      reviewRequired: 2,
      accuracy: 70.59,
    };
    globalThis.fetch = mockFetch(stats);

    const result = await fetchAiStats(config);
    expect(result).toEqual(stats);
  });

  test('fetchAiStatsByModel returns per-model stats', async () => {
    const data = [{ model: 'gemini', total: 10, correct: 7, accuracy: 70 }];
    globalThis.fetch = mockFetch(data);

    const result = await fetchAiStatsByModel(config);
    expect(result).toEqual(data);
  });

  test('settleRecommendationFinal calls PUT /api/recommendations/:id/settle', async () => {
    const body = { id: 11015, result: 'win', pnl: 1.55 };
    globalThis.fetch = mockFetch(body);

    const result = await settleRecommendationFinal(config, 11015, { result: 'win', pnl: 1.55 });
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/recommendations/11015/settle',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('fetchAdminUsers calls GET /api/settings/users', async () => {
    const body = [{ id: 'user-1', email: 'user@example.com', role: 'member', status: 'active' }];
    globalThis.fetch = mockFetch(body);

    const result = await fetchAdminUsers(config);
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/settings/users',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('updateAdminUser calls PATCH /api/settings/users/:id', async () => {
    const body = { id: 'user-1', email: 'user@example.com', role: 'admin', status: 'disabled' };
    globalThis.fetch = mockFetch(body);

    const result = await updateAdminUser(config, 'user-1', { role: 'admin', status: 'disabled' });
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/settings/users/user-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('fetchEntitlementCatalog calls GET /api/settings/subscription/catalog', async () => {
    const body = { catalog: [{ key: 'ai.manual.ask.daily_limit' }] };
    globalThis.fetch = mockFetch(body);

    const result = await fetchEntitlementCatalog(config);
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/settings/subscription/catalog',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('fetchSubscriptionPlans calls GET /api/settings/subscription/plans', async () => {
    const body = [{ plan_code: 'free', display_name: 'Free' }];
    globalThis.fetch = mockFetch(body);

    const result = await fetchSubscriptionPlans(config);
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/settings/subscription/plans',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('updateSubscriptionPlan calls PATCH /api/settings/subscription/plans/:code', async () => {
    const body = { plan_code: 'free', display_name: 'Free', entitlements: {} };
    globalThis.fetch = mockFetch(body);

    const result = await updateSubscriptionPlan(config, 'free', { entitlements: {} });
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/settings/subscription/plans/free',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('fetchAdminUserSubscriptions calls GET /api/settings/subscription/users', async () => {
    const body = [{ id: 'user-1', subscription_plan_code: 'free' }];
    globalThis.fetch = mockFetch(body);

    const result = await fetchAdminUserSubscriptions(config);
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/settings/subscription/users',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('updateAdminUserSubscription calls PUT /api/settings/subscription/users/:id', async () => {
    const body = { id: 1, user_id: 'user-1', plan_code: 'pro', status: 'active' };
    globalThis.fetch = mockFetch(body);

    const result = await updateAdminUserSubscription(config, 'user-1', { planCode: 'pro', status: 'active' });
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/settings/subscription/users/user-1',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('fetchCurrentSubscription calls GET /api/me/subscription', async () => {
    const body = { plan: { plan_code: 'free' }, entitlements: {}, usage: { manualAiDaily: { used: 1, limit: 3 } } };
    globalThis.fetch = mockFetch(body);

    const result = await fetchCurrentSubscription(config);
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/me/subscription',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('fetchLeaguesInitData returns profile coverage summary', async () => {
    const body = {
      leagues: [{ league_id: 39, league_name: 'Premier League' }],
      favoriteTeamIds: ['1'],
      profiledTeamIds: ['1', '2'],
      profileCoverage: {
        summary: {
          topLeagues: 2,
          topLeagueProfiles: 1,
          topLeagueTeams: 6,
          topLeagueTeamsWithProfile: 4,
          teamProfileCoverage: 0.667,
          fullCoverageLeagues: 1,
          partialCoverageLeagues: 1,
          missingCoverageLeagues: 0,
        },
        leagues: [],
      },
    };
    globalThis.fetch = mockFetch(body);

    const result = await fetchLeaguesInitData(config);
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/leagues/init',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('error handling', () => {
  test('throws on non-ok response', async () => {
    globalThis.fetch = mockFetch('Not found', 404);

    await expect(fetchBets(config)).rejects.toThrow('HTTP 404');
  });
});
