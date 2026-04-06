// ============================================================
// Ask AI quick prompts — stored in user_settings.settings JSONB
// ============================================================

export interface AskAiQuickPromptItem {
  id: string;
  text: string;
}

export const ASK_AI_QUICK_PROMPTS_LIMITS = {
  maxPerLocale: 12,
  maxTextLength: 100,
  maxIdLength: 64,
} as const;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeAskAiQuickPromptList(value: unknown): AskAiQuickPromptItem[] {
  if (!Array.isArray(value)) return [];
  const items: AskAiQuickPromptItem[] = [];
  for (let i = 0; i < value.length && i < ASK_AI_QUICK_PROMPTS_LIMITS.maxPerLocale; i++) {
    const row = value[i];
    if (!isObjectRecord(row)) continue;
    const text =
      typeof row.text === 'string'
        ? row.text.trim().slice(0, ASK_AI_QUICK_PROMPTS_LIMITS.maxTextLength)
        : '';
    if (text.length === 0) continue;
    let id = typeof row.id === 'string' && row.id.trim()
      ? row.id.trim().slice(0, ASK_AI_QUICK_PROMPTS_LIMITS.maxIdLength)
      : '';
    if (!id) id = `user_${i}`;
    items.push({ id, text });
  }
  return items;
}

export type AskAiQuickPromptsByLocale = Partial<Record<'en' | 'vi', AskAiQuickPromptItem[]>>;

export function normalizeAskAiQuickPromptsByLocale(value: unknown): AskAiQuickPromptsByLocale | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isObjectRecord(value)) return undefined;
  const out: AskAiQuickPromptsByLocale = {};
  for (const loc of ['en', 'vi'] as const) {
    if (!(loc in value)) continue;
    const raw = value[loc];
    if (raw === null) {
      out[loc] = [];
      continue;
    }
    out[loc] = normalizeAskAiQuickPromptList(raw);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function mergeAskAiQuickPromptsByLocale(
  existingRaw: unknown,
  patchRaw: unknown,
): Record<string, unknown> {
  const existing = normalizeAskAiQuickPromptsByLocale(existingRaw) ?? {};
  const patch = normalizeAskAiQuickPromptsByLocale(patchRaw) ?? {};
  return {
    en: patch.en !== undefined ? patch.en : (existing.en ?? []),
    vi: patch.vi !== undefined ? patch.vi : (existing.vi ?? []),
  };
}