import Fastify from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { recommendationStudioRoutes } from '../routes/recommendation-studio.routes.js';
import { query } from '../db/pool.js';
import { getCachedActiveRecommendationStudioRelease, invalidateRecommendationStudioReleaseCache } from '../lib/recommendation-studio-runtime.js';
import { createRecommendationReplayRun, getRecommendationReleaseById } from '../repos/recommendation-studio.repo.js';

type JsonRecord = Record<string, unknown>;

interface CurrentUser {
  userId: string;
  email: string;
  role: 'admin';
  status: 'active';
  displayName: string;
  avatarUrl: string;
}

const REQUIRED_SUMMARY_KEYS = [
  'pushRate',
  'noBetRate',
  'goalsUnderShare',
  'accuracy',
  'avgOdds',
  'avgBreakEvenRate',
  'totalStaked',
  'totalPnl',
  'roi',
  'byMarketFamily',
  'byMinuteBand',
  'byScoreState',
  'byPrematchStrength',
] as const;

function hasReplayMetrics(summaryJson: unknown): boolean {
  const summary = (summaryJson as JsonRecord | null)?.summary;
  if (!summary || typeof summary !== 'object') return false;
  const record = summary as JsonRecord;
  return REQUIRED_SUMMARY_KEYS.every((key) => key in record);
}

function hasCaseDelta(item: JsonRecord): boolean {
  const evaluation = item.evaluation_json;
  if (!evaluation || typeof evaluation !== 'object') return false;
  const record = evaluation as JsonRecord;
  return [
    'originalSelection',
    'replaySelection',
    'originalBetMarket',
    'replayBetMarket',
    'originalResult',
    'replaySettlementResult',
    'decisionChanged',
    'originalPnl',
    'replayPnl',
    'pnlDelta',
  ].every((key) => key in record);
}

function fail(message: string): never {
  throw new Error(message);
}

