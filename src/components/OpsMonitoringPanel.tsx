import { useCallback, useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { getToken } from '@/lib/services/auth';
import { internalApiUrl } from '@/lib/internal-api';
import { formatLocalDateTime } from '@/lib/utils/helpers';

type ChecklistStatus = 'pass' | 'warn' | 'fail';
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
  jobFailuresByAction: Array<{ action: string; count: number }>;
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
}

interface ProviderOverview {
  statsWindowHours: number;
  oddsWindowHours: number;
  statsSamples: number;
  statsSuccessRate: number;
  oddsSamples: number;
  oddsUsableRate: number;
  statsByProvider: ProviderStatsBreakdown[];
  oddsByProvider: ProviderOddsBreakdown[];
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

interface OpsMonitoringSnapshot {
  generatedAt: string;
  checklist: ChecklistItem[];
  cards: MetricCard[];
  pipeline: PipelineOverview;
  providers: ProviderOverview;
  settlement: SettlementOverview;
  notifications: NotificationOverview;
  promptShadow: PromptShadowOverview;
  promptQuality: PromptQualityOverview;
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
  neutral: { bg: 'var(--gray-50)', border: 'var(--gray-200)', text: 'var(--gray-700)', accent: 'var(--gray-400)' },
};

const STATUS_ICON: Record<ChecklistStatus, string> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
};

const STATUS_COLOR: Record<ChecklistStatus, { bg: string; text: string; ring: string }> = {
  pass: { bg: '#dcfce7', text: '#166534', ring: '#86efac' },
  warn: { bg: '#fef9c3', text: '#854d0e', ring: '#fde047' },
  fail: { bg: '#fee2e2', text: '#991b1b', ring: '#fca5a5' },
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

function formatJobAction(action: string): string {
  return action.replace(/^JOB_/, '').toLowerCase().replace(/_/g, '-');
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

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
      : 'pass'
    : 'pass';

  const healthLabel = overallStatus === 'pass' ? 'All systems operational'
    : overallStatus === 'warn' ? 'Needs attention'
    : 'Critical issues detected';

  const healthStyle = STATUS_COLOR[overallStatus];

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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
              </div>
            </div>
          </DataCard>

          {/* ── Section 4: Providers ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '12px' }}>
            <DataCard>
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
            </DataCard>
            <DataCard>
              <SectionHeader title="Odds Providers" subtitle={`Last ${snapshot.providers.oddsWindowHours}h`} />
              <DataTable
                headers={['Provider', 'Source', 'Usable', 'OU', 'AH', 'Latency']}
                rows={snapshot.providers.oddsByProvider.map((r) => [
                  r.provider, r.source,
                  `${r.usableRate}% (${r.samples})`,
                  `${r.overUnderRate}%`,
                  `${r.asianHandicapRate}%`,
                  `${r.avgLatencyMs}ms`,
                ])}
                emptyText="No odds samples"
              />
            </DataCard>
          </div>

          {/* ── Section 5: Settlement + Notifications side by side ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '12px' }}>
            <DataCard>
              <SectionHeader title="Settlement" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                {[
                  { label: 'Rec. Pending', value: snapshot.settlement.recommendationPending, warn: snapshot.settlement.recommendationPending > 20 },
                  { label: 'Rec. Unresolved', value: snapshot.settlement.recommendationUnresolved, warn: snapshot.settlement.recommendationUnresolved > 5 },
                  { label: 'Bet Pending', value: snapshot.settlement.betPending, warn: snapshot.settlement.betPending > 20 },
                  { label: 'Bet Unresolved', value: snapshot.settlement.betUnresolved, warn: snapshot.settlement.betUnresolved > 5 },
                ].map((item) => (
                  <div key={item.label} style={{ padding: '8px 10px', borderRadius: '6px', background: item.warn ? '#fef2f2' : 'var(--gray-50)', border: `1px solid ${item.warn ? '#fecaca' : 'var(--gray-200)'}` }}>
                    <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: item.warn ? '#dc2626' : 'var(--gray-800)', lineHeight: 1.2, marginTop: '2px' }}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                {[
                  { label: 'Attempts', value: snapshot.notifications.attempts24h, warn: false },
                  { label: 'Failures', value: snapshot.notifications.failures24h, warn: snapshot.notifications.failures24h > 0 },
                  { label: 'Failure Rate', value: `${snapshot.notifications.failureRate24h}%`, warn: snapshot.notifications.failureRate24h > 10 },
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
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
            <SectionHeader title="Prompt Quality" subtitle={`Last ${snapshot.promptQuality.windowHours}h`} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              {[
                { label: 'Notify-eligible', value: `${snapshot.promptQuality.notifyEligibleRate24h}%`, warn: snapshot.promptQuality.notifyEligibleRate24h > 60 },
                { label: 'Stacking rate', value: `${snapshot.promptQuality.sameThesisStackingRate}%`, warn: snapshot.promptQuality.sameThesisStackingRate > 12 },
                { label: 'Corners usage', value: `${snapshot.promptQuality.cornersUsageRate}%`, warn: snapshot.promptQuality.cornersUsageRate > 25 },
                { label: 'Late high-line', value: `${snapshot.promptQuality.lateHighLineRate}%`, warn: snapshot.promptQuality.lateHighLineRate > 8 },
                { label: 'High-noise prematch', value: `${snapshot.promptQuality.prematch.highNoiseRate}%`, warn: snapshot.promptQuality.prematch.highNoiseRate > 25 },
                { label: 'Avg prematch noise', value: `${snapshot.promptQuality.prematch.avgNoisePenalty}`, warn: snapshot.promptQuality.prematch.avgNoisePenalty >= 50 },
              ].map((item) => (
                <div key={item.label} style={{ padding: '8px 10px', borderRadius: '6px', background: item.warn ? '#fef2f2' : 'var(--gray-50)', border: `1px solid ${item.warn ? '#fecaca' : 'var(--gray-200)'}` }}>
                  <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: item.warn ? '#dc2626' : 'var(--gray-800)', lineHeight: 1.2, marginTop: '2px' }}>{item.value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
