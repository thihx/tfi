import { describe, expect, test } from 'vitest';
import { RECOMMENDATION_STUDIO_TOKEN_CATALOG } from '../lib/recommendation-studio-runtime.js';
import { validatePromptTemplateInput, validateRuleSetInput } from '../lib/recommendation-studio-validation.js';

describe('recommendation studio validation', () => {
  test('rejects unknown prompt tokens', () => {
    const validation = validatePromptTemplateInput({
      name: 'Prompt',
      advancedAppendix: '',
      tokenCatalog: RECOMMENDATION_STUDIO_TOKEN_CATALOG,
      sections: [
        {
          section_key: 'one',
          label: 'One',
          content: 'Use {{UNKNOWN_TOKEN}} here',
          enabled: true,
          sort_order: 0,
        },
      ],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors[0]?.message).toContain('Unknown token');
  });

  test('requires core overlay tokens', () => {
    const validation = validatePromptTemplateInput({
      name: 'Prompt',
      advancedAppendix: '',
      tokenCatalog: RECOMMENDATION_STUDIO_TOKEN_CATALOG,
      sections: [
        {
          section_key: 'one',
          label: 'One',
          content: 'Use {{MATCH_CONTEXT}} only',
          enabled: true,
          sort_order: 0,
        },
      ],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.some((entry) => entry.message.includes('LIVE_STATS_COMPACT'))).toBe(true);
    expect(validation.errors.some((entry) => entry.message.includes('LIVE_ODDS_CANONICAL'))).toBe(true);
  });

  test('rejects invalid pre_prompt market-targeted rules', () => {
    const validation = validateRuleSetInput({
      name: 'Rules',
      rules: [
        {
          name: 'Bad Pre Prompt',
          stage: 'pre_prompt',
          priority: 10,
          enabled: true,
          conditions_json: {
            marketFamilies: ['corners'],
          },
          actions_json: {
            hideMarketFamiliesFromPrompt: ['corners'],
          },
        },
      ],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.some((entry) => entry.message.includes('pre_prompt rules cannot filter by marketFamilies'))).toBe(true);
  });

  test('rejects odds ranges on pre_prompt rules and invalid raiseMinEdge bounds', () => {
    const validation = validateRuleSetInput({
      name: 'Rules',
      rules: [
        {
          name: 'Bad pre prompt odds',
          stage: 'pre_prompt',
          priority: 10,
          enabled: true,
          conditions_json: {
            oddsMin: 1.8,
          },
          actions_json: {
            hideMarketFamiliesFromPrompt: ['corners'],
          },
        },
        {
          name: 'Bad edge floor',
          stage: 'post_parse',
          priority: 20,
          enabled: true,
          conditions_json: {},
          actions_json: {
            raiseMinEdge: 101,
          },
        },
      ],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.some((entry) => entry.message.includes('cannot target odds ranges'))).toBe(true);
    expect(validation.errors.some((entry) => entry.message.includes('raiseMinEdge must be between -100 and 100'))).toBe(true);
  });
});
