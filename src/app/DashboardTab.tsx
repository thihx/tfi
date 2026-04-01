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

const PnlChart = memo(function PnlChart({ data }: { data: { date: string; pnl: number; cumulative: number }[] }) {
  if (!data.length) return null;
  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header"><div className="card-title">Cumulative P/L</div></div>
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
            <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--gray-400)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--gray-400)" tickFormatter={(v) => `$${v}`} />
            <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Cumulative P/L']} />
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

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header"><div className="card-title">Recommendation Performance by Market</div></div>
      <div className="table-container" style={{ marginTop: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th style={{ textAlign: 'center', width: 40 }}>W</th>
              <th style={{ textAlign: 'center', width: 40 }}>L</th>
              <th style={{ width: 120 }}>Win %</th>
              <th style={{ textAlign: 'right', width: 90 }}>P/L</th>
              <th style={{ textAlign: 'right', width: 80 }}>ROI</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => {
              const total = d.wins + d.losses;
              const winPct = total > 0 ? Math.round((d.wins / total) * 100) : 0;
              const accent = MARKET_COLORS[d.market || ''] || 'var(--gray-400)';
              return (
                <tr key={d.market}>
                  <td>
                    <span style={{ fontWeight: 600, fontSize: '12px', color: accent }}>{d.market || 'Other'}</span>
                    <span style={{ fontSize: '11px', color: 'var(--gray-400)', marginLeft: 6 }}>{total} bets</span>
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--success)', fontSize: '13px' }}>{d.wins}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--danger)', fontSize: '13px' }}>{d.losses}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 5, background: 'var(--gray-200)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${winPct}%`, height: '100%', background: winPct >= 50 ? 'var(--success)' : 'var(--danger)', borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--gray-600)', minWidth: 28, textAlign: 'right' }}>{winPct}%</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: d.pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: d.roi >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {d.roi >= 0 ? '+' : ''}{d.roi}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

  const graded = stats.correct + stats.incorrect;

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header"><div className="card-title">AI Performance</div></div>
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
          <div className="text-base text-subtle">
            {stats.correct} won | {stats.incorrect} lost | {graded} won/lost picks
          </div>
          {(resultPending > 0 || reviewRequired > 0 || pushCount > 0 || voidCount > 0) && (
            <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '2px' }}>
              {pushCount} push | {voidCount} void | {resultPending} pending | {reviewRequired} needs review | {stats.total} total
            </div>
          )}
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
          sub={`Won ${d?.wins ?? 0} | Lost ${d?.losses ?? 0} | Half Won ${d?.halfWins ?? 0} | Half Lost ${d?.halfLosses ?? 0} | Push ${d?.pushes ?? 0} | Void ${d?.voids ?? 0}${d?.streak ? ` | ${d.streak}` : ''}`}
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
