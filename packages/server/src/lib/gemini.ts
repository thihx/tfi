// ============================================================
// Gemini API Client — shared across proxy routes and pipeline
// ============================================================

import { config } from '../config.js';

export interface GeminiGenerateOptions {
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  withSearch?: boolean;
  thinkingBudget?: number | null;
}

const GEMINI_MODEL_ALIASES: Record<string, string> = {
  'gemini-3.0-flash': 'gemini-3-flash-preview',
  'gemini-3.0-pro-preview': 'gemini-3-pro-preview',
};

export function normalizeGeminiModelName(model: string): string {
  const trimmed = String(model || '').trim().replace(/^models\//i, '');
  if (!trimmed) return trimmed;
  return GEMINI_MODEL_ALIASES[trimmed] ?? trimmed;
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
          return await res.json() as Record<string, unknown>;
        }
        text = await res.text().catch(() => text);
      }

      throw new Error(`Gemini API ${res.status}: ${text.substring(0, 300)}`);
    }

    return await res.json() as Record<string, unknown>;
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

export async function callGemini(prompt: string, model: string): Promise<string> {
  const data = await generateGeminiContent(prompt, {
    model,
    timeoutMs: config.geminiTimeoutMs,
    temperature: 0,
  });
  return extractCandidateText(data);
}
