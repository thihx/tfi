import {
  buildExactMarketContractSectionCompact,
  buildLiveAnalysisPrompt,
  isLiveAnalysisPromptVersion,
  type LiveAnalysisPromptInput,
  type LiveAnalysisPromptSettings,
  type LiveAnalysisPromptVersion,
} from './live-analysis-prompt.js';
import { getActiveRecommendationRelease } from '../repos/recommendation-studio.repo.js';
import type {
  RecommendationReleaseDetail,
  RecommendationRuleActions,
  RecommendationRuleConditions,
  RecommendationStudioPostParseContext,
  RecommendationStudioPostParseDecision,
  RecommendationStudioPrePromptContext,
  RecommendationStudioPrePromptDecision,
  RecommendationStudioPromptOverlay,
  RecommendationStudioPromptPreview,
  RecommendationStudioRuntimeTokenMap,
  RecommendationStudioTokenCatalogEntry,
} from './recommendation-studio-types.js';
import { normalizeMarket } from './normalize-market.js';

export const RECOMMENDATION_STUDIO_TOKEN_CATALOG: RecommendationStudioTokenCatalogEntry[] = [
  { key: 'MATCH_CONTEXT', label: 'Match Context', description: 'League, teams, minute, status, score.' },
  { key: 'LIVE_STATS_COMPACT', label: 'Live Stats', description: 'Compact live stat snapshot.' },
  { key: 'LIVE_ODDS_CANONICAL', label: 'Live Odds Canonical', description: 'Canonical odds ladder visible to the model.' },
  { key: 'EXACT_OUTPUT_ENUMS', label: 'Exact Output Enums', description: 'Exact canonical market keys the model may emit.' },
  { key: 'EVENTS_COMPACT', label: 'Events Compact', description: 'Recent in-match events.' },
  { key: 'LINEUPS_SNAPSHOT', label: 'Lineups Snapshot', description: 'Confirmed lineups if available.' },
  { key: 'PREMATCH_EXPERT_FEATURES', label: 'Prematch Expert Features', description: 'Grounded prematch priors and coverage.' },
  { key: 'PREVIOUS_RECOMMENDATIONS', label: 'Previous Recommendations', description: 'Recent recommendation memory for this match.' },
  { key: 'EVIDENCE_MODE', label: 'Evidence Mode', description: 'Current evidence mode derived by runtime.' },
  { key: 'USER_QUESTION', label: 'User Question', description: 'Ask AI / follow-up question when present.' },
];

