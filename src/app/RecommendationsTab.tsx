import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MatchDetailModal } from '@/components/ui/MatchDetailModal';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetchRecommendationsPaginated, fetchBetTypes } from '@/lib/services/api';
import type { Recommendation } from '@/types';

const PAGE_SIZE = 30;

type SortCol = 'time' | 'odds' | 'confidence' | 'pnl' | '';
type SortDir = 'asc' | 'desc';

const SORT_COL_MAP: Record<string, string> = {
  time: 'created_at',
  odds: 'odds',
  confidence: 'confidence',
  pnl: 'pnl',
};

export function RecommendationsTab() {
  const { state } = useAppState();
  const { config } = state;
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState<string>('all');
  const [betTypeFilter, setBetTypeFilter] = useState<string>('all');
  const [sortCol, setSortCol] = useState<SortCol>('');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showChart, setShowChart] = useState(false);
  const [detailMatch, setDetailMatch] = useState<{ id: string; display: string } | null>(null);

  // Server data
  const [rows, setRows] = useState<Recommendation[]>([]);
  const [total, setTotal] = useState(0);
  const [betTypes, setBetTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch recommendations from server
  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchRecommendationsPaginated(config, {
        limit: PAGE_SIZE,
        offset: (p - 1) * PAGE_SIZE,
        result: resultFilter !== 'all' ? resultFilter : undefined,
        bet_type: betTypeFilter !== 'all' ? betTypeFilter : undefined,
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
  }, [config, resultFilter, betTypeFilter, search, sortCol, sortDir]);

  // Load bet types once
  useEffect(() => {
    fetchBetTypes(config).then(setBetTypes).catch(() => {});
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
    const settled = rows.filter((r) => r.result === 'won' || r.result === 'lost');
    const won = settled.filter((r) => r.result === 'won').length;
    const pnl = settled.reduce((s, r) => s + parseFloat(String(r.pnl ?? 0)), 0);
    return { total, won, lost: settled.length - won, pnl };
  })();

  // Cumulative P/L chart for current page data
  const chartData = (() => {
    if (!showChart) return [];
    const sorted = [...rows]
      .filter((r) => (r.result === 'won' || r.result === 'lost') && r.created_at)
      .sort((a, b) => new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime());

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

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '13px', color: 'var(--gray-500)' }}>
        <span>🎯 {summary.total} total</span>
        <span style={{ color: 'var(--success)' }}>✅ {summary.won}W (page)</span>
        <span style={{ color: 'var(--danger)' }}>❌ {summary.lost}L (page)</span>
        <span style={{ color: summary.pnl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
          P/L (page): {summary.pnl >= 0 ? '+' : ''}${summary.pnl.toFixed(2)}
        </span>
        {loading && <span style={{ color: 'var(--primary)' }}>⏳ Loading...</span>}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            className="monitor-input"
            placeholder="🔍 Search match / selection..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ flex: '1 1 200px', minWidth: 160 }}
          />
          <select
            className="monitor-input"
            value={resultFilter}
            onChange={(e) => { setResultFilter(e.target.value); setPage(1); }}
            style={{ width: 120 }}
          >
            <option value="all">All Results</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="pending">Pending</option>
          </select>
          <select
            className="monitor-input"
            value={betTypeFilter}
            onChange={(e) => { setBetTypeFilter(e.target.value); setPage(1); }}
            style={{ width: 140 }}
          >
            <option value="all">All Markets</option>
            {betTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className={`btn btn-sm ${showChart ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setShowChart((v) => !v)}>
            {showChart ? '📊 Hide Chart' : '📈 Show Chart'}
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

      {/* Table */}
      <div className="card">
        <div className="table-container table-cards">
          <table>
            <thead>
              <tr>
                <th onClick={() => handleSort('time')} style={{ cursor: 'pointer' }}>Time{sortIcon('time')}</th>
                <th>Match</th>
                <th>Bet Type</th>
                <th>Selection</th>
                <th onClick={() => handleSort('odds')} style={{ cursor: 'pointer' }}>Odds{sortIcon('odds')}</th>
                <th onClick={() => handleSort('confidence')} style={{ cursor: 'pointer' }}>Confidence{sortIcon('confidence')}</th>
                <th>Stake</th>
                <th>Result</th>
                <th onClick={() => handleSort('pnl')} style={{ cursor: 'pointer' }}>P/L{sortIcon('pnl')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="empty-state">
                  <div className="empty-state-icon">🎯</div>
                  <p>{loading ? 'Loading...' : 'No recommendations match filters'}</p>
                </td></tr>
              ) : rows.map((rec, i) => {
                const pnl = rec.pnl ? `${Number(rec.pnl) >= 0 ? '+' : ''}$${parseFloat(String(rec.pnl)).toFixed(2)}` : '-';
                const conf = rec.confidence != null ? `${parseFloat(String(rec.confidence))}/10` : '-';
                const display = rec.home_team && rec.away_team
                  ? `${rec.home_team} vs ${rec.away_team}`
                  : rec.match_display || 'N/A';
                return (
                  <tr key={i}>
                    <td data-label="Time"><span className="cell-value">{rec.created_at ? new Date(rec.created_at).toLocaleString('vi-VN') : '-'}</span></td>
                    <td data-label="Match"><span className="cell-value match-cell" style={{ cursor: rec.match_id ? 'pointer' : undefined, textDecoration: rec.match_id ? 'underline' : undefined }} onClick={() => rec.match_id && setDetailMatch({ id: rec.match_id, display })}>{display}</span></td>
                    <td data-label="Bet Type"><span className="cell-value">{rec.bet_type || '-'}</span></td>
                    <td data-label="Selection"><span className="cell-value"><strong>{rec.selection || '-'}</strong></span></td>
                    <td data-label="Odds"><span className="cell-value"><strong>{rec.odds || '-'}</strong></span></td>
                    <td data-label="Confidence"><span className="cell-value">{conf}</span></td>
                    <td data-label="Stake"><span className="cell-value">${rec.stake_amount || '0'}</span></td>
                    <td data-label="Result"><span className="cell-value">{rec.result ? <StatusBadge status={rec.result.toUpperCase()} /> : '-'}</span></td>
                    <td data-label="P/L">
                      <span className="cell-value" style={{ fontWeight: 700, color: Number(rec.pnl) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
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
      </div>

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
