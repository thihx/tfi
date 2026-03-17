import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MatchDetailModal } from '@/components/ui/MatchDetailModal';
import { RecommendationCard } from '@/components/ui/RecommendationCard';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetchRecommendationsPaginated, fetchBetTypes, fetchDistinctLeagues } from '@/lib/services/api';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import type { Recommendation } from '@/types';

type ViewMode = 'cards' | 'table';

const PAGE_SIZE = 30;

type SortCol = 'time' | 'odds' | 'confidence' | 'pnl' | 'league' | '';
type SortDir = 'asc' | 'desc';

const SORT_COL_MAP: Record<string, string> = {
  time: 'time',
  odds: 'odds',
  confidence: 'confidence',
  pnl: 'pnl',
  league: 'league',
};

const RISK_COLORS: Record<string, string> = {
  LOW: 'var(--success)',
  MEDIUM: '#f59e0b',
  HIGH: 'var(--danger)',
};

export function RecommendationsTab() {
  const { state } = useAppState();
  const { config } = state;
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState<string>('all');
  const [betTypeFilter, setBetTypeFilter] = useState<string>('all');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sortCol, setSortCol] = useState<SortCol>('');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showChart, setShowChart] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [detailMatch, setDetailMatch] = useState<{ id: string; display: string } | null>(null);

  // Server data
  const [rows, setRows] = useState<Recommendation[]>([]);
  const [total, setTotal] = useState(0);
  const [betTypes, setBetTypes] = useState<string[]>([]);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Count active filters
  const activeFilterCount = [
    resultFilter !== 'all',
    betTypeFilter !== 'all',
    leagueFilter !== 'all',
    riskFilter !== 'all',
    dateFrom !== '',
    dateTo !== '',
  ].filter(Boolean).length;

  // Fetch recommendations from server
  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchRecommendationsPaginated(config, {
        limit: PAGE_SIZE,
        offset: (p - 1) * PAGE_SIZE,
        result: resultFilter !== 'all' ? resultFilter : undefined,
        bet_type: betTypeFilter !== 'all' ? betTypeFilter : undefined,
        league: leagueFilter !== 'all' ? leagueFilter : undefined,
        risk_level: riskFilter !== 'all' ? riskFilter : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: search.trim() || undefined,
        sort_by: sortCol ? SORT_COL_MAP[sortCol] : undefined,
        sort_dir: sortCol ? sortDir : undefined,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch {
      // keep previous data
    } finally {
      setLoading(false);
    }
  }, [config, resultFilter, betTypeFilter, leagueFilter, riskFilter, dateFrom, dateTo, search, sortCol, sortDir]);

  // Load filter options once
  useEffect(() => {
    fetchBetTypes(config).then(setBetTypes).catch(() => {});
    fetchDistinctLeagues(config).then(setLeagues).catch(() => {});
  }, [config]);

  // Debounced fetch on filter/page change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData(page);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [fetchData, page]);

  // Summary computed from server total + current page
  const summary = (() => {
    const settled = rows.filter((r) => r.result === 'win' || r.result === 'loss');
    const won = settled.filter((r) => r.result === 'win').length;
    const pnl = settled.reduce((s, r) => s + parseFloat(String(r.pnl ?? 0)), 0);
    return { total, won, lost: settled.length - won, pnl };
  })();

  // Cumulative P/L chart for current page data
  const chartData = (() => {
    if (!showChart) return [];
    const sorted = [...rows]
      .filter((r) => (r.result === 'win' || r.result === 'loss') && (r.timestamp || r.created_at))
      .sort((a, b) => new Date(a.timestamp || a.created_at!).getTime() - new Date(b.timestamp || b.created_at!).getTime());

    let cum = 0;
    return sorted.map((r, i) => {
      cum += parseFloat(String(r.pnl ?? 0));
      return { idx: i + 1, cumulative: parseFloat(cum.toFixed(2)) };
    });
  })();

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
    setPage(1);
  };

  const sortIcon = (col: SortCol) => {
    if (sortCol !== col) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const clearFilters = () => {
    setResultFilter('all');
    setBetTypeFilter('all');
    setLeagueFilter('all');
    setRiskFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setPage(1);
  };

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '13px', color: 'var(--gray-500)', alignItems: 'center' }}>
        <span>🎯 {summary.total} total</span>
        <span style={{ color: 'var(--success)' }}>✅ {summary.won}W (page)</span>
        <span style={{ color: 'var(--danger)' }}>❌ {summary.lost}L (page)</span>
        <span style={{ color: summary.pnl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
          P/L (page): {summary.pnl >= 0 ? '+' : ''}${summary.pnl.toFixed(2)}
        </span>
        {loading && <span style={{ color: 'var(--primary)' }}>⏳ Loading...</span>}
      </div>

      {/* Search + toolbar */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="filters" style={{ padding: '12px 16px' }}>
          <input
            type="text"
            className="filter-input"
            placeholder="🔍 Search match / selection..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ flex: '1 1 200px', minWidth: 160 }}
          />
          <select
            className="filter-input"
            value={resultFilter}
            onChange={(e) => { setResultFilter(e.target.value); setPage(1); }}
          >
            <option value="all">All Status</option>
            <option value="win">✅ Won</option>
            <option value="loss">❌ Lost</option>
            <option value="push">➖ Push</option>
            <option value="pending">⏳ Pending</option>
          </select>
          <select
            className="filter-input"
            value={leagueFilter}
            onChange={(e) => { setLeagueFilter(e.target.value); setPage(1); }}
          >
            <option value="all">All Leagues</option>
            {leagues.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select
            className="filter-input"
            value={betTypeFilter}
            onChange={(e) => { setBetTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="all">All Markets</option>
            {betTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="filter-input"
            value={riskFilter}
            onChange={(e) => { setRiskFilter(e.target.value); setPage(1); }}
          >
            <option value="all">All Risk</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
          <input type="date" className="filter-input" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} title="From date" />
          <input type="date" className="filter-input" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} title="To date" />
          {activeFilterCount > 0 && (
            <button className="btn btn-secondary" onClick={clearFilters}>✖ Clear Filters</button>
          )}
          <button className={`btn btn-sm ${showChart ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setShowChart((v) => !v)}>
            {showChart ? '📊 Hide Chart' : '📈 Show Chart'}
          </button>
          <button
            className={`btn btn-sm ${viewMode === 'cards' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode((v) => v === 'cards' ? 'table' : 'cards')}
            title="Toggle card / table view"
          >
            {viewMode === 'cards' ? '☰ Table' : '⊞ Cards'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => fetchData(page)}>🔄</button>
        </div>
      </div>

      {/* P/L Chart */}
      {showChart && chartData.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div style={{ padding: '16px 12px 8px 0' }}>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                <XAxis dataKey="idx" tick={{ fontSize: 10 }} label={{ value: 'Bet #', position: 'insideBottom', offset: -2, fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Cumulative P/L']} />
                <Area type="monotone" dataKey="cumulative" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Card view */}
      {viewMode === 'cards' && (
        <div>
          {rows.length === 0 ? (
            <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--gray-400)' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>🎯</div>
              <p>{loading ? 'Loading...' : 'No recommendations match filters'}</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '12px' }}>
              {rows.map((rec, i) => (
                <RecommendationCard
                  key={rec.id ?? i}
                  rec={rec}
                  onViewMatch={(id, display) => setDetailMatch({ id, display })}
                />
              ))}
            </div>
          )}
          <div style={{ marginTop: '12px' }}>
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && <div className="card">
        <div className="table-container table-cards">
          <table>
            <thead>
              <tr>
                <th onClick={() => handleSort('time')} style={{ cursor: 'pointer', width: '100px' }}>Date{sortIcon('time')}</th>
                <th onClick={() => handleSort('league')} style={{ cursor: 'pointer' }}>League{sortIcon('league')}</th>
                <th>Match</th>
                <th>Selection</th>
                <th onClick={() => handleSort('odds')} style={{ cursor: 'pointer', textAlign: 'center' }}>Odds{sortIcon('odds')}</th>
                <th onClick={() => handleSort('confidence')} style={{ cursor: 'pointer', textAlign: 'center' }}>Conf.{sortIcon('confidence')}</th>
                <th style={{ textAlign: 'center' }}>Risk</th>
                <th>Outcome</th>
                <th style={{ textAlign: 'center' }}>Result</th>
                <th onClick={() => handleSort('pnl')} style={{ cursor: 'pointer', textAlign: 'right' }}>P/L{sortIcon('pnl')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="empty-state">
                  <div className="empty-state-icon">🎯</div>
                  <p>{loading ? 'Loading...' : 'No recommendations match filters'}</p>
                </td></tr>
              ) : rows.map((rec, i) => {
                const pnlVal = parseFloat(String(rec.pnl ?? 0));
                const pnl = rec.pnl != null ? `${pnlVal >= 0 ? '+' : ''}$${pnlVal.toFixed(2)}` : '-';
                const conf = rec.confidence != null ? `${parseFloat(String(rec.confidence))}/10` : '-';
                const display = rec.home_team && rec.away_team
                  ? `${rec.home_team} vs ${rec.away_team}`
                  : rec.match_display || 'N/A';
                const ts = rec.timestamp || rec.created_at;
                const risk = rec.risk_level || '';
                const leagueName = rec.league || '-';
                const outcome = rec.actual_outcome || '';
                const outcomeShort = outcome.length > 40 ? outcome.slice(0, 38) + '…' : outcome;
                return (
                  <tr key={rec.id ?? i}>
                    <td data-label="Date">
                      <span className="cell-value" style={{ fontSize: '13px' }}>{formatLocalDateTime(ts)}</span>
                    </td>
                    <td data-label="League">
                      <span className="cell-value" title={leagueName} style={{ fontSize: '12px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {leagueName}
                      </span>
                    </td>
                    <td data-label="Match">
                      <span
                        className="cell-value match-cell"
                        style={{ cursor: rec.match_id ? 'pointer' : undefined, color: rec.match_id ? 'var(--primary)' : undefined }}
                        onClick={() => rec.match_id && setDetailMatch({ id: rec.match_id, display })}
                      >
                        {display}
                      </span>
                    </td>
                    <td data-label="Selection">
                      <span className="cell-value">
                        <div><strong>{rec.selection || '-'}</strong></div>
                        {rec.bet_type && <div style={{ fontSize: '11px', color: 'var(--gray-400)' }}>{rec.bet_type}</div>}
                      </span>
                    </td>
                    <td data-label="Odds" style={{ textAlign: 'center' }}><span className="cell-value"><strong>{rec.odds || '-'}</strong></span></td>
                    <td data-label="Confidence" style={{ textAlign: 'center' }}><span className="cell-value">{conf}</span></td>
                    <td data-label="Risk" style={{ textAlign: 'center' }}>
                      <span className="cell-value">
                        {risk ? (
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
                            fontSize: '11px', fontWeight: 600,
                            color: RISK_COLORS[risk] || 'var(--gray-500)',
                            background: `${RISK_COLORS[risk] || 'var(--gray-300)'}15`,
                            border: `1px solid ${RISK_COLORS[risk] || 'var(--gray-300)'}40`,
                          }}>
                            {risk}
                          </span>
                        ) : '-'}
                      </span>
                    </td>
                    <td data-label="Outcome">
                      <span className="cell-value" title={outcome} style={{ fontSize: '12px', color: 'var(--gray-600)', maxWidth: '250px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {outcomeShort || '-'}
                      </span>
                    </td>
                    <td data-label="Result" style={{ textAlign: 'center' }}>
                      <span className="cell-value">{rec.result ? <StatusBadge status={rec.result.toUpperCase()} /> : '-'}</span>
                    </td>
                    <td data-label="P/L" style={{ textAlign: 'right' }}>
                      <span className="cell-value" style={{ fontWeight: 700, color: pnlVal >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {pnl}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>}

      {detailMatch && (
        <MatchDetailModal
          open
          matchId={detailMatch.id}
          matchDisplay={detailMatch.display}
          onClose={() => setDetailMatch(null)}
        />
      )}
    </div>
  );
}
