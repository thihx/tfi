import { useState, useEffect, useCallback, memo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';
import { fetchAiStats, fetchAiStatsByModel, fetchBetStatsByMarket, fetchDashboardSummary } from '@/lib/services/api';
import type { AiAccuracyStats, AiModelStats, BetStats, DashboardSummary } from '@/lib/services/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { MARKET_COLORS } from '@/config/constants';
import { PageHeader } from '@/components/ui/PageHeader';

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


const MarketBreakdownChart = memo(function MarketBreakdownChart({ data }: { data: Array<{ market: string } & BetStats> }) {
  if (!data.length) return null;
  const chartData = data.map((d) => ({
    name: d.market || 'Other',
    won: d.won,
    lost: d.lost,
    roi: d.total > 0 ? parseFloat(((d.total_pnl / (d.total * 100)) * 100).toFixed(1)) : 0,
    pnl: d.total_pnl,
  }));

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header"><div className="card-title">Performance by Market</div></div>
      <div style={{ padding: '16px 12px 8px 0' }}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} />
            <Tooltip />
            <Bar dataKey="won" name="Won" stackId="a" fill="var(--success)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="lost" name="Lost" stackId="a" fill="var(--danger)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-row-gap-16 flex-wrap" style={{ padding: '0 20px 16px' }}>
        {chartData.map((d) => (
          <div key={d.name} className="text-sm text-secondary">
            <strong style={{ color: MARKET_COLORS[d.name] || 'var(--gray-700)' }}>{d.name}</strong>:{' '}
            <span style={{ color: d.pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)}
            </span>
            {' · '}ROI {d.roi >= 0 ? '+' : ''}{d.roi}%
          </div>
        ))}
      </div>
    </div>
  );
});

const AiAccuracyPanel = memo(function AiAccuracyPanel({ stats, models }: { stats: AiAccuracyStats | null; models: AiModelStats[] }) {
  if (!stats) return null;
  const pieData = [
    { name: 'Correct', value: stats.correct, color: 'var(--success)' },
    { name: 'Incorrect', value: stats.incorrect, color: 'var(--danger)' },
    { name: 'Pending', value: stats.pending, color: 'var(--gray-300)' },
  ].filter((d) => d.value > 0);

  const settled = stats.correct + stats.incorrect;

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header"><div className="card-title">AI Performance</div></div>
      <div style={{ padding: '16px 20px', display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ width: 140, height: 140 }}>
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
            {stats.correct} correct / {settled} settled
          </div>
          {stats.pending > 0 && (
            <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '2px' }}>
              {stats.pending} pending · {stats.total} total
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
  const [marketStats, setMarketStats] = useState<Array<{ market: string } & BetStats>>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, ai, models, markets] = await Promise.all([
        fetchDashboardSummary(config),
        fetchAiStats(config).catch(() => null),
        fetchAiStatsByModel(config).catch(() => []),
        fetchBetStatsByMarket(config).catch(() => []),
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
      <PageHeader
        subtitle={<>
          <span><strong>{d?.matchCount ?? 0}</strong> matches</span>
          <span><strong>{d?.watchlistCount ?? 0}</strong> watchlist</span>
          <span><strong>{d?.recCount ?? 0}</strong> recommendations</span>
          {aiStats && <span>AI accuracy: <strong>{aiStats.accuracy.toFixed(1)}%</strong></span>}
        </>}
      />

      {/* Summary Stats */}
      <div className="stats-grid">
        <StatCard label="Total Bets" value={d?.totalBets ?? 0} sub={`${d?.pending ?? 0} pending`} />
        <StatCard label="Win Rate" value={`${(d?.winRate ?? 0).toFixed(1)}%`} sub={d?.streak ?? ''} />
        <StatCard
          label="Total P/L"
          value={`${(d?.totalPnl ?? 0) >= 0 ? '+' : ''}$${(d?.totalPnl ?? 0).toFixed(2)}`}
          color={(d?.totalPnl ?? 0) >= 0 ? 'positive' : 'negative'}
        />
        <StatCard
          label="ROI"
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
                      <td data-label="Outcome"><span className="cell-value" title={outcome} style={{ fontSize: '12px', color: 'var(--gray-600)', maxWidth: '220px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{outcomeShort || '-'}</span></td>
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
