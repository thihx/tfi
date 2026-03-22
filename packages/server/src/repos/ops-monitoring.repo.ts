import { query } from '../db/pool.js';
import {
  summarizeExposureClusters,
  summarizePromptQuality,
  type AnalyticsRecommendationRow,
  type ExposureSummary,
  type PromptQualitySummary,
} from '../lib/recommendation-quality-metrics.js';

export type OpsChecklistStatus = 'pass' | 'warn' | 'fail';

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
  shouldPush24h: number;
  saved24h: number;
  notified24h: number;
  skipped24h: number;
  errors24h: number;
  pushRate24h: number;
  saveRate24h: number;
  notifyRate24h: number;
  topSkipReasons: Array<{ reason: string; count: number }>;
  jobFailures24h: number;
  jobFailuresByAction: Array<{ action: string; count: number }>;
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
}

export interface ProviderOverview {
  statsWindowHours: number;
  oddsWindowHours: number;
  statsSamples: number;
  statsSuccessRate: number;
  oddsSamples: number;
  oddsUsableRate: number;
  statsByProvider: ProviderStatsBreakdown[];
  oddsByProvider: ProviderOddsBreakdown[];
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
  shouldPushRate24h: number;
  exposureConcentration: ExposureSummary;
}

export interface OpsMonitoringSnapshot {
  generatedAt: string;
  checklist: OpsChecklistItem[];
  cards: OpsMetricCard[];
  pipeline: PipelineOverview;
  providers: ProviderOverview;
  settlement: SettlementOverview;
  notifications: NotificationOverview;
  promptShadow: PromptShadowOverview;
  promptQuality: PromptQualityOverview;
}

interface ChecklistInputs {
  activityLast2h: number;
  jobFailures24h: number;
  statsSamples: number;
  statsSuccessRate: number;
  oddsSamples: number;
  oddsUsableRate: number;
  settlementBacklog: number;
  unresolvedCount: number;
  notificationAttempts24h: number;
  notificationFailureRate24h: number;
}

const PIPELINE_WINDOW_HOURS = 24;
const PIPELINE_ACTIVITY_WINDOW_HOURS = 2;
const PROVIDER_WINDOW_HOURS = 6;
const SETTLEMENT_WINDOW_DAYS = 7;
const NOTIFICATION_WINDOW_HOURS = 24;
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

function deriveStatus(pass: boolean, warn: boolean): OpsChecklistStatus {
  if (pass) return 'pass';
  if (warn) return 'warn';
  return 'fail';
}

