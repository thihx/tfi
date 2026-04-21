import type { FastifyInstance } from 'fastify';
import { requireAnyRole } from '../lib/authz.js';
import { isLiveAnalysisPromptVersion, LIVE_ANALYSIS_PROMPT_VERSIONS, type LiveAnalysisPromptVersion } from '../lib/live-analysis-prompt.js';
import {
  RECOMMENDATION_STUDIO_TOKEN_CATALOG,
  invalidateRecommendationStudioReleaseCache,
} from '../lib/recommendation-studio-runtime.js';
import { config } from '../config.js';
import {
  activateRecommendationRelease,
  cancelRecommendationReplayRun,
  cloneRecommendationPromptTemplate,
  cloneRecommendationRuleSet,
  createRecommendationRule,
  createRecommendationPromptTemplate,
  createRecommendationRelease,
  createRecommendationReplayRun,
  createRecommendationRuleSet,
  createRollbackRecommendationRelease,
  findRecommendationIdsForReplaySelection,
  getActiveRecommendationRelease,
  getRecommendationPromptTemplateById,
  getRecommendationReleaseById,
  getRecommendationReplayRunById,
  getRecommendationRuleSetById,
  listRecommendationPromptTemplates,
  listRecommendationReleaseAuditLogs,
  listRecommendationReleases,
  listRecommendationReplayRunItems,
  listRecommendationReplayRuns,
  listRecommendationRuleSets,
  toggleRecommendationRule,
  updateRecommendationRule,
  updateRecommendationPromptTemplate,
  updateRecommendationRuleSet,
} from '../repos/recommendation-studio.repo.js';
import { buildRecommendationStudioReplayItems, buildRecommendationStudioReplayScenarios, scheduleRecommendationStudioReplayRun } from '../lib/recommendation-studio-replay.js';
import { runReplayScenario } from '../lib/pipeline-replay.js';
import type { RecommendationReleaseDetail, RecommendationStudioEntityStatus, RecommendationRuleActions, RecommendationRuleConditions, RecommendationStudioRuleStage } from '../lib/recommendation-studio-types.js';
import { RECOMMENDATION_STUDIO_MAX_REPLAY_ITEMS, validatePromptTemplateInput, validateReplayRequest, validateRuleSetInput } from '../lib/recommendation-studio-validation.js';

const RECOMMENDATION_STUDIO_SECTION_DEFINITIONS = [
  { key: 'role_intro', label: 'Role Intro', description: 'Top-level framing for the model.' },
  { key: 'evidence_hierarchy', label: 'Evidence Hierarchy', description: 'How live evidence, priors, and context should be weighted.' },
  { key: 'market_selection', label: 'Market Selection', description: 'Rules for choosing market families and avoiding weak picks.' },
  { key: 'follow_up_answer', label: 'Follow-up Answer', description: 'How advisory and follow-up responses should be formatted.' },
  { key: 'output_contract', label: 'Output Contract', description: 'Supplemental constraints layered on top of the immutable output schema.' },
];

const RECOMMENDATION_STUDIO_RULE_METADATA = {
  stages: ['pre_prompt', 'post_parse'],
  marketFamilies: ['goals_ou', 'corners', '1x2', 'asian_handicap', 'btts'],
  periodKinds: ['ft', 'h1'],
  conditionFields: [
    'minuteBands',
    'scoreStates',
    'evidenceModes',
    'prematchStrengths',
    'promptVersions',
    'releaseIds',
    'releaseKeys',
    'marketFamilies',
    'canonicalMarketEquals',
    'canonicalMarketPrefixes',
    'periodKinds',
    'oddsMin',
    'oddsMax',
    'lineMin',
    'lineMax',
    'totalGoalsMin',
    'totalGoalsMax',
    'currentCornersMin',
    'currentCornersMax',
    'riskLevels',
  ],
  actions: [
    'block',
    'forceNoBet',
    'capConfidence',
    'capStakePercent',
    'raiseMinEdge',
    'warning',
    'hideMarketFamiliesFromPrompt',
    'appendInstruction',
    'markExceptionalOnly',
  ],
  operators: {
    enumList: ['includes_any'],
    numberRange: ['>=', '<='],
    boolean: ['true', 'false'],
    stringPrefix: ['starts_with'],
    stringEquals: ['equals'],
  },
  validationRules: {
    prePromptBlocksMarketTargeting: true,
    maxReplayItems: RECOMMENDATION_STUDIO_MAX_REPLAY_ITEMS,
  },
} as const;

