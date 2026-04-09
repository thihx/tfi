import { useState, useEffect, useCallback, memo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';
import { fetchAiStats, fetchAiStatsByModel, fetchDashboardSummary, fetchMarketReport } from '@/lib/services/api';
import type { AiAccuracyStats, AiModelStats, DashboardSummary, ExposureSummary, MarketReportRow } from '@/lib/services/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { formatCanonicalMarketLabel } from '@/lib/utils/marketDisplay';
import { MARKET_COLORS } from '@/config/constants';

// ==================== Sub-components ====================

// rerender-memo: memoize sub-components so parent re-renders don't trigger chart redraws
const StatCard = memo(function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color || ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
});

function formatShortChartDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
}

function formatFullChartDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const PnlChart = memo(function PnlChart({ data }: { data: { date: string; pnl: number; cumulative: number }[] }) {
  if (!data.length) return null;
  const firstDate = data[0]?.date ?? '';
  const lastDate = data[data.length - 1]?.date ?? '';
  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <div>
          <div className="card-title">Cumulative P/L</div>
          <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '4px' }}>
            Daily cumulative P/L {firstDate && lastDate ? `· ${formatFullChartDate(firstDate)} to ${formatFullChartDate(lastDate)}` : ''}
          </div>
        </div>
      </div>
      <div style={{ padding: '16px 12px 8px 0' }}>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
            <XAxis dataKey="date" tickFormatter={formatShortChartDate} tick={{ fontSize: 11 }} stroke="var(--gray-400)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--gray-400)" tickFormatter={(v) => `$${v}`} />
            <Tooltip
              labelFormatter={(value) => formatFullChartDate(String(value))}
              formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Cumulative P/L']}
            />
            <Area type="monotone" dataKey="cumulative" stroke="var(--primary)" fill="url(#pnlGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});


