import { describe, expect, it } from 'vitest';
import {
  mergeAskAiQuickPromptsByLocale,
  normalizeAskAiQuickPromptList,
  normalizeAskAiQuickPromptsByLocale,
} from '../lib/ask-ai-quick-prompts-settings.js';

describe('ask-ai-quick-prompts-settings', () => {
  it('normalizes prompt list with limits', () => {
    const items = normalizeAskAiQuickPromptList([
      { id: 'a', text: '  hello  ' },
      { text: 'x'.repeat(200) },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]?.text).toBe('hello');
    expect(items[1]?.text.length).toBe(200);
  });

  it('merges partial patch without dropping other locale', () => {
    const existing = { en: [{ id: '1', text: 'keep' }], vi: [{ id: 'v', text: 'giu' }] };
    const patch = { en: [{ id: 'n', text: 'new' }] };
    const merged = mergeAskAiQuickPromptsByLocale(existing, patch);
    expect(merged.en).toEqual([{ id: 'n', text: 'new' }]);
    expect(merged.vi).toEqual([{ id: 'v', text: 'giu' }]);
  });

  it('normalizeAskAiQuickPromptsByLocale returns undefined for bad input', () => {
    expect(normalizeAskAiQuickPromptsByLocale('bad')).toBeUndefined();
  });
});