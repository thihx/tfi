import { query } from '../db/pool.js';
import { LIVE_ANALYSIS_PROMPT_VERSION } from './live-analysis-prompt.js';
import type { LiveOutputKind } from './live-output-router.js';

export type LiveOutputOperatorReasonGroup =
  | 'provider'
  | 'evidence'
  | 'model'
  | 'policy'
  | 'save'
  | 'delivery'
  | 'success'
  | 'unknown';

export interface LiveOutputOperatorReportOptions {
  lookbackHours: number;
  maxSamples: number;
}

export interface LiveOutputOperatorBreakdownRow {
  key: string;
  group: LiveOutputOperatorReasonGroup;
  outputKind: string;
  evidenceMode: string;
  count: number;
  latestAt: string | null;
}

export interface LiveOutputOperatorSampleRow {
  id: number;
  timestamp: string;
  matchId: string;
  matchDisplay: string;
  minute: string;
  status: string;
  score: string;
  outputKind: string;
  auditBucket: string;
  reasonGroup: LiveOutputOperatorReasonGroup;
  evidenceMode: string;
  route: string;
  llmCalled: boolean;
  savedRecommendation: boolean;
  settlementEligible: boolean;
  roiEligible: boolean;
  candidatePresent: boolean;
  noActionReason: string;
}

export interface LiveOutputOperatorReport {
  generatedAt: string;
  lookbackHours: number;
  officialPromptVersion: string;
  totals: {
    matchAnalyzed: number;
    moneyRecommendations: number;
    statsOnlySignals: number;
    watchInsights: number;
    shadowCandidates: number;
    noActions: number;
    llmCalled: number;
    llmSkipped: number;
  };
  outputKindBreakdown: Array<{
    outputKind: string;
    count: number;
    latestAt: string | null;
  }>;
  reasonGroupBreakdown: Array<{
    group: LiveOutputOperatorReasonGroup;
    count: number;
    latestAt: string | null;
  }>;
  reasonBuckets: LiveOutputOperatorBreakdownRow[];
  recentDrilldown: LiveOutputOperatorSampleRow[];
}

const PROVIDER_BUCKETS = new Set([
  'provider_quota_or_circuit_open',
  'provider_fetch_failed',
  'no_live_match',
  'no_active_watch_subscription',
  'watch_subscription_notify_disabled',
  'stale_snapshot',
]);

const EVIDENCE_BUCKETS = new Set([
  'low_evidence',
  'stats_only_weak_trigger',
  'stats_only_signal_emitted',
  'stats_only_signal_no_subscriber',
  'stats_only_signal_deduped',
  'stats_only_signal_delivery_blocked',
  'degraded_evidence_odds_events_only',
  'degraded_evidence_events_only',
  'no_tradable_canonical_market',
  'prematch_odds_reference_only',
]);

const MODEL_BUCKETS = new Set([
  'llm_skipped_by_route',
  'llm_cooldown',
  'llm_parse_error',
  'model_no_bet',
  'model_candidate_present',
]);

const POLICY_BUCKETS = new Set([
  'market_unresolved',
  'market_not_allowed_for_evidence_mode',
  'line_patience_blocked',
  'policy_blocked',
  'thin_edge_blocked',
  'same_thesis_blocked',
  'segment_policy_blocked',
]);

const SAVE_BUCKETS = new Set([
  'save_integrity_blocked',
  'recommendation_saved',
]);

const DELIVERY_BUCKETS = new Set([
  'delivery_staged',
  'delivery_no_target',
  'delivery_failed',
]);

function clampPositiveInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function asText(value: unknown, fallback = '(empty)'): string {
  if (value == null || value === '') return fallback;
  return String(value);
}

