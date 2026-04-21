import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from '../db/pool.js';
import type {
  RecommendationPromptSectionRecord,
  RecommendationPromptTemplateDetail,
  RecommendationPromptTemplateRecord,
  RecommendationReleaseAuditLogRecord,
  RecommendationReleaseDetail,
  RecommendationReleaseRecord,
  RecommendationReplayRunItemRecord,
  RecommendationReplayRunRecord,
  RecommendationRuleActions,
  RecommendationRuleConditions,
  RecommendationRuleRecord,
  RecommendationRuleSetDetail,
  RecommendationRuleSetRecord,
  RecommendationStudioEntityStatus,
  RecommendationStudioRuleStage,
} from '../lib/recommendation-studio-types.js';
import type { LiveAnalysisPromptVersion } from '../lib/live-analysis-prompt.js';

function slugifyKey(input: string, fallback: string): string {
  const value = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || fallback;
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function appendAuditLog(
  client: PoolClient,
  entityType: string,
  entityId: number,
  action: string,
  actorUserId: string | null,
  metadata: Record<string, unknown> = {},
  options: {
    beforeJson?: Record<string, unknown>;
    afterJson?: Record<string, unknown>;
    notes?: string;
  } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO recommendation_release_audit_logs (
       entity_type, entity_id, action, actor_user_id, metadata, before_json, after_json, notes
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
    [
      entityType,
      entityId,
      action,
      actorUserId,
      JSON.stringify(metadata),
      JSON.stringify(options.beforeJson ?? {}),
      JSON.stringify(options.afterJson ?? {}),
      options.notes ?? '',
    ],
  );
}

function normalizePromptTemplate(row: RecommendationPromptTemplateRecord): RecommendationPromptTemplateRecord {
  return {
    ...row,
    id: asNumber(row.id),
  };
}

function normalizeReplayRunRecord(
  row: Omit<RecommendationReplayRunRecord, 'source_filters' | 'summary_json' | 'release_snapshot_json'> & {
    source_filters: Record<string, unknown> | string;
    summary_json: Record<string, unknown> | string;
    release_snapshot_json: Record<string, unknown> | string;
  },
): RecommendationReplayRunRecord {
  return {
    ...row,
    id: asNumber(row.id),
    release_id: row.release_id == null ? null : asNumber(row.release_id),
    prompt_template_id: asNumber(row.prompt_template_id),
    rule_set_id: asNumber(row.rule_set_id),
    source_filters: typeof row.source_filters === 'string'
      ? JSON.parse(row.source_filters) as Record<string, unknown>
      : row.source_filters,
    summary_json: typeof row.summary_json === 'string'
      ? JSON.parse(row.summary_json) as Record<string, unknown>
      : row.summary_json,
    release_snapshot_json: typeof row.release_snapshot_json === 'string'
      ? JSON.parse(row.release_snapshot_json) as Record<string, unknown>
      : row.release_snapshot_json,
  };
}

function normalizeReplayRunItemRecord(
  row: Omit<RecommendationReplayRunItemRecord, 'original_decision_json' | 'replayed_decision_json' | 'evaluation_json' | 'output_summary'> & {
    original_decision_json: Record<string, unknown> | string;
    replayed_decision_json: Record<string, unknown> | string;
    evaluation_json: Record<string, unknown> | string;
    output_summary: Record<string, unknown> | string;
  },
): RecommendationReplayRunItemRecord {
  return {
    ...row,
    id: asNumber(row.id),
    run_id: asNumber(row.run_id),
    recommendation_id: row.recommendation_id == null ? null : asNumber(row.recommendation_id),
    snapshot_id: row.snapshot_id == null ? null : asNumber(row.snapshot_id),
    original_decision_json: typeof row.original_decision_json === 'string'
      ? JSON.parse(row.original_decision_json) as Record<string, unknown>
      : row.original_decision_json,
    replayed_decision_json: typeof row.replayed_decision_json === 'string'
      ? JSON.parse(row.replayed_decision_json) as Record<string, unknown>
      : row.replayed_decision_json,
    evaluation_json: typeof row.evaluation_json === 'string'
      ? JSON.parse(row.evaluation_json) as Record<string, unknown>
      : row.evaluation_json,
    output_summary: typeof row.output_summary === 'string'
      ? JSON.parse(row.output_summary) as Record<string, unknown>
      : row.output_summary,
  };
}

function normalizeAuditLogRecord(
  row: Omit<RecommendationReleaseAuditLogRecord, 'metadata' | 'before_json' | 'after_json'> & {
    metadata: Record<string, unknown> | string;
    before_json: Record<string, unknown> | string;
    after_json: Record<string, unknown> | string;
  },
): RecommendationReleaseAuditLogRecord {
  return {
    ...row,
    id: asNumber(row.id),
    entity_id: asNumber(row.entity_id),
    metadata: typeof row.metadata === 'string'
      ? JSON.parse(row.metadata) as Record<string, unknown>
      : row.metadata,
    before_json: typeof row.before_json === 'string'
      ? JSON.parse(row.before_json) as Record<string, unknown>
      : row.before_json,
    after_json: typeof row.after_json === 'string'
      ? JSON.parse(row.after_json) as Record<string, unknown>
      : row.after_json,
  };
}

async function getActiveReleaseRecordTx(client: PoolClient): Promise<RecommendationReleaseRecord | null> {
  const result = await client.query<RecommendationReleaseRecord>(
    `SELECT * FROM recommendation_releases
      WHERE is_active = TRUE
      ORDER BY activated_at DESC NULLS LAST, id DESC
      LIMIT 1`,
  );
  const row = result.rows[0];
  return row
    ? {
      ...row,
      id: asNumber(row.id),
      prompt_template_id: asNumber(row.prompt_template_id),
      rule_set_id: asNumber(row.rule_set_id),
      rollback_of_release_id: row.rollback_of_release_id == null ? null : asNumber(row.rollback_of_release_id),
    }
    : null;
}

async function assertPromptTemplateEditable(client: PoolClient, promptTemplateId: number): Promise<void> {
  const activeRelease = await getActiveReleaseRecordTx(client);
  if (activeRelease?.prompt_template_id === promptTemplateId) {
    throw new Error('ACTIVE_PROMPT_TEMPLATE_LOCKED');
  }
}

async function assertRuleSetEditable(client: PoolClient, ruleSetId: number): Promise<void> {
  const activeRelease = await getActiveReleaseRecordTx(client);
  if (activeRelease?.rule_set_id === ruleSetId) {
    throw new Error('ACTIVE_RULE_SET_LOCKED');
  }
}

function normalizeRuleRecord(row: Omit<RecommendationRuleRecord, 'conditions_json' | 'actions_json'> & {
  conditions_json: RecommendationRuleConditions | string;
  actions_json: RecommendationRuleActions | string;
}): RecommendationRuleRecord {
  return {
    ...row,
    id: asNumber(row.id),
    rule_set_id: asNumber(row.rule_set_id),
    conditions_json: typeof row.conditions_json === 'string'
      ? JSON.parse(row.conditions_json) as RecommendationRuleConditions
      : row.conditions_json,
    actions_json: typeof row.actions_json === 'string'
      ? JSON.parse(row.actions_json) as RecommendationRuleActions
      : row.actions_json,
  };
}

async function getRecommendationPromptTemplateByIdTx(
  client: PoolClient,
  id: number,
): Promise<RecommendationPromptTemplateDetail | null> {
  const templateResult = await client.query<RecommendationPromptTemplateRecord>(
    'SELECT * FROM recommendation_prompt_templates WHERE id = $1 LIMIT 1',
    [id],
  );
  const sectionsResult = await client.query<RecommendationPromptSectionRecord>(
    `SELECT *
       FROM recommendation_prompt_sections
      WHERE template_id = $1
      ORDER BY sort_order ASC, id ASC`,
    [id],
  );
  const template = templateResult.rows[0];
  if (!template) return null;
  return {
    ...normalizePromptTemplate(template),
    sections: sectionsResult.rows.map((section) => ({
      ...section,
      id: asNumber(section.id),
      template_id: asNumber(section.template_id),
    })),
  };
}

async function getRecommendationRuleSetByIdTx(
  client: PoolClient,
  id: number,
): Promise<RecommendationRuleSetDetail | null> {
  const ruleSetResult = await client.query<RecommendationRuleSetRecord>(
    'SELECT * FROM recommendation_rule_sets WHERE id = $1 LIMIT 1',
    [id],
  );
  const rulesResult = await client.query<RecommendationRuleRecord & { conditions_json: string | RecommendationRuleConditions; actions_json: string | RecommendationRuleActions }>(
    `SELECT *
       FROM recommendation_rules
      WHERE rule_set_id = $1
      ORDER BY priority ASC, id ASC`,
    [id],
  );
  const row = ruleSetResult.rows[0];
  if (!row) return null;
  return {
    ...row,
    id: asNumber(row.id),
    rules: rulesResult.rows.map(normalizeRuleRecord),
  };
}

async function getRecommendationReleaseByIdTx(
  client: PoolClient,
  id: number,
): Promise<RecommendationReleaseDetail | null> {
  const releaseResult = await client.query<RecommendationReleaseRecord>(
    'SELECT * FROM recommendation_releases WHERE id = $1 LIMIT 1',
    [id],
  );
  const release = releaseResult.rows[0];
  if (!release) return null;
  const promptTemplate = await getRecommendationPromptTemplateByIdTx(client, release.prompt_template_id);
  const ruleSet = await getRecommendationRuleSetByIdTx(client, release.rule_set_id);
  if (!promptTemplate || !ruleSet) return null;
  return {
    ...release,
    id: asNumber(release.id),
    prompt_template_id: asNumber(release.prompt_template_id),
    rule_set_id: asNumber(release.rule_set_id),
    rollback_of_release_id: release.rollback_of_release_id == null ? null : asNumber(release.rollback_of_release_id),
    promptTemplate,
    ruleSet,
  };
}

export async function listRecommendationPromptTemplates(): Promise<RecommendationPromptTemplateRecord[]> {
  const result = await query<RecommendationPromptTemplateRecord>(
    `SELECT *
       FROM recommendation_prompt_templates
      ORDER BY updated_at DESC, id DESC`,
  );
  return result.rows.map(normalizePromptTemplate);
}

export async function getRecommendationPromptTemplateById(id: number): Promise<RecommendationPromptTemplateDetail | null> {
  return transaction(async (client) => getRecommendationPromptTemplateByIdTx(client, id));
}

export async function createRecommendationPromptTemplate(input: {
  name: string;
  basePromptVersion: LiveAnalysisPromptVersion;
  status?: RecommendationStudioEntityStatus;
  notes?: string;
  advancedAppendix?: string;
  sections?: Array<{
    section_key: string;
    label: string;
    content?: string;
    enabled?: boolean;
    sort_order?: number;
  }>;
  actorUserId: string;
}): Promise<RecommendationPromptTemplateDetail> {
  return transaction(async (client) => {
    const key = `${slugifyKey(input.name, 'prompt')}-${randomUUID().slice(0, 8)}`;
    const created = await client.query<RecommendationPromptTemplateRecord>(
      `INSERT INTO recommendation_prompt_templates (
         template_key, name, base_prompt_version, status, notes, advanced_appendix, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [
        key,
        input.name.trim(),
        input.basePromptVersion,
        input.status ?? 'draft',
        input.notes?.trim() ?? '',
        input.advancedAppendix ?? '',
        input.actorUserId,
      ],
    );
    const template = created.rows[0]!;
    for (const [index, section] of (input.sections ?? []).entries()) {
      await client.query(
        `INSERT INTO recommendation_prompt_sections (
           template_id, section_key, label, content, enabled, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          template.id,
          section.section_key,
          section.label,
          section.content ?? '',
          section.enabled ?? true,
          section.sort_order ?? index,
        ],
      );
    }
    await appendAuditLog(client, 'prompt_template', template.id, 'created', input.actorUserId, {
      templateKey: template.template_key,
      basePromptVersion: template.base_prompt_version,
    });
    const detail = await getRecommendationPromptTemplateByIdTx(client, template.id);
    if (!detail) throw new Error('Failed to reload prompt template');
    return detail;
  });
}

