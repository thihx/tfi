import { query } from '../db/pool.js';
import {
  summarizeExposureClusters,
  summarizePromptQuality,
  type AnalyticsRecommendationRow,
  type ExposureSummary,
  type PromptQualitySummary,
} from '../lib/recommendation-quality-metrics.js';
import { config } from '../config.js';

export type OpsChecklistStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface OpsChecklistItem {
  id: string;
  label: string;
  status: OpsChecklistStatus;
  detail: string;
}

export interface OpsMetricCard {
  label: string;
  value: string;
  tone: OpsChecklistStatus | 'neutral';
  detail?: string;
}

export interface PipelineOverview {
  activityLast2h: number;
  analyzed24h: number;
  notifyEligible24h: number;
  saved24h: number;
  notified24h: number;
  skipped24h: number;
  errors24h: number;
  notifyEligibleRate24h: number;
  saveRate24h: number;
  notifyRate24h: number;
  topSkipReasons: Array<{ reason: string; count: number }>;
  jobFailures24h: number;
  activeJobFailures24h: number;
  recoveredJobFailures24h: number;
  jobFailuresByAction: Array<{ action: string; count: number }>;
  failingJobs24h: Array<{
    jobName: string;
    failureRuns: number;
    totalRuns: number;
    lastStatus: string | null;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastError: string | null;
  }>;
}

export interface ProviderStatsBreakdown {
  provider: string;
  samples: number;
  successRate: number;
  avgLatencyMs: number;
  possessionCoverageRate: number;
  shotsOnTargetCoverageRate: number;
}

export interface ProviderOddsBreakdown {
  provider: string;
  source: string;
  samples: number;
  usableRate: number;
  avgLatencyMs: number;
  oneX2Rate: number;
  overUnderRate: number;
  asianHandicapRate: number;
  canonicalOneX2Rate: number;
  canonicalOverUnderRate: number;
  canonicalAsianHandicapRate: number;
}

export interface ProviderOverview {
  statsWindowHours: number;
  oddsWindowHours: number;
  statsSamples: number;
  statsSuccessRate: number;
  oddsSamples: number;
  oddsUsableRate: number;
  oddsTradableRate: number;
  statsByProvider: ProviderStatsBreakdown[];
  oddsByProvider: ProviderOddsBreakdown[];
  samplingEnabled: boolean;
}

export interface WorkloadOverview {
  pipelineEnabled: boolean;
  activeWatchCount: number;
  liveWatchCount: number;
  providerSamplesExpected: boolean;
  notificationExpected24h: boolean;
}

export interface LlmOpsOverview {
  windowHours: number;
  blocked24h: number;
  started24h: number;
  completed24h: number;
  failed24h: number;
  failureRate24h: number;
  topBlockReasons: Array<{ reason: string; count: number }>;
  diagnosticBreakdown: Array<{ diagnostic: string; count: number }>;
}

export interface AiGatewayOverview {
  mode: string;
  blocked24h: number;
  observed24h: number;
  succeeded24h: number;
  failed24h: number;
  estimatedCost24h: number;
  openBreakers: number;
  openIncidents: number;
  topReasons: Array<{ reason: string; count: number }>;
  breakerScopes: Array<{ scope: string; count: number }>;
}

export interface DecisionFunnelStage {
  id: string;
  label: string;
  count: number;
  rateFromPrevious: number;
  rateFromStart: number;
}

export interface DecisionFunnelOverview {
  windowHours: number;
  source: string;
  stages: DecisionFunnelStage[];
  silentBreakdown: Array<{ reason: string; count: number }>;
}

export interface SettlementOverview {
  recommendationPending: number;
  recommendationUnresolved: number;
  recommendationCorrected7d: number;
  betPending: number;
  betUnresolved: number;
  methodMix30d: Array<{ method: string; count: number }>;
  unresolvedByMarket: Array<{ market: string; count: number }>;
}

export interface NotificationOverview {
  attempts24h: number;
  failures24h: number;
  failureRate24h: number;
  stalePending: number;
  deliveredRecommendations24h: number;
}

export interface PromptShadowVersionBreakdown {
  executionRole: string;
  promptVersion: string;
  samples: number;
  successRate: number;
  avgLatencyMs: number;
  avgPromptTokens: number;
}

export interface PromptShadowOverview {
  windowHours: number;
  runs24h: number;
  shadowRows24h: number;
  shadowSuccessRate24h: number;
  comparedRuns24h: number;
  shouldPushAgreementRate24h: number;
  marketAgreementRate24h: number;
  avgActiveLatencyMs24h: number;
  avgShadowLatencyMs24h: number;
  disagreementTypes: Array<{ type: string; count: number }>;
  versionBreakdown: PromptShadowVersionBreakdown[];
}

export interface PromptQualityOverview extends PromptQualitySummary {
  windowHours: number;
  notifyEligibleRate24h: number;
  exposureConcentration: ExposureSummary;
  prematch: {
    totalAnalyzedRows: number;
    strongRows: number;
    moderateRows: number;
    weakRows: number;
    noneRows: number;
    fullAvailabilityRows: number;
    partialAvailabilityRows: number;
    minimalAvailabilityRows: number;
    noPrematchRows: number;
    highNoiseRows: number;
    highNoiseRate: number;
    avgNoisePenalty: number;
    structuredAskAiEligibleRows: number;
    structuredAskAiEligibleRate: number;
    structuredAskAiBlockedRows: number;
    structuredAskAiReasonBreakdown: Array<{
      reason: string;
      count: number;
    }>;
    topHighNoiseMatches: Array<{
      matchId: string;
      matchDisplay: string;
      noisePenalty: number;
      prematchStrength: string;
      prematchAvailability: string;
      promptDataLevel: string;
      analyzedAt: string;
    }>;
  };
}

export interface PromptOnlyOverview {
  windowHours: number;
  totalRows: number;
  successRows: number;
  skippedRows: number;
  failedRows: number;
  structuredEligibleRows: number;
  structuredEligibleRate: number;
  reasonBreakdown: Array<{
    reason: string;
    count: number;
  }>;
}

export interface OpsMonitoringSnapshot {
  generatedAt: string;
  workload: WorkloadOverview;
  llm: LlmOpsOverview;
  aiGateway: AiGatewayOverview;
  decisionFunnel: DecisionFunnelOverview;
  checklist: OpsChecklistItem[];
  cards: OpsMetricCard[];
  pipeline: PipelineOverview;
  providers: ProviderOverview;
  settlement: SettlementOverview;
  notifications: NotificationOverview;
  promptShadow: PromptShadowOverview;
  promptQuality: PromptQualityOverview;
  promptOnly: PromptOnlyOverview;
}

interface ChecklistInputs {
  pipelineEnabled: boolean;
  activityLast2h: number;
  analyzed24h: number;
  activeWatchCount: number;
  liveWatchCount: number;
  providerSamplingEnabled: boolean;
  jobFailures24h: number;
  activeJobFailures24h: number;
  recoveredJobFailures24h: number;
  statsSamples: number;
  statsSuccessRate: number;
  oddsSamples: number;
  oddsUsableRate: number;
  oddsTradableRate: number;
  settlementBacklog: number;
  unresolvedCount: number;
  notificationAttempts24h: number;
  notificationFailureRate24h: number;
  notificationStalePending: number;
  notificationExpected24h: boolean;
  prematchTotalRows: number;
  prematchHighNoiseRows: number;
  prematchHighNoiseRate: number;
  funnelLiveDetected24h: number;
  funnelSaved24h: number;
  llmBlocked24h: number;
  llmCompleted24h: number;
  aiGatewayMode: string;
  aiGatewayBlocked24h: number;
  aiGatewayFailed24h: number;
  aiGatewayOpenBreakers: number;
  aiGatewayOpenIncidents: number;
}

const PIPELINE_WINDOW_HOURS = 24;
const PIPELINE_ACTIVITY_WINDOW_HOURS = 2;
const PROVIDER_WINDOW_HOURS = 6;
const SETTLEMENT_WINDOW_DAYS = 7;
const NOTIFICATION_WINDOW_HOURS = 24;
const NOTIFICATION_STALE_PENDING_MINUTES = 15;
const PROMPT_SHADOW_WINDOW_HOURS = 24;
const PROMPT_QUALITY_WINDOW_HOURS = 24;

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round((numerator / denominator) * 100, 1);
}

function buildDecisionFunnelStages(input: {
  liveDetected24h: number;
  candidate24h: number;
  processed24h: number;
  providerReady24h: number;
  llmEligible24h: number;
  llmStarted24h: number;
  llmCompleted24h: number;
  shouldPush24h: number;
  saved24h: number;
  notified24h: number;
}): DecisionFunnelStage[] {
  const rows: Array<{ id: string; label: string; count: number }> = [
    { id: 'live_detected', label: 'Live detected', count: input.liveDetected24h },
    { id: 'candidate', label: 'Candidate after staleness', count: input.candidate24h },
    { id: 'processed', label: 'Pipeline processed', count: input.processed24h },
    { id: 'provider_ready', label: 'Provider ready', count: input.providerReady24h },
    { id: 'llm_eligible', label: 'LLM eligible', count: input.llmEligible24h },
    { id: 'llm_started', label: 'LLM called', count: input.llmStarted24h },
    { id: 'llm_completed', label: 'LLM completed', count: input.llmCompleted24h },
    { id: 'should_push', label: 'Model/system push', count: input.shouldPush24h },
    { id: 'saved', label: 'Saved recommendation', count: input.saved24h },
    { id: 'notified', label: 'Notification staged', count: input.notified24h },
  ];
  const start = rows[0]?.count ?? 0;
  return rows.map((row, index) => {
    const previous = index === 0 ? row.count : rows[index - 1]!.count;
    return {
      ...row,
      rateFromPrevious: index === 0 ? 100 : pct(row.count, previous),
      rateFromStart: pct(row.count, start),
    };
  });
}

