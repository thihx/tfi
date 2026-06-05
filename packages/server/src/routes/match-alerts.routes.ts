import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireCurrentUser } from '../lib/authz.js';
import * as rulesRepo from '../repos/match-alert-rules.repo.js';
import * as matchesRepo from '../repos/matches.repo.js';
import * as snapshotsRepo from '../repos/match-snapshots.repo.js';
import { buildMatchAlertContext } from '../lib/match-alert-context.js';
import { buildMatchStartRuleJson, getSystemConditionAlertPreset } from '../lib/match-alert-presets.js';
import { evaluateMatchAlertRule, type MatchAlertKind } from '../lib/match-alert-rule-engine.js';
import { compileMatchAlertFreeTextRule } from '../lib/match-alert-free-text-compiler.js';

interface RuleBody {
  matchId?: unknown;
  alertKind?: unknown;
  enabled?: unknown;
  source?: unknown;
  sourceRef?: unknown;
  ruleJson?: unknown;
  presetId?: unknown;
  conditionText?: unknown;
  cooldownMinutes?: unknown;
  oncePerMatch?: unknown;
  channelPolicy?: unknown;
  metadata?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAlertKind(value: unknown): MatchAlertKind | null {
  return value === 'match_start' || value === 'condition_signal' ? value : null;
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : undefined;
}

async function compileRuleFromBody(body: RuleBody, alertKind: MatchAlertKind): Promise<{
  ruleJson: Record<string, unknown> | null;
  compiledStatus: 'compiled' | 'unsupported';
  compileSource?: string;
  compileModel?: string;
  unsupportedReason?: string;
}> {
  if (alertKind === 'match_start') {
    return { ruleJson: buildMatchStartRuleJson() as Record<string, unknown>, compiledStatus: 'compiled' };
  }
  if (typeof body.presetId === 'string') {
    const preset = getSystemConditionAlertPreset(body.presetId);
    if (preset) return { ruleJson: preset.ruleJson as Record<string, unknown>, compiledStatus: 'compiled' };
  }
  if (isRecord(body.ruleJson)) return { ruleJson: body.ruleJson, compiledStatus: 'compiled' };
  if (typeof body.conditionText === 'string' && body.conditionText.trim()) {
    const compiled = await compileMatchAlertFreeTextRule(body.conditionText);
    return {
      ruleJson: compiled.ruleJson ? compiled.ruleJson as Record<string, unknown> : null,
      compiledStatus: compiled.status,
      compileSource: compiled.source,
      compileModel: compiled.model,
      unsupportedReason: compiled.unsupportedReason,
    };
  }
  return { ruleJson: null, compiledStatus: 'unsupported', unsupportedReason: 'ruleJson, presetId, or conditionText is required' };
}

async function evaluatePreview(
  reply: FastifyReply,
  matchId: string,
  alertKind: MatchAlertKind,
  ruleJson: Record<string, unknown>,
) {
  const [matches, snapshot] = await Promise.all([
    matchesRepo.getMatchesByIds([matchId]),
    snapshotsRepo.getLatestSnapshot(matchId),
  ]);
  const match = matches[0];
  if (!match) return reply.code(404).send({ error: 'Match not found' });
  const context = buildMatchAlertContext(match, snapshot);
  return {
    context,
    evaluation: evaluateMatchAlertRule(alertKind, ruleJson, context),
  };
}

export async function matchAlertsRoutes(app: FastifyInstance) {
  const getSettings = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return rulesRepo.getMatchAlertSettings(user.userId);
  };

  const saveSettings = async (
    req: FastifyRequest<{ Body: Partial<rulesRepo.UserMatchAlertSettings> }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return rulesRepo.saveMatchAlertSettings(user.userId, req.body ?? {});
  };

  app.get('/api/me/match-alert-settings', getSettings);
  app.put<{ Body: Partial<rulesRepo.UserMatchAlertSettings> }>('/api/me/match-alert-settings', saveSettings);