export function classifyLiveOutputAuditBucket(bucket: string): LiveOutputOperatorReasonGroup {
  const normalized = bucket.trim() || 'unknown';
  if (SAVE_BUCKETS.has(normalized)) {
    return normalized === 'recommendation_saved' ? 'success' : 'save';
  }
  if (PROVIDER_BUCKETS.has(normalized)) return 'provider';
  if (EVIDENCE_BUCKETS.has(normalized)) return 'evidence';
  if (MODEL_BUCKETS.has(normalized)) return 'model';
  if (POLICY_BUCKETS.has(normalized)) return 'policy';
  if (DELIVERY_BUCKETS.has(normalized)) return 'delivery';
  if (normalized.includes('policy')) return 'policy';
  if (normalized.includes('delivery')) return 'delivery';
  if (normalized.includes('save')) return 'save';
  if (normalized.includes('llm') || normalized.includes('model')) return 'model';
  if (normalized.includes('evidence') || normalized.includes('odds') || normalized.includes('stats')) return 'evidence';
  if (normalized.includes('provider') || normalized.includes('stale')) return 'provider';
  return 'unknown';
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function buildLiveOutputOperatorReport(
  options: LiveOutputOperatorReportOptions,
): Promise<LiveOutputOperatorReport> {
  const lookbackHours = clampPositiveInt(options.lookbackHours, 1, 24 * 365);
  const maxSamples = clampPositiveInt(options.maxSamples, 1, 200);
  const official = LIVE_ANALYSIS_PROMPT_VERSION;

  const outputKindExpr = "COALESCE(NULLIF(metadata->>'outputKind', ''), NULLIF(metadata#>>'{outputDecision,outputKind}', ''), 'unknown')";
  const auditBucketExpr = "COALESCE(NULLIF(metadata->>'auditBucket', ''), NULLIF(metadata#>>'{outputDecision,auditBucket}', ''), 'unknown')";
  const evidenceModeExpr = "COALESCE(NULLIF(metadata->>'evidenceMode', ''), NULLIF(metadata#>>'{outputDecision,evidenceMode}', ''), 'unknown')";
  const llmCalledExpr = "COALESCE(NULLIF(metadata->>'llmCalled', ''), NULLIF(metadata#>>'{outputDecision,llmCalled}', ''), 'false')";

  const [
    totalsResult,
    outputKindResult,
    bucketResult,
    sampleResult,
  ] = await Promise.all([
    query<{
      match_analyzed: string;
      money_recommendations: string;
      stats_only_signals: string;
      watch_insights: string;
      shadow_candidates: string;
      no_actions: string;
      llm_called: string;
      llm_skipped: string;
    }>(
      `SELECT
         COUNT(*)::text AS match_analyzed,
         COUNT(*) FILTER (WHERE ${outputKindExpr} = 'money_recommendation')::text AS money_recommendations,
         COUNT(*) FILTER (WHERE ${outputKindExpr} = 'stats_only_signal')::text AS stats_only_signals,
         COUNT(*) FILTER (WHERE ${outputKindExpr} = 'watch_insight')::text AS watch_insights,
         COUNT(*) FILTER (WHERE ${outputKindExpr} = 'shadow_candidate')::text AS shadow_candidates,
         COUNT(*) FILTER (WHERE ${outputKindExpr} = 'no_action')::text AS no_actions,
         COUNT(*) FILTER (WHERE ${llmCalledExpr} = 'true')::text AS llm_called,
         COUNT(*) FILTER (WHERE ${llmCalledExpr} <> 'true')::text AS llm_skipped
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action = 'PIPELINE_MATCH_ANALYZED'
         AND metadata->>'promptVersion' = $2
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')`,
      [lookbackHours, official],
    ),
    query<{ output_kind: string; count: string; latest_at: Date | string | null }>(
      `SELECT
         ${outputKindExpr} AS output_kind,
         COUNT(*)::text AS count,
         MAX(timestamp) AS latest_at
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action = 'PIPELINE_MATCH_ANALYZED'
         AND metadata->>'promptVersion' = $2
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1
       ORDER BY COUNT(*) DESC, output_kind`,
      [lookbackHours, official],
    ),
    query<{
      audit_bucket: string;
      output_kind: string;
      evidence_mode: string;
      count: string;
      latest_at: Date | string | null;
    }>(
      `SELECT
         ${auditBucketExpr} AS audit_bucket,
         ${outputKindExpr} AS output_kind,
         ${evidenceModeExpr} AS evidence_mode,
         COUNT(*)::text AS count,
         MAX(timestamp) AS latest_at
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action = 'PIPELINE_MATCH_ANALYZED'
         AND metadata->>'promptVersion' = $2
         AND ${outputKindExpr} <> 'money_recommendation'
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1, 2, 3
       ORDER BY COUNT(*) DESC, latest_at DESC
       LIMIT 50`,
      [lookbackHours, official],
    ),
    query<{
      id: string;
      timestamp: Date | string;
      match_id: string | null;
      metadata: Record<string, unknown> | string | null;
    }>(
      `SELECT
         id::text,
         timestamp,
         match_id,
         metadata
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action = 'PIPELINE_MATCH_ANALYZED'
         AND metadata->>'promptVersion' = $2
         AND ${outputKindExpr} <> 'money_recommendation'
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       ORDER BY timestamp DESC, id DESC
       LIMIT $3`,
      [lookbackHours, official, maxSamples],
    ),
  ]);

  const totals = totalsResult.rows[0];
  const reasonBuckets = bucketResult.rows.map((row) => ({
    key: row.audit_bucket,
    group: classifyLiveOutputAuditBucket(row.audit_bucket),
    outputKind: row.output_kind,
    evidenceMode: row.evidence_mode,
    count: Number(row.count),
    latestAt: nullableIso(row.latest_at),
  }));
  const reasonGroupMap = new Map<LiveOutputOperatorReasonGroup, { count: number; latestAt: string | null }>();
  for (const row of reasonBuckets) {
    const existing = reasonGroupMap.get(row.group) ?? { count: 0, latestAt: null };
    const latestAt = row.latestAt && (!existing.latestAt || row.latestAt > existing.latestAt)
      ? row.latestAt
      : existing.latestAt;
    reasonGroupMap.set(row.group, { count: existing.count + row.count, latestAt });
  }

  return {
    generatedAt: new Date().toISOString(),
    lookbackHours,
    officialPromptVersion: official,
    totals: {
      matchAnalyzed: Number(totals?.match_analyzed ?? 0),
      moneyRecommendations: Number(totals?.money_recommendations ?? 0),
      statsOnlySignals: Number(totals?.stats_only_signals ?? 0),
      watchInsights: Number(totals?.watch_insights ?? 0),
      shadowCandidates: Number(totals?.shadow_candidates ?? 0),
      noActions: Number(totals?.no_actions ?? 0),
      llmCalled: Number(totals?.llm_called ?? 0),
      llmSkipped: Number(totals?.llm_skipped ?? 0),
    },
    outputKindBreakdown: outputKindResult.rows.map((row) => ({
      outputKind: row.output_kind,
      count: Number(row.count),
      latestAt: nullableIso(row.latest_at),
    })),
    reasonGroupBreakdown: Array.from(reasonGroupMap.entries())
      .map(([group, value]) => ({ group, count: value.count, latestAt: value.latestAt }))
      .sort((left, right) => right.count - left.count || left.group.localeCompare(right.group)),
    reasonBuckets,
    recentDrilldown: sampleResult.rows.map((row) => {
      const metadata = parseMetadata(row.metadata);
      const outputDecision = parseMetadata(metadata['outputDecision']);
      const outputKind = asText(metadata['outputKind'] ?? outputDecision['outputKind'], 'unknown') as LiveOutputKind | 'unknown';
      const auditBucket = asText(metadata['auditBucket'] ?? outputDecision['auditBucket'], 'unknown');
      return {
        id: Number(row.id),
        timestamp: nullableIso(row.timestamp) ?? String(row.timestamp),
        matchId: asText(metadata['matchId'] ?? row.match_id),
        matchDisplay: asText(metadata['matchDisplay']),
        minute: asText(metadata['minute']),
        status: asText(metadata['status']),
        score: asText(metadata['score']),
        outputKind,
        auditBucket,
        reasonGroup: classifyLiveOutputAuditBucket(auditBucket),
        evidenceMode: asText(metadata['evidenceMode'] ?? outputDecision['evidenceMode'], 'unknown'),
        route: asText(outputDecision['route'], 'unknown'),
        llmCalled: parseBoolean(metadata['llmCalled'] ?? outputDecision['llmCalled']),
        savedRecommendation: parseBoolean(metadata['savedRecommendation'] ?? outputDecision['savedRecommendation'] ?? metadata['saved']),
        settlementEligible: parseBoolean(metadata['settlementEligible'] ?? outputDecision['settlementEligible']),
        roiEligible: parseBoolean(metadata['roiEligible'] ?? outputDecision['roiEligible']),
        candidatePresent: parseBoolean(outputDecision['candidatePresent']),
        noActionReason: asText(outputDecision['noActionReason'] ?? metadata['llmDecisionDiagnostic'] ?? auditBucket, ''),
      };
    }),
  };
}