function deriveStatus(pass: boolean, warn: boolean): OpsChecklistStatus {
  if (pass) return 'pass';
  if (warn) return 'warn';
  return 'fail';
}

function statusRank(status: OpsChecklistStatus): number {
  if (status === 'fail') return 3;
  if (status === 'warn') return 2;
  if (status === 'unknown') return 1;
  return 0;
}

export function shouldExpectProviderSamples(input: {
  pipelineEnabled: boolean;
  liveWatchCount: number;
  activityLast2h: number;
}): boolean {
  return input.pipelineEnabled && (input.liveWatchCount > 0 || input.activityLast2h > 0);
}

export function buildOpsChecklist(inputs: ChecklistInputs): OpsChecklistItem[] {
  const settlementBacklog = inputs.settlementBacklog;
  const unresolvedCount = inputs.unresolvedCount;
  const providerSamplesExpected = shouldExpectProviderSamples(inputs);
  const providerWorkloadDetail = inputs.pipelineEnabled
    ? `${inputs.liveWatchCount} live watch match(es), ${inputs.activityLast2h} pipeline audit event(s) in last ${PIPELINE_ACTIVITY_WINDOW_HOURS}h`
    : 'Pipeline is disabled';
  const expectedProviderWorkloadDetail = inputs.pipelineEnabled
    ? `Current provider workload expected (${providerWorkloadDetail})`
    : 'Pipeline is disabled';
  const noProviderWorkloadDetail = inputs.pipelineEnabled
    ? `No current provider workload observed (${providerWorkloadDetail}; ${inputs.analyzed24h} analyzed row(s) in 24h)`
    : 'Pipeline is disabled';

  const pipelineActivityStatus: OpsChecklistStatus = inputs.activityLast2h > 0
    ? 'pass'
    : inputs.pipelineEnabled && inputs.liveWatchCount > 0
      ? 'fail'
      : 'unknown';

  const jobFailureStatus: OpsChecklistStatus = inputs.jobFailures24h === 0
    ? 'pass'
    : inputs.jobFailures24h > 3
      ? 'fail'
      : 'warn';

  const statsCoverageStatus: OpsChecklistStatus = !inputs.providerSamplingEnabled
    ? 'unknown'
    : inputs.statsSamples === 0
      ? (providerSamplesExpected ? 'fail' : 'unknown')
      : deriveStatus(inputs.statsSuccessRate >= 75, inputs.statsSuccessRate >= 55);

  const oddsCoverageStatus: OpsChecklistStatus = !inputs.providerSamplingEnabled
    ? 'unknown'
    : inputs.oddsSamples === 0
      ? (providerSamplesExpected ? 'fail' : 'unknown')
      : deriveStatus(
        inputs.oddsUsableRate >= 70 && inputs.oddsTradableRate >= 70,
        inputs.oddsUsableRate >= 50 && inputs.oddsTradableRate >= 50,
      );

  const settlementStatus = deriveStatus(
    settlementBacklog <= 50 && unresolvedCount <= 10,
    settlementBacklog <= 200 && unresolvedCount <= 50,
  );

  const notificationStatus: OpsChecklistStatus = inputs.notificationStalePending > 0
    ? deriveStatus(
      false,
      inputs.notificationStalePending <= 3 && inputs.notificationFailureRate24h <= 20,
    )
    : inputs.notificationAttempts24h === 0
      ? (inputs.notificationExpected24h ? 'warn' : 'unknown')
      : deriveStatus(
      inputs.notificationStalePending === 0 && inputs.notificationFailureRate24h <= 5,
      inputs.notificationStalePending <= 3 && inputs.notificationFailureRate24h <= 20,
    );

  const prematchHighNoiseStatus: OpsChecklistStatus = inputs.prematchTotalRows === 0
    ? 'unknown'
    : deriveStatus(inputs.prematchHighNoiseRate <= 10, inputs.prematchHighNoiseRate <= 25);
  const actionableFunnelStatus: OpsChecklistStatus = inputs.funnelLiveDetected24h === 0
    ? 'unknown'
    : inputs.funnelSaved24h > 0
      ? 'pass'
      : 'warn';
  const llmBlockPressureStatus: OpsChecklistStatus = inputs.llmBlocked24h === 0
    ? 'pass'
    : inputs.llmCompleted24h > 0
      ? 'warn'
      : 'fail';
  const aiGatewayHealthStatus: OpsChecklistStatus =
    inputs.aiGatewayBlocked24h > 0 && inputs.aiGatewayMode.toLowerCase() !== 'observe'
      ? 'fail'
      : inputs.aiGatewayFailed24h > 0 || inputs.aiGatewayOpenBreakers > 0 || inputs.aiGatewayOpenIncidents > 0
        ? 'warn'
        : 'pass';

  return [
    {
      id: 'pipeline-activity',
      label: inputs.activityLast2h > 0
        ? 'Pipeline activity is present'
        : inputs.liveWatchCount > 0
          ? 'Pipeline activity is missing'
          : 'Pipeline activity is idle',
      status: pipelineActivityStatus,
      detail:
        inputs.activityLast2h > 0
          ? `${inputs.activityLast2h} pipeline audit events in last ${PIPELINE_ACTIVITY_WINDOW_HOURS}h`
          : inputs.liveWatchCount > 0
            ? `No pipeline activity observed in last ${PIPELINE_ACTIVITY_WINDOW_HOURS}h while ${inputs.liveWatchCount} watch match(es) are live`
            : `No pipeline activity observed in last ${PIPELINE_ACTIVITY_WINDOW_HOURS}h; ${noProviderWorkloadDetail}`,
    },
    {
      id: 'job-failures',
      label: inputs.jobFailures24h === 0
        ? 'Critical jobs are not failing'
        : inputs.jobFailures24h > 3
          ? 'Critical jobs are failing repeatedly'
          : inputs.activeJobFailures24h > 0
            ? 'Critical jobs have active failures'
            : 'Critical jobs recovered after limited failures',
      status: jobFailureStatus,
      detail:
        inputs.jobFailures24h === 0
          ? 'No job failures in last 24h'
          : `${inputs.jobFailures24h} job failure event(s) in last 24h; ${inputs.activeJobFailures24h} currently failing job(s), ${inputs.recoveredJobFailures24h} recovered affected job(s)`,
    },
    {
      id: 'stats-provider-coverage',
      label: inputs.statsSamples > 0
        ? 'Stats provider coverage has samples'
        : providerSamplesExpected
          ? 'Stats provider samples are missing'
          : 'Stats provider coverage is idle',
      status: statsCoverageStatus,
      detail:
        !inputs.providerSamplingEnabled
          ? 'Provider sampling is disabled by PROVIDER_SAMPLING_ENABLED=false'
        : inputs.statsSamples > 0
          ? `${inputs.statsSuccessRate}% success over ${inputs.statsSamples} sample(s) in last ${PROVIDER_WINDOW_HOURS}h`
          : providerSamplesExpected
            ? `${expectedProviderWorkloadDetail}; no stats samples recorded in last ${PROVIDER_WINDOW_HOURS}h`
            : `${noProviderWorkloadDetail}; no stats samples recorded in last ${PROVIDER_WINDOW_HOURS}h`,
    },
    {
      id: 'odds-provider-coverage',
      label: inputs.oddsSamples > 0
        ? 'Odds provider coverage has samples'
        : providerSamplesExpected
          ? 'Odds provider samples are missing'
          : 'Odds provider coverage is idle',
      status: oddsCoverageStatus,
      detail:
        !inputs.providerSamplingEnabled
          ? 'Provider sampling is disabled by PROVIDER_SAMPLING_ENABLED=false'
        : inputs.oddsSamples > 0
          ? `${inputs.oddsUsableRate}% usable, ${inputs.oddsTradableRate}% canonical tradable over ${inputs.oddsSamples} sample(s) in last ${PROVIDER_WINDOW_HOURS}h`
          : providerSamplesExpected
            ? `${expectedProviderWorkloadDetail}; no odds samples recorded in last ${PROVIDER_WINDOW_HOURS}h`
            : `${noProviderWorkloadDetail}; no odds samples recorded in last ${PROVIDER_WINDOW_HOURS}h`,
    },
    {
      id: 'settlement-backlog',
      label: 'Settlement backlog is under control',
      status: settlementStatus,
      detail: `${settlementBacklog} pending/unresolved rows, ${unresolvedCount} unresolved`,
    },
    {
      id: 'notification-health',
      label: inputs.notificationAttempts24h > 0
        ? 'Telegram delivery has attempts'
        : inputs.notificationExpected24h
          ? 'Telegram delivery attempts are missing'
          : 'Telegram delivery is idle',
      status: notificationStatus,
      detail:
        inputs.notificationStalePending > 0
          ? `${inputs.notificationStalePending} pending Telegram delivery row(s) older than ${NOTIFICATION_STALE_PENDING_MINUTES}m; ${inputs.notificationFailureRate24h}% failure over ${inputs.notificationAttempts24h} attempt(s)`
        : inputs.notificationAttempts24h > 0
          ? `${inputs.notificationFailureRate24h}% failure over ${inputs.notificationAttempts24h} attempt(s) in last ${NOTIFICATION_WINDOW_HOURS}h`
          : inputs.notificationExpected24h
            ? `No Telegram deliveries attempted in last ${NOTIFICATION_WINDOW_HOURS}h despite eligible/saved recommendation activity`
            : `No Telegram deliveries expected or attempted in last ${NOTIFICATION_WINDOW_HOURS}h; queue has no stale pending rows`,
    },
    {
      id: 'prematch-high-noise',
      label: inputs.prematchTotalRows === 0
        ? 'Prematch noise has no samples'
        : inputs.prematchHighNoiseRate <= 10
          ? 'Prematch noise is under control'
          : inputs.prematchHighNoiseRate <= 25
            ? 'Prematch noise is elevated'
            : 'Prematch high-noise rate is critical',
      status: prematchHighNoiseStatus,
      detail: inputs.prematchTotalRows === 0
        ? `No analyzed prematch rows in last ${PROMPT_QUALITY_WINDOW_HOURS}h`
        : `${inputs.prematchHighNoiseRows}/${inputs.prematchTotalRows} analyzed row(s) high-noise (${inputs.prematchHighNoiseRate}%) in last ${PROMPT_QUALITY_WINDOW_HOURS}h`,
    },
    {
      id: 'actionable-funnel',
      label: inputs.funnelLiveDetected24h === 0
        ? 'Actionable funnel has no live samples'
        : inputs.funnelSaved24h > 0
          ? 'Actionable funnel produced saves'
          : 'Actionable funnel produced no saves',
      status: actionableFunnelStatus,
      detail: inputs.funnelLiveDetected24h === 0
        ? `No live-detected rows in last ${PIPELINE_WINDOW_HOURS}h`
        : `${inputs.funnelSaved24h}/${inputs.funnelLiveDetected24h} live detected row(s) saved in last ${PIPELINE_WINDOW_HOURS}h`,
    },
    {
      id: 'llm-block-pressure',
      label: inputs.llmBlocked24h === 0
        ? 'LLM block pressure is clear'
        : inputs.llmCompleted24h > 0
          ? 'LLM block pressure is present'
          : 'LLM calls are blocked',
      status: llmBlockPressureStatus,
      detail: `${inputs.llmBlocked24h} blocked LLM call(s), ${inputs.llmCompleted24h} completed call(s) in last ${PIPELINE_WINDOW_HOURS}h`,
    },
    {
      id: 'ai-gateway-health',
      label: inputs.aiGatewayBlocked24h > 0 && inputs.aiGatewayMode.toLowerCase() !== 'observe'
        ? 'AI gateway is blocking calls'
        : inputs.aiGatewayFailed24h > 0 || inputs.aiGatewayOpenBreakers > 0 || inputs.aiGatewayOpenIncidents > 0
          ? 'AI gateway has open issues'
          : 'AI gateway is clear',
      status: aiGatewayHealthStatus,
      detail: `${inputs.aiGatewayOpenBreakers} open breaker(s), ${inputs.aiGatewayOpenIncidents} open incident(s), ${inputs.aiGatewayFailed24h} failed call(s), ${inputs.aiGatewayBlocked24h} blocked call(s), mode ${inputs.aiGatewayMode}`,
    },
  ].sort((left, right) => statusRank(right.status) - statusRank(left.status));
}