export async function updateRecommendationPromptTemplate(input: {
  id: number;
  name: string;
  basePromptVersion: LiveAnalysisPromptVersion;
  status: RecommendationStudioEntityStatus;
  notes: string;
  advancedAppendix: string;
  sections: Array<{
    id?: number;
    section_key: string;
    label: string;
    content: string;
    enabled: boolean;
    sort_order: number;
  }>;
  actorUserId: string;
}): Promise<RecommendationPromptTemplateDetail | null> {
  return transaction(async (client) => {
    await assertPromptTemplateEditable(client, input.id);
    const before = await getRecommendationPromptTemplateByIdTx(client, input.id);
    const updated = await client.query<RecommendationPromptTemplateRecord>(
      `UPDATE recommendation_prompt_templates
          SET name = $2,
              base_prompt_version = $3,
              status = $4,
              notes = $5,
              advanced_appendix = $6,
              updated_by = $7,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        input.id,
        input.name.trim(),
        input.basePromptVersion,
        input.status,
        input.notes ?? '',
        input.advancedAppendix ?? '',
        input.actorUserId,
      ],
    );
    if (!updated.rows[0]) return null;
    await client.query('DELETE FROM recommendation_prompt_sections WHERE template_id = $1', [input.id]);
    for (const section of input.sections) {
      await client.query(
        `INSERT INTO recommendation_prompt_sections (
           template_id, section_key, label, content, enabled, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.id,
          section.section_key,
          section.label,
          section.content,
          section.enabled,
          section.sort_order,
        ],
      );
    }
    await appendAuditLog(client, 'prompt_template', input.id, 'updated', input.actorUserId, {
      sectionCount: input.sections.length,
      status: input.status,
    }, {
      beforeJson: before ? { name: before.name, status: before.status, sections: before.sections } : {},
      afterJson: {
        name: input.name.trim(),
        status: input.status,
        sections: input.sections,
      },
    });
    return getRecommendationPromptTemplateByIdTx(client, input.id);
  });
}

