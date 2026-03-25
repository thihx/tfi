import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

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

let app: FastifyInstance;

beforeAll(async () => {
  const { teamProfileRoutes } = await import('../routes/team-profiles.routes.js');
  app = await buildApp([teamProfileRoutes]);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('team profile /api/me aliases', () => {
  test('loads profile through /api/me/favorite-teams/:teamId/profile', async () => {
    const repo = await import('../repos/team-profiles.repo.js');
    const res = await app.inject({ method: 'GET', url: '/api/me/favorite-teams/33/profile' });

    expect(res.statusCode).toBe(200);
    expect(repo.getTeamProfileByTeamId).toHaveBeenCalledWith('33');
  });

  test('saves profile through /api/me/favorite-teams/:teamId/profile', async () => {
    const repo = await import('../repos/team-profiles.repo.js');
    const res = await app.inject({
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

  test('deletes profile through /api/me/favorite-teams/:teamId/profile', async () => {
    const repo = await import('../repos/team-profiles.repo.js');
    const res = await app.inject({ method: 'DELETE', url: '/api/me/favorite-teams/33/profile' });

    expect(res.statusCode).toBe(200);
    expect(repo.deleteTeamProfile).toHaveBeenCalledWith('33');
  });
});