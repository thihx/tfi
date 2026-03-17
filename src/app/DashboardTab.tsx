import { useState, useEffect, useCallback } from 'react';
import { useAppState } from '@/hooks/useAppState';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';
import { fetchAiStats, fetchAiStatsByModel, fetchBetStatsByMarket, fetchDashboardSummary } from '@/lib/services/api';
import type { AiAccuracyStats, AiModelStats, BetStats, DashboardSummary } from '@/lib/services/api';
import { StatusBadge } from '@/components/ui/StatusBadge';

// ==================== Sub-components ====================

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color || ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function PnlChart({ data }: { data: { date: string; pnl: number; cumulative: number }[] }) {
  if (!data.length) return null;
  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header"><div className="card-title">📈 Cumulative P/L</div></div>
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
}

const MARKET_COLORS: Record<string, string> = {
  'Over/Under': '#3b82f6',
  '1X2': '#10b981',
  'BTTS': '#f59e0b',
  'Asian Handicap': '#8b5cf6',
};

function MarketBreakdownChart({ data }: { data: Array<{ market: string } & BetStats> }) {
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
      <div className="card-header"><div className="card-title">📊 Performance by Market</div></div>
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
      <div style={{ padding: '0 20px 16px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {chartData.map((d) => (
          <div key={d.name} style={{ fontSize: '12px', color: 'var(--gray-600)' }}>
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
}

function AiAccuracyPanel({ stats, models }: { stats: AiAccuracyStats | null; models: AiModelStats[] }) {
  if (!stats) return null;
  const pieData = [
    { name: 'Correct', value: stats.correct, color: 'var(--success)' },
    { name: 'Incorrect', value: stats.incorrect, color: 'var(--danger)' },
    { name: 'Pending', value: stats.pending, color: 'var(--gray-300)' },
  ].filter((d) => d.value > 0);

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header"><div className="card-title">🤖 AI Performance</div></div>
      <div style={{ padding: '16px 20px', display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ width: 140, height: 140 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={2}>
                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--primary)' }}>
            {stats.accuracy.toFixed(1)}%
          </div>
          <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>
            {stats.correct} correct / {stats.total} total
          </div>
          {models.length > 0 && (
            <div style={{ marginTop: '12px' }}>
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
}

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
      {/* Summary Stats */}
      <div className="stats-grid">
        <StatCard label="Total Bets" value={d?.totalBets ?? 0} sub={`${d?.pending ?? 0} pending`} />
        <StatCard label="Win Rate" value={`${d?.winRate ?? 0}%`} sub={d?.streak ?? ''} />
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

      {/* Overview counts */}
      <div className="dashboard-overview-bar">
        <span>📊 {d?.matchCount ?? 0} matches</span>
        <span>👁️ {d?.watchlistCount ?? 0} watchlist</span>
        <span>🎯 {d?.recCount ?? 0} recommendations</span>
        {aiStats && <span>🤖 AI accuracy: {aiStats.accuracy.toFixed(1)}%</span>}
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
          <div className="card-title">📋 Recent Recommendations</div>
          <button className="btn btn-sm btn-secondary" onClick={loadAll}>🔄</button>
        </div>
        {recentRecs.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Selection</th>
                  <th>Odds</th>
                  <th>Result</th>
                  <th>P/L</th>
                </tr>
              </thead>
              <tbody>
                {recentRecs.map((r, i) => {
                  const pnl = parseFloat(String(r.pnl ?? 0));
                  const display = r.home_team && r.away_team
                    ? `${r.home_team} vs ${r.away_team}`
                    : r.match_display || 'N/A';
                  return (
                    <tr key={i}>
                      <td><span className="cell-value">{display}</span></td>
                      <td><span className="cell-value"><strong>{r.selection || '-'}</strong></span></td>
                      <td><span className="cell-value">{r.odds || '-'}</span></td>
                      <td><span className="cell-value">{r.result ? <StatusBadge status={r.result.toUpperCase()} /> : '-'}</span></td>
                      <td>
                        <span className="cell-value" style={{ fontWeight: 700, color: pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
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
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--gray-400)' }}>
            No recommendations yet
          </div>
        )}
      </div>
    </div>
  );
}

// No local helpers needed — all data comes from server
