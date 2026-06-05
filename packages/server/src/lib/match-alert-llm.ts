import { config } from '../config.js';
import { generateGeminiContent } from './gemini.js';
import type { MatchAlertContext, MatchAlertEvaluationResult } from './match-alert-rule-engine.js';
import type { MatchAlertRule } from '../repos/match-alert-rules.repo.js';

export interface MatchAlertLlmDecision {
  shouldPush: boolean;
  confidence: number;
  summaryVi: string;
  reasonVi: string;
  suggestedAction: 'open_match' | 'review_live_market' | 'ask_ai' | 'avoid_chasing';
  model: string;
  rawText?: string;
}

export interface MatchAlertLlmInput {
  rule: MatchAlertRule;
  context: MatchAlertContext;
  evaluation: MatchAlertEvaluationResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function sanitizeAction(value: unknown, fallback: MatchAlertLlmDecision['suggestedAction']): MatchAlertLlmDecision['suggestedAction'] {
  return value === 'open_match'
    || value === 'review_live_market'
    || value === 'ask_ai'
    || value === 'avoid_chasing'
    ? value
    : fallback;
}

function extractCandidateText(data: Record<string, unknown>): string {
  const candidates = Array.isArray(data.candidates)
    ? data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>
    : [];
  return candidates[0]?.content?.parts?.[0]?.text ?? '';
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // Try to recover if the model wrapped the JSON in short prose.
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (isRecord(parsed)) return parsed;
  }
  throw new Error('Match alert LLM response was not a JSON object.');
}

export function parseMatchAlertLlmDecision(
  text: string,
  fallback: MatchAlertEvaluationResult,
  model = config.geminiMatchAlertModel,
): MatchAlertLlmDecision {
  const parsed = extractJsonObject(text);
  const shouldPush = parsed.should_push !== false;
  const confidence = clampConfidence(parsed.confidence);
  const reasonVi = asString(parsed.reason_vi) || fallback.summaryVi;
  const summaryVi = asString(parsed.summary_vi) || fallback.summaryVi;
  return {
    shouldPush,
    confidence,
    reasonVi,
    summaryVi,
    suggestedAction: sanitizeAction(parsed.suggested_action, fallback.suggestedAction),
    model,
    rawText: text,
  };
}

export function buildMatchAlertLlmPrompt(input: MatchAlertLlmInput): string {
  const { rule, context, evaluation } = input;
  return [
    'You are TFI Fast Match Alert, a low-latency live football alert classifier for betting users.',
    'Task: decide whether an already matched deterministic alert rule is useful enough to push now.',
    'Do not recommend a bet, market, odds, stake, or bankroll action. This is only a live watch signal.',
    'Prefer should_push=true for major state changes and useful watch windows. Use should_push=false for stale, noisy, incomplete, or redundant signals.',
    'Return strict JSON only:',
    '{"should_push":true,"confidence":0-100,"summary_vi":"...","reason_vi":"...","suggested_action":"open_match|review_live_market|ask_ai|avoid_chasing"}',
    '',
    'Rule:',
    JSON.stringify({
      id: rule.ruleJson.id ?? rule.source,
      source: rule.source,
      alertKind: rule.alertKind,
      cooldownMinutes: rule.cooldownMinutes,
      oncePerMatch: rule.oncePerMatch,
      ruleJson: rule.ruleJson,
    }),
    '',
    'Matched evaluation:',
    JSON.stringify({
      triggerKey: evaluation.triggerKey,
      summaryVi: evaluation.summaryVi,
      severity: evaluation.severity,
      suggestedAction: evaluation.suggestedAction,
      facts: evaluation.facts,
    }),
    '',
    'Live context:',
    JSON.stringify({
      matchId: context.matchId,
      leagueName: context.leagueName,
      homeTeam: context.homeTeam,
      awayTeam: context.awayTeam,
      status: context.status,
      minute: context.minute,
      score: context.score,
      stats: context.stats,
      events: context.events,
      derived: context.derived,
      dataFreshness: context.dataFreshness,
    }),
  ].join('\n');
}

export async function adjudicateMatchAlertWithLlm(input: MatchAlertLlmInput): Promise<MatchAlertLlmDecision> {
  const model = config.geminiMatchAlertModel;
  const prompt = buildMatchAlertLlmPrompt(input);
  const response = await generateGeminiContent(prompt, {
    model,
    timeoutMs: config.matchAlertLlmTimeoutMs,
    temperature: 0,
    maxOutputTokens: config.matchAlertLlmMaxOutputTokens,
    responseMimeType: 'application/json',
    thinkingBudget: 0,
    aiGatewayContext: {
      operation: 'match_alert.adjudicate',
      featureKey: 'match_alert_condition_llm',
      matchId: input.context.matchId,
      metadata: {
        ruleId: input.rule.id,
        alertKind: input.rule.alertKind,
        source: input.rule.source,
        triggerKey: input.evaluation.triggerKey,
      },
    },
  });
  return parseMatchAlertLlmDecision(extractCandidateText(response), input.evaluation, model);
}
