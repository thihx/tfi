import { config } from '../config.js';
import { query } from '../db/pool.js';
import { listAiGatewayAdminRecipients } from '../repos/ai-gateway.repo.js';
import { getSubscriptionsByUserId, deleteSubscription, updateLastUsed } from '../repos/push-subscriptions.repo.js';
import { audit } from './audit.js';
import { sendTelegramMessage } from './telegram.js';
import { isWebPushConfigured, sendWebPushNotification } from './web-push.js';

export type AiGatewayMode = 'observe' | 'enforce' | 'off';
export type AiGatewayDecision = 'allow' | 'block' | 'observe';
export type AiGatewaySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface AiGatewayContext {
  appId?: string;
  provider?: string;
  model: string;
  operation?: string;
  featureKey?: string;
  matchId?: string | null;
  runId?: string | null;
  promptVersion?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AiGatewayEvaluation {
  allowed: boolean;
  mode: AiGatewayMode;
  decision: AiGatewayDecision;
  reason: string;
  severity: AiGatewaySeverity;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

export interface AiGatewayLogInput extends AiGatewayContext {
  mode: AiGatewayMode;
  status: 'started' | 'succeeded' | 'failed' | 'blocked';
  decision: AiGatewayDecision;
  reason?: string;
  severity?: AiGatewaySeverity;
  estimatedInputTokens: number;
  estimatedOutputTokens?: number;
  estimatedCostUsd: number;
  promptChars: number;
  responseChars?: number;
  latencyMs?: number | null;
  error?: string | null;
}

export class AiGatewayBlockedError extends Error {
  readonly evaluation: AiGatewayEvaluation;
  readonly context: AiGatewayContext;

  constructor(message: string, evaluation: AiGatewayEvaluation, context: AiGatewayContext) {
    super(message);
    this.name = 'AiGatewayBlockedError';
    this.evaluation = evaluation;
    this.context = context;
  }
}

function splitEnvList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.ceil(trimmed.length / 4) : 0;
}

function getModelCostPerMillion(model: string): { input: number; output: number } {
  const normalized = model.toLowerCase();
  if (normalized.includes('pro')) {
    return {
      input: Number(process.env['AI_GATEWAY_GEMINI_PRO_INPUT_USD_PER_1M'] || 1.25),
      output: Number(process.env['AI_GATEWAY_GEMINI_PRO_OUTPUT_USD_PER_1M'] || 10),
    };
  }
  return {
    input: Number(process.env['AI_GATEWAY_GEMINI_FLASH_INPUT_USD_PER_1M'] || 0.15),
    output: Number(process.env['AI_GATEWAY_GEMINI_FLASH_OUTPUT_USD_PER_1M'] || 0.60),
  };
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const cost = getModelCostPerMillion(model);
  return Number((((inputTokens * cost.input) + (outputTokens * cost.output)) / 1_000_000).toFixed(8));
}

function effectiveMode(): AiGatewayMode {
  const raw = String(process.env['AI_GATEWAY_MODE'] || 'enforce').trim().toLowerCase();
  if (raw === 'off' || raw === 'disabled') return 'off';
  if (raw === 'enforce') return 'enforce';
  return 'observe';
}

function normalizeContext(context: AiGatewayContext): Required<Omit<AiGatewayContext, 'metadata'>> & { metadata: Record<string, unknown> } {
  return {
    appId: context.appId || 'tfi',
    provider: context.provider || 'gemini',
    model: context.model,
    operation: context.operation || 'gemini.generate_content',
    featureKey: context.featureKey || 'tfi.unknown',
    matchId: context.matchId ?? null,
    runId: context.runId ?? null,
    promptVersion: context.promptVersion ?? null,
    metadata: context.metadata ?? {},
  };
}

async function hasOpenBreaker(context: ReturnType<typeof normalizeContext>): Promise<string | null> {
  try {
    const scopeKeys = [
      ['app', context.appId],
      ['feature', context.featureKey],
      ['operation', context.operation],
      ['provider', context.provider],
      ['model', context.model],
      ...(context.matchId ? [['match', context.matchId]] : []),
      ...(context.runId ? [['run', context.runId]] : []),
    ] as Array<[string, string]>;
    const result = await query<{ reason: string }>(
      `SELECT reason
       FROM ai_gateway_breakers
       WHERE status = 'open'
         AND (scope_type, scope_key) IN (${scopeKeys.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})
       ORDER BY updated_at DESC
       LIMIT 1`,
      scopeKeys.flatMap(([scopeType, scopeKey]) => [scopeType, scopeKey]),
    );
    return result.rows[0]?.reason ?? null;
  } catch {
    return null;
  }
}

async function countRecentEquivalentCalls(context: ReturnType<typeof normalizeContext>): Promise<number> {
  const loopWindowMinutes = Number(process.env['AI_GATEWAY_LOOP_WINDOW_MINUTES'] || 5);
  try {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM ai_gateway_logs
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 minute')
         AND operation = $2
         AND feature_key = $3
         AND COALESCE(match_id, '') = COALESCE($4, '')
         AND COALESCE(run_id, '') = COALESCE($5, '')
         AND status = 'started'`,
      [loopWindowMinutes, context.operation, context.featureKey, context.matchId, context.runId],
    );
    return Number(result.rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function openAiGatewayBreaker(input: {
  scopeType: string;
  scopeKey: string;
  reason: string;
  severity?: AiGatewaySeverity;
  metadata?: Record<string, unknown>;
}): Promise<number | null> {
  try {
    const result = await query<{ id: number }>(
      `INSERT INTO ai_gateway_breakers (scope_type, scope_key, reason, severity, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (scope_type, scope_key) WHERE status = 'open'
       DO UPDATE SET updated_at = NOW(), reason = EXCLUDED.reason, severity = EXCLUDED.severity, metadata = EXCLUDED.metadata
       RETURNING id`,
      [input.scopeType, input.scopeKey, input.reason, input.severity ?? 'high', JSON.stringify(input.metadata ?? {})],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    console.warn('[ai-gateway] Failed to open breaker:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function createAiGatewayIncident(input: {
  incidentType: string;
  title: string;
  severity?: AiGatewaySeverity;
  context: AiGatewayContext;
  breakerId?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const context = normalizeContext(input.context);
  try {
    const existing = await query<{ id: number }>(
      `SELECT id
       FROM ai_gateway_incidents
       WHERE status = 'open'
         AND incident_type = $1
         AND COALESCE(feature_key, '') = $2
         AND COALESCE(operation, '') = $3
         AND COALESCE(match_id, '') = COALESCE($4, '')
         AND COALESCE(run_id, '') = COALESCE($5, '')
         AND created_at >= NOW() - INTERVAL '30 minutes'
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.incidentType, context.featureKey, context.operation, context.matchId, context.runId],
    );
    if (existing.rows.length > 0) return;

    await query(
      `INSERT INTO ai_gateway_incidents
       (severity, incident_type, title, feature_key, operation, provider, model, match_id, run_id, breaker_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.severity ?? 'medium',
        input.incidentType,
        input.title,
        context.featureKey,
        context.operation,
        context.provider,
        context.model,
        context.matchId,
        context.runId,
        input.breakerId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (err) {
    console.warn('[ai-gateway] Failed to create incident:', err instanceof Error ? err.message : String(err));
  }

  await notifyAiGatewayIncident({
    title: input.title,
    severity: input.severity ?? 'medium',
    context,
    metadata: input.metadata ?? {},
  });
}

async function notifyAiGatewayIncident(input: {
  title: string;
  severity: AiGatewaySeverity;
  context: ReturnType<typeof normalizeContext>;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (process.env['AI_GATEWAY_ALERTS_ENABLED'] === 'false') return;

  const admins = await listAiGatewayAdminRecipients().catch((err) => {
    console.warn('[ai-gateway] Failed to resolve admin alert recipients:', err instanceof Error ? err.message : String(err));
    return [];
  });
  if (admins.length === 0) return;

  const text = [
    `<b>AI Gateway Alert</b> [${input.severity.toUpperCase()}]`,
    input.title,
    `Feature: ${input.context.featureKey}`,
    `Operation: ${input.context.operation}`,
    `Model: ${input.context.model}`,
    input.context.matchId ? `Match: ${input.context.matchId}` : '',
    input.metadata.reason ? `Reason: ${String(input.metadata.reason)}` : '',
  ].filter(Boolean).join('\n');

  const telegramTargets = admins
    .filter((admin) => admin.telegramEnabled && admin.telegramChatId)
    .map((admin) => admin.telegramChatId!)
    .filter((chatId, index, all) => all.indexOf(chatId) === index);
  if (config.telegramBotToken) {
    await Promise.all(telegramTargets.map((chatId) => sendTelegramMessage(chatId, text).catch((err) => {
      console.warn('[ai-gateway] Failed to send Telegram alert:', err instanceof Error ? err.message : String(err));
    })));
  }

  if (isWebPushConfigured()) {
    const webPushAdmins = admins.filter((admin) => admin.webPushEnabled);
    await Promise.all(webPushAdmins.map(async (admin) => {
      const subscriptions = await getSubscriptionsByUserId(admin.userId).catch(() => []);
      await Promise.all(subscriptions.map(async (subscription) => {
        const result = await sendWebPushNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          {
            title: `AI Gateway ${input.severity.toUpperCase()}`,
            body: `${input.title} (${input.context.featureKey})`,
            tag: `ai-gateway-${input.context.featureKey}-${input.metadata.reason ?? input.context.operation}`,
            url: '/settings?panel=ops',
          },
        );
        if (result.ok) {
          await updateLastUsed(subscription.endpoint).catch(() => undefined);
        } else if (result.gone) {
          await deleteSubscription(subscription.endpoint).catch(() => undefined);
        }
      }));
    }));
  }
}

export async function evaluateAiGatewayRequest(prompt: string, context: AiGatewayContext): Promise<AiGatewayEvaluation> {
  const normalized = normalizeContext(context);
  const mode = effectiveMode();
  const estimatedInputTokens = estimateTokens(prompt);
  const estimatedOutputTokens = Number(process.env['AI_GATEWAY_DEFAULT_OUTPUT_TOKEN_ESTIMATE'] || 1024);
  const estimatedCostUsd = estimateCostUsd(normalized.model, estimatedInputTokens, estimatedOutputTokens);

  const base: AiGatewayEvaluation = {
    allowed: true,
    mode,
    decision: mode === 'observe' ? 'observe' : 'allow',
    reason: 'allowed',
    severity: 'info',
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
  };

  if (mode === 'off') return base;

  const providerDisabled = splitEnvList(process.env['AI_GATEWAY_DISABLED_PROVIDERS'] || '').includes(normalized.provider.toLowerCase());
  const featureDisabled = splitEnvList(process.env['AI_GATEWAY_DISABLED_FEATURES'] || '').includes(normalized.featureKey.toLowerCase());
  const operationDisabled = splitEnvList(process.env['AI_GATEWAY_DISABLED_OPERATIONS'] || '').includes(normalized.operation.toLowerCase());
  if (providerDisabled || featureDisabled || operationDisabled) {
    return { ...base, allowed: false, decision: 'block', reason: 'kill_switch', severity: 'critical' };
  }

  const breakerReason = await hasOpenBreaker(normalized);
  if (breakerReason && mode === 'enforce') {
    return { ...base, allowed: false, decision: 'block', reason: `breaker_open:${breakerReason}`, severity: 'critical' };
  }

  const maxInputTokens = Number(process.env['AI_GATEWAY_MAX_INPUT_TOKENS'] || 80_000);
  if (estimatedInputTokens > maxInputTokens) {
    return {
      ...base,
      allowed: mode !== 'enforce',
      decision: mode === 'enforce' ? 'block' : 'observe',
      reason: 'input_token_limit_exceeded',
      severity: 'high',
    };
  }

  const maxCostUsd = Number(process.env['AI_GATEWAY_MAX_ESTIMATED_COST_USD_PER_CALL'] || 0.5);
  if (estimatedCostUsd > maxCostUsd) {
    return {
      ...base,
      allowed: mode !== 'enforce',
      decision: mode === 'enforce' ? 'block' : 'observe',
      reason: 'estimated_cost_limit_exceeded',
      severity: 'high',
    };
  }

  const recentCount = await countRecentEquivalentCalls(normalized);
  const loopThreshold = Number(process.env['AI_GATEWAY_LOOP_CALL_THRESHOLD'] || 6);
  if (recentCount >= loopThreshold) {
    const breakerScope = normalized.matchId
      ? { scopeType: 'match', scopeKey: normalized.matchId }
      : normalized.runId
        ? { scopeType: 'run', scopeKey: normalized.runId }
        : normalized.featureKey !== 'tfi.unknown'
          ? { scopeType: 'feature', scopeKey: normalized.featureKey }
          : { scopeType: 'operation', scopeKey: normalized.operation };
    const breakerId = await openAiGatewayBreaker({
      ...breakerScope,
      reason: 'loop_detected',
      severity: 'critical',
      metadata: { ...normalized.metadata, recentCount, loopThreshold },
    });
    await createAiGatewayIncident({
      incidentType: 'loop_detected',
      title: 'AI Gateway detected repeated LLM calls',
      severity: 'critical',
      context: normalized,
      breakerId,
      metadata: { reason: 'loop_detected', recentCount, loopThreshold },
    });
    return {
      ...base,
      allowed: mode !== 'enforce',
      decision: mode === 'enforce' ? 'block' : 'observe',
      reason: 'loop_detected',
      severity: 'critical',
    };
  }

  return base;
}

export async function recordAiGatewayLog(input: AiGatewayLogInput): Promise<void> {
  const context = normalizeContext(input);
  try {
    await query(
      `INSERT INTO ai_gateway_logs
       (app_id, provider, model, operation, feature_key, mode, status, decision, reason, severity,
        match_id, run_id, prompt_version, estimated_input_tokens, estimated_output_tokens,
        estimated_cost_usd, prompt_chars, response_chars, latency_ms, metadata, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        context.appId,
        context.provider,
        context.model,
        context.operation,
        context.featureKey,
        input.mode,
        input.status,
        input.decision,
        input.reason ?? null,
        input.severity ?? 'info',
        context.matchId,
        context.runId,
        context.promptVersion,
        input.estimatedInputTokens,
        input.estimatedOutputTokens ?? 0,
        input.estimatedCostUsd,
        input.promptChars,
        input.responseChars ?? 0,
        input.latencyMs ?? null,
        JSON.stringify(context.metadata),
        input.error ?? null,
      ],
    );
  } catch (err) {
    audit({
      category: 'AI_GATEWAY',
      action: `AI_GATEWAY_${input.status.toUpperCase()}`,
      outcome: input.status === 'failed' || input.status === 'blocked' ? 'FAILURE' : 'SUCCESS',
      actor: 'ai-gateway',
      match_id: context.matchId,
      duration_ms: input.latencyMs ?? null,
      metadata: {
        provider: context.provider,
        model: context.model,
        operation: context.operation,
        featureKey: context.featureKey,
        decision: input.decision,
        reason: input.reason,
      },
      error: input.error ?? null,
    });
  }
}

export function estimateAiGatewayResponseCost(model: string, inputTokens: number, outputTokens: number): number {
  return estimateCostUsd(model, inputTokens, outputTokens);
}

export function estimateAiGatewayTokens(text: string): number {
  return estimateTokens(text);
}
