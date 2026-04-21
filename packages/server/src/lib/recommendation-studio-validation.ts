import type {
  RecommendationRuleActions,
  RecommendationRuleConditions,
  RecommendationStudioRuleStage,
  RecommendationStudioValidationResult,
} from './recommendation-studio-types.js';
import type { RecommendationStudioTokenCatalogEntry } from './recommendation-studio-types.js';

const TOKEN_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g;
const MAX_ADVANCED_APPENDIX_LENGTH = 8_000;
const MAX_PROMPT_SECTION_LENGTH = 12_000;
const MAX_REPLAY_ITEMS = 20;
const REQUIRED_OVERLAY_TOKENS = ['MATCH_CONTEXT', 'LIVE_STATS_COMPACT', 'LIVE_ODDS_CANONICAL'] as const;

export const RECOMMENDATION_STUDIO_MAX_REPLAY_ITEMS = MAX_REPLAY_ITEMS;

function buildResult(): RecommendationStudioValidationResult {
  return { ok: true, errors: [], warnings: [] };
}

function pushError(result: RecommendationStudioValidationResult, field: string, message: string): void {
  result.ok = false;
  result.errors.push({ field, message });
}

function pushWarning(result: RecommendationStudioValidationResult, field: string, message: string): void {
  result.warnings.push({ field, message });
}

function extractTokens(text: string): string[] {
  const matches = [...String(text ?? '').matchAll(TOKEN_PATTERN)];
  return matches.map((match) => String(match[1] ?? '').trim()).filter(Boolean);
}

function knownTokenSet(tokenCatalog: RecommendationStudioTokenCatalogEntry[]): Set<string> {
  return new Set(tokenCatalog.map((entry) => entry.key));
}

export function validatePromptTemplateInput(input: {
  name: string;
  advancedAppendix: string;
  sections: Array<{
    section_key: string;
    label: string;
    content: string;
    enabled: boolean;
    sort_order: number;
  }>;
  tokenCatalog: RecommendationStudioTokenCatalogEntry[];
}): RecommendationStudioValidationResult {
  const result = buildResult();
  if (!String(input.name ?? '').trim()) {
    pushError(result, 'name', 'Prompt template name is required.');
  }
  if (String(input.advancedAppendix ?? '').length > MAX_ADVANCED_APPENDIX_LENGTH) {
    pushError(result, 'advancedAppendix', `Advanced appendix exceeds ${MAX_ADVANCED_APPENDIX_LENGTH} characters.`);
  }

  const sectionKeys = new Set<string>();
  const allowedTokens = knownTokenSet(input.tokenCatalog);
  const tokensSeen = new Map<string, number>();
  for (const [index, section] of input.sections.entries()) {
    const prefix = `sections[${index}]`;
    if (!String(section.section_key ?? '').trim()) {
      pushError(result, `${prefix}.section_key`, 'Section key is required.');
    }
    if (!String(section.label ?? '').trim()) {
      pushError(result, `${prefix}.label`, 'Section label is required.');
    }
    if (String(section.content ?? '').length > MAX_PROMPT_SECTION_LENGTH) {
      pushError(result, `${prefix}.content`, `Section content exceeds ${MAX_PROMPT_SECTION_LENGTH} characters.`);
    }
    if (sectionKeys.has(section.section_key)) {
      pushError(result, `${prefix}.section_key`, 'Section key must be unique within the template.');
    }
    sectionKeys.add(section.section_key);
    for (const token of extractTokens(section.content)) {
      tokensSeen.set(token, (tokensSeen.get(token) ?? 0) + 1);
      if (!allowedTokens.has(token)) {
        pushError(result, `${prefix}.content`, `Unknown token {{${token}}}. Use the token picker catalog only.`);
      }
    }
  }

  for (const token of extractTokens(input.advancedAppendix)) {
    tokensSeen.set(token, (tokensSeen.get(token) ?? 0) + 1);
    if (!allowedTokens.has(token)) {
      pushError(result, 'advancedAppendix', `Unknown token {{${token}}}. Use the token picker catalog only.`);
    }
  }

  for (const token of REQUIRED_OVERLAY_TOKENS) {
    if ((tokensSeen.get(token) ?? 0) === 0) {
      pushError(result, 'template', `Required token {{${token}}} is missing from the editable prompt overlay.`);
    }
  }

  for (const [token, count] of tokensSeen.entries()) {
    if (count > 1 && token === 'EXACT_OUTPUT_ENUMS') {
      pushError(result, 'template', `Token {{${token}}} may only appear once in the editable prompt overlay.`);
    }
  }

  if (input.sections.filter((section) => section.enabled).length === 0 && !String(input.advancedAppendix ?? '').trim()) {
    pushWarning(result, 'template', 'Prompt template has no enabled sections and no advanced appendix.');
  }

  return result;
}

