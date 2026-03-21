import { useCallback, useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { getToken } from '@/lib/services/auth';
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

interface OpsMonitoringSnapshot {
  generatedAt: string;
  checklist: ChecklistItem[];
  cards: MetricCard[];
  pipeline: PipelineOverview;
  providers: ProviderOverview;
  settlement: SettlementOverview;
  notifications: NotificationOverview;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const TONE_STYLE: Record<CardTone, { bg: string; border: string; text: string }> = {
  pass: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
  warn: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
  fail: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
  neutral: { bg: 'var(--gray-50)', border: 'var(--gray-200)', text: 'var(--gray-800)' },
};

function formatJobAction(action: string): string {
  return action
    .replace(/^JOB_/, '')
    .toLowerCase()
    .replace(/_/g, '-');
}

function StatusBadge({ status }: { status: ChecklistStatus }) {
  const label = status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL';
  const style = TONE_STYLE[status];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '52px',
      padding: '3px 8px',
      borderRadius: '9999px',
      background: style.bg,
      color: style.text,
      border: `1px solid ${style.border}`,
      fontSize: '11px',
      fontWeight: 700,
    }}>
      {label}
    </span>
  );
}

function SectionTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <div style={{ border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden', background: '#fff' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--gray-200)', fontWeight: 700, fontSize: '13px' }}>
        {title}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: 'var(--gray-50)', textAlign: 'left' }}>
              {headers.map((header) => (
                <th key={header} style={{ padding: '8px 10px', borderBottom: '1px solid var(--gray-200)' }}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} style={{ padding: '12px 10px', color: 'var(--gray-500)' }}>No data</td>
              </tr>
            ) : rows.map((row, idx) => (
              <tr key={`${title}-${idx}`} style={{ borderBottom: idx < rows.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                {row.map((cell, cellIdx) => (
                  <td key={`${title}-${idx}-${cellIdx}`} style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OpsMonitoringPanel() {
  const { state } = useAppState();
  const apiUrl = state.config.apiUrl;
  const [snapshot, setSnapshot] = useState<OpsMonitoringSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!apiUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/ops/overview`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  if (!apiUrl) {
    return <p style={{ color: 'var(--gray-500)' }}>Backend URL not configured</p>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--gray-900)' }}>Ops Monitoring</div>
          <div style={{ color: 'var(--gray-500)', fontSize: '12px', marginTop: '2px' }}>
            Production safety checklist backed by pipeline, provider, settlement, and notification data.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--gray-500)' }}>
          {snapshot && <span>Updated: {formatLocalDateTime(snapshot.generatedAt)}</span>}
          <button className="btn btn-secondary btn-sm" onClick={() => void fetchSnapshot()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '14px', padding: '10px 12px', borderRadius: '8px', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: '13px' }}>
          Failed to load ops snapshot: {error}
        </div>
      )}

      {!snapshot && loading && (
        <div style={{ color: 'var(--gray-500)', fontSize: '13px' }}>Loading ops monitoring snapshot...</div>
      )}

      {snapshot && (
        <>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: '10px', background: '#fff', marginBottom: '16px' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--gray-200)', fontWeight: 700, fontSize: '13px' }}>
              Post-Release Checklist
            </div>
            <div style={{ padding: '12px' }}>
              {snapshot.checklist.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '70px minmax(0, 1fr)',
                    gap: '10px',
                    alignItems: 'start',
                    padding: '8px 0',
                    borderBottom: item.id !== snapshot.checklist[snapshot.checklist.length - 1]?.id ? '1px solid var(--gray-100)' : 'none',
                  }}
                >
                  <StatusBadge status={item.status} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--gray-900)' }}>{item.label}</div>
                    <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginTop: '2px' }}>{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
            {snapshot.cards.map((card) => {
              const tone = TONE_STYLE[card.tone];
              return (
                <div key={card.label} style={{ padding: '12px 14px', borderRadius: '10px', background: tone.bg, border: `1px solid ${tone.border}` }}>
                  <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginBottom: '6px' }}>{card.label}</div>
                  <div style={{ fontSize: '24px', lineHeight: 1.1, fontWeight: 800, color: tone.text }}>{card.value}</div>
                  {card.detail && <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--gray-600)' }}>{card.detail}</div>}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '12px' }}>
            <SectionTable
              title="Pipeline Funnel (24h)"
              headers={['Metric', 'Value']}
              rows={[
                ['Analyzed', snapshot.pipeline.analyzed24h],
                ['Should push', `${snapshot.pipeline.shouldPush24h} (${snapshot.pipeline.pushRate24h}%)`],
                ['Saved', `${snapshot.pipeline.saved24h} (${snapshot.pipeline.saveRate24h}%)`],
                ['Notified', `${snapshot.pipeline.notified24h} (${snapshot.pipeline.notifyRate24h}%)`],
                ['Skipped', snapshot.pipeline.skipped24h],
                ['Errors', snapshot.pipeline.errors24h],
              ]}
            />

            <SectionTable
              title="Top Skip Reasons (24h)"
              headers={['Reason', 'Count']}
              rows={snapshot.pipeline.topSkipReasons.map((row) => [row.reason, row.count])}
            />

            <SectionTable
              title="Job Failures (24h)"
              headers={['Job', 'Failures']}
              rows={snapshot.pipeline.jobFailuresByAction.map((row) => [formatJobAction(row.action), row.count])}
            />

            <SectionTable
              title={`Stats Providers (${snapshot.providers.statsWindowHours}h)`}
              headers={['Provider', 'Success', 'Possession', 'SOT', 'Latency']}
              rows={snapshot.providers.statsByProvider.map((row) => [
                row.provider,
                `${row.successRate}% (${row.samples})`,
                `${row.possessionCoverageRate}%`,
                `${row.shotsOnTargetCoverageRate}%`,
                `${row.avgLatencyMs}ms`,
              ])}
            />

            <SectionTable
              title={`Odds Providers (${snapshot.providers.oddsWindowHours}h)`}
              headers={['Provider', 'Source', 'Usable', 'OU', 'AH', 'Latency']}
              rows={snapshot.providers.oddsByProvider.map((row) => [
                row.provider,
                row.source,
                `${row.usableRate}% (${row.samples})`,
                `${row.overUnderRate}%`,
                `${row.asianHandicapRate}%`,
                `${row.avgLatencyMs}ms`,
              ])}
            />

            <SectionTable
              title="Settlement"
              headers={['Metric', 'Value']}
              rows={[
                ['Recommendation pending', snapshot.settlement.recommendationPending],
                ['Recommendation unresolved', snapshot.settlement.recommendationUnresolved],
                ['Bet pending', snapshot.settlement.betPending],
                ['Bet unresolved', snapshot.settlement.betUnresolved],
                ['Corrected last 7d', snapshot.settlement.recommendationCorrected7d],
              ]}
            />

            <SectionTable
              title="Settlement Method Mix (30d)"
              headers={['Method', 'Count']}
              rows={snapshot.settlement.methodMix30d.map((row) => [row.method, row.count])}
            />

            <SectionTable
              title="Unresolved Markets"
              headers={['Market', 'Count']}
              rows={snapshot.settlement.unresolvedByMarket.map((row) => [row.market, row.count])}
            />

            <SectionTable
              title="Notifications (24h)"
              headers={['Metric', 'Value']}
              rows={[
                ['Attempts', snapshot.notifications.attempts24h],
                ['Failures', snapshot.notifications.failures24h],
                ['Failure rate', `${snapshot.notifications.failureRate24h}%`],
                ['Delivered recommendations', snapshot.notifications.deliveredRecommendations24h],
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
