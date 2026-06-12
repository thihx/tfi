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
import { getRedisClient } from './redis.js';
import { query } from '../db/pool.js';
import { callGemini } from './gemini.js';
import { AiGatewayBlockedError } from './ai-gateway.js';
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
  autoGeneratePerformanceMemoryRules,
  deriveMinuteBand,
  deriveScoreState,
  getPerformanceMemoryPromptContext,
  getHistoricalPerformanceContext,
  lookupPerformanceMemory,
  type PerformanceMemoryCandidateRule,
  type PerformanceMemoryRecord,
  type HistoricalPerformanceContext,
} from '../repos/ai-performance.repo.js';
import { getSettings } from '../repos/settings.repo.js';
import { createSnapshot, getLatestSnapshot } from '../repos/match-snapshots.repo.js';
import { resolveMatchOdds, summarizeNormalizedOdds } from './odds-resolver.js';
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
  LIVE_ANALYSIS_PROMPT_VERSION,
  type LiveAnalysisPromptVersion,
  type PromptAnalysisMode,
  type PromptStatsDetailLevel,
} from './live-analysis-prompt.js';
import { normalizeMarket } from './normalize-market.js';
import { fetchStrategicContext, hasUsableStrategicContext } from './strategic-context.service.js';
import { getLeagueProfileByLeagueId } from '../repos/league-profiles.repo.js';
import { getTeamProfileByTeamId } from '../repos/team-profiles.repo.js';
import { getLeagueById } from '../repos/leagues.repo.js';
import {
  filterUserIdsAllowingWebPushNotifications,
  getNotificationChannelAddressesByUserIds,
} from '../repos/notification-channels.repo.js';
import { isWebPushConfigured, sendWebPushNotification } from './web-push.js';
import { getAllSubscriptions, deleteSubscription, updateLastUsed } from '../repos/push-subscriptions.repo.js';
import {
  getEligibleTelegramDeliveryTargets,
  getEligibleDeliveryUserIds,
  markRecommendationDeliveriesDelivered,
  stageAnalysisSignalDeliveries,
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
  type RecommendationPolicyPreviousRow,
} from './recommendation-policy.js';
import { getSegmentPolicyBlocklist } from './load-segment-policy-blocklist.js';
import { getSegmentPolicyStakeCaps } from './load-segment-policy-stake-cap.js';
import { applyLinePatiencePolicy } from './line-patience-policy.js';
import {
  getLinePatienceConfig,
  isLinePatienceEnabled,
} from './load-line-patience-policy.js';
import { isThesisWatchGateSatisfied, resolveThesisWatchPromoteMarket } from './thesis-watch-gates.js';
import {
  isThesisWatchPipelineActive,
  registerThesisWatchFromLlpBlock,
} from './thesis-watch.service.js';
import type {
  ThesisWatchAuditSnapshot,
  ThesisWatchPromoteReason,
  ThesisWatchRow,
} from './thesis-watch-types.js';
import {
  getPendingThesisWatchesByMatchId,
  markThesisWatchPromoted,
} from '../repos/thesis-watch.repo.js';
import {
  detectGoalsCornersLineContamination,
  detectHtGoalsCornersLineContamination,
} from './odds-integrity.js';
import { parseBetMarketLineSuffix as parseLineSuffix, sameOddsLine as sameLine } from './odds-line-utils.js';
import { isMarketAllowedForEvidenceMode, type LiveAnalysisEvidenceMode } from './evidence-mode-market-allowlist.js';
import { isFirstHalfApiBetName, isSecondHalfOnlyApiBetName } from './first-half-markets.js';
import { extractHalftimeScoreFromFixture } from './settle-context.js';
import { formatSelectionWithMarketContext } from './market-display.js';
import {
  buildRuntimePolicyShadowSignal,
  type RuntimePolicyShadowSignal,
} from './runtime-policy-shadow.js';
import {
  evaluateRuntimePolicyProductionPromotion,
  type RuntimePolicyProductionPromotionDecision,
} from './runtime-policy-production-promotion.js';
import { buildRuntimeShadowSegmentMetadata } from './runtime-shadow-segments.js';
import {
  buildStatsOnlyAiAdvisoryPrompt,
  evaluateStatsOnlyLiveSignal,
  parseStatsOnlyAiAdvisoryResponse,
} from './stats-only-live-signal.js';
import {
  classifyLiveEvidence,
  routeLiveOutput,
  type LiveOutputDecisionContext,
  type LiveOutputKind,
} from './live-output-router.js';
import { enqueueStatsOnlyLiveSignalDeliveries } from '../repos/match-alert-deliveries.repo.js';
const pipelineSkipAuditCounters = new Map<string, number>();

/** Absolute URL shown in web push body (tap notification still uses same path on the PWA origin). */
function buildWebPushMatchOpenUrl(baseUrl: string, matchId: string, matchDisplay: string): string {
  const origin = String(baseUrl || '').trim().replace(/\/$/, '') || 'http://localhost:3000';
  return `${origin}/?tab=matches&match=${encodeURIComponent(String(matchId))}&matchDisplay=${encodeURIComponent(matchDisplay)}`;
}

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