function requireAdmin(req: Parameters<typeof requireAnyRole>[0], reply: Parameters<typeof requireAnyRole>[1]) {
  return requireAnyRole(req, reply, ['admin']);
}

function asStatus(value: unknown, fallback: RecommendationStudioEntityStatus = 'draft'): RecommendationStudioEntityStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'validated'
    || normalized === 'candidate'
    || normalized === 'active'
    || normalized === 'archived'
    ? normalized
    : fallback;
}

function asPromptVersion(value: unknown, fallback: LiveAnalysisPromptVersion): LiveAnalysisPromptVersion {
  const normalized = String(value ?? '').trim();
  return isLiveAnalysisPromptVersion(normalized) ? normalized : fallback;
}

function asRuleStage(value: unknown): RecommendationStudioRuleStage {
  return String(value ?? '').trim() === 'post_parse' ? 'post_parse' : 'pre_prompt';
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
}

function parseRuleConditions(value: unknown): RecommendationRuleConditions {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecommendationRuleConditions
    : {};
}

function parseRuleActions(value: unknown): RecommendationRuleActions {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecommendationRuleActions
    : {};
}

function sendStudioError(reply: { status: (code: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'ACTIVE_PROMPT_TEMPLATE_LOCKED') {
    return reply.status(409).send({ error: 'Active prompt template cannot be edited directly. Clone it to a draft first.' });
  }
  if (message === 'ACTIVE_RULE_SET_LOCKED') {
    return reply.status(409).send({ error: 'Active rule set cannot be edited directly. Clone it to a draft first.' });
  }
  if (message === 'RELEASE_NOT_VALIDATED') {
    return reply.status(409).send({ error: 'Release activation is blocked until a successful replay validation run completes.' });
  }
  return reply.status(500).send({ error: message });
}

async function resolveReleaseLike(input: {
  releaseId?: number | null;
  promptTemplateId?: number | null;
  ruleSetId?: number | null;
}): Promise<RecommendationReleaseDetail | null> {
  if (input.releaseId) return getRecommendationReleaseById(input.releaseId);
  if (!input.promptTemplateId) return null;
  const promptTemplate = await getRecommendationPromptTemplateById(input.promptTemplateId);
  const ruleSet = input.ruleSetId
    ? await getRecommendationRuleSetById(input.ruleSetId)
    : {
      id: 0,
      rule_set_key: 'preview-empty-rules',
      name: 'Preview Rules',
      status: 'draft' as const,
      notes: '',
      created_by: null,
      updated_by: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      rules: [],
    };
  if (!promptTemplate || !ruleSet) return null;
  return {
    id: 0,
    release_key: 'preview-transient',
    name: 'Preview',
    prompt_template_id: promptTemplate.id,
    rule_set_id: ruleSet.id,
    status: 'candidate',
    activation_scope: 'global',
    replay_validation_status: 'not_validated',
    notes: '',
    is_active: false,
    activated_by: null,
    activated_at: null,
    rollback_of_release_id: null,
    created_by: null,
    updated_by: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    promptTemplate,
    ruleSet,
  };
}

async function resolvePreviewScenario(input: {
  recommendationIds: number[];
  snapshotIds: number[];
}) {
  const primaryScenarios = await buildRecommendationStudioReplayScenarios({
    recommendationIds: input.recommendationIds.slice(0, 1),
    snapshotIds: input.snapshotIds.slice(0, 1),
  });
  if (primaryScenarios[0]) return primaryScenarios[0];

  const fallbackRecommendationIds = await findRecommendationIdsForReplaySelection({ limit: 1 });
  if (fallbackRecommendationIds.length === 0) return null;

  const fallbackScenarios = await buildRecommendationStudioReplayScenarios({
    recommendationIds: fallbackRecommendationIds,
    snapshotIds: [],
  });
  return fallbackScenarios[0] ?? null;
}

function buildReleaseDiff(currentRelease: RecommendationReleaseDetail, targetRelease: RecommendationReleaseDetail) {
  const promptDiff = buildPromptTemplateDiff(currentRelease.promptTemplate, targetRelease.promptTemplate);
  const ruleDiff = buildRuleSetDiff(currentRelease.ruleSet, targetRelease.ruleSet);
  return {
    currentReleaseId: currentRelease.id,
    targetReleaseId: targetRelease.id,
    promptChanged: currentRelease.prompt_template_id !== targetRelease.prompt_template_id || promptDiff.changedPromptSections.length > 0,
    ruleSetChanged: currentRelease.rule_set_id !== targetRelease.rule_set_id || ruleDiff.changedRules.length > 0,
    ...promptDiff,
    ...ruleDiff,
  };
}

function buildPromptTemplateDiff(
  currentTemplate: RecommendationReleaseDetail['promptTemplate'],
  targetTemplate: RecommendationReleaseDetail['promptTemplate'],
) {
  const currentSections = new Map(currentTemplate.sections.map((section) => [section.section_key, section]));
  const targetSections = new Map(targetTemplate.sections.map((section) => [section.section_key, section]));
  const sectionKeys = [...new Set([...currentSections.keys(), ...targetSections.keys()])].sort();
  const promptSectionDiffs = sectionKeys.map((key) => {
    const before = currentSections.get(key) ?? null;
    const after = targetSections.get(key) ?? null;
    const changeType = !before ? 'added' : !after ? 'removed' : (
      before.content !== after.content
      || before.enabled !== after.enabled
      || before.sort_order !== after.sort_order
      || before.label !== after.label
    ) ? 'changed' : 'unchanged';
    return { sectionKey: key, changeType, before, after };
  }).filter((entry) => entry.changeType !== 'unchanged');

  return {
    changedPromptSections: promptSectionDiffs.map((entry) => entry.sectionKey),
    promptSectionDiffs,
  };
}

function buildRuleSetDiff(
  currentRuleSet: RecommendationReleaseDetail['ruleSet'],
  targetRuleSet: RecommendationReleaseDetail['ruleSet'],
) {
  const indexRules = (rules: RecommendationReleaseDetail['ruleSet']['rules']) => {
    const seen = new Map<string, number>();
    return new Map(rules.map((rule) => {
      const baseKey = `${rule.stage}:${rule.name}`;
      const ordinal = (seen.get(baseKey) ?? 0) + 1;
      seen.set(baseKey, ordinal);
      return [`${baseKey}#${ordinal}`, rule] as const;
    }));
  };
  const currentRules = indexRules(currentRuleSet.rules);
  const targetRules = indexRules(targetRuleSet.rules);
  const ruleKeys = [...new Set([...currentRules.keys(), ...targetRules.keys()])].sort();
  const ruleDiffs = ruleKeys.map((key) => {
    const before = currentRules.get(key) ?? null;
    const after = targetRules.get(key) ?? null;
    const changeType = !before ? 'added' : !after ? 'removed' : (
      JSON.stringify(before.conditions_json) !== JSON.stringify(after.conditions_json)
      || JSON.stringify(before.actions_json) !== JSON.stringify(after.actions_json)
      || before.enabled !== after.enabled
      || before.priority !== after.priority
      || before.notes !== after.notes
    ) ? 'changed' : 'unchanged';
    return { ruleKey: key, changeType, before, after };
  }).filter((entry) => entry.changeType !== 'unchanged');
  return {
    changedRules: ruleDiffs.map((entry) => entry.ruleKey),
    ruleDiffs,
  };
}

export async function recommendationStudioRoutes(app: FastifyInstance) {
  app.get('/api/settings/recommendation-studio/bootstrap', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const [prompts, ruleSets, releases, activeRelease, replayRuns, auditLogs] = await Promise.all([
      listRecommendationPromptTemplates(),
      listRecommendationRuleSets(),
      listRecommendationReleases(),
      getActiveRecommendationRelease(),
      listRecommendationReplayRuns(20),
      listRecommendationReleaseAuditLogs(100),
    ]);
    return {
      promptVersions: LIVE_ANALYSIS_PROMPT_VERSIONS,
      tokenCatalog: RECOMMENDATION_STUDIO_TOKEN_CATALOG,
      sectionDefinitions: RECOMMENDATION_STUDIO_SECTION_DEFINITIONS,
      ruleMeta: RECOMMENDATION_STUDIO_RULE_METADATA,
      replayGuardrails: {
        maxItems: RECOMMENDATION_STUDIO_MAX_REPLAY_ITEMS,
        llmModel: config.geminiModel,
      },
      prompts,
      ruleSets,
      releases,
      activeRelease,
      replayRuns,
      auditLogs,
    };
  });

  app.get('/api/settings/recommendation-studio/prompts', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    return listRecommendationPromptTemplates();
  });

  app.get('/api/settings/recommendation-studio/token-catalog', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    return {
      tokens: RECOMMENDATION_STUDIO_TOKEN_CATALOG,
      sectionDefinitions: RECOMMENDATION_STUDIO_SECTION_DEFINITIONS,
    };
  });

  app.get('/api/settings/recommendation-studio/rule-metadata', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    return RECOMMENDATION_STUDIO_RULE_METADATA;
  });

  app.get<{ Params: { id: string } }>('/api/settings/recommendation-studio/prompts/:id', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const detail = await getRecommendationPromptTemplateById(Number(req.params.id));
    if (!detail) return reply.status(404).send({ error: 'Prompt template not found' });
    return detail;
  });

  app.post<{ Body: Record<string, unknown> }>('/api/settings/recommendation-studio/prompts', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const name = String(req.body?.name ?? '').trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    const sections = Array.isArray(req.body?.sections)
      ? req.body.sections.map((section, index) => ({
        section_key: String((section as Record<string, unknown>)?.section_key ?? ''),
        label: String((section as Record<string, unknown>)?.label ?? ''),
        content: String((section as Record<string, unknown>)?.content ?? ''),
        enabled: Boolean((section as Record<string, unknown>)?.enabled ?? true),
        sort_order: Number((section as Record<string, unknown>)?.sort_order ?? index),
      }))
      : [];
    const validation = validatePromptTemplateInput({
      name,
      advancedAppendix: String(req.body?.advancedAppendix ?? ''),
      sections,
      tokenCatalog: RECOMMENDATION_STUDIO_TOKEN_CATALOG,
    });
    if (!validation.ok) return reply.status(400).send({ error: 'Prompt validation failed', validation });
    const created = await createRecommendationPromptTemplate({
      name,
      basePromptVersion: asPromptVersion(req.body?.basePromptVersion, 'v10-hybrid-legacy-b'),
      status: asStatus(req.body?.status),
      notes: String(req.body?.notes ?? ''),
      advancedAppendix: String(req.body?.advancedAppendix ?? ''),
      sections,
      actorUserId: user.userId,
    });
    return reply.status(201).send(created);
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/settings/recommendation-studio/prompts/:id', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const sections = Array.isArray(req.body?.sections)
      ? req.body.sections.map((section, index) => ({
        id: Number((section as Record<string, unknown>)?.id ?? 0) || undefined,
        section_key: String((section as Record<string, unknown>)?.section_key ?? ''),
        label: String((section as Record<string, unknown>)?.label ?? ''),
        content: String((section as Record<string, unknown>)?.content ?? ''),
        enabled: Boolean((section as Record<string, unknown>)?.enabled ?? true),
        sort_order: Number((section as Record<string, unknown>)?.sort_order ?? index),
      }))
      : [];
    const validation = validatePromptTemplateInput({
      name: String(req.body?.name ?? ''),
      advancedAppendix: String(req.body?.advancedAppendix ?? ''),
      sections: sections.map((section) => ({
        section_key: section.section_key,
        label: section.label,
        content: section.content,
        enabled: section.enabled,
        sort_order: section.sort_order,
      })),
      tokenCatalog: RECOMMENDATION_STUDIO_TOKEN_CATALOG,
    });
    if (!validation.ok) return reply.status(400).send({ error: 'Prompt validation failed', validation });
    try {
      const updated = await updateRecommendationPromptTemplate({
        id: Number(req.params.id),
        name: String(req.body?.name ?? ''),
        basePromptVersion: asPromptVersion(req.body?.basePromptVersion, 'v10-hybrid-legacy-b'),
        status: asStatus(req.body?.status),
        notes: String(req.body?.notes ?? ''),
        advancedAppendix: String(req.body?.advancedAppendix ?? ''),
        sections,
        actorUserId: user.userId,
      });
      if (!updated) return reply.status(404).send({ error: 'Prompt template not found' });
      return updated;
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/settings/recommendation-studio/prompts/:id/clone', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const cloned = await cloneRecommendationPromptTemplate(Number(req.params.id), user.userId);
    if (!cloned) return reply.status(404).send({ error: 'Prompt template not found' });
    return reply.status(201).send(cloned);
  });

  app.get<{ Params: { id: string; otherId: string } }>('/api/settings/recommendation-studio/prompts/:id/diff/:otherId', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const [currentTemplate, targetTemplate] = await Promise.all([
      getRecommendationPromptTemplateById(Number(req.params.id)),
      getRecommendationPromptTemplateById(Number(req.params.otherId)),
    ]);
    if (!currentTemplate || !targetTemplate) return reply.status(404).send({ error: 'Prompt template not found' });
    return buildPromptTemplateDiff(currentTemplate, targetTemplate);
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/settings/recommendation-studio/prompts/:id/compile-preview', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const promptTemplateId = Number(req.params.id);
    const ruleSetId = Number(req.body?.ruleSetId ?? 0) || null;
    const recommendationIds = asNumberArray(req.body?.recommendationIds);
    const snapshotIds = asNumberArray(req.body?.snapshotIds);
    const release = await resolveReleaseLike({ promptTemplateId, ruleSetId });
    if (!release) return reply.status(400).send({ error: 'Valid prompt template and optional rule set are required' });
    const scenario = await resolvePreviewScenario({ recommendationIds, snapshotIds });
    if (!scenario) return reply.status(400).send({ error: 'No replayable recommendation/snapshot found for preview' });
    const output = await runReplayScenario(scenario, {
      llmMode: 'mock',
      oddsMode: 'mock',
      shadowMode: false,
      advisoryOnly: true,
      recommendationStudioOverride: { release },
    });
    return {
      release,
      prompt: output.result.debug?.prompt ?? null,
    };
  });

  app.get('/api/settings/recommendation-studio/rule-sets', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    return listRecommendationRuleSets();
  });

  app.get<{ Params: { id: string } }>('/api/settings/recommendation-studio/rule-sets/:id', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const detail = await getRecommendationRuleSetById(Number(req.params.id));
    if (!detail) return reply.status(404).send({ error: 'Rule set not found' });
    return detail;
  });

  app.post<{ Body: Record<string, unknown> }>('/api/settings/recommendation-studio/rule-sets', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const name = String(req.body?.name ?? '').trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    const rules = Array.isArray(req.body?.rules)
      ? req.body.rules.map((rule, index) => ({
        name: String((rule as Record<string, unknown>)?.name ?? `Rule ${index + 1}`),
        stage: asRuleStage((rule as Record<string, unknown>)?.stage),
        priority: Number((rule as Record<string, unknown>)?.priority ?? 100),
        enabled: Boolean((rule as Record<string, unknown>)?.enabled ?? true),
        conditions_json: parseRuleConditions((rule as Record<string, unknown>)?.conditions_json),
        actions_json: parseRuleActions((rule as Record<string, unknown>)?.actions_json),
        notes: String((rule as Record<string, unknown>)?.notes ?? ''),
      }))
      : [];
    const validation = validateRuleSetInput({
      name,
      rules,
    });
    if (!validation.ok) return reply.status(400).send({ error: 'Rule set validation failed', validation });
    const created = await createRecommendationRuleSet({
      name,
      status: asStatus(req.body?.status),
      notes: String(req.body?.notes ?? ''),
      rules,
      actorUserId: user.userId,
    });
    return reply.status(201).send(created);
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/settings/recommendation-studio/rule-sets/:id', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const rules = Array.isArray(req.body?.rules)
      ? req.body.rules.map((rule, index) => ({
        name: String((rule as Record<string, unknown>)?.name ?? `Rule ${index + 1}`),
        stage: asRuleStage((rule as Record<string, unknown>)?.stage),
        priority: Number((rule as Record<string, unknown>)?.priority ?? 100),
        enabled: Boolean((rule as Record<string, unknown>)?.enabled ?? true),
        conditions_json: parseRuleConditions((rule as Record<string, unknown>)?.conditions_json),
        actions_json: parseRuleActions((rule as Record<string, unknown>)?.actions_json),
        notes: String((rule as Record<string, unknown>)?.notes ?? ''),
      }))
      : [];
    const validation = validateRuleSetInput({
      name: String(req.body?.name ?? ''),
      rules,
    });
    if (!validation.ok) return reply.status(400).send({ error: 'Rule set validation failed', validation });
    try {
      const updated = await updateRecommendationRuleSet({
        id: Number(req.params.id),
        name: String(req.body?.name ?? ''),
        status: asStatus(req.body?.status),
        notes: String(req.body?.notes ?? ''),
        rules,
        actorUserId: user.userId,
      });
      if (!updated) return reply.status(404).send({ error: 'Rule set not found' });
      return updated;
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/settings/recommendation-studio/rule-sets/:id/clone', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const cloned = await cloneRecommendationRuleSet(Number(req.params.id), user.userId);
    if (!cloned) return reply.status(404).send({ error: 'Rule set not found' });
    return reply.status(201).send(cloned);
  });

  app.get<{ Params: { id: string; otherId: string } }>('/api/settings/recommendation-studio/rule-sets/:id/diff/:otherId', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const [currentRuleSet, targetRuleSet] = await Promise.all([
      getRecommendationRuleSetById(Number(req.params.id)),
      getRecommendationRuleSetById(Number(req.params.otherId)),
    ]);
    if (!currentRuleSet || !targetRuleSet) return reply.status(404).send({ error: 'Rule set not found' });
    return buildRuleSetDiff(currentRuleSet, targetRuleSet);
  });

  app.post<{ Body: Record<string, unknown> }>('/api/settings/recommendation-studio/rules', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const ruleSetId = Number(req.body?.ruleSetId ?? 0);
    if (!ruleSetId) return reply.status(400).send({ error: 'ruleSetId is required' });
    const rule = {
      name: String(req.body?.name ?? '').trim(),
      stage: asRuleStage(req.body?.stage),
      priority: Number(req.body?.priority ?? 100),
      enabled: Boolean(req.body?.enabled ?? true),
      conditions_json: parseRuleConditions(req.body?.conditions_json),
      actions_json: parseRuleActions(req.body?.actions_json),
      notes: String(req.body?.notes ?? ''),
    };
    const validation = validateRuleSetInput({ name: `rule-set-${ruleSetId}`, rules: [rule] });
    if (!validation.ok) return reply.status(400).send({ error: 'Rule validation failed', validation });
    try {
      const updated = await createRecommendationRule({
        ruleSetId,
        actorUserId: user.userId,
        ...rule,
      });
      if (!updated) return reply.status(404).send({ error: 'Rule set not found' });
      return reply.status(201).send(updated);
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/settings/recommendation-studio/rules/:id', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const rule = {
      name: String(req.body?.name ?? '').trim(),
      stage: asRuleStage(req.body?.stage),
      priority: Number(req.body?.priority ?? 100),
      enabled: Boolean(req.body?.enabled ?? true),
      conditions_json: parseRuleConditions(req.body?.conditions_json),
      actions_json: parseRuleActions(req.body?.actions_json),
      notes: String(req.body?.notes ?? ''),
    };
    const validation = validateRuleSetInput({ name: `rule-${req.params.id}`, rules: [rule] });
    if (!validation.ok) return reply.status(400).send({ error: 'Rule validation failed', validation });
    try {
      const updated = await updateRecommendationRule({
        ruleId: Number(req.params.id),
        actorUserId: user.userId,
        ...rule,
      });
      if (!updated) return reply.status(404).send({ error: 'Rule not found' });
      return updated;
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/settings/recommendation-studio/rules/:id/toggle', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    try {
      const updated = await toggleRecommendationRule({
        ruleId: Number(req.params.id),
        enabled: Boolean(req.body?.enabled),
        actorUserId: user.userId,
      });
      if (!updated) return reply.status(404).send({ error: 'Rule not found' });
      return updated;
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.get('/api/settings/recommendation-studio/releases', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    return listRecommendationReleases();
  });

  app.get('/api/settings/recommendation-studio/releases/active', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    return getActiveRecommendationRelease();
  });

  app.get<{ Params: { id: string } }>('/api/settings/recommendation-studio/releases/:id', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const detail = await getRecommendationReleaseById(Number(req.params.id));
    if (!detail) return reply.status(404).send({ error: 'Release not found' });
    return detail;
  });

  app.post<{ Body: Record<string, unknown> }>('/api/settings/recommendation-studio/releases', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const name = String(req.body?.name ?? '').trim();
    const promptTemplateId = Number(req.body?.promptTemplateId ?? 0);
    const ruleSetId = Number(req.body?.ruleSetId ?? 0);
    if (!name || !promptTemplateId || !ruleSetId) {
      return reply.status(400).send({ error: 'name, promptTemplateId, and ruleSetId are required' });
    }
    const created = await createRecommendationRelease({
      name,
      promptTemplateId,
      ruleSetId,
      status: asStatus(req.body?.status, 'candidate'),
      notes: String(req.body?.notes ?? ''),
      actorUserId: user.userId,
    });
    return reply.status(201).send(created);
  });

  app.post<{ Params: { id: string } }>('/api/settings/recommendation-studio/releases/:id/activate', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    try {
      const activated = await activateRecommendationRelease(Number(req.params.id), user.userId);
      if (!activated) return reply.status(404).send({ error: 'Release not found' });
      invalidateRecommendationStudioReleaseCache();
      return activated;
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/settings/recommendation-studio/releases/:id/rollback-clone', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const rollback = await createRollbackRecommendationRelease(Number(req.params.id), user.userId);
    if (!rollback) return reply.status(404).send({ error: 'Release not found' });
    return reply.status(201).send(rollback);
  });

  app.post<{ Params: { id: string } }>('/api/settings/recommendation-studio/releases/:id/rollback', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    try {
      const rollback = await activateRecommendationRelease(Number(req.params.id), user.userId);
      if (!rollback) return reply.status(404).send({ error: 'Release not found' });
      invalidateRecommendationStudioReleaseCache();
      return rollback;
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { against?: string } }>('/api/settings/recommendation-studio/releases/:id/diff', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const target = await getRecommendationReleaseById(Number(req.params.id));
    if (!target) return reply.status(404).send({ error: 'Target release not found' });
    const againstId = Number(req.query.against ?? 0);
    const current = againstId
      ? await getRecommendationReleaseById(againstId)
      : await getActiveRecommendationRelease();
    if (!current) return reply.status(404).send({ error: 'Comparison release not found' });
    return buildReleaseDiff(current, target);
  });

  app.get<{ Params: { id: string; otherId: string } }>('/api/settings/recommendation-studio/releases/:id/diff/:otherId', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const [current, target] = await Promise.all([
      getRecommendationReleaseById(Number(req.params.id)),
      getRecommendationReleaseById(Number(req.params.otherId)),
    ]);
    if (!current || !target) return reply.status(404).send({ error: 'Comparison release not found' });
    return buildReleaseDiff(current, target);
  });

  app.post<{ Body: Record<string, unknown> }>('/api/settings/recommendation-studio/preview', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const release = await resolveReleaseLike({
      releaseId: Number(req.body?.releaseId ?? 0) || null,
      promptTemplateId: Number(req.body?.promptTemplateId ?? 0) || null,
      ruleSetId: Number(req.body?.ruleSetId ?? 0) || null,
    });
    if (!release) return reply.status(400).send({ error: 'Valid releaseId or promptTemplateId+ruleSetId is required' });
    const recommendationIds = asNumberArray(req.body?.recommendationIds);
    const snapshotIds = asNumberArray(req.body?.snapshotIds);
    const scenario = await resolvePreviewScenario({ recommendationIds, snapshotIds });
    if (!scenario) return reply.status(400).send({ error: 'No replayable recommendation/snapshot found for preview' });
    const output = await runReplayScenario(scenario, {
      llmMode: 'mock',
      oddsMode: 'mock',
      shadowMode: false,
      advisoryOnly: true,
      recommendationStudioOverride: { release },
    });
    const prompt = output.result.debug?.prompt;
    return {
      release,
      prompt,
    };
  });

  app.get('/api/settings/recommendation-studio/replays', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    return listRecommendationReplayRuns(20);
  });

  app.get<{ Params: { id: string } }>('/api/settings/recommendation-studio/replays/:id', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const run = await getRecommendationReplayRunById(Number(req.params.id));
    if (!run) return reply.status(404).send({ error: 'Replay run not found' });
    return run;
  });

  app.get<{ Params: { id: string } }>('/api/settings/recommendation-studio/replays/:id/items', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    return listRecommendationReplayRunItems(Number(req.params.id));
  });

  app.post<{ Params: { id: string } }>('/api/settings/recommendation-studio/replays/:id/cancel', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const run = await cancelRecommendationReplayRun(Number(req.params.id), user.userId);
    if (!run) return reply.status(404).send({ error: 'Replay run not found' });
    return run;
  });

  app.post<{ Body: Record<string, unknown> }>('/api/settings/recommendation-studio/replays', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const releaseId = Number(req.body?.releaseId ?? 0) || null;
    const promptTemplateId = Number(req.body?.promptTemplateId ?? 0) || null;
    const ruleSetId = Number(req.body?.ruleSetId ?? 0) || null;
    if (!releaseId && (!promptTemplateId || !ruleSetId)) {
      return reply.status(400).send({ error: 'releaseId or promptTemplateId+ruleSetId is required' });
    }
    const selectionFilters = req.body?.selectionFilters && typeof req.body.selectionFilters === 'object' && !Array.isArray(req.body.selectionFilters)
      ? req.body.selectionFilters as Record<string, unknown>
      : {};
    const recommendationIds = asNumberArray(req.body?.recommendationIds);
    const snapshotIds = asNumberArray(req.body?.snapshotIds);
    const autoSelectedRecommendationIds = recommendationIds.length === 0 && snapshotIds.length === 0
      ? await findRecommendationIdsForReplaySelection({
        dateFrom: typeof selectionFilters.dateFrom === 'string' ? selectionFilters.dateFrom : null,
        dateTo: typeof selectionFilters.dateTo === 'string' ? selectionFilters.dateTo : null,
        league: typeof selectionFilters.league === 'string' ? selectionFilters.league : null,
        marketFamily: typeof selectionFilters.marketFamily === 'string' ? selectionFilters.marketFamily : null,
        periodKind: selectionFilters.periodKind === 'h1' || selectionFilters.periodKind === 'ft'
          ? selectionFilters.periodKind
          : null,
        result: typeof selectionFilters.result === 'string' ? selectionFilters.result : null,
        riskLevel: typeof selectionFilters.riskLevel === 'string' ? selectionFilters.riskLevel : null,
        limit: Number(selectionFilters.limit ?? RECOMMENDATION_STUDIO_MAX_REPLAY_ITEMS) || RECOMMENDATION_STUDIO_MAX_REPLAY_ITEMS,
      })
      : [];
    const effectiveRecommendationIds = recommendationIds.length > 0 ? recommendationIds : autoSelectedRecommendationIds;
    const replayValidation = validateReplayRequest({ recommendationIds: effectiveRecommendationIds, snapshotIds });
    if (!replayValidation.ok) return reply.status(400).send({ error: 'Replay validation failed', validation: replayValidation });
    const items = buildRecommendationStudioReplayItems({ recommendationIds: effectiveRecommendationIds, snapshotIds });
    if (items.length === 0) return reply.status(400).send({ error: 'At least one recommendation or snapshot is required' });
    if (items.length > RECOMMENDATION_STUDIO_MAX_REPLAY_ITEMS) {
      return reply.status(400).send({ error: `Replay run exceeds ${RECOMMENDATION_STUDIO_MAX_REPLAY_ITEMS} items.` });
    }
    const release = await resolveReleaseLike({ releaseId, promptTemplateId, ruleSetId });
    if (!release) return reply.status(400).send({ error: 'Release context could not be resolved' });
    const effectiveScenarios = await buildRecommendationStudioReplayScenarios({ recommendationIds: effectiveRecommendationIds, snapshotIds });
    const scenarioByRef = new Map<string, Record<string, unknown>>();
    for (const scenario of effectiveScenarios) {
      const sourceRef = scenario.metadata.recommendationId > 0
        ? `recommendation:${scenario.metadata.recommendationId}`
        : `snapshot:${Math.abs(scenario.metadata.recommendationId)}`;
      scenarioByRef.set(sourceRef, {
        originalSelection: scenario.metadata.originalSelection,
        originalBetMarket: scenario.metadata.originalBetMarket,
        originalResult: scenario.metadata.originalResult,
        originalPnl: scenario.metadata.originalPnl,
        minute: scenario.metadata.minute,
        score: scenario.metadata.score,
        league: scenario.metadata.league,
        homeTeam: scenario.metadata.homeTeam,
        awayTeam: scenario.metadata.awayTeam,
      });
    }
    const run = await createRecommendationReplayRun({
      name: String(req.body?.name ?? `Replay ${new Date().toISOString()}`),
      releaseId: release.id > 0 ? release.id : null,
      promptTemplateId: release.prompt_template_id,
      ruleSetId: release.rule_set_id,
      sourceFilters: {
        recommendationIds: effectiveRecommendationIds,
        snapshotIds,
        selectionFilters,
      },
      releaseSnapshotJson: JSON.parse(JSON.stringify(release)) as Record<string, unknown>,
      llmModel: config.geminiModel,
      items: items.map((item) => ({
        ...item,
        original_decision_json: scenarioByRef.get(item.source_ref) ?? {},
      })),
      actorUserId: user.userId,
    });
    scheduleRecommendationStudioReplayRun(run.id);
    return reply.status(201).send(run);
  });

  app.all('/api/recommendation-studio/*', async (req, reply) => {
    const rawUrl = String(req.raw.url ?? '');
    const pathWithQuery = rawUrl
      .replace(/^\/api\/recommendation-studio/, '/api/settings/recommendation-studio')
      .replace('/replay-runs', '/replays');
    return reply.redirect(pathWithQuery, 308);
  });
}