export async function cloneRecommendationPromptTemplate(id: number, actorUserId: string): Promise<RecommendationPromptTemplateDetail | null> {
  const detail = await getRecommendationPromptTemplateById(id);
  if (!detail) return null;
  return createRecommendationPromptTemplate({
    name: `${detail.name} Copy`,
    basePromptVersion: detail.base_prompt_version,
    status: 'draft',
    notes: detail.notes,
    advancedAppendix: detail.advanced_appendix,
    sections: detail.sections.map((section) => ({
      section_key: section.section_key,
      label: section.label,
      content: section.content,
      enabled: section.enabled,
      sort_order: section.sort_order,
    })),
    actorUserId,
  });
}

export async function listRecommendationRuleSets(): Promise<RecommendationRuleSetRecord[]> {
  const result = await query<RecommendationRuleSetRecord>(
    `SELECT *
       FROM recommendation_rule_sets
      ORDER BY updated_at DESC, id DESC`,
  );
  return result.rows.map((row) => ({
    ...row,
    id: asNumber(row.id),
  }));
}

export async function getRecommendationRuleSetById(id: number): Promise<RecommendationRuleSetDetail | null> {
  return transaction(async (client) => getRecommendationRuleSetByIdTx(client, id));
}

export async function createRecommendationRuleSet(input: {
  name: string;
  status?: RecommendationStudioEntityStatus;
  notes?: string;
  rules?: Array<{
    name: string;
    stage: RecommendationStudioRuleStage;
    priority?: number;
    enabled?: boolean;
    conditions_json?: RecommendationRuleConditions;
    actions_json?: RecommendationRuleActions;
    notes?: string;
  }>;
  actorUserId: string;
}): Promise<RecommendationRuleSetDetail> {
  return transaction(async (client) => {
    const key = `${slugifyKey(input.name, 'rules')}-${randomUUID().slice(0, 8)}`;
    const created = await client.query<RecommendationRuleSetRecord>(
      `INSERT INTO recommendation_rule_sets (
         rule_set_key, name, status, notes, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING *`,
      [key, input.name.trim(), input.status ?? 'draft', input.notes?.trim() ?? '', input.actorUserId],
    );
    const ruleSet = created.rows[0]!;
    for (const rule of input.rules ?? []) {
      await client.query(
        `INSERT INTO recommendation_rules (
           rule_set_id, name, stage, priority, enabled, conditions_json, actions_json, notes
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
        [
          ruleSet.id,
          rule.name.trim(),
          rule.stage,
          rule.priority ?? 100,
          rule.enabled ?? true,
          JSON.stringify(rule.conditions_json ?? {}),
          JSON.stringify(rule.actions_json ?? {}),
          rule.notes ?? '',
        ],
      );
    }
    await appendAuditLog(client, 'rule_set', ruleSet.id, 'created', input.actorUserId, {
      ruleSetKey: ruleSet.rule_set_key,
      ruleCount: input.rules?.length ?? 0,
    });
    const detail = await getRecommendationRuleSetByIdTx(client, ruleSet.id);
    if (!detail) throw new Error('Failed to reload rule set');
    return detail;
  });
}

export async function updateRecommendationRuleSet(input: {
  id: number;
  name: string;
  status: RecommendationStudioEntityStatus;
  notes: string;
  rules: Array<{
    name: string;
    stage: RecommendationStudioRuleStage;
    priority: number;
    enabled: boolean;
    conditions_json: RecommendationRuleConditions;
    actions_json: RecommendationRuleActions;
    notes: string;
  }>;
  actorUserId: string;
}): Promise<RecommendationRuleSetDetail | null> {
  return transaction(async (client) => {
    await assertRuleSetEditable(client, input.id);
    const before = await getRecommendationRuleSetByIdTx(client, input.id);
    const updated = await client.query<RecommendationRuleSetRecord>(
      `UPDATE recommendation_rule_sets
          SET name = $2,
              status = $3,
              notes = $4,
              updated_by = $5,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [input.id, input.name.trim(), input.status, input.notes ?? '', input.actorUserId],
    );
    if (!updated.rows[0]) return null;
    await client.query('DELETE FROM recommendation_rules WHERE rule_set_id = $1', [input.id]);
    for (const rule of input.rules) {
      await client.query(
        `INSERT INTO recommendation_rules (
           rule_set_id, name, stage, priority, enabled, conditions_json, actions_json, notes
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
        [
          input.id,
          rule.name.trim(),
          rule.stage,
          rule.priority,
          rule.enabled,
          JSON.stringify(rule.conditions_json ?? {}),
          JSON.stringify(rule.actions_json ?? {}),
          rule.notes ?? '',
        ],
      );
    }
    await appendAuditLog(client, 'rule_set', input.id, 'updated', input.actorUserId, {
      ruleCount: input.rules.length,
      status: input.status,
    }, {
      beforeJson: before ? { name: before.name, status: before.status, rules: before.rules } : {},
      afterJson: {
        name: input.name.trim(),
        status: input.status,
        rules: input.rules,
      },
    });
    return getRecommendationRuleSetByIdTx(client, input.id);
  });
}

export async function cloneRecommendationRuleSet(id: number, actorUserId: string): Promise<RecommendationRuleSetDetail | null> {
  const detail = await getRecommendationRuleSetById(id);
  if (!detail) return null;
  return createRecommendationRuleSet({
    name: `${detail.name} Copy`,
    status: 'draft',
    notes: detail.notes,
    rules: detail.rules.map((rule) => ({
      name: rule.name,
      stage: rule.stage,
      priority: rule.priority,
      enabled: rule.enabled,
      conditions_json: rule.conditions_json,
      actions_json: rule.actions_json,
      notes: rule.notes,
    })),
    actorUserId,
  });
}

export async function createRecommendationRule(input: {
  ruleSetId: number;
  name: string;
  stage: RecommendationStudioRuleStage;
  priority?: number;
  enabled?: boolean;
  conditions_json?: RecommendationRuleConditions;
  actions_json?: RecommendationRuleActions;
  notes?: string;
  actorUserId: string;
}): Promise<RecommendationRuleSetDetail | null> {
  return transaction(async (client) => {
    await assertRuleSetEditable(client, input.ruleSetId);
    const before = await getRecommendationRuleSetByIdTx(client, input.ruleSetId);
    if (!before) return null;
    await client.query(
      `INSERT INTO recommendation_rules (
         rule_set_id, name, stage, priority, enabled, conditions_json, actions_json, notes
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        input.ruleSetId,
        input.name.trim(),
        input.stage,
        input.priority ?? 100,
        input.enabled ?? true,
        JSON.stringify(input.conditions_json ?? {}),
        JSON.stringify(input.actions_json ?? {}),
        input.notes ?? '',
      ],
    );
    const after = await getRecommendationRuleSetByIdTx(client, input.ruleSetId);
    await appendAuditLog(client, 'rule_set', input.ruleSetId, 'rule_created', input.actorUserId, {
      stage: input.stage,
      priority: input.priority ?? 100,
    }, {
      beforeJson: before ? { rules: before.rules } : {},
      afterJson: after ? { rules: after.rules } : {},
      notes: input.notes ?? '',
    });
    return after;
  });
}

export async function updateRecommendationRule(input: {
  ruleId: number;
  name: string;
  stage: RecommendationStudioRuleStage;
  priority: number;
  enabled: boolean;
  conditions_json: RecommendationRuleConditions;
  actions_json: RecommendationRuleActions;
  notes: string;
  actorUserId: string;
}): Promise<RecommendationRuleSetDetail | null> {
  return transaction(async (client) => {
    const ruleResult = await client.query<RecommendationRuleRecord & { conditions_json: string | RecommendationRuleConditions; actions_json: string | RecommendationRuleActions }>(
      'SELECT * FROM recommendation_rules WHERE id = $1 LIMIT 1',
      [input.ruleId],
    );
    const rule = ruleResult.rows[0] ? normalizeRuleRecord(ruleResult.rows[0]) : null;
    if (!rule) return null;
    await assertRuleSetEditable(client, rule.rule_set_id);
    const before = await getRecommendationRuleSetByIdTx(client, rule.rule_set_id);
    await client.query(
      `UPDATE recommendation_rules
          SET name = $2,
              stage = $3,
              priority = $4,
              enabled = $5,
              conditions_json = $6::jsonb,
              actions_json = $7::jsonb,
              notes = $8,
              updated_at = NOW()
        WHERE id = $1`,
      [
        input.ruleId,
        input.name.trim(),
        input.stage,
        input.priority,
        input.enabled,
        JSON.stringify(input.conditions_json ?? {}),
        JSON.stringify(input.actions_json ?? {}),
        input.notes ?? '',
      ],
    );
    const after = await getRecommendationRuleSetByIdTx(client, rule.rule_set_id);
    await appendAuditLog(client, 'rule_set', rule.rule_set_id, 'rule_updated', input.actorUserId, {
      ruleId: input.ruleId,
    }, {
      beforeJson: before ? { rules: before.rules } : {},
      afterJson: after ? { rules: after.rules } : {},
      notes: input.notes ?? '',
    });
    return after;
  });
}

export async function toggleRecommendationRule(input: {
  ruleId: number;
  enabled: boolean;
  actorUserId: string;
}): Promise<RecommendationRuleSetDetail | null> {
  return transaction(async (client) => {
    const ruleResult = await client.query<RecommendationRuleRecord & { conditions_json: string | RecommendationRuleConditions; actions_json: string | RecommendationRuleActions }>(
      'SELECT * FROM recommendation_rules WHERE id = $1 LIMIT 1',
      [input.ruleId],
    );
    const rule = ruleResult.rows[0] ? normalizeRuleRecord(ruleResult.rows[0]) : null;
    if (!rule) return null;
    await assertRuleSetEditable(client, rule.rule_set_id);
    const before = await getRecommendationRuleSetByIdTx(client, rule.rule_set_id);
    await client.query(
      `UPDATE recommendation_rules
          SET enabled = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [input.ruleId, input.enabled],
    );
    const after = await getRecommendationRuleSetByIdTx(client, rule.rule_set_id);
    await appendAuditLog(client, 'rule_set', rule.rule_set_id, 'rule_toggled', input.actorUserId, {
      ruleId: input.ruleId,
      enabled: input.enabled,
    }, {
      beforeJson: before ? { rules: before.rules } : {},
      afterJson: after ? { rules: after.rules } : {},
    });
    return after;
  });
}

export async function listRecommendationReleases(): Promise<RecommendationReleaseRecord[]> {
  const result = await query<RecommendationReleaseRecord>(
    `SELECT *
       FROM recommendation_releases
      ORDER BY is_active DESC, created_at DESC, id DESC`,
  );
  return result.rows.map((row) => ({
    ...row,
    id: asNumber(row.id),
    prompt_template_id: asNumber(row.prompt_template_id),
    rule_set_id: asNumber(row.rule_set_id),
    rollback_of_release_id: row.rollback_of_release_id == null ? null : asNumber(row.rollback_of_release_id),
  }));
}

export async function getRecommendationReleaseById(id: number): Promise<RecommendationReleaseDetail | null> {
  return transaction(async (client) => getRecommendationReleaseByIdTx(client, id));
}

export async function getActiveRecommendationRelease(): Promise<RecommendationReleaseDetail | null> {
  const row = await transaction(async (client) => getActiveReleaseRecordTx(client));
  if (!row) return null;
  return getRecommendationReleaseById(row.id);
}

export async function createRecommendationRelease(input: {
  name: string;
  promptTemplateId: number;
  ruleSetId: number;
  status?: RecommendationStudioEntityStatus;
  notes?: string;
  rollbackOfReleaseId?: number | null;
  actorUserId: string;
}): Promise<RecommendationReleaseDetail> {
  return transaction(async (client) => {
    const key = `${slugifyKey(input.name, 'release')}-${randomUUID().slice(0, 8)}`;
    const created = await client.query<RecommendationReleaseRecord>(
      `INSERT INTO recommendation_releases (
         release_key, name, prompt_template_id, rule_set_id, status, activation_scope, replay_validation_status, notes, rollback_of_release_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, 'global', 'not_validated', $6, $7, $8, $8)
       RETURNING *`,
      [
        key,
        input.name.trim(),
        input.promptTemplateId,
        input.ruleSetId,
        input.status ?? 'draft',
        input.notes ?? '',
        input.rollbackOfReleaseId ?? null,
        input.actorUserId,
      ],
    );
    const release = created.rows[0]!;
    await appendAuditLog(client, 'release', release.id, 'created', input.actorUserId, {
      releaseKey: release.release_key,
      promptTemplateId: release.prompt_template_id,
      ruleSetId: release.rule_set_id,
    }, {
      afterJson: {
        name: release.name,
        promptTemplateId: release.prompt_template_id,
        ruleSetId: release.rule_set_id,
        replayValidationStatus: release.replay_validation_status,
      },
    });
    const detail = await getRecommendationReleaseByIdTx(client, release.id);
    if (!detail) throw new Error('Failed to reload release');
    return detail;
  });
}

export async function activateRecommendationRelease(releaseId: number, actorUserId: string): Promise<RecommendationReleaseDetail | null> {
  return transaction(async (client) => {
    const targetBefore = await getRecommendationReleaseByIdTx(client, releaseId);
    if (!targetBefore) return null;
    if (targetBefore.replay_validation_status !== 'validated') {
      throw new Error('RELEASE_NOT_VALIDATED');
    }
    await client.query(
      `UPDATE recommendation_releases
          SET is_active = FALSE,
              status = CASE WHEN status = 'active' THEN 'archived' ELSE status END,
              updated_at = NOW()`,
    );
    const updated = await client.query<RecommendationReleaseRecord>(
      `UPDATE recommendation_releases
          SET is_active = TRUE,
              status = 'active',
              activated_by = $2,
              activated_at = NOW(),
              updated_by = $2,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [releaseId, actorUserId],
    );
    if (!updated.rows[0]) return null;
    await appendAuditLog(client, 'release', releaseId, 'activated', actorUserId, {}, {
      beforeJson: {
        isActive: targetBefore.is_active,
        status: targetBefore.status,
        replayValidationStatus: targetBefore.replay_validation_status,
      },
      afterJson: {
        isActive: true,
        status: 'active',
        replayValidationStatus: targetBefore.replay_validation_status,
      },
    });
    return getRecommendationReleaseByIdTx(client, releaseId);
  });
}

export async function createRollbackRecommendationRelease(targetReleaseId: number, actorUserId: string): Promise<RecommendationReleaseDetail | null> {
  const target = await getRecommendationReleaseById(targetReleaseId);
  if (!target) return null;
  return createRecommendationRelease({
    name: `${target.name} Rollback`,
    promptTemplateId: target.prompt_template_id,
    ruleSetId: target.rule_set_id,
    status: 'candidate',
    notes: `Rollback clone of release ${target.id}`,
    rollbackOfReleaseId: target.id,
    actorUserId,
  });
}

export async function listRecommendationReplayRuns(limit = 20): Promise<RecommendationReplayRunRecord[]> {
  const result = await query<RecommendationReplayRunRecord & {
    source_filters: string | Record<string, unknown>;
    summary_json: string | Record<string, unknown>;
    release_snapshot_json: string | Record<string, unknown>;
  }>(
    `SELECT *
       FROM recommendation_replay_runs
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map(normalizeReplayRunRecord);
}

export async function getRecommendationReplayRunById(id: number): Promise<RecommendationReplayRunRecord | null> {
  const result = await query<RecommendationReplayRunRecord & {
    source_filters: string | Record<string, unknown>;
    summary_json: string | Record<string, unknown>;
    release_snapshot_json: string | Record<string, unknown>;
  }>(
    'SELECT * FROM recommendation_replay_runs WHERE id = $1 LIMIT 1',
    [id],
  );
  return result.rows[0] ? normalizeReplayRunRecord(result.rows[0]) : null;
}

export async function listRecommendationReplayRunItems(runId: number): Promise<RecommendationReplayRunItemRecord[]> {
  const result = await query<RecommendationReplayRunItemRecord & {
    original_decision_json: string | Record<string, unknown>;
    replayed_decision_json: string | Record<string, unknown>;
    evaluation_json: string | Record<string, unknown>;
    output_summary: string | Record<string, unknown>;
  }>(
    `SELECT *
       FROM recommendation_replay_run_items
      WHERE run_id = $1
      ORDER BY id ASC`,
    [runId],
  );
  return result.rows.map(normalizeReplayRunItemRecord);
}

export async function createRecommendationReplayRun(input: {
  name: string;
  releaseId?: number | null;
  promptTemplateId: number;
  ruleSetId: number;
  sourceFilters: Record<string, unknown>;
  releaseSnapshotJson: Record<string, unknown>;
  llmModel: string;
  items: Array<{
    source_kind: 'recommendation' | 'snapshot';
    source_ref: string;
    recommendation_id?: number | null;
    snapshot_id?: number | null;
    match_id?: string | null;
    original_decision_json?: Record<string, unknown>;
  }>;
  actorUserId: string;
}): Promise<RecommendationReplayRunRecord> {
  return transaction(async (client) => {
    const runKey = `replay-${randomUUID()}`;
    const runResult = await client.query<RecommendationReplayRunRecord>(
      `INSERT INTO recommendation_replay_runs (
         run_key, name, release_id, prompt_template_id, rule_set_id, status, source_filters, release_snapshot_json, total_items, llm_mode, llm_model, created_by
       ) VALUES ($1, $2, $3, $4, $5, 'queued', $6::jsonb, $7::jsonb, $8, 'real', $9, $10)
       RETURNING *`,
      [
        runKey,
        input.name.trim(),
        input.releaseId ?? null,
        input.promptTemplateId,
        input.ruleSetId,
        JSON.stringify(input.sourceFilters ?? {}),
        JSON.stringify(input.releaseSnapshotJson ?? {}),
        input.items.length,
        input.llmModel,
        input.actorUserId,
      ],
    );
    const run = runResult.rows[0]!;
    for (const item of input.items) {
      await client.query(
        `INSERT INTO recommendation_replay_run_items (
           run_id, source_kind, source_ref, recommendation_id, snapshot_id, match_id, original_decision_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          run.id,
          item.source_kind,
          item.source_ref,
          item.recommendation_id ?? null,
          item.snapshot_id ?? null,
          item.match_id ?? null,
          JSON.stringify(item.original_decision_json ?? {}),
        ],
      );
    }
    await appendAuditLog(client, 'replay_run', run.id, 'created', input.actorUserId, {
      totalItems: input.items.length,
      releaseId: input.releaseId ?? null,
      llmModel: input.llmModel,
    }, {
      afterJson: {
        releaseSnapshot: input.releaseSnapshotJson,
        sourceFilters: input.sourceFilters,
      },
    });
    return normalizeReplayRunRecord(run as RecommendationReplayRunRecord & {
      source_filters: string | Record<string, unknown>;
      summary_json: string | Record<string, unknown>;
      release_snapshot_json: string | Record<string, unknown>;
    });
  });
}

