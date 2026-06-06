import { useCallback, useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { getToken } from '@/lib/services/auth';
import { internalApiUrl } from '@/lib/internal-api';
import { formatLocalDateTime } from '@/lib/utils/helpers';

type ChecklistStatus = 'pass' | 'warn' | 'fail' | 'unknown';
type CardTone = ChecklistStatus | 'neutral';

interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
}

interface MetricCard {
  label: string;
  value: string;
  tone: CardTone;
  detail?: string;
}

interface PipelineOverview {
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

interface ProviderStatsBreakdown {
  provider: string;
  samples: number;
  successRate: number;
  avgLatencyMs: number;
  possessionCoverageRate: number;
  shotsOnTargetCoverageRate: number;
}

interface ProviderOddsBreakdown {
  provider: string;
  source: string;
  samples: number;
  usableRate: number;
  avgLatencyMs: number;
  oneX2Rate: number;
  overUnderRate: number;
  asianHandicapRate: number;
  canonicalOneX2Rate?: number;
  canonicalOverUnderRate?: number;
  canonicalAsianHandicapRate?: number;
}

interface ProviderOverview {
  statsWindowHours: number;
  oddsWindowHours: number;
  statsSamples: number;
  statsSuccessRate: number;
  oddsSamples: number;
  oddsUsableRate: number;
  oddsTradableRate?: number;
  statsByProvider: ProviderStatsBreakdown[];
  oddsByProvider: ProviderOddsBreakdown[];
  samplingEnabled: boolean;
}

interface WorkloadOverview {
  pipelineEnabled: boolean;
  activeWatchCount: number;
  liveWatchCount: number;
  providerSamplesExpected: boolean;
  notificationExpected24h: boolean;
}

interface LlmOpsOverview {
  windowHours: number;
  blocked24h: number;
  started24h: number;
  completed24h: number;
  failed24h: number;
  failureRate24h: number;
  topBlockReasons: Array<{ reason: string; count: number }>;
  diagnosticBreakdown: Array<{ diagnostic: string; count: number }>;
}

interface AiGatewayOverview {
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

interface AiGatewayIncident {
  id: number;
  created_at: string;
  status: string;
  severity: string;
  incident_type: string;
  title: string;
  feature_key: string | null;
  operation: string | null;
  match_id: string | null;
}

interface AiGatewayBreaker {
  id: number;
  updated_at: string;
  status: string;
  scope_type: string;
  scope_key: string;
  reason: string;
  severity: string;
}

interface AiGatewayLog {
  id: number;
  created_at: string;
  provider: string;
  model: string;
  operation: string;
  feature_key: string;
  mode: string;
  status: string;
  decision: string;
  reason: string | null;
  severity: string;
  match_id: string | null;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: string | number;
  latency_ms: number | null;
}

interface AiGatewayDetails {
  incidents: AiGatewayIncident[];
  breakers: AiGatewayBreaker[];
  logs: AiGatewayLog[];
}

interface DecisionFunnelStage {
  id: string;
  label: string;
  count: number;
  rateFromPrevious: number;
  rateFromStart: number;
}

interface DecisionFunnelOverview {
  windowHours: number;
  source: string;
  stages: DecisionFunnelStage[];
  silentBreakdown: Array<{ reason: string; count: number }>;
}

interface SettlementOverview {
  recommendationPending: number;
  recommendationUnresolved: number;
  recommendationCorrected7d: number;
  betPending: number;
  betUnresolved: number;
  methodMix30d: Array<{ method: string; count: number }>;
  unresolvedByMarket: Array<{ market: string; count: number }>;
}

interface NotificationOverview {
  attempts24h: number;
  failures24h: number;
  failureRate24h: number;
  stalePending: number;
  deliveredRecommendations24h: number;
}

interface PromptShadowVersionBreakdown {
  executionRole: string;
  promptVersion: string;
  samples: number;
  successRate: number;
  avgLatencyMs: number;
  avgPromptTokens: number;
}

interface PromptShadowOverview {
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

interface ExposureCluster {
  matchId: string;
  matchDisplay: string;
  thesisKey: string;
  label: string;
  count: number;
  settledCount: number;
  totalStake: number;
  totalPnl: number;
  latestMinute: number | null;
  canonicalMarkets: string[];
}

interface ExposureSummary {
  stackedClusters: number;
  stackedRecommendations: number;
  stackedStake: number;
  maxClusterStake: number;
  topClusters: ExposureCluster[];
}

interface PromptQualityOverview {
  windowHours: number;
  notifyEligibleRate24h: number;
  totalRecommendations: number;
  sameThesisClusters: number;
  sameThesisStackedRows: number;
  sameThesisStackingRate: number;
  sameThesisStackedStake: number;
  cornersRows: number;
  cornersUsageRate: number;
  lateHighLineRows: number;
  lateHighLineRate: number;
  lateHighLineStake: number;
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

interface PromptOnlyOverview {
  windowHours: number;
  totalRows: number;
  successRows: number;
  skippedRows: number;
  failedRows: number;
  structuredEligibleRows: number;
  structuredEligibleRate: number;
  reasonBreakdown: Array<{ reason: string; count: number }>;
}

interface OpsMonitoringSnapshot {
  generatedAt: string;
  workload: WorkloadOverview;
  llm: LlmOpsOverview;
  aiGateway?: AiGatewayOverview;
  decisionFunnel: DecisionFunnelOverview;
  checklist: ChecklistItem[];
  cards: MetricCard[];
  pipeline: PipelineOverview;
  providers: ProviderOverview;
  settlement: SettlementOverview;
  notifications: NotificationOverview;
  promptShadow: PromptShadowOverview;
  promptQuality: PromptQualityOverview;
  promptOnly: PromptOnlyOverview;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const TONE: Record<CardTone, { bg: string; border: string; text: string; accent: string }> = {
  pass:    { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', accent: '#16a34a' },
  warn:    { bg: '#fffbeb', border: '#fde68a', text: '#92400e', accent: '#d97706' },
  fail:    { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', accent: '#dc2626' },
  unknown: { bg: 'var(--gray-50)', border: 'var(--gray-200)', text: 'var(--gray-600)', accent: 'var(--gray-400)' },
  neutral: { bg: 'var(--gray-50)', border: 'var(--gray-200)', text: 'var(--gray-700)', accent: 'var(--gray-400)' },
};

const STATUS_ICON: Record<ChecklistStatus, string> = {
  pass: '✓',
  warn: '!',
  unknown: '?',
  fail: '✗',
};

const STATUS_COLOR: Record<ChecklistStatus, { bg: string; text: string; ring: string }> = {
  pass: { bg: '#dcfce7', text: '#166534', ring: '#86efac' },
  warn: { bg: '#fef9c3', text: '#854d0e', ring: '#fde047' },
  fail: { bg: '#fee2e2', text: '#991b1b', ring: '#fca5a5' },
  unknown: { bg: 'var(--gray-100)', text: 'var(--gray-600)', ring: 'var(--gray-300)' },
};

const LLM_REASON_LABELS: Record<string, string> = {
  no_active_watch_subscription: 'No active watch subscription',
  match_not_live_for_auto_pipeline: 'Match not live for auto pipeline',
  minute_outside_auto_pipeline_window: 'Outside auto minute window',
  low_evidence_without_watch_condition: 'Low evidence without watch condition',
  degraded_evidence_without_watch_condition: 'Degraded evidence without watch condition',
  no_tradable_canonical_market: 'No tradable canonical market',
  auto_llm_cooldown_active: 'Cooldown active',
};

const LLM_DIAGNOSTIC_LABELS: Record<string, string> = {
  actionable: 'Actionable',
  no_bet_intentional: 'Intentional no-bet',
  market_parse_failed: 'Market parse failed',
  market_not_available_in_odds: 'Market not available in odds',
  policy_blocked: 'Policy blocked',
  unknown: 'Unknown',
};

// ── Sub-components ──────────────────────────────────────────────────────────────

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const s = STATUS_COLOR[item.status];
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      padding: '10px 12px',
      borderLeft: `3px solid ${s.ring}`,
      background: item.status !== 'pass' ? s.bg + '66' : 'transparent',
      borderRadius: '0 6px 6px 0',
    }}>
      <div style={{
        flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
        background: s.bg, border: `1.5px solid ${s.ring}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '11px', fontWeight: 800, color: s.text,
      }}>
        {STATUS_ICON[item.status]}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)', lineHeight: 1.3 }}>{item.label}</div>
        <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px', lineHeight: 1.4 }}>{item.detail}</div>
      </div>
    </div>
  );
}

function KpiCard({ card }: { card: MetricCard }) {
  const t = TONE[card.tone];
  return (
    <div style={{
      padding: '14px 16px', borderRadius: '10px',
      background: t.bg, border: `1px solid ${t.border}`,
      display: 'flex', flexDirection: 'column', gap: '2px',
    }}>
      <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {card.label}
      </div>
      <div style={{ fontSize: '26px', fontWeight: 800, color: t.text, lineHeight: 1.1, marginTop: '2px' }}>
        {card.value}
      </div>
      {card.detail && (
        <div style={{ fontSize: '11px', color: t.accent, marginTop: '4px', fontWeight: 500 }}>{card.detail}</div>
      )}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {title}
      </div>
      {subtitle && <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '1px' }}>{subtitle}</div>}
    </div>
  );
}

function DataTable({ headers, rows, emptyText = 'No data' }: {
  headers: string[];
  rows: Array<Array<string | number>>;
  emptyText?: string;
}) {
  return (
    <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--gray-150, #f0f0f0)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: 'var(--gray-50)' }}>
            {headers.map((h) => (
              <th key={h} style={{
                padding: '7px 10px', textAlign: 'left', fontWeight: 600,
                color: 'var(--gray-500)', borderBottom: '1px solid var(--gray-200)',
                whiteSpace: 'nowrap', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.3px',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} style={{ padding: '12px 10px', color: 'var(--gray-400)', fontSize: '12px' }}>
                {emptyText}
              </td>
            </tr>
          ) : rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '7px 10px', color: 'var(--gray-700)', whiteSpace: 'nowrap' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', padding: '14px 16px' }}>
      {children}
    </div>
  );
}

function rawTrade(raw: number, canonical?: number): string {
  return `${raw}%/${canonical ?? raw}%`;
}

function DiagnosticsDetails({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <details style={{
      background: '#fff',
      border: '1px solid var(--gray-200)',
      borderRadius: '10px',
      padding: '0',
    }}>
      <summary style={{
        cursor: 'pointer',
        listStyle: 'none',
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        alignItems: 'center',
      }}>
        <span>
          <span style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {title}
          </span>
          {subtitle && <span style={{ display: 'block', fontSize: '11px', color: 'var(--gray-400)', marginTop: '1px' }}>{subtitle}</span>}
        </span>
        <span aria-hidden="true" style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Open</span>
      </summary>
      <div style={{ borderTop: '1px solid var(--gray-100)', padding: '14px 16px' }}>
        {children}
      </div>
    </details>
  );
}

function formatJobAction(action: string): string {
  return action.replace(/^JOB_/, '').toLowerCase().replace(/_/g, '-');
}

function formatJobName(jobName: string): string {
  return jobName.replace(/-/g, ' ');
}

function humanizeReasonCode(reason: string): string {
  const map: Record<string, string> = {
    eligible: 'Eligible for structured prematch analysis',
    low_evidence_without_watch_condition: 'Low evidence and no custom watch condition',
    prompt_only_failed: 'Prompt-only analysis failed',
    prediction_or_profile_coverage_too_thin: 'Prediction or profile coverage too thin',
    prematch_features_missing: 'Prematch features missing',
    top_league_required: 'Top-league structured path required',
    manual_force_required: 'Manual force path required',
    staleness_gate: 'Staleness gate',
    proceed_gate: 'Proceed gate',
    llm_eligibility_blocked: 'LLM eligibility blocked',
    model_no_bet: 'Model no-bet',
    policy_blocked: 'Policy blocked',
    save_blocked_provider_coverage: 'Save blocked by provider coverage',
    pipeline_error: 'Pipeline error',
    pre_llm_total: 'Pre-LLM total',
    unknown: 'Unknown',
  };
  if (reason in map) return map[reason]!;
  return reason.replace(/_/g, ' ');
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '12px' }}>
        <span style={{ color: 'var(--gray-600)' }}>{label}</span>
        <span style={{ fontWeight: 600, color: 'var(--gray-800)' }}>{value} <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>({pct}%)</span></span>
      </div>
      <div style={{ height: '5px', background: 'var(--gray-100)', borderRadius: '999px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '999px', transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export function OpsMonitoringPanel() {
  const { state } = useAppState();
  const apiUrl = state.config.apiUrl;
  const [snapshot, setSnapshot] = useState<OpsMonitoringSnapshot | null>(null);
  const [aiGatewayDetails, setAiGatewayDetails] = useState<AiGatewayDetails>({
    incidents: [],
    breakers: [],
    logs: [],
  });
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAiGatewayDetails = useCallback(async () => {
    if (apiUrl == null) return;
    const [incidentsRes, breakersRes, logsRes] = await Promise.all([
      fetch(internalApiUrl('/api/ops/ai-gateway/incidents?limit=8', apiUrl), {
        headers: authHeaders(),
        credentials: 'include',
      }),
      fetch(internalApiUrl('/api/ops/ai-gateway/breakers?limit=8', apiUrl), {
        headers: authHeaders(),
        credentials: 'include',
      }),
      fetch(internalApiUrl('/api/ops/ai-gateway/logs?limit=12', apiUrl), {
        headers: authHeaders(),
        credentials: 'include',
      }),
    ]);
    if (!incidentsRes.ok || !breakersRes.ok || !logsRes.ok) return;
    const [incidentsBody, breakersBody, logsBody] = await Promise.all([
      incidentsRes.json() as Promise<{ rows?: AiGatewayIncident[] }>,
      breakersRes.json() as Promise<{ rows?: AiGatewayBreaker[] }>,
      logsRes.json() as Promise<{ rows?: AiGatewayLog[] }>,
    ]);
    setAiGatewayDetails({
      incidents: incidentsBody.rows ?? [],
      breakers: breakersBody.rows ?? [],
      logs: logsBody.rows ?? [],
    });
  }, [apiUrl]);

  const fetchSnapshot = useCallback(async () => {
    if (apiUrl == null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(internalApiUrl('/api/ops/overview', apiUrl), {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; detail?: string };
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      setSnapshot(await res.json());
      await fetchAiGatewayDetails();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, fetchAiGatewayDetails]);

  const runAiGatewayAction = useCallback(async (path: string, busyKey: string) => {
    if (apiUrl == null) return;
    setActionBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(internalApiUrl(path, apiUrl), {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ note: 'Updated from Ops Monitoring' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; detail?: string };
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      await Promise.all([fetchSnapshot(), fetchAiGatewayDetails()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(null);
    }
  }, [apiUrl, fetchAiGatewayDetails, fetchSnapshot]);

  useEffect(() => {
    void fetchSnapshot();
    const timer = window.setInterval(() => { void fetchSnapshot(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [fetchSnapshot]);

  if (apiUrl == null) {
    return <p style={{ color: 'var(--gray-500)' }}>Backend URL not configured</p>;
  }

  // ── Overall health summary ─────────────────────────────────────────────────
  const overallStatus: ChecklistStatus = snapshot
    ? snapshot.checklist.some((c) => c.status === 'fail') ? 'fail'
      : snapshot.checklist.some((c) => c.status === 'warn') ? 'warn'
      : snapshot.checklist.some((c) => c.status === 'unknown') ? 'unknown'
      : 'pass'
    : 'pass';

  const healthLabel = overallStatus === 'pass' ? 'All systems operational'
    : overallStatus === 'warn' ? 'Needs attention'
    : overallStatus === 'unknown' ? 'Insufficient signal'
    : 'Critical issues detected';

  const healthStyle = STATUS_COLOR[overallStatus];
  const topCauses = snapshot
    ? snapshot.checklist.filter((item) => item.status === 'fail' || item.status === 'warn').slice(0, 3)
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── Top bar: health banner + refresh ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {snapshot && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px',
              padding: '5px 12px', borderRadius: '999px',
              background: healthStyle.bg, border: `1px solid ${healthStyle.ring}`,
            }}>
              <span style={{ fontSize: '13px', fontWeight: 800, color: healthStyle.text }}>
                {STATUS_ICON[overallStatus]}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: healthStyle.text }}>{healthLabel}</span>
            </div>
          )}
          {!snapshot && !loading && !error && (
            <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>Loading...</span>
          )}
          {loading && <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>Refreshing...</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {snapshot && (
            <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>
              Updated {formatLocalDateTime(snapshot.generatedAt)}
            </span>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void fetchSnapshot()}
            disabled={loading}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: '8px',
          background: '#fef2f2', border: '1px solid #fecaca',
          color: '#991b1b', fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {snapshot && (
        <>
          {topCauses.length > 0 && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: overallStatus === 'fail' ? '#fef2f2' : '#fffbeb',
              border: `1px solid ${overallStatus === 'fail' ? '#fecaca' : '#fde68a'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: overallStatus === 'fail' ? '#991b1b' : '#92400e' }}>
                Top operational causes
              </div>
              {topCauses.map((item) => (
                <div key={item.id} style={{ fontSize: '12px', color: 'var(--gray-700)', lineHeight: 1.4 }}>
                  <strong>{item.label}:</strong> {item.detail}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
            {[
              { label: 'Pipeline', value: snapshot.workload.pipelineEnabled ? 'enabled' : 'disabled' },
              { label: 'Active watch', value: snapshot.workload.activeWatchCount },
              { label: 'Live watch', value: snapshot.workload.liveWatchCount },
              { label: 'Sampling', value: snapshot.providers.samplingEnabled ? 'enabled' : 'disabled' },
            ].map((item) => (
              <div key={item.label} style={{ padding: '8px 10px', borderRadius: '6px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)' }}>
                <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--gray-800)', marginTop: '2px' }}>{item.value}</div>
              </div>
            ))}
          </div>
          {/* ── Section 1: Checklist ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: '6px' }}>
            {snapshot.checklist.map((item) => <ChecklistRow key={item.id} item={item} />)}
          </div>

          {/* ── Section 2: KPI cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
            {snapshot.cards.map((card) => <KpiCard key={card.label} card={card} />)}
          </div>

          {/* ── Section 3: Pipeline ── */}
          <DataCard>
            <SectionHeader title="Pipeline" subtitle="24h window" />
            <div className="ops-panel-split-grid ops-panel-split-grid--lg">
              <div>
                <div style={{ marginBottom: '12px' }}>
                  <FunnelBar label="Analyzed" value={snapshot.pipeline.analyzed24h} max={snapshot.pipeline.analyzed24h + snapshot.pipeline.skipped24h} color="#6366f1" />
                  <FunnelBar label="Notify-Eligible" value={snapshot.pipeline.notifyEligible24h} max={snapshot.pipeline.analyzed24h} color="#8b5cf6" />
                  <FunnelBar label="Saved" value={snapshot.pipeline.saved24h} max={snapshot.pipeline.analyzed24h} color="#3b82f6" />
                  <FunnelBar label="Notified" value={snapshot.pipeline.notified24h} max={snapshot.pipeline.notifyEligible24h} color="#10b981" />
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--gray-100)', display: 'flex', gap: '16px', fontSize: '12px' }}>
                    <span style={{ color: 'var(--gray-500)' }}>Skipped: <strong style={{ color: 'var(--gray-700)' }}>{snapshot.pipeline.skipped24h}</strong></span>
                    <span style={{ color: snapshot.pipeline.errors24h > 0 ? '#dc2626' : 'var(--gray-500)' }}>
                      Errors: <strong>{snapshot.pipeline.errors24h}</strong>
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>Top Skip Reasons</div>
                  {snapshot.pipeline.topSkipReasons.length === 0
                    ? <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>None</div>
                    : snapshot.pipeline.topSkipReasons.map((r) => (
                      <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid var(--gray-100)' }}>
                        <span style={{ color: 'var(--gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{r.reason}</span>
                        <span style={{ fontWeight: 600, color: 'var(--gray-800)', flexShrink: 0 }}>{r.count}</span>
                      </div>
                    ))
                  }
                </div>
                {snapshot.pipeline.jobFailuresByAction.length > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>Job Failures (24h)</div>
                    {snapshot.pipeline.jobFailuresByAction.map((r) => (
                      <div key={r.action} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid var(--gray-100)' }}>
                        <span style={{ color: 'var(--gray-600)' }}>{formatJobAction(r.action)}</span>
                        <span style={{ fontWeight: 700, color: '#dc2626' }}>{r.count}</span>
                      </div>
                    ))}
                  </div>
                )}
                {snapshot.pipeline.failingJobs24h.length > 0 && (
                  <DataTable
                    headers={['Job', 'Failures', 'Last', 'Error']}
                    rows={snapshot.pipeline.failingJobs24h.map((job) => [
                      formatJobName(job.jobName),
                      `${job.failureRuns}/${job.totalRuns}`,
                      job.lastStatus ?? '-',
                      job.lastError ? job.lastError.slice(0, 80) : '-',
                    ])}
                  />
                )}
              </div>
            </div>
          </DataCard>

          {/* ── Section 4: Providers ── */}
          <DataCard>
            <SectionHeader title="Decision Funnel" subtitle={`Last ${snapshot.decisionFunnel.windowHours}h`} />
            <div className="ops-panel-split-grid ops-panel-split-grid--lg">
              <DataTable
                headers={['Stage', 'Count', 'Prev.', 'Start']}
                rows={snapshot.decisionFunnel.stages.map((stage) => [
                  stage.label,
                  stage.count,
                  `${stage.rateFromPrevious}%`,
                  `${stage.rateFromStart}%`,
                ])}
                emptyText="No funnel samples"
              />
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>
                  Silent Reasons
                </div>
                {snapshot.decisionFunnel.silentBreakdown.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>No silent/drop-off reasons recorded</div>
                ) : snapshot.decisionFunnel.silentBreakdown.map((row) => (
                  <div key={row.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid var(--gray-100)' }}>
                    <span style={{ color: 'var(--gray-600)', marginRight: 8 }}>{humanizeReasonCode(row.reason)}</span>
                    <span style={{ fontWeight: 700, color: 'var(--gray-800)', flexShrink: 0 }}>{row.count}</span>
                  </div>
                ))}
                <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--gray-400)' }}>
                  Source: {snapshot.decisionFunnel.source}
                </div>
              </div>
            </div>
          </DataCard>

          <DiagnosticsDetails
            title="Provider diagnostics"
            subtitle={`Stats ${snapshot.providers.statsSuccessRate}% / Odds ${snapshot.providers.oddsUsableRate}%`}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '12px' }}>
              <div>
                <SectionHeader title={`Stats Providers`} subtitle={`Last ${snapshot.providers.statsWindowHours}h`} />
                <DataTable
                  headers={['Provider', 'Success', 'Poss.', 'SOT', 'Latency']}
                  rows={snapshot.providers.statsByProvider.map((r) => [
                    r.provider,
                    `${r.successRate}% (${r.samples})`,
                    `${r.possessionCoverageRate}%`,
                    `${r.shotsOnTargetCoverageRate}%`,
                    `${r.avgLatencyMs}ms`,
                  ])}
                  emptyText="No stats samples"
                />
              </div>
              <div>
                <SectionHeader title="Odds Providers" subtitle={`Last ${snapshot.providers.oddsWindowHours}h`} />
                <DataTable
                  headers={['Provider', 'Source', 'Usable', '1X2 R/T', 'OU R/T', 'AH R/T', 'Latency']}
                  rows={snapshot.providers.oddsByProvider.map((r) => [
                    r.provider, r.source,
                    `${r.usableRate}% (${r.samples})`,
                    rawTrade(r.oneX2Rate, r.canonicalOneX2Rate),
                    rawTrade(r.overUnderRate, r.canonicalOverUnderRate),
                    rawTrade(r.asianHandicapRate, r.canonicalAsianHandicapRate),
                    `${r.avgLatencyMs}ms`,
                  ])}
                  emptyText="No odds samples"
                />
              </div>
            </div>
          </DiagnosticsDetails>