  app.get('/api/me/match-alert-presets', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return rulesRepo.getConditionAlertPresets(user.userId);
  });

  app.put<{
    Body: { presets?: Array<Pick<rulesRepo.ConditionAlertPresetView, 'id' | 'enabled' | 'defaultCooldownMinutes' | 'ruleJson'>> };
  }>('/api/me/match-alert-presets', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return rulesRepo.saveConditionAlertPresets(user.userId, Array.isArray(req.body?.presets) ? req.body.presets : []);
  });

  app.post('/api/me/match-alert-presets/reset', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return rulesRepo.resetConditionAlertPresets(user.userId);
  });

  app.get<{
    Querystring: { matchId?: string; alertKind?: MatchAlertKind };
  }>('/api/me/match-alert-rules', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const alertKind = normalizeAlertKind(req.query.alertKind);
    return rulesRepo.listMatchAlertRules(user.userId, {
      matchId: typeof req.query.matchId === 'string' ? req.query.matchId : undefined,
      alertKind: alertKind ?? undefined,
    });
  });

  app.post<{ Body: RuleBody }>('/api/me/match-alert-rules', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const alertKind = normalizeAlertKind(req.body?.alertKind);
    if (!alertKind) return reply.code(400).send({ error: 'alertKind must be match_start or condition_signal' });
    const matchId = typeof req.body?.matchId === 'string' && req.body.matchId.trim() ? req.body.matchId.trim() : null;
    if (!matchId) return reply.code(400).send({ error: 'matchId is required' });
    const compiled = await compileRuleFromBody(req.body ?? {}, alertKind);
    if (!compiled.ruleJson) {
      return reply.code(400).send({
        error: 'ruleJson, presetId, or supported conditionText is required',
        compiledStatus: compiled.compiledStatus,
        unsupportedReason: compiled.unsupportedReason,
      });
    }
    const created = await rulesRepo.createMatchAlertRule(user.userId, {
      matchId,
      alertKind,
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : true,
      source: typeof req.body?.source === 'string' ? req.body.source : 'manual',
      sourceRef: isRecord(req.body?.sourceRef) ? req.body.sourceRef : {},
      ruleJson: compiled.ruleJson,
      compiledStatus: 'compiled',
      cooldownMinutes: toNumber(req.body?.cooldownMinutes) ?? 0,
      oncePerMatch: typeof req.body?.oncePerMatch === 'boolean' ? req.body.oncePerMatch : true,
      channelPolicy: isRecord(req.body?.channelPolicy) ? req.body.channelPolicy : {},
      metadata: {
        ...(isRecord(req.body?.metadata) ? req.body.metadata : {}),
        ...(typeof req.body?.conditionText === 'string' && req.body.conditionText.trim()
          ? {
              conditionText: req.body.conditionText.trim(),
              compileSource: compiled.compileSource,
              compileModel: compiled.compileModel,
            }
          : {}),
      },
    });
    return reply.code(201).send(created);
  });

  app.patch<{
    Params: { id: string };
    Body: RuleBody;
  }>('/api/me/match-alert-rules/:id', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const ruleId = Number(req.params.id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) return reply.code(400).send({ error: 'Invalid rule id' });
    const alertKind = normalizeAlertKind(req.body?.alertKind);
    const updated = await rulesRepo.updateMatchAlertRule(user.userId, ruleId, {
      matchId: typeof req.body?.matchId === 'string' ? req.body.matchId : undefined,
      alertKind: alertKind ?? undefined,
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
      source: typeof req.body?.source === 'string' ? req.body.source : undefined,
      sourceRef: isRecord(req.body?.sourceRef) ? req.body.sourceRef : undefined,
      ruleJson: isRecord(req.body?.ruleJson) ? req.body.ruleJson : undefined,
      cooldownMinutes: toNumber(req.body?.cooldownMinutes),
      oncePerMatch: typeof req.body?.oncePerMatch === 'boolean' ? req.body.oncePerMatch : undefined,
      channelPolicy: isRecord(req.body?.channelPolicy) ? req.body.channelPolicy : undefined,
      metadata: isRecord(req.body?.metadata) ? req.body.metadata : undefined,
    });
    if (!updated) return reply.code(404).send({ error: 'Rule not found' });
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/me/match-alert-rules/:id', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const ruleId = Number(req.params.id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) return reply.code(400).send({ error: 'Invalid rule id' });
    return { deleted: await rulesRepo.deleteMatchAlertRule(user.userId, ruleId) };
  });

  app.post<{ Body: RuleBody }>('/api/me/match-alert-rules/compile', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const alertKind = normalizeAlertKind(req.body?.alertKind);
    if (!alertKind) return reply.code(400).send({ error: 'alertKind must be match_start or condition_signal' });
    const compiled = await compileRuleFromBody(req.body ?? {}, alertKind);
    if (!compiled.ruleJson) {
      return {
        compiledStatus: compiled.compiledStatus,
        alertKind,
        unsupportedReason: compiled.unsupportedReason,
      };
    }
    return {
      compiledStatus: 'compiled',
      alertKind,
      ruleJson: compiled.ruleJson,
      compileSource: compiled.compileSource,
      compileModel: compiled.compileModel,
    };
  });

  app.post<{ Body: RuleBody }>('/api/me/match-alert-rules/evaluate-preview', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const alertKind = normalizeAlertKind(req.body?.alertKind);
    if (!alertKind) return reply.code(400).send({ error: 'alertKind must be match_start or condition_signal' });
    const matchId = typeof req.body?.matchId === 'string' && req.body.matchId.trim() ? req.body.matchId.trim() : '';
    if (!matchId) return reply.code(400).send({ error: 'matchId is required' });
    const compiled = await compileRuleFromBody(req.body ?? {}, alertKind);
    if (!compiled.ruleJson) {
      return reply.code(400).send({
        error: 'ruleJson, presetId, or supported conditionText is required',
        compiledStatus: compiled.compiledStatus,
        unsupportedReason: compiled.unsupportedReason,
      });
    }
    return evaluatePreview(reply, matchId, alertKind, compiled.ruleJson);
  });
}