export function resolveRuntimeAiModel(
  dbModel: unknown,
  fallbackModel: string,
  allowExpensiveModels = config.allowExpensiveGeminiModels,
): string {
  const candidate = typeof dbModel === 'string' ? dbModel.trim() : '';
  if (!candidate) return fallbackModel;
  const isProClass = /\bpro\b/i.test(candidate);
  if (!allowExpensiveModels && isProClass) {
    console.warn(
      `[pipeline] Ignoring DB AI_MODEL="${candidate}" because Pro-class runtime models require ALLOW_EXPENSIVE_GEMINI_MODELS=true. Falling back to ${fallbackModel}.`,
    );
    return fallbackModel;
  }
  return candidate;
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
    aiModel: resolveRuntimeAiModel(db['AI_MODEL'], fallback.aiModel),
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

function deriveProviderOddsCoverageFlagsForPipeline(normalizedPayload: unknown[]): Record<string, unknown> {
  const payload = Array.isArray(normalizedPayload) ? normalizedPayload : [];
  const raw = summarizeNormalizedOdds(payload);
  const rawHas1x2 = raw['has_1x2'] === true;
  const rawHasOu = raw['has_ou'] === true;
  const rawHasAh = raw['has_ah'] === true;
  const rawHasBtts = raw['has_btts'] === true;
  const canonical = buildOddsCanonical(payload).canonical as Record<string, unknown>;
  const complete1x2 = (value: unknown) => {
    const row = value as { home?: unknown; draw?: unknown; away?: unknown } | null;
    return row?.home != null && row.draw != null && row.away != null;
  };
  const completePair = (value: unknown, first: 'over' | 'home' | 'yes', second: 'under' | 'away' | 'no') => {
    const row = value as Record<string, unknown> | null;
    return row?.[first] != null && row[second] != null;
  };
  const completePairInArray = (value: unknown, first: 'over' | 'home', second: 'under' | 'away') => (
    Array.isArray(value) && value.some((row) => completePair(row, first, second))
  );
  const canonicalHas1x2 = complete1x2(canonical['1x2']);
  const canonicalHasOu =
    completePair(canonical.ou, 'over', 'under')
    || completePair(canonical.ou_adjacent, 'over', 'under')
    || completePairInArray(canonical.ou_extra, 'over', 'under')
    || completePair(canonical.ht_ou, 'over', 'under')
    || completePair(canonical.ht_ou_adjacent, 'over', 'under')
    || completePairInArray(canonical.ht_ou_extra, 'over', 'under');
  const canonicalHasAh =
    completePair(canonical.ah, 'home', 'away')
    || completePair(canonical.ah_adjacent, 'home', 'away')
    || completePairInArray(canonical.ah_extra, 'home', 'away')
    || completePair(canonical.ht_ah, 'home', 'away')
    || completePair(canonical.ht_ah_adjacent, 'home', 'away')
    || completePairInArray(canonical.ht_ah_extra, 'home', 'away');
  const canonicalHasBtts = completePair(canonical.btts, 'yes', 'no') || completePair(canonical.ht_btts, 'yes', 'no');

  return {
    ...raw,
    raw_has_1x2: rawHas1x2,
    raw_has_ou: rawHasOu,
    raw_has_ah: rawHasAh,
    raw_has_btts: rawHasBtts,
    canonical_has_1x2: canonicalHas1x2,
    canonical_has_ou: canonicalHasOu,
    canonical_has_ah: canonicalHasAh,
    canonical_has_btts: canonicalHasBtts,
  };
}

function resolveMatchOddsForPipeline(
  input: Parameters<typeof resolveMatchOdds>[0],
  deps?: Parameters<typeof resolveMatchOdds>[1],
): ReturnType<typeof resolveMatchOdds> {
  return resolveMatchOdds(input, {
    ...deps,
    summarizeCoverageFlags: deriveProviderOddsCoverageFlagsForPipeline,
  });
}

const defaultPipelineDeps = {
  fetchFixtureStatistics,
  fetchFixtureEvents,
  ensureMatchInsight,
  ensureScoutInsight,
  resolveMatchOdds: resolveMatchOddsForPipeline,
  getRecommendationsByMatchId,
  getLatestSnapshot,
  createSnapshot,
  callGemini,
  createRecommendation,
  markRecommendationNotified,
  createAiPerformanceRecord,
  getHistoricalPerformanceContext,
  lookupPerformanceMemory,
  getPerformanceMemoryPromptContext,
  autoGeneratePerformanceMemoryRules,
  sendTelegramMessage,
  sendTelegramPhoto,
  getLeagueProfileByLeagueId,
  getTeamProfileByTeamId,
  getLeagueById,
  getNotificationChannelAddressesByUserIds,
  filterUserIdsAllowingWebPushNotifications,
  getEligibleTelegramDeliveryTargets,
  getEligibleDeliveryUserIds,
  markRecommendationDeliveriesDelivered,
  stageAnalysisSignalDeliveries,
  enqueueStatsOnlyLiveSignalDeliveries,
};

type PipelineDeps = typeof defaultPipelineDeps;

const HISTORICAL_PROMPT_CONTEXT_TTL_MS = 10 * 60 * 1000;
let historicalPromptContextCache: {
  data: HistoricalPerformanceContext;
  expiresAt: number;
} | null = null;
const PERFORMANCE_MEMORY_PROMPT_CONTEXT_TTL_MS = 60 * 1000;
const PERFORMANCE_MEMORY_AUTO_RULES_TTL_MS = 5 * 60 * 1000;
const performanceMemoryPromptContextCache = new Map<string, {
  data: PerformanceMemoryRecord[];
  expiresAt: number;
}>();
let performanceMemoryAutoRulesCache: {
  data: PerformanceMemoryCandidateRule[];
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

async function loadPerformanceMemoryPromptContext(
  deps: Pick<PipelineDeps, 'getPerformanceMemoryPromptContext'>,
  args: { minuteBand: string; scoreState: string; limit: number },
): Promise<PerformanceMemoryRecord[]> {
  const cacheKey = `${args.minuteBand}|${args.scoreState}|${args.limit}`;
  const now = Date.now();
  const cached = performanceMemoryPromptContextCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;
  try {
    const data = await deps.getPerformanceMemoryPromptContext({
      minuteBand: args.minuteBand as Parameters<PipelineDeps['getPerformanceMemoryPromptContext']>[0]['minuteBand'],
      scoreState: args.scoreState as Parameters<PipelineDeps['getPerformanceMemoryPromptContext']>[0]['scoreState'],
      limit: args.limit,
    });
    performanceMemoryPromptContextCache.set(cacheKey, {
      data,
      expiresAt: now + PERFORMANCE_MEMORY_PROMPT_CONTEXT_TTL_MS,
    });
    return data;
  } catch {
    return [];
  }
}

async function loadPerformanceMemoryAutoRules(
  deps: Pick<PipelineDeps, 'autoGeneratePerformanceMemoryRules'>,
  args: { minSamples: number; maxWinRate: number },
): Promise<PerformanceMemoryCandidateRule[]> {
  const now = Date.now();
  if (performanceMemoryAutoRulesCache && performanceMemoryAutoRulesCache.expiresAt > now) {
    return performanceMemoryAutoRulesCache.data;
  }
  try {
    const data = await deps.autoGeneratePerformanceMemoryRules({
      minSamples: args.minSamples,
      maxWinRate: args.maxWinRate,
    });
    performanceMemoryAutoRulesCache = {
      data,
      expiresAt: now + PERFORMANCE_MEMORY_AUTO_RULES_TTL_MS,
    };
    return data;
  } catch {
    return [];
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
  /** Replay/diagnostic only: mask derived league/team profile priors before prompt construction. */
  prematchProfileMode?: 'full' | 'none' | 'league-only' | 'team-only';
  /** Manual/advisory pre-match only: fetch and persist missing strategic context before building the prompt. */
  ensureStrategicContext?: boolean;
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
/** Single quoted goals O/U ladder rung. */
export type OddsOuRung = { line: number; over: number | null; under: number | null };

interface OddsCanonical {
  '1x2'?: { home: number | null; draw: number | null; away: number | null };
  ou?: { line: number; over: number | null; under: number | null };
  /** Second goals O/U line nearest to main (tighter ladder); optional context for LLM. */
  ou_adjacent?: { line: number; over: number | null; under: number | null };
  /** Additional FT goals O/U rungs (beyond main+adjacent), sorted by distance from main - up to 2. */
  ou_extra?: OddsOuRung[];
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
  /** Additional H1 goals O/U rungs (beyond main+adjacent), up to 2. */
  ht_ou_extra?: OddsOuRung[];
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
type EvidenceMode = LiveAnalysisEvidenceMode;

type ProviderStatsCoverage = 'complete' | 'partial' | 'empty' | 'missing';
type ProviderClockLagStatus = 'ok' | 'warning' | 'degraded' | 'critical' | 'unknown';
type ProviderCoverageStatus = 'full' | 'no_live_stats' | 'clock_lag' | 'clock_lag_no_live_stats' | 'provider_unavailable';

interface ProviderHealthSnapshot {
  provider: 'api-football';
  statisticsCoverage: ProviderStatsCoverage;
  providerReturnedNoLiveStatistics: boolean;
  providerClockLagMinutes: number | null;
  providerClockLagStatus: ProviderClockLagStatus;
  providerReportedMinute: number | null;
  wallClockMinute: number | null;
  fixtureFreshness: string;
  statisticsFreshness: string;
  eventsFreshness: string;
  coverageStatus: ProviderCoverageStatus;
  warnings: string[];
}

type LlmDecisionDiagnostic =
  | 'no_bet_intentional'
  | 'market_parse_failed'
  | 'market_not_available_in_odds'
  | 'policy_blocked'
  | 'actionable';

type MarketResolutionStatus =
  | 'not_requested'
  | 'resolved'
  | 'missing_market'
  | 'missing_selection'
  | 'odds_unavailable';

interface ParsedAiShadowCandidate {
  selection: string;
  bet_market: string;
  confidence: number;
  value_percent: number;
  risk_level: string;
  stake_percent: number;
  reason_code: string;
  reason_en: string;
  reason_vi: string;
  mapped_odd: number | null;
  canonical_market: string;
  market_resolution_status: MarketResolutionStatus;
}

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
  llm_decision_diagnostic: LlmDecisionDiagnostic;
  market_resolution_status: MarketResolutionStatus;
  shadow_candidate: ParsedAiShadowCandidate;
}

function isNoBetConditionSuggestion(value: string): boolean {
  return /^no bet\b/i.test(String(value || '').trim());
}

const PARSE_BLOCKING_WARNING_CODES = new Set([
  'NO_SELECTION',
  'NO_BET_MARKET',
  'CONFIDENCE_BELOW_MIN',
  'HIGH_RISK',
  'EDGE_BELOW_MIN',
  'MARKET_NOT_ALLOWED_FOR_EVIDENCE',
  '1X2_TOO_EARLY',
]);

function applyLinePatienceToParsed(args: {
  parsed: ParsedAiResponse;
  oddsCanonical: OddsCanonical;
  minute: number;
  score: string;
  evidenceMode: EvidenceMode;
  eventsCompact?: EventCompact[];
  pipelineSettings: PipelineSettings;
}): { parsed: ParsedAiResponse; linePatienceBlocked: boolean } {
  if (!isLinePatienceEnabled()) {
    return { parsed: args.parsed, linePatienceBlocked: false };
  }

  const hasActionableAi =
    args.parsed.ai_should_push
    || args.parsed.system_should_bet
    || (String(args.parsed.selection || '').trim() && String(args.parsed.bet_market || '').trim());
  if (!hasActionableAi) {
    return { parsed: args.parsed, linePatienceBlocked: false };
  }

  const llp = applyLinePatiencePolicy({
    selection: args.parsed.selection,
    betMarket: args.parsed.bet_market,
    minute: args.minute,
    score: args.score,
    confidence: args.parsed.confidence,
    valuePercent: args.parsed.value_percent,
    evidenceMode: args.evidenceMode,
    oddsCanonical: args.oddsCanonical,
    eventsCompact: args.eventsCompact,
    enabled: true,
    config: getLinePatienceConfig(),
  });

  const mergedWarnings = [...args.parsed.warnings, ...llp.warnings];
  const mergedAiWarnings = [...args.parsed.ai_warnings, ...llp.warnings];

  if (llp.blocked) {
    return {
      linePatienceBlocked: true,
      parsed: {
        ...args.parsed,
        system_should_bet: false,
        final_should_bet: false,
        warnings: mergedWarnings,
        ai_warnings: mergedAiWarnings,
      },
    };
  }

  const MIN_ODDS = args.pipelineSettings.minOdds ?? config.pipelineMinOdds;
  const mappedOdd = extractOddsFromSelection(llp.selection, llp.betMarket, args.oddsCanonical);
  const hasBlocking = mergedAiWarnings.some((w) => PARSE_BLOCKING_WARNING_CODES.has(w));
  const systemShouldBet = args.parsed.ai_should_push && !hasBlocking;
  const usableOdd = mappedOdd !== null && mappedOdd >= MIN_ODDS ? mappedOdd : null;
  const finalShouldBet = systemShouldBet && usableOdd !== null;
  const oddsForDisplay = usableOdd ?? mappedOdd ?? (args.parsed.ai_should_push ? 'N/A' : null);

  return {
    linePatienceBlocked: false,
    parsed: {
      ...args.parsed,
      selection: llp.selection,
      bet_market: llp.betMarket,
      system_should_bet: systemShouldBet,
      final_should_bet: finalShouldBet,
      usable_odd: usableOdd,
      mapped_odd: mappedOdd,
      odds_for_display: oddsForDisplay,
      warnings: mergedWarnings,
      ai_warnings: mergedAiWarnings,
    },
  };
}

interface RecommendationSaveIntegrityResult {
  ok: boolean;
  providerCoverageStatus: 'ok' | 'provider_line_unavailable_or_stale' | 'missing_market_or_selection';
  marketResolutionStatus: ParsedAiResponse['market_resolution_status'];
  mappedOdd: number | null;
  reason: string;
}

export function evaluateRecommendationSaveIntegrity(args: {
  selection: string;
  betMarket: string;
  mappedOdd: number | null;
  minOdds: number;
}): RecommendationSaveIntegrityResult {
  const hasSelection = !!String(args.selection || '').trim();
  const hasMarket = !!String(args.betMarket || '').trim();
  if (!hasSelection || !hasMarket) {
    return {
      ok: false,
      providerCoverageStatus: 'missing_market_or_selection',
      marketResolutionStatus: hasSelection ? 'missing_market' : 'missing_selection',
      mappedOdd: args.mappedOdd,
      reason: 'missing_market_or_selection',
    };
  }
  if (args.mappedOdd == null) {
    return {
      ok: false,
      providerCoverageStatus: 'provider_line_unavailable_or_stale',
      marketResolutionStatus: 'odds_unavailable',
      mappedOdd: null,
      reason: 'provider_line_unavailable_or_stale',
    };
  }
  if (args.mappedOdd < args.minOdds) {
    return {
      ok: false,
      providerCoverageStatus: 'provider_line_unavailable_or_stale',
      marketResolutionStatus: 'odds_unavailable',
      mappedOdd: args.mappedOdd,
      reason: 'odds_below_minimum_at_save',
    };
  }
  return {
    ok: true,
    providerCoverageStatus: 'ok',
    marketResolutionStatus: 'resolved',
    mappedOdd: args.mappedOdd,
    reason: 'ok',
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
  outputKind?: LiveOutputKind;
  auditBucket?: string;
  error?: string;
  debug?: {
    analysisRunId?: string;
    shadowMode: boolean;
    advisoryOnly?: boolean;
    skippedAt?: 'proceed' | 'staleness' | 'llm_eligibility';
    skipReason?: string;
    analysisMode?: PromptAnalysisMode;
    oddsSource?: string;
    oddsAvailable?: boolean;
    statsAvailable?: boolean;
    statsSource?: StatsSource;
    evidenceMode?: EvidenceMode;
    providerHealth?: ProviderHealthSnapshot;
    providerWarnings?: string[];
    providerCoverageStatus?: ProviderCoverageStatus;
    providerReturnedNoLiveStatistics?: boolean;
    providerClockLagMinutes?: number | null;
    providerClockLagStatus?: ProviderClockLagStatus;
    outputDecision?: LiveOutputDecisionContext;
    outputKind?: LiveOutputKind;
    auditBucket?: string;
    savedRecommendation?: boolean;
    settlementEligible?: boolean;
    roiEligible?: boolean;
    llmCalled?: boolean;
    llmDecisionDiagnostic?: ParsedAiResponse['llm_decision_diagnostic'];
    marketResolutionStatus?: ParsedAiResponse['market_resolution_status'];
    runtimePolicyShadow?: RuntimePolicyShadowSignal;
    runtimePolicyPromotion?: RuntimePolicyProductionPromotionDecision;
    shadowCandidate?: Record<string, unknown>;
    saveIntegrityStatus?: 'not_attempted' | 'ok' | 'blocked';
    saveBlockedReason?: string;
    saveProviderCoverageStatus?: RecommendationSaveIntegrityResult['providerCoverageStatus'];
    statsFallbackUsed?: boolean;
    statsFallbackReason?: string;
    promptVersion?: string;
    promptDataLevel?: PromptStatsDetailLevel;
    prematchAvailability?: PrematchFeatureAvailability;
    prematchNoisePenalty?: number | null;
    prematchStrength?: PrematchPriorStrength;
    strategicContextOnDemandAttempted?: boolean;
    strategicContextOnDemandApplied?: boolean;
    strategicContextOnDemandError?: string;
    structuredPrematchAskAi?: boolean;
    structuredPrematchAskAiReason?: string;
    promptChars?: number;
    promptEstimatedTokens?: number;
    aiTextChars?: number;
    aiTextEstimatedTokens?: number;
    llmLatencyMs?: number;
    statsOnlySignal?: Record<string, unknown>;
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

function buildPrematchDecisionSummary(args: {
  strategicContext: Record<string, unknown> | null;
  prematchExpertFeatures: PrematchExpertFeaturesV1 | null;
  prematchAvailability?: PrematchFeatureAvailability;
  prematchStrength?: PrematchPriorStrength;
  prematchNoisePenalty: number | null;
  leagueProfileWindow: { sampleMatches: number | null; eventCoverage: number | null; topLeagueOnly: boolean | null };
  homeTeamProfileWindow: { sampleMatches: number | null; eventCoverage: number | null; topLeagueOnly: boolean | null };
  awayTeamProfileWindow: { sampleMatches: number | null; eventCoverage: number | null; topLeagueOnly: boolean | null };
}): string {
  const strategicMeta = asObjectRecord(args.strategicContext?._meta) ?? asObjectRecord(args.strategicContext?.source_meta);
  const strategicQuant = asObjectRecord(args.strategicContext?.quantitative);
  const features = args.prematchExpertFeatures;

  const summary = {
    version: 1,
    availability: args.prematchAvailability ?? 'none',
    strength: args.prematchStrength ?? 'none',
    noisePenalty: args.prematchNoisePenalty,
    strategicContextPresent: !!args.strategicContext,
    strategicTrustedSourceCount: features?.meta.trusted_source_count ?? null,
    strategicRejectedSourceCount: features?.meta.rejected_source_count ?? null,
    strategicRefreshStatus: strategicMeta?.refresh_status ?? null,
    competitionType: features?.meta.competition_type ?? null,
    sourceQuality: features?.meta.source_quality ?? null,
    topLeague: features?.meta.top_league ?? null,
    quantitativeFieldCount: strategicQuant ? Object.keys(strategicQuant).length : 0,
    coverage: {
      league: args.leagueProfileWindow,
      homeTeam: args.homeTeamProfileWindow,
      awayTeam: args.awayTeamProfileWindow,
    },
    featureSnapshot: features
      ? {
          strengthDelta: features.strength_delta,
          goalEnvironment: features.goal_environment,
          marketPriors: features.market_priors,
          trustAndCoverage: features.trust_and_coverage,
        }
      : null,
  };

  return JSON.stringify(summary);
}

function deriveEvidenceMode(
  statsAvailable: boolean,
  oddsAvailable: boolean,
  eventsCompact: EventCompact[],
): EvidenceMode {
  return classifyLiveEvidence({
    statsAvailable,
    oddsAvailable,
    eventCount: eventsCompact.length,
  }).evidenceMode;
}

function classifyProviderStatisticsCoverage(args: {
  statsRaw: ApiFixtureStat[];
  statsAvailable: boolean;
  freshness: string;
  cacheStatus: string;
}): ProviderStatsCoverage {
  if (args.statsAvailable) return args.statsRaw.length >= 2 ? 'complete' : 'partial';
  if (Array.isArray(args.statsRaw) && args.statsRaw.length === 0 && args.cacheStatus !== 'miss') return 'empty';
  if (args.freshness === 'fresh' && Array.isArray(args.statsRaw) && args.statsRaw.length === 0) return 'empty';
  return 'missing';
}

function buildProviderHealthSnapshot(args: {
  fixture: ApiFixture;
  status: string;
  minute: number;
  statsRaw: ApiFixtureStat[];
  statsAvailable: boolean;
  fixtureFreshness: string;
  statisticsFreshness: string;
  statisticsCacheStatus: string;
  eventsFreshness: string;
}): ProviderHealthSnapshot {
  void args.fixture;
  void args.status;
  void args.minute;
  // Do not infer live-clock delay from wall-clock time. API-Football period
  // timestamps are not an independent broadcast clock, and normal stoppage time
  // or provider cadence created false "provider is delayed" reasoning.
  const clock: Pick<ProviderHealthSnapshot, 'providerClockLagMinutes' | 'providerClockLagStatus' | 'providerReportedMinute' | 'wallClockMinute'> = {
    providerClockLagMinutes: null,
    providerClockLagStatus: 'unknown',
    providerReportedMinute: Number.isFinite(args.minute) ? args.minute : null,
    wallClockMinute: null,
  };
  const statisticsCoverage = classifyProviderStatisticsCoverage({
    statsRaw: args.statsRaw,
    statsAvailable: args.statsAvailable,
    freshness: args.statisticsFreshness,
    cacheStatus: args.statisticsCacheStatus,
  });
  const providerReturnedNoLiveStatistics = statisticsCoverage === 'empty';
  const warnings: string[] = [];
  if (providerReturnedNoLiveStatistics) warnings.push('provider_returned_no_live_statistics');
  if (clock.providerClockLagStatus === 'warning') warnings.push('provider_clock_lag');
  if (clock.providerClockLagStatus === 'degraded') warnings.push('provider_clock_lag_high');
  if (clock.providerClockLagStatus === 'critical') warnings.push('provider_clock_lag_critical');

  let coverageStatus: ProviderCoverageStatus = 'full';
  if (providerReturnedNoLiveStatistics && clock.providerClockLagStatus !== 'ok' && clock.providerClockLagStatus !== 'unknown') {
    coverageStatus = 'clock_lag_no_live_stats';
  } else if (providerReturnedNoLiveStatistics) {
    coverageStatus = 'no_live_stats';
  } else if (clock.providerClockLagStatus !== 'ok' && clock.providerClockLagStatus !== 'unknown') {
    coverageStatus = 'clock_lag';
  } else if (args.fixtureFreshness === 'missing') {
    coverageStatus = 'provider_unavailable';
  }

  return {
    provider: 'api-football',
    statisticsCoverage,
    providerReturnedNoLiveStatistics,
    providerClockLagMinutes: clock.providerClockLagMinutes,
    providerClockLagStatus: clock.providerClockLagStatus,
    providerReportedMinute: clock.providerReportedMinute,
    wallClockMinute: clock.wallClockMinute,
    fixtureFreshness: args.fixtureFreshness,
    statisticsFreshness: args.statisticsFreshness,
    eventsFreshness: args.eventsFreshness,
    coverageStatus,
    warnings,
  };
}

function canRunStructuredPrematchAskAi(args: {
  analysisMode: PromptAnalysisMode;
  status: string;
  prematchExpertFeatures: PrematchExpertFeaturesV1 | null;
}): {
  eligible: boolean;
  reason:
    | 'manual_force_required'
    | 'not_started_only'
    | 'prematch_features_missing'
    | 'top_league_required'
    | 'prematch_availability_too_thin'
    | 'profile_coverage_too_thin'
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
  const sourceQuality = features.meta.source_quality;
  const hasStrongProfileCoverage = teamCoverage >= 16 && leagueCoverage >= 6;
  const hasBalancedStructuredCoverage = (
    teamCoverage >= 8
    || leagueCoverage >= 8
    || (leagueCoverage >= 3 && strategicCoverage >= 2 && (sourceQuality === 'high' || sourceQuality === 'medium'))
  );

  if (!(hasStrongProfileCoverage || hasBalancedStructuredCoverage)) {
    return { eligible: false, reason: 'profile_coverage_too_thin' };
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
  /** Set when promote path is ready; marked promoted only after recommendation save succeeds. */
  thesisWatchId?: number;
  thesisWatchPromotion?: {
    promoteSnapshot: ThesisWatchAuditSnapshot;
    promoteReason: ThesisWatchPromoteReason;
  };
}

interface PromptPolicyContext {
  previousRecommendations: RecommendationPolicyPreviousRow[];
}

interface PromptExecutionContext {
  matchId: string;
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
  providerHealth?: ProviderHealthSnapshot;
  providerWarnings?: string[];
  providerClockLagMinutes?: number | null;
  providerReturnedNoLiveStatistics?: boolean;
  providerCoverageStatus?: ProviderCoverageStatus;
  eventsCompact: EventCompact[];
  oddsCanonical: OddsCanonical;
  oddsAvailable: boolean;
  oddsSource: string;
  oddsFetchedAt: string | null;
  referenceOddsCanonical?: OddsCanonical;
  referenceOddsSource?: string;
  referenceOddsFetchedAt?: string | null;
  oddsSanityWarnings: string[];
  oddsSuspicious: boolean;
  derivedInsights: DerivedInsights | null;
  watchlistSubscriberCount: number;
  activeWatchInterest: boolean;
  strategicContext: Record<string, unknown> | null;
  leagueProfile: Record<string, unknown> | null;
  homeTeamProfile: Record<string, unknown> | null;
  awayTeamProfile: Record<string, unknown> | null;
  prematchExpertFeatures: PrematchExpertFeaturesV1 | null;
  structuredPrematchAskAi: boolean;
  analysisMode: PromptAnalysisMode;
  forceAnalyze: boolean;
  isManualPush: boolean;
  currentTotalGoals: number;
  previousRecommendations: Array<Record<string, unknown>>;
  historicalPerformance: HistoricalPerformanceContext | null;
  performanceMemory: {
    minuteBand: string;
    scoreState: string;
    records: PerformanceMemoryRecord[];
    autoRules: PerformanceMemoryCandidateRule[];
  } | null;
  preMatchContextSummary: string;
  statsFallbackReason: string;
  userQuestion?: string;
  followUpHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
  lineupsSnapshot?: {
    available: boolean;
    teams: Array<{
      side: 'home' | 'away';
      teamName: string;
      formation: string | null;
      confirmedStarters: string[];
      benchCount: number;
    }>;
  } | null;
  settledReplayApprovedTrace?: boolean;
  settledReplayOriginalBetMarket?: string;
  settledReplayOriginalSelection?: string;
  skipRecommendationPolicy?: boolean;
}

interface LlmEligibilityResult {
  eligible: boolean;
  reason: string;
  details: Record<string, unknown>;
}

interface TradableMarketSummary {
  count: number;
  families: string[];
}

const autoLlmCooldowns = new Map<string, { expiresAt: number; reason: string }>();
const AUTO_LLM_COOLDOWN_REDIS_PREFIX = 'pipeline:auto-llm-cooldown:';

export function __resetPipelineLlmCooldownsForTest(): void {
  autoLlmCooldowns.clear();
}

function hasActiveWatchInterest(entry: watchlistRepo.WatchlistRow): boolean {
  return Number(entry.subscriber_count ?? 0) > 0;
}

function isAutoPipelineLlmContext(args: {
  promptContext: PromptExecutionContext;
  shadowMode: boolean;
  advisoryOnly: boolean;
  settledReplayApprovedTrace: boolean;
}): boolean {
  return !args.settledReplayApprovedTrace
    && !args.shadowMode
    && !args.advisoryOnly
    && args.promptContext.analysisMode === 'auto'
    && !args.promptContext.forceAnalyze;
}

function buildAutoLlmCooldownKey(promptContext: PromptExecutionContext): string {
  return [
    promptContext.matchId,
    String(promptContext.status || '').trim().toUpperCase(),
    promptContext.score,
    promptContext.evidenceMode,
  ].join('|');
}

function buildAutoLlmCooldownRedisKey(promptContext: PromptExecutionContext): string {
  return `${AUTO_LLM_COOLDOWN_REDIS_PREFIX}${buildAutoLlmCooldownKey(promptContext)
    .split('|')
    .map((part) => encodeURIComponent(part))
    .join(':')}`;
}

function countOddsAboveMin(values: Array<number | null | undefined>, minOdds: number): number {
  return values.filter((value) => Number.isFinite(value) && Number(value) >= minOdds).length;
}

function summarizeTradableMarkets(oddsCanonical: OddsCanonical, minOdds: number): TradableMarketSummary {
  const families = new Set<string>();
  let count = 0;
  const add = (family: string, values: Array<number | null | undefined>) => {
    const hits = countOddsAboveMin(values, minOdds);
    if (hits <= 0) return;
    families.add(family);
    count += hits;
  };

  add('goals_ou', [oddsCanonical.ou?.over, oddsCanonical.ou?.under]);
  add('goals_ou_adjacent', [oddsCanonical.ou_adjacent?.over, oddsCanonical.ou_adjacent?.under]);
  for (const rung of oddsCanonical.ou_extra ?? []) {
    add('goals_ou_extra', [rung.over, rung.under]);
  }
  add('asian_handicap', [oddsCanonical.ah?.home, oddsCanonical.ah?.away]);
  add('asian_handicap_adjacent', [oddsCanonical.ah_adjacent?.home, oddsCanonical.ah_adjacent?.away]);
  for (const rung of oddsCanonical.ah_extra ?? []) {
    add('asian_handicap_extra', [rung.home, rung.away]);
  }
  add('btts', [oddsCanonical.btts?.yes, oddsCanonical.btts?.no]);
  add('1x2', [oddsCanonical['1x2']?.home, oddsCanonical['1x2']?.away]);
  add('corners_ou', [oddsCanonical.corners_ou?.over, oddsCanonical.corners_ou?.under]);
  add('ht_goals_ou', [oddsCanonical.ht_ou?.over, oddsCanonical.ht_ou?.under]);
  add('ht_goals_ou_adjacent', [oddsCanonical.ht_ou_adjacent?.over, oddsCanonical.ht_ou_adjacent?.under]);
  for (const rung of oddsCanonical.ht_ou_extra ?? []) {
    add('ht_goals_ou_extra', [rung.over, rung.under]);
  }
  add('ht_asian_handicap', [oddsCanonical.ht_ah?.home, oddsCanonical.ht_ah?.away]);
  add('ht_asian_handicap_adjacent', [oddsCanonical.ht_ah_adjacent?.home, oddsCanonical.ht_ah_adjacent?.away]);
  for (const rung of oddsCanonical.ht_ah_extra ?? []) {
    add('ht_asian_handicap_extra', [rung.home, rung.away]);
  }
  add('ht_btts', [oddsCanonical.ht_btts?.yes, oddsCanonical.ht_btts?.no]);
  add('ht_1x2', [oddsCanonical.ht_1x2?.home, oddsCanonical.ht_1x2?.away]);

  return { count, families: Array.from(families).sort() };
}

function buildLlmGatewayAuditMetadata(args: {
  promptContext: PromptExecutionContext;
  settings: PipelineSettings;
  promptVersion?: LiveAnalysisPromptVersion;
  model?: string;
}): Record<string, unknown> {
  const { promptContext, settings } = args;
  const tradableMarkets = summarizeTradableMarkets(promptContext.oddsCanonical, settings.minOdds);

  return {
    gatewayContractVersion: 'ai-gateway-preflight-v1',
    matchId: promptContext.matchId,
    fixtureStatus: promptContext.status,
    minute: promptContext.minute,
    score: promptContext.score,
    analysisMode: promptContext.analysisMode,
    forceAnalyze: promptContext.forceAnalyze,
    evidenceMode: promptContext.evidenceMode,
    statsAvailable: promptContext.statsAvailable,
    oddsAvailable: promptContext.oddsAvailable,
    oddsSource: promptContext.oddsSource,
    oddsFetchedAt: promptContext.oddsFetchedAt,
    referenceOddsSource: promptContext.referenceOddsSource ?? 'none',
    referenceCanonicalMarketKeys: Object.keys(promptContext.referenceOddsCanonical ?? {}).sort(),
    oddsSuspicious: promptContext.oddsSuspicious,
    oddsSanityWarningCount: promptContext.oddsSanityWarnings.length,
    providerHealth: promptContext.providerHealth,
    providerWarnings: promptContext.providerWarnings ?? [],
    providerCoverageStatus: promptContext.providerCoverageStatus,
    providerReturnedNoLiveStatistics: promptContext.providerReturnedNoLiveStatistics,
    providerClockLagMinutes: promptContext.providerClockLagMinutes,
    minOdds: settings.minOdds,
    canonicalMarketKeys: Object.keys(promptContext.oddsCanonical).sort(),
    canonicalTradableMarketCount: tradableMarkets.count,
    canonicalTradableFamilies: tradableMarkets.families,
    activeWatchInterest: promptContext.activeWatchInterest,
    watchlistSubscriberCount: promptContext.watchlistSubscriberCount,
    structuredPrematchAskAi: promptContext.structuredPrematchAskAi,
    promptVersion: args.promptVersion,
    model: args.model,
  };
}

function readMemoryAutoLlmCooldown(promptContext: PromptExecutionContext): { reason: string; expiresAt: number } | null {
  const key = buildAutoLlmCooldownKey(promptContext);
  const existing = autoLlmCooldowns.get(key);
  if (!existing) return null;
  if (existing.expiresAt <= Date.now()) {
    autoLlmCooldowns.delete(key);
    return null;
  }
  return existing;
}

async function readAutoLlmCooldown(promptContext: PromptExecutionContext): Promise<{ reason: string; expiresAt: number; source: 'redis' | 'memory' } | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(buildAutoLlmCooldownRedisKey(promptContext));
    if (raw) {
      const parsed = JSON.parse(raw) as { reason?: unknown; expiresAt?: unknown };
      const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason
        : 'cooldown';
      const expiresAt = Number(parsed.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        autoLlmCooldowns.set(buildAutoLlmCooldownKey(promptContext), { reason, expiresAt });
        return { reason, expiresAt, source: 'redis' };
      }
    }
    return null;
  } catch {
    const fallback = readMemoryAutoLlmCooldown(promptContext);
    return fallback ? { ...fallback, source: 'memory' } : null;
  }
}

async function writeAutoLlmCooldown(args: {
  promptContext: PromptExecutionContext;
  settings: PipelineSettings;
  reason: string;
}): Promise<void> {
  const baseMinutes = Number.isFinite(args.settings.reanalyzeMinMinutes)
    ? args.settings.reanalyzeMinMinutes
    : config.pipelineReanalyzeMinMinutes;
  const cooldownMinutes = Math.max(5, Math.min(15, Number(baseMinutes) || 10));
  const ttlMs = cooldownMinutes * 60_000;
  const expiresAt = Date.now() + ttlMs;
  const payload = { reason: args.reason, expiresAt };
  autoLlmCooldowns.set(buildAutoLlmCooldownKey(args.promptContext), payload);
  try {
    await getRedisClient().set(
      buildAutoLlmCooldownRedisKey(args.promptContext),
      JSON.stringify(payload),
      'PX',
      ttlMs + 5_000,
    );
  } catch {
    // Memory fallback above keeps single-process protection when Redis is unavailable.
  }
}

async function resolveLlmEligibility(args: {
  promptContext: PromptExecutionContext;
  watchlistEntry: watchlistRepo.WatchlistRow;
  settings: PipelineSettings;
  shadowMode: boolean;
  advisoryOnly: boolean;
  settledReplayApprovedTrace: boolean;
}): Promise<LlmEligibilityResult> {
  const { promptContext, watchlistEntry, settings } = args;
  if (args.settledReplayApprovedTrace) {
    return { eligible: true, reason: 'settled_replay', details: {} };
  }
  if (args.shadowMode) {
    return { eligible: true, reason: 'manual_or_shadow_flow', details: {} };
  }
  if (promptContext.analysisMode !== 'auto' || args.advisoryOnly || promptContext.forceAnalyze) {
    return { eligible: true, reason: 'manual_flow', details: {} };
  }

  const status = String(promptContext.status || '').trim().toUpperCase();
  const minute = Number.isFinite(promptContext.minute) ? promptContext.minute : 0;
  const configuredLiveStatuses = Array.isArray(config.liveStatuses) && config.liveStatuses.length > 0
    ? config.liveStatuses
    : ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'];
  const liveStatusAllowed = configuredLiveStatuses.map((value) => value.toUpperCase()).includes(status);
  const subscriberCount = Number(watchlistEntry.subscriber_count ?? 0);

  if (!hasActiveWatchInterest(watchlistEntry)) {
    return {
      eligible: false,
      reason: 'no_active_watch_subscription',
      details: { subscriberCount },
    };
  }
  if (!liveStatusAllowed) {
    return {
      eligible: false,
      reason: 'match_not_live_for_auto_pipeline',
      details: { status },
    };
  }
  if (minute < settings.minMinute || minute > settings.maxMinute) {
    return {
      eligible: false,
      reason: 'minute_outside_auto_pipeline_window',
      details: { minute, minMinute: settings.minMinute, maxMinute: settings.maxMinute },
    };
  }
  if (promptContext.evidenceMode === 'low_evidence' && !promptContext.structuredPrematchAskAi) {
    return {
      eligible: false,
      reason: 'low_evidence',
      details: { evidenceMode: promptContext.evidenceMode },
    };
  }
  if (promptContext.evidenceMode !== 'full_live_data' && !promptContext.structuredPrematchAskAi) {
    return {
      eligible: false,
      reason: 'degraded_evidence',
      details: {
        evidenceMode: promptContext.evidenceMode,
        statsAvailable: promptContext.statsAvailable,
        oddsAvailable: promptContext.oddsAvailable,
        eventCount: promptContext.eventsCompact.length,
      },
    };
  }
  if (!promptContext.structuredPrematchAskAi) {
    const tradableMarkets = summarizeTradableMarkets(promptContext.oddsCanonical, settings.minOdds);
    if (tradableMarkets.count === 0) {
      return {
        eligible: false,
        reason: 'no_tradable_canonical_market',
        details: {
          minOdds: settings.minOdds,
          oddsAvailable: promptContext.oddsAvailable,
          availableMarketFamilies: tradableMarkets.families,
        },
      };
    }
  }
  const cooldown = await readAutoLlmCooldown(promptContext);
  if (cooldown) {
    return {
      eligible: false,
      reason: 'auto_llm_cooldown_active',
      details: {
        cooldownReason: cooldown.reason,
        cooldownExpiresAt: new Date(cooldown.expiresAt).toISOString(),
        cooldownSource: cooldown.source,
      },
    };
  }

  return {
    eligible: true,
    reason: 'eligible',
    details: { subscriberCount, status, minute, evidenceMode: promptContext.evidenceMode },
  };
}

type FollowUpHistoryEntry = { role: 'user' | 'assistant'; text: string };

function buildParsedFromThesisWatchRow(
  watch: ThesisWatchRow,
  oddsCanonical: OddsCanonical,
  settings: PipelineSettings,
): ParsedAiResponse {
  const mappedOdd = extractOddsFromSelection(watch.selection, watch.bet_market, oddsCanonical);
  const minOdds = settings.minOdds ?? config.pipelineMinOdds;
  const usableOdd = mappedOdd != null && mappedOdd >= minOdds ? mappedOdd : null;
  const hasActionable = !!String(watch.selection || '').trim() && !!String(watch.bet_market || '').trim();
  const systemShouldBet = hasActionable;
  const finalShouldBet = systemShouldBet && usableOdd != null;
  const promoteTag = '[THESIS_WATCH_PROMOTE]';
  return {
    decision_kind: finalShouldBet ? 'ai_push' : 'no_bet',
    should_push: finalShouldBet,
    ai_should_push: hasActionable,
    system_should_bet: systemShouldBet,
    final_should_bet: finalShouldBet,
    selection: watch.selection,
    bet_market: watch.bet_market,
    confidence: watch.confidence,
    reasoning_en: watch.reasoning_en ? `${watch.reasoning_en} ${promoteTag}` : promoteTag,
    reasoning_vi: watch.reasoning_vi ? `${watch.reasoning_vi} ${promoteTag}` : promoteTag,
    warnings: ['THESIS_WATCH_PROMOTED', watch.last_block_reason].filter(Boolean),
    value_percent: Number(watch.value_percent) || 0,
    risk_level: watch.risk_level || 'MEDIUM',
    stake_percent: Number(watch.stake_percent) || 0,
    condition_triggered_suggestion: '',
    custom_condition_matched: false,
    custom_condition_status: 'none',
    custom_condition_summary_en: '',
    custom_condition_summary_vi: '',
    custom_condition_reason_en: '',
    custom_condition_reason_vi: '',
    condition_triggered_reasoning_en: '',
    condition_triggered_reasoning_vi: '',
    condition_triggered_confidence: 0,
    condition_triggered_stake: 0,
    condition_triggered_special_override: false,
    condition_triggered_special_override_reason_en: '',
    condition_triggered_special_override_reason_vi: '',
    condition_triggered_should_push: false,
    follow_up_answer_en: '',
    follow_up_answer_vi: '',
    ai_selection: watch.selection,
    ai_confidence: watch.confidence,
    ai_odd_raw: mappedOdd,
    ai_warnings: ['THESIS_WATCH_PROMOTED'],
    usable_odd: usableOdd,
    mapped_odd: mappedOdd,
    odds_for_display: usableOdd ?? mappedOdd ?? (hasActionable ? 'N/A' : null),
    llm_decision_diagnostic: usableOdd != null ? 'actionable' : 'market_not_available_in_odds',
    market_resolution_status: usableOdd != null ? 'resolved' : 'odds_unavailable',
    shadow_candidate: emptyShadowCandidate('thesis_watch_promote'),
  };
}

async function finalizeParsedRecommendation(
  deps: Pick<PipelineDeps, 'lookupPerformanceMemory'>,
  args: {
    patienceParsed: ParsedAiResponse;
    linePatienceBlocked: boolean;
    promptContext: PromptExecutionContext;
    promptVersion: LiveAnalysisPromptVersion;
    policyContext: PromptPolicyContext;
  },
): Promise<{
  parsed: ParsedAiResponse;
  policyBlocked: boolean;
  policyWarnings: string[];
}> {
  const { patienceParsed, linePatienceBlocked, promptContext, promptVersion, policyContext } = args;
  const policyResult = applyRecommendationPolicy({
    selection: patienceParsed.selection,
    betMarket: patienceParsed.bet_market,
    minute: promptContext.minute,
    score: promptContext.score,
    odds: patienceParsed.mapped_odd,
    confidence: patienceParsed.confidence,
    valuePercent: patienceParsed.value_percent,
    stakePercent: patienceParsed.stake_percent,
    promptVersion,
    previousRecommendations: policyContext.previousRecommendations,
    statsCompact: promptContext.statsCompact,
    segmentBlocklist: getSegmentPolicyBlocklist(),
    segmentStakeCaps: getSegmentPolicyStakeCaps(),
    riskLevel: patienceParsed.risk_level,
    evidenceMode: promptContext.evidenceMode,
    breakEvenRate: patienceParsed.mapped_odd != null && patienceParsed.mapped_odd > 0 ? 1 / patienceParsed.mapped_odd : null,
    directionalWin: patienceParsed.ai_should_push,
  });
  const parsedCanonicalMarket = normalizeMarket(patienceParsed.selection ?? '', patienceParsed.bet_market ?? '');
  const memoryWarnings: string[] = [];
  let memoryOverrideBlocked = false;
  if (parsedCanonicalMarket && parsedCanonicalMarket !== 'unknown') {
    try {
      const memoryMinuteBand = deriveMinuteBand(promptContext.minute);
      const memoryScoreState = deriveScoreState(promptContext.score);
      const memory = await deps.lookupPerformanceMemory({
        canonicalMarket: parsedCanonicalMarket,
        minuteBand: memoryMinuteBand,
        scoreState: memoryScoreState,
      });
      if (memory.status === 'found' && memory.record) {
        const breakEvenRate = patienceParsed.mapped_odd != null && patienceParsed.mapped_odd > 0 ? (1 / patienceParsed.mapped_odd) : null;
        const winRate = memory.record.empiricalWinRate;
        if (memory.record.sampleReliable && winRate < 0.4) {
          memoryOverrideBlocked = true;
          memoryWarnings.push(`MEMORY_OVERRIDE_LOW_WIN_RATE_${Math.round(winRate * 100)}PCT`);
        } else if (memory.record.sampleReliable && winRate < 0.45) {
          if (breakEvenRate == null || breakEvenRate >= 0.46) {
            memoryOverrideBlocked = true;
            memoryWarnings.push('MEMORY_OVERRIDE_MARGINAL_WIN_RATE');
          }
        } else if (!memory.record.sampleReliable && winRate < 0.35) {
          memoryWarnings.push(`SMALL_SAMPLE_WARNING_${Math.round(winRate * 100)}PCT`);
        }
      } else {
        memoryWarnings.push('MEMORY_FLAG_NO_HISTORY');
      }
    } catch (err) {
      memoryWarnings.push('MEMORY_LOOKUP_UNAVAILABLE');
    }
  }
  const policyBlockedEffective = (
    linePatienceBlocked
    || policyResult.blocked
    || memoryOverrideBlocked
  ) && !promptContext.skipRecommendationPolicy;
  const finalShouldBet = patienceParsed.final_should_bet && !policyBlockedEffective;
  const shouldPush = finalShouldBet;
  const decisionKind = finalShouldBet ? 'ai_push' : 'no_bet';
  const parsed: ParsedAiResponse = {
    ...patienceParsed,
    should_push: shouldPush,
    ai_should_push: patienceParsed.ai_should_push,
    system_should_bet: patienceParsed.system_should_bet && !policyBlockedEffective,
    final_should_bet: finalShouldBet,
    decision_kind: decisionKind,
    confidence: policyResult.confidence,
    stake_percent: policyResult.stakePercent,
    ai_confidence: policyResult.confidence,
    condition_triggered_should_push: false,
    warnings: [
      ...patienceParsed.warnings,
      ...policyResult.warnings,
      ...memoryWarnings,
    ],
    ai_warnings: [
      ...patienceParsed.ai_warnings,
      ...policyResult.warnings,
      ...memoryWarnings,
    ],
    llm_decision_diagnostic: finalShouldBet
      ? 'actionable'
      : !patienceParsed.ai_should_push
        ? 'no_bet_intentional'
        : patienceParsed.market_resolution_status === 'missing_market' || patienceParsed.market_resolution_status === 'missing_selection'
          ? 'market_parse_failed'
          : patienceParsed.market_resolution_status === 'odds_unavailable'
            ? 'market_not_available_in_odds'
            : 'policy_blocked',
  };

  return {
    parsed,
    policyBlocked: linePatienceBlocked || policyResult.blocked || memoryOverrideBlocked,
    policyWarnings: [...policyResult.warnings, ...memoryWarnings],
  };
}

async function executeThesisWatchPromote(
  deps: Pick<PipelineDeps, 'lookupPerformanceMemory'>,
  matchId: string,
  settings: PipelineSettings,
  promptContext: PromptExecutionContext,
  promptVersion: LiveAnalysisPromptVersion,
  policyContext: PromptPolicyContext,
  pipelineOptions: { shadowMode?: boolean; advisoryOnly?: boolean },
): Promise<PromptExecutionArtifacts | null> {
  if (!isThesisWatchPipelineActive(pipelineOptions)) return null;

  const watches = await getPendingThesisWatchesByMatchId(matchId);
  if (watches.length === 0) return null;

  const startedAt = Date.now();
  for (const watch of watches) {
    if (!isThesisWatchGateSatisfied(watch.gate_type, watch.gate_payload, promptContext.oddsCanonical)) {
      continue;
    }

    const resolvedMarket = resolveThesisWatchPromoteMarket(watch, promptContext.oddsCanonical);
    const watchForPromote: ThesisWatchRow = {
      ...watch,
      selection: resolvedMarket.selection,
      bet_market: resolvedMarket.betMarket,
    };
    const parsedSeed = buildParsedFromThesisWatchRow(watchForPromote, promptContext.oddsCanonical, settings);
    const { parsed: patienceParsed, linePatienceBlocked } = applyLinePatienceToParsed({
      parsed: parsedSeed,
      oddsCanonical: promptContext.oddsCanonical,
      minute: promptContext.minute,
      score: promptContext.score,
      evidenceMode: promptContext.evidenceMode,
      eventsCompact: promptContext.eventsCompact,
      pipelineSettings: settings,
    });
    if (linePatienceBlocked) continue;

    const finalized = await finalizeParsedRecommendation(deps, {
      patienceParsed,
      linePatienceBlocked,
      promptContext,
      promptVersion,
      policyContext,
    });
    if (!finalized.parsed.final_should_bet) continue;

    const promoteSnapshot: ThesisWatchAuditSnapshot = {
      matchId,
      minute: promptContext.minute,
      score: promptContext.score,
      status: promptContext.status,
      evidenceMode: promptContext.evidenceMode,
      selection: finalized.parsed.selection,
      betMarket: finalized.parsed.bet_market,
      oddsCanonical: promptContext.oddsCanonical as Record<string, unknown>,
      statsCompact: promptContext.statsCompact as unknown as Record<string, unknown>,
      eventsCompact: promptContext.eventsCompact.slice(-8),
      warnings: finalized.parsed.warnings,
      confidence: finalized.parsed.confidence,
      valuePercent: finalized.parsed.value_percent,
      stakePercent: finalized.parsed.stake_percent,
      riskLevel: finalized.parsed.risk_level,
    };
    const promoteReason: ThesisWatchPromoteReason = {
      watchKey: watch.watch_key,
      gateType: watch.gate_type,
      gatePayload: watch.gate_payload,
      lastBlockReason: watch.last_block_reason,
      originalSelection: watch.selection,
      originalBetMarket: watch.bet_market,
      promotedSelection: finalized.parsed.selection,
      promotedBetMarket: finalized.parsed.bet_market,
      policyWarnings: finalized.policyWarnings,
    };
    const promoteNote = `{"source":"thesis_watch","watchId":${watch.id},"gateType":"${watch.gate_type}","watchKey":"${watch.watch_key}"}`;
    return {
      promptVersion,
      prompt: promoteNote,
      promptChars: promoteNote.length,
      promptEstimatedTokens: 0,
      aiText: promoteNote,
      aiTextChars: promoteNote.length,
      aiTextEstimatedTokens: 0,
      llmLatencyMs: 0,
      totalLatencyMs: Date.now() - startedAt,
      parsed: finalized.parsed,
      policyBlocked: finalized.policyBlocked,
      policyWarnings: finalized.policyWarnings,
      thesisWatchId: watch.id,
      thesisWatchPromotion: {
        promoteSnapshot,
        promoteReason,
      },
    };
  }

  return null;
}

function buildPromptFromExecutionContext(
  promptContext: PromptExecutionContext,
  settings: PipelineSettings,
  promptVersion: LiveAnalysisPromptVersion,
): string {
  return buildLiveAnalysisPrompt(
    {
      homeName: promptContext.homeName,
      awayName: promptContext.awayName,
      league: promptContext.league,
      minute: promptContext.minute,
      score: promptContext.score,
      status: promptContext.status,
      statsCompact: promptContext.statsCompact,
      statsAvailable: promptContext.statsAvailable,
      statsSource: promptContext.statsSource,
      evidenceMode: promptContext.evidenceMode,
      providerWarnings: promptContext.providerWarnings,
      providerClockLagMinutes: promptContext.providerClockLagMinutes,
      providerReturnedNoLiveStatistics: promptContext.providerReturnedNoLiveStatistics,
      providerCoverageStatus: promptContext.providerCoverageStatus,
      statsMeta: null,
      eventsCompact: promptContext.eventsCompact,
      oddsCanonical: promptContext.oddsCanonical as Record<string, unknown>,
      oddsAvailable: promptContext.oddsAvailable,
      oddsSource: promptContext.oddsSource,
      oddsFetchedAt: promptContext.oddsFetchedAt,
      referenceOddsCanonical: promptContext.referenceOddsCanonical as Record<string, unknown> | undefined,
      referenceOddsSource: promptContext.referenceOddsSource,
      referenceOddsFetchedAt: promptContext.referenceOddsFetchedAt,
      oddsSanityWarnings: promptContext.oddsSanityWarnings,
      oddsSuspicious: promptContext.oddsSuspicious,
      derivedInsights: promptContext.derivedInsights as Record<string, unknown> | null,
      strategicContext: promptContext.strategicContext,
      leagueProfile: promptContext.leagueProfile,
      homeTeamProfile: promptContext.homeTeamProfile,
      awayTeamProfile: promptContext.awayTeamProfile,
      prematchExpertFeatures: promptContext.prematchExpertFeatures,
      structuredPrematchAskAi: promptContext.structuredPrematchAskAi,
      analysisMode: promptContext.analysisMode,
      forceAnalyze: promptContext.forceAnalyze,
      isManualPush: promptContext.isManualPush,
      skippedFilters: [],
      originalWouldProceed: true,
      currentTotalGoals: promptContext.currentTotalGoals,
      previousRecommendations: promptContext.previousRecommendations,
      matchTimeline: [],
      historicalPerformance: promptContext.historicalPerformance,
      performanceMemory: promptContext.performanceMemory,
      preMatchContextSummary: promptContext.preMatchContextSummary,
      statsFallbackReason: promptContext.statsFallbackReason,
      userQuestion: promptContext.userQuestion,
      followUpHistory: promptContext.followUpHistory,
      lineupsSnapshot: promptContext.lineupsSnapshot ?? null,
      settledReplayApprovedTrace: promptContext.settledReplayApprovedTrace === true,
      settledReplayOriginalBetMarket: promptContext.settledReplayOriginalBetMarket,
      settledReplayOriginalSelection: promptContext.settledReplayOriginalSelection,
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

async function executePromptAnalysis(
  deps: Pick<PipelineDeps, 'callGemini' | 'lookupPerformanceMemory'>,
  model: string,
  settings: PipelineSettings,
  promptContext: PromptExecutionContext,
  promptVersion: LiveAnalysisPromptVersion,
  policyContext: PromptPolicyContext,
): Promise<PromptExecutionArtifacts> {
  const startedAt = Date.now();
  const prompt = buildPromptFromExecutionContext(promptContext, settings, promptVersion);
  const promptChars = prompt.length;
  const promptEstimatedTokens = estimateTokenCount(prompt);

  const llmStartedAt = Date.now();
  audit({
    category: 'PIPELINE',
    action: 'LLM_CALL_STARTED',
    outcome: 'SUCCESS',
    actor: promptContext.analysisMode === 'auto' ? 'auto-pipeline' : 'manual-ask-ai',
    metadata: {
      ...buildLlmGatewayAuditMetadata({ promptContext, settings, promptVersion, model }),
      status: promptContext.status,
      promptChars,
      promptEstimatedTokens,
    },
  });
  let aiText: string;
  try {
    aiText = await deps.callGemini(prompt, model, {
      operation: promptContext.analysisMode === 'auto'
        ? 'tfi.live_recommendation'
        : promptContext.userQuestion
          ? 'tfi.ask_ai_follow_up'
          : 'tfi.manual_match_analysis',
      featureKey: promptContext.analysisMode === 'auto'
        ? 'tfi.live_recommendation'
        : 'tfi.ai_observation',
      matchId: promptContext.matchId,
      runId: promptContext.settledReplayApprovedTrace ? 'settled-replay' : undefined,
      promptVersion,
      metadata: {
        analysisMode: promptContext.analysisMode,
        evidenceMode: promptContext.evidenceMode,
        status: promptContext.status,
        minute: promptContext.minute,
        forceAnalyze: promptContext.forceAnalyze,
        oddsAvailable: promptContext.oddsAvailable,
        statsAvailable: promptContext.statsAvailable,
        structuredPrematchAskAi: promptContext.structuredPrematchAskAi,
      },
    });
  } catch (err) {
    const llmLatencyMs = Date.now() - llmStartedAt;
    if (err instanceof AiGatewayBlockedError) {
      audit({
        category: 'PIPELINE',
        action: 'LLM_CALL_BLOCKED',
        outcome: 'SKIPPED',
        actor: promptContext.analysisMode === 'auto' ? 'auto-pipeline' : 'manual-ask-ai',
        duration_ms: llmLatencyMs,
        metadata: {
          ...buildLlmGatewayAuditMetadata({ promptContext, settings, promptVersion, model }),
          status: promptContext.status,
          reason: err.evaluation.reason,
          severity: err.evaluation.severity,
          mode: err.evaluation.mode,
          decision: err.evaluation.decision,
          estimatedInputTokens: err.evaluation.estimatedInputTokens,
          estimatedCostUsd: err.evaluation.estimatedCostUsd,
        },
      });
      const blockedText = JSON.stringify({
        should_push: false,
        selection: '',
        bet_market: '',
        confidence: 0,
        reasoning_en: `AI Gateway blocked this LLM call: ${err.evaluation.reason}.`,
        reasoning_vi: `AI Gateway đã chặn lượt gọi LLM này: ${err.evaluation.reason}.`,
        warnings: ['AI_GATEWAY_BLOCKED', err.evaluation.reason],
        value_percent: 0,
        risk_level: 'HIGH',
        stake_percent: 0,
      });
      const parsed = parseAiResponse(
        blockedText,
        promptContext.oddsCanonical,
        promptContext.minute,
        settings,
        promptContext.evidenceMode,
      );
      return {
        promptVersion,
        prompt,
        promptChars,
        promptEstimatedTokens,
        aiText: blockedText,
        aiTextChars: blockedText.length,
        aiTextEstimatedTokens: estimateTokenCount(blockedText),
        llmLatencyMs,
        totalLatencyMs: Date.now() - startedAt,
        parsed,
        policyBlocked: true,
        policyWarnings: [`AI_GATEWAY_BLOCKED:${err.evaluation.reason}`],
      };
    }
    audit({
      category: 'PIPELINE',
      action: 'LLM_CALL_COMPLETED',
      outcome: 'FAILURE',
      actor: promptContext.analysisMode === 'auto' ? 'auto-pipeline' : 'manual-ask-ai',
      duration_ms: llmLatencyMs,
      metadata: {
        ...buildLlmGatewayAuditMetadata({ promptContext, settings, promptVersion, model }),
        status: promptContext.status,
      },
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  const llmLatencyMs = Date.now() - llmStartedAt;
  const aiTextChars = aiText.length;
  const aiTextEstimatedTokens = estimateTokenCount(aiText);
  audit({
    category: 'PIPELINE',
    action: 'LLM_CALL_COMPLETED',
    outcome: 'SUCCESS',
    actor: promptContext.analysisMode === 'auto' ? 'auto-pipeline' : 'manual-ask-ai',
    duration_ms: llmLatencyMs,
    metadata: {
      ...buildLlmGatewayAuditMetadata({ promptContext, settings, promptVersion, model }),
      status: promptContext.status,
      aiTextChars,
      aiTextEstimatedTokens,
    },
  });
  const parsedRaw = parseAiResponse(
    aiText,
    promptContext.oddsCanonical,
    promptContext.minute,
    settings,
    promptContext.evidenceMode,
  );
  const { parsed: patienceParsed, linePatienceBlocked } = applyLinePatienceToParsed({
    parsed: parsedRaw,
    oddsCanonical: promptContext.oddsCanonical,
    minute: promptContext.minute,
    score: promptContext.score,
    evidenceMode: promptContext.evidenceMode,
    eventsCompact: promptContext.eventsCompact,
    pipelineSettings: settings,
  });
  const finalized = await finalizeParsedRecommendation(deps, {
    patienceParsed,
    linePatienceBlocked,
    promptContext,
    promptVersion,
    policyContext,
  });
  audit({
    category: 'PIPELINE',
    action: 'LLM_PARSE_DIAGNOSTIC',
    outcome: finalized.parsed.llm_decision_diagnostic === 'actionable' ? 'SUCCESS' : 'SKIPPED',
    actor: promptContext.analysisMode === 'auto' ? 'auto-pipeline' : 'manual-ask-ai',
    metadata: {
      ...buildLlmGatewayAuditMetadata({ promptContext, settings, promptVersion, model }),
      status: promptContext.status,
      selection: finalized.parsed.selection,
      betMarket: finalized.parsed.bet_market,
      confidence: finalized.parsed.confidence,
      valuePercent: finalized.parsed.value_percent,
      riskLevel: finalized.parsed.risk_level,
      stakePercent: finalized.parsed.stake_percent,
      llmDecisionDiagnostic: finalized.parsed.llm_decision_diagnostic,
      marketResolutionStatus: finalized.parsed.market_resolution_status,
      policyBlocked: finalized.policyBlocked,
      policyWarnings: finalized.policyWarnings,
      warnings: finalized.parsed.warnings,
      ...buildShadowCandidateAuditMetadata(finalized.parsed.shadow_candidate),
      aiTextSample: aiText.slice(0, 2000),
    },
  });

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
    parsed: finalized.parsed,
    policyBlocked: finalized.policyBlocked,
    policyWarnings: finalized.policyWarnings,
  };
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
    confirmedStarters: string[];
    benchCount: number;
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
      confirmedStarters: Array.isArray(row.startXI)
        ? row.startXI
            .map((entry) => {
              const name = String(entry.player?.name ?? '').trim();
              const pos = entry.player?.pos ? ` (${entry.player.pos})` : '';
              return name ? `${name}${pos}` : '';
            })
            .filter(Boolean)
            .slice(0, 11)
        : [],
      benchCount: Array.isArray(row.substitutes) ? row.substitutes.length : 0,
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

const MAX_LADDER_EXTRAS = 2;

function isFootballAsianHandicapBetName(betName: string): boolean {
  return betName.includes('asian handicap')
    && !betName.includes('corner')
    && !betName.includes('card')
    && !betName.includes('yellow')
    && !betName.includes('offside')
    && !betName.includes('foul')
    && !betName.includes('shot');
}

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

    const isPlain1x2 = betName === '1x2' || betName === '1 x 2';
    const is1x2Ft = !isCornerBet && (
      isPlain1x2
      || betName.includes('match winner')
      || betName.includes('fulltime result')
      || betName === 'full time result'
    );
    const is1x2Ht = !isCornerBet && (
      betName.includes('1x2')
      || betName.includes('winner')
      || betName.includes('fulltime result')
      || betName === 'full time result'
    );
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

    if (!isCornerBet && isFootballAsianHandicapBetName(betName)) {
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
          const parsedLine = Number(m[2]);
          if (!Number.isFinite(parsedLine)) continue;
          const canonicalInputLine = side === 'away' ? -parsedLine : parsedLine;
          key = `${side} ${String(canonicalInputLine).replace(/^-0$/, '0')}`;
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
    if (goalsOuPair.extras.length > 0) canonical['ou_extra'] = goalsOuPair.extras;
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
    if (htGoalsOuPair.extras.length > 0) canonical['ht_ou_extra'] = htGoalsOuPair.extras;
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
  if (Array.isArray(canonical['ou_extra']) && canonical['ou_extra'].length > 0) {
    const filtered = canonical['ou_extra'].filter((row) => {
      if (row.over === null || row.under === null) return false;
      const t = ip(row.over) + ip(row.under);
      return !(t > 0 && (t < 0.85 || t > 1.15));
    });
    if (filtered.length > 0) canonical['ou_extra'] = filtered;
    else delete canonical['ou_extra'];
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
  if (Array.isArray(canonical['ht_ou_extra']) && canonical['ht_ou_extra'].length > 0) {
    const filtered = canonical['ht_ou_extra'].filter((row) => {
      if (row.over === null || row.under === null) return false;
      const t = ip(row.over) + ip(row.under);
      return !(t > 0 && (t < 0.85 || t > 1.15));
    });
    if (filtered.length > 0) canonical['ht_ou_extra'] = filtered;
    else delete canonical['ht_ou_extra'];
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
      'ht_ou_extra',
      `Removed extra H1 goals O/U ladder lines from prompt: first half is already closed (status ${matchStatus}).`,
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
  if (htTotalKnown !== null && Array.isArray(sanitized.ht_ou_extra)) {
    const before = sanitized.ht_ou_extra.length;
    sanitized.ht_ou_extra = sanitized.ht_ou_extra.filter((row) => typeof row.line === 'number' && htTotalKnown <= row.line);
    if (sanitized.ht_ou_extra.length < before) {
      warnings.push(`Removed settled extra H1 goals O/U ladder lines from prompt: H1 total ${htTotalKnown} already exceeds one or more lines.`);
    }
    if (sanitized.ht_ou_extra.length === 0) delete sanitized.ht_ou_extra;
  }

  if (htTotalKnown !== null) {
    const htContam = detectHtGoalsCornersLineContamination(sanitized, htTotalKnown);
    if (htContam.contaminated) {
      removeMarket('ht_ou', htContam.reason);
      removeMarket(
        'ht_ou_adjacent',
        `${htContam.reason} (cleared adjacent H1 O/U ladder).`,
      );
      removeMarket(
        'ht_ou_extra',
        `${htContam.reason} (cleared extra H1 O/U ladder).`,
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
  if (Array.isArray(sanitized.ou_extra)) {
    const before = sanitized.ou_extra.length;
    sanitized.ou_extra = sanitized.ou_extra.filter((row) => typeof row.line === 'number' && args.currentTotalGoals <= row.line);
    if (sanitized.ou_extra.length < before) {
      warnings.push(`Removed settled extra goals O/U ladder lines from prompt: current total goals ${args.currentTotalGoals} already exceeds one or more lines.`);
    }
    if (sanitized.ou_extra.length === 0) delete sanitized.ou_extra;
  }

  const contaminationCheck = detectGoalsCornersLineContamination(sanitized, args.currentTotalGoals);
  if (contaminationCheck.contaminated) {
    removeMarket('ou', contaminationCheck.reason);
    removeMarket(
      'ou_adjacent',
      `${contaminationCheck.reason} (cleared adjacent goals O/U ladder with contaminated main line).`,
    );
    removeMarket(
      'ou_extra',
      `${contaminationCheck.reason} (cleared extra goals O/U ladder with contaminated main line).`,
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
    || sanitized['ou_extra']
    || sanitized['ah']
    || sanitized['btts']
    || sanitized['corners_ou']
    || sanitized['ht_1x2']
    || sanitized['ht_ou']
    || sanitized['ht_ou_extra']
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
  extras: OddsOuRung[];
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
  if (candidates.length === 0) return { main, extras: [] };

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
  const usedLines = new Set<string>([bestLine]);
  if (adjacentLine) usedLines.add(adjacentLine);
  const extras: OddsOuRung[] = [];
  const pool = [...lineMap.keys()].filter((ls) => {
    if (usedLines.has(ls)) return false;
    const d = lineMap.get(ls);
    return !!(d?.over && d?.under);
  });
  pool.sort((a, b) => Math.abs(Number(a) - mainNum) - Math.abs(Number(b) - mainNum));
  for (const ls of pool.slice(0, MAX_LADDER_EXTRAS)) {
    const d = lineMap.get(ls)!;
    extras.push({ line: Number(ls), over: d.over ?? null, under: d.under ?? null });
  }

  if (!adjacentLine) return { main, extras };
  const adjData = lineMap.get(adjacentLine) || {};
  return {
    main,
    adjacent: {
      line: Number(adjacentLine),
      over: adjData['over'] ?? null,
      under: adjData['under'] ?? null,
    },
    extras,
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
  for (const ls of pool.slice(0, MAX_LADDER_EXTRAS)) {
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

function emptyShadowCandidate(reasonCode = 'not_provided'): ParsedAiShadowCandidate {
  return {
    selection: '',
    bet_market: '',
    confidence: 0,
    value_percent: 0,
    risk_level: 'HIGH',
    stake_percent: 0,
    reason_code: reasonCode,
    reason_en: '',
    reason_vi: '',
    mapped_odd: null,
    canonical_market: 'unknown',
    market_resolution_status: 'not_requested',
  };
}

function resolveMarketResolutionStatus(args: {
  selection: string;
  betMarket: string;
  mappedOdd: number | null;
  requested: boolean;
}): MarketResolutionStatus {
  if (!args.requested) return 'not_requested';
  if (!args.selection) return 'missing_selection';
  if (!args.betMarket) return 'missing_market';
  if (args.mappedOdd == null) return 'odds_unavailable';
  return 'resolved';
}

function parseShadowCandidate(raw: unknown, oddsCanonical: OddsCanonical): ParsedAiShadowCandidate {
  const record = asObjectRecord(raw);
  if (!record) return emptyShadowCandidate('not_provided');

  const selection = String(record.selection ?? '').trim();
  const betMarket = String(record.bet_market ?? '').trim();
  const requested = !!(selection || betMarket);
  const mappedOdd = requested ? extractOddsFromSelection(selection, betMarket, oddsCanonical) : null;
  const riskLevel = ['LOW', 'MEDIUM', 'HIGH'].includes(String(record.risk_level))
    ? String(record.risk_level)
    : 'HIGH';

  return {
    selection,
    bet_market: betMarket,
    confidence: toNumber(record.confidence) ?? 0,
    value_percent: toNumber(record.value_percent) ?? 0,
    risk_level: riskLevel,
    stake_percent: toNumber(record.stake_percent) ?? 0,
    reason_code: String(record.reason_code ?? (requested ? 'unspecified' : 'no_viable_candidate')).trim(),
    reason_en: String(record.reason_en ?? '').trim(),
    reason_vi: String(record.reason_vi ?? '').trim(),
    mapped_odd: mappedOdd,
    canonical_market: requested ? normalizeMarket(selection, betMarket) : 'unknown',
    market_resolution_status: resolveMarketResolutionStatus({
      selection,
      betMarket,
      mappedOdd,
      requested,
    }),
  };
}

function buildShadowCandidateAuditMetadata(candidate: ParsedAiShadowCandidate): Record<string, unknown> {
  const hasCandidate = !!(candidate.selection || candidate.bet_market);
  return {
    shadowCandidate: candidate as unknown as Record<string, unknown>,
    shadowCandidatePresent: hasCandidate,
    shadowCandidateSelection: candidate.selection,
    shadowCandidateBetMarket: candidate.bet_market,
    shadowCandidateCanonicalMarket: candidate.canonical_market,
    shadowCandidateMappedOdd: candidate.mapped_odd,
    shadowCandidateMarketResolutionStatus: candidate.market_resolution_status,
    shadowCandidateConfidence: candidate.confidence,
    shadowCandidateValuePercent: candidate.value_percent,
    shadowCandidateRiskLevel: candidate.risk_level,
    shadowCandidateStakePercent: candidate.stake_percent,
    shadowCandidateReasonCode: candidate.reason_code,
    shadowCandidateReasonEn: candidate.reason_en,
    shadowCandidateReasonVi: candidate.reason_vi,
  };
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
    llm_decision_diagnostic: 'market_parse_failed',
    market_resolution_status: 'not_requested',
    shadow_candidate: emptyShadowCandidate('parse_error'),
  };
  if (!aiText) return defaults;

  const jsonStr = extractJsonString(aiText);
  if (!jsonStr) return defaults;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ...defaults, warnings: ['JSON_PARSE_ERROR'], llm_decision_diagnostic: 'market_parse_failed' };
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
  const customConditionMatched = false;
  const customConditionStatus: ParsedAiResponse['custom_condition_status'] = 'none';
  const customConditionSummaryEn = '';
  const customConditionSummaryVi = '';
  const customConditionReasonEn = '';
  const customConditionReasonVi = '';
  const conditionTriggeredSuggestion = '';
  const conditionTriggeredReasoningEn = '';
  const conditionTriggeredReasoningVi = '';
  const conditionTriggeredConfidence = 0;
  const conditionTriggeredStake = 0;
  const conditionTriggeredSpecialOverride = false;
  const conditionTriggeredSpecialOverrideReasonEn = '';
  const conditionTriggeredSpecialOverrideReasonVi = '';
  const followUpAnswerEn = String(parsed.follow_up_answer_en || '');
  const followUpAnswerVi = String(parsed.follow_up_answer_vi || '');
  const shadowCandidate = parseShadowCandidate(parsed.shadow_candidate, oddsCanonical);

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
  // Main AI save path. User condition alerts are handled by the dedicated
  // match-alert engine and no longer affect recommendation persistence.
  const systemShouldBet = aiShouldPush && !hasBlocking;
  const usableOdd = mappedOdd !== null && mappedOdd >= MIN_ODDS ? mappedOdd : null;
  const aiFinalShouldBet = systemShouldBet && usableOdd !== null;
  const oddsForDisplay = usableOdd ?? mappedOdd ?? (aiShouldPush ? 'N/A' : null);
  const marketResolutionStatus: ParsedAiResponse['market_resolution_status'] = !aiShouldPush
    ? 'not_requested'
    : !aiSelection
      ? 'missing_selection'
      : !betMarket
        ? 'missing_market'
        : mappedOdd === null
          ? 'odds_unavailable'
          : 'resolved';
  const llmDecisionDiagnostic: ParsedAiResponse['llm_decision_diagnostic'] = aiFinalShouldBet
    ? 'actionable'
    : !aiShouldPush
      ? 'no_bet_intentional'
      : marketResolutionStatus === 'missing_market' || marketResolutionStatus === 'missing_selection'
        ? 'market_parse_failed'
        : marketResolutionStatus === 'odds_unavailable'
          ? 'market_not_available_in_odds'
          : 'policy_blocked';
  const conditionTriggeredShouldPush = false;
  const finalShouldPush = aiFinalShouldBet;
  const decisionKind = aiFinalShouldBet ? 'ai_push' : 'no_bet';

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
    llm_decision_diagnostic: llmDecisionDiagnostic,
    market_resolution_status: marketResolutionStatus,
    shadow_candidate: shadowCandidate,
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
    const htExtraO = oc.ht_ou_extra?.find((r) => sameLine(htGoalOverLine, r.line));
    if (htExtraO) return htExtraO.over ?? null;
    return null;
  }

  const htGoalUnderLine = parseLineSuffix('ht_under_', market);
  if (htGoalUnderLine !== null) {
    if (sameLine(htGoalUnderLine, oc.ht_ou?.line)) return oc.ht_ou?.under ?? null;
    if (sameLine(htGoalUnderLine, oc.ht_ou_adjacent?.line)) return oc.ht_ou_adjacent?.under ?? null;
    const htExtraU = oc.ht_ou_extra?.find((r) => sameLine(htGoalUnderLine, r.line));
    if (htExtraU) return htExtraU.under ?? null;
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
    const extraO = oc.ou_extra?.find((r) => sameLine(goalOverLine, r.line));
    if (extraO) return extraO.over ?? null;
    return null;
  }

  const goalUnderLine = parseLineSuffix('under_', market);
  if (goalUnderLine !== null) {
    if (sameLine(goalUnderLine, oc.ou?.line)) return oc.ou?.under ?? null;
    if (sameLine(goalUnderLine, oc.ou_adjacent?.line)) return oc.ou_adjacent?.under ?? null;
    const extraU = oc.ou_extra?.find((r) => sameLine(goalUnderLine, r.line));
    if (extraU) return extraU.under ?? null;
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

function isConditionOnlyTrigger(_parsed: ParsedAiResponse): boolean {
  return false;
}

function displaySelection(parsed: ParsedAiResponse): string {
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
  return parsed.confidence;
}

function displayStake(parsed: ParsedAiResponse): number {
  return parsed.stake_percent;
}

function decisionKindFromParsed(parsed: ParsedAiResponse): MatchPipelineResult['decisionKind'] {
  return parsed.decision_kind;
}

/** Pick reasoning text based on notification language setting. */
function pickReasoning(parsed: ParsedAiResponse, lang: PipelineSettings['notificationLanguage']): string {
  const reasoningEn = parsed.reasoning_en;
  const reasoningVi = parsed.reasoning_vi;
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
  const label = isRec ? 'RECOMMENDATION' : isCondition ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';
  const selection = displaySelectionWithContext(parsed, parsed.mapped_odd);
  const confidence = displayConfidence(parsed);
  const stake = displayStake(parsed);

  const INTERNAL = new Set(['FORCE_MODE', 'EARLY_GAME_RISK']);

  let text = `<b>${label}</b>\n`;
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

  const label = isRec ? 'RECOMMENDATION' : isCondition ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';

  let text = `<b>${label}</b>\n`;
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
  const activePromptVersion = LIVE_ANALYSIS_PROMPT_VERSION;
  const analysisRunId = randomUUID();
  const advisoryOnly = options.advisoryOnly === true;

  try {
    const homeTeamId = fixture.teams?.home?.id;
    const awayTeamId = fixture.teams?.away?.id;
    const isManualForce = options.forceAnalyze === true;
    const forceAnalyze = isManualForce;
    const analysisMode: PromptAnalysisMode = isManualForce
      ? 'manual_force'
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
        liveStatuses: config.liveStatuses,
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
    const providerHealth = buildProviderHealthSnapshot({
      fixture,
      status,
      minute,
      statsRaw: apiStatsRaw,
      statsAvailable: proceed.statsAvailable,
      fixtureFreshness: insight.fixture.freshness,
      statisticsFreshness: insight.statistics.freshness,
      statisticsCacheStatus: insight.statistics.cacheStatus,
      eventsFreshness: insight.events.freshness,
    });
    const providerWarnings = providerHealth.warnings;
    const providerDebugMetadata = {
      providerHealth,
      providerWarnings,
      providerCoverageStatus: providerHealth.coverageStatus,
      providerReturnedNoLiveStatistics: providerHealth.providerReturnedNoLiveStatistics,
      providerClockLagMinutes: providerHealth.providerClockLagMinutes,
      providerClockLagStatus: providerHealth.providerClockLagStatus,
    };

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
            providerHealth,
            providerWarnings,
            providerCoverageStatus: providerHealth.coverageStatus,
            providerReturnedNoLiveStatistics: providerHealth.providerReturnedNoLiveStatistics,
            providerClockLagMinutes: providerHealth.providerClockLagMinutes,
            providerClockLagStatus: providerHealth.providerClockLagStatus,
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
          providerHealth,
          providerWarnings,
          providerCoverageStatus: providerHealth.coverageStatus,
          providerReturnedNoLiveStatistics: providerHealth.providerReturnedNoLiveStatistics,
          providerClockLagMinutes: providerHealth.providerClockLagMinutes,
          providerClockLagStatus: providerHealth.providerClockLagStatus,
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
      referenceOddsCanonical?: OddsCanonical;
      referenceOddsSource?: string;
      referenceOddsFetchedAt?: string | null;
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
      const referenceOddsSource = resolvedOdds.referenceOddsSource;
      const referenceOddsFetchedAt = resolvedOdds.referenceOddsFetchedAt;
      const referenceOddsResult = resolvedOdds.referenceResponse && resolvedOdds.referenceResponse.length > 0
        ? buildOddsCanonical(resolvedOdds.referenceResponse, {
            totalGoalsFt: homeGoals + awayGoals,
            totalGoalsHt: null,
          })
        : null;
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
        referenceOddsCanonical: referenceOddsResult?.available ? referenceOddsResult.canonical : undefined,
        referenceOddsSource,
        referenceOddsFetchedAt,
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
        loadPerformanceMemoryPromptContext(deps, {
          minuteBand: deriveMinuteBand(minute),
          scoreState: deriveScoreState(score),
          limit: config.performanceMemoryPromptLimit,
        }),
        loadPerformanceMemoryAutoRules(deps, {
          minSamples: config.performanceMemoryAutoRuleMinSamples,
          maxWinRate: config.performanceMemoryAutoRuleMaxWinRate,
        }),
      ]),
    ]);

    const {
      oddsCanonical,
      oddsAvailable,
      oddsSource,
      oddsFetchedAt,
      referenceOddsCanonical,
      referenceOddsSource,
      referenceOddsFetchedAt,
      oddsSanityWarnings,
      oddsSuspicious,
    } = oddsSide;
    const [
      historicalPerformance,
      rawLeagueProfile,
      leagueMeta,
      rawHomeTeamProfile,
      rawAwayTeamProfile,
      scoutInsight,
      performanceMemoryRecords,
      performanceMemoryAutoRules,
    ] = promptContextBundle;
    const prematchProfileMode = options.prematchProfileMode ?? 'full';
    const leagueProfile = prematchProfileMode === 'none' || prematchProfileMode === 'team-only'
      ? null
      : rawLeagueProfile;
    const homeTeamProfile = prematchProfileMode === 'none' || prematchProfileMode === 'league-only'
      ? null
      : rawHomeTeamProfile;
    const awayTeamProfile = prematchProfileMode === 'none' || prematchProfileMode === 'league-only'
      ? null
      : rawAwayTeamProfile;
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
      const outputDecision = routeLiveOutput({
        evidenceMode: 'low_evidence',
        llmCalled: false,
        llmEligibilityReason: staleness.reason || 'stale_snapshot',
        advisoryOnly,
        shadowMode,
      });
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
            outputKind: outputDecision.outputKind,
            auditBucket: outputDecision.auditBucket,
            outputDecision,
            ...providerDebugMetadata,
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
          ...providerDebugMetadata,
          outputDecision,
          outputKind: outputDecision.outputKind,
          auditBucket: outputDecision.auditBucket,
          savedRecommendation: outputDecision.savedRecommendation,
          settlementEligible: outputDecision.settlementEligible,
          roiEligible: outputDecision.roiEligible,
          llmCalled: outputDecision.llmCalled,
          preLlmLatencyMs: Date.now() - startedAt,
          totalLatencyMs: Date.now() - startedAt,
        },
      };
    }

    const evidenceMode = deriveEvidenceMode(statsAvailable, oddsAvailable, eventsCompact);
    const promptDataLevel = getPromptStatsDetailLevel(statsCompact);

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
    let rawStrategicContext = watchlistEntry.strategic_context as Record<string, unknown> | null;
    let strategicContextOnDemandAttempted = false;
    let strategicContextOnDemandApplied = false;
    let strategicContextOnDemandError = '';
    const strategicRefreshStatus = String((rawStrategicContext?._meta as Record<string, unknown> | undefined)?.refresh_status ?? '').trim().toLowerCase();
    let strategicContext = (
      rawStrategicContext
      && strategicRefreshStatus === 'good'
      && hasUsableStrategicContext(rawStrategicContext as unknown as Parameters<typeof hasUsableStrategicContext>[0], {
        topLeague: leagueMeta?.top_league === true,
      })
    )
      ? rawStrategicContext
      : null;

    const canEnsureStrategicContext = options.ensureStrategicContext === true
      && analysisMode === 'manual_force'
      && String(status ?? '').toUpperCase() === 'NS'
      && leagueMeta?.top_league === true
      && !strategicContext;
    if (canEnsureStrategicContext) {
      strategicContextOnDemandAttempted = true;
      const attemptedAt = new Date().toISOString();
      try {
        const matchDateForResearch = fixture.fixture.date
          || (fixture.fixture.timestamp ? new Date(fixture.fixture.timestamp * 1000).toISOString() : null);
        const fetchedStrategicContext = await fetchStrategicContext(
          homeName,
          awayName,
          league,
          matchDateForResearch,
          {
            topLeague: true,
            highPriority: true,
            favoriteLeague: true,
            leagueCountry: leagueMeta.country ?? null,
          },
        );
        if (
          fetchedStrategicContext
          && hasUsableStrategicContext(fetchedStrategicContext, { topLeague: true })
        ) {
          rawStrategicContext = {
            ...fetchedStrategicContext,
            _meta: {
              refresh_status: 'good',
              failure_count: 0,
              last_attempt_at: attemptedAt,
              retry_after: null,
              refresh_window: 'on_demand',
            },
          };
          strategicContext = rawStrategicContext;
          strategicContextOnDemandApplied = true;
          await watchlistRepo.updateOperationalWatchlistEntry(matchId, {
            strategic_context: rawStrategicContext as unknown,
            strategic_context_at: attemptedAt,
          }).catch((err) => {
            strategicContextOnDemandError = err instanceof Error ? err.message : String(err);
          });
        }
      } catch (err) {
        strategicContextOnDemandError = err instanceof Error ? err.message : String(err);
      }
    }
    const prematchExpertFeatures = buildPrematchExpertFeaturesV1({
      strategicContext,
      leagueProfile: leagueProfile as Record<string, unknown> | null,
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
    const preMatchContextSummary = buildPrematchDecisionSummary({
      strategicContext,
      prematchExpertFeatures,
      prematchAvailability,
      prematchStrength,
      prematchNoisePenalty,
      leagueProfileWindow,
      homeTeamProfileWindow,
      awayTeamProfileWindow,
    });
    const structuredPrematchAskAiCheck = canRunStructuredPrematchAskAi({
      analysisMode,
      status,
      prematchExpertFeatures,
    });
    const structuredPrematchAskAi = structuredPrematchAskAiCheck.eligible;
    const strategicContextRequiredButUnavailable = options.ensureStrategicContext === true
      && analysisMode === 'manual_force'
      && String(status ?? '').toUpperCase() === 'NS'
      && leagueMeta?.top_league === true
      && strategicContextOnDemandAttempted
      && !strategicContext;

    if (strategicContextRequiredButUnavailable) {
      const outputDecision = routeLiveOutput({
        evidenceMode,
        llmCalled: false,
        llmEligibilityReason: 'strategic_context_unavailable',
        advisoryOnly,
        shadowMode,
      });
      if (!shadowMode && shouldSamplePipelineSkipAudit('strategic_context_unavailable', 'llm-eligibility', 20)) {
        audit({
          category: 'PIPELINE',
          action: 'PIPELINE_MATCH_SKIPPED',
          outcome: 'SKIPPED',
          actor: 'auto-pipeline',
          metadata: {
            matchId,
            matchDisplay,
            reason: 'strategic_context_unavailable',
            analysisMode,
            evidenceMode,
            strategicContextOnDemandAttempted,
            strategicContextOnDemandApplied,
            strategicContextOnDemandError: strategicContextOnDemandError || undefined,
            outputKind: outputDecision.outputKind,
            auditBucket: outputDecision.auditBucket,
            outputDecision,
            ...providerDebugMetadata,
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
        outputKind: outputDecision.outputKind,
        auditBucket: outputDecision.auditBucket,
        debug: {
          analysisRunId,
          shadowMode,
          skippedAt: 'llm_eligibility',
          skipReason: 'Strategic context unavailable after on-demand enrichment; skipped AI analysis to avoid an ungrounded LLM call.',
          analysisMode,
          oddsSource,
          oddsAvailable,
          statsAvailable,
          statsSource,
          evidenceMode,
          prematchAvailability,
          prematchNoisePenalty,
          prematchStrength,
          strategicContextOnDemandAttempted,
          strategicContextOnDemandApplied,
          strategicContextOnDemandError: strategicContextOnDemandError || undefined,
          structuredPrematchAskAi,
          structuredPrematchAskAiReason: structuredPrematchAskAiCheck.reason,
          statsFallbackUsed,
          statsFallbackReason: statsFallbackReason || undefined,
          ...providerDebugMetadata,
          outputDecision,
          outputKind: outputDecision.outputKind,
          auditBucket: outputDecision.auditBucket,
          savedRecommendation: outputDecision.savedRecommendation,
          settlementEligible: outputDecision.settlementEligible,
          roiEligible: outputDecision.roiEligible,
          llmCalled: outputDecision.llmCalled,
          preLlmLatencyMs: Date.now() - startedAt,
          totalLatencyMs: Date.now() - startedAt,
        },
      };
    }

    if (evidenceMode === 'low_evidence' && !structuredPrematchAskAi) {
      const outputDecision = routeLiveOutput({
        evidenceMode,
        llmCalled: false,
        llmEligibilityReason: 'low_evidence',
        advisoryOnly,
        shadowMode,
      });
      if (!shadowMode && shouldSamplePipelineSkipAudit('low_evidence', 'low-evidence', 20)) {
        audit({
          category: 'PIPELINE',
          action: 'PIPELINE_MATCH_SKIPPED',
          outcome: 'SKIPPED',
          actor: 'auto-pipeline',
          metadata: {
            matchId,
            matchDisplay,
            reason: 'low_evidence',
            analysisMode,
            evidenceMode,
            outputKind: outputDecision.outputKind,
            auditBucket: outputDecision.auditBucket,
            outputDecision,
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
            ...providerDebugMetadata,
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
        outputKind: outputDecision.outputKind,
        auditBucket: outputDecision.auditBucket,
        debug: {
          analysisRunId,
          shadowMode,
          skippedAt: 'proceed',
          skipReason: 'Skipped AI analysis because this match is in low-evidence mode.',
          analysisMode,
          oddsSource,
          oddsAvailable,
          statsAvailable,
          statsSource,
          evidenceMode,
          prematchAvailability,
          prematchNoisePenalty,
          prematchStrength,
          strategicContextOnDemandAttempted,
          strategicContextOnDemandApplied,
          strategicContextOnDemandError: strategicContextOnDemandError || undefined,
          structuredPrematchAskAi,
          structuredPrematchAskAiReason: structuredPrematchAskAiCheck.reason,
          statsFallbackUsed,
          statsFallbackReason: statsFallbackReason || undefined,
          ...providerDebugMetadata,
          outputDecision,
          outputKind: outputDecision.outputKind,
          auditBucket: outputDecision.auditBucket,
          savedRecommendation: outputDecision.savedRecommendation,
          settlementEligible: outputDecision.settlementEligible,
          roiEligible: outputDecision.roiEligible,
          llmCalled: outputDecision.llmCalled,
          preLlmLatencyMs: Date.now() - startedAt,
          totalLatencyMs: Date.now() - startedAt,
        },
      };
    }

    const promptContext: PromptExecutionContext = {
      matchId,
      homeName, awayName, league, minute, score, status,
      statsCompact, statsAvailable, statsSource, evidenceMode,
      providerHealth,
      providerWarnings,
      providerClockLagMinutes: providerHealth.providerClockLagMinutes,
      providerReturnedNoLiveStatistics: providerHealth.providerReturnedNoLiveStatistics,
      providerCoverageStatus: providerHealth.coverageStatus,
      eventsCompact: eventsCompact.slice(-8),
      oddsCanonical, oddsAvailable, oddsSource, oddsFetchedAt,
      referenceOddsCanonical,
      referenceOddsSource,
      referenceOddsFetchedAt,
      oddsSanityWarnings,
      oddsSuspicious,
      derivedInsights: !statsAvailable ? derivedInsights : null,
      watchlistSubscriberCount: Number(watchlistEntry.subscriber_count ?? 0),
      activeWatchInterest: hasActiveWatchInterest(watchlistEntry),
      strategicContext,
      leagueProfile: leagueProfile as Record<string, unknown> | null,
      homeTeamProfile: homeTeamProfile as Record<string, unknown> | null,
      awayTeamProfile: awayTeamProfile as Record<string, unknown> | null,
      prematchExpertFeatures,
      structuredPrematchAskAi,
      analysisMode,
      forceAnalyze,
      isManualPush: isManualForce,
      currentTotalGoals: homeGoals + awayGoals,
      previousRecommendations: prevRecsContext,
      historicalPerformance,
      performanceMemory: {
        minuteBand: deriveMinuteBand(minute),
        scoreState: deriveScoreState(score),
        records: performanceMemoryRecords,
        autoRules: performanceMemoryAutoRules,
      },
      preMatchContextSummary,
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
    const referenceMarketKeys = Object.keys(referenceOddsCanonical ?? {}).sort();
    if (
      !shadowMode
      && !advisoryOnly
      && !oddsAvailable
      && referenceOddsSource === 'reference-prematch'
      && referenceMarketKeys.length > 0
    ) {
      audit({
        category: 'PIPELINE',
        action: 'LIVE_ODDS_EMPTY_PREMATCH_AVAILABLE',
        outcome: 'SKIPPED',
        actor: 'auto-pipeline',
        metadata: {
          matchId,
          matchDisplay,
          minute,
          score,
          status,
          evidenceMode,
          oddsSource,
          oddsAvailable,
          referenceOddsSource,
          referenceMarketKeys,
          contract: 'odds-first-stats-only-live-signal',
        },
      });
    }
    const model = options.modelOverride || settings.aiModel;
    const llmEligibility = await resolveLlmEligibility({
      promptContext,
      watchlistEntry,
      settings,
      shadowMode,
      advisoryOnly,
      settledReplayApprovedTrace: options.settledReplayApprovedTrace === true,
    });
    if (!llmEligibility.eligible) {
      const blockedOutputDecision = routeLiveOutput({
        evidenceMode,
        llmCalled: false,
        llmEligibilityReason: llmEligibility.reason,
        advisoryOnly,
        shadowMode,
      });
      audit({
        category: 'PIPELINE',
        action: 'LLM_CALL_BLOCKED',
        outcome: 'SKIPPED',
        actor: 'auto-pipeline',
        metadata: {
          ...buildLlmGatewayAuditMetadata({ promptContext, settings, promptVersion: activePromptVersion }),
          matchId,
          matchDisplay,
          reason: llmEligibility.reason,
          status,
          minute,
          analysisMode,
          evidenceMode,
          oddsSource,
          oddsAvailable,
          statsAvailable,
          ...llmEligibility.details,
          outputKind: blockedOutputDecision.outputKind,
          auditBucket: blockedOutputDecision.auditBucket,
          outputDecision: blockedOutputDecision,
          ...providerDebugMetadata,
        },
      });

      if (
        !shadowMode
        && !advisoryOnly
        && llmEligibility.reason === 'degraded_evidence'
        && evidenceMode === 'stats_only'
        && statsAvailable
        && !oddsAvailable
      ) {
        audit({
          category: 'PIPELINE',
          action: 'ACTIONABLE_BET_BLOCKED_NO_LIVE_ODDS',
          outcome: 'SKIPPED',
          actor: 'auto-pipeline',
          metadata: {
            matchId,
            matchDisplay,
            minute,
            score,
            status,
            evidenceMode,
            oddsSource,
            oddsAvailable,
            referenceOddsSource,
            referenceMarketKeys,
            ...providerDebugMetadata,
            contract: 'odds-first-stats-only-live-signal',
          },
        });

        const statsOnlySignal = evaluateStatsOnlyLiveSignal({
          matchId,
          homeTeam: homeName,
          awayTeam: awayName,
          minute,
          status,
          score: { home: homeGoals, away: awayGoals },
          stats: statsCompact,
          events: eventsCompact,
          oddsAvailable,
          referenceMarketKeys,
        });

        if (statsOnlySignal.triggered) {
          const deliveryResult = await deps.enqueueStatsOnlyLiveSignalDeliveries({
            matchId,
            homeTeam: homeName,
            awayTeam: awayName,
            league,
            status,
            minute,
            score,
            kickoffAtUtc: null,
            signal: statsOnlySignal,
            referenceMarketKeys,
          }).catch((error) => {
            audit({
              category: 'PIPELINE',
              action: 'STATS_ONLY_SIGNAL_EMIT_FAILED',
              outcome: 'FAILURE',
              actor: 'auto-pipeline',
              error: error instanceof Error ? error.message : String(error),
              metadata: {
                matchId,
                matchDisplay,
                signalType: statsOnlySignal.signalType,
                triggerKey: statsOnlySignal.triggerKey,
                contract: 'odds-first-stats-only-live-signal',
              },
            });
            return { enqueued: 0, deliveryIds: [] };
          });
          const outputDecision = routeLiveOutput({
            evidenceMode,
            llmCalled: false,
            statsOnlySignalTriggered: true,
            statsOnlySignalEnqueued: deliveryResult.enqueued,
            advisoryOnly,
            shadowMode,
          });

          audit({
            category: 'PIPELINE',
            action: 'STATS_ONLY_SIGNAL_EMITTED',
            outcome: deliveryResult.enqueued > 0 ? 'SUCCESS' : 'SKIPPED',
            actor: 'auto-pipeline',
            metadata: {
              matchId,
              matchDisplay,
              minute,
              score,
              status,
              signalType: statsOnlySignal.signalType,
              signalStrength: statsOnlySignal.strength,
              triggerKey: statsOnlySignal.triggerKey,
              marketFamilyHint: statsOnlySignal.marketFamilyHint,
              reasons: statsOnlySignal.reasons,
              enqueued: deliveryResult.enqueued,
              deliveryIds: deliveryResult.deliveryIds,
              referenceMarketKeys,
              ...providerDebugMetadata,
              savedRecommendation: false,
              llmCalled: false,
              outputKind: outputDecision.outputKind,
              auditBucket: outputDecision.auditBucket,
              outputDecision,
              contract: 'odds-first-stats-only-live-signal',
            },
          });

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
            decisionKind: 'condition_only',
            shouldPush: deliveryResult.enqueued > 0,
            selection: statsOnlySignal.signalType ?? 'stats_only_live_signal',
            confidence: 0,
            saved: false,
            notified: deliveryResult.enqueued > 0,
            outputKind: outputDecision.outputKind,
            auditBucket: outputDecision.auditBucket,
            debug: {
              analysisRunId,
              shadowMode,
              skippedAt: 'llm_eligibility',
              skipReason: 'stats_only_signal_emitted',
              analysisMode,
              advisoryOnly,
              oddsSource,
              oddsAvailable,
              statsAvailable,
              statsSource,
              evidenceMode,
              statsFallbackUsed,
              statsFallbackReason: statsFallbackReason || undefined,
              ...providerDebugMetadata,
              statsOnlySignal: {
                ...statsOnlySignal,
                enqueued: deliveryResult.enqueued,
                deliveryIds: deliveryResult.deliveryIds,
                llmCalled: false,
                savedRecommendation: false,
              } as unknown as Record<string, unknown>,
              outputDecision,
              outputKind: outputDecision.outputKind,
              auditBucket: outputDecision.auditBucket,
              savedRecommendation: outputDecision.savedRecommendation,
              settlementEligible: outputDecision.settlementEligible,
              roiEligible: outputDecision.roiEligible,
              llmCalled: outputDecision.llmCalled,
              preLlmLatencyMs: Date.now() - startedAt,
              totalLatencyMs: Date.now() - startedAt,
            },
          };
        }

        let aiAdvisorySignal = null as ReturnType<typeof parseStatsOnlyAiAdvisoryResponse> | null;
        const aiAdvisoryPrompt = buildStatsOnlyAiAdvisoryPrompt({
          matchId,
          homeTeam: homeName,
          awayTeam: awayName,
          matchDisplay,
          league,
          minute,
          status,
          score: { home: homeGoals, away: awayGoals },
          stats: statsCompact,
          events: eventsCompact,
          oddsAvailable,
          referenceMarketKeys,
          statsAvailable,
          statsSource,
          evidenceMode,
          providerWarnings,
          providerClockLagMinutes: providerHealth.providerClockLagMinutes,
          deterministicReasons: statsOnlySignal.reasons,
        });
        const aiAdvisoryStartedAt = Date.now();
        audit({
          category: 'PIPELINE',
          action: 'STATS_ONLY_AI_ADVISORY_LLM_STARTED',
          outcome: 'SUCCESS',
          actor: 'auto-pipeline',
          metadata: {
            ...buildLlmGatewayAuditMetadata({ promptContext, settings, promptVersion: activePromptVersion, model }),
            matchId,
            matchDisplay,
            promptChars: aiAdvisoryPrompt.length,
            promptEstimatedTokens: estimateTokenCount(aiAdvisoryPrompt),
            contract: 'odds-first-stats-only-live-signal',
          },
        });
        try {
          const aiAdvisoryText = await deps.callGemini(aiAdvisoryPrompt, model, {
            operation: 'tfi.stats_only_ai_advisory',
            featureKey: 'tfi.stats_only_ai_advisory',
            matchId,
            promptVersion: activePromptVersion,
            metadata: {
              analysisMode,
              evidenceMode,
              status,
              minute,
              oddsAvailable,
              statsAvailable,
              referenceMarketKeys,
              deterministicReasons: statsOnlySignal.reasons,
            },
          });
          aiAdvisorySignal = parseStatsOnlyAiAdvisoryResponse(aiAdvisoryText, {
            matchId,
            homeTeam: homeName,
            awayTeam: awayName,
            matchDisplay,
            league,
            minute,
            status,
            score: { home: homeGoals, away: awayGoals },
            stats: statsCompact,
            events: eventsCompact,
            oddsAvailable,
            referenceMarketKeys,
            statsAvailable,
            statsSource,
            evidenceMode,
            providerWarnings,
            providerClockLagMinutes: providerHealth.providerClockLagMinutes,
            deterministicReasons: statsOnlySignal.reasons,
          });
          audit({
            category: 'PIPELINE',
            action: 'STATS_ONLY_AI_ADVISORY_LLM_COMPLETED',
            outcome: 'SUCCESS',
            actor: 'auto-pipeline',
            duration_ms: Date.now() - aiAdvisoryStartedAt,
            metadata: {
              ...buildLlmGatewayAuditMetadata({ promptContext, settings, promptVersion: activePromptVersion, model }),
              matchId,
              matchDisplay,
              signalTriggered: aiAdvisorySignal.triggered,
              signalType: aiAdvisorySignal.signalType,
              signalStrength: aiAdvisorySignal.strength,
              confidence: aiAdvisorySignal.confidence,
              reasons: aiAdvisorySignal.reasons,
              contract: 'odds-first-stats-only-live-signal',
            },
          });
        } catch (err) {
          audit({
            category: 'PIPELINE',
            action: err instanceof AiGatewayBlockedError
              ? 'STATS_ONLY_AI_ADVISORY_LLM_BLOCKED'
              : 'STATS_ONLY_AI_ADVISORY_LLM_FAILED',
            outcome: err instanceof AiGatewayBlockedError ? 'SKIPPED' : 'FAILURE',
            actor: 'auto-pipeline',
            duration_ms: Date.now() - aiAdvisoryStartedAt,
            error: err instanceof Error ? err.message : String(err),
            metadata: {
              ...buildLlmGatewayAuditMetadata({ promptContext, settings, promptVersion: activePromptVersion, model }),
              matchId,
              matchDisplay,
              reason: err instanceof AiGatewayBlockedError ? err.evaluation.reason : undefined,
              contract: 'odds-first-stats-only-live-signal',
            },
          });
        }

        if (aiAdvisorySignal?.triggered) {
          const deliveryResult = await deps.enqueueStatsOnlyLiveSignalDeliveries({
            matchId,
            homeTeam: homeName,
            awayTeam: awayName,
            league,
            status,
            minute,
            score,
            kickoffAtUtc: null,
            signal: aiAdvisorySignal,
            referenceMarketKeys,
          }).catch((error) => {
            audit({
              category: 'PIPELINE',
              action: 'STATS_ONLY_AI_ADVISORY_EMIT_FAILED',
              outcome: 'FAILURE',
              actor: 'auto-pipeline',
              error: error instanceof Error ? error.message : String(error),
              metadata: {
                matchId,
                matchDisplay,
                signalType: aiAdvisorySignal?.signalType,
                triggerKey: aiAdvisorySignal?.triggerKey,
                contract: 'odds-first-stats-only-live-signal',
              },
            });
            return { enqueued: 0, deliveryIds: [] };
          });
          const outputDecision = routeLiveOutput({
            evidenceMode,
            llmCalled: true,
            statsOnlySignalTriggered: true,
            statsOnlySignalEnqueued: deliveryResult.enqueued,
            advisoryOnly,
            shadowMode,
          });

          audit({
            category: 'PIPELINE',
            action: 'STATS_ONLY_AI_ADVISORY_EMITTED',
            outcome: deliveryResult.enqueued > 0 ? 'SUCCESS' : 'SKIPPED',
            actor: 'auto-pipeline',
            metadata: {
              matchId,
              matchDisplay,
              minute,
              score,
              status,
              signalType: aiAdvisorySignal.signalType,
              signalStrength: aiAdvisorySignal.strength,
              triggerKey: aiAdvisorySignal.triggerKey,
              marketFamilyHint: aiAdvisorySignal.marketFamilyHint,
              confidence: aiAdvisorySignal.confidence,
              reasons: aiAdvisorySignal.reasons,
              enqueued: deliveryResult.enqueued,
              deliveryIds: deliveryResult.deliveryIds,
              referenceMarketKeys,
              ...providerDebugMetadata,
              savedRecommendation: false,
              llmCalled: true,
              outputKind: outputDecision.outputKind,
              auditBucket: outputDecision.auditBucket,
              outputDecision,
              contract: 'odds-first-stats-only-live-signal',
            },
          });

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
            decisionKind: 'condition_only',
            shouldPush: deliveryResult.enqueued > 0,
            selection: aiAdvisorySignal.signalType ?? 'stats_only_ai_advisory',
            confidence: Math.round((aiAdvisorySignal.confidence ?? 0) / 10),
            saved: false,
            notified: deliveryResult.enqueued > 0,
            outputKind: outputDecision.outputKind,
            auditBucket: outputDecision.auditBucket,
            debug: {
              analysisRunId,
              shadowMode,
              skippedAt: 'llm_eligibility',
              skipReason: 'stats_only_ai_advisory_emitted',
              analysisMode,
              advisoryOnly,
              oddsSource,
              oddsAvailable,
              statsAvailable,
              statsSource,
              evidenceMode,
              statsFallbackUsed,
              statsFallbackReason: statsFallbackReason || undefined,
              ...providerDebugMetadata,
              statsOnlySignal: {
                ...aiAdvisorySignal,
                enqueued: deliveryResult.enqueued,
                deliveryIds: deliveryResult.deliveryIds,
                llmCalled: true,
                savedRecommendation: false,
              } as unknown as Record<string, unknown>,
              outputDecision,
              outputKind: outputDecision.outputKind,
              auditBucket: outputDecision.auditBucket,
              savedRecommendation: outputDecision.savedRecommendation,
              settlementEligible: outputDecision.settlementEligible,
              roiEligible: outputDecision.roiEligible,
              llmCalled: outputDecision.llmCalled,
              preLlmLatencyMs: Date.now() - startedAt,
              totalLatencyMs: Date.now() - startedAt,
            },
          };
        }

        const weakOutputDecision = routeLiveOutput({
          evidenceMode,
          llmCalled: true,
          statsOnlySignalWeak: true,
          advisoryOnly,
          shadowMode,
        });
        audit({
          category: 'PIPELINE',
          action: 'STATS_ONLY_SIGNAL_SKIPPED_WEAK_TRIGGER',
          outcome: 'SKIPPED',
          actor: 'auto-pipeline',
          metadata: {
            matchId,
            matchDisplay,
            minute,
            score,
            status,
            reasons: statsOnlySignal.reasons,
            aiAdvisoryReasons: aiAdvisorySignal?.reasons,
            aiAdvisoryConfidence: aiAdvisorySignal?.confidence,
            referenceMarketKeys,
            llmCalled: true,
            outputKind: weakOutputDecision.outputKind,
            auditBucket: weakOutputDecision.auditBucket,
            outputDecision: weakOutputDecision,
            ...providerDebugMetadata,
            contract: 'odds-first-stats-only-live-signal',
          },
        });

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
          outputKind: weakOutputDecision.outputKind,
          auditBucket: weakOutputDecision.auditBucket,
          debug: {
            analysisRunId,
            shadowMode,
            skippedAt: 'llm_eligibility',
            skipReason: 'stats_only_signal_weak_trigger',
            analysisMode,
            advisoryOnly,
            oddsSource,
            oddsAvailable,
            statsAvailable,
            statsSource,
            evidenceMode,
            statsFallbackUsed,
            statsFallbackReason: statsFallbackReason || undefined,
            ...providerDebugMetadata,
            statsOnlySignal: {
              ...statsOnlySignal,
              aiAdvisory: aiAdvisorySignal ?? undefined,
              llmCalled: true,
              savedRecommendation: false,
            } as unknown as Record<string, unknown>,
            outputDecision: weakOutputDecision,
            outputKind: weakOutputDecision.outputKind,
            auditBucket: weakOutputDecision.auditBucket,
            savedRecommendation: weakOutputDecision.savedRecommendation,
            settlementEligible: weakOutputDecision.settlementEligible,
            roiEligible: weakOutputDecision.roiEligible,
            llmCalled: weakOutputDecision.llmCalled,
            preLlmLatencyMs: Date.now() - startedAt,
            totalLatencyMs: Date.now() - startedAt,
          },
        };
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
        outputKind: blockedOutputDecision.outputKind,
        auditBucket: blockedOutputDecision.auditBucket,
        debug: {
          analysisRunId,
          shadowMode,
          skippedAt: 'llm_eligibility',
          skipReason: llmEligibility.reason,
          analysisMode,
          advisoryOnly,
          oddsSource,
          oddsAvailable,
          statsAvailable,
          statsSource,
          evidenceMode,
          statsFallbackUsed,
          statsFallbackReason: statsFallbackReason || undefined,
          ...providerDebugMetadata,
          outputDecision: blockedOutputDecision,
          outputKind: blockedOutputDecision.outputKind,
          auditBucket: blockedOutputDecision.auditBucket,
          savedRecommendation: blockedOutputDecision.savedRecommendation,
          settlementEligible: blockedOutputDecision.settlementEligible,
          roiEligible: blockedOutputDecision.roiEligible,
          llmCalled: blockedOutputDecision.llmCalled,
          preLlmLatencyMs: Date.now() - startedAt,
          totalLatencyMs: Date.now() - startedAt,
        },
      };
    }
    // 6. Thesis watch promote (skip Gemini when a deferred LLP thesis is ready)
    const preLlmLatencyMs = Date.now() - startedAt;
    const policyContextForPrompt = {
      previousRecommendations: prevRecs.map((r) => ({
        minute: r.minute ?? null,
        selection: r.selection ?? '',
        bet_market: r.bet_market ?? '',
        stake_percent: r.stake_percent ?? null,
        result: r.result ?? null,
      })),
    };
    const thesisPromoteResult = await executeThesisWatchPromote(
      deps,
      matchId,
      settings,
      promptContext,
      activePromptVersion,
      policyContextForPrompt,
      { shadowMode, advisoryOnly },
    );
    const thesisWatchId = thesisPromoteResult?.thesisWatchId;
    const thesisPromoted = thesisWatchId != null;
    const activeAnalysis = thesisPromoteResult ?? await executePromptAnalysis(
      deps,
      model,
      settings,
      promptContext,
      activePromptVersion,
      policyContextForPrompt,
    );
    const parsed = activeAnalysis.parsed;
    const runtimePolicyShadow = buildRuntimePolicyShadowSignal({
      selection: parsed.selection,
      betMarket: parsed.bet_market,
      minute,
      score,
      odds: parsed.mapped_odd,
      confidence: parsed.confidence,
      valuePercent: parsed.value_percent,
      riskLevel: parsed.risk_level,
      stakePercent: parsed.stake_percent,
      policyBlocked: activeAnalysis.policyBlocked,
      policyWarnings: activeAnalysis.policyWarnings,
      evidenceMode,
      marketResolutionStatus: parsed.market_resolution_status,
      prematchStrength,
      oddsCanonical: oddsCanonical as Record<string, unknown>,
      minOdds: settings.minOdds,
    });
    const runtimeShadowSegments = buildRuntimeShadowSegmentMetadata({
      matchId,
      leagueId: fixture.league?.id,
      leagueName: league,
      homeTeamId,
      homeTeamName: homeName,
      awayTeamId,
      awayTeamName: awayName,
    });
    const runtimePolicyPromotion = evaluateRuntimePolicyProductionPromotion({
      matchId,
      shadowMode,
      advisoryOnly,
      policyBlocked: activeAnalysis.policyBlocked,
      stakePercent: parsed.stake_percent,
      runtimePolicyShadow,
      config: {
        enabled: config.runtimePolicyPromotionEnabled === true,
        killSwitch: config.runtimePolicyPromotionKillSwitch === true,
        pocketIds: Array.isArray(config.runtimePolicyPromotionPocketIds)
          ? config.runtimePolicyPromotionPocketIds
          : [],
        rolloutPercent: Number(config.runtimePolicyPromotionRolloutPercent ?? 0),
        maxStakePercent: Number(config.runtimePolicyPromotionMaxStakePercent ?? 1),
        evidenceAck: String(config.runtimePolicyPromotionEvidenceAck ?? ''),
        owner: String(config.runtimePolicyPromotionOwner ?? ''),
      },
    });
    if (
      config.runtimePolicyPromotionEnabled
      && runtimePolicyShadow.matchedPockets.length > 0
      && !shadowMode
      && !advisoryOnly
    ) {
      audit({
        category: 'PIPELINE',
        action: 'PIPELINE_POLICY_PROMOTION_EVALUATED',
        outcome: runtimePolicyPromotion.promoted ? 'SUCCESS' : 'SKIPPED',
        actor: 'auto-pipeline',
        metadata: {
          matchId,
          matchDisplay,
          ...runtimeShadowSegments,
          promptVersion: activePromptVersion,
          selection: parsed.selection,
          betMarket: parsed.bet_market,
          canonicalMarket: runtimePolicyShadow.canonicalMarket,
          policyBlocked: activeAnalysis.policyBlocked,
          policyWarnings: activeAnalysis.policyWarnings,
          runtimePolicyPromotion,
          saved: false,
          notified: false,
        },
      });
    }
    if (
      !shadowMode
      && !advisoryOnly
      && runtimePolicyShadow.matchedPockets.length > 0
    ) {
      audit({
        category: 'PIPELINE',
        action: 'PIPELINE_POLICY_SHADOW_CANDIDATE',
        outcome: 'SKIPPED',
        actor: 'auto-pipeline',
        metadata: {
          matchId,
          matchDisplay,
          ...runtimeShadowSegments,
          promptVersion: activePromptVersion,
          selection: parsed.selection,
          betMarket: parsed.bet_market,
          canonicalMarket: runtimePolicyShadow.canonicalMarket,
          minute,
          minuteBand: runtimePolicyShadow.minuteBand,
          score,
          scoreState: runtimePolicyShadow.scoreState,
          odds: runtimePolicyShadow.odds,
          confidence: runtimePolicyShadow.confidence,
          valuePercent: runtimePolicyShadow.valuePercent,
          valueBand: runtimePolicyShadow.valueBand,
          riskLevel: runtimePolicyShadow.riskLevel,
          stakePercent: runtimePolicyShadow.stakePercent,
          watchSignalKey: runtimePolicyShadow.watchSignalKey,
          watchSignalLabel: runtimePolicyShadow.watchSignalLabel,
          evidenceMode: runtimePolicyShadow.evidenceMode,
          marketResolutionStatus: runtimePolicyShadow.marketResolutionStatus,
          prematchStrength: runtimePolicyShadow.prematchStrength,
          marketAvailabilityBucket: runtimePolicyShadow.marketAvailabilityBucket,
          policyWarnings: runtimePolicyShadow.policyWarnings,
          matchedPockets: runtimePolicyShadow.matchedPockets,
          saved: false,
          notified: false,
          shadowOnly: true,
        },
      });
    }
    if (
      !shadowMode
      && !advisoryOnly
      && runtimePolicyShadow.hasPolicyBlockedSelection
      && runtimePolicyShadow.matchedPockets.length === 0
    ) {
      audit({
        category: 'PIPELINE',
        action: 'PIPELINE_POLICY_SHADOW_SKIPPED',
        outcome: 'SKIPPED',
        actor: 'auto-pipeline',
        metadata: {
          matchId,
          matchDisplay,
          ...runtimeShadowSegments,
          promptVersion: activePromptVersion,
          selection: parsed.selection,
          betMarket: parsed.bet_market,
          canonicalMarket: runtimePolicyShadow.canonicalMarket,
          minute,
          minuteBand: runtimePolicyShadow.minuteBand,
          score,
          scoreState: runtimePolicyShadow.scoreState,
          odds: runtimePolicyShadow.odds,
          confidence: runtimePolicyShadow.confidence,
          valuePercent: runtimePolicyShadow.valuePercent,
          valueBand: runtimePolicyShadow.valueBand,
          riskLevel: runtimePolicyShadow.riskLevel,
          stakePercent: runtimePolicyShadow.stakePercent,
          watchSignalKey: runtimePolicyShadow.watchSignalKey,
          watchSignalLabel: runtimePolicyShadow.watchSignalLabel,
          evidenceMode: runtimePolicyShadow.evidenceMode,
          marketResolutionStatus: runtimePolicyShadow.marketResolutionStatus,
          prematchStrength: runtimePolicyShadow.prematchStrength,
          marketAvailabilityBucket: runtimePolicyShadow.marketAvailabilityBucket,
          policyWarnings: runtimePolicyShadow.policyWarnings,
          skippedReason: runtimePolicyShadow.skippedReason,
          saved: false,
          notified: false,
          shadowOnly: true,
        },
      });
    }
    if (
      isAutoPipelineLlmContext({
        promptContext,
        shadowMode,
        advisoryOnly,
        settledReplayApprovedTrace: options.settledReplayApprovedTrace === true,
      })
      && (!parsed.should_push || activeAnalysis.policyBlocked)
    ) {
      await writeAutoLlmCooldown({
        promptContext,
        settings,
        reason: activeAnalysis.policyBlocked ? 'policy_blocked' : 'no_bet',
      });
    }
    if (!thesisPromoted && !parsed.final_should_bet) {
      await registerThesisWatchFromLlpBlock({
        matchId,
        minute,
        shadowMode,
        advisoryOnly,
        warnings: parsed.warnings,
        selection: parsed.selection,
        betMarket: parsed.bet_market,
        confidence: parsed.confidence,
        valuePercent: parsed.value_percent,
        stakePercent: parsed.stake_percent,
        riskLevel: parsed.risk_level,
        reasoningEn: parsed.reasoning_en,
        reasoningVi: parsed.reasoning_vi,
        oddsCanonical: oddsCanonical,
        score,
        status,
        evidenceMode,
        statsCompact: statsCompact as unknown as Record<string, unknown>,
        eventsCompact,
      });
    }
    enforceFollowUpLineupAvailability(parsed, {
      userQuestion: options.userQuestion,
      lineupsSnapshot,
    });
    // 8. Persist and notify only for actionable AI recommendations. User
    // condition alerts now live in the dedicated match-alert engine.
    let shouldSave = advisoryOnly ? false : parsed.final_should_bet;
    let shouldNotify = advisoryOnly ? false : parsed.should_push;
    if (runtimePolicyPromotion.promoted) {
      shouldSave = true;
      shouldNotify = true;
      parsed.should_push = true;
      parsed.system_should_bet = true;
      parsed.final_should_bet = true;
      parsed.decision_kind = 'ai_push';
      parsed.llm_decision_diagnostic = 'actionable';
      parsed.stake_percent = runtimePolicyPromotion.stakePercent ?? parsed.stake_percent;
      parsed.warnings = [...parsed.warnings, 'RUNTIME_POLICY_PROMOTION_CONTROLLED'];
      parsed.ai_warnings = [...parsed.ai_warnings, 'RUNTIME_POLICY_PROMOTION_CONTROLLED'];
    }
    const notificationSelection = displaySelection(parsed);
    const notificationConfidence = displayConfidence(parsed);
    const notificationOdds = extractOddsFromSelection(parsed.selection, parsed.bet_market, oddsCanonical);
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
    let saveIntegrityStatus: 'not_attempted' | 'ok' | 'blocked' = shouldSave ? 'ok' : 'not_attempted';
    let saveBlockedReason: string | undefined = undefined;
    let saveProviderCoverageStatus: RecommendationSaveIntegrityResult['providerCoverageStatus'] | undefined;
    let analysisSignalDeliveriesLoaded = false;

    const stageVisibleAnalysisSignal = async () => {
      if (
        analysisSignalDeliveriesLoaded
        || recId != null
        || shouldSave
        || shadowMode
        || advisoryOnly
      ) {
        return;
      }
      analysisSignalDeliveriesLoaded = true;

      const hasWatchPocket = runtimePolicyShadow.matchedPockets.length > 0;
      const signalKind = hasWatchPocket ? 'watch' : 'no_action';
      const watchDetail = runtimePolicyShadow.matchedPockets
        .map((pocket) => pocket.label)
        .filter(Boolean)
        .join('; ');
      const policyDetail = activeAnalysis.policyBlocked
        ? `Policy blocked: ${activeAnalysis.policyWarnings.join(', ') || parsed.llm_decision_diagnostic}`
        : '';
      const saveDetail = saveIntegrityStatus === 'blocked'
        ? `Save blocked: ${saveBlockedReason || 'save_integrity_blocked'}`
        : '';
      const marketDetail = parsed.market_resolution_status !== 'resolved'
        ? `Market resolution: ${parsed.market_resolution_status}`
        : '';
      const noActionDetail = saveDetail
        || policyDetail
        || marketDetail
        || (parsed.llm_decision_diagnostic === 'no_bet_intentional'
          ? 'AI reviewed the match and chose no bet.'
          : `Decision diagnostic: ${parsed.llm_decision_diagnostic}`);

      await deps.stageAnalysisSignalDeliveries({
        query,
      }, {
        match_id: matchId,
        signal_kind: signalKind,
        signal_label: signalKind === 'watch' ? 'Watch' : 'No Action',
        signal_detail: signalKind === 'watch'
          ? (watchDetail || 'Policy-shadow watch candidate; no bet staged.')
          : noActionDetail,
        timestamp: new Date().toISOString(),
        minute,
        score,
        status,
        league,
        home_team: homeName,
        away_team: awayName,
        selection: signalKind === 'watch' ? parsed.selection : 'No actionable signal',
        bet_market: signalKind === 'watch' && runtimePolicyShadow.canonicalMarket !== 'unknown'
          ? runtimePolicyShadow.canonicalMarket
          : null,
        odds: signalKind === 'watch' ? parsed.mapped_odd : null,
        confidence: parsed.confidence,
        value_percent: parsed.value_percent,
        risk_level: parsed.risk_level,
        stake_percent: 0,
        reasoning: parsed.reasoning_en,
        reasoning_vi: parsed.reasoning_vi,
        warnings: parsed.warnings.join(', '),
        ai_model: model,
        mode: analysisMode,
        prompt_version: activePromptVersion,
        evidence_mode: evidenceMode,
        llm_decision_diagnostic: parsed.llm_decision_diagnostic,
        market_resolution_status: parsed.market_resolution_status,
        policy_warnings: activeAnalysis.policyWarnings,
        runtime_shadow: runtimePolicyShadow as unknown as Record<string, unknown>,
      }).catch(() => []);
    };

    if (shouldSave && !shadowMode) {
      const savedSelection = parsed.selection;
      const savedBetMarket = parsed.bet_market;
      const mappedOdd = extractOddsFromSelection(parsed.selection, parsed.bet_market, oddsCanonical);
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
      decisionContext['recommendationSource'] = thesisPromoted
        ? 'thesis_watch_promote'
        : runtimePolicyPromotion.promoted
          ? 'runtime_policy_promotion'
        : 'ai_primary';
      if (runtimePolicyPromotion.promoted) {
        decisionContext['runtimePolicyPromotion'] = runtimePolicyPromotion as unknown as Record<string, unknown>;
        decisionContext['runtimePolicyShadow'] = runtimePolicyShadow as unknown as Record<string, unknown>;
        decisionContext['runtimePolicyPromotionPocketId'] = runtimePolicyPromotion.pocketId;
        decisionContext['runtimePolicyPromotionReason'] = runtimePolicyPromotion.reason;
        decisionContext['runtimePolicyPromotionOwner'] = runtimePolicyPromotion.owner;
      }
      if (thesisPromoted) {
        decisionContext['thesisWatchPromoted'] = true;
        decisionContext['thesisWatchId'] = thesisWatchId;
        decisionContext['thesisWatchPromoteReason'] =
          activeAnalysis.thesisWatchPromotion?.promoteReason ?? {};
      }
      const saveIntegrity = evaluateRecommendationSaveIntegrity({
        selection: savedSelection,
        betMarket: savedBetMarket,
        mappedOdd,
        minOdds: settings.minOdds,
      });
      saveIntegrityStatus = saveIntegrity.ok ? 'ok' : 'blocked';
      saveBlockedReason = saveIntegrity.ok ? undefined : saveIntegrity.reason;
      saveProviderCoverageStatus = saveIntegrity.providerCoverageStatus;
      decisionContext['saveIntegrityStatus'] = saveIntegrityStatus;
      decisionContext['saveProviderCoverageStatus'] = saveIntegrity.providerCoverageStatus;
      decisionContext['saveMarketResolutionStatus'] = saveIntegrity.marketResolutionStatus;
      decisionContext['saveMappedOdd'] = saveIntegrity.mappedOdd;
      decisionContext['saveIntegrityReason'] = saveIntegrity.reason;
      decisionContext['savedSelection'] = savedSelection;
      decisionContext['savedBetMarket'] = savedBetMarket;
      decisionContext['oddsSource'] = oddsSource;
      decisionContext['oddsAvailable'] = oddsAvailable;
      decisionContext['providerHealth'] = providerHealth as unknown as Record<string, unknown>;
      decisionContext['providerWarnings'] = providerWarnings;
      decisionContext['providerCoverageStatus'] = providerHealth.coverageStatus;
      decisionContext['providerReturnedNoLiveStatistics'] = providerHealth.providerReturnedNoLiveStatistics;
      decisionContext['providerClockLagMinutes'] = providerHealth.providerClockLagMinutes;
      decisionContext['providerClockLagStatus'] = providerHealth.providerClockLagStatus;
      decisionContext['canonicalMarket'] = normalizeMarket(savedSelection, savedBetMarket);
      if (!saveIntegrity.ok) {
        parsed.warnings = [...parsed.warnings, 'PROVIDER_COVERAGE_SAVE_BLOCKED'];
        parsed.ai_warnings = [...parsed.ai_warnings, 'PROVIDER_COVERAGE_SAVE_BLOCKED'];
        shouldSave = false;
        shouldNotify = false;
        audit({
          category: 'PIPELINE',
          action: 'RECOMMENDATION_SAVE_BLOCKED_PROVIDER_COVERAGE',
          outcome: 'SKIPPED',
          actor: 'auto-pipeline',
          metadata: {
            matchId,
            matchDisplay,
            selection: savedSelection,
            betMarket: savedBetMarket,
            mappedOdd,
            minOdds: settings.minOdds,
            oddsSource,
            oddsAvailable,
            saveProviderCoverageStatus: saveIntegrity.providerCoverageStatus,
            marketResolutionStatus: saveIntegrity.marketResolutionStatus,
            reason: saveIntegrity.reason,
            recommendationSource: decisionContext['recommendationSource'],
            runtimePolicyPromotion,
            promptVersion: activePromptVersion,
            llmDecisionDiagnostic: parsed.llm_decision_diagnostic,
            ...providerDebugMetadata,
          },
        });
      }
      if (!saveIntegrity.ok) {
        // Do not create a recommendation row from a market line that cannot be
        // proven against the canonical provider snapshot.
      } else {
      const rec = await deps.createRecommendation({
        match_id: matchId,
        timestamp: new Date().toISOString(),
        league,
        home_team: homeName,
        away_team: awayName,
        status,
        condition_triggered_suggestion: '',
        custom_condition_raw: '',
        execution_id: `auto-pipeline-${Date.now()}`,
        odds_snapshot: oddsCanonical as Record<string, unknown>,
        stats_snapshot: statsCompact as unknown as Record<string, unknown>,
        decision_context: decisionContext,
        prompt_version: activePromptVersion,
        custom_condition_matched: false,
        minute,
        score,
        bet_type: 'AI',
        selection: savedSelection,
        odds: mappedOdd,
        confidence: parsed.confidence,
        value_percent: parsed.value_percent,
        risk_level: parsed.risk_level,
        stake_percent: parsed.stake_percent,
        reasoning: parsed.reasoning_en,
        reasoning_vi: parsed.reasoning_vi,
        key_factors: '',
        warnings: parsed.warnings.join(', '),
        ai_model: model,
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
            ai_confidence: parsed.confidence,
            ai_should_push: parsed.ai_should_push,
            predicted_market: savedBetMarket || '',
            predicted_selection: savedSelection,
            predicted_odds: mappedOdd ? Number(mappedOdd) : null,
            match_minute: minute,
            match_score: score,
            league: league,
          });
        } catch { /* non-critical — duplicate key or other */ }
      }

      if (thesisWatchId != null) {
        try {
          await markThesisWatchPromoted(thesisWatchId, {
            recommendationId: rec.id,
            promoteSnapshot: activeAnalysis.thesisWatchPromotion?.promoteSnapshot,
            promoteReason: activeAnalysis.thesisWatchPromotion?.promoteReason,
          });
        } catch (err) {
          console.warn(
            '[thesis-watch] Failed to mark watch promoted after save:',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      }
    }

    await stageVisibleAnalysisSignal();

    // 9. Telegram delivery is intentionally asynchronous. Recommendation rows
    // stage delivery rows inside createRecommendation(); a dedicated delivery
    // job flushes Telegram messages so the live pipeline does not block on
    // network sends.
    if (shouldNotify && !shadowMode && settings.telegramEnabled) {
      // Async Telegram delivery is queued via delivery rows. We keep the
      // high-level notified flag truthy once the alert is staged so pipeline
      // reporting still reflects user-visible alert intent without blocking on
      // the Telegram network round-trip.
      notified = true;
    }

    // 10. Web Push follows the same recommendation-only semantics.
    if (shouldNotify && !shadowMode && settings.webPushEnabled && isWebPushConfigured() && recId != null) {
      try {
        const subscriptions = await getAllSubscriptions();
        let eligibleUserIds = await deps.getEligibleDeliveryUserIds(recId).catch(() => new Set<string>());
        if (eligibleUserIds.size > 0) {
          const allowed = await deps.filterUserIdsAllowingWebPushNotifications([...eligibleUserIds]);
          eligibleUserIds = new Set([...eligibleUserIds].filter((id) => allowed.has(id)));
        }
        const targetSubscriptions = eligibleUserIds.size > 0
          ? subscriptions.filter((sub) => eligibleUserIds.has(sub.user_id))
          : [];

        if (targetSubscriptions.length > 0) {
          const pushOpenUrl = buildWebPushMatchOpenUrl(config.frontendUrl, matchId, matchDisplay);
          const pushBody = [
            matchDisplay,
            notificationSelectionDisplay ? `${notificationSelectionDisplay} | Odds: ${notificationOdds ?? 'N/A'} | Confidence: ${notificationConfidence}/10` : '',
            `Open match: ${pushOpenUrl}`,
          ].filter(Boolean).join('\n');
          const pushNavigateUrl =
            `/?tab=matches&match=${encodeURIComponent(String(matchId))}&matchDisplay=${encodeURIComponent(matchDisplay)}`;

          const deliveredUserIds = new Set<string>();

          await Promise.all(targetSubscriptions.map(async (sub) => {
            const result = await sendWebPushNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              {
                title: 'RECOMMENDATION',
                body: pushBody,
                tag: `tfi-rec-${matchId}`,
                url: pushNavigateUrl,
                icon: '/icons/notification-recommendation.svg',
                actions: [{ action: 'invest', title: 'Invest' }],
              },
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
          if (deliveredUserIds.size > 0) notified = true;
        }
      } catch (e) {
        console.error(`[pipeline] Web Push notification failed for ${matchId}:`, e instanceof Error ? e.message : String(e));
      }
    }

    const outputDecision = routeLiveOutput({
      evidenceMode,
      llmCalled: true,
      advisoryOnly,
      shadowMode,
      saved,
      notified,
      parsedShouldPush: parsed.should_push,
      parsedFinalShouldBet: parsed.final_should_bet,
      policyBlocked: activeAnalysis.policyBlocked,
      policyWarnings: activeAnalysis.policyWarnings,
      marketResolutionStatus: parsed.market_resolution_status,
      llmDecisionDiagnostic: parsed.llm_decision_diagnostic,
      saveIntegrityStatus,
      saveBlockedReason,
      runtimePolicyShadowMatched: runtimePolicyShadow.matchedPockets.length > 0,
      shadowCandidatePresent: Boolean(String(parsed.shadow_candidate?.selection ?? '').trim()),
    });

    if (!shadowMode && !advisoryOnly) {
      audit({
        category: 'PIPELINE',
        action: 'PIPELINE_MATCH_ANALYZED',
        outcome: parsed.should_push ? 'SUCCESS' : 'SKIPPED',
        actor: 'auto-pipeline',
        metadata: {
          matchId, matchDisplay, homeName, awayName, league,
          minute, score, status,
          selection: notificationSelectionDisplay,
          rawSelection: parsed.selection,
          rawBetMarket: parsed.bet_market,
          betMarket: parsed.bet_market,
          mappedOdd: parsed.mapped_odd,
          odds: parsed.mapped_odd,
          valuePercent: parsed.value_percent,
          riskLevel: parsed.risk_level,
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
          ...providerDebugMetadata,
          evidenceMode,
          llmDecisionDiagnostic: parsed.llm_decision_diagnostic,
          marketResolutionStatus: parsed.market_resolution_status,
          runtimePolicyShadow,
          runtimePolicyPromotion,
          ...buildShadowCandidateAuditMetadata(parsed.shadow_candidate),
          saveIntegrityStatus,
          saveBlockedReason,
          saveProviderCoverageStatus,
          outputKind: outputDecision.outputKind,
          auditBucket: outputDecision.auditBucket,
          outputDecision,
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
      outputKind: outputDecision.outputKind,
      auditBucket: outputDecision.auditBucket,
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
        ...providerDebugMetadata,
        outputDecision,
        outputKind: outputDecision.outputKind,
        auditBucket: outputDecision.auditBucket,
        savedRecommendation: outputDecision.savedRecommendation,
        settlementEligible: outputDecision.settlementEligible,
        roiEligible: outputDecision.roiEligible,
        llmCalled: outputDecision.llmCalled,
        llmDecisionDiagnostic: parsed.llm_decision_diagnostic,
        marketResolutionStatus: parsed.market_resolution_status,
        runtimePolicyShadow,
        runtimePolicyPromotion,
        shadowCandidate: parsed.shadow_candidate as unknown as Record<string, unknown>,
        saveIntegrityStatus,
        saveBlockedReason,
        saveProviderCoverageStatus,
        statsFallbackUsed,
        statsFallbackReason: statsFallbackReason || undefined,
        promptVersion: activePromptVersion,
        promptDataLevel,
        prematchAvailability,
        prematchNoisePenalty,
        prematchStrength,
        strategicContextOnDemandAttempted,
        strategicContextOnDemandApplied,
        strategicContextOnDemandError: strategicContextOnDemandError || undefined,
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
    const outputDecision = routeLiveOutput({
      evidenceMode: 'low_evidence',
      llmCalled: false,
      llmEligibilityReason: 'pipeline_error',
      advisoryOnly,
      shadowMode,
    });

    if (!shadowMode) {
      audit({
        category: 'PIPELINE',
        action: 'PIPELINE_MATCH_ERROR',
        outcome: 'FAILURE',
        actor: 'auto-pipeline',
        error: errMsg,
        metadata: {
          matchId,
          outputKind: outputDecision.outputKind,
          auditBucket: outputDecision.auditBucket,
          outputDecision,
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
      success: false, decisionKind: 'no_bet', shouldPush: false,
      selection: '', confidence: 0,
      saved: false, notified: false, error: errMsg,
      outputKind: outputDecision.outputKind,
      auditBucket: outputDecision.auditBucket,
      debug: {
        analysisRunId,
        shadowMode,
        advisoryOnly,
        outputDecision,
        outputKind: outputDecision.outputKind,
        auditBucket: outputDecision.auditBucket,
        savedRecommendation: outputDecision.savedRecommendation,
        settlementEligible: outputDecision.settlementEligible,
        roiEligible: outputDecision.roiEligible,
        llmCalled: outputDecision.llmCalled,
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
    sampleProviderData?: boolean;
    ensureStrategicContext?: boolean;
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
    sampleProviderData: options.sampleProviderData === true,
    forceAnalyze: options.forceAnalyze,
    skipProceedGate: true,
    skipStalenessGate: true,
    modelOverride: options.modelOverride,
    promptVersionOverride: options.promptVersionOverride,
    userQuestion: options.userQuestion,
    followUpHistory: options.followUpHistory,
    advisoryOnly: options.advisoryOnly,
    ensureStrategicContext: options.ensureStrategicContext,
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
    ensureStrategicContext?: boolean;
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
    ensureStrategicContext: options.ensureStrategicContext,
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
