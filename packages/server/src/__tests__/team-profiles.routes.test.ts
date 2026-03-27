import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const ADMIN_USER = {
  userId: 'admin-1',
  email: 'admin@example.com',
  role: 'admin' as const,
  status: 'active' as const,
  displayName: 'Admin',
  avatarUrl: '',
};

const MEMBER_USER = {
  userId: 'member-1',
  email: 'member@example.com',
  role: 'member' as const,
  status: 'active' as const,
  displayName: 'Member',
  avatarUrl: '',
};

vi.mock('../repos/team-profiles.repo.js', () => ({
  getAllTeamProfiles: vi.fn().mockResolvedValue([]),
  getTeamProfileByTeamId: vi.fn().mockResolvedValue({
    team_id: '33',
    profile: {
      attack_style: 'mixed',
      defensive_line: 'medium',
      pressing_intensity: 'medium',
      set_piece_threat: 'medium',
      home_strength: 'normal',
      form_consistency: 'inconsistent',
      squad_depth: 'medium',
      avg_goals_scored: null,
      avg_goals_conceded: null,
      clean_sheet_rate: null,
      btts_rate: null,
      over_2_5_rate: null,
      avg_corners_for: null,
      avg_corners_against: null,
      avg_cards: null,
      first_goal_rate: null,
      late_goal_rate: null,
      data_reliability_tier: 'medium',
    },
    notes_en: '',
    notes_vi: '',
    created_at: '2026-03-25T00:00:00.000Z',
    updated_at: '2026-03-25T00:00:00.000Z',
  }),
  upsertTeamProfile: vi.fn().mockResolvedValue({ ok: true }),
  deleteTeamProfile: vi.fn().mockResolvedValue(true),
}));

let adminApp: FastifyInstance;
let memberApp: FastifyInstance;
let anonymousApp: FastifyInstance;

beforeAll(async () => {
  const { teamProfileRoutes } = await import('../routes/team-profiles.routes.js');
  adminApp = await buildApp([teamProfileRoutes], { currentUser: ADMIN_USER });
  memberApp = await buildApp([teamProfileRoutes], { currentUser: MEMBER_USER });
  anonymousApp = await buildApp([teamProfileRoutes]);
});

afterAll(async () => {
  await adminApp.close();
  await memberApp.close();
  await anonymousApp.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('team profile /api/me aliases', () => {
  test('loads profile through /api/me/favorite-teams/:teamId/profile', async () => {
    const repo = await import('../repos/team-profiles.repo.js');
    const res = await memberApp.inject({ method: 'GET', url: '/api/me/favorite-teams/33/profile' });

    expect(res.statusCode).toBe(200);
    expect(repo.getTeamProfileByTeamId).toHaveBeenCalledWith('33');
  });

  test('rejects anonymous profile reads', async () => {
    const res = await anonymousApp.inject({ method: 'GET', url: '/api/me/favorite-teams/33/profile' });

    expect(res.statusCode).toBe(401);
  });

  test('rejects member profile updates through /api/me/favorite-teams/:teamId/profile', async () => {
    const repo = await import('../repos/team-profiles.repo.js');
    const res = await memberApp.inject({
      method: 'PUT',
      url: '/api/me/favorite-teams/33/profile',
      payload: {
        profile: {
          attack_style: 'mixed',
          defensive_line: 'medium',
          pressing_intensity: 'medium',
          set_piece_threat: 'medium',
          home_strength: 'normal',
          form_consistency: 'inconsistent',
          squad_depth: 'medium',
          avg_goals_scored: null,
          avg_goals_conceded: null,
          clean_sheet_rate: null,
          btts_rate: null,
          over_2_5_rate: null,
          avg_corners_for: null,
          avg_corners_against: null,
          avg_cards: null,
          first_goal_rate: null,
          late_goal_rate: null,
          data_reliability_tier: 'medium',
        },
        notes_en: 'hello',
        notes_vi: 'xin chao',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(repo.upsertTeamProfile).not.toHaveBeenCalled();
  });

  test('saves profile through /api/me/favorite-teams/:teamId/profile for admin', async () => {
    const repo = await import('../repos/team-profiles.repo.js');
    const res = await adminApp.inject({
      method: 'PUT',
      url: '/api/me/favorite-teams/33/profile',
      payload: {
        profile: {
          attack_style: 'mixed',
          defensive_line: 'medium',
          pressing_intensity: 'medium',
          set_piece_threat: 'medium',
          home_strength: 'normal',
          form_consistency: 'inconsistent',
          squad_depth: 'medium',
          avg_goals_scored: null,
          avg_goals_conceded: null,
          clean_sheet_rate: null,
          btts_rate: null,
          over_2_5_rate: null,
          avg_corners_for: null,
          avg_corners_against: null,
          avg_cards: null,
          first_goal_rate: null,
          late_goal_rate: null,
          data_reliability_tier: 'medium',
        },
        notes_en: 'hello',
        notes_vi: 'xin chao',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsertTeamProfile).toHaveBeenCalledWith('33', expect.objectContaining({ notes_en: 'hello', notes_vi: 'xin chao' }));
  });

  test('rejects member profile deletes through /api/me/favorite-teams/:teamId/profile', async () => {
    const repo = await import('../repos/team-profiles.repo.js');
    const res = await memberApp.inject({ method: 'DELETE', url: '/api/me/favorite-teams/33/profile' });

    expect(res.statusCode).toBe(403);
    expect(repo.deleteTeamProfile).not.toHaveBeenCalled();
  });

  test('deletes profile through /api/me/favorite-teams/:teamId/profile for admin', async () => {
    const repo = await import('../repos/team-profiles.repo.js');
    const res = await adminApp.inject({ method: 'DELETE', url: '/api/me/favorite-teams/33/profile' });

    expect(res.statusCode).toBe(200);
    expect(repo.deleteTeamProfile).toHaveBeenCalledWith('33');
  });
});