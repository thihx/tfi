import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import {
  fetchOverviewReport, fetchLeagueReport, fetchMarketReport,
  fetchWeeklyReport, fetchMonthlyReport, fetchConfidenceReport,
  fetchOddsRangeReport, fetchMinuteReport, fetchDayOfWeekReport,
  fetchLeagueMarketReport, fetchAiInsights,
} from '@/lib/services/api';
import type {
  ReportPeriodFilter, OverviewReport, LeagueReportRow, MarketReportRow,
  TimeReportRow, ConfidenceBandRow, OddsRangeRow, MinuteBandRow,
  DayOfWeekRow, LeagueMarketRow, AiInsightsData,
} from '@/lib/services/api';

// ── Report sub-tabs ──

type ReportSection = 'overview' | 'league' | 'market' | 'time' | 'confidence' | 'odds' | 'minute' | 'day-of-week' | 'league-market' | 'ai-insights';

const REPORT_SECTIONS: { key: ReportSection; icon: string; label: string }[] = [
  { key: 'overview', icon: '📊', label: 'Overview' },
  { key: 'league', icon: '🏆', label: 'By League' },
  { key: 'market', icon: '🎯', label: 'By Market' },
  { key: 'time', icon: '📅', label: 'Weekly/Monthly' },
  { key: 'confidence', icon: '🎚️', label: 'Confidence' },
  { key: 'odds', icon: '💹', label: 'Odds Range' },
  { key: 'minute', icon: '⏱️', label: 'Match Minute' },
  { key: 'day-of-week', icon: '📆', label: 'Day of Week' },
  { key: 'league-market', icon: '🔀', label: 'League × Market' },
  { key: 'ai-insights', icon: '🤖', label: 'AI Insights' },
];

const PERIOD_OPTIONS: { value: ReportPeriodFilter['period']; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'this-week', label: 'This Week' },
  { value: 'this-month', label: 'This Month' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
];

// ── Helpers ──

function pnlColor(v: number): string { return v >= 0 ? 'var(--success)' : 'var(--danger)'; }
function pnlStr(v: number): string { return `${v >= 0 ? '+' : ''}$${v.toFixed(2)}`; }
function wrStr(v: number): string { return `${v.toFixed(1)}%`; }
function familyLabel(value: string): string {
  const map: Record<string, string> = {
    goals_totals: 'Goals Totals',
    corners: 'Corners',
    asian_handicap: 'Asian Handicap',
    btts: 'BTTS',
    '1x2': '1X2',
    other: 'Other',
  };
  return map[value] ?? value;
}

const CHART_GREEN = '#22c55e';
const CHART_RED = '#ef4444';
const CHART_BLUE = '#3b82f6';
const CHART_AMBER = '#f59e0b';
const CHART_PURPLE = '#8b5cf6';

// ==================== Sub-Components ====================