export function buildOpsChecklist(inputs: ChecklistInputs): OpsChecklistItem[] {
  const settlementBacklog = inputs.settlementBacklog;
  const unresolvedCount = inputs.unresolvedCount;

  const pipelineActivityStatus = deriveStatus(
    inputs.activityLast2h > 0,
    inputs.activityLast2h === 0,
  );

  const jobFailureStatus = deriveStatus(
    inputs.jobFailures24h === 0,
    inputs.jobFailures24h <= 3,
  );

  const statsCoverageStatus = deriveStatus(
    inputs.statsSamples > 0 && inputs.statsSuccessRate >= 75,
    inputs.statsSamples === 0 || inputs.statsSuccessRate >= 55,
  );

  const oddsCoverageStatus = deriveStatus(
    inputs.oddsSamples > 0 && inputs.oddsUsableRate >= 70,
    inputs.oddsSamples === 0 || inputs.oddsUsableRate >= 50,
  );

  const settlementStatus = deriveStatus(
    settlementBacklog <= 50 && unresolvedCount <= 10,
    settlementBacklog <= 200 && unresolvedCount <= 50,
  );

  const notificationStatus = deriveStatus(
    inputs.notificationAttempts24h > 0 && inputs.notificationFailureRate24h <= 5,
    inputs.notificationAttempts24h === 0 || inputs.notificationFailureRate24h <= 20,
  );

  return [
    {
      id: 'pipeline-activity',
      label: 'Pipeline activity is present',
      status: pipelineActivityStatus,
      detail:
        inputs.activityLast2h > 0
          ? `${inputs.activityLast2h} pipeline audit events in last ${PIPELINE_ACTIVITY_WINDOW_HOURS}h`
          : `No pipeline activity observed in last ${PIPELINE_ACTIVITY_WINDOW_HOURS}h`,
    },
    {
      id: 'job-failures',
      label: 'Critical jobs are not failing repeatedly',
      status: jobFailureStatus,
      detail:
        inputs.jobFailures24h === 0
          ? 'No job failures in last 24h'
          : `${inputs.jobFailures24h} job failure event(s) in last 24h`,
    },
    {
      id: 'stats-provider-coverage',
      label: 'Stats provider coverage is healthy',
      status: statsCoverageStatus,
      detail:
        inputs.statsSamples > 0
          ? `${inputs.statsSuccessRate}% success over ${inputs.statsSamples} sample(s) in last ${PROVIDER_WINDOW_HOURS}h`
          : `No stats samples recorded in last ${PROVIDER_WINDOW_HOURS}h`,
    },
    {
      id: 'odds-provider-coverage',
      label: 'Odds provider coverage is healthy',
      status: oddsCoverageStatus,
      detail:
        inputs.oddsSamples > 0
          ? `${inputs.oddsUsableRate}% usable over ${inputs.oddsSamples} sample(s) in last ${PROVIDER_WINDOW_HOURS}h`
          : `No odds samples recorded in last ${PROVIDER_WINDOW_HOURS}h`,
    },
    {
      id: 'settlement-backlog',
      label: 'Settlement backlog is under control',
      status: settlementStatus,
      detail: `${settlementBacklog} pending/unresolved rows, ${unresolvedCount} unresolved`,
    },
    {
      id: 'notification-health',
      label: 'Telegram delivery is stable',
      status: notificationStatus,
      detail:
        inputs.notificationAttempts24h > 0
          ? `${inputs.notificationFailureRate24h}% failure over ${inputs.notificationAttempts24h} attempt(s) in last ${NOTIFICATION_WINDOW_HOURS}h`
          : `No Telegram send attempts in last ${NOTIFICATION_WINDOW_HOURS}h`,
    },
  ];
}

