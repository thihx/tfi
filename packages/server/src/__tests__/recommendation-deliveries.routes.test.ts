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

vi.mock('../repos/recommendation-deliveries.repo.js', () => ({
  getRecommendationDeliveriesByUserId: vi.fn().mockResolvedValue({
    rows: [
      {
        id: 1,
        user_id: 'user-1',
        recommendation_id: 8,
        match_id: 'match-1',
        eligibility_status: 'eligible',
        delivery_status: 'pending',
      },
    ],
    total: 1,
  }),
  updateRecommendationDeliveryFlags: vi.fn().mockResolvedValue(true),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { recommendationDeliveriesRoutes } = await import('../routes/recommendation-deliveries.routes.js');
  app = await buildApp([recommendationDeliveriesRoutes], { currentUser: CURRENT_USER });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/me/recommendation-deliveries', () => {
  test('returns current user delivery history', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/recommendation-deliveries' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      rows: [
        {
          id: 1,
          user_id: 'user-1',
          recommendation_id: 8,
          match_id: 'match-1',
          eligibility_status: 'eligible',
          delivery_status: 'pending',
        },
      ],
      total: 1,
    });
  });

  test('passes filters through to the repository', async () => {
    const deliveryRepo = await import('../repos/recommendation-deliveries.repo.js');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/recommendation-deliveries?limit=20&offset=10&matchId=match-1&eligibilityStatus=eligible&deliveryStatus=pending&includeHidden=true&dismissed=false',
    });

    expect(res.statusCode).toBe(200);
    expect(deliveryRepo.getRecommendationDeliveriesByUserId).toHaveBeenCalledWith('user-1', {
      limit: 20,
      offset: 10,
      matchId: 'match-1',
      eligibilityStatus: 'eligible',
      deliveryStatus: 'pending',
      includeHidden: true,
      dismissed: false,
    });
  });
});

describe('PATCH /api/me/recommendation-deliveries/:id', () => {
  test('updates delivery flags for current user', async () => {
    const deliveryRepo = await import('../repos/recommendation-deliveries.repo.js');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/recommendation-deliveries/10',
      payload: { hidden: true, dismissed: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: true });
    expect(deliveryRepo.updateRecommendationDeliveryFlags).toHaveBeenCalledWith('user-1', 10, {
      hidden: true,
      dismissed: true,
    });
  });

  test('rejects invalid delivery id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/recommendation-deliveries/not-a-number',
      payload: { hidden: true },
    });

    expect(res.statusCode).toBe(400);
  });

  test('rejects empty updates', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/recommendation-deliveries/10',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No delivery updates provided' });
  });

  test('returns 404 when delivery does not belong to current user', async () => {
    const deliveryRepo = await import('../repos/recommendation-deliveries.repo.js');
    vi.mocked(deliveryRepo.updateRecommendationDeliveryFlags).mockResolvedValueOnce(false);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/recommendation-deliveries/10',
      payload: { dismissed: true },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Recommendation delivery not found' });
  });
});