const OverviewSection = memo(function OverviewSection({ data }: { data: OverviewReport }) {
  return (
    <div>
      <div className="report-kpi-grid">
        <KpiCard label="Recommendations" value={data.total} sub={`${data.pending} pending`} />
        <KpiCard label="Hit Rate (W/L)" value={wrStr(data.winRate)} color={data.winRate >= 50 ? 'positive' : 'negative'} />
        <KpiCard label="P/L" value={pnlStr(data.totalPnl)} color={data.totalPnl >= 0 ? 'positive' : 'negative'} />
        <KpiCard label="ROI on Stake" value={`${data.roi >= 0 ? '+' : ''}${data.roi.toFixed(1)}%`} color={data.roi >= 0 ? 'positive' : 'negative'} />
        <KpiCard label="Avg Odds" value={data.avgOdds.toFixed(2)} />
        <KpiCard label="Avg Confidence" value={data.avgConfidence.toFixed(1)} />
        <KpiCard label="Settled" value={data.settled} sub={`Decisive ${data.decisiveSettled} | Neutral ${data.neutralSettled}`} />
        <KpiCard label="Record" value={`${data.wins}W - ${data.losses}L`} sub={`Push ${data.pushes} | HW ${data.halfWins} | HL ${data.halfLosses} | Void ${data.voids}`} />
        <KpiCard label="Exposure Clusters" value={data.exposureConcentration.stackedClusters} sub={`${data.exposureConcentration.stackedRecommendations} recs | ${data.exposureConcentration.stackedStake}% stake`} />
      </div>
      {(data.bestDay || data.worstDay) && (
        <div className="report-highlight-row">
          {data.bestDay && (
            <div className="report-highlight positive">
              <span className="report-highlight-label">🏆 Best Day</span>
              <span className="report-highlight-value">{data.bestDay.date}: {pnlStr(data.bestDay.pnl)}</span>
            </div>
          )}
          {data.worstDay && (
            <div className="report-highlight negative">
              <span className="report-highlight-label">📉 Worst Day</span>
              <span className="report-highlight-value">{data.worstDay.date}: {pnlStr(data.worstDay.pnl)}</span>
            </div>
          )}
        </div>
      )}
      {data.exposureConcentration.stackedClusters > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div className="card-title">Exposure Concentration</div></div>
          <div style={{ padding: '12px 20px', fontSize: 12, color: 'var(--gray-600)' }}>
            Same match + same thesis clusters with at least 2 entries in the selected period.
          </div>
          <ReportTable
            columns={['Match', 'Thesis', 'Picks', 'Settled', 'Stake', 'Latest', 'P/L']}
            rows={data.exposureConcentration.topClusters.map((cluster) => [
              cluster.matchDisplay,
              cluster.label,
              cluster.count,
              cluster.settledCount,
              `${cluster.totalStake}%`,
              cluster.latestMinute == null ? '-' : `${cluster.latestMinute}'`,
              { value: pnlStr(cluster.totalPnl), color: pnlColor(cluster.totalPnl) },
            ])}
          />
        </div>
      )}
    </div>
  );
});

const LeagueSection = memo(function LeagueSection({ data, topLeagueNames }: { data: LeagueReportRow[]; topLeagueNames: Set<string> }) {
  if (!data.length) return <EmptyReport message="No league data for this period" />;
  const sorted = [...data].sort((a, b) => {
    const aTop = topLeagueNames.has(a.league);
    const bTop = topLeagueNames.has(b.league);
    if (aTop !== bTop) return aTop ? -1 : 1;
    return 0; // preserve original P/L order within each group
  });
  const chartData = sorted.slice(0, 15).map((d) => ({
    name: d.league.length > 20 ? d.league.slice(0, 18) + '…' : d.league,
    pnl: d.pnl,
    winRate: d.winRate,
  }));
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">P/L by League</div></div>
        <div style={{ padding: '16px 0 8px 0' }}>
          <ResponsiveContainer width="100%" height={Math.max(200, sorted.slice(0, 15).length * 32)}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
              <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'P/L']} />
              <Bar dataKey="pnl" name="P/L">
                {chartData.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? CHART_GREEN : CHART_RED} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ReportTable
        columns={['League', 'Total', 'W', 'L', 'Win%', 'P/L', 'Avg Odds', 'Avg Conf', 'ROI']}
        rows={sorted.map((d) => [
          d.league, d.total, d.wins, d.losses, wrStr(d.winRate),
          { value: pnlStr(d.pnl), color: pnlColor(d.pnl) },
          d.avgOdds.toFixed(2), d.avgConfidence.toFixed(1),
          { value: `${d.roi >= 0 ? '+' : ''}${d.roi.toFixed(1)}%`, color: pnlColor(d.roi) },
        ])}
      />
    </div>
  );
});