export async function markRecommendationReplayRunStarted(runId: number): Promise<void> {
  await query(
    `UPDATE recommendation_replay_runs
        SET status = 'running',
            started_at = COALESCE(started_at, NOW())
      WHERE id = $1`,
    [runId],
  ).catch(() => undefined);
  await query(
    `UPDATE recommendation_releases
        SET replay_validation_status = 'running',
            updated_at = NOW()
      WHERE id = (SELECT release_id FROM recommendation_replay_runs WHERE id = $1 AND release_id IS NOT NULL)`,
    [runId],
  ).catch(() => undefined);
}

export async function updateRecommendationReplayRunProgress(runId: number, completedItems: number): Promise<void> {
  await query(
    `UPDATE recommendation_replay_runs
        SET completed_items = $2
      WHERE id = $1`,
    [runId, completedItems],
  );
}

export async function completeRecommendationReplayRun(
  runId: number,
  summaryJson: Record<string, unknown>,
  options: { failedItems?: number } = {},
): Promise<void> {
  const status = (options.failedItems ?? 0) > 0 ? 'completed_with_errors' : 'completed';
  await query(
    `UPDATE recommendation_replay_runs
        SET status = $3,
            completed_items = total_items,
            summary_json = $2::jsonb,
            completed_at = NOW()
      WHERE id = $1
        AND status <> 'canceled'`,
    [runId, JSON.stringify(summaryJson ?? {}), status],
  );
  await query(
    `UPDATE recommendation_releases
        SET replay_validation_status = 'validated',
            status = CASE WHEN status = 'draft' THEN 'validated' ELSE status END,
            updated_at = NOW()
      WHERE id = (
        SELECT release_id
          FROM recommendation_replay_runs
         WHERE id = $1
           AND release_id IS NOT NULL
           AND status <> 'canceled'
      )`,
    [runId],
  );
}