const MarketBreakdownChart = memo(function MarketBreakdownChart({ data }: { data: MarketReportRow[] }) {
  if (!data.length) return null;
  const sorted = [...data].sort((a, b) => b.pnl - a.pnl);
  const topMarkets = sorted.slice(0, 6);
  const remainingMarkets = sorted.slice(6);
  const totalTrackedBets = sorted.reduce((sum, row) => sum + row.wins + row.losses, 0);
  const positiveMarkets = sorted.filter((row) => row.pnl > 0).length;
  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const visibleMarkets = showAllMarkets ? sorted : topMarkets;

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <div>
          <div className="card-title">Recommendation Performance by Market</div>
          <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '4px' }}>
            Top markets by realized P/L. Focus on the strongest market groups first.
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '999px', background: 'var(--gray-100)', color: 'var(--gray-600)', fontWeight: 600 }}>
            {sorted.length} markets tracked
          </span>
          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '999px', background: '#ecfdf5', color: '#047857', fontWeight: 600 }}>
            {positiveMarkets} positive P/L
          </span>
          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '999px', background: '#eff6ff', color: '#1d4ed8', fontWeight: 600 }}>
            {totalTrackedBets} graded picks
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {visibleMarkets.map((d) => {
            const total = d.wins + d.losses;
            const winPct = total > 0 ? Math.round((d.wins / total) * 100) : 0;
            const accent = MARKET_COLORS[d.market || ''] || 'var(--gray-400)';
            return (
              <div
                key={d.market}
                style={{
                  border: '1px solid var(--gray-200)',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  background: 'white',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: accent }}>
                      {formatCanonicalMarketLabel(d.market || 'other')}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px' }}>
                      {total} graded picks
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: d.pnl >= 0 ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                      {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '11px', color: d.roi >= 0 ? 'var(--success)' : 'var(--danger)', marginTop: '2px' }}>
                      {d.roi >= 0 ? '+' : ''}{d.roi}%
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>W-L</div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>{d.wins}-{d.losses}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Win Rate</div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>{winPct}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Rank</div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>#{sorted.findIndex((row) => row.market === d.market) + 1}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--gray-200)', borderRadius: 999, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${winPct}%`,
                        height: '100%',
                        background: winPct >= 50 ? 'var(--success)' : 'var(--danger)',
                        borderRadius: 999,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--gray-500)', minWidth: 32, textAlign: 'right' }}>{winPct}%</span>
                </div>
              </div>
            );
          })}
        </div>

        {remainingMarkets.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAllMarkets((prev) => !prev)}>
              {showAllMarkets ? 'Show Top Markets Only' : `Show ${remainingMarkets.length} More Markets`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

const ExposureConcentrationPanel = memo(function ExposureConcentrationPanel({ data }: { data: ExposureSummary | null | undefined }) {
  if (!data || data.stackedClusters === 0) return null;

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header"><div className="card-title">Open Exposure Clusters</div></div>
      <div className="stats-grid" style={{ padding: '0 16px 12px' }}>
        <StatCard label="Clusters" value={data.stackedClusters} sub={`${data.stackedRecommendations} recs involved`} />
        <StatCard label="Cluster Stake" value={`${data.stackedStake}%`} sub={`Max cluster ${data.maxClusterStake}%`} />
      </div>
      <div className="table-container table-cards">
        <table>
          <thead>
            <tr>
              <th>Match</th>
              <th>Thesis</th>
              <th style={{ textAlign: 'center' }}>Picks</th>
              <th style={{ textAlign: 'center' }}>Stake</th>
              <th style={{ textAlign: 'center' }}>Latest</th>
              <th>P/L</th>
            </tr>
          </thead>
          <tbody>
            {data.topClusters.map((cluster) => (
              <tr key={`${cluster.matchId}_${cluster.thesisKey}`}>
                <td data-label="Match"><span className="cell-value">{cluster.matchDisplay}</span></td>
                <td data-label="Thesis">
                  <span className="cell-value">
                    <strong>{cluster.label}</strong>
                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--gray-500)' }}>
                      {cluster.canonicalMarkets.join(', ')}
                    </span>
                  </span>
                </td>
                <td data-label="Picks" style={{ textAlign: 'center' }}><span className="cell-value">{cluster.count}</span></td>
                <td data-label="Stake" style={{ textAlign: 'center' }}><span className="cell-value">{cluster.totalStake}%</span></td>
                <td data-label="Latest" style={{ textAlign: 'center' }}><span className="cell-value">{cluster.latestMinute == null ? '-' : `${cluster.latestMinute}'`}</span></td>
                <td data-label="P/L">
                  <span className="cell-value" style={{ color: cluster.totalPnl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                    {cluster.totalPnl >= 0 ? '+' : ''}${cluster.totalPnl.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

const AiAccuracyPanel = memo(function AiAccuracyPanel({ stats, models }: { stats: AiAccuracyStats | null; models: AiModelStats[] }) {
  if (!stats) return null;
  const resultPending = stats.pendingResult ?? stats.pending;
  const reviewRequired = stats.reviewRequired ?? 0;
  const pushCount = stats.push ?? stats.neutral ?? 0;
  const voidCount = stats.void ?? 0;
  const pieData = [
    { name: 'Won', value: stats.correct, color: 'var(--success)' },
    { name: 'Lost', value: stats.incorrect, color: 'var(--danger)' },
    { name: 'Push', value: pushCount, color: 'var(--warning)' },
    { name: 'Void', value: voidCount, color: 'var(--gray-400)' },
    { name: 'Pending', value: resultPending, color: 'var(--gray-300)' },
    { name: 'Needs Review', value: reviewRequired, color: 'var(--gray-500)' },
  ].filter((d) => d.value > 0);

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header"><div className="card-title">Analysis performance</div></div>
      <div style={{ padding: '12px 16px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ width: 'min(140px, 35vw)', height: 'min(140px, 35vw)', flexShrink: 0 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={2}>
                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(value, name) => [`${value} bets`, name]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="stat-value-lg text-primary-color">
            {stats.accuracy.toFixed(1)}%
          </div>
          {/* Legend */}
          <div className="flex-row-gap-12 flex-wrap mt-8">
            {pieData.map((d) => (
              <div key={d.name} className="flex-row-gap-4 text-sm text-secondary">
                <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: d.color, display: 'inline-block', flexShrink: 0 }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
          {models.length > 0 && (
            <div style={{ marginTop: '10px', borderTop: '1px solid var(--gray-200)', paddingTop: '8px' }}>
              {models.map((m) => (
                <div key={m.model} style={{ fontSize: '12px', color: 'var(--gray-600)', marginTop: '4px' }}>
                  <strong>{m.model}</strong>: {m.accuracy.toFixed(1)}% ({m.correct}/{m.total})
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ==================== Main Tab ====================

export function DashboardTab() {
  const { state } = useAppState();
  const { config } = state;

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [aiStats, setAiStats] = useState<AiAccuracyStats | null>(null);
  const [aiModels, setAiModels] = useState<AiModelStats[]>([]);
  const [marketStats, setMarketStats] = useState<MarketReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, ai, models, markets] = await Promise.all([
        fetchDashboardSummary(config),
        fetchAiStats(config).catch(() => null),
        fetchAiStatsByModel(config).catch(() => []),
        fetchMarketReport(config, { period: 'all' }).catch(() => []),
      ]);
      setDashboard(dash);
      setAiStats(ai);
      setAiModels(models);
      setMarketStats(markets);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading && !dashboard) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner" />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  const d = dashboard;
  const pnlTrend = d?.pnlTrend ?? [];
  const recentRecs = d?.recentRecs ?? [];

  return (
    <div className="dashboard">
      {/* Summary Stats */}
      <div className="stats-grid">
        <StatCard
          label="Settled Recommendations"
          value={d?.totalBets ?? 0}
          sub={`${d?.pending ?? 0} pending | ${d?.pushes ?? 0} push | ${d?.voids ?? 0} void`}
        />
        <StatCard
          label="Won Rate"
          value={`${(d?.winRate ?? 0).toFixed(1)}%`}
          sub={`Won ${d?.wins ?? 0} | Lost ${d?.losses ?? 0} | Half Won ${d?.halfWins ?? 0} | Half Lost ${d?.halfLosses ?? 0}${d?.streak ? ` | ${d.streak}` : ''}`}
        />
        <StatCard
          label="Total P/L"
          value={`${(d?.totalPnl ?? 0) >= 0 ? '+' : ''}$${(d?.totalPnl ?? 0).toFixed(2)}`}
          color={(d?.totalPnl ?? 0) >= 0 ? 'positive' : 'negative'}
        />
        <StatCard
          label="ROI on Stake"
          value={`${(d?.roi ?? 0) >= 0 ? '+' : ''}${(d?.roi ?? 0).toFixed(1)}%`}
          color={(d?.roi ?? 0) >= 0 ? 'positive' : 'negative'}
        />
      </div>

      {/* Charts Row */}
      <div className="dashboard-charts-row">
        <PnlChart data={pnlTrend} />
        <AiAccuracyPanel stats={aiStats} models={aiModels} />
      </div>

      {/* Market Breakdown */}
      <MarketBreakdownChart data={marketStats} />
      <ExposureConcentrationPanel data={d?.openExposureConcentration} />

      {/* Recent Activity */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Recent Recommendations</div>
        </div>
        {recentRecs.length > 0 ? (
          <div className="table-container table-cards">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '90px' }}>Date</th>
                  <th>League</th>
                  <th>Match</th>
                  <th>Selection</th>
                  <th style={{ textAlign: 'center' }}>Odds</th>
                  <th>Outcome</th>
                  <th style={{ textAlign: 'center' }}>Result</th>
                  <th style={{ textAlign: 'right' }}>P/L</th>
                </tr>
              </thead>
              <tbody>
                {recentRecs.map((r, i) => {
                  const pnl = parseFloat(String(r.pnl ?? 0));
                  const display = r.home_team && r.away_team
                    ? `${r.home_team} vs ${r.away_team}`
                    : r.match_display || 'N/A';
                  const ts = r.timestamp || r.created_at;
                  const dtStr = formatLocalDateTime(ts);
                  const outcome = r.actual_outcome || '';
                  const outcomeShort = outcome.length > 35 ? outcome.slice(0, 33) + '…' : outcome;
                  return (
                    <tr key={r.id ?? i}>
                      <td data-label="Date"><span className="cell-value"><span style={{ background: 'var(--gray-100)', padding: '3px 7px', borderRadius: '4px', fontWeight: 600, color: 'var(--gray-700)', fontSize: '12px', whiteSpace: 'nowrap' }}>{dtStr}</span></span></td>
                      <td data-label="League"><span className="cell-value" style={{ fontSize: '12px' }} title={String(r.league || '')}>{r.league ? (r.league.length > 20 ? r.league.slice(0, 18) + '…' : r.league) : '-'}</span></td>
                      <td data-label="Match"><span className="cell-value">{display}</span></td>
                      <td data-label="Selection"><span className="cell-value"><strong>{r.selection || '-'}</strong></span></td>
                      <td data-label="Odds" style={{ textAlign: 'center' }}><span className="cell-value">{r.odds || '-'}</span></td>
                      <td data-label="Outcome"><span className="cell-value" title={outcome} style={{ fontSize: '12px', color: 'var(--gray-600)', maxWidth: 'min(220px, 40vw)', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{outcomeShort || '-'}</span></td>
                      <td data-label="Result" style={{ textAlign: 'center' }}><span className="cell-value">{r.result ? <StatusBadge status={r.result.toUpperCase()} /> : '-'}</span></td>
                      <td data-label="P/L" style={{ textAlign: 'right' }}>
                        <span className="cell-value" style={{ fontWeight: 600, color: pnl >= 0 ? '#15803d' : '#b91c1c' }}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state-content">
            No recommendations yet
          </div>
        )}
      </div>
    </div>
  );
}

// No local helpers needed — all data comes from server