const MarketSection = memo(function MarketSection({ data }: { data: MarketReportRow[] }) {
  if (!data.length) return <EmptyReport message="No market data for this period" />;
  const chartData = data.map((d) => ({
    name: d.market,
    wins: d.wins,
    losses: d.losses,
    pnl: d.pnl,
  }));
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">W/L by Market</div></div>
        <div style={{ padding: '16px 0 8px 0' }}>
          <ResponsiveContainer width="100%" height={Math.max(180, data.length * 32)}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="wins" name="Wins" stackId="a" fill={CHART_GREEN} />
              <Bar dataKey="losses" name="Losses" stackId="a" fill={CHART_RED} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ReportTable
        columns={['Market', 'Total', 'W', 'L', 'Win%', 'P/L', 'Avg Odds', 'ROI']}
        rows={data.map((d) => [
          d.market, d.total, d.wins, d.losses, wrStr(d.winRate),
          { value: pnlStr(d.pnl), color: pnlColor(d.pnl) },
          d.avgOdds.toFixed(2),
          { value: `${d.roi >= 0 ? '+' : ''}${d.roi.toFixed(1)}%`, color: pnlColor(d.roi) },
        ])}
      />
    </div>
  );
});

const TimeSection = memo(function TimeSection({ weekly, monthly }: { weekly: TimeReportRow[]; monthly: TimeReportRow[] }) {
  const [view, setView] = useState<'weekly' | 'monthly'>('weekly');
  const data = view === 'weekly' ? weekly : monthly;
  if (!data.length) return <EmptyReport message="No time data for this period" />;

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <button className={`btn btn-sm ${view === 'weekly' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('weekly')}>Weekly</button>
        <button className={`btn btn-sm ${view === 'monthly' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('monthly')}>Monthly</button>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">Cumulative P/L ({view})</div></div>
        <div style={{ padding: '16px 0 8px 0' }}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="cumPnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_BLUE} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_BLUE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v, name) => [`$${Number(v).toFixed(2)}`, name === 'cumPnl' ? 'Cumulative' : 'Period P/L']} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="cumPnl" name="Cumulative" stroke={CHART_BLUE} fill="url(#cumPnlGrad)" strokeWidth={2} />
              <Line type="monotone" dataKey="pnl" name="Period P/L" stroke={CHART_AMBER} strokeWidth={1.5} dot={{ r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">Win Rate Trend</div></div>
        <div style={{ padding: '16px 0 8px 0' }}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Win Rate']} />
              <Line type="monotone" dataKey="winRate" name="Win Rate" stroke={CHART_PURPLE} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ReportTable
        columns={['Period', 'Total', 'W', 'L', 'Win%', 'P/L', 'Cumul.', 'Avg Odds', 'ROI']}
        rows={data.map((d) => [
          d.period, d.total, d.wins, d.losses, wrStr(d.winRate),
          { value: pnlStr(d.pnl), color: pnlColor(d.pnl) },
          { value: pnlStr(d.cumPnl), color: pnlColor(d.cumPnl) },
          d.avgOdds.toFixed(2),
          { value: `${d.roi >= 0 ? '+' : ''}${d.roi.toFixed(1)}%`, color: pnlColor(d.roi) },
        ])}
      />
    </div>
  );
});

const ConfidenceSection = memo(function ConfidenceSection({ data }: { data: ConfidenceBandRow[] }) {
  if (!data.length) return <EmptyReport message="No confidence data" />;
  const radarData = data.map((d) => ({
    band: d.band,
    'Actual Win%': d.winRate,
    'Expected Win%': d.expectedWinRate,
  }));
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">Confidence Calibration</div></div>
        <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--gray-200)" />
              <PolarAngleAxis dataKey="band" tick={{ fontSize: 11 }} />
              <PolarRadiusAxis angle={30} tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Radar name="Actual Win%" dataKey="Actual Win%" stroke={CHART_BLUE} fill={CHART_BLUE} fillOpacity={0.3} />
              <Radar name="Expected Win%" dataKey="Expected Win%" stroke={CHART_AMBER} fill={CHART_AMBER} fillOpacity={0.15} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`]} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ReportTable
        columns={['Band', 'Total', 'W', 'L', 'Actual Win%', 'Expected Win%', 'Gap', 'P/L', 'Avg Odds']}
        rows={data.map((d) => {
          const gap = d.winRate - d.expectedWinRate;
          return [
            d.band, d.total, d.wins, d.losses, wrStr(d.winRate), `${d.expectedWinRate}%`,
            { value: `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}%`, color: gap >= 0 ? 'var(--success)' : 'var(--danger)' },
            { value: pnlStr(d.pnl), color: pnlColor(d.pnl) },
            d.avgOdds.toFixed(2),
          ];
        })}
      />
    </div>
  );
});

const OddsSection = memo(function OddsSection({ data }: { data: OddsRangeRow[] }) {
  if (!data.length) return <EmptyReport message="No odds data" />;
  const chartData = data.map((d) => ({ name: d.range, winRate: d.winRate, pnl: d.pnl }));
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">Win Rate by Odds Range</div></div>
        <div style={{ padding: '16px 0 8px 0' }}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Win Rate']} />
              <Bar dataKey="winRate" name="Win Rate">
                {chartData.map((d, i) => <Cell key={i} fill={d.winRate >= 50 ? CHART_GREEN : CHART_RED} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ReportTable
        columns={['Odds Range', 'Total', 'W', 'L', 'Win%', 'P/L', 'Avg Confidence']}
        rows={data.map((d) => [
          d.range, d.total, d.wins, d.losses, wrStr(d.winRate),
          { value: pnlStr(d.pnl), color: pnlColor(d.pnl) },
          d.avgConfidence.toFixed(1),
        ])}
      />
    </div>
  );
});

const MinuteSection = memo(function MinuteSection({ data }: { data: MinuteBandRow[] }) {
  if (!data.length) return <EmptyReport message="No minute data" />;
  const chartData = data.map((d) => ({ name: d.band, winRate: d.winRate, pnl: d.pnl }));
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">Performance by Match Minute</div></div>
        <div style={{ padding: '16px 0 8px 0' }}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="winRate" name="Win %" fill={CHART_BLUE} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ReportTable
        columns={['Minute Band', 'Total', 'W', 'L', 'Win%', 'P/L', 'Avg Odds']}
        rows={data.map((d) => [
          d.band, d.total, d.wins, d.losses, wrStr(d.winRate),
          { value: pnlStr(d.pnl), color: pnlColor(d.pnl) },
          d.avgOdds.toFixed(2),
        ])}
      />
    </div>
  );
});

const DayOfWeekSection = memo(function DayOfWeekSection({ data }: { data: DayOfWeekRow[] }) {
  if (!data.length) return <EmptyReport message="No day-of-week data" />;
  const chartData = data.map((d) => ({ name: d.dayName, winRate: d.winRate, pnl: d.pnl, total: d.total }));
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">Performance by Day of Week</div></div>
        <div style={{ padding: '16px 0 8px 0' }}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v, name) => [name === 'pnl' ? `$${Number(v).toFixed(2)}` : `${v}`, name === 'pnl' ? 'P/L' : String(name)]} />
              <Bar dataKey="pnl" name="P/L">
                {chartData.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? CHART_GREEN : CHART_RED} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ReportTable
        columns={['Day', 'Bets', 'W', 'L', 'Win%', 'P/L']}
        rows={data.map((d) => [
          d.dayName, d.total, d.wins, d.losses, wrStr(d.winRate),
          { value: pnlStr(d.pnl), color: pnlColor(d.pnl) },
        ])}
      />
    </div>
  );
});

const LeagueMarketSection = memo(function LeagueMarketSection({ data, topLeagueNames }: { data: LeagueMarketRow[]; topLeagueNames: Set<string> }) {
  if (!data.length) return <EmptyReport message="No cross data (need >= 3 bets per combination)" />;
  // Group by league
  const grouped = new Map<string, LeagueMarketRow[]>();
  for (const row of data) {
    const existing = grouped.get(row.league) ?? [];
    existing.push(row);
    grouped.set(row.league, existing);
  }
  const sortedEntries = [...grouped.entries()].sort(([a], [b]) => {
    const aTop = topLeagueNames.has(a);
    const bTop = topLeagueNames.has(b);
    if (aTop !== bTop) return aTop ? -1 : 1;
    return 0;
  });
  return (
    <div>
      {sortedEntries.map(([league, rows]) => (
        <div key={league} className="card" style={{ marginBottom: 12 }}>
          <div className="card-header"><div className="card-title">{league}</div></div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Market</th><th>Total</th><th>W</th><th>L</th><th>Win%</th><th>P/L</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><span className="cell-value">{r.market}</span></td>
                    <td><span className="cell-value">{r.total}</span></td>
                    <td><span className="cell-value">{r.wins}</span></td>
                    <td><span className="cell-value">{r.losses}</span></td>
                    <td><span className="cell-value">{wrStr(r.winRate)}</span></td>
                    <td><span className="cell-value" style={{ color: pnlColor(r.pnl), fontWeight: 600 }}>{pnlStr(r.pnl)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
});

const AiInsightsSection = memo(function AiInsightsSection({ data }: { data: AiInsightsData }) {
  const trendEmoji = data.recentTrend === 'improving' ? '📈' : data.recentTrend === 'declining' ? '📉' : '➡️';
  const trendColor = data.recentTrend === 'improving' ? 'var(--success)' : data.recentTrend === 'declining' ? 'var(--danger)' : 'var(--gray-600)';

  return (
    <div className="report-insights">
      {/* Trend Summary */}
      <div className="card report-insight-card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">AI Performance Analysis</div></div>
        <div style={{ padding: '16px 20px' }}>
          <div className="report-insight-row" style={{ color: 'var(--gray-500)', fontSize: 12 }}>
            Insights use decisive settled sample only and require at least {data.sampleFloor} samples per bucket.
          </div>
          <div className="report-insight-row">
            <span>{trendEmoji} <strong>Recent Trend:</strong></span>
            <span style={{ color: trendColor, fontWeight: 700, textTransform: 'capitalize' }}>{data.recentTrend}</span>
            <span style={{ color: 'var(--gray-500)', fontSize: 12 }}>
              (Recent {data.recentWinRate.toFixed(1)}% vs Overall {data.overallWinRate.toFixed(1)}%)
            </span>
          </div>
          <div className="report-insight-row">
            <span>🔥 <strong>Current Streak:</strong></span>
            <span style={{ color: data.streakInfo.type === 'win' ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
              {data.streakInfo.count}{data.streakInfo.type === 'win' ? 'W' : 'L'}
            </span>
          </div>
          <div className="report-insight-row">
            <span>💎 <strong>Value Investment Wins (odds ≥ 2.0):</strong></span>
            <span style={{ fontWeight: 600 }}>{data.valueFinds}</span>
          </div>
          <div className="report-insight-row">
            <span>🛡️ <strong>Safe Investment Accuracy (odds {'<'} 1.70):</strong></span>
            <span style={{ fontWeight: 600 }}>{data.safeBetAccuracy.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Strengths */}
      <div className="report-insights-grid">
        <InsightList title="✅ Strong Leagues" items={data.strongLeagues.map((l) => `${l.league}: ${wrStr(l.winRate)} (${pnlStr(l.pnl)}, ${l.total} bets)`)} color="var(--success)" />
        <InsightList title="⚠️ Weak Leagues" items={data.weakLeagues.map((l) => `${l.league}: ${wrStr(l.winRate)} (${pnlStr(l.pnl)}, ${l.total} bets)`)} color="var(--danger)" />
        <InsightList title="✅ Strong Markets" items={data.strongMarkets.map((m) => `${m.market}: ${wrStr(m.winRate)} (${pnlStr(m.pnl)}, ${m.total} bets)`)} color="var(--success)" />
        <InsightList title="⚠️ Weak Markets" items={data.weakMarkets.map((m) => `${m.market}: ${wrStr(m.winRate)} (${pnlStr(m.pnl)}, ${m.total} bets)`)} color="var(--danger)" />
        <InsightList title="⏰ Best Time Slots" items={data.bestTimeSlots.map((t) => `${t.band}: ${wrStr(t.winRate)} (${pnlStr(t.pnl)}, ${t.total} bets)`)} color="var(--success)" />
        <InsightList title="⏰ Worst Time Slots" items={data.worstTimeSlots.map((t) => `${t.band}: ${wrStr(t.winRate)} (${pnlStr(t.pnl)}, ${t.total} bets)`)} color="var(--danger)" />
      </div>

      {/* Calibration Warnings */}
      {data.overconfidentBands.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div className="card-title">Confidence Calibration Issues</div></div>
          <div style={{ padding: '12px 20px' }}>
            {data.overconfidentBands.map((b) => (
              <div key={b.band} className="report-insight-row" style={{ color: 'var(--danger)' }}>
                <strong>{b.band}</strong>: AI confidence avg {b.avgConfidence.toFixed(0)}% but actual win rate only {b.actualWinRate.toFixed(1)}% (gap: {b.gap.toFixed(1)}pp)
              </div>
            ))}
          </div>
        </div>
      )}

      {data.marketFamilies.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div className="card-title">Market Family ROI</div></div>
          <ReportTable
            columns={['Family', 'Settled', 'Neutral', 'W', 'L', 'Hit%', 'P/L', 'ROI']}
            rows={data.marketFamilies.map((row) => [
              familyLabel(row.family),
              row.settled,
              row.neutral,
              row.wins,
              row.losses,
              wrStr(row.winRate),
              { value: pnlStr(row.pnl), color: pnlColor(row.pnl) },
              { value: `${row.roi >= 0 ? '+' : ''}${row.roi.toFixed(1)}%`, color: pnlColor(row.roi) },
            ])}
          />
        </div>
      )}

      {data.lateEntries.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div className="card-title">Late-Entry ROI</div></div>
          <div style={{ padding: '12px 20px', fontSize: 12, color: 'var(--gray-600)' }}>
            Timing buckets show where prompt entries are actually strongest on stake-adjusted return.
          </div>
          <ReportTable
            columns={['Bucket', 'Settled', 'Neutral', 'W', 'L', 'Hit%', 'P/L', 'ROI']}
            rows={data.lateEntries.map((row) => [
              row.bucket,
              row.settled,
              row.neutral,
              row.wins,
              row.losses,
              wrStr(row.winRate),
              { value: pnlStr(row.pnl), color: pnlColor(row.pnl) },
              { value: `${row.roi >= 0 ? '+' : ''}${row.roi.toFixed(1)}%`, color: pnlColor(row.roi) },
            ])}
          />
        </div>
      )}
    </div>
  );
});

// ── Small shared components ──

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="report-kpi-card">
      <div className="report-kpi-label">{label}</div>
      <div className={`report-kpi-value ${color || ''}`}>{value}</div>
      {sub && <div className="report-kpi-sub">{sub}</div>}
    </div>
  );
}

function EmptyReport({ message }: { message: string }) {
  return (
    <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--gray-400)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
      {message}
    </div>
  );
}

type CellValue = string | number | { value: string; color: string };

function ReportTable({ columns, rows }: { columns: string[]; rows: CellValue[][] }) {
  return (
    <div className="card">
      <div className="table-container report-table">
        <table>
          <thead>
            <tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <span className="cell-value" style={typeof cell === 'object' && cell !== null ? { color: cell.color, fontWeight: 600 } : undefined}>
                      {typeof cell === 'object' && cell !== null ? cell.value : cell}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InsightList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items.length) return null;
  return (
    <div className="card report-insight-list">
      <div className="card-header"><div className="card-title" style={{ fontSize: 13 }}>{title}</div></div>
      <ul style={{ padding: '8px 20px 12px 36px', margin: 0 }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontSize: 12, color, marginBottom: 4, lineHeight: 1.5 }}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// ==================== Main Tab ====================

interface ReportData {
  overview: OverviewReport | null;
  leagues: LeagueReportRow[];
  markets: MarketReportRow[];
  weekly: TimeReportRow[];
  monthly: TimeReportRow[];
  confidence: ConfidenceBandRow[];
  oddsRange: OddsRangeRow[];
  minutes: MinuteBandRow[];
  dayOfWeek: DayOfWeekRow[];
  leagueMarket: LeagueMarketRow[];
  aiInsights: AiInsightsData | null;
}

export function ReportsTab() {
  const { state } = useAppState();
  const { config, leagues: appLeagues } = state;
  const topLeagueNames = useMemo(() => new Set(appLeagues.filter((l) => l.top_league).map((l) => l.league_name)), [appLeagues]);

  const [section, setSection] = useState<ReportSection>('overview');
  const [period, setPeriod] = useState<ReportPeriodFilter['period']>('all');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReportData>({
    overview: null, leagues: [], markets: [], weekly: [], monthly: [],
    confidence: [], oddsRange: [], minutes: [], dayOfWeek: [],
    leagueMarket: [], aiInsights: null,
  });

  const filter: ReportPeriodFilter = { period };

  const loadSection = useCallback(async (sec: ReportSection) => {
    setLoading(true);
    try {
      switch (sec) {
        case 'overview': {
          const overview = await fetchOverviewReport(config, filter);
          setData((d) => ({ ...d, overview }));
          break;
        }
        case 'league': {
          const leagues = await fetchLeagueReport(config, filter);
          setData((d) => ({ ...d, leagues }));
          break;
        }
        case 'market': {
          const markets = await fetchMarketReport(config, filter);
          setData((d) => ({ ...d, markets }));
          break;
        }
        case 'time': {
          const [weekly, monthly] = await Promise.all([
            fetchWeeklyReport(config, filter),
            fetchMonthlyReport(config, filter),
          ]);
          setData((d) => ({ ...d, weekly, monthly }));
          break;
        }
        case 'confidence': {
          const confidence = await fetchConfidenceReport(config, filter);
          setData((d) => ({ ...d, confidence }));
          break;
        }
        case 'odds': {
          const oddsRange = await fetchOddsRangeReport(config, filter);
          setData((d) => ({ ...d, oddsRange }));
          break;
        }
        case 'minute': {
          const minutes = await fetchMinuteReport(config, filter);
          setData((d) => ({ ...d, minutes }));
          break;
        }
        case 'day-of-week': {
          const dayOfWeek = await fetchDayOfWeekReport(config, filter);
          setData((d) => ({ ...d, dayOfWeek }));
          break;
        }
        case 'league-market': {
          const leagueMarket = await fetchLeagueMarketReport(config, filter);
          setData((d) => ({ ...d, leagueMarket }));
          break;
        }
        case 'ai-insights': {
          const aiInsights = await fetchAiInsights(config, filter);
          setData((d) => ({ ...d, aiInsights }));
          break;
        }
      }
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, period]);

  useEffect(() => { loadSection(section); }, [section, loadSection]);

  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--gray-400)' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
          Loading report...
        </div>
      );
    }
    switch (section) {
      case 'overview': return data.overview ? <OverviewSection data={data.overview} /> : <EmptyReport message="No data" />;
      case 'league': return <LeagueSection data={data.leagues} topLeagueNames={topLeagueNames} />;
      case 'market': return <MarketSection data={data.markets} />;
      case 'time': return <TimeSection weekly={data.weekly} monthly={data.monthly} />;
      case 'confidence': return <ConfidenceSection data={data.confidence} />;
      case 'odds': return <OddsSection data={data.oddsRange} />;
      case 'minute': return <MinuteSection data={data.minutes} />;
      case 'day-of-week': return <DayOfWeekSection data={data.dayOfWeek} />;
      case 'league-market': return <LeagueMarketSection data={data.leagueMarket} topLeagueNames={topLeagueNames} />;
      case 'ai-insights': return data.aiInsights ? <AiInsightsSection data={data.aiInsights} /> : <EmptyReport message="No AI insights data" />;
    }
  };

  return (
    <div className="reports-tab">
      {/* Period selector */}
      <div className="report-toolbar">
        <div className="report-period-selector">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`btn btn-sm ${period === opt.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPeriod(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Report section tabs */}
      <div className="report-section-tabs">
        {REPORT_SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`report-section-tab ${section === s.key ? 'active' : ''}`}
            onClick={() => setSection(s.key)}
          >
            <span className="report-tab-icon">{s.icon}</span>
            <span className="report-tab-label">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="report-content">
        {renderContent()}
      </div>
    </div>
  );
}
