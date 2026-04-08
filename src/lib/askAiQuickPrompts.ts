/**
 * Default quick prompts for Ask AI (live betting). Same catalog for all users.
 * Copy lives in JSON so UTF-8 is stable across editors; add locales by extending
 * `AskAiPromptLocale`, new `askAiQuickPrompts.<locale>.json`, and `ASK_AI_QUICK_PROMPTS`.
 * Per-user lines are stored in user_settings (ASK_AI_QUICK_PROMPTS_BY_LOCALE).
 */
import labels from './askAiQuickPrompts.labels.json';
import en from './askAiQuickPrompts.en.json';
import vi from './askAiQuickPrompts.vi.json';

/** Max length for Ask AI first question (dialog) and match follow-up chat input; keep server `ASK_AI_QUICK_PROMPTS_LIMITS.maxTextLength` in sync. */
export const ASK_AI_CHAT_MAX_CHARS = 200;

/** Extend when new UI locales ship prompt catalogs. */
export type AskAiPromptLocale = 'en' | 'vi';

export interface AskAiQuickPromptItem {
  id: string;
  text: string;
}

export const ASK_AI_QUICK_PROMPTS: Record<AskAiPromptLocale, AskAiQuickPromptItem[]> = {
  en: en as AskAiQuickPromptItem[],
  vi: vi as AskAiQuickPromptItem[],
};

export const ASK_AI_QUICK_PROMPTS_SECTION_LABEL: Record<AskAiPromptLocale, string> =
  labels.section;

export function uiLanguageToAskAiPromptLocale(uiLanguage: string): AskAiPromptLocale {
  return uiLanguage === 'vi' ? 'vi' : 'en';
}

/** Maps arbitrary locale strings to a supported prompt locale; unknown → en. */
export function toAskAiPromptLocale(raw: string): AskAiPromptLocale {
  if (raw === 'vi') return 'vi';
  return 'en';
}

export function getAskAiQuickPrompts(locale: AskAiPromptLocale): AskAiQuickPromptItem[] {
  return ASK_AI_QUICK_PROMPTS[locale];
}

export type AskAiQuickPromptsByLocaleInput = Partial<
  Record<AskAiPromptLocale, AskAiQuickPromptItem[] | undefined>
>;

/**
 * Uses per-user prompts when the user saved at least one non-empty line for this locale;
 * otherwise built-in defaults.
 */
export function mergeAskAiQuickPromptsForLocale(
  locale: AskAiPromptLocale,
  byLocale: AskAiQuickPromptsByLocaleInput | undefined,
): AskAiQuickPromptItem[] {
  const custom = byLocale?.[locale];
  if (custom && custom.length > 0) {
    return custom.map((item, i) => ({
      id: item.id?.trim() ? item.id.trim().slice(0, 64) : `user_${i}`,
      text: item.text.slice(0, ASK_AI_CHAT_MAX_CHARS),
    }));
  }
  return getAskAiQuickPrompts(locale);
}

const USER_QUICK_PROMPT_MAX_LINES = 12;

/** One non-empty line per chip; used when saving from Profile. */
export function linesToAskAiQuickPromptItems(raw: string): AskAiQuickPromptItem[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, USER_QUICK_PROMPT_MAX_LINES);
  return lines.map((text, i) => ({
    id: `user_${i}`,
    text: text.slice(0, ASK_AI_CHAT_MAX_CHARS),
  }));
}

export function askAiQuickPromptItemsToLines(items: AskAiQuickPromptItem[]): string {
  return items.map((x) => x.text).join('\n');
}

export function getAskAiQuickPromptsResolved(raw: string): AskAiQuickPromptItem[] {
  const locale = toAskAiPromptLocale(raw);
  return ASK_AI_QUICK_PROMPTS[locale] ?? ASK_AI_QUICK_PROMPTS.en;
}

export function getAskAiQuickPromptsSectionLabel(locale: AskAiPromptLocale): string {
  return ASK_AI_QUICK_PROMPTS_SECTION_LABEL[locale] ?? ASK_AI_QUICK_PROMPTS_SECTION_LABEL.en;
}