export async function failRecommendationReplayRun(runId: number, errorMessage: string): Promise<void> {
  await query(
    `UPDATE recommendation_replay_runs
        SET status = 'failed',
            error_message = $2,
            completed_at = NOW()
      WHERE id = $1
        AND status <> 'canceled'`,
    [runId, errorMessage],
  );
  await query(
    `UPDATE recommendation_releases
        SET replay_validation_status = 'failed',
            updated_at = NOW()
      WHERE id = (
        SELECT release_id
          FROM recommendation_replay_runs
         WHERE id = $1
           AND release_id IS NOT NULL
           AND status <> 'canceled'
      )`,
    [runId],
  ).catch(() => undefined);
}

export async function cancelRecommendationReplayRun(runId: number, actorUserId: string): Promise<RecommendationReplayRunRecord | null> {
  return transaction(async (client) => {
    const beforeResult = await client.query<RecommendationReplayRunRecord & {
      source_filters: string | Record<string, unknown>;
      summary_json: string | Record<string, unknown>;
      release_snapshot_json: string | Record<string, unknown>;
    }>(
      'SELECT * FROM recommendation_replay_runs WHERE id = $1 LIMIT 1',
      [runId],
    );
    const before = beforeResult.rows[0] ? normalizeReplayRunRecord(beforeResult.rows[0]) : null;
    if (!before) return null;
    if (before.status === 'completed' || before.status === 'failed' || before.status === 'canceled') {
      return before;
    }
    const updated = await client.query<RecommendationReplayRunRecord & {
      source_filters: string | Record<string, unknown>;
      summary_json: string | Record<string, unknown>;
      release_snapshot_json: string | Record<string, unknown>;
    }>(
      `UPDATE recommendation_replay_runs
          SET status = 'canceled',
              error_message = COALESCE(error_message, 'Canceled by admin'),
              completed_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [runId],
    );
    await client.query(
      `UPDATE recommendation_replay_run_items
          SET status = CASE WHEN status IN ('queued', 'running') THEN 'canceled' ELSE status END,
              error_message = CASE WHEN status IN ('queued', 'running') THEN COALESCE(error_message, 'Canceled by admin') ELSE error_message END,
              completed_at = CASE WHEN status IN ('queued', 'running') THEN NOW() ELSE completed_at END
        WHERE run_id = $1`,
      [runId],
    );
    await client.query(
      `UPDATE recommendation_releases
          SET replay_validation_status = 'not_validated',
              updated_at = NOW()
        WHERE id = (
          SELECT release_id
            FROM recommendation_replay_runs
           WHERE id = $1
             AND release_id IS NOT NULL
        )`,
      [runId],
    );
    await appendAuditLog(client, 'replay_run', runId, 'canceled', actorUserId, {
      status: 'canceled',
    }, {
      beforeJson: { status: before.status, completedItems: before.completed_items },
      afterJson: { status: 'canceled', completedItems: before.completed_items },
      notes: 'Canceled by admin',
    });
    return updated.rows[0] ? normalizeReplayRunRecord(updated.rows[0]) : null;
  });
}

export async function setRecommendationReleaseValidationStatus(
  releaseId: number,
  status: 'not_validated' | 'running' | 'validated' | 'failed',
): Promise<void> {
  await query(
    `UPDATE recommendation_releases
        SET replay_validation_status = $2,
            status = CASE
              WHEN $2 = 'validated' AND status = 'draft' THEN 'validated'
              WHEN $2 = 'failed' AND status = 'validated' THEN 'candidate'
              ELSE status
            END,
            updated_at = NOW()
      WHERE id = $1`,
    [releaseId, status],
  );
}

export async function markRecommendationReplayRunItemRunning(itemId: number): Promise<void> {
  await query(
    `UPDATE recommendation_replay_run_items
        SET status = 'running'
      WHERE id = $1`,
    [itemId],
  );
}

export async function completeRecommendationReplayRunItem(
  itemId: number,
  payload: {
    replayedDecisionJson: Record<string, unknown>;
    evaluationJson: Record<string, unknown>;
    outputSummary: Record<string, unknown>;
  },
): Promise<void> {
  await query(
    `UPDATE recommendation_replay_run_items
        SET status = 'completed',
            replayed_decision_json = $2::jsonb,
            evaluation_json = $3::jsonb,
            output_summary = $4::jsonb,
            completed_at = NOW()
      WHERE id = $1`,
    [
      itemId,
      JSON.stringify(payload.replayedDecisionJson ?? {}),
      JSON.stringify(payload.evaluationJson ?? {}),
      JSON.stringify(payload.outputSummary ?? {}),
    ],
  );
}

export async function failRecommendationReplayRunItem(itemId: number, errorMessage: string): Promise<void> {
  await query(
    `UPDATE recommendation_replay_run_items
        SET status = 'failed',
            error_message = $2,
            completed_at = NOW()
      WHERE id = $1`,
    [itemId, errorMessage],
  );
}

export async function listRecommendationReleaseAuditLogs(limit = 100): Promise<RecommendationReleaseAuditLogRecord[]> {
  const result = await query<RecommendationReleaseAuditLogRecord & {
    metadata: string | Record<string, unknown>;
    before_json: string | Record<string, unknown>;
    after_json: string | Record<string, unknown>;
  }>(
    `SELECT *
       FROM recommendation_release_audit_logs
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map(normalizeAuditLogRecord);
}

export async function findRecommendationIdsForReplaySelection(input: {
  dateFrom?: string | null;
  dateTo?: string | null;
  league?: string | null;
  marketFamily?: string | null;
  periodKind?: 'ft' | 'h1' | null;
  result?: string | null;
  riskLevel?: string | null;
  limit?: number | null;
}): Promise<number[]> {
  const conditions = [
    `COALESCE(result, '') <> ''`,
    'odds_snapshot IS NOT NULL',
    'stats_snapshot IS NOT NULL',
  ];
  const params: unknown[] = [];
  let index = 1;

  if (input.dateFrom) {
    conditions.push(`timestamp >= $${index++}`);
    params.push(input.dateFrom);
  }
  if (input.dateTo) {
    conditions.push(`timestamp <= $${index++}`);
    params.push(input.dateTo);
  }
  if (input.league) {
    conditions.push(`league ILIKE $${index++}`);
    params.push(`%${input.league.trim()}%`);
  }
  if (input.result) {
    conditions.push(`result = $${index++}`);
    params.push(input.result.trim());
  }
  if (input.riskLevel) {
    conditions.push(`risk_level = $${index++}`);
    params.push(input.riskLevel.trim());
  }
  if (input.periodKind === 'h1') {
    conditions.push(`bet_type LIKE 'ht_%'`);
  } else if (input.periodKind === 'ft') {
    conditions.push(`bet_type NOT LIKE 'ht_%'`);
  }
  if (input.marketFamily) {
    const family = input.marketFamily.trim().toLowerCase();
    if (family === 'goals_ou') {
      conditions.push(`(bet_type LIKE 'over_%' OR bet_type LIKE 'under_%' OR bet_type LIKE 'ht_over_%' OR bet_type LIKE 'ht_under_%')`);
    } else if (family === 'corners') {
      conditions.push(`bet_type LIKE 'corners_%'`);
    } else if (family === '1x2') {
      conditions.push(`(bet_type LIKE '1x2_%' OR bet_type LIKE 'ht_1x2_%')`);
    } else if (family === 'asian_handicap') {
      conditions.push(`(bet_type LIKE 'asian_handicap_%' OR bet_type LIKE 'ht_asian_handicap_%')`);
    } else if (family === 'btts') {
      conditions.push(`(bet_type LIKE 'btts_%' OR bet_type LIKE 'ht_btts_%')`);
    }
  }

  const limit = Math.max(1, Math.min(20, Number(input.limit ?? 20) || 20));
  params.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<{ id: string }>(
    `SELECT id::text
       FROM recommendations
       ${where}
      ORDER BY COALESCE(settled_at, timestamp) DESC NULLS LAST, id DESC
      LIMIT $${index}`,
    params,
  );
  return result.rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
}
