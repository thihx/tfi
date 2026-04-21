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

const repoMocks = vi.hoisted(() => ({
  listRecommendationPromptTemplates: vi.fn(),
  listRecommendationRuleSets: vi.fn(),
  listRecommendationReleases: vi.fn(),
  getActiveRecommendationRelease: vi.fn(),
  listRecommendationReplayRuns: vi.fn(),
  listRecommendationReleaseAuditLogs: vi.fn(),
  getRecommendationPromptTemplateById: vi.fn(),
  getRecommendationRuleSetById: vi.fn(),
  getRecommendationReleaseById: vi.fn(),
  createRecommendationReplayRun: vi.fn(),
  getRecommendationReplayRunById: vi.fn(),
  listRecommendationReplayRunItems: vi.fn(),
  createRecommendationPromptTemplate: vi.fn(),
  updateRecommendationPromptTemplate: vi.fn(),
  cloneRecommendationPromptTemplate: vi.fn(),
  createRecommendationRuleSet: vi.fn(),
  createRecommendationRule: vi.fn(),
  updateRecommendationRuleSet: vi.fn(),
  updateRecommendationRule: vi.fn(),
  toggleRecommendationRule: vi.fn(),
  cloneRecommendationRuleSet: vi.fn(),
  createRecommendationRelease: vi.fn(),
  activateRecommendationRelease: vi.fn(),
  createRollbackRecommendationRelease: vi.fn(),
  cancelRecommendationReplayRun: vi.fn(),
  findRecommendationIdsForReplaySelection: vi.fn(),
}));

const replayMocks = vi.hoisted(() => ({
  buildRecommendationStudioReplayScenarios: vi.fn(),
  buildRecommendationStudioReplayItems: vi.fn(),
  scheduleRecommendationStudioReplayRun: vi.fn(),
}));

const pipelineReplayMocks = vi.hoisted(() => ({
  runReplayScenario: vi.fn(),
}));

vi.mock('../repos/recommendation-studio.repo.js', () => ({
  listRecommendationPromptTemplates: repoMocks.listRecommendationPromptTemplates,
  listRecommendationRuleSets: repoMocks.listRecommendationRuleSets,
  listRecommendationReleases: repoMocks.listRecommendationReleases,
  getActiveRecommendationRelease: repoMocks.getActiveRecommendationRelease,
  listRecommendationReplayRuns: repoMocks.listRecommendationReplayRuns,
  listRecommendationReleaseAuditLogs: repoMocks.listRecommendationReleaseAuditLogs,
  getRecommendationPromptTemplateById: repoMocks.getRecommendationPromptTemplateById,
  getRecommendationRuleSetById: repoMocks.getRecommendationRuleSetById,
  getRecommendationReleaseById: repoMocks.getRecommendationReleaseById,
  createRecommendationReplayRun: repoMocks.createRecommendationReplayRun,
  getRecommendationReplayRunById: repoMocks.getRecommendationReplayRunById,
  listRecommendationReplayRunItems: repoMocks.listRecommendationReplayRunItems,
  createRecommendationPromptTemplate: repoMocks.createRecommendationPromptTemplate,
  updateRecommendationPromptTemplate: repoMocks.updateRecommendationPromptTemplate,
  cloneRecommendationPromptTemplate: repoMocks.cloneRecommendationPromptTemplate,
  createRecommendationRuleSet: repoMocks.createRecommendationRuleSet,
  createRecommendationRule: repoMocks.createRecommendationRule,
  updateRecommendationRuleSet: repoMocks.updateRecommendationRuleSet,
  updateRecommendationRule: repoMocks.updateRecommendationRule,
  toggleRecommendationRule: repoMocks.toggleRecommendationRule,
  cloneRecommendationRuleSet: repoMocks.cloneRecommendationRuleSet,
  createRecommendationRelease: repoMocks.createRecommendationRelease,
  activateRecommendationRelease: repoMocks.activateRecommendationRelease,
  createRollbackRecommendationRelease: repoMocks.createRollbackRecommendationRelease,
  cancelRecommendationReplayRun: repoMocks.cancelRecommendationReplayRun,
  findRecommendationIdsForReplaySelection: repoMocks.findRecommendationIdsForReplaySelection,
}));

