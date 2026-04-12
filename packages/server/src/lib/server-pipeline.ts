// ============================================================
// Server-Side Pipeline — auto-triggered by check-live-trigger
// Ports the frontend pipeline logic to run server-side:
//   1. Fetch fixture data (stats, events, odds)
//   2. Build AI prompt
//   3. Call Gemini
//   4. Parse AI response
//   5. Save recommendation
//   6. Send Telegram notification
// ============================================================

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { callGemini } from './gemini.js';
import { sendTelegramMessage, sendTelegramPhoto } from './telegram.js';
import { formatOperationalTimestamp } from './time.js';
import { audit } from './audit.js';
import {
  fetchFixtureStatistics,
  fetchFixtureEvents,
  type ApiFixture,
  type ApiFixtureEvent,
  type ApiFixtureLineup,
  type ApiFixtureStat,
} from './football-api.js';
import { ensureFixturesForMatchIds, ensureMatchInsight, ensureScoutInsight } from './provider-insight-cache.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import {
  createRecommendation,
  getRecommendationsByMatchId,
  markRecommendationNotified,
} from '../repos/recommendations.repo.js';
import { createAiPerformanceRecord } from '../repos/ai-performance.repo.js';
import {
  getHistoricalPerformanceContext,
  type HistoricalPerformanceContext,
} from '../repos/ai-performance.repo.js';
import { getSettings } from '../repos/settings.repo.js';
import { createSnapshot, getLatestSnapshot } from '../repos/match-snapshots.repo.js';
import { resolveMatchOdds } from './odds-resolver.js';
import {
  checkShouldProceedServer,
  checkCoarseStalenessServer,
  checkStalenessServer,
} from './server-pipeline-gates.js';
import {
  extractStatusCode,
  recordProviderStatsSampleSafe,
} from './provider-sampling.js';
import {
  buildLiveAnalysisPrompt,
  getPromptStatsDetailLevel,
  isLiveAnalysisPromptVersion,
  LIVE_ANALYSIS_PROMPT_VERSION,
  type LiveAnalysisPromptVersion,
  type PromptAnalysisMode,
  type PromptStatsDetailLevel,
} from './live-analysis-prompt.js';
import { normalizeMarket } from './normalize-market.js';
import { hasUsableStrategicContext } from './strategic-context.service.js';
import { createPromptShadowRun } from '../repos/prompt-shadow-runs.repo.js';
import { getLeagueProfileByLeagueId } from '../repos/league-profiles.repo.js';
import { getTeamProfileByTeamId } from '../repos/team-profiles.repo.js';
import { getLeagueById } from '../repos/leagues.repo.js';
import { getNotificationChannelAddressesByUserIds } from '../repos/notification-channels.repo.js';
import { isWebPushConfigured, sendWebPushNotification } from './web-push.js';
import { getAllSubscriptions, deleteSubscription, updateLastUsed } from '../repos/push-subscriptions.repo.js';
import {
  getEligibleTelegramDeliveryTargets,
  getEligibleDeliveryUserIds,
  markDeliveryRowsDelivered,
  markRecommendationDeliveriesDelivered,
  stageConditionOnlyDeliveries,
} from '../repos/recommendation-deliveries.repo.js';
import { recordOddsMovementsBulk, type OddsMovementInput } from '../repos/odds-movements.repo.js';
import {
  buildPrematchExpertFeaturesV1,
  getPrematchPriorStrength,
  type PrematchExpertFeaturesV1,
  type PrematchFeatureAvailability,
  type PrematchPriorStrength,
} from './prematch-expert-features.js';
import {
  applyRecommendationPolicy,
  getCorrelatedThesis,
  type RecommendationPolicyPreviousRow,
  type RecommendationPolicyStatsCompact,
} from './recommendation-policy.js';
import { getSegmentPolicyBlocklist } from './load-segment-policy-blocklist.js';
import { getSegmentPolicyStakeCaps } from './load-segment-policy-stake-cap.js';
import {
  detectGoalsCornersLineContamination,
  detectHtGoalsCornersLineContamination,
} from './odds-integrity.js';
import { parseBetMarketLineSuffix as parseLineSuffix, sameOddsLine as sameLine } from './odds-line-utils.js';
import { isMarketAllowedForEvidenceMode } from './evidence-mode-market-allowlist.js';
import { isFirstHalfApiBetName, isSecondHalfOnlyApiBetName } from './first-half-markets.js';
import { extractHalftimeScoreFromFixture } from './settle-context.js';
import { formatSelectionWithMarketContext } from './market-display.js';

const pipelineSkipAuditCounters = new Map<string, number>();

function shouldSamplePipelineSkipAudit(reason: string, stage: string, sampleEvery: number): boolean {
  const key = `${stage}:${reason || 'unknown'}`;
  const next = (pipelineSkipAuditCounters.get(key) ?? 0) + 1;
  pipelineSkipAuditCounters.set(key, next);
  if (sampleEvery <= 1) return true;
  return next % sampleEvery === 0;
}

/** Resolved pipeline settings: DB values take priority, env vars as fallback */
interface PipelineSettings {
  telegramChatId: string;
  aiModel: string;
  minConfidence: number;
  minOdds: number;
  minMinute: number;
  maxMinute: number;
  secondHalfStartMinute: number;
  reanalyzeMinMinutes: number;
  stalenessOddsDelta: number;
  latePhaseMinute: number;
  veryLatePhaseMinute: number;
  endgameMinute: number;
  /** Notification language sent to Telegram. 'vi' = Vietnamese only, 'en' = English only, 'both' = EN then VI. Default: 'vi'. */
  notificationLanguage: 'vi' | 'en' | 'both';
  /** Master switch for Telegram notifications. Default: true. */
  telegramEnabled: boolean;
  /** Master switch for Web Push notifications. Default: false. */
  webPushEnabled: boolean;
}

