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
  type ApiFixtureStat,
} from './football-api.js';
import { ensureFixturesForMatchIds, ensureMatchInsight } from './provider-insight-cache.js';
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
import { fetchLiveScoreBenchmarkTrace } from './live-score-api.js';
import { fetchDeterministicWebLiveFallback } from './web-live-fallback.js';
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
import {
  buildPrematchExpertFeaturesV1,
  getPrematchPriorStrength,
  type PrematchExpertFeaturesV1,
  type PrematchFeatureAvailability,
  type PrematchPriorStrength,
} from './prematch-expert-features.js';

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
  fetchLiveScoreBenchmarkTrace,
  fetchDeterministicWebLiveFallback,
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
  } | null;
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

interface OddsCanonical {
  '1x2'?: { home: number | null; draw: number | null; away: number | null };
  ou?: { line: number; over: number | null; under: number | null };
  ah?: { line: number; home: number | null; away: number | null };
  btts?: { yes: number | null; no: number | null };
  corners_ou?: { line: number; over: number | null; under: number | null };
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

type StatsSource = 'api-football' | 'live-score-api-fallback' | 'web-trusted-fallback';
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
  condition_triggered_should_push: boolean;
  ai_selection: string;
  ai_confidence: number;
  ai_odd_raw: number | null;
  ai_warnings: string[];
  usable_odd: number | null;
  mapped_odd: number | null;
  odds_for_display: number | string | null;
}

function isMarketAllowedForEvidenceMode(betMarket: string, evidenceMode: EvidenceMode): boolean {
  const market = (betMarket || '').toLowerCase();
  if (!market) return false;

  switch (evidenceMode) {
    case 'full_live_data':
      return true;
    case 'stats_only':
      return false;
    case 'odds_events_only_degraded':
      return market.startsWith('over_')
        || market.startsWith('under_')
        || market.startsWith('asian_handicap_');
    case 'events_only_degraded':
    case 'low_evidence':
    default:
      return false;
  }
}

function parseLineSuffix(prefix: string, betMarket: string): number | null {
  if (!betMarket.startsWith(prefix)) return null;
  const raw = betMarket.slice(prefix.length);
  if (!raw) return null;
  const line = Number(raw);
  return Number.isFinite(line) ? line : null;
}