vi.mock('../lib/recommendation-studio-replay.js', () => ({
  buildRecommendationStudioReplayScenarios: replayMocks.buildRecommendationStudioReplayScenarios,
  buildRecommendationStudioReplayItems: replayMocks.buildRecommendationStudioReplayItems,
  scheduleRecommendationStudioReplayRun: replayMocks.scheduleRecommendationStudioReplayRun,
}));

vi.mock('../lib/pipeline-replay.js', () => ({
  runReplayScenario: pipelineReplayMocks.runReplayScenario,
}));

vi.mock('../lib/recommendation-studio-runtime.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/recommendation-studio-runtime.js')>('../lib/recommendation-studio-runtime.js');
  return {
    ...actual,
    invalidateRecommendationStudioReleaseCache: vi.fn(),
  };
});

let adminApp: FastifyInstance;
let memberApp: FastifyInstance;

beforeAll(async () => {
  const { recommendationStudioRoutes } = await import('../routes/recommendation-studio.routes.js');
  adminApp = await buildApp([recommendationStudioRoutes], { currentUser: ADMIN_USER });
  memberApp = await buildApp([recommendationStudioRoutes], { currentUser: MEMBER_USER });
});

afterAll(async () => {
  await adminApp.close();
  await memberApp.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  repoMocks.listRecommendationPromptTemplates.mockResolvedValue([
    { id: 11, template_key: 'prompt-1', name: 'Prompt 1', base_prompt_version: 'v10-hybrid-legacy-b', status: 'draft', notes: '', advanced_appendix: '', created_by: null, updated_by: null, created_at: '2026-04-20T00:00:00.000Z', updated_at: '2026-04-20T00:00:00.000Z' },
  ]);
  repoMocks.listRecommendationRuleSets.mockResolvedValue([
    { id: 21, rule_set_key: 'rules-1', name: 'Rules 1', status: 'draft', notes: '', created_by: null, updated_by: null, created_at: '2026-04-20T00:00:00.000Z', updated_at: '2026-04-20T00:00:00.000Z' },
  ]);
  repoMocks.listRecommendationReleases.mockResolvedValue([]);
  repoMocks.getActiveRecommendationRelease.mockResolvedValue(null);
  repoMocks.listRecommendationReplayRuns.mockResolvedValue([]);
  repoMocks.listRecommendationReleaseAuditLogs.mockResolvedValue([]);
  repoMocks.findRecommendationIdsForReplaySelection.mockResolvedValue([]);
  replayMocks.buildRecommendationStudioReplayItems.mockImplementation(({ recommendationIds = [], snapshotIds = [] }) => ([
    ...recommendationIds.map((id: number) => ({ source_kind: 'recommendation', source_ref: `recommendation:${id}`, recommendation_id: id })),
    ...snapshotIds.map((id: number) => ({ source_kind: 'snapshot', source_ref: `snapshot:${id}`, snapshot_id: id })),
  ]));
});