function buildOddsMovementRows(
  matchId: string,
  matchMinute: number,
  oddsCanonical: Record<string, unknown> | null | undefined,
): OddsMovementInput[] {
  const toNullableNumber = (value: unknown): number | null => {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const oc = (oddsCanonical ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const movements: OddsMovementInput[] = [];

  if (oc['1x2']) {
    movements.push({
      match_id: matchId,
      match_minute: matchMinute,
      market: '1x2',
      price_1: toNullableNumber(oc['1x2'].home),
      price_2: toNullableNumber(oc['1x2'].away),
      price_x: toNullableNumber(oc['1x2'].draw),
    });
  }
  if (oc.ou) {
    movements.push({
      match_id: matchId,
      match_minute: matchMinute,
      market: 'ou',
      line: toNullableNumber(oc.ou.line),
      price_1: toNullableNumber(oc.ou.over),
      price_2: toNullableNumber(oc.ou.under),
    });
  }
  if (oc.ah) {
    movements.push({
      match_id: matchId,
      match_minute: matchMinute,
      market: 'ah',
      line: toNullableNumber(oc.ah.line),
      price_1: toNullableNumber(oc.ah.home),
      price_2: toNullableNumber(oc.ah.away),
    });
  }
  if (oc.btts) {
    movements.push({
      match_id: matchId,
      match_minute: matchMinute,
      market: 'btts',
      price_1: toNullableNumber(oc.btts.yes),
      price_2: toNullableNumber(oc.btts.no),
    });
  }
  if (oc.corners_ou) {
    movements.push({
      match_id: matchId,
      match_minute: matchMinute,
      market: 'corners_ou',
      line: toNullableNumber(oc.corners_ou.line),
      price_1: toNullableNumber(oc.corners_ou.over),
      price_2: toNullableNumber(oc.corners_ou.under),
    });
  }
  if (oc['ht_1x2']) {
    movements.push({
      match_id: matchId,
      match_minute: matchMinute,
      market: 'ht_1x2',
      price_1: toNullableNumber(oc['ht_1x2'].home),
      price_2: toNullableNumber(oc['ht_1x2'].away),
      price_x: toNullableNumber(oc['ht_1x2'].draw),
    });
  }
  if (oc.ht_ou) {
    movements.push({
      match_id: matchId,
      match_minute: matchMinute,
      market: 'ht_ou',
      line: toNullableNumber(oc.ht_ou.line),
      price_1: toNullableNumber(oc.ht_ou.over),
      price_2: toNullableNumber(oc.ht_ou.under),
    });
  }
  if (oc.ht_ah) {
    movements.push({
      match_id: matchId,
      match_minute: matchMinute,
      market: 'ht_ah',
      line: toNullableNumber(oc.ht_ah.line),
      price_1: toNullableNumber(oc.ht_ah.home),
      price_2: toNullableNumber(oc.ht_ah.away),
    });
  }
  if (oc.ht_btts) {
    movements.push({
      match_id: matchId,
      match_minute: matchMinute,
      market: 'ht_btts',
      price_1: toNullableNumber(oc.ht_btts.yes),
      price_2: toNullableNumber(oc.ht_btts.no),
    });
  }

  return movements.filter((movement) => (
    movement.market
    && Object.values(movement).some((value) => value !== null && value !== undefined && value !== movement.match_id && value !== movement.match_minute && value !== movement.market)
  ));
}

/** Parse a numeric setting from DB, falling back to envDefault if absent or NaN. */
function parseNumSetting(raw: unknown, envDefault: number): number {
  const n = Number(raw);
  return isFinite(n) && raw !== '' && raw !== null && raw !== undefined ? n : envDefault;
}

function buildConfigPipelineSettings(): PipelineSettings {
  return {
    telegramChatId: '',
    aiModel: config.geminiModel,
    minConfidence: config.pipelineMinConfidence,
    minOdds: config.pipelineMinOdds,
    minMinute: config.pipelineMinMinute,
    maxMinute: config.pipelineMaxMinute,
    secondHalfStartMinute: config.pipelineSecondHalfStartMinute,
    reanalyzeMinMinutes: config.pipelineReanalyzeMinMinutes,
    stalenessOddsDelta: config.pipelineStalenessOddsDelta,
    latePhaseMinute: config.pipelineLatePhaseMinute,
    veryLatePhaseMinute: config.pipelineVeryLatePhaseMinute,
    endgameMinute: config.pipelineEndgameMinute,
    notificationLanguage: 'vi',
    telegramEnabled: false,
    webPushEnabled: false,
  };
}

function parseBoolSetting(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return fallback;
}

async function loadPipelineSettings(): Promise<PipelineSettings> {
  const fallback = buildConfigPipelineSettings();
  const db = await getSettings().catch(() => ({} as Record<string, unknown>));
  const webPushEnabled = parseBoolSetting(db['WEB_PUSH_ENABLED'], fallback.webPushEnabled);
  const telegramEnabled = parseBoolSetting(db['TELEGRAM_ENABLED'], fallback.telegramEnabled);
  const telegramChatId = typeof db['TELEGRAM_CHAT_ID'] === 'string' ? db['TELEGRAM_CHAT_ID'].trim() : '';
  console.log(`[pipeline] Settings loaded: webPushEnabled=${webPushEnabled} (raw=${JSON.stringify(db['WEB_PUSH_ENABLED'])}), telegramEnabled=${telegramEnabled}`);
  return {
    telegramChatId,
    aiModel: String(db['AI_MODEL'] || '') || fallback.aiModel,
    minConfidence: parseNumSetting(db['MIN_CONFIDENCE'], fallback.minConfidence),
    minOdds: parseNumSetting(db['MIN_ODDS'], fallback.minOdds),
    minMinute: parseNumSetting(db['MIN_MINUTE'], fallback.minMinute),
    maxMinute: parseNumSetting(db['MAX_MINUTE'], fallback.maxMinute),
    secondHalfStartMinute: parseNumSetting(db['SECOND_HALF_START_MINUTE'], fallback.secondHalfStartMinute),
    reanalyzeMinMinutes: parseNumSetting(db['REANALYZE_MIN_MINUTES'], fallback.reanalyzeMinMinutes),
    stalenessOddsDelta: parseNumSetting(db['STALENESS_ODDS_DELTA'], fallback.stalenessOddsDelta),
    latePhaseMinute: parseNumSetting(db['LATE_PHASE_MINUTE'], fallback.latePhaseMinute),
    veryLatePhaseMinute: parseNumSetting(db['VERY_LATE_PHASE_MINUTE'], fallback.veryLatePhaseMinute),
    endgameMinute: parseNumSetting(db['ENDGAME_MINUTE'], fallback.endgameMinute),
    notificationLanguage: (['vi', 'en', 'both'] as const).includes(db['NOTIFICATION_LANGUAGE'] as 'vi' | 'en' | 'both')
      ? (db['NOTIFICATION_LANGUAGE'] as 'vi' | 'en' | 'both')
      : fallback.notificationLanguage,
    telegramEnabled,
    webPushEnabled,
  };
}

const defaultPipelineDeps = {
  fetchFixtureStatistics,
  fetchFixtureEvents,
  ensureMatchInsight,
  ensureScoutInsight,
  resolveMatchOdds,
  getRecommendationsByMatchId,
  getLatestSnapshot,
  createSnapshot,
  callGemini,
  createRecommendation,
  markRecommendationNotified,
  createAiPerformanceRecord,
  getHistoricalPerformanceContext,
  sendTelegramMessage,
  sendTelegramPhoto,
  createPromptShadowRun,
  getLeagueProfileByLeagueId,
  getTeamProfileByTeamId,
  getLeagueById,
  getNotificationChannelAddressesByUserIds,
  getEligibleTelegramDeliveryTargets,
  getEligibleDeliveryUserIds,
  markDeliveryRowsDelivered,
  markRecommendationDeliveriesDelivered,
  stageConditionOnlyDeliveries,
};

type PipelineDeps = typeof defaultPipelineDeps;

const HISTORICAL_PROMPT_CONTEXT_TTL_MS = 10 * 60 * 1000;
let historicalPromptContextCache: {
  data: HistoricalPerformanceContext;
  expiresAt: number;
} | null = null;

async function loadHistoricalPromptContext(deps: Pick<PipelineDeps, 'getHistoricalPerformanceContext'>) {
  const now = Date.now();
  if (historicalPromptContextCache && historicalPromptContextCache.expiresAt > now) {
    return historicalPromptContextCache.data;
  }

  try {
    const data = await deps.getHistoricalPerformanceContext();
    historicalPromptContextCache = {
      data,
      expiresAt: now + HISTORICAL_PROMPT_CONTEXT_TTL_MS,
    };
    return data;
  } catch (err) {
    console.warn('[pipeline] Historical performance context unavailable:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export interface PipelineExecutionOptions {
  shadowMode?: boolean;
  sampleProviderData?: boolean;
  skipSettingsLoad?: boolean;
  forceAnalyze?: boolean;
  skipProceedGate?: boolean;
  skipStalenessGate?: boolean;
  modelOverride?: string;
  promptVersionOverride?: LiveAnalysisPromptVersion;
  userQuestion?: string;
  followUpHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
  advisoryOnly?: boolean;
  dependencies?: Partial<PipelineDeps>;
  previousRecommendations?: Array<{
    minute: number | null;
    odds: number | null;
    bet_market: string;
    selection: string;
    score: string;
    status?: string | null;
    result?: string;
    confidence?: number | null;
    stake_percent?: number | null;
    reasoning?: string;
  }> | null;
  previousSnapshot?: {
    minute: number;
    home_score: number;
    away_score: number;
    status?: string | null;
    odds: Record<string, unknown>;
    stats?: Record<string, unknown>;
  } | null;
  /** Settled replay: prompt + policy treat row as an approved historical pick trace. */
  settledReplayApprovedTrace?: boolean;
  settledReplayTraceOriginalBetMarket?: string;
  settledReplayTraceOriginalSelection?: string;
  /** When true with settledReplayApprovedTrace, still run recommendation-policy (production parity). Default skips policy when trace is on. */
  applySettledReplayPolicy?: boolean;
}

// ==================== Types ====================

interface StatsCompact {
  possession: { home: string | null; away: string | null };
  shots: { home: string | null; away: string | null };
  shots_on_target: { home: string | null; away: string | null };
  corners: { home: string | null; away: string | null };
  fouls: { home: string | null; away: string | null };
  offsides: { home: string | null; away: string | null };
  yellow_cards: { home: string | null; away: string | null };
  red_cards: { home: string | null; away: string | null };
  goalkeeper_saves: { home: string | null; away: string | null };
  blocked_shots: { home: string | null; away: string | null };
  total_passes: { home: string | null; away: string | null };
  passes_accurate: { home: string | null; away: string | null };
  shots_off_target?: { home: string | null; away: string | null };
  shots_inside_box?: { home: string | null; away: string | null };
  shots_outside_box?: { home: string | null; away: string | null };
  expected_goals?: { home: string | null; away: string | null };
  goals_prevented?: { home: string | null; away: string | null };
  passes_percent?: { home: string | null; away: string | null };
}

interface EventCompact {
  minute: number;
  extra: number | null;
  team: string;
  type: string;
  detail: string;
  player: string;
}

/** Single quoted Asian handicap rung (home-centric line). */
export type OddsAhRung = { line: number; home: number | null; away: number | null };

interface OddsCanonical {
  '1x2'?: { home: number | null; draw: number | null; away: number | null };
  ou?: { line: number; over: number | null; under: number | null };
  /** Second goals O/U line nearest to main (tighter ladder); optional context for LLM. */
  ou_adjacent?: { line: number; over: number | null; under: number | null };
  ah?: { line: number; home: number | null; away: number | null };
  /** Second Asian handicap line nearest to main; optional context for LLM. */
  ah_adjacent?: { line: number; home: number | null; away: number | null };
  /** Additional FT Asian handicap rungs (beyond main+adjacent), sorted by distance from main — up to 2. */
  ah_extra?: OddsAhRung[];
  btts?: { yes: number | null; no: number | null };
  corners_ou?: { line: number; over: number | null; under: number | null };
  /** First-half (H1) match odds — keys in prompts / bet_market use `ht_*` prefix. */
  ht_1x2?: { home: number | null; draw: number | null; away: number | null };
  ht_ou?: { line: number; over: number | null; under: number | null };
  ht_ou_adjacent?: { line: number; over: number | null; under: number | null };
  ht_ah?: { line: number; home: number | null; away: number | null };
  ht_ah_adjacent?: { line: number; home: number | null; away: number | null };
  /** Additional H1 Asian handicap rungs (beyond main+adjacent), up to 2. */
  ht_ah_extra?: OddsAhRung[];
  ht_btts?: { yes: number | null; no: number | null };
}

interface OddsSanitizationResult {
  canonical: OddsCanonical;
  available: boolean;
  warnings: string[];
  suspicious: boolean;
}

interface DerivedInsights {
  goal_tempo: number;
  btts_status: boolean;
  home_goals_timeline: number[];
  away_goals_timeline: number[];
  last_goal_minute: number | null;
  total_cards: number;
  home_cards: number;
  away_cards: number;
  home_reds: number;
  away_reds: number;
  home_subs: number;
  away_subs: number;
  momentum: 'home' | 'away' | 'neutral';
  intensity: 'low' | 'medium' | 'high';
}

type StatsSource = 'api-football';
type EvidenceMode =
  | 'full_live_data'
  | 'stats_only'
  | 'odds_events_only_degraded'
  | 'events_only_degraded'
  | 'low_evidence';

interface ParsedAiResponse {
  decision_kind: 'ai_push' | 'condition_only' | 'no_bet';
  should_push: boolean;
  ai_should_push: boolean;
  system_should_bet: boolean;
  final_should_bet: boolean;
  selection: string;
  bet_market: string;
  confidence: number;
  reasoning_en: string;
  reasoning_vi: string;
  warnings: string[];
  value_percent: number;
  risk_level: string;
  stake_percent: number;
  condition_triggered_suggestion: string;
  custom_condition_matched: boolean;
  custom_condition_status: 'none' | 'evaluated' | 'parse_error';
  custom_condition_summary_en: string;
  custom_condition_summary_vi: string;
  custom_condition_reason_en: string;
  custom_condition_reason_vi: string;
  condition_triggered_reasoning_en: string;
  condition_triggered_reasoning_vi: string;
  condition_triggered_confidence: number;
  condition_triggered_stake: number;
  condition_triggered_special_override: boolean;
  condition_triggered_special_override_reason_en: string;
  condition_triggered_special_override_reason_vi: string;
  condition_triggered_should_push: boolean;
  follow_up_answer_en: string;
  follow_up_answer_vi: string;
  ai_selection: string;
  ai_confidence: number;
  ai_odd_raw: number | null;
  ai_warnings: string[];
  usable_odd: number | null;
  mapped_odd: number | null;
  odds_for_display: number | string | null;
}

interface ConditionTriggeredSaveDecision {
  shouldSave: boolean;
  selection: string;
  betMarket: string;
  odds: number | null;
  confidence: number;
  stakePercent: number;
  reasoningEn: string;
  reasoningVi: string;
  warnings: string[];
}

function isNoBetConditionSuggestion(value: string): boolean {
  return /^no bet\b/i.test(String(value || '').trim());
}

function hasNonDuplicateResult(result: string | null | undefined): boolean {
  return String(result ?? '').trim().toLowerCase() !== 'duplicate';
}

function findSameThesisRecommendations(
  previousRecommendations: RecommendationPolicyPreviousRow[],
  selection: string,
  betMarket: string,
): RecommendationPolicyPreviousRow[] {
  const thesis = getCorrelatedThesis(normalizeMarket(selection, betMarket));
  if (!thesis) return [];
  return previousRecommendations
    .filter((row) => hasNonDuplicateResult(row.result))
    .filter((row) => getCorrelatedThesis(normalizeMarket(row.selection ?? '', row.bet_market ?? '')) === thesis);
}

function evaluateConditionTriggeredSaveDecision(args: {
  parsed: ParsedAiResponse;
  previousRecommendations: RecommendationPolicyPreviousRow[];
  oddsCanonical: OddsCanonical;
  minute: number;
  score: string;
  minOdds: number;
  minConfidence: number;
  promptVersion: LiveAnalysisPromptVersion;
  statsCompact: RecommendationPolicyStatsCompact | null;
}): ConditionTriggeredSaveDecision {
  const warnings: string[] = [];
  const selection = String(args.parsed.condition_triggered_suggestion || '').trim();
  const betMarket = normalizeMarket(selection);

  if (!args.parsed.condition_triggered_should_push) {
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds: null,
      confidence: args.parsed.condition_triggered_confidence,
      stakePercent: args.parsed.condition_triggered_stake,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  if (!selection || isNoBetConditionSuggestion(selection)) {
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds: null,
      confidence: args.parsed.condition_triggered_confidence,
      stakePercent: args.parsed.condition_triggered_stake,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  if (!betMarket || betMarket === 'unknown') {
    warnings.push('Condition-triggered bet not saved because the suggested market could not be normalized.');
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds: null,
      confidence: args.parsed.condition_triggered_confidence,
      stakePercent: args.parsed.condition_triggered_stake,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  const odds = extractOddsFromSelection(selection, betMarket, args.oddsCanonical);
  if (odds == null || odds < args.minOdds) {
    warnings.push('Condition-triggered bet not saved because live odds are unavailable or below the minimum threshold.');
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds,
      confidence: args.parsed.condition_triggered_confidence,
      stakePercent: args.parsed.condition_triggered_stake,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  if (args.parsed.condition_triggered_confidence < args.minConfidence) {
    warnings.push('Condition-triggered bet not saved because confidence is below the minimum threshold.');
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds,
      confidence: args.parsed.condition_triggered_confidence,
      stakePercent: args.parsed.condition_triggered_stake,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  const policyResult = applyRecommendationPolicy({
    selection,
    betMarket,
    minute: args.minute,
    score: args.score,
    odds,
    confidence: args.parsed.condition_triggered_confidence,
    valuePercent: args.parsed.value_percent,
    stakePercent: args.parsed.condition_triggered_stake,
    promptVersion: args.promptVersion,
    previousRecommendations: args.previousRecommendations,
    statsCompact: args.statsCompact ?? undefined,
    segmentBlocklist: getSegmentPolicyBlocklist(),
    segmentStakeCaps: getSegmentPolicyStakeCaps(),
  });

  if (policyResult.blocked) {
    warnings.push(...policyResult.warnings);
    warnings.push('Condition-triggered bet kept as alert only because policy blocked persistence.');
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds,
      confidence: policyResult.confidence,
      stakePercent: policyResult.stakePercent,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  const sameThesisRows = findSameThesisRecommendations(args.previousRecommendations, selection, betMarket);
  if (sameThesisRows.length === 0) {
    return {
      shouldSave: true,
      selection,
      betMarket,
      odds,
      confidence: policyResult.confidence,
      stakePercent: policyResult.stakePercent,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  if (!args.parsed.condition_triggered_special_override) {
    warnings.push('Existing saved exposure already covers this thesis. Condition alert sent without saving another bet.');
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds,
      confidence: policyResult.confidence,
      stakePercent: policyResult.stakePercent,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  const latestSameThesis = sameThesisRows[0] ?? null;
  const latestCanonicalMarket = latestSameThesis
    ? normalizeMarket(latestSameThesis.selection ?? '', latestSameThesis.bet_market ?? '')
    : null;
  const overrideReasonEn = String(args.parsed.condition_triggered_special_override_reason_en || '').trim();
  const overrideReasonVi = String(args.parsed.condition_triggered_special_override_reason_vi || '').trim();

  if (!overrideReasonEn && !overrideReasonVi) {
    warnings.push('Special override requested, but no override reason was provided. Alert sent without saving another bet.');
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds,
      confidence: policyResult.confidence,
      stakePercent: policyResult.stakePercent,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  if (!latestCanonicalMarket || latestCanonicalMarket !== betMarket) {
    warnings.push('Special override can only update the same saved line. A different line on the same thesis stays alert-only.');
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds,
      confidence: policyResult.confidence,
      stakePercent: policyResult.stakePercent,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  const previousOdds = Number(latestSameThesis?.odds ?? null);
  if (!Number.isFinite(previousOdds) || odds < previousOdds + 0.1) {
    warnings.push('Special override requires a materially better live price on the same line. Alert sent without saving another bet.');
    return {
      shouldSave: false,
      selection,
      betMarket,
      odds,
      confidence: policyResult.confidence,
      stakePercent: policyResult.stakePercent,
      reasoningEn: args.parsed.condition_triggered_reasoning_en,
      reasoningVi: args.parsed.condition_triggered_reasoning_vi,
      warnings,
    };
  }

  warnings.push('Special override accepted: updating the existing saved line with a materially better price.');
  return {
    shouldSave: true,
    selection,
    betMarket,
    odds,
    confidence: policyResult.confidence,
    stakePercent: policyResult.stakePercent,
    reasoningEn: args.parsed.condition_triggered_reasoning_en,
    reasoningVi: args.parsed.condition_triggered_reasoning_vi,
    warnings,
  };
}

export interface MatchPipelineResult {
  matchId: string;
  matchDisplay?: string;
  homeName?: string;
  awayName?: string;
  league?: string;
  minute?: number | string;
  score?: string;
  status?: string;
  success: boolean;
  decisionKind: 'ai_push' | 'condition_only' | 'no_bet';
  shouldPush: boolean;
  selection: string;
  confidence: number;
  saved: boolean;
  notified: boolean;
  error?: string;
  debug?: {
    analysisRunId?: string;
    shadowMode: boolean;
    advisoryOnly?: boolean;
    skippedAt?: 'proceed' | 'staleness';
    skipReason?: string;
    analysisMode?: PromptAnalysisMode;
    oddsSource?: string;
    oddsAvailable?: boolean;
    statsAvailable?: boolean;
    statsSource?: StatsSource;
    evidenceMode?: EvidenceMode;
    statsFallbackUsed?: boolean;
    statsFallbackReason?: string;
    promptVersion?: string;
    promptDataLevel?: PromptStatsDetailLevel;
    prematchAvailability?: PrematchFeatureAvailability;
    prematchNoisePenalty?: number | null;
    prematchStrength?: PrematchPriorStrength;
    structuredPrematchAskAi?: boolean;
    structuredPrematchAskAiReason?: string;
    promptChars?: number;
    promptEstimatedTokens?: number;
    aiTextChars?: number;
    aiTextEstimatedTokens?: number;
    llmLatencyMs?: number;
    /** Wall time from processMatch start until immediately before executePromptAnalysis (excludes prompt build + Gemini). */
    preLlmLatencyMs?: number;
    totalLatencyMs?: number;
    prompt?: string;
    aiText?: string;
    parsed?: Record<string, unknown>;
  };
}

export interface PipelineResult {
  totalMatches: number;
  processed: number;
  errors: number;
  results: MatchPipelineResult[];
}

// ==================== Stat Helpers ====================

function getStatValue(
  teamStats: Array<{ type: string; value: string | number | null }>,
  statName: string,
): string | null {
  if (!Array.isArray(teamStats)) return null;
  const stat = teamStats.find((s) => s.type === statName);
  return stat?.value != null ? String(stat.value) : null;
}

function parseTwoSide(h: string | null, a: string | null): { home: string | null; away: string | null } {
  return { home: h ?? null, away: a ?? null };
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function summarizeStatsCoverage(
  statsCompact: StatsCompact,
  statsRaw: ApiFixtureStat[],
  eventsRaw: ApiFixtureEvent[],
  statsError: unknown,
  eventsError: unknown,
): Record<string, unknown> {
  const tracked = [
    statsCompact.possession,
    statsCompact.shots,
    statsCompact.shots_on_target,
    statsCompact.corners,
    statsCompact.fouls,
    statsCompact.offsides,
    statsCompact.yellow_cards,
    statsCompact.red_cards,
    statsCompact.goalkeeper_saves,
    statsCompact.blocked_shots,
    statsCompact.total_passes,
    statsCompact.passes_accurate,
  ];
  const populated = tracked.filter((value) => value.home != null || value.away != null).length;
  return {
    team_count: statsRaw.length,
    event_count: eventsRaw.length,
    populated_stat_pairs: populated,
    total_stat_pairs: tracked.length,
    has_possession: statsCompact.possession.home != null || statsCompact.possession.away != null,
    has_shots: statsCompact.shots.home != null || statsCompact.shots.away != null,
    has_shots_on_target: statsCompact.shots_on_target.home != null || statsCompact.shots_on_target.away != null,
    has_corners: statsCompact.corners.home != null || statsCompact.corners.away != null,
    stats_fetch_ok: !statsError,
    events_fetch_ok: !eventsError,
  };
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readProfileWindowSnapshot(value: unknown): {
  sampleMatches: number | null;
  eventCoverage: number | null;
  topLeagueOnly: boolean | null;
} {
  const record = asObjectRecord(value);
  const payload = asObjectRecord(record?.profile) ?? record;
  const window = asObjectRecord(payload?.window);
  const sampleMatches = Number(window?.sample_matches);
  const eventCoverage = Number(window?.event_coverage);
  return {
    sampleMatches: Number.isFinite(sampleMatches) ? sampleMatches : null,
    eventCoverage: Number.isFinite(eventCoverage) ? eventCoverage : null,
    topLeagueOnly: typeof window?.top_league_only === 'boolean' ? window.top_league_only : null,
  };
}

function readTeamOverlaySnapshot(value: unknown): {
  sourceMode: string;
  sourceConfidence: string | null;
} {
  const record = asObjectRecord(value);
  const payload = asObjectRecord(record?.profile) ?? record;
  const overlay = asObjectRecord(payload?.tactical_overlay);
  return {
    sourceMode: String(overlay?.source_mode ?? 'unknown').trim() || 'unknown',
    sourceConfidence: typeof overlay?.source_confidence === 'string'
      ? overlay.source_confidence
      : null,
  };
}

function classifyProfileCoverageBand(
  leagueProfileWindow: { sampleMatches: number | null; eventCoverage: number | null },
  homeTeamProfileWindow: { sampleMatches: number | null; eventCoverage: number | null },
  awayTeamProfileWindow: { sampleMatches: number | null; eventCoverage: number | null },
): 'strong' | 'partial' | 'thin' | 'unknown' {
  const windows = [leagueProfileWindow, homeTeamProfileWindow, awayTeamProfileWindow];
  const presentCount = windows.filter((window) => (window.sampleMatches ?? 0) > 0).length;
  if (presentCount === 0) return 'unknown';
  const strongCount = windows.filter((window) => {
    const sampleMatches = window.sampleMatches ?? 0;
    const eventCoverage = window.eventCoverage ?? 0;
    return sampleMatches > 0 && eventCoverage >= 0.6;
  }).length;
  if (presentCount === 3 && strongCount === 3) return 'strong';
  if (presentCount >= 2 || strongCount >= 1) return 'partial';
  return 'thin';
}

function classifyOverlayCoverageBand(
  homeOverlaySnapshot: { sourceMode: string; sourceConfidence: string | null },
  awayOverlaySnapshot: { sourceMode: string; sourceConfidence: string | null },
): 'both' | 'one' | 'none' {
  const hasOverlay = (value: string) => value !== 'default_neutral' && value !== 'unknown';
  const home = hasOverlay(homeOverlaySnapshot.sourceMode);
  const away = hasOverlay(awayOverlaySnapshot.sourceMode);
  if (home && away) return 'both';
  if (home || away) return 'one';
  return 'none';
}

function classifyProfileScopeBand(
  leagueProfileWindow: { sampleMatches: number | null; eventCoverage: number | null; topLeagueOnly: boolean | null },
  homeTeamProfileWindow: { sampleMatches: number | null; eventCoverage: number | null; topLeagueOnly: boolean | null },
  awayTeamProfileWindow: { sampleMatches: number | null; eventCoverage: number | null; topLeagueOnly: boolean | null },
): 'top_league_only' | 'cross_competition' | 'unknown' {
  const windows = [leagueProfileWindow, homeTeamProfileWindow, awayTeamProfileWindow]
    .filter((window) => (window.sampleMatches ?? 0) > 0);
  if (windows.length === 0) return 'unknown';
  if (windows.some((window) => window.topLeagueOnly === false)) return 'cross_competition';
  if (windows.every((window) => window.topLeagueOnly === true)) return 'top_league_only';
  return 'unknown';
}

function buildRecommendationDecisionContext(args: {
  evidenceMode: EvidenceMode;
  promptDataLevel: PromptStatsDetailLevel;
  prematchAvailability?: PrematchFeatureAvailability;
  prematchStrength?: PrematchPriorStrength;
  prematchNoisePenalty: number | null;
  structuredPrematchAskAi: boolean;
  structuredPrematchAskAiReason: string;
  statsSource: StatsSource;
  oddsSource: string;
  leagueProfileWindow: { sampleMatches: number | null; eventCoverage: number | null; topLeagueOnly: boolean | null };
  homeTeamProfileWindow: { sampleMatches: number | null; eventCoverage: number | null; topLeagueOnly: boolean | null };
  awayTeamProfileWindow: { sampleMatches: number | null; eventCoverage: number | null; topLeagueOnly: boolean | null };
  homeOverlaySnapshot: { sourceMode: string; sourceConfidence: string | null };
  awayOverlaySnapshot: { sourceMode: string; sourceConfidence: string | null };
  policyBlocked: boolean;
  policyWarnings: string[];
}): Record<string, unknown> {
  const profileCoverageBand = classifyProfileCoverageBand(
    args.leagueProfileWindow,
    args.homeTeamProfileWindow,
    args.awayTeamProfileWindow,
  );
  const profileScopeBand = classifyProfileScopeBand(
    args.leagueProfileWindow,
    args.homeTeamProfileWindow,
    args.awayTeamProfileWindow,
  );
  const overlayCoverageBand = classifyOverlayCoverageBand(
    args.homeOverlaySnapshot,
    args.awayOverlaySnapshot,
  );
  return {
    evidenceMode: args.evidenceMode,
    promptDataLevel: args.promptDataLevel,
    prematchAvailability: args.prematchAvailability ?? 'none',
    prematchStrength: args.prematchStrength ?? 'none',
    prematchNoisePenalty: args.prematchNoisePenalty,
    structuredPrematchAskAi: args.structuredPrematchAskAi,
    structuredPrematchAskAiReason: args.structuredPrematchAskAiReason,
    statsSource: args.statsSource,
    oddsSource: args.oddsSource,
    profileCoverageBand,
    profileScopeBand,
    overlayCoverageBand,
    leagueProfileSampleMatches: args.leagueProfileWindow.sampleMatches,
    leagueProfileEventCoverage: args.leagueProfileWindow.eventCoverage,
    leagueProfileTopLeagueOnly: args.leagueProfileWindow.topLeagueOnly,
    homeTeamProfileSampleMatches: args.homeTeamProfileWindow.sampleMatches,
    homeTeamProfileEventCoverage: args.homeTeamProfileWindow.eventCoverage,
    homeTeamProfileTopLeagueOnly: args.homeTeamProfileWindow.topLeagueOnly,
    awayTeamProfileSampleMatches: args.awayTeamProfileWindow.sampleMatches,
    awayTeamProfileEventCoverage: args.awayTeamProfileWindow.eventCoverage,
    awayTeamProfileTopLeagueOnly: args.awayTeamProfileWindow.topLeagueOnly,
    homeTacticalOverlaySourceMode: args.homeOverlaySnapshot.sourceMode,
    homeTacticalOverlaySourceConfidence: args.homeOverlaySnapshot.sourceConfidence,
    awayTacticalOverlaySourceMode: args.awayOverlaySnapshot.sourceMode,
    awayTacticalOverlaySourceConfidence: args.awayOverlaySnapshot.sourceConfidence,
    policyBlocked: args.policyBlocked,
    policyWarningCount: args.policyWarnings.length,
    policyWarningKeys: args.policyWarnings,
    policyImpactBand: args.policyWarnings.length > 0 ? 'warned' : 'clean',
  };
}

function deriveEvidenceMode(
  statsAvailable: boolean,
  oddsAvailable: boolean,
  eventsCompact: EventCompact[],
): EvidenceMode {
  if (statsAvailable && oddsAvailable) return 'full_live_data';
  if (statsAvailable && !oddsAvailable) return 'stats_only';
  if (!statsAvailable && oddsAvailable && eventsCompact.length > 0) return 'odds_events_only_degraded';
  if (!statsAvailable && !oddsAvailable && eventsCompact.length > 0) return 'events_only_degraded';
  return 'low_evidence';
}

function canRunStructuredPrematchAskAi(args: {
  analysisMode: PromptAnalysisMode;
  status: string;
  prediction: Record<string, unknown> | null;
  prematchExpertFeatures: PrematchExpertFeaturesV1 | null;
}): {
  eligible: boolean;
  reason:
    | 'manual_force_required'
    | 'not_started_only'
    | 'prematch_features_missing'
    | 'top_league_required'
    | 'prematch_availability_too_thin'
    | 'prediction_or_profile_coverage_too_thin'
    | 'eligible';
} {
  if (args.analysisMode !== 'manual_force') {
    return { eligible: false, reason: 'manual_force_required' };
  }
  if (String(args.status || '').trim().toUpperCase() !== 'NS') {
    return { eligible: false, reason: 'not_started_only' };
  }

  const features = args.prematchExpertFeatures;
  if (!features) {
    return { eligible: false, reason: 'prematch_features_missing' };
  }
  if (features.meta.top_league !== true) {
    return { eligible: false, reason: 'top_league_required' };
  }
  if (features.meta.availability !== 'full' && features.meta.availability !== 'partial') {
    return { eligible: false, reason: 'prematch_availability_too_thin' };
  }

  const strategicCoverage = features.trust_and_coverage.strategic_quant_fields_present;
  const leagueCoverage = features.trust_and_coverage.league_profile_fields_present;
  const teamCoverage = features.trust_and_coverage.team_profile_fields_present;
  const predictionCoverage = features.trust_and_coverage.prediction_fields_present;
  const sourceQuality = features.meta.source_quality;
  const hasProviderPredictionSupport = !!args.prediction && predictionCoverage >= 2;
  const hasStrongProfileCoverage = teamCoverage >= 16 && leagueCoverage >= 6;
  const hasBalancedStructuredCoverage = (
    teamCoverage >= 8
    || leagueCoverage >= 8
    || (leagueCoverage >= 3 && strategicCoverage >= 2 && (sourceQuality === 'high' || sourceQuality === 'medium'))
  );

  if (!(hasProviderPredictionSupport || hasStrongProfileCoverage || hasBalancedStructuredCoverage)) {
    return { eligible: false, reason: 'prediction_or_profile_coverage_too_thin' };
  }

  return { eligible: true, reason: 'eligible' };
}

function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

interface PromptExecutionArtifacts {
  promptVersion: LiveAnalysisPromptVersion;
  prompt: string;
  promptChars: number;
  promptEstimatedTokens: number;
  aiText: string;
  aiTextChars: number;
  aiTextEstimatedTokens: number;
  llmLatencyMs: number;
  totalLatencyMs: number;
  parsed: ParsedAiResponse;
  policyBlocked: boolean;
  policyWarnings: string[];
}

interface PromptPolicyContext {
  previousRecommendations: RecommendationPolicyPreviousRow[];
}

interface PromptExecutionContext {
  homeName: string;
  awayName: string;
  league: string;
  minute: number;
  score: string;
  status: string;
  statsCompact: StatsCompact;
  statsAvailable: boolean;
  statsSource: StatsSource;
  evidenceMode: EvidenceMode;
  eventsCompact: EventCompact[];
  oddsCanonical: OddsCanonical;
  oddsAvailable: boolean;
  oddsSource: string;
  oddsFetchedAt: string | null;
  oddsSanityWarnings: string[];
  oddsSuspicious: boolean;
  derivedInsights: DerivedInsights | null;
  customConditions: string;
  recommendedCondition: string;
  recommendedConditionReason: string;
  strategicContext: Record<string, unknown> | null;
  leagueProfile: Record<string, unknown> | null;
  homeTeamProfile: Record<string, unknown> | null;
  awayTeamProfile: Record<string, unknown> | null;
  prematchExpertFeatures: PrematchExpertFeaturesV1 | null;
  structuredPrematchAskAi: boolean;
  analysisMode: PromptAnalysisMode;
  forceAnalyze: boolean;
  isManualPush: boolean;
  prediction: Record<string, unknown> | null;
  currentTotalGoals: number;
  previousRecommendations: Array<Record<string, unknown>>;
  historicalPerformance: HistoricalPerformanceContext | null;
  preMatchPredictionSummary: string;
  mode: string;
  statsFallbackReason: string;
  userQuestion?: string;
  followUpHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
  lineupsSnapshot?: {
    available: boolean;
    teams: Array<{
      side: 'home' | 'away';
      teamName: string;
      formation: string | null;
      coachName: string | null;
      starters: string[];
      substitutes: string[];
    }>;
  } | null;
  settledReplayApprovedTrace?: boolean;
  settledReplayOriginalBetMarket?: string;
  settledReplayOriginalSelection?: string;
  skipRecommendationPolicy?: boolean;
}

type FollowUpHistoryEntry = { role: 'user' | 'assistant'; text: string };

function resolveConfiguredPromptVersion(
  configuredVersion: string | undefined,
  fallback: LiveAnalysisPromptVersion,
): LiveAnalysisPromptVersion {
  if (!configuredVersion) return fallback;
  const trimmed = configuredVersion.trim();
  return isLiveAnalysisPromptVersion(trimmed) ? trimmed : fallback;
}

function clampShadowSampleRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function computeStableSampleRatio(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function shouldRunPromptShadow(args: {
  matchId: string;
  minute: number;
  activePromptVersion: LiveAnalysisPromptVersion;
  shadowPromptVersion: LiveAnalysisPromptVersion;
  shadowMode: boolean;
  promptVersionOverride?: LiveAnalysisPromptVersion;
}): boolean {
  if (args.shadowMode) return false;
  if (args.promptVersionOverride) return false;
  if (!config.liveAnalysisShadowEnabled) return false;
  if (args.activePromptVersion === args.shadowPromptVersion) return false;

  const sampleRate = clampShadowSampleRate(config.liveAnalysisShadowSampleRate);
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;

  const ratio = computeStableSampleRatio(
    `${args.matchId}:${args.minute}:${args.activePromptVersion}:${args.shadowPromptVersion}`,
  );
  return ratio < sampleRate;
}

async function executePromptAnalysis(
  deps: Pick<PipelineDeps, 'callGemini'>,
  model: string,
  settings: PipelineSettings,
  promptContext: PromptExecutionContext,
  promptVersion: LiveAnalysisPromptVersion,
  policyContext: PromptPolicyContext,
): Promise<PromptExecutionArtifacts> {
  const startedAt = Date.now();
  const prompt = buildServerPrompt(promptContext, settings, promptVersion);
  const promptChars = prompt.length;
  const promptEstimatedTokens = estimateTokenCount(prompt);

  const llmStartedAt = Date.now();
  const aiText = await deps.callGemini(prompt, model);
  const llmLatencyMs = Date.now() - llmStartedAt;
  const aiTextChars = aiText.length;
  const aiTextEstimatedTokens = estimateTokenCount(aiText);
  const parsedRaw = parseAiResponse(
    aiText,
    promptContext.oddsCanonical,
    promptContext.minute,
    settings,
    promptContext.evidenceMode,
  );
  const policyResult = applyRecommendationPolicy({
    selection: parsedRaw.selection,
    betMarket: parsedRaw.bet_market,
    minute: promptContext.minute,
    score: promptContext.score,
    odds: parsedRaw.mapped_odd,
    confidence: parsedRaw.confidence,
    valuePercent: parsedRaw.value_percent,
    stakePercent: parsedRaw.stake_percent,
    promptVersion,
    previousRecommendations: policyContext.previousRecommendations,
    statsCompact: promptContext.statsCompact,
    segmentBlocklist: getSegmentPolicyBlocklist(),
    segmentStakeCaps: getSegmentPolicyStakeCaps(),
  });
  const policyBlockedEffective = policyResult.blocked && !promptContext.skipRecommendationPolicy;
  const hasCustomCondition = !!String(promptContext.customConditions || '').trim();
  const lowEvidenceConditionOnly = promptContext.evidenceMode === 'low_evidence' && hasCustomCondition;
  const finalShouldBet = lowEvidenceConditionOnly
    ? false
    : parsedRaw.final_should_bet && !policyBlockedEffective;
  const conditionTriggeredShouldPush = parsedRaw.condition_triggered_should_push;
  const shouldPush = finalShouldBet || conditionTriggeredShouldPush;
  const decisionKind = finalShouldBet
    ? 'ai_push'
    : conditionTriggeredShouldPush
      ? 'condition_only'
      : 'no_bet';
  const parsed: ParsedAiResponse = {
    ...parsedRaw,
    should_push: shouldPush,
    ai_should_push: lowEvidenceConditionOnly ? false : parsedRaw.ai_should_push,
    system_should_bet: lowEvidenceConditionOnly ? false : parsedRaw.system_should_bet && !policyBlockedEffective,
    final_should_bet: finalShouldBet,
    decision_kind: decisionKind,
    confidence: policyResult.confidence,
    stake_percent: policyResult.stakePercent,
    ai_confidence: policyResult.confidence,
    condition_triggered_should_push: conditionTriggeredShouldPush,
    warnings: [
      ...parsedRaw.warnings,
      ...policyResult.warnings,
      ...(lowEvidenceConditionOnly ? ['LOW_EVIDENCE_CONDITION_ONLY'] : []),
    ],
    ai_warnings: [
      ...parsedRaw.ai_warnings,
      ...policyResult.warnings,
      ...(lowEvidenceConditionOnly ? ['LOW_EVIDENCE_CONDITION_ONLY'] : []),
    ],
  };

  return {
    promptVersion,
    prompt,
    promptChars,
    promptEstimatedTokens,
    aiText,
    aiTextChars,
    aiTextEstimatedTokens,
    llmLatencyMs,
    totalLatencyMs: Date.now() - startedAt,
    parsed,
    policyBlocked: policyResult.blocked,
    policyWarnings: [...policyResult.warnings],
  };
}

async function recordPromptShadowRunSafe(
  deps: Pick<PipelineDeps, 'createPromptShadowRun'>,
  row: Parameters<PipelineDeps['createPromptShadowRun']>[0],
): Promise<void> {
  try {
    await deps.createPromptShadowRun(row);
  } catch (err) {
    console.warn(
      '[pipeline] Prompt shadow run persistence failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function runPromptShadowComparison(args: {
  deps: Pick<PipelineDeps, 'callGemini' | 'createPromptShadowRun'>;
  analysisRunId: string;
  matchId: string;
  activePromptVersion: LiveAnalysisPromptVersion;
  shadowPromptVersion: LiveAnalysisPromptVersion;
  analysisMode: PromptAnalysisMode;
  evidenceMode: EvidenceMode;
  oddsSource: string;
  statsSource: StatsSource;
  promptContext: PromptExecutionContext;
  policyContext: PromptPolicyContext;
  activeAnalysis: PromptExecutionArtifacts;
  model: string;
  settings: PipelineSettings;
}): Promise<void> {
  await recordPromptShadowRunSafe(args.deps, {
    analysis_run_id: args.analysisRunId,
    match_id: args.matchId,
    execution_role: 'active',
    active_prompt_version: args.activePromptVersion,
    prompt_version: args.activeAnalysis.promptVersion,
    analysis_mode: args.analysisMode,
    evidence_mode: args.evidenceMode,
    success: true,
    should_push: args.activeAnalysis.parsed.should_push,
    ai_should_push: args.activeAnalysis.parsed.ai_should_push,
    selection: args.activeAnalysis.parsed.selection,
    bet_market: args.activeAnalysis.parsed.bet_market,
    confidence: args.activeAnalysis.parsed.confidence,
    warnings: args.activeAnalysis.parsed.warnings,
    odds_source: args.oddsSource,
    stats_source: args.statsSource,
    prompt_estimated_tokens: args.activeAnalysis.promptEstimatedTokens,
    response_estimated_tokens: args.activeAnalysis.aiTextEstimatedTokens,
    llm_latency_ms: args.activeAnalysis.llmLatencyMs,
    total_latency_ms: args.activeAnalysis.totalLatencyMs,
  });

  try {
    const shadowAnalysis = await executePromptAnalysis(
      args.deps,
      args.model,
      args.settings,
      args.promptContext,
      args.shadowPromptVersion,
      args.policyContext,
    );

    await recordPromptShadowRunSafe(args.deps, {
      analysis_run_id: args.analysisRunId,
      match_id: args.matchId,
      execution_role: 'shadow',
      active_prompt_version: args.activePromptVersion,
      prompt_version: args.shadowPromptVersion,
      analysis_mode: args.analysisMode,
      evidence_mode: args.evidenceMode,
      success: true,
      should_push: shadowAnalysis.parsed.should_push,
      ai_should_push: shadowAnalysis.parsed.ai_should_push,
      selection: shadowAnalysis.parsed.selection,
      bet_market: shadowAnalysis.parsed.bet_market,
      confidence: shadowAnalysis.parsed.confidence,
      warnings: shadowAnalysis.parsed.warnings,
      odds_source: args.oddsSource,
      stats_source: args.statsSource,
      prompt_estimated_tokens: shadowAnalysis.promptEstimatedTokens,
      response_estimated_tokens: shadowAnalysis.aiTextEstimatedTokens,
      llm_latency_ms: shadowAnalysis.llmLatencyMs,
      total_latency_ms: shadowAnalysis.totalLatencyMs,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await recordPromptShadowRunSafe(args.deps, {
      analysis_run_id: args.analysisRunId,
      match_id: args.matchId,
      execution_role: 'shadow',
      active_prompt_version: args.activePromptVersion,
      prompt_version: args.shadowPromptVersion,
      analysis_mode: args.analysisMode,
      evidence_mode: args.evidenceMode,
      success: false,
      error,
      odds_source: args.oddsSource,
      stats_source: args.statsSource,
    });
  }
}

// ==================== Derive Insights from Events ====================

function deriveInsightsFromEvents(
  events: EventCompact[],
  minute: number,
  homeName: string,
  awayName: string,
): DerivedInsights {
  const homeGoalsTimeline: number[] = [];
  const awayGoalsTimeline: number[] = [];
  let homeCards = 0, awayCards = 0, homeReds = 0, awayReds = 0;
  let homeSubs = 0, awaySubs = 0;
  let lastGoalMinute: number | null = null;
  const recentThreshold = Math.max(0, minute - 15);
  let homeRecent = 0, awayRecent = 0;

  for (const ev of events) {
    const isHome = ev.team === homeName;
    const isAway = ev.team === awayName;

    if (ev.type === 'goal') {
      lastGoalMinute = Math.max(lastGoalMinute ?? 0, ev.minute);
      if (isHome) homeGoalsTimeline.push(ev.minute);
      else if (isAway) awayGoalsTimeline.push(ev.minute);
    }
    if (ev.type === 'card') {
      const isRed = (ev.detail || '').toLowerCase().includes('red');
      if (isHome) { homeCards++; if (isRed) homeReds++; }
      else if (isAway) { awayCards++; if (isRed) awayReds++; }
    }
    if (ev.type === 'subst') {
      if (isHome) homeSubs++;
      else if (isAway) awaySubs++;
    }
    if (ev.minute >= recentThreshold) {
      if (isHome) homeRecent++;
      else if (isAway) awayRecent++;
    }
  }

  const totalCards = homeCards + awayCards;
  const totalGoals = homeGoalsTimeline.length + awayGoalsTimeline.length;
  const goalTempo = minute > 0 ? totalGoals / minute : 0;
  const eventsPerMinute = minute > 0 ? (totalGoals + totalCards) / minute : 0;
  const intensity: 'low' | 'medium' | 'high' = eventsPerMinute > 0.1 ? 'high' : eventsPerMinute > 0.05 ? 'medium' : 'low';
  const momentum: 'home' | 'away' | 'neutral' = homeRecent > awayRecent + 1 ? 'home' : awayRecent > homeRecent + 1 ? 'away' : 'neutral';

  return {
    goal_tempo: Math.round(goalTempo * 1000) / 1000,
    btts_status: homeGoalsTimeline.length > 0 && awayGoalsTimeline.length > 0,
    home_goals_timeline: homeGoalsTimeline,
    away_goals_timeline: awayGoalsTimeline,
    last_goal_minute: lastGoalMinute,
    total_cards: totalCards,
    home_cards: homeCards,
    away_cards: awayCards,
    home_reds: homeReds,
    away_reds: awayReds,
    home_subs: homeSubs,
    away_subs: awaySubs,
    momentum,
    intensity,
  };
}

function summarizeLineupsForPrompt(
  lineups: ApiFixtureLineup[] | null | undefined,
  homeTeamName: string,
  awayTeamName: string,
): {
  available: boolean;
  teams: Array<{
    side: 'home' | 'away';
    teamName: string;
    formation: string | null;
    coachName: string | null;
    starters: string[];
    substitutes: string[];
  }>;
} | null {
  if (!Array.isArray(lineups) || lineups.length === 0) return null;

  const teams = lineups.map((row) => {
    const normalizedName = String(row.team?.name ?? '').trim().toLowerCase();
    const side: 'home' | 'away' = normalizedName === awayTeamName.trim().toLowerCase() ? 'away' : 'home';
    return {
      side,
      teamName: String(row.team?.name ?? (side === 'home' ? homeTeamName : awayTeamName)).trim(),
      formation: row.formation ? String(row.formation).trim() : null,
      coachName: row.coach?.name ? String(row.coach.name).trim() : null,
      starters: Array.isArray(row.startXI)
        ? row.startXI
            .map((entry) => {
              const name = String(entry.player?.name ?? '').trim();
              const number = entry.player?.number != null ? `#${entry.player.number}` : '';
              const pos = entry.player?.pos ? ` ${entry.player.pos}` : '';
              return [number, name, pos].join(' ').trim();
            })
            .filter(Boolean)
            .slice(0, 11)
        : [],
      substitutes: Array.isArray(row.substitutes)
        ? row.substitutes
            .map((entry) => {
              const name = String(entry.player?.name ?? '').trim();
              const number = entry.player?.number != null ? `#${entry.player.number}` : '';
              const pos = entry.player?.pos ? ` ${entry.player.pos}` : '';
              return [number, name, pos].join(' ').trim();
            })
            .filter(Boolean)
            .slice(0, 12)
        : [],
    };
  });

  return { available: teams.length > 0, teams };
}

function normalizeComparableText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function questionMentionsLineup(question: string | null | undefined): boolean {
  const normalized = normalizeComparableText(question);
  if (!normalized) return false;
  return [
    'lineup',
    'line-up',
    'starting lineup',
    'starting xi',
    'start xi',
    'doi hinh',
    'doi hinh ra san',
    'ra san',
    'formation',
    'so do',
    'starting eleven',
    'xi',
  ].some((term) => normalized.includes(term));
}

function answerAlreadyMentionsLineupUnavailable(answer: string | null | undefined): boolean {
  const normalized = normalizeComparableText(answer);
  if (!normalized) return false;
  return (
    (normalized.includes('lineup') && (normalized.includes('unavailable') || normalized.includes('not available') || normalized.includes('not provided')))
    || (normalized.includes('doi hinh') && (normalized.includes('chua co') || normalized.includes('khong co') || normalized.includes('khong san co')))
  );
}

function enforceFollowUpLineupAvailability(
  parsed: ParsedAiResponse,
  options: {
    userQuestion?: string;
    lineupsSnapshot?: { available: boolean } | null;
  },
): void {
  if (!questionMentionsLineup(options.userQuestion)) return;
  if (options.lineupsSnapshot?.available === true) return;

  const unavailableEn = 'Confirmed lineup data is currently unavailable in this snapshot.';
  const unavailableVi = 'Du lieu doi hinh chinh thuc hien chua co trong snapshot nay.';

  const currentEn = String(parsed.follow_up_answer_en || '').trim();
  const currentVi = String(parsed.follow_up_answer_vi || '').trim();

  parsed.follow_up_answer_en = answerAlreadyMentionsLineupUnavailable(currentEn)
    ? currentEn
    : currentEn
      ? `${unavailableEn} ${currentEn}`
      : unavailableEn;
  parsed.follow_up_answer_vi = answerAlreadyMentionsLineupUnavailable(currentVi)
    ? currentVi
    : currentVi
      ? `${unavailableVi} ${currentVi}`
      : unavailableVi;
}

// ==================== Build Stats Compact ====================

function buildStatsCompact(
  homeStats: Array<{ type: string; value: string | number | null }>,
  awayStats: Array<{ type: string; value: string | number | null }>,
): StatsCompact {
  const getStat = (name: string) => parseTwoSide(
    getStatValue(homeStats, name),
    getStatValue(awayStats, name),
  );
  return {
    possession: getStat('Ball Possession'),
    shots: getStat('Total Shots'),
    shots_on_target: getStat('Shots on Goal'),
    corners: getStat('Corner Kicks'),
    fouls: getStat('Fouls'),
    offsides: getStat('Offsides'),
    yellow_cards: getStat('Yellow Cards'),
    red_cards: getStat('Red Cards'),
    goalkeeper_saves: getStat('Goalkeeper Saves'),
    blocked_shots: getStat('Blocked Shots'),
    total_passes: getStat('Total passes'),
    passes_accurate: getStat('Passes accurate'),
    shots_off_target: getStat('Shots off Goal'),
    shots_inside_box: getStat('Shots insidebox'),
    shots_outside_box: getStat('Shots outsidebox'),
    expected_goals: getStat('expected_goals'),
    goals_prevented: getStat('goals_prevented'),
    passes_percent: getStat('Passes %'),
  };
}

// ==================== Build Events Compact ====================

function buildEventsCompact(
  events: ApiFixtureEvent[],
  homeTeamId: number | undefined,
  awayTeamId: number | undefined,
  homeName: string,
  awayName: string,
): EventCompact[] {
  const sorted = [...events].sort((a, b) => (a.time?.elapsed || 0) - (b.time?.elapsed || 0));
  const compact: EventCompact[] = [];

  for (const ev of sorted) {
    const teamId = ev.team?.id;
    const sideName = teamId === homeTeamId ? homeName : teamId === awayTeamId ? awayName : (ev.team?.name || '');
    const type = ev.type || '';
    const detail = ev.detail || '';
    const minute = ev.time?.elapsed ?? 0;

    if (type === 'Goal') {
      compact.push({ minute, extra: ev.time?.extra ?? null, team: sideName, type: 'goal', detail, player: ev.player?.name || '' });
    }
    if (type === 'Card') {
      compact.push({ minute, extra: ev.time?.extra ?? null, team: sideName, type: 'card', detail, player: ev.player?.name || '' });
    }
    if (type === 'subst') {
      const playerIn = ev.assist?.name || '';
      const playerOut = ev.player?.name || '';
      compact.push({ minute, extra: ev.time?.extra ?? null, team: sideName, type: 'subst', detail: `${playerIn} for ${playerOut}`, player: playerIn });
    }
  }

  return compact;
}

// ==================== Build Odds Canonical ====================

const MAX_AH_LADDER_EXTRAS = 2;

export interface BuildOddsCanonicalOptions {
  /** Full-time total goals — steers main goals O/U toward the next tradable line in-play. */
  totalGoalsFt?: number | null;
  /** H1 total goals when known (live 1H/HT = current score; 2H+ = halftime score) — steers H1 O/U main. */
  totalGoalsHt?: number | null;
}

export function buildOddsCanonical(
  oddsResponse: unknown[],
  opts?: BuildOddsCanonicalOptions,
): { canonical: OddsCanonical; available: boolean } {
  if (!oddsResponse || !Array.isArray(oddsResponse) || oddsResponse.length === 0) {
    return { canonical: {}, available: false };
  }

  const resp = oddsResponse as Array<{ bookmakers?: Array<{ name: string; bets: Array<{ name: string; values: Array<{ value: string; odd: string; handicap?: string }> }> }> }>;
  const bookmakers = resp[0]?.bookmakers || [];
  if (bookmakers.length === 0) return { canonical: {}, available: false };

  const ftOddsMap: Record<string, number> = {};
  const htOddsMap: Record<string, number> = {};
  const best1X2 = { home: 0, draw: 0, away: 0 };
  const best1X2Ht = { home: 0, draw: 0, away: 0 };
  const bestBTTS = { yes: 0, no: 0 };
  const bestBTTSHt = { yes: 0, no: 0 };

  const ingestPeriod = (args: {
    betName: string;
    values: Array<{ value: string; odd: string; handicap?: string }>;
    isCornerBet: boolean;
    keyPrefix: '' | 'ht ';
    oddsMap: Record<string, number>;
    best1X2Local: { home: number; draw: number; away: number };
    bestBTTSLocal: { yes: number; no: number };
  }) => {
    const {
      betName, values, isCornerBet, keyPrefix, oddsMap, best1X2Local, bestBTTSLocal,
    } = args;
    const pk = (k: string) => (keyPrefix ? `${keyPrefix}${k}` : k);

    const is1x2Ft = betName.includes('1x2') || betName.includes('match winner') || betName.includes('fulltime result') || betName === 'full time result';
    const is1x2Ht = betName.includes('1x2') || betName.includes('winner') || betName.includes('fulltime result') || betName === 'full time result';
    const is1x2 = keyPrefix ? is1x2Ht : is1x2Ft;

    if (is1x2) {
      for (const v of values) {
        const label = String(v.value || '').toLowerCase().trim();
        const odd = toNumber(v.odd) ?? 0;
        if (!odd || odd <= 1) continue;
        if (label === 'home' || label === '1') best1X2Local.home = Math.max(best1X2Local.home, odd);
        if (label === 'draw' || label === 'x') best1X2Local.draw = Math.max(best1X2Local.draw, odd);
        if (label === 'away' || label === '2') best1X2Local.away = Math.max(best1X2Local.away, odd);
      }
    }

    if (!isCornerBet && (betName.includes('over/under') || betName.includes('over / under') || betName.includes('total goals') || betName.includes('match goals'))) {
      for (const v of values) {
        const raw = String(v.value || '').toLowerCase().trim();
        const hc = v.handicap ? String(v.handicap).trim() : '';
        const odd = toNumber(v.odd) ?? 0;
        if (!odd || odd <= 1) continue;
        let key: string;
        if (hc) {
          key = `${raw} ${hc}`;
        } else {
          const m = raw.match(/^(over|under)\s+([0-9]+(?:\.[0-9]+)?)$/);
          if (!m) continue;
          key = raw;
        }
        const slot = pk(key);
        if (!(slot in oddsMap) || odd > (oddsMap[slot] ?? 0)) oddsMap[slot] = odd;
      }
    }

    if (betName.includes('both teams') || betName === 'btts') {
      for (const v of values) {
        const label = String(v.value || '').toLowerCase().trim();
        const odd = toNumber(v.odd) ?? 0;
        if (!odd || odd <= 1) continue;
        if (label === 'yes') bestBTTSLocal.yes = Math.max(bestBTTSLocal.yes, odd);
        if (label === 'no') bestBTTSLocal.no = Math.max(bestBTTSLocal.no, odd);
      }
    }

    if (!isCornerBet && betName.includes('handicap')) {
      for (const v of values) {
        let raw = String(v.value || '').toLowerCase().trim();
        const hc = v.handicap ? String(v.handicap).trim() : '';
        const odd = toNumber(v.odd) ?? 0;
        if (!odd || odd <= 1) continue;
        let key: string;
        if (hc) {
          if (raw === '1') raw = 'home';
          if (raw === '2') raw = 'away';
          key = `${raw} ${hc}`;
        } else {
          const m = raw.match(/^(home|away|1|2)\s+([-+]?[0-9]+(?:\.[0-9]+)?)$/);
          if (!m) continue;
          let side = m[1];
          if (side === '1') side = 'home';
          if (side === '2') side = 'away';
          key = `${side} ${m[2]}`;
        }
        const slot = pk(key);
        if (!(slot in oddsMap) || odd > (oddsMap[slot] ?? 0)) oddsMap[slot] = odd;
      }
    }

    if (betName.includes('corner')) {
      for (const v of values) {
        const raw = String(v.value || '').toLowerCase().trim();
        const hc = v.handicap ? String(v.handicap).trim() : '';
        const odd = toNumber(v.odd) ?? 0;
        if (!odd || odd <= 1) continue;
        let key: string | null = null;
        if (hc && (raw === 'over' || raw === 'under')) {
          key = `corners ${raw} ${hc}`;
        } else {
          const m = raw.match(/^(over|under)\s+([0-9]+(?:\.[0-9]+)?)$/);
          if (m) key = `corners ${m[1]} ${m[2]}`;
        }
        if (key) {
          const slot = pk(key);
          if (!(slot in oddsMap) || odd > (oddsMap[slot] ?? 0)) oddsMap[slot] = odd;
        }
      }
    }
  };

  for (const bk of bookmakers) {
    for (const bet of bk.bets || []) {
      const betName = String(bet.name || '').toLowerCase();
      const values = bet.values || [];
      const isCornerBet = betName.includes('corner');
      const isHalfSpecific = isFirstHalfApiBetName(betName) || isSecondHalfOnlyApiBetName(betName);
      const isHtFirstHalfOnly = isFirstHalfApiBetName(betName) && !isSecondHalfOnlyApiBetName(betName);

      if (!isHalfSpecific) {
        ingestPeriod({
          betName,
          values,
          isCornerBet,
          keyPrefix: '',
          oddsMap: ftOddsMap,
          best1X2Local: best1X2,
          bestBTTSLocal: bestBTTS,
        });
      }
      if (isHtFirstHalfOnly) {
        ingestPeriod({
          betName,
          values,
          isCornerBet,
          keyPrefix: 'ht ',
          oddsMap: htOddsMap,
          best1X2Local: best1X2Ht,
          bestBTTSLocal: bestBTTSHt,
        });
      }
    }
  }

  const canonical: OddsCanonical = {};

  if (best1X2.home > 0 || best1X2.away > 0 || best1X2.draw > 0) {
    canonical['1x2'] = {
      home: best1X2.home || null,
      draw: best1X2.draw || null,
      away: best1X2.away || null,
    };
  }

  const goalsOuPair = buildMainOUWithAdjacent(
    ftOddsMap,
    /^(over|under)\s+[0-9]+(\.[0-9]+)?$/,
    /^(over|under)\s+([0-9]+(\.[0-9]+)?)/,
    opts?.totalGoalsFt ?? null,
  );
  if (goalsOuPair) {
    canonical['ou'] = goalsOuPair.main;
    if (goalsOuPair.adjacent) canonical['ou_adjacent'] = goalsOuPair.adjacent;
  }
  const cornersOuPair = buildMainOUWithAdjacent(
    ftOddsMap,
    /^corners\s+(over|under)\s+[0-9]+(\.[0-9]+)?$/,
    /^corners\s+(over|under)\s+([0-9]+(\.[0-9]+)?)/,
  );
  if (cornersOuPair) {
    canonical['corners_ou'] = cornersOuPair.main;
  }
  const ahPair = buildMainAHWithAdjacent(ftOddsMap);
  if (ahPair) {
    canonical['ah'] = ahPair.main;
    if (ahPair.adjacent) canonical['ah_adjacent'] = ahPair.adjacent;
    if (ahPair.extras.length > 0) canonical['ah_extra'] = ahPair.extras;
  }
  if (bestBTTS.yes > 0 || bestBTTS.no > 0) {
    canonical['btts'] = { yes: bestBTTS.yes || null, no: bestBTTS.no || null };
  }

  if (best1X2Ht.home > 0 || best1X2Ht.away > 0 || best1X2Ht.draw > 0) {
    canonical['ht_1x2'] = {
      home: best1X2Ht.home || null,
      draw: best1X2Ht.draw || null,
      away: best1X2Ht.away || null,
    };
  }
  const htGoalsOuPair = buildMainOUWithAdjacent(
    htOddsMap,
    /^ht (over|under)\s+[0-9]+(\.[0-9]+)?$/,
    /^ht (over|under)\s+([0-9]+(\.[0-9]+)?)/,
    opts?.totalGoalsHt ?? null,
  );
  if (htGoalsOuPair) {
    canonical['ht_ou'] = htGoalsOuPair.main;
    if (htGoalsOuPair.adjacent) canonical['ht_ou_adjacent'] = htGoalsOuPair.adjacent;
  }
  const htAhPair = buildMainAHWithAdjacent(htOddsMap, 'ht ');
  if (htAhPair) {
    canonical['ht_ah'] = htAhPair.main;
    if (htAhPair.adjacent) canonical['ht_ah_adjacent'] = htAhPair.adjacent;
    if (htAhPair.extras.length > 0) canonical['ht_ah_extra'] = htAhPair.extras;
  }
  if (bestBTTSHt.yes > 0 || bestBTTSHt.no > 0) {
    canonical['ht_btts'] = { yes: bestBTTSHt.yes || null, no: bestBTTSHt.no || null };
  }

  // Validate implied-probability margins — remove markets with unrealistic margins
  const ip = (o: number | null | undefined) => (o && o > 1 ? 1 / o : 0);

  if (canonical['1x2']) {
    const t = ip(canonical['1x2'].home) + ip(canonical['1x2'].draw) + ip(canonical['1x2'].away);
    if (t > 0 && (t < 0.90 || t > 1.20)) delete canonical['1x2'];
  }
  if (canonical['ou'] && canonical['ou'].over !== null && canonical['ou'].under !== null) {
    const t = ip(canonical['ou'].over) + ip(canonical['ou'].under);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ou'];
  }
  if (
    canonical['ou_adjacent']
    && canonical['ou_adjacent'].over !== null
    && canonical['ou_adjacent'].under !== null
  ) {
    const t = ip(canonical['ou_adjacent'].over) + ip(canonical['ou_adjacent'].under);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ou_adjacent'];
  }
  if (canonical['ah'] && canonical['ah'].home !== null && canonical['ah'].away !== null) {
    const t = ip(canonical['ah'].home) + ip(canonical['ah'].away);
    if (t > 0 && (t < 0.85 || t > 1.15)) {
      delete canonical['ah'];
      delete canonical['ah_adjacent'];
      delete canonical['ah_extra'];
    }
  }
  if (
    canonical['ah_adjacent']
    && canonical['ah_adjacent'].home !== null
    && canonical['ah_adjacent'].away !== null
  ) {
    const t = ip(canonical['ah_adjacent'].home) + ip(canonical['ah_adjacent'].away);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ah_adjacent'];
  }
  if (Array.isArray(canonical['ah_extra']) && canonical['ah_extra'].length > 0) {
    const filtered = canonical['ah_extra'].filter((row) => {
      if (row.home == null || row.away == null) return false;
      const t = ip(row.home) + ip(row.away);
      return t >= 0.85 && t <= 1.15;
    });
    if (filtered.length > 0) canonical['ah_extra'] = filtered;
    else delete canonical['ah_extra'];
  }
  if (canonical['btts'] && canonical['btts'].yes !== null && canonical['btts'].no !== null) {
    const t = ip(canonical['btts'].yes) + ip(canonical['btts'].no);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['btts'];
  }
  if (canonical['corners_ou'] && canonical['corners_ou'].over !== null && canonical['corners_ou'].under !== null) {
    const t = ip(canonical['corners_ou'].over) + ip(canonical['corners_ou'].under);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['corners_ou'];
  }

  if (canonical['ht_1x2']) {
    const t = ip(canonical['ht_1x2'].home) + ip(canonical['ht_1x2'].draw) + ip(canonical['ht_1x2'].away);
    if (t > 0 && (t < 0.90 || t > 1.20)) delete canonical['ht_1x2'];
  }
  if (canonical['ht_ou'] && canonical['ht_ou'].over !== null && canonical['ht_ou'].under !== null) {
    const t = ip(canonical['ht_ou'].over) + ip(canonical['ht_ou'].under);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ht_ou'];
  }
  if (
    canonical['ht_ou_adjacent']
    && canonical['ht_ou_adjacent'].over !== null
    && canonical['ht_ou_adjacent'].under !== null
  ) {
    const t = ip(canonical['ht_ou_adjacent'].over) + ip(canonical['ht_ou_adjacent'].under);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ht_ou_adjacent'];
  }
  if (canonical['ht_ah'] && canonical['ht_ah'].home !== null && canonical['ht_ah'].away !== null) {
    const t = ip(canonical['ht_ah'].home) + ip(canonical['ht_ah'].away);
    if (t > 0 && (t < 0.85 || t > 1.15)) {
      delete canonical['ht_ah'];
      delete canonical['ht_ah_adjacent'];
      delete canonical['ht_ah_extra'];
    }
  }
  if (
    canonical['ht_ah_adjacent']
    && canonical['ht_ah_adjacent'].home !== null
    && canonical['ht_ah_adjacent'].away !== null
  ) {
    const t = ip(canonical['ht_ah_adjacent'].home) + ip(canonical['ht_ah_adjacent'].away);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ht_ah_adjacent'];
  }
  if (Array.isArray(canonical['ht_ah_extra']) && canonical['ht_ah_extra'].length > 0) {
    const filtered = canonical['ht_ah_extra'].filter((row) => {
      if (row.home == null || row.away == null) return false;
      const t = ip(row.home) + ip(row.away);
      return t >= 0.85 && t <= 1.15;
    });
    if (filtered.length > 0) canonical['ht_ah_extra'] = filtered;
    else delete canonical['ht_ah_extra'];
  }
  if (canonical['ht_btts'] && canonical['ht_btts'].yes !== null && canonical['ht_btts'].no !== null) {
    const t = ip(canonical['ht_btts'].yes) + ip(canonical['ht_btts'].no);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ht_btts'];
  }

  const hasAnyMarket = !!(
    canonical['1x2']
    || canonical['ou']
    || canonical['ah']
    || canonical['btts']
    || canonical['corners_ou']
    || canonical['ht_1x2']
    || canonical['ht_ou']
    || canonical['ht_ah']
    || canonical['ht_btts']
  );
  return { canonical, available: hasAnyMarket };
}

function sanitizePromptOddsCanonical(args: {
  canonical: OddsCanonical;
  homeGoals: number;
  awayGoals: number;
  currentTotalGoals: number;
  currentTotalCorners: number | null;
  matchMinute: number;
  matchStatus?: string | null;
  /** Official H1 goals when API provides `score.halftime`; drives ht_* prompt cleanup. */
  htHomeGoals?: number | null;
  htAwayGoals?: number | null;
}): OddsSanitizationResult {
  const sanitized: OddsCanonical = { ...args.canonical };
  const warnings: string[] = [];

  const removeMarket = (market: keyof OddsCanonical, reason: string) => {
    if (!sanitized[market]) return;
    delete sanitized[market];
    warnings.push(reason);
  };

  if (args.homeGoals > 0 && args.awayGoals > 0) {
    removeMarket(
      'btts',
      `Removed BTTS market from prompt: both teams have already scored (${args.homeGoals}-${args.awayGoals}), so BTTS is already logically settled.`,
    );
  }

  const htHome = args.htHomeGoals;
  const htAway = args.htAwayGoals;
  const htTotalKnown =
    typeof htHome === 'number' && typeof htAway === 'number' ? htHome + htAway : null;
  const matchStatus = String(args.matchStatus ?? '').toUpperCase();
  const firstHalfClosed = !!matchStatus && matchStatus !== 'NS' && matchStatus !== '1H';

  if (firstHalfClosed) {
    removeMarket(
      'ht_1x2',
      `Removed H1 1X2 market from prompt: first half is already closed (status ${matchStatus}).`,
    );
    removeMarket(
      'ht_ou',
      `Removed H1 goals O/U market from prompt: first half is already closed (status ${matchStatus}).`,
    );
    removeMarket(
      'ht_ou_adjacent',
      `Removed adjacent H1 goals O/U line from prompt: first half is already closed (status ${matchStatus}).`,
    );
    removeMarket(
      'ht_ah',
      `Removed H1 Asian Handicap market from prompt: first half is already closed (status ${matchStatus}).`,
    );
    removeMarket(
      'ht_ah_adjacent',
      `Removed adjacent H1 Asian Handicap line from prompt: first half is already closed (status ${matchStatus}).`,
    );
    removeMarket(
      'ht_ah_extra',
      `Removed extra H1 Asian Handicap ladder lines from prompt: first half is already closed (status ${matchStatus}).`,
    );
    removeMarket(
      'ht_btts',
      `Removed H1 BTTS market from prompt: first half is already closed (status ${matchStatus}).`,
    );
  }

  if (typeof htHome === 'number' && typeof htAway === 'number' && htHome > 0 && htAway > 0) {
    removeMarket(
      'ht_btts',
      `Removed H1 BTTS from prompt: both teams already scored in the first half (${htHome}-${htAway}).`,
    );
  }

  if (htTotalKnown !== null && typeof sanitized.ht_ou?.line === 'number' && htTotalKnown > sanitized.ht_ou.line) {
    removeMarket(
      'ht_ou',
      `Removed H1 goals O/U from prompt: H1 total ${htTotalKnown} already exceeds line ${sanitized.ht_ou.line}.`,
    );
  }
  if (
    htTotalKnown !== null
    && typeof sanitized.ht_ou_adjacent?.line === 'number'
    && htTotalKnown > sanitized.ht_ou_adjacent.line
  ) {
    removeMarket(
      'ht_ou_adjacent',
      `Removed adjacent H1 goals O/U from prompt: H1 total ${htTotalKnown} already exceeds line ${sanitized.ht_ou_adjacent.line}.`,
    );
  }

  if (htTotalKnown !== null) {
    const htContam = detectHtGoalsCornersLineContamination(sanitized, htTotalKnown);
    if (htContam.contaminated) {
      removeMarket('ht_ou', htContam.reason);
      removeMarket(
        'ht_ou_adjacent',
        `${htContam.reason} (cleared adjacent H1 O/U ladder).`,
      );
    }
  }

  if (typeof sanitized.ou?.line === 'number' && args.currentTotalGoals > sanitized.ou.line) {
    removeMarket(
      'ou',
      `Removed goals O/U market from prompt: current total goals ${args.currentTotalGoals} already exceeds line ${sanitized.ou.line}.`,
    );
  }
  if (typeof sanitized.ou_adjacent?.line === 'number' && args.currentTotalGoals > sanitized.ou_adjacent.line) {
    removeMarket(
      'ou_adjacent',
      `Removed adjacent goals O/U line from prompt: current total goals ${args.currentTotalGoals} already exceeds line ${sanitized.ou_adjacent.line}.`,
    );
  }

  const contaminationCheck = detectGoalsCornersLineContamination(sanitized, args.currentTotalGoals);
  if (contaminationCheck.contaminated) {
    removeMarket('ou', contaminationCheck.reason);
    removeMarket(
      'ou_adjacent',
      `${contaminationCheck.reason} (cleared adjacent goals O/U ladder with contaminated main line).`,
    );
  }

  if (
    args.currentTotalCorners !== null
    && typeof sanitized.corners_ou?.line === 'number'
    && args.currentTotalCorners > sanitized.corners_ou.line
  ) {
    removeMarket(
      'corners_ou',
      `Removed corners O/U market from prompt: current total corners ${args.currentTotalCorners} already exceeds line ${sanitized.corners_ou.line}.`,
    );
  }

  if (
    args.currentTotalCorners !== null
    && typeof sanitized.corners_ou?.line === 'number'
  ) {
    const line = sanitized.corners_ou.line;
    const over = sanitized.corners_ou.over;
    const cornersNeededForOver = line - args.currentTotalCorners;
    const remainingMinutes = Math.max(1, 90 - args.matchMinute);
    const observedCornerTempo = args.currentTotalCorners / Math.max(args.matchMinute, 1);
    const requiredCornerTempo = Math.max(cornersNeededForOver, 0) / remainingMinutes;
    const looksLikeStaleEasyCornersLine =
      args.matchMinute >= 45
      && args.matchMinute < 70
      && args.currentTotalCorners >= 8
      && cornersNeededForOver <= 1
      && typeof over === 'number'
      && over >= 1.75
      && requiredCornerTempo <= observedCornerTempo * 0.3;

    if (looksLikeStaleEasyCornersLine) {
      removeMarket(
        'corners_ou',
        `Removed corners O/U market from prompt: live total corners ${args.currentTotalCorners} is already too close to line ${line} at minute ${args.matchMinute} for an over price of ${over}, which suggests a stale or non-main live corners line.`,
      );
    }
  }

  const available = !!(
    sanitized['1x2']
    || sanitized['ou']
    || sanitized['ah']
    || sanitized['btts']
    || sanitized['corners_ou']
    || sanitized['ht_1x2']
    || sanitized['ht_ou']
    || sanitized['ht_ah']
    || sanitized['ht_btts']
  );

  return {
    canonical: sanitized,
    available,
    warnings,
    suspicious: false,
  };
}

function buildMainOUWithAdjacent(
  oddsMap: Record<string, number>,
  regexKey: RegExp,
  regexParse: RegExp,
  /** When set (in-play), prefer the smallest quoted line **strictly above** this total; else closest line by |Δ|. */
  goalHint?: number | null,
): {
  main: { line: number; over: number | null; under: number | null };
  adjacent?: { line: number; over: number | null; under: number | null };
} | undefined {
  const entries = Object.entries(oddsMap).filter(([k]) => regexKey.test(k));
  if (!entries.length) return undefined;

  const lineMap = new Map<string, Record<string, number>>();
  for (const [k, odd] of entries) {
    const m = k.match(regexParse);
    if (!m?.[1] || !m[2]) continue;
    const dir = m[1];
    const lineStr = m[2];
    if (!Number.isFinite(Number(lineStr))) continue;
    if (!lineMap.has(lineStr)) lineMap.set(lineStr, {});
    const entry = lineMap.get(lineStr)!;
    entry[dir] = Math.max(entry[dir] || 0, odd);
  }

  let bestLine: string | null = null;
  let bestSpread = Infinity;
  const useGoalHint = goalHint != null && Number.isFinite(goalHint) && goalHint >= 0;

  if (useGoalHint) {
    const gh = goalHint as number;
    const pairs = [...lineMap].filter(([, d]) => d['over'] && d['under']);
    const above = pairs.filter(([ls]) => Number(ls) > gh);
    if (above.length > 0) {
      const minAbove = Math.min(...above.map(([ls]) => Number(ls)));
      const tied = above.filter(([ls]) => Number(ls) === minAbove);
      let pickSpread = Infinity;
      for (const [ls, data] of tied) {
        const spread = Math.abs((data['over'] || 0) - (data['under'] || 0));
        if (spread < pickSpread) {
          pickSpread = spread;
          bestLine = ls;
        }
      }
      bestSpread = pickSpread;
    } else {
      let bestDist = Infinity;
      for (const [lineStr, data] of pairs) {
        const o = data['over'];
        const u = data['under'];
        if (!o || !u) continue;
        const spread = Math.abs(o - u);
        const dist = Math.abs(Number(lineStr) - gh);
        if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) <= 1e-9 && spread < bestSpread)) {
          bestDist = dist;
          bestSpread = spread;
          bestLine = lineStr;
        }
      }
    }
  }

  if (!bestLine) {
    for (const [lineStr, data] of lineMap) {
      const o = data['over'];
      const u = data['under'];
      if (o && u) {
        const spread = Math.abs(o - u);
        if (spread < bestSpread) { bestSpread = spread; bestLine = lineStr; }
      }
    }
  }
  if (!bestLine) {
    const sorted = Array.from(lineMap.keys()).map(Number).filter(Number.isFinite).sort((a, b) => Math.abs(a) - Math.abs(b));
    if (!sorted.length) return undefined;
    bestLine = String(sorted[0]);
  }
  const bestData = lineMap.get(bestLine) || {};
  const main = { line: Number(bestLine), over: bestData['over'] ?? null, under: bestData['under'] ?? null };

  const candidates: string[] = [];
  for (const [lineStr, data] of lineMap) {
    if (lineStr === bestLine) continue;
    const o = data['over'];
    const u = data['under'];
    if (o && u) candidates.push(lineStr);
  }
  if (candidates.length === 0) return { main };

  const mainNum = Number(bestLine);
  let adjacentLine: string | null = null;
  let bestDist = Infinity;
  let bestAdjSpread = Infinity;
  for (const lineStr of candidates) {
    const dist = Math.abs(Number(lineStr) - mainNum);
    const data = lineMap.get(lineStr) || {};
    const spread = Math.abs((data['over'] || 0) - (data['under'] || 0));
    if (dist < bestDist || (dist === bestDist && spread < bestAdjSpread)) {
      bestDist = dist;
      bestAdjSpread = spread;
      adjacentLine = lineStr;
    }
  }
  if (!adjacentLine) return { main };
  const adjData = lineMap.get(adjacentLine) || {};
  return {
    main,
    adjacent: {
      line: Number(adjacentLine),
      over: adjData['over'] ?? null,
      under: adjData['under'] ?? null,
    },
  };
}

function buildMainAHWithAdjacent(
  oddsMap: Record<string, number>,
  keyPrefix = '',
): {
  main: { line: number; home: number | null; away: number | null };
  adjacent?: { line: number; home: number | null; away: number | null };
  extras: OddsAhRung[];
} | undefined {
  const esc = keyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp(`^${esc}(home|away)\\s+[-+]?[0-9]+(\\.[0-9]+)?$`);
  const parseRe = new RegExp(`^${esc}(home|away)\\s+([-+]?[0-9]+(\\.[0-9]+)?)`);
  const entries = Object.entries(oddsMap).filter(([k]) => keyRe.test(k));
  if (!entries.length) return undefined;

  /** Home-centric line: `home -0.75` & `away +0.75` merge to line `-0.75`. */
  const lineMap = new Map<string, Record<string, number>>();
  for (const [k, odd] of entries) {
    const m = k.match(parseRe);
    if (!m?.[1] || !m[2]) continue;
    const hc = Number(m[2]);
    if (!Number.isFinite(hc)) continue;
    const canonicalLine = m[1] === 'home' ? hc : -hc;
    const lineStr = String(canonicalLine);
    if (!lineMap.has(lineStr)) lineMap.set(lineStr, {});
    lineMap.get(lineStr)![m[1]] = Math.max(lineMap.get(lineStr)![m[1]] || 0, odd);
  }

  /**
   * Pick MAIN Asian line for live/prompt use: prefer the handicap rung closest to level (smallest |line|)
   * among fully quoted lines, then tie-break by tightest home/away price spread.
   * Rationale: the "current" traded line after kickoff is usually near pick'em in handicap space; choosing
   * only by spread (old behavior) often elevated a deeper opening rung (-0.75) over the live main (-0.25).
   */
  let bestLine: string | null = null;
  let bestAbsMag = Infinity;
  let bestSpread = Infinity;
  for (const [lineStr, data] of lineMap) {
    if (!data['home'] || !data['away']) continue;
    const spread = Math.abs(data['home'] - data['away']);
    const absMag = Math.abs(Number(lineStr));
    if (!Number.isFinite(absMag)) continue;
    if (absMag < bestAbsMag - 1e-9) {
      bestAbsMag = absMag;
      bestSpread = spread;
      bestLine = lineStr;
    } else if (Math.abs(absMag - bestAbsMag) <= 1e-9 && spread < bestSpread) {
      bestSpread = spread;
      bestLine = lineStr;
    }
  }
  if (!bestLine) return undefined;
  const best = lineMap.get(bestLine) || {};
  const main = { line: Number(bestLine), home: best['home'] ?? null, away: best['away'] ?? null };

  const candidates: string[] = [];
  for (const [lineStr, data] of lineMap) {
    if (lineStr === bestLine) continue;
    if (data['home'] && data['away']) candidates.push(lineStr);
  }

  const mainNum = Number(bestLine);
  let adjacentLine: string | null = null;
  if (candidates.length > 0) {
    let bestDist = Infinity;
    let bestAdjSpread = Infinity;
    for (const lineStr of candidates) {
      const dist = Math.abs(Number(lineStr) - mainNum);
      const data = lineMap.get(lineStr) || {};
      const spread = Math.abs((data['home'] || 0) - (data['away'] || 0));
      if (dist < bestDist || (dist === bestDist && spread < bestAdjSpread)) {
        bestDist = dist;
        bestAdjSpread = spread;
        adjacentLine = lineStr;
      }
    }
  }

  const usedLines = new Set<string>([bestLine]);
  if (adjacentLine) usedLines.add(adjacentLine);
  const extras: OddsAhRung[] = [];
  const pool = [...lineMap.keys()].filter((ls) => {
    if (usedLines.has(ls)) return false;
    const d = lineMap.get(ls);
    return !!(d?.home && d?.away);
  });
  pool.sort((a, b) => Math.abs(Number(a) - mainNum) - Math.abs(Number(b) - mainNum));
  for (const ls of pool.slice(0, MAX_AH_LADDER_EXTRAS)) {
    const d = lineMap.get(ls)!;
    extras.push({ line: Number(ls), home: d.home ?? null, away: d.away ?? null });
  }

  if (!adjacentLine) {
    return { main, extras };
  }
  const adj = lineMap.get(adjacentLine) || {};
  return {
    main,
    adjacent: {
      line: Number(adjacentLine),
      home: adj['home'] ?? null,
      away: adj['away'] ?? null,
    },
    extras,
  };
}

// ==================== Parse AI Response ====================

function extractJsonString(text: string): string {
  if (!text) return '';
  const jsonFence = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonFence?.[1]) return jsonFence[1].trim();
  const genericFence = text.match(/```\s*([\s\S]*?)```/);
  if (genericFence?.[1]) return genericFence[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) return text.substring(firstBrace, lastBrace + 1);
  return text.trim();
}

function parseAiResponse(
  aiText: string,
  oddsCanonical: OddsCanonical,
  matchMinute = 0,
  pipelineSettings?: PipelineSettings,
  evidenceMode: EvidenceMode = 'full_live_data',
): ParsedAiResponse {
  const defaults: ParsedAiResponse = {
    decision_kind: 'no_bet',
    should_push: false, ai_should_push: false, system_should_bet: false, final_should_bet: false,
    selection: '', bet_market: '', confidence: 0,
    reasoning_en: 'AI response could not be parsed.', reasoning_vi: 'AI response could not be parsed.',
    warnings: ['PARSE_ERROR'], value_percent: 0, risk_level: 'HIGH', stake_percent: 0,
    condition_triggered_suggestion: '', custom_condition_matched: false,
    custom_condition_status: 'parse_error',
    custom_condition_summary_en: '', custom_condition_summary_vi: '',
    custom_condition_reason_en: '', custom_condition_reason_vi: '',
    condition_triggered_reasoning_en: '', condition_triggered_reasoning_vi: '',
    condition_triggered_confidence: 0, condition_triggered_stake: 0,
    condition_triggered_special_override: false,
    condition_triggered_special_override_reason_en: '',
    condition_triggered_special_override_reason_vi: '',
    condition_triggered_should_push: false,
    follow_up_answer_en: '',
    follow_up_answer_vi: '',
    ai_selection: '', ai_confidence: 0, ai_odd_raw: null, ai_warnings: [],
    usable_odd: null, mapped_odd: null, odds_for_display: null,
  };
  if (!aiText) return defaults;

  const jsonStr = extractJsonString(aiText);
  if (!jsonStr) return defaults;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ...defaults, warnings: ['JSON_PARSE_ERROR'] };
  }

  const aiSelection = String(parsed.selection || '');
  const betMarket = String(parsed.bet_market || '');
  let aiConfidence = toNumber(parsed.confidence) ?? 0;
  if (aiConfidence > 10) aiConfidence = Math.round(aiConfidence / 10);
  const reasoningEn = String(parsed.reasoning_en || '');
  const reasoningVi = String(parsed.reasoning_vi || '');
  const aiWarnings = Array.isArray(parsed.warnings) ? (parsed.warnings as string[]).map(String) : [];
  const valuePercent = toNumber(parsed.value_percent) ?? 0;
  const riskLevel = (['LOW', 'MEDIUM', 'HIGH'].includes(String(parsed.risk_level)) ? String(parsed.risk_level) : 'HIGH');
  const stakePercent = toNumber(parsed.stake_percent) ?? 0;
  const aiShouldPush = parsed.should_push === true;
  const customConditionMatched = parsed.custom_condition_matched === true;
  const customConditionStatus = (['none', 'evaluated', 'parse_error'].includes(String(parsed.custom_condition_status))
    ? String(parsed.custom_condition_status)
    : 'none') as 'none' | 'evaluated' | 'parse_error';
  const customConditionSummaryEn = String(parsed.custom_condition_summary_en || '');
  const customConditionSummaryVi = String(parsed.custom_condition_summary_vi || '');
  const customConditionReasonEn = String(parsed.custom_condition_reason_en || '');
  const customConditionReasonVi = String(parsed.custom_condition_reason_vi || '');
  const conditionTriggeredSuggestion = String(parsed.condition_triggered_suggestion || '').trim();
  const conditionTriggeredReasoningEn = String(parsed.condition_triggered_reasoning_en || '');
  const conditionTriggeredReasoningVi = String(parsed.condition_triggered_reasoning_vi || '');
  const conditionTriggeredConfidence = toNumber(parsed.condition_triggered_confidence) ?? 0;
  const conditionTriggeredStake = toNumber(parsed.condition_triggered_stake) ?? 0;
  const conditionTriggeredSpecialOverride = parsed.condition_triggered_special_override === true;
  const conditionTriggeredSpecialOverrideReasonEn = String(parsed.condition_triggered_special_override_reason_en || '');
  const conditionTriggeredSpecialOverrideReasonVi = String(parsed.condition_triggered_special_override_reason_vi || '');
  const followUpAnswerEn = String(parsed.follow_up_answer_en || '');
  const followUpAnswerVi = String(parsed.follow_up_answer_vi || '');

  // Map odds from selection
  const mappedOdd = extractOddsFromSelection(aiSelection, betMarket, oddsCanonical);
  const MIN_ODDS = pipelineSettings?.minOdds ?? config.pipelineMinOdds;
  const MIN_CONFIDENCE = pipelineSettings?.minConfidence ?? config.pipelineMinConfidence;

  const safetyWarnings: string[] = [];
  if (aiShouldPush && !aiSelection) safetyWarnings.push('NO_SELECTION');
  if (aiShouldPush && !betMarket) safetyWarnings.push('NO_BET_MARKET');
  if (aiShouldPush && mappedOdd === null) safetyWarnings.push('ODDS_INVALID');
  if (aiShouldPush && aiConfidence < MIN_CONFIDENCE) safetyWarnings.push('CONFIDENCE_BELOW_MIN');
  if (aiShouldPush && riskLevel === 'HIGH') safetyWarnings.push('HIGH_RISK');
  if (aiShouldPush && valuePercent < 3) safetyWarnings.push('EDGE_BELOW_MIN');
  if (aiShouldPush && !isMarketAllowedForEvidenceMode(betMarket, evidenceMode)) {
    safetyWarnings.push('MARKET_NOT_ALLOWED_FOR_EVIDENCE');
  }

  // Business rule: no 1X2 before minute 35
  if (aiShouldPush && betMarket.toLowerCase().includes('1x2') && matchMinute < 35) {
    safetyWarnings.push('1X2_TOO_EARLY');
  }

  const hasBlocking = safetyWarnings.some((w) => [
    'NO_SELECTION',
    'NO_BET_MARKET',
    'CONFIDENCE_BELOW_MIN',
    'HIGH_RISK',
    'EDGE_BELOW_MIN',
    'MARKET_NOT_ALLOWED_FOR_EVIDENCE',
    '1X2_TOO_EARLY',
  ].includes(w));
  // AI save path: only the AI recommendation itself can create a DB record.
  // Condition-trigger metadata may still notify the user, but it must never be
  // promoted into a saved recommendation unless the same run also produced an
  // actionable AI bet with valid market/odds/confidence.
  const systemShouldBet = aiShouldPush && !hasBlocking;
  const usableOdd = mappedOdd !== null && mappedOdd >= MIN_ODDS ? mappedOdd : null;
  const aiFinalShouldBet = systemShouldBet && usableOdd !== null;
  const oddsForDisplay = usableOdd ?? mappedOdd ?? (aiShouldPush ? 'N/A' : null);
  // Condition-trigger path: this always drives alerting when the watch condition
  // was successfully evaluated and matched. Persistence is decided later by a
  // separate hard guard so the system can save the first actionable
  // condition-triggered thesis without laddering duplicate rows.
  const conditionTriggeredShouldPush =
    customConditionMatched
    && customConditionStatus === 'evaluated';
  // should_push = user-facing push/notify decision.
  // final_should_bet = AI-only save decision.
  const finalShouldPush = aiFinalShouldBet || conditionTriggeredShouldPush;
  const decisionKind = aiFinalShouldBet
    ? 'ai_push'
    : conditionTriggeredShouldPush
      ? 'condition_only'
      : 'no_bet';

  return {
    decision_kind: decisionKind,
    should_push: finalShouldPush,
    ai_should_push: aiShouldPush,
    system_should_bet: systemShouldBet,
    final_should_bet: aiFinalShouldBet,
    selection: aiSelection,
    bet_market: betMarket,
    confidence: aiConfidence,
    reasoning_en: reasoningEn,
    reasoning_vi: reasoningVi,
    warnings: [...aiWarnings, ...safetyWarnings],
    value_percent: valuePercent,
    risk_level: riskLevel,
    stake_percent: stakePercent,
    condition_triggered_suggestion: conditionTriggeredSuggestion,
    custom_condition_matched: customConditionMatched,
    custom_condition_status: customConditionStatus,
    custom_condition_summary_en: customConditionSummaryEn,
    custom_condition_summary_vi: customConditionSummaryVi,
    custom_condition_reason_en: customConditionReasonEn,
    custom_condition_reason_vi: customConditionReasonVi,
    condition_triggered_reasoning_en: conditionTriggeredReasoningEn,
    condition_triggered_reasoning_vi: conditionTriggeredReasoningVi,
    condition_triggered_confidence: conditionTriggeredConfidence,
    condition_triggered_stake: conditionTriggeredStake,
    condition_triggered_special_override: conditionTriggeredSpecialOverride,
    condition_triggered_special_override_reason_en: conditionTriggeredSpecialOverrideReasonEn,
    condition_triggered_special_override_reason_vi: conditionTriggeredSpecialOverrideReasonVi,
    condition_triggered_should_push: conditionTriggeredShouldPush,
    follow_up_answer_en: followUpAnswerEn,
    follow_up_answer_vi: followUpAnswerVi,
    ai_selection: aiSelection,
    ai_confidence: aiConfidence,
    ai_odd_raw: mappedOdd,
    ai_warnings: safetyWarnings,
    usable_odd: usableOdd,
    mapped_odd: mappedOdd,
    odds_for_display: oddsForDisplay,
  };
}

function extractOddsFromSelection(selection: string, betMarket: string, canonical: OddsCanonical): number | null {
  if (!selection && !betMarket) return null;
  const market = (betMarket || '').toLowerCase();
  const oc = canonical;

  if (market === '1x2_home') return oc['1x2']?.home ?? null;
  if (market === '1x2_away') return oc['1x2']?.away ?? null;
  if (market === '1x2_draw') return oc['1x2']?.draw ?? null;
  if (market === 'btts_yes') return oc.btts?.yes ?? null;
  if (market === 'btts_no') return oc.btts?.no ?? null;

  if (market === 'ht_1x2_home') return oc['ht_1x2']?.home ?? null;
  if (market === 'ht_1x2_away') return oc['ht_1x2']?.away ?? null;
  if (market === 'ht_1x2_draw') return oc['ht_1x2']?.draw ?? null;
  if (market === 'ht_btts_yes') return oc.ht_btts?.yes ?? null;
  if (market === 'ht_btts_no') return oc.ht_btts?.no ?? null;

  const htGoalOverLine = parseLineSuffix('ht_over_', market);
  if (htGoalOverLine !== null) {
    if (sameLine(htGoalOverLine, oc.ht_ou?.line)) return oc.ht_ou?.over ?? null;
    if (sameLine(htGoalOverLine, oc.ht_ou_adjacent?.line)) return oc.ht_ou_adjacent?.over ?? null;
    return null;
  }

  const htGoalUnderLine = parseLineSuffix('ht_under_', market);
  if (htGoalUnderLine !== null) {
    if (sameLine(htGoalUnderLine, oc.ht_ou?.line)) return oc.ht_ou?.under ?? null;
    if (sameLine(htGoalUnderLine, oc.ht_ou_adjacent?.line)) return oc.ht_ou_adjacent?.under ?? null;
    return null;
  }

  const htAhHomeLine = parseLineSuffix('ht_asian_handicap_home_', market);
  if (htAhHomeLine !== null) {
    if (sameLine(htAhHomeLine, oc.ht_ah?.line)) return oc.ht_ah?.home ?? null;
    if (sameLine(htAhHomeLine, oc.ht_ah_adjacent?.line)) return oc.ht_ah_adjacent?.home ?? null;
    const htExtraH = oc.ht_ah_extra?.find((r) => sameLine(htAhHomeLine, r.line));
    if (htExtraH) return htExtraH.home ?? null;
    return null;
  }

  const htAhAwayLine = parseLineSuffix('ht_asian_handicap_away_', market);
  if (htAhAwayLine !== null) {
    const matchMain =
      sameLine(htAhAwayLine, oc.ht_ah?.line) || sameLine(-htAhAwayLine, oc.ht_ah?.line);
    if (matchMain) return oc.ht_ah?.away ?? null;
    const matchAdj =
      sameLine(htAhAwayLine, oc.ht_ah_adjacent?.line) || sameLine(-htAhAwayLine, oc.ht_ah_adjacent?.line);
    if (matchAdj) return oc.ht_ah_adjacent?.away ?? null;
    const htExtraA = oc.ht_ah_extra?.find(
      (r) => sameLine(htAhAwayLine, r.line) || sameLine(-htAhAwayLine, r.line),
    );
    if (htExtraA) return htExtraA.away ?? null;
    return null;
  }

  const goalOverLine = parseLineSuffix('over_', market);
  if (goalOverLine !== null) {
    if (sameLine(goalOverLine, oc.ou?.line)) return oc.ou?.over ?? null;
    if (sameLine(goalOverLine, oc.ou_adjacent?.line)) return oc.ou_adjacent?.over ?? null;
    return null;
  }

  const goalUnderLine = parseLineSuffix('under_', market);
  if (goalUnderLine !== null) {
    if (sameLine(goalUnderLine, oc.ou?.line)) return oc.ou?.under ?? null;
    if (sameLine(goalUnderLine, oc.ou_adjacent?.line)) return oc.ou_adjacent?.under ?? null;
    return null;
  }

  const ahHomeLine = parseLineSuffix('asian_handicap_home_', market);
  if (ahHomeLine !== null) {
    if (sameLine(ahHomeLine, oc.ah?.line)) return oc.ah?.home ?? null;
    if (sameLine(ahHomeLine, oc.ah_adjacent?.line)) return oc.ah_adjacent?.home ?? null;
    const extraH = oc.ah_extra?.find((r) => sameLine(ahHomeLine, r.line));
    if (extraH) return extraH.home ?? null;
    return null;
  }

  const ahAwayLine = parseLineSuffix('asian_handicap_away_', market);
  if (ahAwayLine !== null) {
    const matchMain =
      sameLine(ahAwayLine, oc.ah?.line) || sameLine(-ahAwayLine, oc.ah?.line);
    if (matchMain) return oc.ah?.away ?? null;
    const matchAdj =
      sameLine(ahAwayLine, oc.ah_adjacent?.line) || sameLine(-ahAwayLine, oc.ah_adjacent?.line);
    if (matchAdj) return oc.ah_adjacent?.away ?? null;
    const extraA = oc.ah_extra?.find(
      (r) => sameLine(ahAwayLine, r.line) || sameLine(-ahAwayLine, r.line),
    );
    if (extraA) return extraA.away ?? null;
    return null;
  }

  const cornersOverLine = parseLineSuffix('corners_over_', market);
  if (cornersOverLine !== null) {
    return sameLine(cornersOverLine, oc.corners_ou?.line) ? (oc.corners_ou?.over ?? null) : null;
  }

  const cornersUnderLine = parseLineSuffix('corners_under_', market);
  if (cornersUnderLine !== null) {
    return sameLine(cornersUnderLine, oc.corners_ou?.line) ? (oc.corners_ou?.under ?? null) : null;
  }

  return null;
}

// ==================== Stats Chart (QuickChart.io) ====================

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const idx = text.lastIndexOf(' ', max - 1);
  return text.substring(0, idx > 0 ? idx : max) + '…';
}

function safeTruncateCaption(text: string, limit = 1020): string {
  if (text.length <= limit) return text;
  const idx = text.lastIndexOf('\n', limit);
  return text.substring(0, idx > 0 ? idx : limit);
}

function isAiRecommendation(parsed: ParsedAiResponse): boolean {
  return parsed.final_should_bet;
}

function isConditionOnlyTrigger(parsed: ParsedAiResponse): boolean {
  return parsed.condition_triggered_should_push && !parsed.final_should_bet;
}

function displaySelection(parsed: ParsedAiResponse): string {
  if (parsed.final_should_bet && parsed.selection) return parsed.selection;
  if (parsed.condition_triggered_should_push) return parsed.condition_triggered_suggestion;
  return parsed.selection;
}

function displaySelectionWithContext(parsed: ParsedAiResponse, odds: number | null | undefined): string {
  if (!parsed.final_should_bet) {
    return displaySelection(parsed);
  }
  return formatSelectionWithMarketContext({
    selection: parsed.selection,
    betMarket: parsed.bet_market,
    odds,
    language: 'en',
  });
}

function displayConfidence(parsed: ParsedAiResponse): number {
  if (parsed.final_should_bet) return parsed.confidence;
  if (parsed.condition_triggered_should_push) return parsed.condition_triggered_confidence;
  return parsed.confidence;
}

function displayStake(parsed: ParsedAiResponse): number {
  if (parsed.final_should_bet) return parsed.stake_percent;
  if (parsed.condition_triggered_should_push) return parsed.condition_triggered_stake;
  return parsed.stake_percent;
}

function decisionKindFromParsed(parsed: ParsedAiResponse): MatchPipelineResult['decisionKind'] {
  return parsed.decision_kind;
}

/** Pick reasoning text based on notification language setting. */
function pickReasoning(parsed: ParsedAiResponse, lang: PipelineSettings['notificationLanguage']): string {
  const reasoningEn = isConditionOnlyTrigger(parsed)
    ? (parsed.condition_triggered_reasoning_en || parsed.reasoning_en)
    : parsed.reasoning_en;
  const reasoningVi = isConditionOnlyTrigger(parsed)
    ? (parsed.condition_triggered_reasoning_vi || parsed.reasoning_vi)
    : parsed.reasoning_vi;
  if (lang === 'en') return reasoningEn || reasoningVi;
  if (lang === 'both') return [reasoningEn, reasoningVi].filter(Boolean).join('\n\n');
  // default: 'vi'
  return reasoningVi || reasoningEn;
}

/** Map PromptAnalysisMode to a human-readable footer label. */
function triggerLabel(mode: PromptAnalysisMode): string {
  switch (mode) {
    case 'system_force': return 'Force Mode';
    case 'manual_force': return 'Manual Force';
    default:             return 'Auto Trigger';
  }
}

function buildStatsChartUrl(stats: StatsCompact, homeName: string, awayName: string, minute: number | string): string {
  const n = (v: string | null): number => {
    if (v == null || v === '') return 0;
    const num = parseFloat(v.replace('%', ''));
    return isNaN(num) ? 0 : num;
  };

  const share = (h: number, a: number): [number, number] => {
    const total = h + a;
    if (total === 0) return [0, 0];
    return [Math.round(h / total * 100), Math.round(a / total * 100)];
  };

  const posH = n(stats.possession.home); const posA = n(stats.possession.away);
  const shoH = n(stats.shots.home);      const shoA = n(stats.shots.away);
  const sotH = n(stats.shots_on_target.home); const sotA = n(stats.shots_on_target.away);
  const corH = n(stats.corners.home);    const corA = n(stats.corners.away);
  const fouH = n(stats.fouls.home);      const fouA = n(stats.fouls.away);

  if (posH + posA + shoH + shoA + sotH + sotA + corH + corA + fouH + fouA === 0) return '';

  const [posHS, posAS] = posH + posA > 0 ? [posH, posA] : [0, 0];
  const [shoHS, shoAS] = share(shoH, shoA);
  const [sotHS, sotAS] = share(sotH, sotA);
  const [corHS, corAS] = share(corH, corA);
  const [fouHS, fouAS] = share(fouH, fouA);

  const trim = (s: string, max = 14) => s.length > max ? s.substring(0, max - 1) + '…' : s;

  const cfg = {
    type: 'horizontalBar',
    data: {
      labels: [
        `Poss (${posH}/${posA}%)`,
        `Shots (${shoH}/${shoA})`,
        `On Target (${sotH}/${sotA})`,
        `Corners (${corH}/${corA})`,
        `Fouls (${fouH}/${fouA})`,
      ],
      datasets: [
        { label: trim(homeName), backgroundColor: '#3b82f6', data: [posHS, shoHS, sotHS, corHS, fouHS] },
        { label: trim(awayName), backgroundColor: '#ef4444', data: [posAS, shoAS, sotAS, corAS, fouAS] },
      ],
    },
    options: {
      title: { display: true, text: `Live Stats — ${minute}'`, fontSize: 14 },
      legend: { position: 'bottom' },
      scales: {
        xAxes: [{ stacked: true, ticks: { min: 0, max: 100 } }],
        yAxes: [{ stacked: true }],
      },
    },
  };

  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(cfg))}&w=500&h=240&bkg=white`;
}

/** Condensed caption for sendPhoto (max 1024 chars). Stats replaced by chart image; events by timeline image. */
function buildEventsText(events: EventCompact[]): string {
  const relevant = events.filter((e) => e.type === 'goal' || e.type === 'card');
  if (relevant.length === 0) return '';
  const isRed = (e: EventCompact) => {
    const d = e.detail.toLowerCase();
    return d.includes('red') || d.includes('second yellow');
  };
  const toX = (e: EventCompact) => e.minute + (e.extra ?? 0);
  const lines = relevant
    .sort((a, b) => toX(a) - toX(b))
    .map((e) => {
      const min = `${toX(e)}'`;
      if (e.type === 'goal') {
        const detail = e.detail.toLowerCase().includes('own') ? 'OG' : e.detail.toLowerCase().includes('penalty') ? 'P' : '';
        return `⚽${detail ? ' ' + detail : ''} ${min} ${safeHtml(e.player || e.team)}`;
      }
      const icon = isRed(e) ? '🟥' : '🟨';
      return `${icon} ${min} ${safeHtml(e.player || e.team)}`;
    });
  return lines.join('\n');
}

function buildTelegramCaption(
  matchDisplay: string, league: string, score: string, minute: number | string, status: string,
  parsed: ParsedAiResponse, model: string, mode: string,
  lang: PipelineSettings['notificationLanguage'],
  trigger: PromptAnalysisMode,
  conditionText: string,
  eventsCompact: EventCompact[],
): string {
  const isRec = isAiRecommendation(parsed);
  const isCondition = isConditionOnlyTrigger(parsed) || parsed.custom_condition_matched;
  const emoji = isRec ? '🎯' : isCondition ? '⚡' : '📊';
  const label = isRec ? 'AI RECOMMENDATION' : isCondition ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';
  const selection = displaySelectionWithContext(parsed, parsed.mapped_odd);
  const confidence = displayConfidence(parsed);
  const stake = displayStake(parsed);

  const INTERNAL = new Set(['FORCE_MODE', 'EARLY_GAME_RISK']);

  let text = `<b>${emoji} ${label}</b>\n`;
  text += `<b>${safeHtml(matchDisplay)}</b>\n`;
  text += `${safeHtml(league)}\n`;
  text += `⏱ ${safeHtml(String(minute))}' | 📋 ${safeHtml(score)} | ${safeHtml(status)}\n`;
  text += `🤖 ${safeHtml(model)} | Mode: ${safeHtml(mode)}\n`;
  if (isCondition && conditionText.trim()) {
    text += `\n<b>Condition:</b> ${safeHtml(conditionText.trim())}\n`;
  }

  if (isRec) {
    text += `\n<b>💰 ${safeHtml(selection)}</b>\n`;
    text += `Confidence: ${confidence}/10 | Stake: ${stake}% | Risk: ${safeHtml(parsed.risk_level)} | Value: ${parsed.value_percent}%\n`;
    const reasoning = pickReasoning(parsed, lang);
    if (reasoning) text += `\n${safeHtml(truncateAtWord(reasoning, 680))}\n`;
  } else if (isCondition) {
    if (selection) text += `\n<b>⚡ ${safeHtml(selection)}</b>\n`;
    if ((selection && !isNoBetConditionSuggestion(selection)) || confidence > 0 || stake > 0) {
      text += `Confidence: ${confidence}/10 | Stake: ${stake}%\n`;
    }
    const conditionSummary = lang === 'en'
      ? (parsed.custom_condition_summary_en || parsed.custom_condition_reason_en)
      : (parsed.custom_condition_summary_vi || parsed.custom_condition_reason_vi || parsed.custom_condition_summary_en || parsed.custom_condition_reason_en);
    if (conditionSummary) text += `Matched: ${safeHtml(conditionSummary)}\n`;
    const reasoning = pickReasoning(parsed, lang);
    if (reasoning) text += `\n${safeHtml(truncateAtWord(reasoning, 520))}\n`;
  } else {
    const reasoning = pickReasoning(parsed, lang);
    if (reasoning) text += `\n${safeHtml(truncateAtWord(reasoning, 520))}\n`;
  }
  // Events: compact text block (goals + cards), no separate image needed
  const eventsText = buildEventsText(eventsCompact ?? []);
  if (eventsText) text += `\n${eventsText}\n`;

  // Warnings (concise, max 3)
  const displayWarnings = parsed.warnings.filter((w) => !INTERNAL.has(w)).slice(0, 3);
  if (displayWarnings.length > 0) {
    text += `\n⚠️ ${safeHtml(displayWarnings.join(' | '))}\n`;
  }

  // Footer last — safeTruncateCaption cuts at \n so this won't be mid-tag
  const now = formatOperationalTimestamp();
  text += `\n<i>🤖 ${safeHtml(triggerLabel(trigger))} | ${safeHtml(now)}</i>`;

  return safeTruncateCaption(text);
}

// ==================== Build Telegram Message ====================

function chunkMessage(text: string, maxLen = 3500): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let idx = remaining.lastIndexOf('\n', maxLen);
    if (idx <= 0) idx = maxLen;
    chunks.push(remaining.substring(0, idx));
    remaining = remaining.substring(idx).replace(/^\n/, '');
  }
  return chunks;
}

function getEventIcon(type: string, detail: string): string {
  const t = type.toLowerCase();
  const d = detail.toLowerCase();
  if (t === 'goal') return d.includes('own') ? '⚽ OG' : d.includes('penalty') ? '⚽ P' : '⚽';
  if (t === 'card') return d.includes('red') || d.includes('second yellow') ? '🟥' : '🟨';
  if (t === 'subst') return '🔄';
  return '•';
}

function buildTelegramMessage(
  matchDisplay: string,
  league: string,
  score: string,
  minute: number | string,
  status: string,
  parsed: ParsedAiResponse,
  statsCompact: StatsCompact,
  statsAvailable: boolean,
  eventsCompact: EventCompact[],
  model: string,
  mode: string,
  lang: PipelineSettings['notificationLanguage'],
  trigger: PromptAnalysisMode,
  conditionText: string,
): string {
  const isRec = isAiRecommendation(parsed);
  const isCondition = isConditionOnlyTrigger(parsed) || parsed.custom_condition_matched;
  const INTERNAL = new Set(['FORCE_MODE', 'EARLY_GAME_RISK']);
  const selection = displaySelectionWithContext(parsed, parsed.mapped_odd);
  const confidence = displayConfidence(parsed);
  const stake = displayStake(parsed);

  const emoji = isRec ? '🎯' : isCondition ? '⚡' : '📊';
  const label = isRec ? 'AI RECOMMENDATION' : isCondition ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';

  let text = `<b>${emoji} ${label}</b>\n`;
  text += `<b>${safeHtml(matchDisplay)}</b>\n`;
  text += `${safeHtml(league)}\n`;
  text += `⏱ ${safeHtml(String(minute))}' | 📋 ${safeHtml(score)} | ${safeHtml(status)}\n`;
  text += `🤖 ${safeHtml(model)} | Mode: ${safeHtml(mode)}\n`;
  if (isCondition && conditionText.trim()) {
    text += `\n<b>Condition:</b> ${safeHtml(conditionText.trim())}\n`;
  }

  if (isRec) {
    text += `\n<b>💰 ${safeHtml(selection)}</b>\n`;
    text += `Confidence: ${confidence}/10 | Stake: ${stake}% | Risk: ${safeHtml(parsed.risk_level)} | Value: ${parsed.value_percent}%\n`;
    const reasoning = pickReasoning(parsed, lang);
    if (reasoning) text += `\n${safeHtml(reasoning)}\n`;
  } else if (isCondition) {
    if (selection) text += `\n<b>⚡ ${safeHtml(selection)}</b>\n`;
    if ((selection && !isNoBetConditionSuggestion(selection)) || confidence > 0 || stake > 0) {
      text += `Confidence: ${confidence}/10 | Stake: ${stake}%\n`;
    }
    const conditionSummary = lang === 'en'
      ? (parsed.custom_condition_summary_en || parsed.custom_condition_reason_en)
      : (parsed.custom_condition_summary_vi || parsed.custom_condition_reason_vi || parsed.custom_condition_summary_en || parsed.custom_condition_reason_en);
    if (conditionSummary) text += `Matched: ${safeHtml(conditionSummary)}\n`;
    const reasoning = pickReasoning(parsed, lang);
    if (reasoning) text += `\n${safeHtml(reasoning)}\n`;
  } else {
    const reasoning = pickReasoning(parsed, lang);
    if (reasoning) text += `\n${safeHtml(reasoning)}\n`;
  }

  // Live Stats
  if (statsAvailable) {
    const statLines: string[] = [];
    for (const [key, val] of Object.entries(statsCompact)) {
      if (val && val.home != null && val.away != null && val.home !== '' && val.away !== '') {
        const label2 = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        statLines.push(`${label2}: ${val.home} - ${val.away}`);
      }
    }
    if (statLines.length > 0) {
      text += '\n<b>📊 Live Stats</b>\n' + statLines.join('\n') + '\n';
    }
  }

  // Key events — goals + cards only, case-insensitive, max 6
  const keyEvents = [...eventsCompact]
    .sort((a, b) => a.minute - b.minute)
    .filter((e) => { const t = e.type.toLowerCase(); return t === 'goal' || t === 'card'; })
    .slice(-6);
  if (keyEvents.length > 0) {
    text += '\n<b>📋 Events</b>\n';
    for (const evt of keyEvents) {
      const icon = getEventIcon(evt.type, evt.detail);
      text += `${evt.minute}' ${icon} ${safeHtml(evt.team)} (${safeHtml(evt.detail)})\n`;
    }
  }

  // Warnings (concise, max 3, hide internal flags)
  const displayWarnings = parsed.warnings.filter((w) => !INTERNAL.has(w)).slice(0, 3);
  if (displayWarnings.length > 0) {
    text += `\n⚠️ ${safeHtml(displayWarnings.join(' | '))}\n`;
  }

  const now = formatOperationalTimestamp();
  text += `\n<i>🤖 ${safeHtml(triggerLabel(trigger))} | ${safeHtml(now)}</i>`;
  return text;
}

function safeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

void buildStatsChartUrl;
void buildTelegramCaption;
void chunkMessage;
void buildTelegramMessage;

// ==================== Process Single Match ====================

async function processMatch(
  matchId: string,
  fixture: ApiFixture,
  watchlistEntry: watchlistRepo.WatchlistRow,
  settings: PipelineSettings,
  options: PipelineExecutionOptions = {},
): Promise<MatchPipelineResult> {
  const matchDisplay = `${fixture.teams?.home?.name || watchlistEntry.home_team} vs ${fixture.teams?.away?.name || watchlistEntry.away_team}`;
  const homeName = fixture.teams?.home?.name || watchlistEntry.home_team;
  const awayName = fixture.teams?.away?.name || watchlistEntry.away_team;
  const league = fixture.league?.name || watchlistEntry.league;
  const status = fixture.fixture?.status?.short || 'UNKNOWN';
  const minute = fixture.fixture?.status?.elapsed ?? 0;
  const homeGoals = fixture.goals?.home ?? 0;
  const awayGoals = fixture.goals?.away ?? 0;
  const score = `${homeGoals}-${awayGoals}`;
  const htScoreLive = extractHalftimeScoreFromFixture(fixture);
  const deps: PipelineDeps = { ...defaultPipelineDeps, ...options.dependencies };
  const shadowMode = options.shadowMode === true;
  const sampleProviderData = options.sampleProviderData !== false;
  const startedAt = Date.now();
  const activePromptVersion = options.promptVersionOverride
    || resolveConfiguredPromptVersion(config.liveAnalysisActivePromptVersion, LIVE_ANALYSIS_PROMPT_VERSION);
  const shadowPromptVersion = resolveConfiguredPromptVersion(
    config.liveAnalysisShadowPromptVersion,
    activePromptVersion,
  );
  const analysisRunId = randomUUID();
  const advisoryOnly = options.advisoryOnly === true;

  try {
    const homeTeamId = fixture.teams?.home?.id;
    const awayTeamId = fixture.teams?.away?.id;
    const isManualForce = options.forceAnalyze === true;
    const isSystemForce = !isManualForce && (watchlistEntry.mode || 'B').toUpperCase() === 'F';
    const forceAnalyze = isManualForce || isSystemForce;
    const analysisMode: PromptAnalysisMode = isManualForce
      ? 'manual_force'
      : isSystemForce
        ? 'system_force'
        : 'auto';

    const [prevRecs, latestSnapshot] = await Promise.all([
      options.previousRecommendations !== undefined
        ? Promise.resolve(options.previousRecommendations ?? [])
        : deps.getRecommendationsByMatchId(matchId).catch(() => []),
      options.previousSnapshot !== undefined
        ? Promise.resolve(options.previousSnapshot)
        : deps.getLatestSnapshot(matchId).catch(() => null),
    ]);

    const coarseStaleness = checkCoarseStalenessServer({
      minute,
      status,
      score,
      previousRecommendation: prevRecs[0]
        ? {
            minute: prevRecs[0].minute,
            odds: prevRecs[0].odds,
            bet_market: prevRecs[0].bet_market,
            selection: prevRecs[0].selection,
            score: prevRecs[0].score,
            status: prevRecs[0].status,
          }
        : null,
      previousSnapshot: latestSnapshot
        ? {
            minute: latestSnapshot.minute,
            home_score: latestSnapshot.home_score,
            away_score: latestSnapshot.away_score,
            status: latestSnapshot.status,
            odds: latestSnapshot.odds,
            stats: latestSnapshot.stats,
          }
        : null,
      settings: {
        reanalyzeMinMinutes: settings.reanalyzeMinMinutes,
      },
      forceAnalyze,
    });
    if (coarseStaleness.isStale && !forceAnalyze && options.skipStalenessGate !== true) {
      if (!shadowMode && shouldSamplePipelineSkipAudit(coarseStaleness.reason, 'coarse-staleness', 20)) {
        audit({
          category: 'PIPELINE',
          action: 'PIPELINE_MATCH_SKIPPED',
          outcome: 'SKIPPED',
          actor: 'auto-pipeline',
          metadata: {
            matchId,
            matchDisplay,
            reason: coarseStaleness.reason,
            baseline: coarseStaleness.baseline,
            stage: 'coarse-staleness',
          },
        });
      }

      return {
        matchId,
        success: true,
        decisionKind: 'no_bet',
        shouldPush: false,
        selection: '',
        confidence: 0,
        saved: false,
        notified: false,
        debug: {
          analysisRunId,
          shadowMode,
          skippedAt: 'staleness',
          skipReason: coarseStaleness.reason,
          analysisMode,
          totalLatencyMs: Date.now() - startedAt,
        },
      };
    }

    // 1. Read stats + events via the provider insight cache boundary
    const statsStartedAt = Date.now();
    const insight = await deps.ensureMatchInsight(matchId, {
      fixture,
      status,
      matchMinute: minute,
      refreshOdds: false,
      consumer: shadowMode ? 'replay' : 'server-pipeline',
      sampleProviderData,
      freshnessMode: 'real_required',
    });
    const apiStatsRaw = insight.statistics.payload;
    const apiEventsRaw = insight.events.payload;
    const statsError: unknown = null;
    const eventsError: unknown = null;

    const homeStats = apiStatsRaw[0]?.statistics || [];
    const awayStats = apiStatsRaw[1]?.statistics || [];
    const apiStatsCompact = buildStatsCompact(homeStats, awayStats);
    const apiEventsCompact = buildEventsCompact(apiEventsRaw, homeTeamId, awayTeamId, homeName, awayName);
    const apiCoverageFlags = summarizeStatsCoverage(apiStatsCompact, apiStatsRaw, apiEventsRaw, statsError, eventsError);
    const apiProceed = checkShouldProceedServer(
      status,
      minute,
      apiStatsCompact,
      {
        minMinute: settings.minMinute,
        maxMinute: settings.maxMinute,
        secondHalfStartMinute: settings.secondHalfStartMinute,
      },
      forceAnalyze,
    );

    if (sampleProviderData) {
      void recordProviderStatsSampleSafe({
        match_id: matchId,
        match_minute: minute,
        match_status: status,
        provider: 'api-football',
        consumer: shadowMode ? 'replay' : 'server-pipeline',
        success: !statsError && !eventsError,
        latency_ms: Date.now() - statsStartedAt,
        status_code: extractStatusCode(statsError ?? eventsError),
        error: [statsError, eventsError]
          .filter(Boolean)
          .map((err) => err instanceof Error ? err.message : String(err))
          .join(' | '),
        raw_payload: {
          statistics: apiStatsRaw,
          events: apiEventsRaw,
        },
        normalized_payload: apiStatsCompact,
        coverage_flags: apiCoverageFlags,
      });
    }

    const statsCompact = apiStatsCompact;
    const eventsCompact = apiEventsCompact;
    let derivedInsights = deriveInsightsFromEvents(eventsCompact, minute, homeName, awayName);
    const proceed = apiProceed;
    const statsSource: StatsSource = 'api-football';
    const statsFallbackUsed = false;
    const statsFallbackReason = '';

    // 2. Check should proceed before fetching odds / AI
    const statsAvailable = proceed.statsAvailable;
    if (!proceed.shouldProceed && !forceAnalyze && options.skipProceedGate !== true) {
      if (!shadowMode && shouldSamplePipelineSkipAudit(proceed.reason, 'proceed', 20)) {
        audit({
          category: 'PIPELINE',
          action: 'PIPELINE_MATCH_SKIPPED',
          outcome: 'SKIPPED',
          actor: 'auto-pipeline',
          metadata: {
            matchId,
            matchDisplay,
            reason: proceed.reason,
          },
        });
      }

      return {
        matchId,
        success: true,
        decisionKind: 'no_bet',
        shouldPush: false,
        selection: '',
        confidence: 0,
        saved: false,
        notified: false,
        debug: {
          analysisRunId,
          shadowMode,
          skippedAt: 'proceed',
          skipReason: proceed.reason,
          analysisMode,
          statsAvailable,
          statsSource,
          statsFallbackUsed,
          statsFallbackReason: statsFallbackReason || undefined,
          totalLatencyMs: Date.now() - startedAt,
        },
      };
    }

    // 3–4. Odds resolution and DB prompt context (historical + profiles) in parallel — same inputs as before staleness/prompt.
    type OddsSideResult = {
      oddsCanonical: OddsCanonical;
      oddsAvailable: boolean;
      oddsSource: string;
      oddsFetchedAt: string | null;
      oddsSanityWarnings: string[];
      oddsSuspicious: boolean;
    };
    const needsLineupsSnapshot = advisoryOnly
      || String(options.userQuestion ?? '').trim().length > 0
      || (options.followUpHistory?.length ?? 0) > 0;

    const loadOddsSide = async (): Promise<OddsSideResult> => {
      const resolvedOdds = await deps.resolveMatchOdds({
        matchId,
        homeTeam: homeName,
        awayTeam: awayName,
        kickoffTimestamp: fixture.fixture?.timestamp,
        leagueName: fixture.league?.name,
        leagueCountry: fixture.league?.country,
        status,
        matchMinute: minute,
        consumer: shadowMode ? 'replay' : 'server-pipeline',
        sampleProviderData,
        freshnessMode: 'real_required',
      });

      const oddsSource = resolvedOdds.oddsSource;
      const oddsFetchedAt = resolvedOdds.oddsFetchedAt;
      const normStatusOdds = String(status ?? '').toUpperCase();
      const totalFtGoals = homeGoals + awayGoals;
      const htGoalsHint =
        normStatusOdds === '1H' || normStatusOdds === 'HT'
          ? totalFtGoals
          : typeof htScoreLive?.home === 'number' && typeof htScoreLive?.away === 'number'
            ? htScoreLive.home + htScoreLive.away
            : null;
      const oddsResult = buildOddsCanonical(resolvedOdds.response, {
        totalGoalsFt: totalFtGoals,
        totalGoalsHt: htGoalsHint,
      });
      let oddsCanonical: OddsCanonical = {};
      let oddsAvailable = false;
      const oddsSanityWarnings: string[] = [];
      let oddsSuspicious = false;
      const liveStatusesForOdds = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
      if (liveStatusesForOdds.has(String(status ?? '').toUpperCase()) && oddsSource === 'reference-prematch') {
        oddsSanityWarnings.push(
          'ODDS_SOURCE_PREMATCH_WHILE_LIVE: canonical prices may be opening/pre-match lines, not the active live ladder — do not treat as current in-play prices.',
        );
      }
      if (oddsResult.available) {
        const cornersHome = Number.parseInt(String(statsCompact.corners.home ?? ''), 10);
        const cornersAway = Number.parseInt(String(statsCompact.corners.away ?? ''), 10);
        const currentTotalCorners = Number.isNaN(cornersHome) || Number.isNaN(cornersAway)
          ? null
          : cornersHome + cornersAway;
        const sanitizedOdds = sanitizePromptOddsCanonical({
          canonical: oddsResult.canonical,
          homeGoals,
          awayGoals,
          currentTotalGoals: homeGoals + awayGoals,
          currentTotalCorners,
          matchMinute: minute,
          matchStatus: status,
          htHomeGoals: htScoreLive?.home ?? null,
          htAwayGoals: htScoreLive?.away ?? null,
        });
        oddsCanonical = sanitizedOdds.canonical;
        oddsAvailable = sanitizedOdds.available;
        oddsSanityWarnings.push(...sanitizedOdds.warnings);
        oddsSuspicious = sanitizedOdds.suspicious;
      }
      return {
        oddsCanonical,
        oddsAvailable,
        oddsSource,
        oddsFetchedAt,
        oddsSanityWarnings,
        oddsSuspicious,
      };
    };

    const [oddsSide, promptContextBundle] = await Promise.all([
      loadOddsSide(),
      Promise.all([
        loadHistoricalPromptContext(deps),
        fixture.league?.id
          ? deps.getLeagueProfileByLeagueId(fixture.league.id).catch(() => null)
          : Promise.resolve(null),
        fixture.league?.id
          ? deps.getLeagueById(fixture.league.id).catch(() => null)
          : Promise.resolve(null),
        fixture.teams?.home?.id != null
          ? deps.getTeamProfileByTeamId(String(fixture.teams.home.id)).catch(() => null)
          : Promise.resolve(null),
        fixture.teams?.away?.id != null
          ? deps.getTeamProfileByTeamId(String(fixture.teams.away.id)).catch(() => null)
          : Promise.resolve(null),
        needsLineupsSnapshot
          ? deps.ensureScoutInsight(matchId, {
              fixture,
              leagueId: fixture.league?.id,
              season: fixture.league?.season,
              status,
              consumer: 'server-pipeline-ask-ai',
              sampleProviderData: false,
              freshnessMode: 'real_required',
            }).catch(() => null)
          : Promise.resolve(null),
      ]),
    ]);

    const {
      oddsCanonical,
      oddsAvailable,
      oddsSource,
      oddsFetchedAt,
      oddsSanityWarnings,
      oddsSuspicious,
    } = oddsSide;
    const [historicalPerformance, leagueProfile, leagueMeta, homeTeamProfile, awayTeamProfile, scoutInsight] = promptContextBundle;
    const lineupsSnapshot = summarizeLineupsForPrompt(
      (scoutInsight?.lineups?.payload as ApiFixtureLineup[] | null | undefined) ?? null,
      homeName,
      awayName,
    );

    // Persist latest state for the next run's staleness gate; do not block LLM on DB write.
    if (!shadowMode) {
      void deps.createSnapshot({
        match_id: matchId,
        minute,
        status,
        home_score: homeGoals,
        away_score: awayGoals,
        stats: statsCompact as unknown as Record<string, unknown>,
        events: eventsCompact as unknown[],
        odds: oddsCanonical as unknown as Record<string, unknown>,
        source: 'server-pipeline',
      }).catch((err) => {
        console.warn(`[pipeline] Snapshot save failed for ${matchId}:`, err instanceof Error ? err.message : String(err));
      });

      const oddsMovements = buildOddsMovementRows(matchId, minute, oddsCanonical as Record<string, unknown>);
      if (oddsMovements.length > 0) {
        void recordOddsMovementsBulk(oddsMovements).catch((err) => {
          console.warn(`[pipeline] Odds movements save failed for ${matchId}:`, err instanceof Error ? err.message : String(err));
        });
      }
    }

    const staleness = checkStalenessServer({
      minute,
      status,
      score,
      eventsCompact,
      statsCompact,
      oddsCanonical: oddsCanonical as unknown as Record<string, unknown>,
      previousRecommendation: prevRecs[0]
        ? {
            minute: prevRecs[0].minute,
            odds: prevRecs[0].odds,
            bet_market: prevRecs[0].bet_market,
            selection: prevRecs[0].selection,
            score: prevRecs[0].score,
            status: prevRecs[0].status,
          }
        : null,
      previousSnapshot: latestSnapshot
        ? {
            minute: latestSnapshot.minute,
            home_score: latestSnapshot.home_score,
            away_score: latestSnapshot.away_score,
            status: latestSnapshot.status,
            odds: latestSnapshot.odds,
            stats: latestSnapshot.stats,
          }
        : null,
      settings: {
        reanalyzeMinMinutes: settings.reanalyzeMinMinutes,
        oddsMovementThreshold: settings.stalenessOddsDelta,
      },
      forceAnalyze,
    });
    if (staleness.isStale && !forceAnalyze && options.skipStalenessGate !== true) {
      if (!shadowMode && shouldSamplePipelineSkipAudit(staleness.reason, 'staleness', 20)) {
        audit({
          category: 'PIPELINE',
          action: 'PIPELINE_MATCH_SKIPPED',
          outcome: 'SKIPPED',
          actor: 'auto-pipeline',
          metadata: {
            matchId,
            matchDisplay,
            reason: staleness.reason,
            baseline: staleness.baseline,
          },
        });
      }

      return {
        matchId,
        success: true,
        decisionKind: 'no_bet',
        shouldPush: false,
        selection: '',
        confidence: 0,
        saved: false,
        notified: false,
        debug: {
          analysisRunId,
          shadowMode,
          skippedAt: 'staleness',
          skipReason: staleness.reason,
          analysisMode,
          oddsSource,
          oddsAvailable,
          statsAvailable,
          statsSource,
          statsFallbackUsed,
          statsFallbackReason: statsFallbackReason || undefined,
          preLlmLatencyMs: Date.now() - startedAt,
          totalLatencyMs: Date.now() - startedAt,
        },
      };
    }

    const evidenceMode = deriveEvidenceMode(statsAvailable, oddsAvailable, eventsCompact);
    const promptDataLevel = getPromptStatsDetailLevel(statsCompact);
    const customConditions = (watchlistEntry.custom_conditions || '').trim();
    const recommendedCondition = (watchlistEntry.recommended_custom_condition || '').trim();
    const recommendedConditionReason = (watchlistEntry.recommended_condition_reason || '').trim();
    const hasCustomCondition = !!customConditions;

    // 5. Get previous recommendations for prompt context
    const prevRecsContext = prevRecs.slice(0, 5).map((r) => ({
      minute: r.minute,
      selection: r.selection,
      bet_market: r.bet_market,
      confidence: r.confidence,
      odds: r.odds,
      stake_percent: r.stake_percent,
      result: r.result,
      reasoning: r.reasoning?.substring(0, 150),
    }));

    // 5. Build the central server-side prompt
    const rawStrategicContext = watchlistEntry.strategic_context as Record<string, unknown> | null;
    const strategicRefreshStatus = String((rawStrategicContext?._meta as Record<string, unknown> | undefined)?.refresh_status ?? '').trim().toLowerCase();
    const strategicContext = (
      rawStrategicContext
      && strategicRefreshStatus === 'good'
      && hasUsableStrategicContext(rawStrategicContext as unknown as Parameters<typeof hasUsableStrategicContext>[0], {
        topLeague: leagueMeta?.top_league === true,
      })
    )
      ? rawStrategicContext
      : null;
    const prediction = watchlistEntry.prediction as Record<string, unknown> | null;
    const prematchExpertFeatures = buildPrematchExpertFeaturesV1({
      strategicContext,
      leagueProfile: leagueProfile as Record<string, unknown> | null,
      prediction,
      homeTeamProfile: homeTeamProfile as Record<string, unknown> | null,
      awayTeamProfile: awayTeamProfile as Record<string, unknown> | null,
      topLeague: leagueMeta?.top_league === true,
    });
    const prematchAvailability = prematchExpertFeatures?.meta.availability;
    const prematchNoisePenalty = prematchExpertFeatures?.trust_and_coverage.prematch_noise_penalty ?? null;
    const prematchStrength = getPrematchPriorStrength(prematchExpertFeatures);
    const leagueProfileWindow = readProfileWindowSnapshot(leagueProfile);
    const homeTeamProfileWindow = readProfileWindowSnapshot(homeTeamProfile);
    const awayTeamProfileWindow = readProfileWindowSnapshot(awayTeamProfile);
    const homeOverlaySnapshot = readTeamOverlaySnapshot(homeTeamProfile);
    const awayOverlaySnapshot = readTeamOverlaySnapshot(awayTeamProfile);
    const structuredPrematchAskAiCheck = canRunStructuredPrematchAskAi({
      analysisMode,
      status,
      prediction,
      prematchExpertFeatures,
    });
    const structuredPrematchAskAi = structuredPrematchAskAiCheck.eligible;

    if (evidenceMode === 'low_evidence' && !hasCustomCondition && !structuredPrematchAskAi) {
      if (!shadowMode && shouldSamplePipelineSkipAudit('low_evidence_without_watch_condition', 'low-evidence', 20)) {
        audit({
          category: 'PIPELINE',
          action: 'PIPELINE_MATCH_SKIPPED',
          outcome: 'SKIPPED',
          actor: 'auto-pipeline',
          metadata: {
            matchId,
            matchDisplay,
            reason: 'low_evidence_without_watch_condition',
            analysisMode,
            evidenceMode,
            structuredPrematchAskAiReason: structuredPrematchAskAiCheck.reason,
            prematchAvailability,
            prematchStrength,
            leagueProfileSampleMatches: leagueProfileWindow.sampleMatches,
            leagueProfileEventCoverage: leagueProfileWindow.eventCoverage,
            homeTeamProfileSampleMatches: homeTeamProfileWindow.sampleMatches,
            homeTeamProfileEventCoverage: homeTeamProfileWindow.eventCoverage,
            awayTeamProfileSampleMatches: awayTeamProfileWindow.sampleMatches,
            awayTeamProfileEventCoverage: awayTeamProfileWindow.eventCoverage,
            homeTacticalOverlaySourceMode: homeOverlaySnapshot.sourceMode,
            homeTacticalOverlaySourceConfidence: homeOverlaySnapshot.sourceConfidence,
            awayTacticalOverlaySourceMode: awayOverlaySnapshot.sourceMode,
            awayTacticalOverlaySourceConfidence: awayOverlaySnapshot.sourceConfidence,
          },
        });
      }

      return {
        matchId,
        matchDisplay,
        homeName,
        awayName,
        league,
        minute,
        score,
        status,
        success: true,
        decisionKind: 'no_bet',
        shouldPush: false,
        selection: '',
        confidence: 0,
        saved: false,
        notified: false,
        debug: {
          analysisRunId,
          shadowMode,
          skippedAt: 'proceed',
          skipReason: 'Skipped AI analysis because this match is in low-evidence mode and no custom watch condition is configured.',
          analysisMode,
          oddsSource,
          oddsAvailable,
          statsAvailable,
          statsSource,
          evidenceMode,
          prematchAvailability,
          prematchNoisePenalty,
          prematchStrength,
          structuredPrematchAskAi,
          structuredPrematchAskAiReason: structuredPrematchAskAiCheck.reason,
          statsFallbackUsed,
          statsFallbackReason: statsFallbackReason || undefined,
          preLlmLatencyMs: Date.now() - startedAt,
          totalLatencyMs: Date.now() - startedAt,
        },
      };
    }

    const promptContext: PromptExecutionContext = {
      homeName, awayName, league, minute, score, status,
      statsCompact, statsAvailable, statsSource, evidenceMode,
      eventsCompact: eventsCompact.slice(-8),
      oddsCanonical, oddsAvailable, oddsSource, oddsFetchedAt,
      oddsSanityWarnings,
      oddsSuspicious,
      derivedInsights: !statsAvailable ? derivedInsights : null,
      customConditions, recommendedCondition, recommendedConditionReason,
      strategicContext,
      leagueProfile: leagueProfile as Record<string, unknown> | null,
      homeTeamProfile: homeTeamProfile as Record<string, unknown> | null,
      awayTeamProfile: awayTeamProfile as Record<string, unknown> | null,
      prematchExpertFeatures,
      structuredPrematchAskAi,
      analysisMode,
      forceAnalyze,
      isManualPush: isManualForce,
      prediction,
      currentTotalGoals: homeGoals + awayGoals,
      previousRecommendations: prevRecsContext,
      historicalPerformance,
      preMatchPredictionSummary: '',
      mode: watchlistEntry.mode || 'B',
      statsFallbackReason,
      userQuestion: options.userQuestion,
      followUpHistory: options.followUpHistory,
      lineupsSnapshot,
      settledReplayApprovedTrace: options.settledReplayApprovedTrace === true,
      settledReplayOriginalBetMarket: options.settledReplayTraceOriginalBetMarket,
      settledReplayOriginalSelection: options.settledReplayTraceOriginalSelection,
      skipRecommendationPolicy:
        options.settledReplayApprovedTrace === true && options.applySettledReplayPolicy !== true,
    };

    // 6. Call Gemini
    const model = options.modelOverride || settings.aiModel;
    const preLlmLatencyMs = Date.now() - startedAt;
    const activeAnalysis = await executePromptAnalysis(
      deps,
      model,
      settings,
      promptContext,
      activePromptVersion,
      {
        previousRecommendations: prevRecs.map((r) => ({
          minute: r.minute ?? null,
          selection: r.selection ?? '',
          bet_market: r.bet_market ?? '',
          stake_percent: r.stake_percent ?? null,
          result: r.result ?? null,
        })),
      },
    );
    const parsed = activeAnalysis.parsed;
    enforceFollowUpLineupAvailability(parsed, {
      userQuestion: options.userQuestion,
      lineupsSnapshot,
    });
    const promptShadowRequested = shouldRunPromptShadow({
      matchId,
      minute,
      activePromptVersion,
      shadowPromptVersion,
      shadowMode,
      promptVersionOverride: options.promptVersionOverride,
    }) && !advisoryOnly;

    if (promptShadowRequested) {
      void runPromptShadowComparison({
        deps,
        analysisRunId,
        matchId,
        activePromptVersion,
        shadowPromptVersion,
        analysisMode,
        evidenceMode,
        oddsSource,
        statsSource,
        promptContext,
        policyContext: {
          previousRecommendations: prevRecs.map((r) => ({
            minute: r.minute ?? null,
            selection: r.selection ?? '',
            bet_market: r.bet_market ?? '',
            stake_percent: r.stake_percent ?? null,
            result: r.result ?? null,
          })),
        },
        activeAnalysis,
        model,
        settings,
      });
    }

    const conditionTriggeredSaveDecision = evaluateConditionTriggeredSaveDecision({
      parsed,
      previousRecommendations: prevRecs.map((r) => ({
        minute: r.minute ?? null,
        selection: r.selection ?? '',
        bet_market: r.bet_market ?? '',
        stake_percent: r.stake_percent ?? null,
        result: r.result ?? null,
        odds: r.odds ?? null,
      })),
      oddsCanonical,
      minute,
      score,
      minOdds: settings.minOdds,
      minConfidence: settings.minConfidence,
      promptVersion: activePromptVersion,
      statsCompact,
    });
    if (conditionTriggeredSaveDecision.warnings.length > 0) {
      parsed.warnings = [...parsed.warnings, ...conditionTriggeredSaveDecision.warnings];
    }

    // 8. Split the two outcomes explicitly:
    // - shouldSave: create recommendation + AI performance row when either the AI
    //   produced an actionable bet, or the condition-triggered branch produced the
    //   first actionable thesis (or an approved same-line override).
    // - shouldNotify: alert the user for either an actionable AI bet OR a
    //   condition-only trigger that meets the notify threshold.
    const shouldSave = advisoryOnly ? false : (parsed.final_should_bet || conditionTriggeredSaveDecision.shouldSave);
    const shouldNotify = advisoryOnly ? false : parsed.should_push;
    const notificationSelection = displaySelection(parsed);
    const notificationConfidence = displayConfidence(parsed);
    const notificationOdds = parsed.final_should_bet
      ? extractOddsFromSelection(parsed.selection, parsed.bet_market, oddsCanonical)
      : conditionTriggeredSaveDecision.odds;
    const notificationSelectionDisplay = parsed.final_should_bet
      ? formatSelectionWithMarketContext({
          selection: notificationSelection,
          betMarket: parsed.bet_market,
          odds: notificationOdds,
          language: 'en',
        })
      : notificationSelection;
    let saved = false;
    let recId: number | null = null;
    let notified = false;
    const conditionOnlyDeliveryMap = new Map<string, number[]>();
    let conditionOnlyDeliveriesLoaded = false;

    const ensureConditionOnlyDeliveries = async () => {
      if (conditionOnlyDeliveriesLoaded || recId != null || shadowMode || !parsed.condition_triggered_should_push) return;
      conditionOnlyDeliveriesLoaded = true;

      const conditionOnlyBetMarket = normalizeMarket(parsed.condition_triggered_suggestion);
      const staged = await deps.stageConditionOnlyDeliveries({
        query,
      }, {
        match_id: matchId,
        timestamp: new Date().toISOString(),
        minute,
        score,
        status,
        stats_snapshot: statsCompact as unknown as Record<string, unknown>,
        league,
        home_team: homeName,
        away_team: awayName,
        selection: parsed.condition_triggered_suggestion,
        bet_market: conditionOnlyBetMarket === 'unknown' ? null : conditionOnlyBetMarket,
        confidence: parsed.condition_triggered_confidence,
        risk_level: parsed.risk_level,
        stake_percent: parsed.condition_triggered_stake,
        reasoning: parsed.condition_triggered_reasoning_en,
        reasoning_vi: parsed.condition_triggered_reasoning_vi,
        warnings: parsed.warnings.join(', '),
        condition_summary_en: parsed.custom_condition_summary_en,
        condition_summary_vi: parsed.custom_condition_summary_vi,
        condition_reason_en: parsed.custom_condition_reason_en,
        condition_reason_vi: parsed.custom_condition_reason_vi,
        ai_model: model,
        mode: watchlistEntry.mode || 'B',
      }).catch(() => []);

      for (const row of staged) {
        const ids = conditionOnlyDeliveryMap.get(row.userId) ?? [];
        ids.push(row.deliveryId);
        conditionOnlyDeliveryMap.set(row.userId, ids);
      }
    };

    if (shouldSave && !shadowMode) {
      const saveFromConditionTrigger = !parsed.final_should_bet && conditionTriggeredSaveDecision.shouldSave;
      const savedSelection = saveFromConditionTrigger ? conditionTriggeredSaveDecision.selection : parsed.selection;
      const savedBetMarket = saveFromConditionTrigger ? conditionTriggeredSaveDecision.betMarket : parsed.bet_market;
      const mappedOdd = saveFromConditionTrigger
        ? conditionTriggeredSaveDecision.odds
        : extractOddsFromSelection(parsed.selection, parsed.bet_market, oddsCanonical);
      const decisionContext = buildRecommendationDecisionContext({
        evidenceMode,
        promptDataLevel,
        prematchAvailability,
        prematchStrength,
        prematchNoisePenalty,
        structuredPrematchAskAi,
        structuredPrematchAskAiReason: structuredPrematchAskAiCheck.reason,
        statsSource,
        oddsSource,
        leagueProfileWindow,
        homeTeamProfileWindow,
        awayTeamProfileWindow,
        homeOverlaySnapshot,
        awayOverlaySnapshot,
        policyBlocked: activeAnalysis.policyBlocked,
        policyWarnings: activeAnalysis.policyWarnings,
      });
      decisionContext['recommendationSource'] = saveFromConditionTrigger ? 'condition_triggered' : 'ai_primary';
      decisionContext['conditionTriggeredSpecialOverride'] = saveFromConditionTrigger
        ? parsed.condition_triggered_special_override
        : false;
      decisionContext['conditionTriggeredSpecialOverrideReasonEn'] = saveFromConditionTrigger
        ? parsed.condition_triggered_special_override_reason_en
        : '';
      decisionContext['conditionTriggeredSpecialOverrideReasonVi'] = saveFromConditionTrigger
        ? parsed.condition_triggered_special_override_reason_vi
        : '';
      const rec = await deps.createRecommendation({
        match_id: matchId,
        timestamp: new Date().toISOString(),
        league,
        home_team: homeName,
        away_team: awayName,
        status,
        condition_triggered_suggestion: parsed.condition_triggered_suggestion,
        custom_condition_raw: customConditions,
        execution_id: `auto-pipeline-${Date.now()}`,
        odds_snapshot: oddsCanonical as Record<string, unknown>,
        stats_snapshot: statsCompact as unknown as Record<string, unknown>,
        decision_context: decisionContext,
        pre_match_prediction_summary: '',
        prompt_version: activePromptVersion,
        custom_condition_matched: parsed.custom_condition_matched,
        minute,
        score,
        bet_type: 'AI',
        selection: savedSelection,
        odds: mappedOdd,
        confidence: saveFromConditionTrigger ? conditionTriggeredSaveDecision.confidence : parsed.confidence,
        value_percent: parsed.value_percent,
        risk_level: parsed.risk_level,
        stake_percent: saveFromConditionTrigger ? conditionTriggeredSaveDecision.stakePercent : parsed.stake_percent,
        reasoning: saveFromConditionTrigger ? conditionTriggeredSaveDecision.reasoningEn : parsed.reasoning_en,
        reasoning_vi: saveFromConditionTrigger ? conditionTriggeredSaveDecision.reasoningVi : parsed.reasoning_vi,
        key_factors: '',
        warnings: parsed.warnings.join(', '),
        ai_model: model,
        mode: watchlistEntry.mode || 'B',
        bet_market: savedBetMarket,
        notified: '',
        notification_channels: '',
      });
      saved = true;
      recId = rec.id;

      // Auto-create AI performance tracking record (F3 audit fix)
      if (model) {
        try {
          await deps.createAiPerformanceRecord({
            recommendation_id: rec.id,
            match_id: matchId,
            ai_model: model,
            prompt_version: activePromptVersion,
            ai_confidence: saveFromConditionTrigger ? conditionTriggeredSaveDecision.confidence : parsed.confidence,
            ai_should_push: parsed.ai_should_push || saveFromConditionTrigger,
            predicted_market: savedBetMarket || '',
            predicted_selection: savedSelection,
            predicted_odds: mappedOdd ? Number(mappedOdd) : null,
            match_minute: minute,
            match_score: score,
            league: league,
          });
        } catch { /* non-critical — duplicate key or other */ }
      }
    }

    // 9. Telegram delivery is intentionally asynchronous.
    // Recommendations stage delivery rows inside createRecommendation() and
    // condition-only alerts stage rows via ensureConditionOnlyDeliveries().
    // A dedicated delivery job flushes Telegram messages so the live pipeline
    // does not block on network sends.
    if (shouldNotify && !shadowMode && settings.telegramEnabled && recId == null) {
      await ensureConditionOnlyDeliveries();
    }
    if (shouldNotify && !shadowMode && settings.telegramEnabled) {
      // Async Telegram delivery is queued via delivery rows. We keep the
      // high-level notified flag truthy once the alert is staged so pipeline
      // reporting still reflects user-visible alert intent without blocking on
      // the Telegram network round-trip.
      notified = true;
    }

    // 10. Web Push follows the same semantics as Telegram: notify for AI saves
    // and condition-only triggers, but only mark a stored recommendation when
    // there is an actual recommendation row.
    if (shouldNotify && !shadowMode && settings.webPushEnabled && isWebPushConfigured()) {
      try {
        if (recId == null) {
          await ensureConditionOnlyDeliveries();
        }
        const subscriptions = await getAllSubscriptions();
        const eligibleUserIds = recId != null
          ? await deps.getEligibleDeliveryUserIds(recId).catch(() => new Set<string>())
          : new Set(conditionOnlyDeliveryMap.keys());
        const targetSubscriptions = eligibleUserIds
          ? subscriptions.filter((sub) => eligibleUserIds.has(sub.user_id))
          : subscriptions;

        if (targetSubscriptions.length > 0) {
          const pushTitle = parsed.final_should_bet ? '🎯 AI RECOMMENDATION' : '⚡ CONDITION TRIGGERED';
          const pushBody = [
            matchDisplay,
            notificationSelectionDisplay ? `${notificationSelectionDisplay} | Odds: ${notificationOdds ?? 'N/A'} | Confidence: ${notificationConfidence}/10` : '',
          ].filter(Boolean).join('\n');

          const deliveredUserIds = new Set<string>();

          await Promise.all(targetSubscriptions.map(async (sub) => {
            const result = await sendWebPushNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              { title: pushTitle, body: pushBody, tag: `tfi-rec-${matchId}`, url: '/' },
            );
            if (result.ok) {
              deliveredUserIds.add(sub.user_id);
              await updateLastUsed(sub.endpoint).catch(() => undefined);
            }
            if (!result.ok && result.gone) {
              // Subscription expired — clean it up
              await deleteSubscription(sub.endpoint).catch(() => undefined);
            }
          }));

          if (recId != null && deliveredUserIds.size > 0) {
            await deps.markRecommendationNotified(recId, 'web_push').catch(() => undefined);
            await deps.markRecommendationDeliveriesDelivered(
              recId,
              [...deliveredUserIds],
              'web_push',
            ).catch(() => undefined);
          }
          if (recId == null && deliveredUserIds.size > 0) {
            const deliveredConditionDeliveryIds = [...deliveredUserIds].flatMap((userId) => conditionOnlyDeliveryMap.get(userId) ?? []);
            await deps.markDeliveryRowsDelivered(deliveredConditionDeliveryIds, 'web_push').catch(() => undefined);
          }
          if (deliveredUserIds.size > 0) notified = true;
        }
      } catch (e) {
        console.error(`[pipeline] Web Push notification failed for ${matchId}:`, e instanceof Error ? e.message : String(e));
      }
    }

    if (!shadowMode && !advisoryOnly) {
      audit({
        category: 'PIPELINE',
        action: 'PIPELINE_MATCH_ANALYZED',
        outcome: parsed.should_push ? 'SUCCESS' : 'SKIPPED',
        actor: 'auto-pipeline',
        metadata: {
          matchId, matchDisplay, selection: notificationSelectionDisplay,
          confidence: notificationConfidence, shouldPush: parsed.should_push,
          saved, recId, notified,
          promptVersion: activePromptVersion,
          promptDataLevel,
          prematchAvailability,
          prematchNoisePenalty,
          prematchStrength,
          structuredPrematchAskAi,
          structuredPrematchAskAiReason: structuredPrematchAskAiCheck.reason,
          statsSource,
          evidenceMode,
          policyBlocked: activeAnalysis.policyBlocked,
          policyWarnings: activeAnalysis.policyWarnings,
          leagueProfileSampleMatches: leagueProfileWindow.sampleMatches,
          leagueProfileEventCoverage: leagueProfileWindow.eventCoverage,
          homeTeamProfileSampleMatches: homeTeamProfileWindow.sampleMatches,
          homeTeamProfileEventCoverage: homeTeamProfileWindow.eventCoverage,
          awayTeamProfileSampleMatches: awayTeamProfileWindow.sampleMatches,
          awayTeamProfileEventCoverage: awayTeamProfileWindow.eventCoverage,
          homeTacticalOverlaySourceMode: homeOverlaySnapshot.sourceMode,
          homeTacticalOverlaySourceConfidence: homeOverlaySnapshot.sourceConfidence,
          awayTacticalOverlaySourceMode: awayOverlaySnapshot.sourceMode,
          awayTacticalOverlaySourceConfidence: awayOverlaySnapshot.sourceConfidence,
        },
      });
    }

    return {
      matchId,
      matchDisplay,
      homeName,
      awayName,
      league,
      minute,
      score,
      status,
      success: true, decisionKind: decisionKindFromParsed(parsed), shouldPush: parsed.should_push,
      selection: notificationSelection, confidence: notificationConfidence,
      saved, notified,
      debug: {
        analysisRunId,
        shadowMode,
        analysisMode,
        advisoryOnly,
        oddsSource,
        oddsAvailable,
        statsAvailable,
        statsSource,
        evidenceMode,
        statsFallbackUsed,
        statsFallbackReason: statsFallbackReason || undefined,
        promptVersion: activePromptVersion,
        promptDataLevel,
        prematchAvailability,
        prematchNoisePenalty,
        prematchStrength,
        structuredPrematchAskAi,
        structuredPrematchAskAiReason: structuredPrematchAskAiCheck.reason,
        promptChars: activeAnalysis.promptChars,
        promptEstimatedTokens: activeAnalysis.promptEstimatedTokens,
        aiTextChars: activeAnalysis.aiTextChars,
        aiTextEstimatedTokens: activeAnalysis.aiTextEstimatedTokens,
        llmLatencyMs: activeAnalysis.llmLatencyMs,
        preLlmLatencyMs,
        totalLatencyMs: Date.now() - startedAt,
        prompt: activeAnalysis.prompt,
        aiText: activeAnalysis.aiText,
        parsed: parsed as unknown as Record<string, unknown>,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[pipeline] Error processing match ${matchId}:`, errMsg);

    if (!shadowMode) {
      audit({
        category: 'PIPELINE',
        action: 'PIPELINE_MATCH_ERROR',
        outcome: 'FAILURE',
        actor: 'auto-pipeline',
        error: errMsg,
        metadata: { matchId },
      });
    }

    return {
      matchId,
      matchDisplay,
      homeName,
      awayName,
      league,
      minute,
      score,
      status,
      success: false, decisionKind: 'no_bet', shouldPush: false,
      selection: '', confidence: 0,
      saved: false, notified: false, error: errMsg,
      debug: {
        analysisRunId,
        shadowMode,
        advisoryOnly,
        totalLatencyMs: Date.now() - startedAt,
      },
    };
  }
}

// ==================== Run Pipeline for Batch ====================

export async function runPipelineForFixture(
  matchId: string,
  fixture: ApiFixture,
  watchlistEntry: watchlistRepo.WatchlistRow,
  options: PipelineExecutionOptions = {},
): Promise<MatchPipelineResult> {
  const settings = options.skipSettingsLoad ? buildConfigPipelineSettings() : await loadPipelineSettings();
  return processMatch(matchId, fixture, watchlistEntry, settings, options);
}

export async function runPromptOnlyAnalysisForMatch(
  matchId: string,
  options: {
    forceAnalyze?: boolean;
    modelOverride?: string;
    promptVersionOverride?: LiveAnalysisPromptVersion;
    userQuestion?: string;
    followUpHistory?: FollowUpHistoryEntry[];
    advisoryOnly?: boolean;
  } = {},
): Promise<{ text: string; prompt: string; result: MatchPipelineResult }> {
  const [fixture, watchlistEntry] = await Promise.all([
    ensureFixturesForMatchIds([matchId], { freshnessMode: 'real_required' }).then((rows) => rows[0] ?? null),
    watchlistRepo.getOperationalWatchlistByMatchId(matchId),
  ]);

  if (!fixture) {
    throw new Error(`Fixture not found for match ${matchId}`);
  }
  if (!watchlistEntry) {
    throw new Error(`Watchlist entry not found for match ${matchId}`);
  }

  const result = await runPipelineForFixture(matchId, fixture, watchlistEntry, {
    shadowMode: true,
    sampleProviderData: false,
    forceAnalyze: options.forceAnalyze,
    skipProceedGate: true,
    skipStalenessGate: true,
    modelOverride: options.modelOverride,
    promptVersionOverride: options.promptVersionOverride,
    userQuestion: options.userQuestion,
    followUpHistory: options.followUpHistory,
    advisoryOnly: options.advisoryOnly,
  });

  const prompt = result.debug?.prompt;
  const text = result.debug?.aiText;
  if (!prompt || !text) {
    if (result.debug?.skipReason) {
      return {
        prompt: prompt ?? '[LLM skipped]',
        text: `Analysis skipped: ${result.debug.skipReason}`,
        result,
      };
    }
    throw new Error(`Prompt-only analysis did not produce AI output for match ${matchId}`);
  }

  return { text, prompt, result };
}

export async function runManualAnalysisForMatch(
  matchId: string,
  options: {
    forceAnalyze?: boolean;
    modelOverride?: string;
    promptVersionOverride?: LiveAnalysisPromptVersion;
    userQuestion?: string;
    followUpHistory?: FollowUpHistoryEntry[];
    advisoryOnly?: boolean;
  } = {},
): Promise<MatchPipelineResult> {
  const [fixture, watchlistEntry] = await Promise.all([
    ensureFixturesForMatchIds([matchId], { freshnessMode: 'real_required' }).then((rows) => rows[0] ?? null),
    watchlistRepo.getOperationalWatchlistByMatchId(matchId),
  ]);

  if (!fixture) {
    throw new Error(`Fixture not found for match ${matchId}`);
  }
  if (!watchlistEntry) {
    throw new Error(`Watchlist entry not found for match ${matchId}`);
  }

  return runPipelineForFixture(matchId, fixture, watchlistEntry, {
    forceAnalyze: options.forceAnalyze ?? true,
    skipStalenessGate: true,
    modelOverride: options.modelOverride,
    promptVersionOverride: options.promptVersionOverride,
    userQuestion: options.userQuestion,
    followUpHistory: options.followUpHistory,
    advisoryOnly: options.advisoryOnly,
  });
}

/**
 * Run the AI analysis pipeline for a batch of live match IDs.
 * Called by check-live-trigger job when live matches are detected.
 */
export async function runPipelineBatch(matchIds: string[]): Promise<PipelineResult> {
  const result: PipelineResult = { totalMatches: matchIds.length, processed: 0, errors: 0, results: [] };
  if (matchIds.length === 0) return result;

  // Load settings from DB (user config saved via UI) with env fallback
  const settings = await loadPipelineSettings();
  console.log(`[pipeline] Processing batch of ${matchIds.length} matches: ${matchIds.join(', ')} (telegram: ${settings.telegramEnabled ? 'ENABLED' : 'DISABLED'}, model: ${settings.aiModel})`);

  // Fetch all fixtures in one API call
  const fixtures = await ensureFixturesForMatchIds(matchIds, { freshnessMode: 'real_required' });
  const fixtureMap = new Map(fixtures.map((f) => [String(f.fixture?.id), f]));

  // Get watchlist entries for metadata
  const watchlistEntries = await Promise.all(
    matchIds.map((id) => watchlistRepo.getOperationalWatchlistByMatchId(id)),
  );
  const watchlistMap = new Map<string, watchlistRepo.WatchlistRow>();
  for (let i = 0; i < matchIds.length; i++) {
    const id = matchIds[i]!;
    if (watchlistEntries[i]) watchlistMap.set(id, watchlistEntries[i]!);
  }

  // Process sequentially but keep the gap very small; coarse gating already removed most no-op work.
  for (let i = 0; i < matchIds.length; i++) {
    const matchId = matchIds[i]!;
    const fixture = fixtureMap.get(matchId);
    const wl = watchlistMap.get(matchId);
    if (!fixture || !wl) {
      result.results.push({
        matchId, success: false, decisionKind: 'no_bet', shouldPush: false,
        selection: '', confidence: 0, saved: false, notified: false,
        error: !fixture ? 'Fixture not found' : 'Watchlist entry not found',
      });
      result.errors++;
      continue;
    }

    const matchResult = await processMatch(matchId, fixture, wl, settings);
    result.results.push(matchResult);
    result.processed++;
    if (!matchResult.success) result.errors++;

    // Small delay between matches to avoid bursty provider traffic
    if (i < matchIds.length - 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  return result;
}

// ==================== Build Server Prompt ====================

function buildServerPrompt(data: {
  homeName: string;
  awayName: string;
  league: string;
  minute: number;
  score: string;
  status: string;
  statsCompact: StatsCompact;
  statsAvailable: boolean;
  statsSource: StatsSource;
  evidenceMode: EvidenceMode;
  eventsCompact: EventCompact[];
  oddsCanonical: OddsCanonical;
  oddsAvailable: boolean;
  oddsSource: string;
  oddsFetchedAt: string | null;
  oddsSanityWarnings: string[];
  oddsSuspicious: boolean;
  derivedInsights: DerivedInsights | null;
  customConditions: string;
  recommendedCondition: string;
  recommendedConditionReason: string;
  strategicContext: Record<string, unknown> | null;
  leagueProfile: Record<string, unknown> | null;
  homeTeamProfile: Record<string, unknown> | null;
  awayTeamProfile: Record<string, unknown> | null;
  prematchExpertFeatures: PrematchExpertFeaturesV1 | null;
  structuredPrematchAskAi: boolean;
  analysisMode: PromptAnalysisMode;
  forceAnalyze: boolean;
  isManualPush: boolean;
  prediction: Record<string, unknown> | null;
  currentTotalGoals: number;
  previousRecommendations: Array<Record<string, unknown>>;
  historicalPerformance: HistoricalPerformanceContext | null;
  preMatchPredictionSummary: string;
  mode: string;
  statsFallbackReason: string;
  userQuestion?: string;
  followUpHistory?: FollowUpHistoryEntry[];
  lineupsSnapshot?: {
    available: boolean;
    teams: Array<{
      side: 'home' | 'away';
      teamName: string;
      formation: string | null;
      coachName: string | null;
      starters: string[];
      substitutes: string[];
    }>;
  } | null;
  settledReplayApprovedTrace?: boolean;
  settledReplayOriginalBetMarket?: string;
  settledReplayOriginalSelection?: string;
}, settings: PipelineSettings, promptVersion: LiveAnalysisPromptVersion = LIVE_ANALYSIS_PROMPT_VERSION): string {
  return buildLiveAnalysisPrompt(
    {
      homeName: data.homeName,
      awayName: data.awayName,
      league: data.league,
      minute: data.minute,
      score: data.score,
      status: data.status,
      statsCompact: data.statsCompact,
      statsAvailable: data.statsAvailable,
      statsSource: data.statsSource,
      evidenceMode: data.evidenceMode,
      statsMeta: null,
      eventsCompact: data.eventsCompact,
      oddsCanonical: data.oddsCanonical as Record<string, unknown>,
      oddsAvailable: data.oddsAvailable,
      oddsSource: data.oddsSource,
      oddsFetchedAt: data.oddsFetchedAt,
      oddsSanityWarnings: data.oddsSanityWarnings,
      oddsSuspicious: data.oddsSuspicious,
      derivedInsights: data.derivedInsights as Record<string, unknown> | null,
      customConditions: data.customConditions,
      recommendedCondition: data.recommendedCondition,
      recommendedConditionReason: data.recommendedConditionReason,
      strategicContext: data.strategicContext,
      leagueProfile: data.leagueProfile,
      homeTeamProfile: data.homeTeamProfile,
      awayTeamProfile: data.awayTeamProfile,
      prematchExpertFeatures: data.prematchExpertFeatures,
      structuredPrematchAskAi: data.structuredPrematchAskAi,
      analysisMode: data.analysisMode,
      forceAnalyze: data.forceAnalyze,
      isManualPush: data.isManualPush,
      skippedFilters: [],
      originalWouldProceed: true,
      prediction: data.prediction,
      currentTotalGoals: data.currentTotalGoals,
      previousRecommendations: data.previousRecommendations,
      matchTimeline: [],
      historicalPerformance: data.historicalPerformance,
      preMatchPredictionSummary: data.preMatchPredictionSummary,
      mode: data.mode,
      statsFallbackReason: data.statsFallbackReason,
      userQuestion: data.userQuestion,
      followUpHistory: data.followUpHistory,
      lineupsSnapshot: data.lineupsSnapshot ?? null,
      settledReplayApprovedTrace: data.settledReplayApprovedTrace === true,
      settledReplayOriginalBetMarket: data.settledReplayOriginalBetMarket,
      settledReplayOriginalSelection: data.settledReplayOriginalSelection,
    },
    {
      minConfidence: settings.minConfidence,
      minOdds: settings.minOdds,
      latePhaseMinute: settings.latePhaseMinute,
      veryLatePhaseMinute: settings.veryLatePhaseMinute,
      endgameMinute: settings.endgameMinute,
    },
    promptVersion,
  );
}