export interface RecommendationStudioRuntimeOverride {
  release?: RecommendationReleaseDetail | null;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function parseScore(score: string): { home: number; away: number; total: number } {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return { home: 0, away: 0, total: 0 };
  const home = Number(match[1] ?? 0);
  const away = Number(match[2] ?? 0);
  return { home, away, total: home + away };
}

function getMinuteBand(minute: number): string {
  if (minute <= 29) return '00-29';
  if (minute <= 44) return '30-44';
  if (minute <= 59) return '45-59';
  if (minute <= 74) return '60-74';
  return '75+';
}

function getScoreState(score: string): string {
  const { home, away } = parseScore(score);
  const diff = Math.abs(home - away);
  if (home === 0 && away === 0) return '0-0';
  if (diff === 0) return 'level';
  if (diff === 1) return 'one-goal-margin';
  return 'two-plus-margin';
}

function getMarketFamily(canonicalMarket: string): string {
  if (canonicalMarket.startsWith('corners_')) return 'corners';
  if (canonicalMarket.startsWith('ht_')) {
    if (canonicalMarket.includes('_asian_handicap_')) return 'asian_handicap';
    if (canonicalMarket.includes('1x2')) return '1x2';
    if (canonicalMarket.includes('btts')) return 'btts';
    return 'goals_ou';
  }
  if (canonicalMarket.startsWith('under_') || canonicalMarket.startsWith('over_')) return 'goals_ou';
  if (canonicalMarket.startsWith('asian_handicap_')) return 'asian_handicap';
  if (canonicalMarket.startsWith('1x2_')) return '1x2';
  if (canonicalMarket.startsWith('btts_')) return 'btts';
  return 'other';
}

function getPeriodKind(canonicalMarket: string): 'h1' | 'ft' {
  return canonicalMarket.startsWith('ht_') ? 'h1' : 'ft';
}

function getMarketLine(canonicalMarket: string): number | null {
  const match = canonicalMarket.match(/_([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function getRuntimeTokenMap(input: Pick<
  LiveAnalysisPromptInput,
  | 'homeName'
  | 'awayName'
  | 'league'
  | 'minute'
  | 'score'
  | 'status'
  | 'statsCompact'
  | 'oddsCanonical'
  | 'eventsCompact'
  | 'lineupsSnapshot'
  | 'prematchExpertFeatures'
  | 'previousRecommendations'
  | 'evidenceMode'
  | 'userQuestion'
  | 'statsAvailable'
  | 'statsSource'
  | 'statsMeta'
  | 'oddsAvailable'
  | 'oddsSource'
  | 'oddsFetchedAt'
  | 'oddsSanityWarnings'
  | 'oddsSuspicious'
  | 'derivedInsights'
  | 'customConditions'
  | 'recommendedCondition'
  | 'recommendedConditionReason'
  | 'strategicContext'
  | 'leagueProfile'
  | 'homeTeamProfile'
  | 'awayTeamProfile'
  | 'structuredPrematchAskAi'
  | 'analysisMode'
  | 'forceAnalyze'
  | 'isManualPush'
  | 'skippedFilters'
  | 'originalWouldProceed'
  | 'prediction'
  | 'currentTotalGoals'
  | 'matchTimeline'
  | 'historicalPerformance'
  | 'performanceMemory'
  | 'preMatchPredictionSummary'
  | 'statsFallbackReason'
  | 'followUpHistory'
  | 'settledReplayApprovedTrace'
  | 'settledReplayOriginalBetMarket'
  | 'settledReplayOriginalSelection'
>): RecommendationStudioRuntimeTokenMap {
  return {
    MATCH_CONTEXT: stringifyJson({
      league: input.league,
      homeName: input.homeName,
      awayName: input.awayName,
      minute: input.minute,
      score: input.score,
      status: input.status,
    }),
    LIVE_STATS_COMPACT: stringifyJson(input.statsCompact ?? {}),
    LIVE_ODDS_CANONICAL: stringifyJson(input.oddsCanonical ?? {}),
    EXACT_OUTPUT_ENUMS: buildExactMarketContractSectionCompact(input as LiveAnalysisPromptInput).trim(),
    EVENTS_COMPACT: stringifyJson(input.eventsCompact ?? []),
    LINEUPS_SNAPSHOT: stringifyJson(input.lineupsSnapshot ?? { available: false }),
    PREMATCH_EXPERT_FEATURES: stringifyJson(input.prematchExpertFeatures ?? {}),
    PREVIOUS_RECOMMENDATIONS: stringifyJson(input.previousRecommendations ?? []),
    EVIDENCE_MODE: String(input.evidenceMode ?? ''),
    USER_QUESTION: String(input.userQuestion ?? ''),
  };
}

function renderTemplateTokens(text: string, runtimeTokens: RecommendationStudioRuntimeTokenMap): string {
  let rendered = text;
  for (const [key, value] of Object.entries(runtimeTokens) as Array<[string, string]>) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

function buildPromptOverlayText(overlay: RecommendationStudioPromptOverlay): string {
  const enabledSections = overlay.sections
    .filter((section) => section.enabled)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const renderedSections = enabledSections
    .map((section) => {
      const rendered = renderTemplateTokens(section.content, overlay.runtimeTokens).trim();
      if (!rendered) return '';
      return `SECTION: ${section.label}\n${rendered}`;
    })
    .filter(Boolean);
  const appendix = renderTemplateTokens(overlay.advancedAppendix ?? '', overlay.runtimeTokens).trim();
  const blocks = [
    ...renderedSections,
    ...(appendix ? [`ADVANCED APPENDIX\n${appendix}`] : []),
  ];
  if (blocks.length === 0) return '';
  return `\n\n========================\nADMIN RELEASE OVERLAY\n========================\n${blocks.join('\n\n')}\n`;
}

function matchesConditions(
  conditions: RecommendationRuleConditions,
  context: {
    minute: number;
    score: string;
    evidenceMode: string;
    prematchStrength: string;
    promptVersion: string;
    releaseId?: number | null;
    releaseKey?: string | null;
    canonicalMarket?: string;
    odds?: number | null;
    currentCorners?: number | null;
    currentGoals?: number | null;
    riskLevel?: string | null;
  },
): boolean {
  const minuteBand = getMinuteBand(context.minute);
  const scoreState = getScoreState(context.score);
  const canonicalMarket = String(context.canonicalMarket ?? '').trim().toLowerCase();
  const marketFamily = canonicalMarket ? getMarketFamily(canonicalMarket) : '';
  const periodKind = canonicalMarket ? getPeriodKind(canonicalMarket) : 'ft';
  const marketLine = canonicalMarket ? getMarketLine(canonicalMarket) : null;

  const includesOrEmpty = (values: string[] | undefined, actual: string): boolean =>
    !values || values.length === 0 || values.includes(actual);

  if (!includesOrEmpty(conditions.minuteBands, minuteBand)) return false;
  if (!includesOrEmpty(conditions.scoreStates, scoreState)) return false;
  if (!includesOrEmpty(conditions.evidenceModes, context.evidenceMode)) return false;
  if (!includesOrEmpty(conditions.prematchStrengths, context.prematchStrength)) return false;
  if (!includesOrEmpty(conditions.promptVersions, context.promptVersion)) return false;
  if ((conditions.releaseIds?.length ?? 0) > 0 && !conditions.releaseIds?.includes(context.releaseId ?? -1)) return false;
  if (!includesOrEmpty(conditions.releaseKeys, String(context.releaseKey ?? ''))) return false;
  if (!includesOrEmpty(conditions.marketFamilies, marketFamily)) return false;
  if (!includesOrEmpty(conditions.periodKinds, periodKind)) return false;
  if (!includesOrEmpty(conditions.riskLevels, String(context.riskLevel ?? '').trim().toLowerCase())) return false;
  if (conditions.canonicalMarketEquals && conditions.canonicalMarketEquals.length > 0 && !conditions.canonicalMarketEquals.includes(canonicalMarket)) {
    return false;
  }
  if (
    conditions.canonicalMarketPrefixes
    && conditions.canonicalMarketPrefixes.length > 0
    && !conditions.canonicalMarketPrefixes.some((prefix) => canonicalMarket.startsWith(prefix))
  ) {
    return false;
  }
  if (conditions.oddsMin != null && (context.odds == null || context.odds < conditions.oddsMin)) return false;
  if (conditions.oddsMax != null && (context.odds == null || context.odds > conditions.oddsMax)) return false;
  if (conditions.lineMin != null && (marketLine == null || marketLine < conditions.lineMin)) return false;
  if (conditions.lineMax != null && (marketLine == null || marketLine > conditions.lineMax)) return false;
  if (conditions.totalGoalsMin != null && (context.currentGoals == null || context.currentGoals < conditions.totalGoalsMin)) return false;
  if (conditions.totalGoalsMax != null && (context.currentGoals == null || context.currentGoals > conditions.totalGoalsMax)) return false;
  if (conditions.currentCornersMin != null && (context.currentCorners == null || context.currentCorners < conditions.currentCornersMin)) return false;
  if (conditions.currentCornersMax != null && (context.currentCorners == null || context.currentCorners > conditions.currentCornersMax)) return false;
  return true;
}

function applyPrePromptRuleActions(
  actions: RecommendationRuleActions,
  decision: RecommendationStudioPrePromptDecision,
): RecommendationStudioPrePromptDecision {
  const hiddenMarketFamilies = new Set(decision.hiddenMarketFamilies);
  for (const family of actions.hideMarketFamiliesFromPrompt ?? []) {
    if (family) hiddenMarketFamilies.add(family);
  }
  return {
    hiddenMarketFamilies: [...hiddenMarketFamilies],
    appendedInstructions: actions.appendInstruction
      ? [...decision.appendedInstructions, actions.appendInstruction]
      : decision.appendedInstructions,
    exceptionalOnlyReasons: actions.markExceptionalOnly
      ? [...decision.exceptionalOnlyReasons, 'EXCEPTIONAL_ONLY']
      : decision.exceptionalOnlyReasons,
  };
}

function filterOddsCanonicalByHiddenFamilies(
  oddsCanonical: Record<string, unknown>,
  hiddenFamilies: string[],
): Record<string, unknown> {
  if (hiddenFamilies.length === 0) return oddsCanonical;
  const hide = new Set(hiddenFamilies.map((value) => value.trim().toLowerCase()));
  const next = { ...oddsCanonical };
  const deleteIfHidden = (keys: string[], family: string) => {
    if (!hide.has(family)) return;
    for (const key of keys) delete next[key];
  };
  deleteIfHidden(['ou', 'ou_adjacent', 'ht_ou', 'ht_ou_adjacent'], 'goals_ou');
  deleteIfHidden(['corners_ou'], 'corners');
  deleteIfHidden(['1x2', 'ht_1x2'], '1x2');
  deleteIfHidden(['ah', 'ah_adjacent', 'ht_ah', 'ht_ah_adjacent'], 'asian_handicap');
  deleteIfHidden(['btts', 'ht_btts'], 'btts');
  return next;
}

export async function getCachedActiveRecommendationStudioRelease(forceRefresh = false): Promise<RecommendationReleaseDetail | null> {
  void forceRefresh;
  return getActiveRecommendationRelease();
}

export function invalidateRecommendationStudioReleaseCache(): void {
  // Runtime now reads the active release directly from the database to avoid
  // cross-replica staleness during activation and rollback.
}

export async function resolveRecommendationStudioRelease(
  override?: RecommendationStudioRuntimeOverride,
): Promise<RecommendationReleaseDetail | null> {
  if (override?.release) return override.release;
  return getCachedActiveRecommendationStudioRelease();
}

export function getEffectiveBasePromptVersion(
  release: RecommendationReleaseDetail | null,
  fallback: LiveAnalysisPromptVersion,
): LiveAnalysisPromptVersion {
  const configured = release?.promptTemplate.base_prompt_version;
  return configured && isLiveAnalysisPromptVersion(configured) ? configured : fallback;
}

export function buildRecommendationStudioPromptPreview(
  input: LiveAnalysisPromptInput,
  settings: LiveAnalysisPromptSettings,
  basePromptVersion: LiveAnalysisPromptVersion,
  release: RecommendationReleaseDetail | null,
): RecommendationStudioPromptPreview {
  const runtimeTokens = getRuntimeTokenMap(input);
  const basePrompt = buildLiveAnalysisPrompt(input, settings, basePromptVersion);
  const overlayText = release
    ? buildPromptOverlayText({
      sections: release.promptTemplate.sections,
      advancedAppendix: release.promptTemplate.advanced_appendix,
      runtimeTokens,
    })
    : '';
  return {
    basePromptVersion,
    effectivePrompt: basePrompt + overlayText,
    overlayText,
    runtimeTokens,
  };
}

export function applyRecommendationStudioPrePromptRules(
  release: RecommendationReleaseDetail | null,
  context: RecommendationStudioPrePromptContext,
): RecommendationStudioPrePromptDecision {
  const initial: RecommendationStudioPrePromptDecision = {
    hiddenMarketFamilies: [],
    appendedInstructions: [],
    exceptionalOnlyReasons: [],
  };
  if (!release) return initial;
  const rules = release.ruleSet.rules
    .filter((rule) => rule.enabled && rule.stage === 'pre_prompt')
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
  return rules.reduce((decision, rule) => (
    matchesConditions(rule.conditions_json, {
      minute: context.minute,
      score: context.score,
      evidenceMode: context.evidenceMode,
      prematchStrength: context.prematchStrength,
      promptVersion: context.promptVersion,
      releaseId: context.releaseId,
      releaseKey: context.releaseKey,
      currentCorners: context.currentCorners,
      currentGoals: context.currentGoals,
    })
      ? applyPrePromptRuleActions(rule.actions_json, decision)
      : decision
  ), initial);
}

export function applyRecommendationStudioPostParseRules(
  release: RecommendationReleaseDetail | null,
  context: RecommendationStudioPostParseContext,
): RecommendationStudioPostParseDecision {
  const initial: RecommendationStudioPostParseDecision = {
    blocked: false,
    forceNoBet: false,
    confidence: context.confidence,
    stakePercent: context.stakePercent,
    warnings: [],
  };
  if (!release) return initial;
  const rules = release.ruleSet.rules
    .filter((rule) => rule.enabled && rule.stage === 'post_parse')
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
  return rules.reduce((decision, rule) => {
    const canonicalMarket = normalizeMarket(context.selection, context.betMarket);
    if (!matchesConditions(rule.conditions_json, {
      minute: context.minute,
      score: context.score,
      evidenceMode: context.evidenceMode,
      prematchStrength: context.prematchStrength,
      promptVersion: context.promptVersion,
      releaseId: context.releaseId,
      releaseKey: context.releaseKey,
      canonicalMarket,
      odds: context.odds,
      currentCorners: context.currentCorners,
      currentGoals: context.currentGoals,
      riskLevel: context.riskLevel,
    })) {
      return decision;
    }
    const next: RecommendationStudioPostParseDecision = {
      blocked: decision.blocked || rule.actions_json.block === true,
      forceNoBet: decision.forceNoBet || rule.actions_json.forceNoBet === true,
      confidence: rule.actions_json.capConfidence != null
        ? Math.min(decision.confidence, Number(rule.actions_json.capConfidence))
        : decision.confidence,
      stakePercent: rule.actions_json.capStakePercent != null
        ? Math.min(decision.stakePercent, Number(rule.actions_json.capStakePercent))
        : decision.stakePercent,
      warnings: [...decision.warnings],
    };
    if (rule.actions_json.raiseMinEdge != null && context.valuePercent < Number(rule.actions_json.raiseMinEdge)) {
      next.forceNoBet = true;
      next.warnings.push(`MIN_EDGE_NOT_MET_${Number(rule.actions_json.raiseMinEdge)}`);
    }
    if (rule.actions_json.warning) next.warnings.push(rule.actions_json.warning);
    return next;
  }, initial);
}

export function buildPromptFromRecommendationStudioRelease(
  input: LiveAnalysisPromptInput,
  settings: LiveAnalysisPromptSettings,
  basePromptVersion: LiveAnalysisPromptVersion,
  release: RecommendationReleaseDetail | null,
  prePromptDecision?: RecommendationStudioPrePromptDecision,
): string {
  try {
    const adjustedInput: LiveAnalysisPromptInput = {
      ...input,
      oddsCanonical: filterOddsCanonicalByHiddenFamilies(
        input.oddsCanonical as Record<string, unknown>,
        prePromptDecision?.hiddenMarketFamilies ?? [],
      ),
    };
    const runtimeTokens = getRuntimeTokenMap(adjustedInput);
    const basePrompt = buildLiveAnalysisPrompt(adjustedInput, settings, basePromptVersion);
    const overlayText = release
      ? buildPromptOverlayText({
        sections: release.promptTemplate.sections,
        advancedAppendix: [
          release.promptTemplate.advanced_appendix,
          ...(prePromptDecision?.appendedInstructions ?? []),
        ].filter(Boolean).join('\n\n'),
        runtimeTokens,
      })
      : (prePromptDecision?.appendedInstructions.length
        ? `\n\nADMIN RUNTIME RULES\n${prePromptDecision.appendedInstructions.join('\n')}\n`
        : '');
    return basePrompt + overlayText;
  } catch (error) {
    console.warn('[recommendation-studio] Failed to compile dynamic release overlay, falling back to base prompt:', error instanceof Error ? error.message : String(error));
    return buildLiveAnalysisPrompt(input, settings, basePromptVersion);
  }
}
