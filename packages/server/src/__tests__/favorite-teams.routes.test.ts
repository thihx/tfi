// ============================================================
// Unit tests — Favorite Teams routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const CURRENT_USER = {
  userId: 'user-1',
  email: 'user@example.com',
  role: 'member' as const,
  status: 'active' as const,
  displayName: 'User',
  avatarUrl: '',
};

const MOCK_TEAMS = [
  { team_id: '33', team_name: 'Manchester United', team_logo: 'https://logo/33.png', added_at: '2026-01-01T00:00:00Z' },
  { team_id: '40', team_name: 'Liverpool', team_logo: 'https://logo/40.png', added_at: '2026-01-02T00:00:00Z' },
];

vi.mock('../repos/favorite-teams.repo.js', () => ({
  getFavoriteTeams: vi.fn().mockResolvedValue(MOCK_TEAMS),
  addFavoriteTeam: vi.fn().mockResolvedValue(undefined),
  removeFavoriteTeam: vi.fn().mockResolvedValue(undefined),
}));

const MOCK_LEAGUE_TEAMS = [
  { team: { id: 33, name: 'Manchester United', logo: '', country: 'England' }, rank: 1 },
  { team: { id: 40, name: 'Liverpool', logo: '', country: 'England' }, rank: 2 },
];

vi.mock('../lib/league-team-directory.service.js', () => ({
  getLeagueTeamsDirectory: vi.fn().mockResolvedValue(MOCK_LEAGUE_TEAMS),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { favoriteTeamsRoutes } = await import('../routes/favorite-teams.routes.js');
  app = await buildApp([favoriteTeamsRoutes], { currentUser: CURRENT_USER });
});

afterAll(async () => {
  await app.close();
});

// ============================================================
// GET /api/favorite-teams
// ============================================================

describe('GET /api/favorite-teams', () => {
  test('returns list of favorite teams', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/favorite-teams' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].team_id).toBe('33');
    expect(body[1].team_name).toBe('Liverpool');
  });

  test('returns favorite teams through the design-aligned /api/me/favorite-teams alias', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/favorite-teams' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].team_id).toBe('33');
    expect(body[1].team_name).toBe('Liverpool');
  });
});

// ============================================================
// POST /api/favorite-teams
// ============================================================

describe('POST /api/favorite-teams', () => {
  test('adds a favorite team and returns ok', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorite-teams',
      payload: { team_id: '50', team_name: 'Manchester City', team_logo: 'https://logo/50.png' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const repo = await import('../repos/favorite-teams.repo.js');
    expect(repo.addFavoriteTeam).toHaveBeenCalledWith(
      'user-1',
      {
        team_id: '50',
        team_name: 'Manchester City',
        team_logo: 'https://logo/50.png',
      },
    );
  });

  test('defaults team_logo to empty string when not provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorite-teams',
      payload: { team_id: '50', team_name: 'Manchester City' },
    });
    expect(res.statusCode).toBe(200);

    const repo = await import('../repos/favorite-teams.repo.js');
    expect(repo.addFavoriteTeam).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ team_logo: '' }),
    );
  });

  test('adds a favorite team through the design-aligned /api/me/favorite-teams alias', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/favorite-teams',
      payload: { team_id: '60', team_name: 'Tottenham Hotspur' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const repo = await import('../repos/favorite-teams.repo.js');
    expect(repo.addFavoriteTeam).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ team_id: '60', team_name: 'Tottenham Hotspur', team_logo: '' }),
    );
  });

  test('returns 400 when team_id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorite-teams',
      payload: { team_name: 'Manchester City' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/team_id/);
  });

  test('returns 400 when team_name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorite-teams',
      payload: { team_id: '50' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/team_name/);
  });
});

// ============================================================
// DELETE /api/favorite-teams/:teamId
// ============================================================

describe('DELETE /api/favorite-teams/:teamId', () => {
  test('removes the team and returns ok', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/favorite-teams/33' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const repo = await import('../repos/favorite-teams.repo.js');
    expect(repo.removeFavoriteTeam).toHaveBeenCalledWith('user-1', '33');
  });

  test('removes the team through the design-aligned /api/me/favorite-teams/:teamId alias', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/me/favorite-teams/40' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const repo = await import('../repos/favorite-teams.repo.js');
    expect(repo.removeFavoriteTeam).toHaveBeenCalledWith('user-1', '40');
  });
});

// ============================================================
// GET /api/proxy/football/league-teams
// ============================================================

describe('GET /api/proxy/football/league-teams', () => {
  test('returns teams sorted by rank for a given leagueId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/football/league-teams?leagueId=39',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].rank).toBe(1);

    const service = await import('../lib/league-team-directory.service.js');
    expect(service.getLeagueTeamsDirectory).toHaveBeenCalledWith(39);
  });

  test('returns 400 when leagueId is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/football/league-teams',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/leagueId/);
  });

  test('returns 400 when leagueId is not a number', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/football/league-teams?leagueId=abc',
    });
    expect(res.statusCode).toBe(400);
  });
});
