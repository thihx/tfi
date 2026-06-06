import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const MEMBER_USER = {
  userId: 'member-1',
  email: 'member@example.com',
  role: 'member' as const,
  status: 'active' as const,
  displayName: 'Member',
  avatarUrl: '',
};

const mockCreateMatchAlertRule = vi.fn();

vi.mock('../repos/match-alert-rules.repo.js', async () => {
  const actual = await vi.importActual<typeof import('../repos/match-alert-rules.repo.js')>(
    '../repos/match-alert-rules.repo.js',
  );
  return {
    ...actual,
    getMatchAlertSettings: vi.fn().mockResolvedValue({
      matchStartEnabled: true,
      manualMatchStartEnabled: true,
      favoriteTeamMatchStartEnabled: false,
      favoriteLeagueMatchStartEnabled: false,
      conditionAlertsEnabled: true,
      favoriteTeamConditionAlertsEnabled: false,
      favoriteLeagueConditionAlertsEnabled: false,
      kickoffLeadMinutes: 0,
      defaultCooldownMinutes: 10,
      channelPolicy: {},
    }),
    saveMatchAlertSettings: vi.fn(),
    getConditionAlertPresets: vi.fn().mockResolvedValue([]),
    saveConditionAlertPresets: vi.fn(),
    resetConditionAlertPresets: vi.fn(),
    listMatchAlertRules: vi.fn().mockResolvedValue([]),
    createMatchAlertRule: mockCreateMatchAlertRule,
    updateMatchAlertRule: vi.fn(),
    deleteMatchAlertRule: vi.fn(),
  };
});

vi.mock('../repos/matches.repo.js', () => ({
  getMatchesByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repos/match-snapshots.repo.js', () => ({
  getLatestSnapshot: vi.fn().mockResolvedValue(null),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { matchAlertsRoutes } = await import('../routes/match-alerts.routes.js');
  app = await buildApp([matchAlertsRoutes], { currentUser: MEMBER_USER });
});

beforeEach(() => {
  mockCreateMatchAlertRule.mockReset();
  mockCreateMatchAlertRule.mockImplementation((_userId: string, input: Record<string, unknown>) =>
    Promise.resolve({
      id: 12,
      userId: MEMBER_USER.userId,
      ...input,
    }),
  );
});

afterAll(async () => {
  await app.close();
});

describe('match alerts routes', () => {
  it('uses preset cooldown and once-per-match defaults when explicit values are omitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/match-alert-rules',
      payload: {
        matchId: '1001',
        alertKind: 'condition_signal',
        source: 'preset:red_card',
        presetId: 'red_card',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreateMatchAlertRule).toHaveBeenCalledWith(
      MEMBER_USER.userId,
      expect.objectContaining({
        cooldownMinutes: 0,
        oncePerMatch: false,
        metadata: expect.objectContaining({ presetId: 'red_card' }),
      }),
    );
  });
});