          {/* ── Section 5: Settlement + Notifications side by side ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '12px' }}>
            <DataCard>
              <SectionHeader title="Settlement" />
              <div className="ops-panel-split-grid ops-panel-split-grid--sm" style={{ marginBottom: '12px' }}>
                {[
                  { label: 'Rec. Pending', value: snapshot.settlement.recommendationPending, warn: snapshot.settlement.recommendationPending > 20 },
                  { label: 'Rec. Unresolved', value: snapshot.settlement.recommendationUnresolved, warn: snapshot.settlement.recommendationUnresolved > 5 },
                  { label: 'Pick pending', value: snapshot.settlement.betPending, warn: snapshot.settlement.betPending > 20 },
                  { label: 'Unresolved picks', value: snapshot.settlement.betUnresolved, warn: snapshot.settlement.betUnresolved > 5 },
                ].map((item) => (
                  <div key={item.label} style={{ padding: '8px 10px', borderRadius: '6px', background: item.warn ? '#fef2f2' : 'var(--gray-50)', border: `1px solid ${item.warn ? '#fecaca' : 'var(--gray-200)'}` }}>
                    <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: item.warn ? '#dc2626' : 'var(--gray-800)', lineHeight: 1.2, marginTop: '2px' }}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="ops-panel-split-grid ops-panel-split-grid--sm">
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Method Mix (30d)</div>
                  {snapshot.settlement.methodMix30d.map((r) => (
                    <div key={r.method} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }}>
                      <span style={{ color: 'var(--gray-600)' }}>{r.method}</span>
                      <span style={{ fontWeight: 600 }}>{r.count}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Unresolved Markets</div>
                  {snapshot.settlement.unresolvedByMarket.map((r) => (
                    <div key={r.market} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }}>
                      <span style={{ color: 'var(--gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 4 }}>{r.market}</span>
                      <span style={{ fontWeight: 600 }}>{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </DataCard>

            <DataCard>
              <SectionHeader title="Notifications" subtitle="24h window" />
              <div className="ops-panel-split-grid ops-panel-split-grid--sm" style={{ marginBottom: '12px' }}>
                {[
                  { label: 'Attempts', value: snapshot.notifications.attempts24h, warn: false },
                  { label: 'Failures', value: snapshot.notifications.failures24h, warn: snapshot.notifications.failures24h > 0 },
                  { label: 'Failure Rate', value: `${snapshot.notifications.failureRate24h}%`, warn: snapshot.notifications.failureRate24h > 10 },
                  { label: 'Stale Pending', value: snapshot.notifications.stalePending, warn: snapshot.notifications.stalePending > 0 },
                  { label: 'Delivered', value: snapshot.notifications.deliveredRecommendations24h, warn: false },
                ].map((item) => (
                  <div key={item.label} style={{ padding: '8px 10px', borderRadius: '6px', background: item.warn ? '#fef2f2' : 'var(--gray-50)', border: `1px solid ${item.warn ? '#fecaca' : 'var(--gray-200)'}` }}>
                    <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: item.warn ? '#dc2626' : 'var(--gray-800)', lineHeight: 1.2, marginTop: '2px' }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Prompt Shadow summary */}
              <SectionHeader title="Prompt Shadow" subtitle={`Last ${snapshot.promptShadow.windowHours}h`} />
              <div className="ops-panel-split-grid ops-panel-split-grid--sm" style={{ marginBottom: '10px' }}>
                {[
                  { label: 'Runs', value: snapshot.promptShadow.runs24h },
                  { label: 'Shadow rows', value: snapshot.promptShadow.shadowRows24h },
                  { label: 'Should-push agree', value: `${snapshot.promptShadow.shouldPushAgreementRate24h}%` },
                  { label: 'Market agree', value: `${snapshot.promptShadow.marketAgreementRate24h}%` },
                ].map((item) => (
                  <div key={item.label} style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--gray-100)' }}>
                    <span style={{ color: 'var(--gray-500)' }}>{item.label}</span>
                    <span style={{ fontWeight: 600, color: 'var(--gray-800)' }}>{item.value}</span>
                  </div>
                ))}
              </div>
              {snapshot.promptShadow.versionBreakdown.length > 0 && (
                <DataTable
                  headers={['Role', 'Version', 'Success', 'Latency']}
                  rows={snapshot.promptShadow.versionBreakdown.map((r) => [
                    r.executionRole, r.promptVersion,
                    `${r.successRate}% (${r.samples})`,
                    `${r.avgLatencyMs}ms`,
                  ])}
                />
              )}
              {snapshot.promptShadow.versionBreakdown.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>Prompt shadow is disabled or has no samples.</div>
              )}
              {snapshot.promptShadow.disagreementTypes.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Drift Types</div>
                  {snapshot.promptShadow.disagreementTypes.map((r) => (
                    <div key={r.type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }}>
                      <span style={{ color: 'var(--gray-600)' }}>{r.type}</span>
                      <span style={{ fontWeight: 600 }}>{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </DataCard>
          </div>

          <DataCard>
            <SectionHeader title="LLM Cost Guard" subtitle={`Last ${snapshot.llm.windowHours}h`} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              {[
                { label: 'Blocked', value: snapshot.llm.blocked24h, warn: snapshot.llm.blocked24h > snapshot.llm.started24h },
                { label: 'Started', value: snapshot.llm.started24h, warn: false },
                { label: 'Completed', value: snapshot.llm.completed24h, warn: false },
                { label: 'Failed', value: `${snapshot.llm.failureRate24h}%`, warn: snapshot.llm.failureRate24h > 5 },
              ].map((item) => (
                <div key={item.label} style={{ padding: '8px 10px', borderRadius: '6px', background: item.warn ? '#fef2f2' : 'var(--gray-50)', border: `1px solid ${item.warn ? '#fecaca' : 'var(--gray-200)'}` }}>
                  <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: item.warn ? '#dc2626' : 'var(--gray-800)', lineHeight: 1.2, marginTop: '2px' }}>{item.value}</div>
                </div>
              ))}
            </div>
            {snapshot.aiGateway && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                  {[
                    { label: 'Gateway Mode', value: snapshot.aiGateway.mode, warn: snapshot.aiGateway.mode === 'off' },
                    { label: 'Gateway Blocked', value: snapshot.aiGateway.blocked24h, warn: snapshot.aiGateway.blocked24h > 0 },
                    { label: 'Open Breakers', value: snapshot.aiGateway.openBreakers, warn: snapshot.aiGateway.openBreakers > 0 },
                    { label: 'Open Incidents', value: snapshot.aiGateway.openIncidents, warn: snapshot.aiGateway.openIncidents > 0 },
                    { label: 'Est. Cost', value: `$${snapshot.aiGateway.estimatedCost24h}`, warn: false },
                  ].map((item) => (
                    <div key={item.label} style={{ padding: '8px 10px', borderRadius: '6px', background: item.warn ? '#fef2f2' : 'var(--gray-50)', border: `1px solid ${item.warn ? '#fecaca' : 'var(--gray-200)'}` }}>
                      <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: item.warn ? '#dc2626' : 'var(--gray-800)', lineHeight: 1.2, marginTop: '2px' }}>{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="ops-panel-split-grid" style={{ marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Gateway reasons</div>
                    {snapshot.aiGateway.topReasons.length === 0
                      ? <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>No gateway blocks or failures.</div>
                      : snapshot.aiGateway.topReasons.map((row) => (
                        <div key={row.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid var(--gray-100)' }}>
                          <span style={{ color: 'var(--gray-600)' }}>{humanizeReasonCode(row.reason)}</span>
                          <span style={{ fontWeight: 600 }}>{row.count}</span>
                        </div>
                      ))
                    }
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Open breaker scopes</div>
                    {snapshot.aiGateway.breakerScopes.length === 0
                      ? <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>No open breakers.</div>
                      : snapshot.aiGateway.breakerScopes.map((row) => (
                        <div key={row.scope} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid var(--gray-100)' }}>
                          <span style={{ color: 'var(--gray-600)', overflowWrap: 'anywhere' }}>{row.scope}</span>
                          <span style={{ fontWeight: 600 }}>{row.count}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </>
            )}
            <div className="ops-panel-split-grid">
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Blocked reasons</div>
                {snapshot.llm.topBlockReasons.length === 0
                  ? <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>No blocked calls.</div>
                  : snapshot.llm.topBlockReasons.map((row) => (
                    <div key={row.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid var(--gray-100)' }}>
                      <span style={{ color: 'var(--gray-600)' }}>{LLM_REASON_LABELS[row.reason] ?? humanizeReasonCode(row.reason)}</span>
                      <span style={{ fontWeight: 600 }}>{row.count}</span>
                    </div>
                  ))
                }
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Parse diagnostics</div>
                {snapshot.llm.diagnosticBreakdown.length === 0
                  ? <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>No parsed LLM rows.</div>
                  : snapshot.llm.diagnosticBreakdown.map((row) => (
                    <div key={row.diagnostic} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid var(--gray-100)' }}>
                      <span style={{ color: 'var(--gray-600)' }}>{LLM_DIAGNOSTIC_LABELS[row.diagnostic] ?? humanizeReasonCode(row.diagnostic)}</span>
                      <span style={{ fontWeight: 600 }}>{row.count}</span>
                    </div>
                  ))
                }
              </div>
            </div>
            <div style={{ marginTop: '14px', display: 'grid', gap: '12px' }}>
              <DiagnosticsDetails title="Gateway incidents" subtitle="Admin actions">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: 'var(--gray-50)' }}>
                        {['Time', 'Status', 'Severity', 'Incident', 'Scope', 'Actions'].map((header) => (
                          <th key={header} style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--gray-500)', borderBottom: '1px solid var(--gray-200)', whiteSpace: 'nowrap' }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {aiGatewayDetails.incidents.length === 0 ? (
                        <tr><td colSpan={6} style={{ padding: '10px', color: 'var(--gray-400)' }}>No gateway incidents.</td></tr>
                      ) : aiGatewayDetails.incidents.map((row) => (
                        <tr key={row.id} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{formatLocalDateTime(row.created_at)}</td>
                          <td style={{ padding: '7px 10px' }}>{row.status}</td>
                          <td style={{ padding: '7px 10px' }}>{row.severity}</td>
                          <td style={{ padding: '7px 10px' }}>{row.title || humanizeReasonCode(row.incident_type)}</td>
                          <td style={{ padding: '7px 10px', minWidth: '180px' }}>{row.feature_key ?? row.operation ?? row.match_id ?? '-'}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                            {row.status === 'open' && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={actionBusy != null}
                                onClick={() => void runAiGatewayAction(`/api/ops/ai-gateway/incidents/${row.id}/acknowledge`, `incident-ack-${row.id}`)}
                              >
                                {actionBusy === `incident-ack-${row.id}` ? '...' : 'Ack'}
                              </button>
                            )}
                            {row.status !== 'resolved' && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ marginLeft: '6px' }}
                                disabled={actionBusy != null}
                                onClick={() => void runAiGatewayAction(`/api/ops/ai-gateway/incidents/${row.id}/resolve`, `incident-resolve-${row.id}`)}
                              >
                                {actionBusy === `incident-resolve-${row.id}` ? '...' : 'Resolve'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DiagnosticsDetails>

              <DiagnosticsDetails title="Gateway breakers" subtitle="Open and recent">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: 'var(--gray-50)' }}>
                        {['Updated', 'Status', 'Scope', 'Reason', 'Severity', 'Actions'].map((header) => (
                          <th key={header} style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--gray-500)', borderBottom: '1px solid var(--gray-200)', whiteSpace: 'nowrap' }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {aiGatewayDetails.breakers.length === 0 ? (
                        <tr><td colSpan={6} style={{ padding: '10px', color: 'var(--gray-400)' }}>No gateway breakers.</td></tr>
                      ) : aiGatewayDetails.breakers.map((row) => (
                        <tr key={row.id} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{formatLocalDateTime(row.updated_at)}</td>
                          <td style={{ padding: '7px 10px' }}>{row.status}</td>
                          <td style={{ padding: '7px 10px', minWidth: '180px' }}>{row.scope_type}:{row.scope_key}</td>
                          <td style={{ padding: '7px 10px' }}>{humanizeReasonCode(row.reason)}</td>
                          <td style={{ padding: '7px 10px' }}>{row.severity}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                            {row.status === 'open' && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={actionBusy != null}
                                onClick={() => void runAiGatewayAction(`/api/ops/ai-gateway/breakers/${row.id}/close`, `breaker-close-${row.id}`)}
                              >
                                {actionBusy === `breaker-close-${row.id}` ? '...' : 'Close'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DiagnosticsDetails>

              <DiagnosticsDetails title="Gateway call log" subtitle="Recent LLM calls">
                <DataTable
                  headers={['Time', 'Status', 'Decision', 'Operation', 'Model', 'Cost', 'Tokens', 'Reason']}
                  rows={aiGatewayDetails.logs.map((row) => [
                    formatLocalDateTime(row.created_at),
                    row.status,
                    row.decision,
                    row.operation,
                    row.model,
                    `$${Number(row.estimated_cost_usd ?? 0).toFixed(4)}`,
                    `${row.estimated_input_tokens}/${row.estimated_output_tokens}`,
                    row.reason ? humanizeReasonCode(row.reason) : '-',
                  ])}
                  emptyText="No gateway calls."
                />
              </DiagnosticsDetails>
            </div>
          </DataCard>

          <DataCard>
            <SectionHeader title="Manual analysis" subtitle={`Prompt-only match analysis over the last ${snapshot.promptOnly.windowHours}h`} />
            <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginBottom: '12px', lineHeight: 1.5 }}>
              This tracks manual match analysis requests. A request can reach the LLM, skip before the LLM, or fail early.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              {[
                { label: 'Requests', value: snapshot.promptOnly.totalRows, warn: snapshot.promptOnly.totalRows === 0 },
                { label: 'Reached LLM', value: snapshot.promptOnly.successRows, warn: false },
                { label: 'Skipped Before LLM', value: snapshot.promptOnly.skippedRows, warn: snapshot.promptOnly.skippedRows > snapshot.promptOnly.successRows },
                { label: 'Failed', value: snapshot.promptOnly.failedRows, warn: snapshot.promptOnly.failedRows > 0 },
                { label: 'Prematch Override Eligible', value: `${snapshot.promptOnly.structuredEligibleRate}%`, warn: snapshot.promptOnly.totalRows > 0 && snapshot.promptOnly.structuredEligibleRate < 50 },
              ].map((item) => (
                <div key={item.label} style={{ padding: '8px 10px', borderRadius: '6px', background: item.warn ? '#fef2f2' : 'var(--gray-50)', border: `1px solid ${item.warn ? '#fecaca' : 'var(--gray-200)'}` }}>
                  <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: item.warn ? '#dc2626' : 'var(--gray-800)', lineHeight: 1.2, marginTop: '2px' }}>{item.value}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Manual analysis outcomes</div>
            {snapshot.promptOnly.reasonBreakdown.length === 0
              ? <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>No prompt-only rows yet.</div>
              : snapshot.promptOnly.reasonBreakdown.map((row) => (
                <div key={row.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid var(--gray-100)' }}>
                  <span style={{ color: 'var(--gray-600)' }}>{humanizeReasonCode(row.reason)}</span>
                  <span style={{ fontWeight: 600 }}>{row.count}</span>
                </div>
              ))
            }
          </DataCard>

          <DataCard>
            <SectionHeader title="Prompt Quality" subtitle={`Last ${snapshot.promptQuality.windowHours}h`} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              {[
                { label: 'Notify-eligible', value: `${snapshot.promptQuality.notifyEligibleRate24h}%`, warn: snapshot.promptQuality.notifyEligibleRate24h > 60 },
                { label: 'Stacking rate', value: `${snapshot.promptQuality.sameThesisStackingRate}%`, warn: snapshot.promptQuality.sameThesisStackingRate > 12 },
                { label: 'Corners usage', value: `${snapshot.promptQuality.cornersUsageRate}%`, warn: snapshot.promptQuality.cornersUsageRate > 25 },
                { label: 'Late high-line', value: `${snapshot.promptQuality.lateHighLineRate}%`, warn: snapshot.promptQuality.lateHighLineRate > 8 },
                { label: 'High-noise prematch', value: `${snapshot.promptQuality.prematch.highNoiseRate}%`, warn: snapshot.promptQuality.prematch.highNoiseRate > 25 },
                { label: 'Structured eligible', value: `${snapshot.promptQuality.prematch.structuredAskAiEligibleRate}%`, warn: snapshot.promptQuality.prematch.structuredAskAiEligibleRate < 50 },
                { label: 'Avg prematch noise', value: `${snapshot.promptQuality.prematch.avgNoisePenalty}`, warn: snapshot.promptQuality.prematch.avgNoisePenalty >= 50 },
              ].map((item) => (
                <div key={item.label} style={{ padding: '8px 10px', borderRadius: '6px', background: item.warn ? '#fef2f2' : 'var(--gray-50)', border: `1px solid ${item.warn ? '#fecaca' : 'var(--gray-200)'}` }}>
                  <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: item.warn ? '#dc2626' : 'var(--gray-800)', lineHeight: 1.2, marginTop: '2px' }}>{item.value}</div>
                </div>
              ))}
            </div>

            <div className="ops-panel-split-grid ops-panel-split-grid--md">
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Quality Counts</div>
                {[
                  ['Recommendations', snapshot.promptQuality.totalRecommendations],
                  ['Same-thesis clusters', snapshot.promptQuality.sameThesisClusters],
                  ['Stacked rows', snapshot.promptQuality.sameThesisStackedRows],
                  ['Stacked stake', `${snapshot.promptQuality.sameThesisStackedStake}%`],
                  ['Corners rows', snapshot.promptQuality.cornersRows],
                  ['Late high-line rows', snapshot.promptQuality.lateHighLineRows],
                  ['Late high-line stake', `${snapshot.promptQuality.lateHighLineStake}%`],
                  ['Prematch strong rows', snapshot.promptQuality.prematch.strongRows],
                  ['Prematch weak rows', snapshot.promptQuality.prematch.weakRows],
                  ['High-noise rows', snapshot.promptQuality.prematch.highNoiseRows],
                  ['Prematch minimal rows', snapshot.promptQuality.prematch.minimalAvailabilityRows],
                  ['Structured eligible rows', snapshot.promptQuality.prematch.structuredAskAiEligibleRows],
                  ['Structured blocked rows', snapshot.promptQuality.prematch.structuredAskAiBlockedRows],
                ].map(([label, value]) => (
                  <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0', borderBottom: '1px solid var(--gray-100)' }}>
                    <span style={{ color: 'var(--gray-600)' }}>{label}</span>
                    <span style={{ fontWeight: 600 }}>{value}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '5px' }}>Top High-Noise Matches</div>
                {snapshot.promptQuality.prematch.topHighNoiseMatches.length === 0
                  ? <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>None</div>
                  : snapshot.promptQuality.prematch.topHighNoiseMatches.map((row) => (
                    <div key={`${row.matchId}_${row.analyzedAt}`} style={{ padding: '4px 0', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>{row.matchDisplay}</div>
                      <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
                        noise {row.noisePenalty} · {row.prematchStrength} · {row.prematchAvailability} · {row.promptDataLevel}
                      </div>
                    </div>
                  ))
                }
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', margin: '10px 0 5px' }}>Prematch Gate Reasons</div>
                {snapshot.promptQuality.prematch.structuredAskAiReasonBreakdown.length === 0
                  ? <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>None</div>
                  : snapshot.promptQuality.prematch.structuredAskAiReasonBreakdown.map((row) => (
                    <div key={row.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0', borderBottom: '1px solid var(--gray-100)' }}>
                      <span style={{ color: 'var(--gray-600)' }}>{humanizeReasonCode(row.reason)}</span>
                      <span style={{ fontWeight: 600 }}>{row.count}</span>
                    </div>
                  ))
                }
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px', margin: '10px 0 5px' }}>Top Exposure Clusters</div>
                {snapshot.promptQuality.exposureConcentration.topClusters.length === 0
                  ? <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>None</div>
                  : snapshot.promptQuality.exposureConcentration.topClusters.map((cluster) => (
                    <div key={`${cluster.matchId}_${cluster.thesisKey}`} style={{ padding: '4px 0', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>{cluster.matchDisplay}</div>
                      <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
                        {cluster.label} · {cluster.count} picks · {cluster.totalStake}% stake
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </DataCard>
        </>
      )}
    </div>
  );
}