export async function getOpsMonitoringSnapshot(): Promise<OpsMonitoringSnapshot> {
  const [
    pipelineSummaryRes,
    skipReasonsRes,
    jobFailuresRes,
    jobFailureDetailsRes,
    workloadSummaryRes,
    providerStatsSummaryRes,
    providerStatsBreakdownRes,
    providerOddsSummaryRes,
    providerOddsBreakdownRes,
    settlementSummaryRes,
    settlementMethodMixRes,
    unresolvedMarketRes,
    notificationRes,
    deliveredRes,
    promptShadowSummaryRes,
    promptShadowComparedRes,
    promptShadowDisagreementsRes,
    promptShadowVersionBreakdownRes,
    promptQualityRowsRes,
    prematchAuditSummaryRes,
    prematchHighNoiseRes,
    prematchStructuredSummaryRes,
    prematchStructuredReasonBreakdownRes,
    promptOnlySummaryRes,
    promptOnlyReasonBreakdownRes,
    decisionFunnelSummaryRes,
    llmFunnelRes,
    llmBlockReasonsRes,
    llmDiagnosticBreakdownRes,
    aiGatewaySummaryRes,
    aiGatewayReasonsRes,
    aiGatewayBreakerScopesRes,
  ] = await Promise.all([
    query<{
      activity_2h: string;
      analyzed_24h: string;
      notify_eligible_24h: string;
      saved_24h: string;
      notified_24h: string;
      skipped_24h: string;
      errors_24h: string;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE category = 'PIPELINE'
             AND action IN ('PIPELINE_MATCH_ANALYZED', 'PIPELINE_MATCH_SKIPPED', 'PIPELINE_MATCH_ERROR')
             AND timestamp >= NOW() - INTERVAL '${PIPELINE_ACTIVITY_WINDOW_HOURS} hours'
         )::text AS activity_2h,
         COUNT(*) FILTER (
           WHERE category = 'PIPELINE'
             AND action = 'PIPELINE_MATCH_ANALYZED'
             AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
         )::text AS analyzed_24h,
         COUNT(*) FILTER (
           WHERE category = 'PIPELINE'
             AND action = 'PIPELINE_MATCH_ANALYZED'
             AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
             AND metadata->>'shouldPush' = 'true'
         )::text AS notify_eligible_24h,
         COUNT(*) FILTER (
           WHERE category = 'PIPELINE'
             AND action = 'PIPELINE_MATCH_ANALYZED'
             AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
             AND metadata->>'saved' = 'true'
         )::text AS saved_24h,
         COUNT(*) FILTER (
           WHERE category = 'PIPELINE'
             AND action = 'PIPELINE_MATCH_ANALYZED'
             AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
             AND metadata->>'notified' = 'true'
         )::text AS notified_24h,
         COUNT(*) FILTER (
           WHERE category = 'PIPELINE'
             AND action = 'PIPELINE_MATCH_SKIPPED'
             AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
         )::text AS skipped_24h,
         COUNT(*) FILTER (
           WHERE category = 'PIPELINE'
             AND action = 'PIPELINE_MATCH_ERROR'
             AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
         )::text AS errors_24h
       FROM audit_logs`,
    ),
    query<{ reason: string; count: string }>(
      `SELECT
         COALESCE(NULLIF(metadata->>'reason', ''), 'unknown') AS reason,
         COUNT(*)::text AS count
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND action = 'PIPELINE_MATCH_SKIPPED'
         AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
       GROUP BY COALESCE(NULLIF(metadata->>'reason', ''), 'unknown')
       ORDER BY COUNT(*) DESC
       LIMIT 5`,
    ),
    query<{ action: string; count: string }>(
      `SELECT action, COUNT(*)::text AS count
       FROM audit_logs
       WHERE category = 'JOB'
         AND outcome = 'FAILURE'
         AND timestamp >= NOW() - INTERVAL '24 hours'
       GROUP BY action
       ORDER BY COUNT(*) DESC`,
    ),
    query<{
      job_name: string;
      total_runs: string;
      failure_runs: string;
      last_status: string | null;
      last_started_at: string | null;
      last_completed_at: string | null;
      last_error: string | null;
    }>(
      `WITH filtered AS (
         SELECT *
         FROM job_run_history
         WHERE started_at >= NOW() - INTERVAL '24 hours'
       ),
       aggregate_rows AS (
         SELECT
           job_name,
           COUNT(*)::text AS total_runs,
           COUNT(*) FILTER (WHERE status = 'failure')::text AS failure_runs
         FROM filtered
         GROUP BY job_name
       )
       SELECT
         aggregate_rows.job_name,
         aggregate_rows.total_runs,
         aggregate_rows.failure_runs,
         latest.status AS last_status,
         latest.started_at::text AS last_started_at,
         latest.completed_at::text AS last_completed_at,
         latest.error AS last_error
       FROM aggregate_rows
       LEFT JOIN LATERAL (
         SELECT status, started_at, completed_at, error
         FROM filtered
         WHERE filtered.job_name = aggregate_rows.job_name
         ORDER BY started_at DESC, id DESC
         LIMIT 1
       ) latest ON TRUE
       WHERE aggregate_rows.failure_runs::int > 0
       ORDER BY aggregate_rows.failure_runs::int DESC, aggregate_rows.job_name
       LIMIT 8`,
    ),
    query<{
      active_watch_count: string;
      live_watch_count: string;
    }>(
      `SELECT
         COUNT(*)::text AS active_watch_count,
         COUNT(*) FILTER (WHERE m.status = ANY($1))::text AS live_watch_count
       FROM monitored_matches mm
       LEFT JOIN matches m ON m.match_id::text = mm.match_id
       WHERE COALESCE(mm.subscriber_count, 0) > 0
          OR EXISTS (
            SELECT 1
            FROM user_watch_subscriptions s
            WHERE s.match_id = mm.match_id
          )`,
      [config.liveStatuses],
    ),
    query<{ total: string; successes: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE success = TRUE)::text AS successes
       FROM provider_stats_samples
       WHERE captured_at >= NOW() - INTERVAL '${PROVIDER_WINDOW_HOURS} hours'`,
    ),
    query<{
      provider: string;
      total: string;
      successes: string;
      avg_latency_ms: string | null;
      possession_hits: string;
      sot_hits: string;
    }>(
      `SELECT
         provider,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE success = TRUE)::text AS successes,
         AVG(latency_ms)::text AS avg_latency_ms,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'has_possession')::boolean, FALSE))::text AS possession_hits,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'has_shots_on_target')::boolean, FALSE))::text AS sot_hits
       FROM provider_stats_samples
       WHERE captured_at >= NOW() - INTERVAL '${PROVIDER_WINDOW_HOURS} hours'
       GROUP BY provider
       ORDER BY COUNT(*) DESC, provider`,
    ),
    query<{ total: string; usable: string; tradable: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE usable = TRUE)::text AS usable,
         COUNT(*) FILTER (
           WHERE usable = TRUE
             AND (
               COALESCE((coverage_flags->>'canonical_has_1x2')::boolean, (coverage_flags->>'has_1x2')::boolean, FALSE)
               OR COALESCE((coverage_flags->>'canonical_has_ou')::boolean, (coverage_flags->>'has_ou')::boolean, FALSE)
               OR COALESCE((coverage_flags->>'canonical_has_ah')::boolean, (coverage_flags->>'has_ah')::boolean, FALSE)
             )
         )::text AS tradable
       FROM provider_odds_samples
       WHERE captured_at >= NOW() - INTERVAL '${PROVIDER_WINDOW_HOURS} hours'`,
    ),
    query<{
      provider: string;
      source: string;
      total: string;
      usable: string;
      avg_latency_ms: string | null;
      one_x2_hits: string;
      ou_hits: string;
      ah_hits: string;
      canonical_one_x2_hits: string;
      canonical_ou_hits: string;
      canonical_ah_hits: string;
    }>(
      `SELECT
         provider,
         source,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE usable = TRUE)::text AS usable,
         AVG(latency_ms)::text AS avg_latency_ms,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'raw_has_1x2')::boolean, (coverage_flags->>'has_1x2')::boolean, FALSE))::text AS one_x2_hits,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'raw_has_ou')::boolean, (coverage_flags->>'has_ou')::boolean, FALSE))::text AS ou_hits,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'raw_has_ah')::boolean, (coverage_flags->>'has_ah')::boolean, FALSE))::text AS ah_hits,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'canonical_has_1x2')::boolean, (coverage_flags->>'has_1x2')::boolean, FALSE))::text AS canonical_one_x2_hits,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'canonical_has_ou')::boolean, (coverage_flags->>'has_ou')::boolean, FALSE))::text AS canonical_ou_hits,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'canonical_has_ah')::boolean, (coverage_flags->>'has_ah')::boolean, FALSE))::text AS canonical_ah_hits
       FROM provider_odds_samples
       WHERE captured_at >= NOW() - INTERVAL '${PROVIDER_WINDOW_HOURS} hours'
       GROUP BY provider, source
       ORDER BY COUNT(*) DESC, provider, source`,
    ),
    query<{
      rec_pending: string;
      rec_unresolved: string;
      rec_corrected_7d: string;
      bet_pending: string;
      bet_unresolved: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM recommendations
           WHERE settlement_status = 'pending'
             AND bet_type IS DISTINCT FROM 'NO_BET')::text AS rec_pending,
         (SELECT COUNT(*) FROM recommendations
           WHERE settlement_status = 'unresolved'
             AND bet_type IS DISTINCT FROM 'NO_BET')::text AS rec_unresolved,
         (SELECT COUNT(*) FROM recommendations
            WHERE settlement_status = 'corrected'
              AND bet_type IS DISTINCT FROM 'NO_BET'
              AND COALESCE(settled_at, timestamp) >= NOW() - INTERVAL '${SETTLEMENT_WINDOW_DAYS} days')::text AS rec_corrected_7d,
         (SELECT COUNT(*) FROM bets WHERE settlement_status = 'pending')::text AS bet_pending,
         (SELECT COUNT(*) FROM bets WHERE settlement_status = 'unresolved')::text AS bet_unresolved`,
    ),
    query<{ method: string; count: string }>(
      `SELECT
         COALESCE(NULLIF(settlement_method, ''), 'unknown') AS method,
         COUNT(*)::text AS count
       FROM recommendations
       WHERE settlement_status IN ('resolved', 'corrected')
         AND bet_type IS DISTINCT FROM 'NO_BET'
         AND COALESCE(settled_at, timestamp) >= NOW() - INTERVAL '30 days'
       GROUP BY COALESCE(NULLIF(settlement_method, ''), 'unknown')
       ORDER BY COUNT(*) DESC`,
    ),
    query<{ market: string; count: string }>(
      `SELECT
         COALESCE(NULLIF(bet_market, ''), bet_type, 'unknown') AS market,
         COUNT(*)::text AS count
       FROM recommendations
       WHERE settlement_status = 'unresolved'
         AND bet_type IS DISTINCT FROM 'NO_BET'
       GROUP BY COALESCE(NULLIF(bet_market, ''), bet_type, 'unknown')
       ORDER BY COUNT(*) DESC
       LIMIT 5`,
    ),
    query<{ attempts: string; failures: string; stale_pending: string }>(
      `WITH channel_stats AS (
         SELECT
           COUNT(*) FILTER (
             WHERE c.channel_type = 'telegram'
               AND c.attempt_count > 0
               AND c.last_attempt_at >= NOW() - INTERVAL '${NOTIFICATION_WINDOW_HOURS} hours'
           )::bigint AS attempts,
           COUNT(*) FILTER (
             WHERE c.channel_type = 'telegram'
               AND c.status = 'failed'
               AND c.updated_at >= NOW() - INTERVAL '${NOTIFICATION_WINDOW_HOURS} hours'
           )::bigint AS failures,
           COUNT(*) FILTER (
             WHERE c.channel_type = 'telegram'
               AND c.status = 'pending'
               AND c.created_at < NOW() - INTERVAL '${NOTIFICATION_STALE_PENDING_MINUTES} minutes'
           )::bigint AS stale_pending
         FROM user_recommendation_delivery_channels c
       ),
       audit_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE action = 'TELEGRAM_SEND')::bigint AS attempts,
           COUNT(*) FILTER (WHERE action = 'TELEGRAM_SEND' AND outcome = 'FAILURE')::bigint AS failures
         FROM audit_logs
         WHERE category = 'NOTIFICATION'
           AND timestamp >= NOW() - INTERVAL '${NOTIFICATION_WINDOW_HOURS} hours'
       )
       SELECT
         (COALESCE(channel_stats.attempts, 0) + COALESCE(audit_stats.attempts, 0))::text AS attempts,
         (COALESCE(channel_stats.failures, 0) + COALESCE(audit_stats.failures, 0))::text AS failures,
         COALESCE(channel_stats.stale_pending, 0)::text AS stale_pending
       FROM channel_stats
       CROSS JOIN audit_stats`,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM recommendations
       WHERE notified = 'yes'
         AND timestamp >= NOW() - INTERVAL '${NOTIFICATION_WINDOW_HOURS} hours'`,
    ),
    query<{ runs: string; shadow_rows: string; shadow_successes: string }>(
      `SELECT
         COUNT(DISTINCT analysis_run_id)::text AS runs,
         COUNT(*) FILTER (WHERE execution_role = 'shadow')::text AS shadow_rows,
         COUNT(*) FILTER (WHERE execution_role = 'shadow' AND success = TRUE)::text AS shadow_successes
       FROM prompt_shadow_runs
       WHERE captured_at >= NOW() - INTERVAL '${PROMPT_SHADOW_WINDOW_HOURS} hours'`,
    ),
    query<{
      compared: string;
      same_should_push: string;
      same_market: string;
      active_avg_latency_ms: string | null;
      shadow_avg_latency_ms: string | null;
    }>(
      `SELECT
         COUNT(*)::text AS compared,
         COUNT(*) FILTER (WHERE active.should_push = shadow.should_push)::text AS same_should_push,
         COUNT(*) FILTER (WHERE COALESCE(active.bet_market, '') = COALESCE(shadow.bet_market, ''))::text AS same_market,
         AVG(active.llm_latency_ms)::text AS active_avg_latency_ms,
         AVG(shadow.llm_latency_ms)::text AS shadow_avg_latency_ms
       FROM prompt_shadow_runs active
       INNER JOIN prompt_shadow_runs shadow
         ON shadow.analysis_run_id = active.analysis_run_id
        AND shadow.execution_role = 'shadow'
       WHERE active.execution_role = 'active'
         AND active.success = TRUE
         AND shadow.success = TRUE
         AND active.captured_at >= NOW() - INTERVAL '${PROMPT_SHADOW_WINDOW_HOURS} hours'`,
    ),
    query<{ diff_type: string; count: string }>(
      `SELECT diff_type, COUNT(*)::text AS count
       FROM (
         SELECT CASE
           WHEN active.should_push <> shadow.should_push AND active.should_push = TRUE THEN 'active_push_shadow_no_push'
           WHEN active.should_push <> shadow.should_push AND shadow.should_push = TRUE THEN 'shadow_push_active_no_push'
           WHEN COALESCE(active.bet_market, '') <> COALESCE(shadow.bet_market, '') THEN 'market_mismatch'
           ELSE 'aligned'
         END AS diff_type
         FROM prompt_shadow_runs active
         INNER JOIN prompt_shadow_runs shadow
           ON shadow.analysis_run_id = active.analysis_run_id
          AND shadow.execution_role = 'shadow'
         WHERE active.execution_role = 'active'
           AND active.success = TRUE
           AND shadow.success = TRUE
           AND active.captured_at >= NOW() - INTERVAL '${PROMPT_SHADOW_WINDOW_HOURS} hours'
       ) diff
       WHERE diff_type <> 'aligned'
       GROUP BY diff_type
       ORDER BY COUNT(*) DESC`,
    ),
    query<{
      execution_role: string;
      prompt_version: string;
      total: string;
      successes: string;
      avg_latency_ms: string | null;
      avg_prompt_tokens: string | null;
    }>(
      `SELECT
         execution_role,
         prompt_version,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE success = TRUE)::text AS successes,
         AVG(llm_latency_ms)::text AS avg_latency_ms,
         AVG(prompt_estimated_tokens)::text AS avg_prompt_tokens
       FROM prompt_shadow_runs
       WHERE captured_at >= NOW() - INTERVAL '${PROMPT_SHADOW_WINDOW_HOURS} hours'
       GROUP BY execution_role, prompt_version
       ORDER BY execution_role, prompt_version`,
    ),
    query<AnalyticsRecommendationRow>(`
      SELECT
        match_id,
        home_team,
        away_team,
        minute,
        score,
        selection,
        bet_market,
        stake_percent,
        result,
        pnl,
        odds,
        confidence
      FROM recommendations
      WHERE result IS DISTINCT FROM 'duplicate'
        AND bet_type IS DISTINCT FROM 'NO_BET'
        AND timestamp >= NOW() - INTERVAL '${PROMPT_QUALITY_WINDOW_HOURS} hours'
    `),
    query<{
      total_rows: string;
      strong_rows: string;
      moderate_rows: string;
      weak_rows: string;
      none_rows: string;
      full_rows: string;
      partial_rows: string;
      minimal_rows: string;
      no_prematch_rows: string;
      high_noise_rows: string;
      avg_noise_penalty: string | null;
      structured_eligible_rows: string;
    }>(`
      SELECT
        COUNT(*)::text AS total_rows,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(metadata->>'prematchStrength', ''), 'none') = 'strong')::text AS strong_rows,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(metadata->>'prematchStrength', ''), 'none') = 'moderate')::text AS moderate_rows,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(metadata->>'prematchStrength', ''), 'none') = 'weak')::text AS weak_rows,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(metadata->>'prematchStrength', ''), 'none') = 'none')::text AS none_rows,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(metadata->>'prematchAvailability', ''), 'none') = 'full')::text AS full_rows,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(metadata->>'prematchAvailability', ''), 'none') = 'partial')::text AS partial_rows,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(metadata->>'prematchAvailability', ''), 'none') = 'minimal')::text AS minimal_rows,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(metadata->>'prematchAvailability', ''), 'none') = 'none')::text AS no_prematch_rows,
        COUNT(*) FILTER (
          WHERE CASE
            WHEN COALESCE(metadata->>'prematchNoisePenalty', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN (metadata->>'prematchNoisePenalty')::numeric >= 50
            ELSE FALSE
          END
        )::text AS high_noise_rows,
        AVG(CASE
          WHEN COALESCE(metadata->>'prematchNoisePenalty', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN (metadata->>'prematchNoisePenalty')::numeric
          ELSE NULL
        END)::text AS avg_noise_penalty,
        COUNT(*) FILTER (
          WHERE COALESCE(metadata->>'structuredPrematchAskAi', 'false') = 'true'
        )::text AS structured_eligible_rows
      FROM audit_logs
      WHERE category = 'PIPELINE'
        AND action = 'PIPELINE_MATCH_ANALYZED'
        AND timestamp >= NOW() - INTERVAL '${PROMPT_QUALITY_WINDOW_HOURS} hours'
    `),
    query<{
      match_id: string;
      match_display: string;
      noise_penalty: string;
      prematch_strength: string;
      prematch_availability: string;
      prompt_data_level: string;
      analyzed_at: string;
    }>(`
      SELECT
        COALESCE(metadata->>'matchId', '') AS match_id,
        COALESCE(NULLIF(metadata->>'matchDisplay', ''), metadata->>'matchId', 'unknown') AS match_display,
        metadata->>'prematchNoisePenalty' AS noise_penalty,
        COALESCE(NULLIF(metadata->>'prematchStrength', ''), 'none') AS prematch_strength,
        COALESCE(NULLIF(metadata->>'prematchAvailability', ''), 'none') AS prematch_availability,
        COALESCE(NULLIF(metadata->>'promptDataLevel', ''), 'unknown') AS prompt_data_level,
        timestamp::text AS analyzed_at
      FROM audit_logs
      WHERE category = 'PIPELINE'
        AND action = 'PIPELINE_MATCH_ANALYZED'
        AND timestamp >= NOW() - INTERVAL '${PROMPT_QUALITY_WINDOW_HOURS} hours'
        AND COALESCE(metadata->>'prematchNoisePenalty', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        AND (metadata->>'prematchNoisePenalty')::numeric >= 50
      ORDER BY (metadata->>'prematchNoisePenalty')::numeric DESC, timestamp DESC
      LIMIT 8
    `),
    query<{
      total_rows: string;
      blocked_rows: string;
    }>(`
      SELECT
        COUNT(*)::text AS total_rows,
        COUNT(*) FILTER (
          WHERE action = 'PIPELINE_MATCH_SKIPPED'
            AND COALESCE(NULLIF(metadata->>'reason', ''), 'unknown') = 'low_evidence_without_watch_condition'
        )::text AS blocked_rows
      FROM audit_logs
      WHERE category = 'PIPELINE'
        AND timestamp >= NOW() - INTERVAL '${PROMPT_QUALITY_WINDOW_HOURS} hours'
        AND COALESCE(NULLIF(metadata->>'analysisMode', ''), 'unknown') = 'manual_force'
        AND COALESCE(NULLIF(metadata->>'evidenceMode', ''), 'unknown') = 'low_evidence'
    `),
    query<{
      reason: string;
      count: string;
    }>(`
      SELECT
        COALESCE(NULLIF(metadata->>'structuredPrematchAskAiReason', ''), 'unknown') AS reason,
        COUNT(*)::text AS count
      FROM audit_logs
      WHERE category = 'PIPELINE'
        AND timestamp >= NOW() - INTERVAL '${PROMPT_QUALITY_WINDOW_HOURS} hours'
        AND COALESCE(NULLIF(metadata->>'analysisMode', ''), 'unknown') = 'manual_force'
        AND COALESCE(NULLIF(metadata->>'evidenceMode', ''), 'unknown') = 'low_evidence'
      GROUP BY COALESCE(NULLIF(metadata->>'structuredPrematchAskAiReason', ''), 'unknown')
      ORDER BY COUNT(*) DESC, reason
    `),
    query<{
      total_rows: string;
      success_rows: string;
      skipped_rows: string;
      failed_rows: string;
      structured_eligible_rows: string;
    }>(`
      SELECT
        COUNT(*)::text AS total_rows,
        COUNT(*) FILTER (WHERE outcome = 'SUCCESS')::text AS success_rows,
        COUNT(*) FILTER (WHERE outcome = 'SKIPPED')::text AS skipped_rows,
        COUNT(*) FILTER (WHERE outcome = 'FAILURE')::text AS failed_rows,
        COUNT(*) FILTER (
          WHERE COALESCE(metadata->>'structuredPrematchAskAi', 'false') = 'true'
        )::text AS structured_eligible_rows
      FROM audit_logs
      WHERE category = 'PIPELINE'
        AND action = 'PROMPT_ONLY_MATCH_ANALYZED'
        AND timestamp >= NOW() - INTERVAL '${PROMPT_QUALITY_WINDOW_HOURS} hours'
    `),
    query<{
      reason: string;
      count: string;
    }>(`
      SELECT
        COALESCE(
          NULLIF(metadata->>'structuredPrematchAskAiReason', ''),
          NULLIF(metadata->>'skipReason', ''),
          'unknown'
        ) AS reason,
        COUNT(*)::text AS count
      FROM audit_logs
      WHERE category = 'PIPELINE'
        AND action = 'PROMPT_ONLY_MATCH_ANALYZED'
        AND timestamp >= NOW() - INTERVAL '${PROMPT_QUALITY_WINDOW_HOURS} hours'
      GROUP BY COALESCE(
        NULLIF(metadata->>'structuredPrematchAskAiReason', ''),
        NULLIF(metadata->>'skipReason', ''),
        'unknown'
      )
      ORDER BY COUNT(*) DESC, reason
    `),
    query<{
      live_detected: string;
      candidate: string;
      processed: string;
      provider_ready: string;
      llm_eligible: string;
      pre_llm_skipped: string;
      skipped_proceed: string;
      skipped_staleness: string;
      llm_eligibility_blocked: string;
      model_no_bet: string;
      policy_blocked: string;
      save_blocked: string;
      should_push: string;
      saved: string;
      notified: string;
      errors: string;
    }>(`
      WITH complete AS (
        SELECT metadata
        FROM audit_logs
        WHERE category = 'PIPELINE'
          AND action = 'PIPELINE_COMPLETE'
          AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
      )
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'liveCount', '') ~ '^-?[0-9]+$' THEN (metadata->>'liveCount')::int ELSE 0 END), 0)::text AS live_detected,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'candidateCount', '') ~ '^-?[0-9]+$' THEN (metadata->>'candidateCount')::int ELSE 0 END), 0)::text AS candidate,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalProcessed', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalProcessed')::int ELSE 0 END), 0)::text AS processed,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalProviderReady', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalProviderReady')::int ELSE 0 END), 0)::text AS provider_ready,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalLlmEligible', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalLlmEligible')::int ELSE 0 END), 0)::text AS llm_eligible,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalPreLlmSkipped', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalPreLlmSkipped')::int ELSE 0 END), 0)::text AS pre_llm_skipped,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalSkippedProceed', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalSkippedProceed')::int ELSE 0 END), 0)::text AS skipped_proceed,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalSkippedStaleness', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalSkippedStaleness')::int ELSE 0 END), 0)::text AS skipped_staleness,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalLlmEligibilityBlocked', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalLlmEligibilityBlocked')::int ELSE 0 END), 0)::text AS llm_eligibility_blocked,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalModelNoBet', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalModelNoBet')::int ELSE 0 END), 0)::text AS model_no_bet,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalPolicyBlocked', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalPolicyBlocked')::int ELSE 0 END), 0)::text AS policy_blocked,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalSaveBlocked', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalSaveBlocked')::int ELSE 0 END), 0)::text AS save_blocked,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalShouldPush', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalShouldPush')::int ELSE 0 END), 0)::text AS should_push,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalSavedRecommendations', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalSavedRecommendations')::int ELSE 0 END), 0)::text AS saved,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalPushedNotifications', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalPushedNotifications')::int ELSE 0 END), 0)::text AS notified,
        COALESCE(SUM(CASE WHEN COALESCE(metadata->>'totalErrors', '') ~ '^-?[0-9]+$' THEN (metadata->>'totalErrors')::int ELSE 0 END), 0)::text AS errors
      FROM complete
    `),
    query<{
      blocked: string;
      started: string;
      completed: string;
      failed: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE action = 'LLM_CALL_BLOCKED')::text AS blocked,
        COUNT(*) FILTER (WHERE action = 'LLM_CALL_STARTED')::text AS started,
        COUNT(*) FILTER (WHERE action = 'LLM_CALL_COMPLETED' AND outcome = 'SUCCESS')::text AS completed,
        COUNT(*) FILTER (WHERE action = 'LLM_CALL_COMPLETED' AND outcome = 'FAILURE')::text AS failed
      FROM audit_logs
      WHERE category = 'PIPELINE'
        AND action IN ('LLM_CALL_BLOCKED', 'LLM_CALL_STARTED', 'LLM_CALL_COMPLETED')
        AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
    `),
    query<{ reason: string; count: string }>(`
      SELECT
        COALESCE(NULLIF(metadata->>'reason', ''), 'unknown') AS reason,
        COUNT(*)::text AS count
      FROM audit_logs
      WHERE category = 'PIPELINE'
        AND action = 'LLM_CALL_BLOCKED'
        AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
      GROUP BY COALESCE(NULLIF(metadata->>'reason', ''), 'unknown')
      ORDER BY COUNT(*) DESC, reason
      LIMIT 6
    `),
    query<{ diagnostic: string; count: string }>(`
      SELECT
        COALESCE(NULLIF(metadata->>'llmDecisionDiagnostic', ''), 'unknown') AS diagnostic,
        COUNT(*)::text AS count
      FROM audit_logs
      WHERE category = 'PIPELINE'
        AND action = 'LLM_PARSE_DIAGNOSTIC'
        AND timestamp >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
      GROUP BY COALESCE(NULLIF(metadata->>'llmDecisionDiagnostic', ''), 'unknown')
      ORDER BY COUNT(*) DESC, diagnostic
      LIMIT 8
    `),
    query<{
      blocked: string;
      observed: string;
      succeeded: string;
      failed: string;
      estimated_cost: string;
      open_breakers: string;
      open_incidents: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM ai_gateway_logs
         WHERE status = 'blocked' AND created_at >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours') AS blocked,
        (SELECT COUNT(*)::text FROM ai_gateway_logs
         WHERE status = 'started' AND decision = 'observe' AND created_at >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours') AS observed,
        (SELECT COUNT(*)::text FROM ai_gateway_logs
         WHERE status = 'succeeded' AND created_at >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours') AS succeeded,
        (SELECT COUNT(*)::text FROM ai_gateway_logs
         WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours') AS failed,
        (SELECT COALESCE(SUM(estimated_cost_usd), 0)::text FROM ai_gateway_logs
         WHERE status = 'succeeded' AND created_at >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours') AS estimated_cost,
        (SELECT COUNT(*)::text FROM ai_gateway_breakers WHERE status = 'open') AS open_breakers,
        (SELECT COUNT(*)::text FROM ai_gateway_incidents WHERE status = 'open') AS open_incidents
    `).catch(() => ({
      rows: [{
        blocked: '0',
        observed: '0',
        succeeded: '0',
        failed: '0',
        estimated_cost: '0',
        open_breakers: '0',
        open_incidents: '0',
      }],
    })),
    query<{ reason: string; count: string }>(`
      SELECT COALESCE(NULLIF(reason, ''), 'unknown') AS reason, COUNT(*)::text AS count
      FROM ai_gateway_logs
      WHERE created_at >= NOW() - INTERVAL '${PIPELINE_WINDOW_HOURS} hours'
        AND status IN ('blocked', 'failed')
      GROUP BY COALESCE(NULLIF(reason, ''), 'unknown')
      ORDER BY COUNT(*) DESC, reason
      LIMIT 6
    `).catch(() => ({ rows: [] })),
    query<{ scope: string; count: string }>(`
      SELECT CONCAT(scope_type, ':', scope_key) AS scope, COUNT(*)::text AS count
      FROM ai_gateway_breakers
      WHERE status = 'open'
      GROUP BY CONCAT(scope_type, ':', scope_key)
      ORDER BY COUNT(*) DESC, scope
      LIMIT 6
    `).catch(() => ({ rows: [] })),
  ]);

  const pipelineSummary = pipelineSummaryRes.rows[0]!;
  const providerStatsSummary = providerStatsSummaryRes.rows[0]!;
  const providerOddsSummary = providerOddsSummaryRes.rows[0]!;
  const workloadSummary = workloadSummaryRes.rows[0]!;
  const settlementSummary = settlementSummaryRes.rows[0]!;
  const notificationSummary = notificationRes.rows[0]!;
  const deliveredSummary = deliveredRes.rows[0]!;
  const promptShadowSummary = promptShadowSummaryRes.rows[0]!;
  const promptShadowCompared = promptShadowComparedRes.rows[0]!;
  const llmFunnel = llmFunnelRes.rows[0]!;
  const decisionFunnelSummary = decisionFunnelSummaryRes.rows[0]!;
  const aiGatewaySummary = aiGatewaySummaryRes.rows[0]!;

  const activityLast2h = Number(pipelineSummary.activity_2h);
  const analyzed24h = Number(pipelineSummary.analyzed_24h);
  const notifyEligible24h = Number(pipelineSummary.notify_eligible_24h);
  const saved24h = Number(pipelineSummary.saved_24h);
  const notified24h = Number(pipelineSummary.notified_24h);
  const skipped24h = Number(pipelineSummary.skipped_24h);
  const errors24h = Number(pipelineSummary.errors_24h);

  const statsSamples = Number(providerStatsSummary.total);
  const statsSuccesses = Number(providerStatsSummary.successes);
  const oddsSamples = Number(providerOddsSummary.total);
  const oddsUsable = Number(providerOddsSummary.usable);
  const oddsTradable = Number(providerOddsSummary.tradable);

  const recommendationPending = Number(settlementSummary.rec_pending);
  const recommendationUnresolved = Number(settlementSummary.rec_unresolved);
  const recommendationCorrected7d = Number(settlementSummary.rec_corrected_7d);
  const betPending = Number(settlementSummary.bet_pending);
  const betUnresolved = Number(settlementSummary.bet_unresolved);
  const settlementBacklog = recommendationPending + recommendationUnresolved + betPending + betUnresolved;

  const notificationAttempts24h = Number(notificationSummary.attempts);
  const notificationFailures24h = Number(notificationSummary.failures);
  const notificationStalePending = Number(notificationSummary.stale_pending);
  const notificationFailureRate24h = pct(notificationFailures24h, notificationAttempts24h);
  const promptShadowRuns24h = Number(promptShadowSummary.runs);
  const promptShadowRows24h = Number(promptShadowSummary.shadow_rows);
  const promptShadowSuccessRate24h = pct(Number(promptShadowSummary.shadow_successes), promptShadowRows24h);
  const promptShadowComparedRuns24h = Number(promptShadowCompared.compared);
  const promptShadowShouldPushAgreementRate24h = pct(
    Number(promptShadowCompared.same_should_push),
    promptShadowComparedRuns24h,
  );
  const promptShadowMarketAgreementRate24h = pct(
    Number(promptShadowCompared.same_market),
    promptShadowComparedRuns24h,
  );
  const promptShadowActiveLatencyMs24h = round(Number(promptShadowCompared.active_avg_latency_ms ?? 0), 0);
  const promptShadowLatencyMs24h = round(Number(promptShadowCompared.shadow_avg_latency_ms ?? 0), 0);
  const promptQualitySummary = summarizePromptQuality(promptQualityRowsRes.rows);
  const promptExposure = summarizeExposureClusters(promptQualityRowsRes.rows, { minCount: 2, limit: 5 });
  const prematchAuditSummary = prematchAuditSummaryRes.rows[0]!;
  const prematchStructuredSummary = prematchStructuredSummaryRes.rows[0]!;
  const promptOnlySummary = promptOnlySummaryRes.rows[0]!;
  const prematchTotalRows = Number(prematchAuditSummary.total_rows);
  const prematchHighNoiseRows = Number(prematchAuditSummary.high_noise_rows);
  const prematchHighNoiseRate = pct(prematchHighNoiseRows, prematchTotalRows);
  const prematchAvgNoisePenalty = round(Number(prematchAuditSummary.avg_noise_penalty ?? 0), 1);
  const prematchStructuredEligibleRows = Number(prematchAuditSummary.structured_eligible_rows);
  const prematchStructuredTotalRows = Number(prematchStructuredSummary.total_rows);
  const prematchStructuredBlockedRows = Number(prematchStructuredSummary.blocked_rows);
  const prematchStructuredEligibleRate = pct(prematchStructuredEligibleRows, prematchStructuredTotalRows);
  const promptOnlyTotalRows = Number(promptOnlySummary.total_rows);
  const promptOnlyStructuredEligibleRows = Number(promptOnlySummary.structured_eligible_rows);
  const promptOnlyStructuredEligibleRate = pct(promptOnlyStructuredEligibleRows, promptOnlyTotalRows);
  const llmBlocked24h = Number(llmFunnel.blocked);
  const llmStarted24h = Number(llmFunnel.started);
  const llmCompleted24h = Number(llmFunnel.completed);
  const llmFailed24h = Number(llmFunnel.failed);
  const llmFailureRate24h = pct(llmFailed24h, llmCompleted24h + llmFailed24h);
  const funnelLiveDetected24h = Number(decisionFunnelSummary.live_detected);
  const funnelCandidate24h = Number(decisionFunnelSummary.candidate);
  const funnelProcessed24h = Number(decisionFunnelSummary.processed);
  const funnelProviderReady24h = Number(decisionFunnelSummary.provider_ready);
  const funnelLlmEligible24h = Number(decisionFunnelSummary.llm_eligible);
  const funnelPreLlmSkipped24h = Number(decisionFunnelSummary.pre_llm_skipped);
  const funnelSkippedProceed24h = Number(decisionFunnelSummary.skipped_proceed);
  const funnelSkippedStaleness24h = Number(decisionFunnelSummary.skipped_staleness);
  const funnelLlmEligibilityBlocked24h = Number(decisionFunnelSummary.llm_eligibility_blocked);
  const funnelModelNoBet24h = Number(decisionFunnelSummary.model_no_bet);
  const funnelPolicyBlocked24h = Number(decisionFunnelSummary.policy_blocked);
  const funnelSaveBlocked24h = Number(decisionFunnelSummary.save_blocked);
  const funnelShouldPush24h = Number(decisionFunnelSummary.should_push);
  const funnelSaved24h = Number(decisionFunnelSummary.saved);
  const funnelNotified24h = Number(decisionFunnelSummary.notified);
  const funnelErrors24h = Number(decisionFunnelSummary.errors);

  const providerStatsSuccessRate = pct(statsSuccesses, statsSamples);
  const providerOddsUsableRate = pct(oddsUsable, oddsSamples);
  const providerOddsTradableRate = pct(oddsTradable, oddsSamples);
  const activeWatchCount = Number(workloadSummary.active_watch_count);
  const liveWatchCount = Number(workloadSummary.live_watch_count);
  const providerSamplesExpected = shouldExpectProviderSamples({
    pipelineEnabled: config.pipelineEnabled,
    liveWatchCount,
    activityLast2h,
  });
  const notificationExpected24h = notifyEligible24h > 0 || saved24h > 0 || notified24h > 0;
  const jobFailures24h = jobFailuresRes.rows.reduce((sum, row) => sum + Number(row.count), 0);
  const failingJobs24h = jobFailureDetailsRes.rows.map((row) => ({
    jobName: row.job_name,
    failureRuns: Number(row.failure_runs),
    totalRuns: Number(row.total_runs),
    lastStatus: row.last_status,
    lastStartedAt: row.last_started_at,
    lastCompletedAt: row.last_completed_at,
    lastError: row.last_error,
  }));
  const activeJobFailures24h = failingJobs24h.filter((row) => row.lastStatus === 'failure').length;
  const recoveredJobFailures24h = failingJobs24h.filter((row) => row.lastStatus !== 'failure').length;
  const aiGatewayMode = process.env['AI_GATEWAY_MODE'] || 'observe';
  const aiGatewayBlocked24h = Number(aiGatewaySummary.blocked);
  const aiGatewayFailed24h = Number(aiGatewaySummary.failed);
  const aiGatewayOpenBreakers = Number(aiGatewaySummary.open_breakers);
  const aiGatewayOpenIncidents = Number(aiGatewaySummary.open_incidents);

  const checklist = buildOpsChecklist({
    pipelineEnabled: config.pipelineEnabled,
    activityLast2h,
    analyzed24h,
    activeWatchCount,
    liveWatchCount,
    providerSamplingEnabled: config.providerSamplingEnabled,
    jobFailures24h,
    activeJobFailures24h,
    recoveredJobFailures24h,
    statsSamples,
    statsSuccessRate: providerStatsSuccessRate,
    oddsSamples,
    oddsUsableRate: providerOddsUsableRate,
    oddsTradableRate: providerOddsTradableRate,
    settlementBacklog,
    unresolvedCount: recommendationUnresolved + betUnresolved,
    notificationAttempts24h,
    notificationFailureRate24h,
    notificationStalePending,
    notificationExpected24h,
    prematchTotalRows,
    prematchHighNoiseRows,
    prematchHighNoiseRate,
    funnelLiveDetected24h,
    funnelSaved24h,
    llmBlocked24h,
    llmCompleted24h,
    aiGatewayMode,
    aiGatewayBlocked24h,
    aiGatewayFailed24h,
    aiGatewayOpenBreakers,
    aiGatewayOpenIncidents,
  });

  const cards: OpsMetricCard[] = [
    {
      label: 'Pipeline Activity 2h',
      value: String(activityLast2h),
      tone: checklist.find((item) => item.id === 'pipeline-activity')?.status ?? 'neutral',
      detail: 'audit events',
    },
    {
      label: 'Notify-Eligible Rate 24h',
      value: `${pct(notifyEligible24h, analyzed24h)}%`,
      tone: analyzed24h > 0 ? 'neutral' : 'warn',
      detail: `${notifyEligible24h}/${analyzed24h} analyzed`,
    },
    {
      label: 'Stats Coverage 6h',
      value: statsSamples > 0 ? `${providerStatsSuccessRate}%` : 'n/a',
      tone: checklist.find((item) => item.id === 'stats-provider-coverage')?.status ?? 'neutral',
      detail: `${statsSamples} samples`,
    },
    {
      label: 'Odds Coverage 6h',
      value: oddsSamples > 0 ? `${providerOddsTradableRate}%` : 'n/a',
      tone: checklist.find((item) => item.id === 'odds-provider-coverage')?.status ?? 'neutral',
      detail: `${providerOddsUsableRate}% usable / ${providerOddsTradableRate}% tradable`,
    },
    {
      label: 'Settle Backlog',
      value: String(settlementBacklog),
      tone: checklist.find((item) => item.id === 'settlement-backlog')?.status ?? 'neutral',
      detail: `${recommendationUnresolved + betUnresolved} unresolved`,
    },
    {
      label: 'Telegram Fail 24h',
      value: notificationAttempts24h > 0 ? `${notificationFailureRate24h}%` : 'n/a',
      tone: checklist.find((item) => item.id === 'notification-health')?.status ?? 'neutral',
      detail: `${notificationFailures24h}/${notificationAttempts24h} attempts`,
    },
    {
      label: 'Prompt Agree 24h',
      value: promptShadowComparedRuns24h > 0 ? `${promptShadowShouldPushAgreementRate24h}%` : 'n/a',
      tone: promptShadowComparedRuns24h === 0
        ? 'neutral'
        : promptShadowShouldPushAgreementRate24h >= 90
          ? 'pass'
          : promptShadowShouldPushAgreementRate24h >= 75
            ? 'warn'
            : 'fail',
      detail: promptShadowComparedRuns24h > 0
        ? `${promptShadowComparedRuns24h} compared run(s)`
        : 'no prompt shadow samples',
    },
    {
      label: 'Stacking Rate 24h',
      value: `${promptQualitySummary.sameThesisStackingRate}%`,
      tone: promptQualitySummary.sameThesisStackingRate <= 5
        ? 'pass'
        : promptQualitySummary.sameThesisStackingRate <= 12
          ? 'warn'
          : 'fail',
      detail: `${promptQualitySummary.sameThesisStackedRows}/${promptQualitySummary.totalRecommendations} recs`,
    },
    {
      label: 'Prematch High Noise 24h',
      value: prematchTotalRows > 0 ? `${prematchHighNoiseRate}%` : 'n/a',
      tone: prematchTotalRows === 0
        ? 'unknown'
        : prematchHighNoiseRate <= 10
        ? 'pass'
        : prematchHighNoiseRate <= 25
          ? 'warn'
        : 'fail',
      detail: `${prematchHighNoiseRows}/${prematchTotalRows} analyzed rows`,
    },
    {
      label: 'LLM Blocked 24h',
      value: String(llmBlocked24h),
      tone: llmBlocked24h > 0 ? 'warn' : 'pass',
      detail: `${llmStarted24h} started, ${llmCompleted24h} completed`,
    },
    {
      label: 'Actionable Funnel 24h',
      value: funnelLiveDetected24h > 0 ? `${pct(funnelSaved24h, funnelLiveDetected24h)}%` : 'n/a',
      tone: funnelLiveDetected24h === 0
        ? 'neutral'
        : funnelSaved24h > 0
          ? 'pass'
          : 'warn',
      detail: `${funnelSaved24h}/${funnelLiveDetected24h} live detected saved`,
    },
    {
      label: 'LLM Fail 24h',
      value: llmStarted24h > 0 ? `${llmFailureRate24h}%` : 'n/a',
      tone: llmStarted24h === 0
        ? 'neutral'
        : llmFailureRate24h <= 1
          ? 'pass'
          : llmFailureRate24h <= 5
            ? 'warn'
            : 'fail',
      detail: `${llmFailed24h}/${llmCompleted24h + llmFailed24h} completed attempts`,
    },
    {
      label: 'Prematch Structured Eligible',
      value: prematchStructuredTotalRows > 0 ? `${prematchStructuredEligibleRate}%` : 'n/a',
      tone: prematchStructuredTotalRows === 0
        ? 'neutral'
        : prematchStructuredEligibleRate >= 80
          ? 'pass'
          : prematchStructuredEligibleRate >= 50
            ? 'warn'
            : 'fail',
      detail: prematchStructuredTotalRows > 0
        ? `${prematchStructuredEligibleRows}/${prematchStructuredTotalRows} low-evidence manual rows`
        : 'no low-evidence manual prematch rows',
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    workload: {
      pipelineEnabled: config.pipelineEnabled,
      activeWatchCount,
      liveWatchCount,
      providerSamplesExpected,
      notificationExpected24h,
    },
    llm: {
      windowHours: PIPELINE_WINDOW_HOURS,
      blocked24h: llmBlocked24h,
      started24h: llmStarted24h,
      completed24h: llmCompleted24h,
      failed24h: llmFailed24h,
      failureRate24h: llmFailureRate24h,
      topBlockReasons: llmBlockReasonsRes.rows.map((row) => ({
        reason: row.reason,
        count: Number(row.count),
      })),
      diagnosticBreakdown: llmDiagnosticBreakdownRes.rows.map((row) => ({
        diagnostic: row.diagnostic,
        count: Number(row.count),
      })),
    },
    aiGateway: {
      mode: aiGatewayMode,
      blocked24h: aiGatewayBlocked24h,
      observed24h: Number(aiGatewaySummary.observed),
      succeeded24h: Number(aiGatewaySummary.succeeded),
      failed24h: aiGatewayFailed24h,
      estimatedCost24h: round(Number(aiGatewaySummary.estimated_cost ?? 0), 4),
      openBreakers: aiGatewayOpenBreakers,
      openIncidents: aiGatewayOpenIncidents,
      topReasons: aiGatewayReasonsRes.rows.map((row) => ({
        reason: row.reason,
        count: Number(row.count),
      })),
      breakerScopes: aiGatewayBreakerScopesRes.rows.map((row) => ({
        scope: row.scope,
        count: Number(row.count),
      })),
    },
    decisionFunnel: {
      windowHours: PIPELINE_WINDOW_HOURS,
      source: 'PIPELINE_COMPLETE audit summary',
      stages: buildDecisionFunnelStages({
        liveDetected24h: funnelLiveDetected24h,
        candidate24h: funnelCandidate24h,
        processed24h: funnelProcessed24h,
        providerReady24h: funnelProviderReady24h,
        llmEligible24h: funnelLlmEligible24h,
        llmStarted24h,
        llmCompleted24h,
        shouldPush24h: funnelShouldPush24h || notifyEligible24h,
        saved24h: funnelSaved24h || saved24h,
        notified24h: funnelNotified24h || notified24h,
      }),
      silentBreakdown: [
        { reason: 'staleness_gate', count: funnelSkippedStaleness24h },
        { reason: 'proceed_gate', count: funnelSkippedProceed24h },
        { reason: 'llm_eligibility_blocked', count: funnelLlmEligibilityBlocked24h || llmBlocked24h },
        { reason: 'model_no_bet', count: funnelModelNoBet24h },
        { reason: 'policy_blocked', count: funnelPolicyBlocked24h },
        { reason: 'save_blocked_provider_coverage', count: funnelSaveBlocked24h },
        { reason: 'pipeline_error', count: funnelErrors24h || errors24h },
        { reason: 'pre_llm_total', count: funnelPreLlmSkipped24h },
      ].filter((row) => row.count > 0),
    },
    checklist,
    cards,
    pipeline: {
      activityLast2h,
      analyzed24h,
      notifyEligible24h,
      saved24h,
      notified24h,
      skipped24h,
      errors24h,
      notifyEligibleRate24h: pct(notifyEligible24h, analyzed24h),
      saveRate24h: pct(saved24h, analyzed24h),
      notifyRate24h: pct(notified24h, notifyEligible24h),
      topSkipReasons: skipReasonsRes.rows.map((row) => ({
        reason: row.reason,
        count: Number(row.count),
      })),
      jobFailures24h,
      activeJobFailures24h,
      recoveredJobFailures24h,
      jobFailuresByAction: jobFailuresRes.rows.map((row) => ({
        action: row.action,
        count: Number(row.count),
      })),
      failingJobs24h,
    },
    providers: {
      statsWindowHours: PROVIDER_WINDOW_HOURS,
      oddsWindowHours: PROVIDER_WINDOW_HOURS,
      statsSamples,
      statsSuccessRate: providerStatsSuccessRate,
      oddsSamples,
      oddsUsableRate: providerOddsUsableRate,
      oddsTradableRate: providerOddsTradableRate,
      samplingEnabled: config.providerSamplingEnabled,
      statsByProvider: providerStatsBreakdownRes.rows.map((row) => {
        const samples = Number(row.total);
        return {
          provider: row.provider,
          samples,
          successRate: pct(Number(row.successes), samples),
          avgLatencyMs: round(Number(row.avg_latency_ms ?? 0), 0),
          possessionCoverageRate: pct(Number(row.possession_hits), samples),
          shotsOnTargetCoverageRate: pct(Number(row.sot_hits), samples),
        };
      }),
      oddsByProvider: providerOddsBreakdownRes.rows.map((row) => {
        const samples = Number(row.total);
        return {
          provider: row.provider,
          source: row.source,
          samples,
          usableRate: pct(Number(row.usable), samples),
          avgLatencyMs: round(Number(row.avg_latency_ms ?? 0), 0),
          oneX2Rate: pct(Number(row.one_x2_hits), samples),
          overUnderRate: pct(Number(row.ou_hits), samples),
          asianHandicapRate: pct(Number(row.ah_hits), samples),
          canonicalOneX2Rate: pct(Number(row.canonical_one_x2_hits), samples),
          canonicalOverUnderRate: pct(Number(row.canonical_ou_hits), samples),
          canonicalAsianHandicapRate: pct(Number(row.canonical_ah_hits), samples),
        };
      }),
    },
    settlement: {
      recommendationPending,
      recommendationUnresolved,
      recommendationCorrected7d,
      betPending,
      betUnresolved,
      methodMix30d: settlementMethodMixRes.rows.map((row) => ({
        method: row.method,
        count: Number(row.count),
      })),
      unresolvedByMarket: unresolvedMarketRes.rows.map((row) => ({
        market: row.market,
        count: Number(row.count),
      })),
    },
    notifications: {
      attempts24h: notificationAttempts24h,
      failures24h: notificationFailures24h,
      failureRate24h: notificationFailureRate24h,
      stalePending: notificationStalePending,
      deliveredRecommendations24h: Number(deliveredSummary.count),
    },
    promptShadow: {
      windowHours: PROMPT_SHADOW_WINDOW_HOURS,
      runs24h: promptShadowRuns24h,
      shadowRows24h: promptShadowRows24h,
      shadowSuccessRate24h: promptShadowSuccessRate24h,
      comparedRuns24h: promptShadowComparedRuns24h,
      shouldPushAgreementRate24h: promptShadowShouldPushAgreementRate24h,
      marketAgreementRate24h: promptShadowMarketAgreementRate24h,
      avgActiveLatencyMs24h: promptShadowActiveLatencyMs24h,
      avgShadowLatencyMs24h: promptShadowLatencyMs24h,
      disagreementTypes: promptShadowDisagreementsRes.rows.map((row) => ({
        type: row.diff_type,
        count: Number(row.count),
      })),
      versionBreakdown: promptShadowVersionBreakdownRes.rows.map((row) => {
        const samples = Number(row.total);
        return {
          executionRole: row.execution_role,
          promptVersion: row.prompt_version,
          samples,
          successRate: pct(Number(row.successes), samples),
          avgLatencyMs: round(Number(row.avg_latency_ms ?? 0), 0),
          avgPromptTokens: round(Number(row.avg_prompt_tokens ?? 0), 0),
        };
      }),
    },
    promptQuality: {
      windowHours: PROMPT_QUALITY_WINDOW_HOURS,
      notifyEligibleRate24h: pct(notifyEligible24h, analyzed24h),
      exposureConcentration: promptExposure,
      prematch: {
        totalAnalyzedRows: prematchTotalRows,
        strongRows: Number(prematchAuditSummary.strong_rows),
        moderateRows: Number(prematchAuditSummary.moderate_rows),
        weakRows: Number(prematchAuditSummary.weak_rows),
        noneRows: Number(prematchAuditSummary.none_rows),
        fullAvailabilityRows: Number(prematchAuditSummary.full_rows),
        partialAvailabilityRows: Number(prematchAuditSummary.partial_rows),
        minimalAvailabilityRows: Number(prematchAuditSummary.minimal_rows),
        noPrematchRows: Number(prematchAuditSummary.no_prematch_rows),
        highNoiseRows: prematchHighNoiseRows,
        highNoiseRate: prematchHighNoiseRate,
        avgNoisePenalty: prematchAvgNoisePenalty,
        structuredAskAiEligibleRows: prematchStructuredEligibleRows,
        structuredAskAiEligibleRate: prematchStructuredEligibleRate,
        structuredAskAiBlockedRows: prematchStructuredBlockedRows,
        structuredAskAiReasonBreakdown: prematchStructuredReasonBreakdownRes.rows.map((row) => ({
          reason: row.reason,
          count: Number(row.count),
        })),
        topHighNoiseMatches: prematchHighNoiseRes.rows.map((row) => ({
          matchId: row.match_id,
          matchDisplay: row.match_display,
          noisePenalty: Number(row.noise_penalty),
          prematchStrength: row.prematch_strength,
          prematchAvailability: row.prematch_availability,
          promptDataLevel: row.prompt_data_level,
          analyzedAt: row.analyzed_at,
        })),
      },
      ...promptQualitySummary,
    },
    promptOnly: {
      windowHours: PROMPT_QUALITY_WINDOW_HOURS,
      totalRows: promptOnlyTotalRows,
      successRows: Number(promptOnlySummary.success_rows),
      skippedRows: Number(promptOnlySummary.skipped_rows),
      failedRows: Number(promptOnlySummary.failed_rows),
      structuredEligibleRows: promptOnlyStructuredEligibleRows,
      structuredEligibleRate: promptOnlyStructuredEligibleRate,
      reasonBreakdown: promptOnlyReasonBreakdownRes.rows.map((row) => ({
        reason: row.reason,
        count: Number(row.count),
      })),
    },
  };
}