describe('recommendation studio routes', () => {
  test('rejects non-admin bootstrap access and returns admin bootstrap payload', async () => {
    const denied = await memberApp.inject({ method: 'GET', url: '/api/settings/recommendation-studio/bootstrap' });
    expect(denied.statusCode).toBe(403);

  repoMocks.getActiveRecommendationRelease.mockResolvedValue({
      id: 1,
      release_key: 'release-1',
      name: 'Release 1',
      prompt_template_id: 11,
      rule_set_id: 21,
      status: 'active',
      activation_scope: 'global',
      replay_validation_status: 'validated',
      notes: '',
      is_active: true,
      activated_by: 'admin-1',
      activated_at: '2026-04-20T01:00:00.000Z',
      rollback_of_release_id: null,
      created_by: 'admin-1',
      updated_by: 'admin-1',
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T01:00:00.000Z',
      promptTemplate: {
        id: 11,
        template_key: 'prompt-1',
        name: 'Prompt 1',
        base_prompt_version: 'v10-hybrid-legacy-b',
        status: 'draft',
        notes: '',
        advanced_appendix: '',
        created_by: null,
        updated_by: null,
        created_at: '2026-04-20T00:00:00.000Z',
        updated_at: '2026-04-20T00:00:00.000Z',
        sections: [],
      },
      ruleSet: {
        id: 21,
        rule_set_key: 'rules-1',
        name: 'Rules 1',
        status: 'draft',
        notes: '',
        created_by: null,
        updated_by: null,
        created_at: '2026-04-20T00:00:00.000Z',
        updated_at: '2026-04-20T00:00:00.000Z',
        rules: [],
      },
    });

    const res = await adminApp.inject({ method: 'GET', url: '/api/settings/recommendation-studio/bootstrap' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prompts).toHaveLength(1);
    expect(body.ruleSets).toHaveLength(1);
    expect(body.activeRelease?.id).toBe(1);
    expect(body.tokenCatalog.some((entry: { key: string }) => entry.key === 'MATCH_CONTEXT')).toBe(true);
  });

  test('builds preview prompt from transient prompt and rule set context', async () => {
    repoMocks.getRecommendationPromptTemplateById.mockResolvedValue({
      id: 11,
      template_key: 'prompt-1',
      name: 'Prompt 1',
      base_prompt_version: 'v10-hybrid-legacy-b',
      status: 'draft',
      notes: '',
      advanced_appendix: '',
      created_by: null,
      updated_by: null,
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:00:00.000Z',
      sections: [],
    });
    repoMocks.getRecommendationRuleSetById.mockResolvedValue({
      id: 21,
      rule_set_key: 'rules-1',
      name: 'Rules 1',
      status: 'draft',
      notes: '',
      created_by: null,
      updated_by: null,
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:00:00.000Z',
      rules: [],
    });
    replayMocks.buildRecommendationStudioReplayScenarios.mockResolvedValue([
      { name: 'scenario-1', metadata: { recommendationId: 123 } },
    ]);
    pipelineReplayMocks.runReplayScenario.mockResolvedValue({
      result: {
        shouldPush: false,
        selection: '',
        debug: {
          prompt: 'COMPILED PROMPT',
        },
      },
    });

    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/settings/recommendation-studio/preview',
      payload: {
        promptTemplateId: 11,
        ruleSetId: 21,
        recommendationIds: [123],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().prompt).toBe('COMPILED PROMPT');
    expect(replayMocks.buildRecommendationStudioReplayScenarios).toHaveBeenCalledWith({
      recommendationIds: [123],
      snapshotIds: [],
    });
  });

  test('falls back to latest replayable recommendation when preview ids are invalid', async () => {
    repoMocks.getRecommendationPromptTemplateById.mockResolvedValue({
      id: 11,
      template_key: 'prompt-1',
      name: 'Prompt 1',
      base_prompt_version: 'v10-hybrid-legacy-b',
      status: 'draft',
      notes: '',
      advanced_appendix: '',
      created_by: null,
      updated_by: null,
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:00:00.000Z',
      sections: [],
    });
    repoMocks.findRecommendationIdsForReplaySelection.mockResolvedValue([456]);
    replayMocks.buildRecommendationStudioReplayScenarios
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: 'fallback-scenario', metadata: { recommendationId: 456 } }]);
    pipelineReplayMocks.runReplayScenario.mockResolvedValue({
      result: {
        shouldPush: false,
        selection: '',
        debug: { prompt: 'FALLBACK PREVIEW PROMPT' },
      },
    });

    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/settings/recommendation-studio/prompts/11/compile-preview',
      payload: {
        recommendationIds: [999999],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().prompt).toBe('FALLBACK PREVIEW PROMPT');
    expect(repoMocks.findRecommendationIdsForReplaySelection).toHaveBeenCalledWith({ limit: 1 });
    expect(replayMocks.buildRecommendationStudioReplayScenarios).toHaveBeenNthCalledWith(1, {
      recommendationIds: [999999],
      snapshotIds: [],
    });
    expect(replayMocks.buildRecommendationStudioReplayScenarios).toHaveBeenNthCalledWith(2, {
      recommendationIds: [456],
      snapshotIds: [],
    });
  });

  test('creates replay runs and schedules execution', async () => {
    repoMocks.getRecommendationReleaseById.mockResolvedValue({
      id: 5,
      release_key: 'release-5',
      name: 'Release 5',
      prompt_template_id: 11,
      rule_set_id: 21,
      status: 'candidate',
      activation_scope: 'global',
      replay_validation_status: 'validated',
      notes: '',
      is_active: false,
      activated_by: null,
      activated_at: null,
      rollback_of_release_id: null,
      created_by: 'admin-1',
      updated_by: 'admin-1',
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:00:00.000Z',
      promptTemplate: {
        id: 11,
        template_key: 'prompt-1',
        name: 'Prompt 1',
        base_prompt_version: 'v10-hybrid-legacy-b',
        status: 'draft',
        notes: '',
        advanced_appendix: '',
        created_by: null,
        updated_by: null,
        created_at: '2026-04-20T00:00:00.000Z',
        updated_at: '2026-04-20T00:00:00.000Z',
        sections: [],
      },
      ruleSet: {
        id: 21,
        rule_set_key: 'rules-1',
        name: 'Rules 1',
        status: 'draft',
        notes: '',
        created_by: null,
        updated_by: null,
        created_at: '2026-04-20T00:00:00.000Z',
        updated_at: '2026-04-20T00:00:00.000Z',
        rules: [],
      },
    });
    repoMocks.createRecommendationReplayRun.mockResolvedValue({
      id: 77,
      run_key: 'run-77',
      name: 'Coverage Replay',
      release_id: 5,
      prompt_template_id: 11,
      rule_set_id: 21,
      status: 'queued',
      source_filters: {},
      release_snapshot_json: {},
      summary_json: {},
      total_items: 2,
      completed_items: 0,
      error_message: null,
      llm_mode: 'real',
      llm_model: 'gemini-2.5-flash',
      created_by: 'admin-1',
      created_at: '2026-04-20T00:00:00.000Z',
      started_at: null,
      completed_at: null,
    });
    replayMocks.buildRecommendationStudioReplayScenarios.mockResolvedValue([
      {
        metadata: {
          recommendationId: 10,
          originalSelection: 'Under 2.5',
          originalBetMarket: 'Goals O/U',
          originalResult: 'win',
          originalPnl: 1.1,
          minute: 38,
          score: '1-0',
          league: 'Test League',
          homeTeam: 'A',
          awayTeam: 'B',
        },
      },
      {
        metadata: {
          recommendationId: -20,
          minute: 40,
          score: '1-0',
          league: 'Test League',
          homeTeam: 'A',
          awayTeam: 'B',
        },
      },
    ]);

    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/settings/recommendation-studio/replays',
      payload: {
        name: 'Coverage Replay',
        releaseId: 5,
        recommendationIds: [10],
        snapshotIds: [20],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(repoMocks.createRecommendationReplayRun).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Coverage Replay',
      releaseId: 5,
      promptTemplateId: 11,
      ruleSetId: 21,
      actorUserId: 'admin-1',
    }));
    expect(repoMocks.createRecommendationReplayRun).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          source_ref: 'recommendation:10',
          original_decision_json: expect.objectContaining({
            originalSelection: 'Under 2.5',
            originalBetMarket: 'Goals O/U',
          }),
        }),
      ]),
    }));
    expect(replayMocks.scheduleRecommendationStudioReplayRun).toHaveBeenCalledWith(77);
  });

  test('supports replay selection by filters when ids are omitted', async () => {
    repoMocks.getRecommendationReleaseById.mockResolvedValue({
      id: 5,
      release_key: 'release-5',
      name: 'Release 5',
      prompt_template_id: 11,
      rule_set_id: 21,
      status: 'candidate',
      activation_scope: 'global',
      replay_validation_status: 'validated',
      notes: '',
      is_active: false,
      activated_by: null,
      activated_at: null,
      rollback_of_release_id: null,
      created_by: 'admin-1',
      updated_by: 'admin-1',
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:00:00.000Z',
      promptTemplate: { id: 11, template_key: 'prompt-1', name: 'Prompt 1', base_prompt_version: 'v10-hybrid-legacy-b', status: 'draft', notes: '', advanced_appendix: '', created_by: null, updated_by: null, created_at: '', updated_at: '', sections: [] },
      ruleSet: { id: 21, rule_set_key: 'rules-1', name: 'Rules 1', status: 'draft', notes: '', created_by: null, updated_by: null, created_at: '', updated_at: '', rules: [] },
    });
    repoMocks.findRecommendationIdsForReplaySelection.mockResolvedValue([33, 34]);
    repoMocks.createRecommendationReplayRun.mockResolvedValue({
      id: 88,
      run_key: 'run-88',
      name: 'Filtered Replay',
      release_id: 5,
      prompt_template_id: 11,
      rule_set_id: 21,
      status: 'queued',
      source_filters: {},
      release_snapshot_json: {},
      summary_json: {},
      total_items: 2,
      completed_items: 0,
      error_message: null,
      llm_mode: 'real',
      llm_model: 'gemini-2.5-flash',
      created_by: 'admin-1',
      created_at: '2026-04-20T00:00:00.000Z',
      started_at: null,
      completed_at: null,
    });
    replayMocks.buildRecommendationStudioReplayScenarios.mockResolvedValue([
      { metadata: { recommendationId: 33, minute: 38, score: '1-0', league: 'Serie A', homeTeam: 'A', awayTeam: 'B' } },
      { metadata: { recommendationId: 34, minute: 42, score: '1-1', league: 'Serie A', homeTeam: 'C', awayTeam: 'D' } },
    ]);

    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/settings/recommendation-studio/replays',
      payload: {
        name: 'Filtered Replay',
        releaseId: 5,
        selectionFilters: {
          dateFrom: '2026-04-01',
          dateTo: '2026-04-20',
          league: 'Serie A',
          marketFamily: 'goals_ou',
          periodKind: 'ft',
        },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(repoMocks.findRecommendationIdsForReplaySelection).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-04-01',
      league: 'Serie A',
      marketFamily: 'goals_ou',
      periodKind: 'ft',
    }));
    expect(repoMocks.createRecommendationReplayRun).toHaveBeenCalledWith(expect.objectContaining({
      sourceFilters: expect.objectContaining({
        recommendationIds: [33, 34],
        selectionFilters: expect.objectContaining({ league: 'Serie A' }),
      }),
    }));
  });

  test('blocks invalid prompt tokens on create', async () => {
    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/settings/recommendation-studio/prompts',
      payload: {
        name: 'Invalid Prompt',
        basePromptVersion: 'v10-hybrid-legacy-b',
        sections: [
          {
            section_key: 'bad',
            label: 'Bad',
            content: 'Use {{NOT_A_REAL_TOKEN}}',
            enabled: true,
            sort_order: 0,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().validation.errors[0].message).toContain('Unknown token');
  });

  test('blocks activation when release is not validated', async () => {
    repoMocks.activateRecommendationRelease.mockRejectedValue(new Error('RELEASE_NOT_VALIDATED'));

    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/settings/recommendation-studio/releases/9/activate',
    });

    expect(res.statusCode).toBe(409);
    expect(String(res.body)).toContain('blocked until a successful replay validation run completes');
  });

  test('blocks editing active prompt templates directly', async () => {
    repoMocks.updateRecommendationPromptTemplate.mockRejectedValue(new Error('ACTIVE_PROMPT_TEMPLATE_LOCKED'));

    const res = await adminApp.inject({
      method: 'PUT',
      url: '/api/settings/recommendation-studio/prompts/11',
      payload: {
        name: 'Prompt 1',
        basePromptVersion: 'v10-hybrid-legacy-b',
        status: 'draft',
        notes: '',
        advancedAppendix: '',
        sections: [
          {
            section_key: 'market_selection',
            label: 'Market Selection',
            content: '{{MATCH_CONTEXT}}\n{{LIVE_STATS_COMPACT}}\n{{LIVE_ODDS_CANONICAL}}',
            enabled: true,
            sort_order: 0,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(String(res.body)).toContain('Clone it to a draft first');
  });

  test('returns token catalog and rule metadata catalogs', async () => {
    const [tokenRes, ruleMetaRes] = await Promise.all([
      adminApp.inject({ method: 'GET', url: '/api/settings/recommendation-studio/token-catalog' }),
      adminApp.inject({ method: 'GET', url: '/api/settings/recommendation-studio/rule-metadata' }),
    ]);

    expect(tokenRes.statusCode).toBe(200);
    expect(tokenRes.json().tokens.some((entry: { key: string }) => entry.key === 'MATCH_CONTEXT')).toBe(true);
    expect(tokenRes.json().tokens.some((entry: { key: string }) => entry.key === 'EXACT_OUTPUT_ENUMS')).toBe(true);
    expect(ruleMetaRes.statusCode).toBe(200);
    expect(ruleMetaRes.json().actions).toContain('forceNoBet');
    expect(ruleMetaRes.json().actions).toContain('raiseMinEdge');
    expect(ruleMetaRes.json().conditionFields).toContain('promptVersions');
  });

  test('supports spec alias paths', async () => {
    const [catalogRes, replayAliasRes] = await Promise.all([
      adminApp.inject({ method: 'GET', url: '/api/recommendation-studio/token-catalog' }),
      adminApp.inject({ method: 'GET', url: '/api/recommendation-studio/replay-runs' }),
    ]);

    expect([200, 308]).toContain(catalogRes.statusCode);
    expect([200, 308]).toContain(replayAliasRes.statusCode);
  });

  test('supports prompt compile-preview alias route', async () => {
    repoMocks.getRecommendationPromptTemplateById.mockResolvedValue({
      id: 11,
      template_key: 'prompt-1',
      name: 'Prompt 1',
      base_prompt_version: 'v10-hybrid-legacy-b',
      status: 'draft',
      notes: '',
      advanced_appendix: '',
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
      sections: [],
    });
    replayMocks.buildRecommendationStudioReplayScenarios.mockResolvedValue([{ name: 'scenario-1', metadata: { recommendationId: 123 } }]);
    pipelineReplayMocks.runReplayScenario.mockResolvedValue({ result: { shouldPush: false, selection: '', debug: { prompt: 'ALIAS PROMPT' } } });

    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/settings/recommendation-studio/prompts/11/compile-preview',
      payload: { recommendationIds: [123] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().prompt).toBe('ALIAS PROMPT');
  });

  test('supports prompt diff, rule toggle, and replay cancel routes', async () => {
    repoMocks.getRecommendationPromptTemplateById
      .mockResolvedValueOnce({
        id: 11, template_key: 'prompt-1', name: 'Prompt 1', base_prompt_version: 'v10-hybrid-legacy-b', status: 'draft', notes: '', advanced_appendix: '', created_by: null, updated_by: null, created_at: '', updated_at: '',
        sections: [{ id: 1, template_id: 11, section_key: 'market_selection', label: 'Market Selection', content: 'A', enabled: true, sort_order: 0, created_at: '', updated_at: '' }],
      })
      .mockResolvedValueOnce({
        id: 12, template_key: 'prompt-2', name: 'Prompt 2', base_prompt_version: 'v10-hybrid-legacy-b', status: 'draft', notes: '', advanced_appendix: '', created_by: null, updated_by: null, created_at: '', updated_at: '',
        sections: [{ id: 2, template_id: 12, section_key: 'market_selection', label: 'Market Selection', content: 'B', enabled: true, sort_order: 0, created_at: '', updated_at: '' }],
      });
    repoMocks.toggleRecommendationRule.mockResolvedValue({
      id: 21,
      rule_set_key: 'rules-1',
      name: 'Rules 1',
      status: 'draft',
      notes: '',
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
      rules: [],
    });
    repoMocks.cancelRecommendationReplayRun.mockResolvedValue({
      id: 77,
      run_key: 'run-77',
      name: 'Replay',
      release_id: 5,
      prompt_template_id: 11,
      rule_set_id: 21,
      status: 'canceled',
      source_filters: {},
      release_snapshot_json: {},
      summary_json: {},
      total_items: 1,
      completed_items: 0,
      error_message: 'Canceled by admin',
      llm_mode: 'real',
      llm_model: 'gemini-2.5-flash',
      created_by: 'admin-1',
      created_at: '',
      started_at: '',
      completed_at: '',
    });

    const [diffRes, toggleRes, cancelRes] = await Promise.all([
      adminApp.inject({ method: 'GET', url: '/api/settings/recommendation-studio/prompts/11/diff/12' }),
      adminApp.inject({ method: 'POST', url: '/api/settings/recommendation-studio/rules/5/toggle', payload: { enabled: false } }),
      adminApp.inject({ method: 'POST', url: '/api/settings/recommendation-studio/replays/77/cancel' }),
    ]);

    expect(diffRes.statusCode).toBe(200);
    expect(diffRes.json().changedPromptSections).toContain('market_selection');
    expect(toggleRes.statusCode).toBe(200);
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe('canceled');
  });
});
