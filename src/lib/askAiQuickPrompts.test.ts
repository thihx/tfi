import { describe, expect, it } from 'vitest';
import {
  ASK_AI_QUICK_PROMPTS,
  getAskAiQuickPrompts,
  getAskAiQuickPromptsResolved,
  linesToAskAiQuickPromptItems,
  mergeAskAiQuickPromptsForLocale,
  toAskAiPromptLocale,
  uiLanguageToAskAiPromptLocale,
} from './askAiQuickPrompts';

const DIALOG_MAX = 200;
const FOLLOW_UP_MAX = 100;

describe('askAiQuickPrompts', () => {
  it('maps UI language to en or vi', () => {
    expect(uiLanguageToAskAiPromptLocale('en')).toBe('en');
    expect(uiLanguageToAskAiPromptLocale('vi')).toBe('vi');
    expect(uiLanguageToAskAiPromptLocale('unknown')).toBe('en');
  });

  it('falls back unknown locales to en for resolved prompts', () => {
    expect(toAskAiPromptLocale('fr')).toBe('en');
    expect(getAskAiQuickPromptsResolved('fr').length).toBeGreaterThan(0);
    expect(getAskAiQuickPromptsResolved('fr')[0]?.text).toBe(
      getAskAiQuickPrompts('en')[0]?.text,
    );
  });

  it('has non-empty catalogs for en and vi', () => {
    expect(getAskAiQuickPrompts('en').length).toBeGreaterThan(0);
    expect(getAskAiQuickPrompts('vi').length).toBeGreaterThan(0);
  });

  it('keeps every prompt within dialog and follow-up limits', () => {
    for (const locale of ['en', 'vi'] as const) {
      for (const item of ASK_AI_QUICK_PROMPTS[locale]) {
        expect(item.text.length).toBeLessThanOrEqual(FOLLOW_UP_MAX);
        expect(item.text.length).toBeLessThanOrEqual(DIALOG_MAX);
        expect(item.id.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses user prompts when non-empty for locale', () => {
    const custom = mergeAskAiQuickPromptsForLocale('en', {
      en: [{ id: 'x', text: 'Custom only' }],
    });
    expect(custom[0]?.text).toBe('Custom only');
    const fallback = mergeAskAiQuickPromptsForLocale('en', { en: [] });
    expect(fallback[0]?.text).toBe(getAskAiQuickPrompts('en')[0]?.text);
  });

  it('parses lines to prompt items', () => {
    const items = linesToAskAiQuickPromptItems('a\n\nb');
    expect(items).toHaveLength(2);
    expect(items[0]?.text).toBe('a');
  });
});