function sameLine(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.001;
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
    promptChars?: number;
    promptEstimatedTokens?: number;
    aiTextChars?: number;
    aiTextEstimatedTokens?: number;
    llmLatencyMs?: number;
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

function countPrimaryPopulatedStatPairs(statsCompact: StatsCompact): number {
  const tracked = [
    statsCompact.possession,
    statsCompact.shots,
    statsCompact.shots_on_target,
    statsCompact.corners,
    statsCompact.fouls,
  ];
  return tracked.filter((value) => value.home != null && value.away != null).length;
}

function mergeStatsCompact(primary: StatsCompact, fallback: StatsCompact): StatsCompact {
  const mergeStatPair = (
    first: { home: string | null; away: string | null } | undefined,
    second: { home: string | null; away: string | null } | undefined,
  ) => ({
    home: first?.home ?? second?.home ?? null,
    away: first?.away ?? second?.away ?? null,
  });

  return {
    possession: mergeStatPair(primary.possession, fallback.possession),
    shots: mergeStatPair(primary.shots, fallback.shots),
    shots_on_target: mergeStatPair(primary.shots_on_target, fallback.shots_on_target),
    corners: mergeStatPair(primary.corners, fallback.corners),
    fouls: mergeStatPair(primary.fouls, fallback.fouls),
    offsides: mergeStatPair(primary.offsides, fallback.offsides),
    yellow_cards: mergeStatPair(primary.yellow_cards, fallback.yellow_cards),
    red_cards: mergeStatPair(primary.red_cards, fallback.red_cards),
    goalkeeper_saves: mergeStatPair(primary.goalkeeper_saves, fallback.goalkeeper_saves),
    blocked_shots: mergeStatPair(primary.blocked_shots, fallback.blocked_shots),
    total_passes: mergeStatPair(primary.total_passes, fallback.total_passes),
    passes_accurate: mergeStatPair(primary.passes_accurate, fallback.passes_accurate),
    shots_off_target: mergeStatPair(primary.shots_off_target, fallback.shots_off_target),
    shots_inside_box: mergeStatPair(primary.shots_inside_box, fallback.shots_inside_box),
    shots_outside_box: mergeStatPair(primary.shots_outside_box, fallback.shots_outside_box),
    expected_goals: mergeStatPair(primary.expected_goals, fallback.expected_goals),
    goals_prevented: mergeStatPair(primary.goals_prevented, fallback.goals_prevented),
    passes_percent: mergeStatPair(primary.passes_percent, fallback.passes_percent),
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
}

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
  const parsed = parseAiResponse(
    aiText,
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
    aiText,
    aiTextChars,
    aiTextEstimatedTokens,
    llmLatencyMs,
    totalLatencyMs: Date.now() - startedAt,
    parsed,
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

function toCompactPair(home: number | null, away: number | null): { home: string | null; away: string | null } {
  return {
    home: home != null ? String(home) : null,
    away: away != null ? String(away) : null,
  };
}

function buildStatsCompactFromWebFallback(stats: {
  possession: { home: number | null; away: number | null };
  shots: { home: number | null; away: number | null };
  shots_on_target: { home: number | null; away: number | null };
  corners: { home: number | null; away: number | null };
  fouls: { home: number | null; away: number | null };
  yellow_cards: { home: number | null; away: number | null };
  red_cards: { home: number | null; away: number | null };
}): StatsCompact {
  return {
    possession: toCompactPair(stats.possession.home, stats.possession.away),
    shots: toCompactPair(stats.shots.home, stats.shots.away),
    shots_on_target: toCompactPair(stats.shots_on_target.home, stats.shots_on_target.away),
    corners: toCompactPair(stats.corners.home, stats.corners.away),
    fouls: toCompactPair(stats.fouls.home, stats.fouls.away),
    offsides: { home: null, away: null },
    yellow_cards: toCompactPair(stats.yellow_cards.home, stats.yellow_cards.away),
    red_cards: toCompactPair(stats.red_cards.home, stats.red_cards.away),
    goalkeeper_saves: { home: null, away: null },
    blocked_shots: { home: null, away: null },
    total_passes: { home: null, away: null },
    passes_accurate: { home: null, away: null },
    shots_off_target: { home: null, away: null },
    shots_inside_box: { home: null, away: null },
    shots_outside_box: { home: null, away: null },
    expected_goals: { home: null, away: null },
    goals_prevented: { home: null, away: null },
    passes_percent: { home: null, away: null },
  };
}

function buildEventsCompactFromWebFallback(
  events: Array<{ minute: number | null; team: 'home' | 'away' | 'unknown'; type: string; detail: string; player: string }>,
  homeName: string,
  awayName: string,
): EventCompact[] {
  return events
    .map((event) => ({
      minute: event.minute ?? 0,
      extra: null,
      team: event.team === 'home' ? homeName : event.team === 'away' ? awayName : '',
      type: event.type === 'yellow_card' || event.type === 'red_card' ? 'card' : event.type,
      detail: event.detail,
      player: event.player,
    }))
    .filter((event) => event.minute > 0 && Boolean(event.team || event.player || event.detail));
}

function hasCriticalWebFallbackMismatch(reasons: string[]): boolean {
  return reasons.some((reason) => [
    'HOME_TEAM_MISMATCH',
    'AWAY_TEAM_MISMATCH',
    'SCORE_MISMATCH',
    'STATUS_MISMATCH',
    'MINUTE_TOO_FAR',
  ].includes(reason));
}

// ==================== Build Odds Canonical ====================

function buildOddsCanonical(oddsResponse: unknown[]): { canonical: OddsCanonical; available: boolean } {
  if (!oddsResponse || !Array.isArray(oddsResponse) || oddsResponse.length === 0) {
    return { canonical: {}, available: false };
  }

  const resp = oddsResponse as Array<{ bookmakers?: Array<{ name: string; bets: Array<{ name: string; values: Array<{ value: string; odd: string; handicap?: string }> }> }> }>;
  const bookmakers = resp[0]?.bookmakers || [];
  if (bookmakers.length === 0) return { canonical: {}, available: false };

  const oddsMap: Record<string, number> = {};
  const best1X2 = { home: 0, draw: 0, away: 0 };
  const bestBTTS = { yes: 0, no: 0 };

  for (const bk of bookmakers) {
    for (const bet of bk.bets || []) {
      const betName = String(bet.name || '').toLowerCase();
      const values = bet.values || [];
      const isHalf = /1st half|2nd half|first half|second half|\bht\b|\b1h\b|\b2h\b|half.?time/i.test(betName);
      if (isHalf) continue;

      // 1X2
      if (betName.includes('1x2') || betName.includes('match winner') || betName.includes('fulltime result') || betName === 'full time result') {
        for (const v of values) {
          const label = String(v.value || '').toLowerCase().trim();
          const odd = toNumber(v.odd) ?? 0;
          if (!odd || odd <= 1) continue;
          if (label === 'home' || label === '1') best1X2.home = Math.max(best1X2.home, odd);
          if (label === 'draw' || label === 'x') best1X2.draw = Math.max(best1X2.draw, odd);
          if (label === 'away' || label === '2') best1X2.away = Math.max(best1X2.away, odd);
        }
      }

      // Over/Under
      if (betName.includes('over/under') || betName.includes('over / under') || betName.includes('total goals') || betName.includes('match goals')) {
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
          if (!(key in oddsMap) || odd > (oddsMap[key] ?? 0)) oddsMap[key] = odd;
        }
      }

      // BTTS
      if (betName.includes('both teams') || betName === 'btts') {
        for (const v of values) {
          const label = String(v.value || '').toLowerCase().trim();
          const odd = toNumber(v.odd) ?? 0;
          if (!odd || odd <= 1) continue;
          if (label === 'yes') bestBTTS.yes = Math.max(bestBTTS.yes, odd);
          if (label === 'no') bestBTTS.no = Math.max(bestBTTS.no, odd);
        }
      }

      // Asian Handicap
      if (betName.includes('handicap')) {
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
          if (!(key in oddsMap) || odd > (oddsMap[key] ?? 0)) oddsMap[key] = odd;
        }
      }

      // Corners
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
          if (key && (!(key in oddsMap) || odd > (oddsMap[key] ?? 0))) oddsMap[key] = odd;
        }
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

  // Build main OU line
  canonical['ou'] = buildMainOU(oddsMap, /^(over|under)\s+[0-9]+(\.[0-9]+)?$/, /^(over|under)\s+([0-9]+(\.[0-9]+)?)/);
  // Corners OU
  canonical['corners_ou'] = buildMainOU(oddsMap, /^corners\s+(over|under)\s+[0-9]+(\.[0-9]+)?$/, /^corners\s+(over|under)\s+([0-9]+(\.[0-9]+)?)/);
  // AH
  canonical['ah'] = buildMainAH(oddsMap);
  // BTTS
  if (bestBTTS.yes > 0 || bestBTTS.no > 0) {
    canonical['btts'] = { yes: bestBTTS.yes || null, no: bestBTTS.no || null };
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
  if (canonical['ah'] && canonical['ah'].home !== null && canonical['ah'].away !== null) {
    const t = ip(canonical['ah'].home) + ip(canonical['ah'].away);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ah'];
  }
  if (canonical['btts'] && canonical['btts'].yes !== null && canonical['btts'].no !== null) {
    const t = ip(canonical['btts'].yes) + ip(canonical['btts'].no);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['btts'];
  }
  if (canonical['corners_ou'] && canonical['corners_ou'].over !== null && canonical['corners_ou'].under !== null) {
    const t = ip(canonical['corners_ou'].over) + ip(canonical['corners_ou'].under);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['corners_ou'];
  }

  const hasAnyMarket = !!(canonical['1x2'] || canonical['ou'] || canonical['ah'] || canonical['btts'] || canonical['corners_ou']);
  return { canonical, available: hasAnyMarket };
}

function sanitizePromptOddsCanonical(args: {
  canonical: OddsCanonical;
  homeGoals: number;
  awayGoals: number;
  currentTotalGoals: number;
  currentTotalCorners: number | null;
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

  if (typeof sanitized.ou?.line === 'number' && args.currentTotalGoals > sanitized.ou.line) {
    removeMarket(
      'ou',
      `Removed goals O/U market from prompt: current total goals ${args.currentTotalGoals} already exceeds line ${sanitized.ou.line}.`,
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

  const available = !!(
    sanitized['1x2']
    || sanitized['ou']
    || sanitized['ah']
    || sanitized['btts']
    || sanitized['corners_ou']
  );

  return {
    canonical: sanitized,
    available,
    warnings,
    suspicious: false,
  };
}

function buildMainOU(
  oddsMap: Record<string, number>,
  regexKey: RegExp,
  regexParse: RegExp,
): { line: number; over: number | null; under: number | null } | undefined {
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
  for (const [lineStr, data] of lineMap) {
    const o = data['over'];
    const u = data['under'];
    if (o && u) {
      const spread = Math.abs(o - u);
      if (spread < bestSpread) { bestSpread = spread; bestLine = lineStr; }
    }
  }
  if (!bestLine) {
    const sorted = Array.from(lineMap.keys()).map(Number).filter(Number.isFinite).sort((a, b) => Math.abs(a) - Math.abs(b));
    if (!sorted.length) return undefined;
    bestLine = String(sorted[0]);
  }
  const bestData = lineMap.get(bestLine) || {};
  return { line: Number(bestLine), over: bestData['over'] ?? null, under: bestData['under'] ?? null };
}

function buildMainAH(oddsMap: Record<string, number>): { line: number; home: number | null; away: number | null } | undefined {
  const entries = Object.entries(oddsMap).filter(([k]) => /^(home|away)\s+[-+]?[0-9]+(\.[0-9]+)?$/.test(k));
  if (!entries.length) return undefined;

  const lineMap = new Map<string, Record<string, number>>();
  for (const [k, odd] of entries) {
    const m = k.match(/^(home|away)\s+([-+]?[0-9]+(\.[0-9]+)?)/);
    if (!m?.[1] || !m[2]) continue;
    const lineStr = m[2];
    if (!Number.isFinite(Number(lineStr))) continue;
    if (!lineMap.has(lineStr)) lineMap.set(lineStr, {});
    lineMap.get(lineStr)![m[1]] = Math.max(lineMap.get(lineStr)![m[1]] || 0, odd);
  }

  let bestLine: string | null = null;
  let bestSpread = Infinity;
  for (const [lineStr, data] of lineMap) {
    if (data['home'] && data['away']) {
      const spread = Math.abs(data['home'] - data['away']);
      if (spread < bestSpread) { bestSpread = spread; bestLine = lineStr; }
    }
  }
  if (!bestLine) return undefined;
  const best = lineMap.get(bestLine) || {};
  return { line: Number(bestLine), home: best['home'] ?? null, away: best['away'] ?? null };
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
    condition_triggered_should_push: false,
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
  const normalizedConditionMarket = conditionTriggeredSuggestion
    ? normalizeMarket(conditionTriggeredSuggestion)
    : 'unknown';
  // Condition-trigger path: this is a notification-only branch. It represents
  // "the watchlist condition is satisfied and the condition suggestion is
  // actionable enough to alert the user". It does NOT imply DB persistence.
  const conditionTriggeredShouldPush =
    customConditionMatched
    && customConditionStatus === 'evaluated'
    && conditionTriggeredConfidence >= MIN_CONFIDENCE
    && !!conditionTriggeredSuggestion
    && !conditionTriggeredSuggestion.toLowerCase().startsWith('no bet')
    && normalizedConditionMarket !== 'unknown';
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
    condition_triggered_should_push: conditionTriggeredShouldPush,
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

  const goalOverLine = parseLineSuffix('over_', market);
  if (goalOverLine !== null) {
    return sameLine(goalOverLine, oc.ou?.line) ? (oc.ou?.over ?? null) : null;
  }

  const goalUnderLine = parseLineSuffix('under_', market);
  if (goalUnderLine !== null) {
    return sameLine(goalUnderLine, oc.ou?.line) ? (oc.ou?.under ?? null) : null;
  }

  const ahHomeLine = parseLineSuffix('asian_handicap_home_', market);
  if (ahHomeLine !== null) {
    return sameLine(ahHomeLine, oc.ah?.line) ? (oc.ah?.home ?? null) : null;
  }

  const ahAwayLine = parseLineSuffix('asian_handicap_away_', market);
  if (ahAwayLine !== null) {
    return sameLine(ahAwayLine, oc.ah?.line) ? (oc.ah?.away ?? null) : null;
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
  eventsCompact: EventCompact[],
): string {
  const isRec = isAiRecommendation(parsed);
  const isCondition = isConditionOnlyTrigger(parsed) || parsed.custom_condition_matched;
  const emoji = isRec ? '🎯' : isCondition ? '⚡' : '📊';
  const label = isRec ? 'AI RECOMMENDATION' : isCondition ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';
  const selection = displaySelection(parsed);
  const confidence = displayConfidence(parsed);
  const stake = displayStake(parsed);

  const INTERNAL = new Set(['FORCE_MODE', 'EARLY_GAME_RISK']);

  let text = `<b>${emoji} ${label}</b>\n`;
  text += `<b>${safeHtml(matchDisplay)}</b>\n`;
  text += `${safeHtml(league)}\n`;
  text += `⏱ ${safeHtml(String(minute))}' | 📋 ${safeHtml(score)} | ${safeHtml(status)}\n`;
  text += `🤖 ${safeHtml(model)} | Mode: ${safeHtml(mode)}\n`;

  if (isRec) {
    text += `\n<b>💰 ${safeHtml(selection)}</b>\n`;
    text += `Confidence: ${confidence}/10 | Stake: ${stake}% | Risk: ${safeHtml(parsed.risk_level)} | Value: ${parsed.value_percent}%\n`;
    const reasoning = pickReasoning(parsed, lang);
    if (reasoning) text += `\n${safeHtml(truncateAtWord(reasoning, 680))}\n`;
  } else if (isCondition) {
    if (selection) text += `\n<b>⚡ ${safeHtml(selection)}</b>\n`;
    text += `Confidence: ${confidence}/10 | Stake: ${stake}%\n`;
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
): string {
  const isRec = isAiRecommendation(parsed);
  const isCondition = isConditionOnlyTrigger(parsed) || parsed.custom_condition_matched;
  const INTERNAL = new Set(['FORCE_MODE', 'EARLY_GAME_RISK']);
  const selection = displaySelection(parsed);
  const confidence = displayConfidence(parsed);
  const stake = displayStake(parsed);

  const emoji = isRec ? '🎯' : isCondition ? '⚡' : '📊';
  const label = isRec ? 'AI RECOMMENDATION' : isCondition ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';

  let text = `<b>${emoji} ${label}</b>\n`;
  text += `<b>${safeHtml(matchDisplay)}</b>\n`;
  text += `${safeHtml(league)}\n`;
  text += `⏱ ${safeHtml(String(minute))}' | 📋 ${safeHtml(score)} | ${safeHtml(status)}\n`;
  text += `🤖 ${safeHtml(model)} | Mode: ${safeHtml(mode)}\n`;

  if (isRec) {
    text += `\n<b>💰 ${safeHtml(selection)}</b>\n`;
    text += `Confidence: ${confidence}/10 | Stake: ${stake}% | Risk: ${safeHtml(parsed.risk_level)} | Value: ${parsed.value_percent}%\n`;
    const reasoning = pickReasoning(parsed, lang);
    if (reasoning) text += `\n${safeHtml(reasoning)}\n`;
  } else if (isCondition) {
    if (selection) text += `\n<b>⚡ ${safeHtml(selection)}</b>\n`;
    text += `Confidence: ${confidence}/10 | Stake: ${stake}%\n`;
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
          }
        : null,
      settings: {
        reanalyzeMinMinutes: settings.reanalyzeMinMinutes,
      },
      forceAnalyze,
    });
    if (coarseStaleness.isStale && !forceAnalyze && options.skipStalenessGate !== true) {
      if (!shadowMode) {
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

    let liveScoreTrace: Awaited<ReturnType<typeof fetchLiveScoreBenchmarkTrace>> | null = null;
    if (config.liveScoreBenchmarkEnabled || config.liveScoreStatsFallbackEnabled) {
      liveScoreTrace = await deps.fetchLiveScoreBenchmarkTrace(fixture);
    }

    if (sampleProviderData && liveScoreTrace) {
      void recordProviderStatsSampleSafe({
        match_id: matchId,
        match_minute: minute,
        match_status: status,
        provider: 'live-score-api',
        consumer: shadowMode ? 'replay' : 'server-pipeline',
        success: liveScoreTrace.error == null && liveScoreTrace.matched,
        latency_ms: liveScoreTrace.latencyMs,
        status_code: liveScoreTrace.statusCode,
        error: liveScoreTrace.error ?? '',
        raw_payload: {
          matched_match: liveScoreTrace.matchedMatch,
          stats: liveScoreTrace.rawStats,
          events: liveScoreTrace.rawEvents,
          candidate_count: liveScoreTrace.rawLiveMatches.length,
        },
        normalized_payload: liveScoreTrace.statsCompact,
        coverage_flags: liveScoreTrace.coverageFlags,
      });
    }

    let statsCompact = apiStatsCompact;
    let eventsCompact = apiEventsCompact;
    let derivedInsights = deriveInsightsFromEvents(eventsCompact, minute, homeName, awayName);
    let proceed = apiProceed;
    let statsSource: StatsSource = 'api-football';
    let statsFallbackUsed = false;
    let statsFallbackReason = '';

    if (config.liveScoreStatsFallbackEnabled && !apiProceed.statsAvailable) {
      if (!liveScoreTrace || liveScoreTrace.error || !liveScoreTrace.matched) {
        statsFallbackReason = `Live Score fallback unavailable: ${liveScoreTrace?.error || 'NO_LIVE_SCORE_MATCH'}`;
      } else {
        const liveScoreStatsCompact = liveScoreTrace.statsCompact as unknown as StatsCompact;
        const liveScoreEventsCompact = buildEventsCompact(
          liveScoreTrace.normalizedEvents,
          homeTeamId,
          awayTeamId,
          homeName,
          awayName,
        );
        const liveScoreProceed = checkShouldProceedServer(
          status,
          minute,
          liveScoreStatsCompact,
          {
            minMinute: settings.minMinute,
            maxMinute: settings.maxMinute,
            secondHalfStartMinute: settings.secondHalfStartMinute,
          },
          forceAnalyze,
        );
        const mergedStatsCompact = mergeStatsCompact(apiStatsCompact, liveScoreStatsCompact);
        const mergedEventsCompact = liveScoreEventsCompact.length > apiEventsCompact.length
          ? liveScoreEventsCompact
          : apiEventsCompact;
        const mergedProceed = checkShouldProceedServer(
          status,
          minute,
          mergedStatsCompact,
          {
            minMinute: settings.minMinute,
            maxMinute: settings.maxMinute,
            secondHalfStartMinute: settings.secondHalfStartMinute,
          },
          forceAnalyze,
        );
        const apiPrimaryPairs = countPrimaryPopulatedStatPairs(apiStatsCompact);
        const liveScorePrimaryPairs = countPrimaryPopulatedStatPairs(liveScoreStatsCompact);
        const mergedPrimaryPairs = countPrimaryPopulatedStatPairs(mergedStatsCompact);
        const apiEventCount = apiEventsCompact.length;
        const liveScoreEventCount = liveScoreEventsCompact.length;
        const mergedImproved = mergedPrimaryPairs > apiPrimaryPairs || liveScoreEventCount > apiEventCount;

        if (mergedImproved) {
          statsCompact = mergedStatsCompact;
          eventsCompact = mergedEventsCompact;
          derivedInsights = deriveInsightsFromEvents(eventsCompact, minute, homeName, awayName);
          proceed = mergedProceed;
          statsSource = 'live-score-api-fallback';
          statsFallbackUsed = true;
          if (liveScoreProceed.statsAvailable && liveScorePrimaryPairs > apiPrimaryPairs) {
            statsFallbackReason = `API-Sports stats unavailable (${apiProceed.statsMeta.statsQuality}); Live Score fallback accepted (${liveScoreProceed.statsMeta.statsQuality})`;
          } else {
            statsFallbackReason = `API-Sports live stats supplemented by Live Score fallback: api_pairs=${apiPrimaryPairs}, live_pairs=${liveScorePrimaryPairs}, merged_pairs=${mergedPrimaryPairs}, api_events=${apiEventCount}, live_events=${liveScoreEventCount}, merged_quality=${mergedProceed.statsMeta.statsQuality}`;
          }
        } else {
          statsFallbackReason = `Live Score fallback rejected: api_pairs=${apiPrimaryPairs}, live_pairs=${liveScorePrimaryPairs}, merged_pairs=${mergedPrimaryPairs}, api_events=${apiEventCount}, live_events=${liveScoreEventCount}, live_quality=${liveScoreProceed.statsMeta.statsQuality}`;
        }
      }
    }

    if (config.webLiveStatsFallbackEnabled && !proceed.statsAvailable) {
      let webFallback: Awaited<ReturnType<typeof deps.fetchDeterministicWebLiveFallback>> | null = null;
      try {
        webFallback = await deps.fetchDeterministicWebLiveFallback({
          homeTeam: homeName,
          awayTeam: awayName,
          league: fixture.league?.name || '',
          matchDate: fixture.fixture?.date ? String(fixture.fixture.date).slice(0, 10) : null,
          status,
          minute,
          score: { home: homeGoals, away: awayGoals },
          requestedSlots: { stats: true, events: true },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const detail = `Trusted web fallback unavailable: ${message}`;
        statsFallbackReason = statsFallbackReason ? `${statsFallbackReason}; ${detail}` : detail;
      }

      if (webFallback && sampleProviderData && webFallback.structured) {
        void recordProviderStatsSampleSafe({
          match_id: matchId,
          match_minute: minute,
          match_status: status,
          provider: 'web-live-fallback',
          consumer: shadowMode ? 'replay' : 'server-pipeline',
          success: webFallback.validation.accepted,
          latency_ms: 0,
          status_code: null,
          error: webFallback.error || webFallback.validation.reasons.join(','),
          raw_payload: {
            matched_url: webFallback.structured.matched_url,
            source_meta: webFallback.sourceMeta,
          },
          normalized_payload: webFallback.structured.stats,
          coverage_flags: {
            primary_stat_pairs: countPrimaryPopulatedStatPairs(buildStatsCompactFromWebFallback(webFallback.structured.stats)),
            event_count: webFallback.structured.events.length,
            accepted: webFallback.validation.accepted,
            reasons: webFallback.validation.reasons,
          },
        });
      }

      const criticalWebFallbackMismatch = webFallback
        ? hasCriticalWebFallbackMismatch(webFallback.validation.reasons)
        : false;
      if (webFallback?.structured && webFallback.sourceMeta.trusted_source_count > 0 && !criticalWebFallbackMismatch) {
        const webStatsCompact = buildStatsCompactFromWebFallback(webFallback.structured.stats);
        const webEventsCompact = buildEventsCompactFromWebFallback(webFallback.structured.events, homeName, awayName);
        const mergedStatsCompact = mergeStatsCompact(statsCompact, webStatsCompact);
        const mergedEventsCompact = webEventsCompact.length > eventsCompact.length ? webEventsCompact : eventsCompact;
        const mergedProceed = checkShouldProceedServer(
          status,
          minute,
          mergedStatsCompact,
          {
            minMinute: settings.minMinute,
            maxMinute: settings.maxMinute,
            secondHalfStartMinute: settings.secondHalfStartMinute,
          },
          forceAnalyze,
        );
        const currentPrimaryPairs = countPrimaryPopulatedStatPairs(statsCompact);
        const webPrimaryPairs = countPrimaryPopulatedStatPairs(webStatsCompact);
        const mergedPrimaryPairs = countPrimaryPopulatedStatPairs(mergedStatsCompact);
        const currentEventCount = eventsCompact.length;
        const webEventCount = webEventsCompact.length;
        const mergedImproved = mergedPrimaryPairs > currentPrimaryPairs || webEventCount > currentEventCount;

        if (mergedImproved) {
          statsCompact = mergedStatsCompact;
          eventsCompact = mergedEventsCompact;
          derivedInsights = deriveInsightsFromEvents(eventsCompact, minute, homeName, awayName);
          proceed = mergedProceed;
          statsSource = 'web-trusted-fallback';
          statsFallbackUsed = true;
          statsFallbackReason = `Trusted web fallback merged: source=${webFallback.structured.matched_url}, current_pairs=${currentPrimaryPairs}, web_pairs=${webPrimaryPairs}, merged_pairs=${mergedPrimaryPairs}, current_events=${currentEventCount}, web_events=${webEventCount}`;
        } else if (!statsFallbackReason) {
          statsFallbackReason = `Trusted web fallback rejected: current_pairs=${currentPrimaryPairs}, web_pairs=${webPrimaryPairs}, merged_pairs=${mergedPrimaryPairs}, current_events=${currentEventCount}, web_events=${webEventCount}`;
        }
      } else if (criticalWebFallbackMismatch) {
        const detail = `Trusted web fallback rejected on live-state mismatch: ${webFallback?.validation.reasons.join(',') || 'UNKNOWN'}`;
        statsFallbackReason = statsFallbackReason ? `${statsFallbackReason}; ${detail}` : detail;
      } else if (!statsFallbackReason && webFallback?.error) {
        statsFallbackReason = `Trusted web fallback unavailable: ${webFallback.error}`;
      } else if (webFallback?.error) {
        statsFallbackReason = `${statsFallbackReason}; Trusted web fallback unavailable: ${webFallback.error}`;
      }
    }

    // 2. Check should proceed before fetching odds / AI
    const statsAvailable = proceed.statsAvailable;
    if (!proceed.shouldProceed && !forceAnalyze && options.skipProceedGate !== true) {
      if (!shadowMode) {
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

    // 3. Fetch odds (live first, The Odds exact-event fallback, then pre-match)
    let oddsCanonical: OddsCanonical = {};
    let oddsAvailable = false;
    let oddsSource: string = 'none';
    let oddsFetchedAt: string | null = null;

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

    oddsSource = resolvedOdds.oddsSource;
    oddsFetchedAt = resolvedOdds.oddsFetchedAt;

    const oddsResult = buildOddsCanonical(resolvedOdds.response);
    let oddsSanityWarnings: string[] = [];
    let oddsSuspicious = false;
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
      });
      oddsCanonical = sanitizedOdds.canonical;
      oddsAvailable = sanitizedOdds.available;
      oddsSanityWarnings = sanitizedOdds.warnings;
      oddsSuspicious = sanitizedOdds.suspicious;
    }

    // 4. Load prompt-only context after the heavy providers already passed coarse gating.
    const [historicalPerformance, leagueProfile, leagueMeta, homeTeamProfile, awayTeamProfile] = await Promise.all([
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
    ]);

    // Track latest state for future gating and context.
    if (!shadowMode) {
      await deps.createSnapshot({
        match_id: matchId,
        minute,
        status,
        home_score: homeGoals,
        away_score: awayGoals,
        stats: statsCompact as unknown as Record<string, unknown>,
        events: eventsCompact as unknown[],
        odds: oddsCanonical as unknown as Record<string, unknown>,
        source: statsFallbackUsed ? 'server-pipeline:live-score-fallback' : 'server-pipeline',
      }).catch((err) => {
        console.warn(`[pipeline] Snapshot save failed for ${matchId}:`, err instanceof Error ? err.message : String(err));
      });
    }

    const staleness = checkStalenessServer({
      minute,
      status,
      score,
      eventsCompact,
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
          }
        : null,
      settings: {
        reanalyzeMinMinutes: settings.reanalyzeMinMinutes,
        oddsMovementThreshold: settings.stalenessOddsDelta,
      },
      forceAnalyze,
    });
    if (staleness.isStale && !forceAnalyze && options.skipStalenessGate !== true) {
      if (!shadowMode) {
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
    const customConditions = (watchlistEntry.custom_conditions || '').trim();
    const recommendedCondition = (watchlistEntry.recommended_custom_condition || '').trim();
    const recommendedConditionReason = (watchlistEntry.recommended_condition_reason || '').trim();
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
    };

    // 6. Call Gemini
    const model = options.modelOverride || settings.aiModel;
    const activeAnalysis = await executePromptAnalysis(
      deps,
      model,
      settings,
      promptContext,
      activePromptVersion,
    );
    const parsed = activeAnalysis.parsed;
    const promptShadowRequested = shouldRunPromptShadow({
      matchId,
      minute,
      activePromptVersion,
      shadowPromptVersion,
      shadowMode,
      promptVersionOverride: options.promptVersionOverride,
    });

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
        activeAnalysis,
        model,
        settings,
      });
    }

    // 8. Split the two outcomes explicitly:
    // - shouldSave: create recommendation + AI performance row only when the AI
    //   itself produced an actionable bet.
    // - shouldNotify: alert the user for either an actionable AI bet OR a
    //   condition-only trigger that meets the notify threshold.
    // This separation is intentional because condition triggers are part of the
    // monitoring/alerting contract, not the persistence contract.
    const shouldSave = parsed.final_should_bet;
    const shouldNotify = parsed.should_push;
    const notificationSelection = displaySelection(parsed);
    const notificationConfidence = displayConfidence(parsed);
    const notificationOdds = parsed.final_should_bet
      ? extractOddsFromSelection(parsed.selection, parsed.bet_market, oddsCanonical)
      : null;
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
      }).catch(() => []);

      for (const row of staged) {
        const ids = conditionOnlyDeliveryMap.get(row.userId) ?? [];
        ids.push(row.deliveryId);
        conditionOnlyDeliveryMap.set(row.userId, ids);
      }
    };

    if (shouldSave && !shadowMode) {
      const mappedOdd = extractOddsFromSelection(parsed.selection, parsed.bet_market, oddsCanonical);
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
        pre_match_prediction_summary: '',
        prompt_version: activePromptVersion,
        custom_condition_matched: parsed.custom_condition_matched,
        minute,
        score,
        bet_type: shouldSave ? 'AI' : 'NO_BET',
        selection: parsed.selection,
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
        mode: watchlistEntry.mode || 'B',
        bet_market: parsed.bet_market,
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
            predicted_market: parsed.bet_market || '',
            predicted_selection: parsed.selection,
            predicted_odds: mappedOdd ? Number(mappedOdd) : null,
            match_minute: minute,
            match_score: score,
            league: league,
          });
        } catch { /* non-critical — duplicate key or other */ }
      }
    }

    // 9. Telegram notification:
    // - AI path: notify with the AI selection and save linkage when available.
    // - Condition-only path: still notify the user, but do not backfill a DB
    //   recommendation or AI performance record.
    if (shouldNotify && !shadowMode && settings.telegramEnabled) {
      try {
        const mode = watchlistEntry.mode || 'B';
        const chartUrl = statsAvailable ? buildStatsChartUrl(statsCompact, homeName, awayName, minute) : '';
        const recipientMap = new Map<string, Set<string>>();

        if (recId != null) {
          const deliveryTargets = await deps.getEligibleTelegramDeliveryTargets(recId).catch(() => []);
          for (const target of deliveryTargets) {
            if (!recipientMap.has(target.chatId)) recipientMap.set(target.chatId, new Set<string>());
            recipientMap.get(target.chatId)!.add(target.userId);
          }
        } else {
          await ensureConditionOnlyDeliveries();
          const userIds = [...conditionOnlyDeliveryMap.keys()];
          const channelTargets = await deps.getNotificationChannelAddressesByUserIds(userIds, 'telegram').catch(() => []);
          for (const target of channelTargets) {
            if (!recipientMap.has(target.address)) recipientMap.set(target.address, new Set<string>());
            recipientMap.get(target.address)!.add(target.userId);
          }
        }

        if (recipientMap.size === 0 && settings.telegramChatId) {
          recipientMap.set(settings.telegramChatId, new Set<string>());
        }

        if (recipientMap.size === 0) {
          throw new Error('Telegram enabled but no global or user-level recipients are configured');
        }

        const deliveredUserIds = new Set<string>();
        const deliveredConditionDeliveryIds = new Set<number>();

        const sendTelegramToChat = async (chatId: string) => {
          let photoSent = false;
          if (chartUrl) {
            const caption = buildTelegramCaption(
              matchDisplay, league, score, minute, status, parsed, model, mode,
              settings.notificationLanguage, analysisMode, eventsCompact,
            );
            try {
              await deps.sendTelegramPhoto(chatId, chartUrl, caption);
              photoSent = true;
            } catch {
              // Photo failed — fall through to text
            }
          }

          if (!photoSent) {
            const msg = buildTelegramMessage(
              matchDisplay, league, score, minute, status, parsed,
              statsCompact, statsAvailable, eventsCompact, model, mode,
              settings.notificationLanguage, analysisMode,
            );
            for (const chunk of chunkMessage(msg)) {
              await deps.sendTelegramMessage(chatId, chunk);
            }
          }
        };

        for (const [chatId, userIds] of recipientMap.entries()) {
          try {
            await sendTelegramToChat(chatId);
            for (const userId of userIds) {
              deliveredUserIds.add(userId);
              for (const deliveryId of conditionOnlyDeliveryMap.get(userId) ?? []) {
                deliveredConditionDeliveryIds.add(deliveryId);
              }
            }
          } catch (chatError) {
            console.error(
              `[pipeline] Telegram delivery failed for recipient ${chatId} on ${matchId}:`,
              chatError instanceof Error ? chatError.message : String(chatError),
            );
          }
        }

        if (recId != null && deliveredUserIds.size > 0) {
          await deps.markRecommendationDeliveriesDelivered(
            recId,
            [...deliveredUserIds],
            'telegram',
          ).catch(() => undefined);
        }
        if (recId == null && deliveredConditionDeliveryIds.size > 0) {
          await deps.markDeliveryRowsDelivered([...deliveredConditionDeliveryIds], 'telegram').catch(() => undefined);
        }
        if (recId != null && (deliveredUserIds.size > 0 || (settings.telegramChatId ? recipientMap.has(settings.telegramChatId) : false))) {
          await deps.markRecommendationNotified(recId, 'telegram').catch(() => undefined);
        }
        if (deliveredUserIds.size > 0 || recipientMap.size > 0) notified = true;
      } catch (e) {
        console.error(`[pipeline] Telegram notification failed for ${matchId}:`, e instanceof Error ? e.message : String(e));
      }
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
            notificationSelection ? `${notificationSelection} | Odds: ${notificationOdds ?? 'N/A'} | Confidence: ${notificationConfidence}/10` : '',
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

    if (!shadowMode) {
      audit({
        category: 'PIPELINE',
        action: 'PIPELINE_MATCH_ANALYZED',
        outcome: parsed.should_push ? 'SUCCESS' : 'SKIPPED',
        actor: 'auto-pipeline',
        metadata: {
          matchId, matchDisplay, selection: notificationSelection,
          confidence: notificationConfidence, shouldPush: parsed.should_push,
          saved, recId, notified,
          promptVersion: activePromptVersion,
          promptDataLevel,
          prematchAvailability,
          prematchNoisePenalty,
          prematchStrength,
          statsSource,
          evidenceMode,
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
        promptChars: activeAnalysis.promptChars,
        promptEstimatedTokens: activeAnalysis.promptEstimatedTokens,
        aiTextChars: activeAnalysis.aiTextChars,
        aiTextEstimatedTokens: activeAnalysis.aiTextEstimatedTokens,
        llmLatencyMs: activeAnalysis.llmLatencyMs,
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
  });

  const prompt = result.debug?.prompt;
  const text = result.debug?.aiText;
  if (!prompt || !text) {
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
