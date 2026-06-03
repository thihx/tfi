// ============================================================
// Gemini API Client — shared across proxy routes and pipeline
// ============================================================

import { config } from '../config.js';
import {
  AiGatewayBlockedError,
  evaluateAiGatewayRequest,
  estimateAiGatewayResponseCost,
  estimateAiGatewayTokens,
  recordAiGatewayLog,
  type AiGatewayContext,
} from './ai-gateway.js';

export interface GeminiGenerateOptions {
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  withSearch?: boolean;
  thinkingBudget?: number | null;
  aiGatewayContext?: Omit<AiGatewayContext, 'model' | 'provider'> & Partial<Pick<AiGatewayContext, 'model' | 'provider'>>;
}

export function normalizeGeminiModelName(model: string): string {
  const trimmed = String(model || '').trim().replace(/^models\//i, '');
  return trimmed;
}

function buildGenerateRequestBody(
  prompt: string,
  options: GeminiGenerateOptions,
  includeThinkingConfig: boolean,
): string {
  const thinkingBudget = typeof options.thinkingBudget === 'number' && Number.isFinite(options.thinkingBudget)
    ? Math.max(0, Math.trunc(options.thinkingBudget))
    : null;
  return JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    ...(options.withSearch ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      temperature: options.temperature ?? 0,
      ...(options.maxOutputTokens != null ? { maxOutputTokens: options.maxOutputTokens } : {}),
      ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
    },
    ...(includeThinkingConfig && thinkingBudget != null ? { thinkingConfig: { thinkingBudget } } : {}),
  });
}

export async function generateGeminiContent(
  prompt: string,
  options: GeminiGenerateOptions = {},
): Promise<Record<string, unknown>> {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY not configured');

  const model = normalizeGeminiModelName(options.model || config.geminiModel);
  const gatewayContext: AiGatewayContext = {
    ...(options.aiGatewayContext ?? {}),
    provider: options.aiGatewayContext?.provider ?? 'gemini',
    model,
  };
  const gatewayStartedAt = Date.now();
  const gatewayEvaluation = await evaluateAiGatewayRequest(prompt, gatewayContext);
  if (!gatewayEvaluation.allowed) {
    await recordAiGatewayLog({
      ...gatewayContext,
      mode: gatewayEvaluation.mode,
      status: 'blocked',
      decision: gatewayEvaluation.decision,
      reason: gatewayEvaluation.reason,
      severity: gatewayEvaluation.severity,
      estimatedInputTokens: gatewayEvaluation.estimatedInputTokens,
      estimatedOutputTokens: gatewayEvaluation.estimatedOutputTokens,
      estimatedCostUsd: gatewayEvaluation.estimatedCostUsd,
      promptChars: prompt.length,
      latencyMs: Date.now() - gatewayStartedAt,
    });
    throw new AiGatewayBlockedError(`AI Gateway blocked Gemini call: ${gatewayEvaluation.reason}`, gatewayEvaluation, gatewayContext);
  }

  await recordAiGatewayLog({
    ...gatewayContext,
    mode: gatewayEvaluation.mode,
    status: 'started',
    decision: gatewayEvaluation.decision,
    reason: gatewayEvaluation.reason,
    severity: gatewayEvaluation.severity,
    estimatedInputTokens: gatewayEvaluation.estimatedInputTokens,
    estimatedOutputTokens: gatewayEvaluation.estimatedOutputTokens,
    estimatedCostUsd: gatewayEvaluation.estimatedCostUsd,
    promptChars: prompt.length,
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? config.geminiTimeoutMs);

  try {
    let body = buildGenerateRequestBody(prompt, options, true);
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      let text = await res.text().catch(() => '');
      const thinkingBudget = typeof options.thinkingBudget === 'number' && Number.isFinite(options.thinkingBudget)
        ? Math.max(0, Math.trunc(options.thinkingBudget))
        : null;
      const shouldRetryWithoutThinking = thinkingBudget != null
        && res.status === 400
        && /Unknown name "thinkingConfig"|Cannot find field/i.test(text);

      if (shouldRetryWithoutThinking) {
        body = buildGenerateRequestBody(prompt, options, false);
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        if (res.ok) {
          const retryData = await res.json() as Record<string, unknown>;
          const responseText = extractCandidateText(retryData);
          const outputTokens = estimateAiGatewayTokens(responseText);
          await recordAiGatewayLog({
            ...gatewayContext,
            mode: gatewayEvaluation.mode,
            status: 'succeeded',
            decision: gatewayEvaluation.decision,
            reason: gatewayEvaluation.reason,
            severity: gatewayEvaluation.severity,
            estimatedInputTokens: gatewayEvaluation.estimatedInputTokens,
            estimatedOutputTokens: outputTokens,
            estimatedCostUsd: estimateAiGatewayResponseCost(model, gatewayEvaluation.estimatedInputTokens, outputTokens),
            promptChars: prompt.length,
            responseChars: responseText.length,
            latencyMs: Date.now() - gatewayStartedAt,
          });
          return retryData;
        }
        text = await res.text().catch(() => text);
      }

      throw new Error(`Gemini API ${res.status}: ${text.substring(0, 300)}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const responseText = extractCandidateText(data);
    const outputTokens = estimateAiGatewayTokens(responseText);
    await recordAiGatewayLog({
      ...gatewayContext,
      mode: gatewayEvaluation.mode,
      status: 'succeeded',
      decision: gatewayEvaluation.decision,
      reason: gatewayEvaluation.reason,
      severity: gatewayEvaluation.severity,
      estimatedInputTokens: gatewayEvaluation.estimatedInputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCostUsd: estimateAiGatewayResponseCost(model, gatewayEvaluation.estimatedInputTokens, outputTokens),
      promptChars: prompt.length,
      responseChars: responseText.length,
      latencyMs: Date.now() - gatewayStartedAt,
    });
    return data;
  } catch (err) {
    if (!(err instanceof AiGatewayBlockedError)) {
      await recordAiGatewayLog({
        ...gatewayContext,
        mode: gatewayEvaluation.mode,
        status: 'failed',
        decision: gatewayEvaluation.decision,
        reason: gatewayEvaluation.reason,
        severity: gatewayEvaluation.severity,
        estimatedInputTokens: gatewayEvaluation.estimatedInputTokens,
        estimatedOutputTokens: gatewayEvaluation.estimatedOutputTokens,
        estimatedCostUsd: gatewayEvaluation.estimatedCostUsd,
        promptChars: prompt.length,
        latencyMs: Date.now() - gatewayStartedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function extractCandidateText(data: Record<string, unknown>): string {
  const candidates = Array.isArray(data.candidates)
    ? data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>
    : [];
  return candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export async function callGemini(prompt: string, model: string, aiGatewayContext?: GeminiGenerateOptions['aiGatewayContext']): Promise<string> {
  const data = await generateGeminiContent(prompt, {
    model,
    timeoutMs: config.geminiTimeoutMs,
    temperature: 0,
    aiGatewayContext,
  });
  return extractCandidateText(data);
}
