import { useState, useMemo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MatchDetailModal } from '@/components/ui/MatchDetailModal';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const PAGE_SIZE = 30;

type SortCol = 'time' | 'odds' | 'confidence' | 'pnl' | '';
type SortDir = 'asc' | 'desc';

export function RecommendationsTab() {
  const { state, loadAllData } = useAppState();
  const { recommendations } = state;
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState<string>('all');
  const [betTypeFilter, setBetTypeFilter] = useState<string>('all');
  const [sortCol, setSortCol] = useState<SortCol>('');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showChart, setShowChart] = useState(false);
  const [detailMatch, setDetailMatch] = useState<{ id: string; display: string } | null>(null);

  // Unique bet types for filter dropdown
  const betTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of recommendations) {
      if (r.bet_type) set.add(r.bet_type);
    }
    return [...set].sort();
  }, [recommendations]);

  // Filtered + sorted data
  const filtered = useMemo(() => {
    let data = [...recommendations];

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(
        (r) =>
          (r.match_display || '').toLowerCase().includes(q) ||
          (r.selection || '').toLowerCase().includes(q),
      );
    }

    // Result filter
    if (resultFilter !== 'all') {
      data = data.filter((r) => {
        if (resultFilter === 'pending') return !r.result || r.result === 'pending';
        return r.result === resultFilter;
      });
    }

    // Bet type filter
    if (betTypeFilter !== 'all') {
      data = data.filter((r) => r.bet_type === betTypeFilter);
    }

    // Sort
    if (sortCol) {
      data.sort((a, b) => {
        let va = 0, vb = 0;
        if (sortCol === 'time') {
          va = a.created_at ? new Date(a.created_at).getTime() : 0;
          vb = b.created_at ? new Date(b.created_at).getTime() : 0;
        } else if (sortCol === 'odds') {
          va = parseFloat(String(a.odds ?? 0));
          vb = parseFloat(String(b.odds ?? 0));
        } else if (sortCol === 'confidence') {
          va = parseFloat(String(a.confidence ?? 0));
          vb = parseFloat(String(b.confidence ?? 0));
        } else if (sortCol === 'pnl') {
          va = parseFloat(String(a.pnl ?? 0));
          vb = parseFloat(String(b.pnl ?? 0));
        }
        return sortDir === 'asc' ? va - vb : vb - va;
      });
    }

    return data;
  }, [recommendations, search, resultFilter, betTypeFilter, sortCol, sortDir]);

  // Summary for filtered set
  const summary = useMemo(() => {
    const settled = filtered.filter((r) => r.result === 'won' || r.result === 'lost');
    const won = settled.filter((r) => r.result === 'won').length;
    const pnl = settled.reduce((s, r) => s + parseFloat(String(r.pnl ?? 0)), 0);
    return { total: filtered.length, won, lost: settled.length - won, pnl };
  }, [filtered]);

  // Cumulative P/L chart for filtered data
  const chartData = useMemo(() => {
    if (!showChart) return [];
    const sorted = [...filtered]
      .filter((r) => (r.result === 'won' || r.result === 'lost') && r.created_at)
      .sort((a, b) => new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime());

    let cum = 0;
    return sorted.map((r, i) => {
      cum += parseFloat(String(r.pnl ?? 0));
      return { idx: i + 1, cumulative: parseFloat(cum.toFixed(2)) };
    });
  }, [filtered, showChart]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
        <span>🎯 {summary.total} filtered</span>
        <span style={{ color: 'var(--success)' }}>✅ {summary.won}W</span>
        <span style={{ color: 'var(--danger)' }}>❌ {summary.lost}L</span>
        <span style={{ color: summary.pnl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
          P/L: {summary.pnl >= 0 ? '+' : ''}${summary.pnl.toFixed(2)}
        </span>
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
          <button className="btn btn-primary btn-sm" onClick={loadAllData}>🔄</button>
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
              {pageItems.length === 0 ? (
                <tr><td colSpan={9} className="empty-state">
                  <div className="empty-state-icon">🎯</div>
                  <p>No recommendations match filters</p>
                </td></tr>
              ) : pageItems.map((rec, i) => {
                const pnl = rec.pnl ? `${Number(rec.pnl) >= 0 ? '+' : ''}$${parseFloat(String(rec.pnl)).toFixed(2)}` : '-';
                const conf = rec.confidence != null ? `${parseFloat(String(rec.confidence))}/10` : '-';
                return (
                  <tr key={i}>
                    <td data-label="Time"><span className="cell-value">{rec.created_at ? new Date(rec.created_at).toLocaleString('vi-VN') : '-'}</span></td>
                    <td data-label="Match"><span className="cell-value match-cell" style={{ cursor: rec.match_id ? 'pointer' : undefined, textDecoration: rec.match_id ? 'underline' : undefined }} onClick={() => rec.match_id && setDetailMatch({ id: rec.match_id, display: rec.match_display || 'Match' })}>{rec.match_display || 'N/A'}</span></td>
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
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
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