async function pickAdminUser(): Promise<CurrentUser> {
  const result = await query<{ id: string; email: string | null; display_name: string | null }>(
    `SELECT id, email, display_name
       FROM users
      WHERE role = 'admin'
      ORDER BY created_at ASC
      LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) fail('No admin user found in database');
  return {
    userId: row.id,
    email: row.email ?? 'admin@example.com',
    role: 'admin',
    status: 'active',
    displayName: row.display_name ?? 'Admin',
    avatarUrl: '',
  };
}

async function pickSettledRecommendationIds(limit: number): Promise<number[]> {
  const result = await query<{ id: string }>(
    `SELECT id::text
       FROM recommendations
      WHERE COALESCE(result, '') <> ''
        AND odds_snapshot IS NOT NULL
        AND stats_snapshot IS NOT NULL
      ORDER BY COALESCE(settled_at, timestamp) DESC NULLS LAST, id DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
}

async function pickSnapshotIds(limit: number): Promise<number[]> {
  const result = await query<{ id: string }>(
    `SELECT id::text
       FROM match_snapshots
      ORDER BY captured_at DESC, id DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
}

async function main(): Promise<void> {
  const outDir = path.resolve('output', 'recommendation-studio-acceptance');
  await mkdir(outDir, { recursive: true });

  const adminUser = await pickAdminUser();
  const settledRecommendationIds = await pickSettledRecommendationIds(4);
  const snapshotIds = await pickSnapshotIds(2);
  if (settledRecommendationIds.length < 2) fail('Need at least 2 settled recommendations for acceptance replay');
  if (snapshotIds.length < 1) fail('Need at least 1 snapshot for preview coverage');

  const app = Fastify({ logger: false });
  app.decorateRequest('currentUser', null);
  app.addHook('onRequest', async (req) => {
    (req as typeof req & { currentUser: CurrentUser | null }).currentUser = adminUser;
  });
  await app.register(recommendationStudioRoutes);
  await app.ready();

  const report: JsonRecord = {
    startedAt: new Date().toISOString(),
    adminUserId: adminUser.userId,
    settledRecommendationIds,
    snapshotIds,
    checks: {},
  };

  const expectOk = (statusCode: number, body: string, context: string) => {
    if (statusCode < 200 || statusCode >= 300) fail(`${context} failed with ${statusCode}: ${body}`);
  };

  const createPromptPayloadA = {
    name: `Studio Acceptance Prompt A ${Date.now()}`,
    basePromptVersion: 'v10-hybrid-legacy-b',
    notes: 'acceptance-a',
    advancedAppendix: 'Use {{MATCH_CONTEXT}} and {{LIVE_STATS_COMPACT}}.',
    sections: [
      {
        section_key: 'market_selection',
        label: 'Market Selection',
        content: 'Prefer grounded picks only. {{LIVE_ODDS_CANONICAL}}',
        enabled: true,
        sort_order: 0,
      },
    ],
  };

  const promptARes = await app.inject({
    method: 'POST',
    url: '/api/settings/recommendation-studio/prompts',
    payload: createPromptPayloadA,
  });
  expectOk(promptARes.statusCode, promptARes.body, 'create prompt A');
  const promptA = promptARes.json() as JsonRecord;

  const promptCloneRes = await app.inject({
    method: 'POST',
    url: `/api/settings/recommendation-studio/prompts/${promptA.id}/clone`,
  });
  expectOk(promptCloneRes.statusCode, promptCloneRes.body, 'clone prompt');
  const promptB = promptCloneRes.json() as JsonRecord;

  const promptBUpdateRes = await app.inject({
    method: 'PUT',
    url: `/api/settings/recommendation-studio/prompts/${promptB.id}`,
    payload: {
      name: `${String(promptB.name)} tuned`,
      basePromptVersion: promptB.base_prompt_version,
      status: 'draft',
      notes: 'acceptance-b',
      advancedAppendix: 'Use {{MATCH_CONTEXT}}, {{LIVE_STATS_COMPACT}}, and be stricter on weak evidence.',
      sections: [
        {
          section_key: 'market_selection',
          label: 'Market Selection',
          content: 'Prefer grounded picks only. {{LIVE_ODDS_CANONICAL}} Avoid weak props.',
          enabled: true,
          sort_order: 0,
        },
      ],
    },
  });
  expectOk(promptBUpdateRes.statusCode, promptBUpdateRes.body, 'update prompt B');

  const promptDiffRes = await app.inject({
    method: 'GET',
    url: `/api/settings/recommendation-studio/prompts/${promptA.id}/diff/${promptB.id}`,
  });
  expectOk(promptDiffRes.statusCode, promptDiffRes.body, 'prompt diff');

  const ruleSetARes = await app.inject({
    method: 'POST',
    url: '/api/settings/recommendation-studio/rule-sets',
    payload: {
      name: `Studio Acceptance Rules A ${Date.now()}`,
      notes: 'acceptance-rules-a',
      rules: [],
    },
  });
  expectOk(ruleSetARes.statusCode, ruleSetARes.body, 'create rule set A');
  const ruleSetA = ruleSetARes.json() as JsonRecord;

  const ruleCreateRes = await app.inject({
    method: 'POST',
    url: '/api/settings/recommendation-studio/rules',
    payload: {
      ruleSetId: ruleSetA.id,
      name: 'Weak Prematch Clamp',
      stage: 'post_parse',
      priority: 80,
      enabled: true,
      conditions_json: { prematchStrengths: ['weak'], marketFamilies: ['corners'] },
      actions_json: { forceNoBet: true, warning: 'Weak prematch corners clamp' },
      notes: 'acceptance-rule-create',
    },
  });
  expectOk(ruleCreateRes.statusCode, ruleCreateRes.body, 'create rule');
  const ruleSetAAfterCreate = ruleCreateRes.json() as JsonRecord;
  const createdRule = ((ruleSetAAfterCreate.rules as JsonRecord[]) ?? [])[0];
  if (!createdRule?.id) fail('Rule create route did not return created rule');

  const ruleUpdateRes = await app.inject({
    method: 'PUT',
    url: `/api/settings/recommendation-studio/rules/${createdRule.id}`,
    payload: {
      name: 'Weak Prematch Clamp Updated',
      stage: 'post_parse',
      priority: 75,
      enabled: true,
      conditions_json: { prematchStrengths: ['weak'], marketFamilies: ['corners', 'btts'] },
      actions_json: { forceNoBet: true, warning: 'Updated clamp' },
      notes: 'acceptance-rule-update',
    },
  });
  expectOk(ruleUpdateRes.statusCode, ruleUpdateRes.body, 'update rule');

  const ruleToggleRes = await app.inject({
    method: 'POST',
    url: `/api/settings/recommendation-studio/rules/${createdRule.id}/toggle`,
    payload: { enabled: false },
  });
  expectOk(ruleToggleRes.statusCode, ruleToggleRes.body, 'toggle rule');

  const ruleSetCloneRes = await app.inject({
    method: 'POST',
    url: `/api/settings/recommendation-studio/rule-sets/${ruleSetA.id}/clone`,
  });
  expectOk(ruleSetCloneRes.statusCode, ruleSetCloneRes.body, 'clone rule set');
  const ruleSetB = ruleSetCloneRes.json() as JsonRecord;

  const ruleSetDiffRes = await app.inject({
    method: 'GET',
    url: `/api/settings/recommendation-studio/rule-sets/${ruleSetA.id}/diff/${ruleSetB.id}`,
  });
  expectOk(ruleSetDiffRes.statusCode, ruleSetDiffRes.body, 'rule set diff');

  const tokenCatalogRes = await app.inject({ method: 'GET', url: '/api/settings/recommendation-studio/token-catalog' });
  const ruleMetadataRes = await app.inject({ method: 'GET', url: '/api/settings/recommendation-studio/rule-metadata' });
  expectOk(tokenCatalogRes.statusCode, tokenCatalogRes.body, 'token catalog');
  expectOk(ruleMetadataRes.statusCode, ruleMetadataRes.body, 'rule metadata');

  const compilePreviewRes = await app.inject({
    method: 'POST',
    url: `/api/settings/recommendation-studio/prompts/${promptA.id}/compile-preview`,
    payload: {
      ruleSetId: ruleSetA.id,
      recommendationIds: [settledRecommendationIds[0]],
      snapshotIds: [snapshotIds[0]],
    },
  });
  expectOk(compilePreviewRes.statusCode, compilePreviewRes.body, 'compile preview');

  const releaseARes = await app.inject({
    method: 'POST',
    url: '/api/settings/recommendation-studio/releases',
    payload: {
      name: `Studio Acceptance Release A ${Date.now()}`,
      promptTemplateId: promptA.id,
      ruleSetId: ruleSetA.id,
      notes: 'acceptance-release-a',
    },
  });
  expectOk(releaseARes.statusCode, releaseARes.body, 'create release A');
  const releaseA = releaseARes.json() as JsonRecord;

  const releaseBRes = await app.inject({
    method: 'POST',
    url: '/api/settings/recommendation-studio/releases',
    payload: {
      name: `Studio Acceptance Release B ${Date.now()}`,
      promptTemplateId: promptB.id,
      ruleSetId: ruleSetB.id,
      notes: 'acceptance-release-b',
    },
  });
  expectOk(releaseBRes.statusCode, releaseBRes.body, 'create release B');
  const releaseB = releaseBRes.json() as JsonRecord;

  const releaseUnvalidatedRes = await app.inject({
    method: 'POST',
    url: '/api/settings/recommendation-studio/releases',
    payload: {
      name: `Studio Acceptance Release Unvalidated ${Date.now()}`,
      promptTemplateId: promptA.id,
      ruleSetId: ruleSetA.id,
      notes: 'acceptance-unvalidated',
    },
  });
  expectOk(releaseUnvalidatedRes.statusCode, releaseUnvalidatedRes.body, 'create unvalidated release');
  const releaseUnvalidated = releaseUnvalidatedRes.json() as JsonRecord;

  const activateUnvalidatedRes = await app.inject({
    method: 'POST',
    url: `/api/settings/recommendation-studio/releases/${releaseUnvalidated.id}/activate`,
  });
  if (activateUnvalidatedRes.statusCode !== 409) {
    fail(`Unvalidated release activation should be blocked, got ${activateUnvalidatedRes.statusCode}`);
  }

  const runReplayAndWait = async (releaseId: number, recommendationIds: number[]) => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/settings/recommendation-studio/replays',
      payload: {
        name: `Acceptance Replay ${releaseId}`,
        releaseId,
        recommendationIds,
      },
    });
    expectOk(createRes.statusCode, createRes.body, `create replay run for release ${releaseId}`);
    const createdRun = createRes.json() as JsonRecord;
    const runId = Number(createdRun.id);
    if (!runId) fail(`Replay run id missing for release ${releaseId}`);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const pollRes = await app.inject({ method: 'GET', url: `/api/settings/recommendation-studio/replays/${runId}` });
      expectOk(pollRes.statusCode, pollRes.body, `poll replay ${runId}`);
      const polled = pollRes.json() as JsonRecord;
      const status = String(polled.status ?? '');
      if (status === 'completed') {
        const itemsRes = await app.inject({ method: 'GET', url: `/api/settings/recommendation-studio/replays/${runId}/items` });
        expectOk(itemsRes.statusCode, itemsRes.body, `replay items ${runId}`);
        return { run: polled, items: itemsRes.json() as JsonRecord[] };
      }
      if (status === 'failed' || status === 'canceled') {
        fail(`Replay ${runId} ended as ${status}: ${pollRes.body}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    fail(`Replay ${runId} timed out`);
  };

  const replayA = await runReplayAndWait(Number(releaseA.id), settledRecommendationIds.slice(0, 2));
  const replayB = await runReplayAndWait(Number(releaseB.id), settledRecommendationIds.slice(1, 3));
  const replayAFirstLeague = String((replayA.items[0]?.original_decision_json as JsonRecord | undefined)?.league ?? '').trim();
  const filteredReplayCreateRes = await app.inject({
    method: 'POST',
    url: '/api/settings/recommendation-studio/replays',
    payload: {
      name: `Acceptance Filter Replay ${releaseA.id}`,
      releaseId: releaseA.id,
      selectionFilters: {
        league: replayAFirstLeague || undefined,
        periodKind: 'ft',
        dateFrom: '2026-01-01',
        limit: 1,
      },
    },
  });
  expectOk(filteredReplayCreateRes.statusCode, filteredReplayCreateRes.body, 'create filtered replay run');
  const filteredReplayCreated = filteredReplayCreateRes.json() as JsonRecord;
  const filteredReplayId = Number(filteredReplayCreated.id);
  if (!filteredReplayId) fail('Filtered replay run id missing');
  let filteredReplayRun: JsonRecord | null = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const pollRes = await app.inject({ method: 'GET', url: `/api/settings/recommendation-studio/replays/${filteredReplayId}` });
    expectOk(pollRes.statusCode, pollRes.body, `poll filtered replay ${filteredReplayId}`);
    const polled = pollRes.json() as JsonRecord;
    const status = String(polled.status ?? '');
    if (status === 'completed' || status === 'completed_with_errors') {
      filteredReplayRun = polled;
      break;
    }
    if (status === 'failed' || status === 'canceled') {
      fail(`Filtered replay ${filteredReplayId} ended as ${status}: ${pollRes.body}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (!filteredReplayRun) fail(`Filtered replay ${filteredReplayId} timed out`);

  const activateARes = await app.inject({ method: 'POST', url: `/api/settings/recommendation-studio/releases/${releaseA.id}/activate` });
  expectOk(activateARes.statusCode, activateARes.body, 'activate release A');
  invalidateRecommendationStudioReleaseCache();
  const activeAfterA = await getCachedActiveRecommendationStudioRelease(true);
  if (!activeAfterA || activeAfterA.id !== Number(releaseA.id)) fail('Active release after activating A is incorrect');

  const editActivePromptRes = await app.inject({
    method: 'PUT',
    url: `/api/settings/recommendation-studio/prompts/${promptA.id}`,
    payload: {
      name: createPromptPayloadA.name,
      basePromptVersion: createPromptPayloadA.basePromptVersion,
      status: 'draft',
      notes: 'should-fail',
      advancedAppendix: createPromptPayloadA.advancedAppendix,
      sections: createPromptPayloadA.sections,
    },
  });
  if (editActivePromptRes.statusCode !== 409) fail(`Active prompt edit should be blocked, got ${editActivePromptRes.statusCode}`);

  const editActiveRuleSetRes = await app.inject({
    method: 'PUT',
    url: `/api/settings/recommendation-studio/rule-sets/${ruleSetA.id}`,
    payload: {
      name: String(ruleSetA.name),
      status: 'draft',
      notes: 'should-fail',
      rules: [],
    },
  });
  if (editActiveRuleSetRes.statusCode !== 409) fail(`Active rule set edit should be blocked, got ${editActiveRuleSetRes.statusCode}`);

  const activateBRes = await app.inject({ method: 'POST', url: `/api/settings/recommendation-studio/releases/${releaseB.id}/activate` });
  expectOk(activateBRes.statusCode, activateBRes.body, 'activate release B');
  invalidateRecommendationStudioReleaseCache();
  const activeAfterB = await getCachedActiveRecommendationStudioRelease(true);
  if (!activeAfterB || activeAfterB.id !== Number(releaseB.id)) fail('Active release after activating B is incorrect');

  const releaseDiffRes = await app.inject({
    method: 'GET',
    url: `/api/settings/recommendation-studio/releases/${releaseB.id}/diff/${releaseA.id}`,
  });
  expectOk(releaseDiffRes.statusCode, releaseDiffRes.body, 'release diff');

  const rollbackRes = await app.inject({ method: 'POST', url: `/api/settings/recommendation-studio/releases/${releaseA.id}/rollback` });
  expectOk(rollbackRes.statusCode, rollbackRes.body, 'rollback to release A');
  invalidateRecommendationStudioReleaseCache();
  const activeAfterRollback = await getCachedActiveRecommendationStudioRelease(true);
  if (!activeAfterRollback || activeAfterRollback.id !== Number(releaseA.id)) fail('Rollback did not restore release A');

  const releaseADetail = await getRecommendationReleaseById(Number(releaseA.id));
  if (!releaseADetail) fail('Release A detail missing for cancel replay test');
  const queuedCancelRun = await createRecommendationReplayRun({
    name: `Acceptance Cancel Replay ${Date.now()}`,
    releaseId: releaseADetail.id,
    promptTemplateId: releaseADetail.prompt_template_id,
    ruleSetId: releaseADetail.rule_set_id,
    sourceFilters: { recommendationIds: [settledRecommendationIds[0]] },
    releaseSnapshotJson: JSON.parse(JSON.stringify(releaseADetail)) as Record<string, unknown>,
    llmModel: 'gemini-2.5-flash',
    items: [
      {
        source_kind: 'recommendation',
        source_ref: `recommendation:${settledRecommendationIds[0]}`,
        recommendation_id: settledRecommendationIds[0],
        original_decision_json: { originalSelection: 'n/a' },
      },
    ],
    actorUserId: adminUser.userId,
  });
  const cancelRes = await app.inject({ method: 'POST', url: `/api/settings/recommendation-studio/replays/${queuedCancelRun.id}/cancel` });
  expectOk(cancelRes.statusCode, cancelRes.body, 'cancel replay');
  const releaseAfterCancel = await getRecommendationReleaseById(Number(releaseA.id));
  if (!releaseAfterCancel) fail('Release A detail missing after cancel replay test');

  const bootstrapRes = await app.inject({ method: 'GET', url: '/api/settings/recommendation-studio/bootstrap' });
  expectOk(bootstrapRes.statusCode, bootstrapRes.body, 'bootstrap final');
  const bootstrap = bootstrapRes.json() as JsonRecord;
  const ruleMetadata = ruleMetadataRes.json() as JsonRecord;
  const ruleMetadataActions = Array.isArray(ruleMetadata.actions) ? ruleMetadata.actions.map((value) => String(value)) : [];

  report.checks = {
    tokenCatalog: tokenCatalogRes.json(),
    ruleMetadata: ruleMetadataRes.json(),
    promptDiff: promptDiffRes.json(),
    ruleSetDiff: ruleSetDiffRes.json(),
    compilePreview: compilePreviewRes.json(),
    replayA: replayA.run,
    replayAItems: replayA.items,
    replayB: replayB.run,
    replayBItems: replayB.items,
    filteredReplay: filteredReplayRun,
    releaseDiff: releaseDiffRes.json(),
    cancelReplay: cancelRes.json(),
    activeReleaseAfterRollback: activeAfterRollback,
    finalBootstrapCounts: {
      prompts: Array.isArray(bootstrap.prompts) ? bootstrap.prompts.length : 0,
      ruleSets: Array.isArray(bootstrap.ruleSets) ? bootstrap.ruleSets.length : 0,
      releases: Array.isArray(bootstrap.releases) ? bootstrap.releases.length : 0,
      replayRuns: Array.isArray(bootstrap.replayRuns) ? bootstrap.replayRuns.length : 0,
      auditLogs: Array.isArray(bootstrap.auditLogs) ? bootstrap.auditLogs.length : 0,
    },
  };

  const acceptanceMatrix = {
    prompt: {
      createEditClone: Number(promptA.id) > 0 && Number(promptB.id) > 0 && promptBUpdateRes.statusCode === 200,
      tokenPickerCatalogRoute: true,
      compilePreview: Boolean((compilePreviewRes.json() as JsonRecord).prompt),
      invalidTokensBlocked: (await app.inject({
        method: 'POST',
        url: '/api/settings/recommendation-studio/prompts',
        payload: {
          name: `Studio Invalid Prompt ${Date.now()}`,
          basePromptVersion: 'v10-hybrid-legacy-b',
          sections: [
            {
              section_key: 'market_selection',
              label: 'Market Selection',
              content: 'Invalid {{NOT_A_REAL_TOKEN}} {{MATCH_CONTEXT}} {{LIVE_STATS_COMPACT}} {{LIVE_ODDS_CANONICAL}}',
              enabled: true,
              sort_order: 0,
            },
          ],
        },
      })).statusCode === 400,
      promptDiffView: Array.isArray((promptDiffRes.json() as JsonRecord).promptSectionDiffs),
    },
    rules: {
      createEditClone: Number(ruleSetA.id) > 0 && Number(ruleSetB.id) > 0,
      ruleCreateUpdateToggle: ruleUpdateRes.statusCode === 200 && ruleToggleRes.statusCode === 200,
      formValidation: (await app.inject({
        method: 'POST',
        url: '/api/settings/recommendation-studio/rule-sets',
        payload: {
          name: `Studio Invalid Rules ${Date.now()}`,
          rules: [{
            name: 'Bad pre prompt odds',
            stage: 'pre_prompt',
            priority: 10,
            enabled: true,
            conditions_json: { oddsMin: 1.8 },
            actions_json: { hideMarketFamiliesFromPrompt: ['corners'] },
          }],
        },
      })).statusCode === 400,
      ruleDiffView: Array.isArray((ruleSetDiffRes.json() as JsonRecord).ruleDiffs),
    },
    replay: {
      oneOrManySelections: replayA.run.total_items === 2,
      selectionFiltersSupported: Number(filteredReplayRun.total_items ?? 0) > 0,
      realLlmRunCompleted: ['completed', 'completed_with_errors'].includes(String(replayA.run.status)) && ['completed', 'completed_with_errors'].includes(String(replayB.run.status)),
      metricsPersisted: hasReplayMetrics(replayA.run.summary_json) && hasReplayMetrics(replayB.run.summary_json),
      caseDeltasPersisted: replayA.items.every(hasCaseDelta) && replayB.items.every(hasCaseDelta),
      cancelSupported: (cancelRes.json() as JsonRecord).status === 'canceled' && releaseAfterCancel.replay_validation_status === 'not_validated',
    },
    release: {
      create: Number(releaseA.id) > 0 && Number(releaseB.id) > 0,
      activateGlobal: activeAfterB?.id === Number(releaseB.id),
      rollback: activeAfterRollback.id === Number(releaseA.id),
      releaseDiffView: Array.isArray((releaseDiffRes.json() as JsonRecord).promptSectionDiffs),
    },
    safety: {
      activePromptLocked: editActivePromptRes.statusCode === 409,
      activeRuleSetLocked: editActiveRuleSetRes.statusCode === 409,
      activationWithoutValidationBlocked: activateUnvalidatedRes.statusCode === 409,
      hardSafetyCoreRemainsCodeBacked:
        ruleMetadataActions.length > 0
        && !ruleMetadataActions.includes('runArbitraryCode')
        && !ruleMetadataActions.includes('execute_sql'),
      auditTrailPresent: Number((((bootstrap.auditLogs as JsonRecord[]) ?? []).length)) > 0,
      releaseSnapshotStored: Boolean((replayA.run.release_snapshot_json as JsonRecord)?.promptTemplate),
    },
  };

  report.acceptanceMatrix = acceptanceMatrix;
  report.completedAt = new Date().toISOString();

  await writeFile(
    path.join(outDir, `recommendation-studio-acceptance-${Date.now()}.json`),
    JSON.stringify(report, null, 2),
    'utf8',
  );

  await app.close();
  console.log(JSON.stringify(report, null, 2));
}

void main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