export async function getOpsMonitoringSnapshot(): Promise<OpsMonitoringSnapshot> {
  const [
    pipelineSummaryRes,
    skipReasonsRes,
    jobFailuresRes,
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
  ] = await Promise.all([
    query<{
      activity_2h: string;
      analyzed_24h: string;
      should_push_24h: string;
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
         )::text AS should_push_24h,
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
    query<{ total: string; usable: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE usable = TRUE)::text AS usable
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
    }>(
      `SELECT
         provider,
         source,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE usable = TRUE)::text AS usable,
         AVG(latency_ms)::text AS avg_latency_ms,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'has_1x2')::boolean, FALSE))::text AS one_x2_hits,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'has_ou')::boolean, FALSE))::text AS ou_hits,
         COUNT(*) FILTER (WHERE COALESCE((coverage_flags->>'has_ah')::boolean, FALSE))::text AS ah_hits
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
    query<{ attempts: string; failures: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE action = 'TELEGRAM_SEND')::text AS attempts,
         COUNT(*) FILTER (WHERE action = 'TELEGRAM_SEND' AND outcome = 'FAILURE')::text AS failures
       FROM audit_logs
       WHERE category = 'NOTIFICATION'
         AND timestamp >= NOW() - INTERVAL '${NOTIFICATION_WINDOW_HOURS} hours'`,
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
  ]);

  const pipelineSummary = pipelineSummaryRes.rows[0]!;
  const providerStatsSummary = providerStatsSummaryRes.rows[0]!;
  const providerOddsSummary = providerOddsSummaryRes.rows[0]!;
  const settlementSummary = settlementSummaryRes.rows[0]!;
  const notificationSummary = notificationRes.rows[0]!;
  const deliveredSummary = deliveredRes.rows[0]!;
  const promptShadowSummary = promptShadowSummaryRes.rows[0]!;
  const promptShadowCompared = promptShadowComparedRes.rows[0]!;

  const analyzed24h = Number(pipelineSummary.analyzed_24h);
  const shouldPush24h = Number(pipelineSummary.should_push_24h);
  const saved24h = Number(pipelineSummary.saved_24h);
  const notified24h = Number(pipelineSummary.notified_24h);
  const skipped24h = Number(pipelineSummary.skipped_24h);
  const errors24h = Number(pipelineSummary.errors_24h);

  const statsSamples = Number(providerStatsSummary.total);
  const statsSuccesses = Number(providerStatsSummary.successes);
  const oddsSamples = Number(providerOddsSummary.total);
  const oddsUsable = Number(providerOddsSummary.usable);

  const recommendationPending = Number(settlementSummary.rec_pending);
  const recommendationUnresolved = Number(settlementSummary.rec_unresolved);
  const recommendationCorrected7d = Number(settlementSummary.rec_corrected_7d);
  const betPending = Number(settlementSummary.bet_pending);
  const betUnresolved = Number(settlementSummary.bet_unresolved);
  const settlementBacklog = recommendationPending + recommendationUnresolved + betPending + betUnresolved;

  const notificationAttempts24h = Number(notificationSummary.attempts);
  const notificationFailures24h = Number(notificationSummary.failures);
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

  const providerStatsSuccessRate = pct(statsSuccesses, statsSamples);
  const providerOddsUsableRate = pct(oddsUsable, oddsSamples);

  const checklist = buildOpsChecklist({
    activityLast2h: Number(pipelineSummary.activity_2h),
    jobFailures24h: jobFailuresRes.rows.reduce((sum, row) => sum + Number(row.count), 0),
    statsSamples,
    statsSuccessRate: providerStatsSuccessRate,
    oddsSamples,
    oddsUsableRate: providerOddsUsableRate,
    settlementBacklog,
    unresolvedCount: recommendationUnresolved + betUnresolved,
    notificationAttempts24h,
    notificationFailureRate24h,
  });

  const cards: OpsMetricCard[] = [
    {
      label: 'Pipeline Activity 2h',
      value: String(Number(pipelineSummary.activity_2h)),
      tone: checklist.find((item) => item.id === 'pipeline-activity')?.status ?? 'neutral',
      detail: 'audit events',
    },
    {
      label: 'Push Rate 24h',
      value: `${pct(shouldPush24h, analyzed24h)}%`,
      tone: analyzed24h > 0 ? 'neutral' : 'warn',
      detail: `${shouldPush24h}/${analyzed24h} analyzed`,
    },
    {
      label: 'Stats Coverage 6h',
      value: `${providerStatsSuccessRate}%`,
      tone: checklist.find((item) => item.id === 'stats-provider-coverage')?.status ?? 'neutral',
      detail: `${statsSamples} samples`,
    },
    {
      label: 'Odds Coverage 6h',
      value: `${providerOddsUsableRate}%`,
      tone: checklist.find((item) => item.id === 'odds-provider-coverage')?.status ?? 'neutral',
      detail: `${oddsSamples} samples`,
    },
    {
      label: 'Settle Backlog',
      value: String(settlementBacklog),
      tone: checklist.find((item) => item.id === 'settlement-backlog')?.status ?? 'neutral',
      detail: `${recommendationUnresolved + betUnresolved} unresolved`,
    },
    {
      label: 'Telegram Fail 24h',
      value: `${notificationFailureRate24h}%`,
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
  ];

  return {
    generatedAt: new Date().toISOString(),
    checklist,
    cards,
    pipeline: {
      activityLast2h: Number(pipelineSummary.activity_2h),
      analyzed24h,
      shouldPush24h,
      saved24h,
      notified24h,
      skipped24h,
      errors24h,
      pushRate24h: pct(shouldPush24h, analyzed24h),
      saveRate24h: pct(saved24h, analyzed24h),
      notifyRate24h: pct(notified24h, shouldPush24h),
      topSkipReasons: skipReasonsRes.rows.map((row) => ({
        reason: row.reason,
        count: Number(row.count),
      })),
      jobFailures24h: jobFailuresRes.rows.reduce((sum, row) => sum + Number(row.count), 0),
      jobFailuresByAction: jobFailuresRes.rows.map((row) => ({
        action: row.action,
        count: Number(row.count),
      })),
    },
    providers: {
      statsWindowHours: PROVIDER_WINDOW_HOURS,
      oddsWindowHours: PROVIDER_WINDOW_HOURS,
      statsSamples,
      statsSuccessRate: providerStatsSuccessRate,
      oddsSamples,
      oddsUsableRate: providerOddsUsableRate,
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
      shouldPushRate24h: pct(shouldPush24h, analyzed24h),
      exposureConcentration: promptExposure,
      ...promptQualitySummary,
    },
  };
}