function validateRuleConditions(
  result: RecommendationStudioValidationResult,
  stage: RecommendationStudioRuleStage,
  conditions: RecommendationRuleConditions,
  fieldPrefix: string,
): void {
  if (conditions.oddsMin != null && conditions.oddsMax != null && conditions.oddsMin > conditions.oddsMax) {
    pushError(result, `${fieldPrefix}.odds`, 'oddsMin must be less than or equal to oddsMax.');
  }
  if (conditions.lineMin != null && conditions.lineMax != null && conditions.lineMin > conditions.lineMax) {
    pushError(result, `${fieldPrefix}.line`, 'lineMin must be less than or equal to lineMax.');
  }
  if (conditions.totalGoalsMin != null && conditions.totalGoalsMax != null && conditions.totalGoalsMin > conditions.totalGoalsMax) {
    pushError(result, `${fieldPrefix}.totalGoals`, 'totalGoalsMin must be less than or equal to totalGoalsMax.');
  }
  if (conditions.currentCornersMin != null && conditions.currentCornersMax != null && conditions.currentCornersMin > conditions.currentCornersMax) {
    pushError(result, `${fieldPrefix}.currentCorners`, 'currentCornersMin must be less than or equal to currentCornersMax.');
  }

  const invalidPeriodKinds = (conditions.periodKinds ?? []).filter((value) => value !== 'ft' && value !== 'h1');
  if (invalidPeriodKinds.length > 0) {
    pushError(result, `${fieldPrefix}.periodKinds`, `Invalid periodKinds: ${invalidPeriodKinds.join(', ')}`);
  }

  if (stage === 'pre_prompt') {
    if ((conditions.marketFamilies?.length ?? 0) > 0) {
      pushError(result, `${fieldPrefix}.marketFamilies`, 'pre_prompt rules cannot filter by marketFamilies; they run before market selection.');
    }
    if ((conditions.canonicalMarketEquals?.length ?? 0) > 0 || (conditions.canonicalMarketPrefixes?.length ?? 0) > 0) {
      pushError(result, `${fieldPrefix}.canonicalMarket`, 'pre_prompt rules cannot target canonical markets.');
    }
    if ((conditions.periodKinds?.length ?? 0) > 0) {
      pushError(result, `${fieldPrefix}.periodKinds`, 'pre_prompt rules cannot target periodKinds.');
    }
    if (conditions.oddsMin != null || conditions.oddsMax != null) {
      pushError(result, `${fieldPrefix}.odds`, 'pre_prompt rules cannot target odds ranges because no specific market odds exist before prompt generation.');
    }
    if (conditions.lineMin != null || conditions.lineMax != null) {
      pushError(result, `${fieldPrefix}.line`, 'pre_prompt rules cannot target line ranges because no specific market line exists before prompt generation.');
    }
    if ((conditions.riskLevels?.length ?? 0) > 0) {
      pushError(result, `${fieldPrefix}.riskLevels`, 'pre_prompt rules cannot target post-parse risk levels.');
    }
  }
}

function validateRuleActions(
  result: RecommendationStudioValidationResult,
  stage: RecommendationStudioRuleStage,
  actions: RecommendationRuleActions,
  fieldPrefix: string,
): void {
  const hasAction = Object.values(actions ?? {}).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== '' && value !== false;
  });
  if (!hasAction) {
    pushError(result, `${fieldPrefix}`, 'At least one rule action is required.');
  }

  if (actions.capConfidence != null && (actions.capConfidence < 0 || actions.capConfidence > 10)) {
    pushError(result, `${fieldPrefix}.capConfidence`, 'capConfidence must be between 0 and 10.');
  }
  if (actions.capStakePercent != null && (actions.capStakePercent < 0 || actions.capStakePercent > 100)) {
    pushError(result, `${fieldPrefix}.capStakePercent`, 'capStakePercent must be between 0 and 100.');
  }
  if (actions.raiseMinEdge != null && (actions.raiseMinEdge < -100 || actions.raiseMinEdge > 100)) {
    pushError(result, `${fieldPrefix}.raiseMinEdge`, 'raiseMinEdge must be between -100 and 100.');
  }

  if (stage === 'pre_prompt') {
    if (actions.block || actions.forceNoBet || actions.capConfidence != null || actions.capStakePercent != null || actions.raiseMinEdge != null || actions.warning) {
      pushError(result, `${fieldPrefix}`, 'pre_prompt rules may only hide market families, append instructions, or mark exceptional-only.');
    }
  }

  if (stage === 'post_parse') {
    if ((actions.hideMarketFamiliesFromPrompt?.length ?? 0) > 0 || actions.appendInstruction || actions.markExceptionalOnly) {
      pushError(result, `${fieldPrefix}`, 'post_parse rules may not change prompt visibility or append instructions.');
    }
  }
}

export function validateRuleSetInput(input: {
  name: string;
  rules: Array<{
    name: string;
    stage: RecommendationStudioRuleStage;
    priority: number;
    enabled: boolean;
    conditions_json: RecommendationRuleConditions;
    actions_json: RecommendationRuleActions;
  }>;
}): RecommendationStudioValidationResult {
  const result = buildResult();
  if (!String(input.name ?? '').trim()) {
    pushError(result, 'name', 'Rule set name is required.');
  }
  if ((input.rules ?? []).length === 0) {
    pushWarning(result, 'rules', 'Rule set has no rules.');
  }
  for (const [index, rule] of input.rules.entries()) {
    const prefix = `rules[${index}]`;
    if (!String(rule.name ?? '').trim()) {
      pushError(result, `${prefix}.name`, 'Rule name is required.');
    }
    if (!Number.isFinite(rule.priority)) {
      pushError(result, `${prefix}.priority`, 'Priority must be numeric.');
    }
    validateRuleConditions(result, rule.stage, rule.conditions_json ?? {}, `${prefix}.conditions_json`);
    validateRuleActions(result, rule.stage, rule.actions_json ?? {}, `${prefix}.actions_json`);
  }
  return result;
}

export function validateReplayRequest(input: {
  recommendationIds: number[];
  snapshotIds: number[];
}): RecommendationStudioValidationResult {
  const result = buildResult();
  const total = (input.recommendationIds?.length ?? 0) + (input.snapshotIds?.length ?? 0);
  if (total <= 0) {
    pushError(result, 'selection', 'At least one recommendation or snapshot is required.');
  }
  if (total > MAX_REPLAY_ITEMS) {
    pushError(result, 'selection', `Replay batch exceeds ${MAX_REPLAY_ITEMS} items.`);
  }
  return result;
}
