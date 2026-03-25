import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MatchDetailModal } from '@/components/ui/MatchDetailModal';
import { RecommendationCard } from '@/components/ui/RecommendationCard';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  fetchRecommendationsPaginated,
  fetchRecommendationDeliveriesPaginated,
  fetchBetTypes,
  fetchDistinctLeagues,
} from '@/lib/services/api';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { PageHeader } from '@/components/ui/PageHeader';
import { DatePicker } from '@/components/ui/DatePicker';
import { fetchMonitorConfig } from '@/features/live-monitor/config';
import type { Recommendation, RecommendationDelivery } from '@/types';

type ViewMode = 'cards' | 'table';
type RecommendationFeedMode = 'shared' | 'deliveries';

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

function mapDeliveryToRecommendation(row: RecommendationDelivery): Recommendation {
  const homeTeam = row.recommendation_home_team ?? '';
  const awayTeam = row.recommendation_away_team ?? '';
  return {
    id: row.recommendation_id,
    match_id: row.match_id,
    match_display: homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : row.match_id,
    home_team: homeTeam || undefined,
    away_team: awayTeam || undefined,
    league: row.recommendation_league ?? undefined,
    timestamp: row.recommendation_timestamp ?? row.created_at,
    minute: row.recommendation_minute ?? undefined,
    score: row.recommendation_score ?? undefined,
    actual_outcome: row.recommendation_actual_outcome ?? undefined,
    bet_type: row.recommendation_bet_type ?? 'AI',
    bet_market: row.recommendation_bet_market ?? undefined,
    selection: row.recommendation_selection ?? '-',
    odds: row.recommendation_odds ?? '-',
    confidence: row.recommendation_confidence ?? '-',
    value_percent: row.recommendation_value_percent ?? undefined,
    risk_level: row.recommendation_risk_level ?? undefined,
    stake_percent: row.recommendation_stake_percent ?? undefined,
    stake_amount: 0,
    reasoning: row.recommendation_reasoning ?? undefined,
    reasoning_vi: row.recommendation_reasoning_vi ?? undefined,
    key_factors: row.recommendation_key_factors ?? undefined,
    warnings: row.recommendation_warnings ?? undefined,
    result: row.recommendation_result ?? row.delivery_status,
    pnl: row.recommendation_pnl ?? 0,
    created_at: row.created_at,
  };
}

export function RecommendationsTab() {
  const { state } = useAppState();
  const { config, leagues: appLeagues, matches: appMatches } = state;
  const [notificationLang, setNotificationLang] = useState<'vi' | 'en' | 'both'>('vi');
  const [feedMode, setFeedMode] = useState<RecommendationFeedMode>('shared');
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
  const searchRef = useRef<HTMLInputElement>(null);

  // `/` key focuses search
  useEffect(() => {
    let mounted = true;
    const syncNotificationLanguage = () => {
      void fetchMonitorConfig()
        .then((monitorConfig) => {
          if (!mounted) return;
          setNotificationLang((monitorConfig.NOTIFICATION_LANGUAGE as 'vi' | 'en' | 'both') || 'vi');
        })
        .catch(() => undefined);
    };

    syncNotificationLanguage();
    window.addEventListener('tfi:settings-updated', syncNotificationLanguage as EventListener);

    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      mounted = false;
      window.removeEventListener('keydown', handler);
      window.removeEventListener('tfi:settings-updated', syncNotificationLanguage as EventListener);
    };
  }, []);

  // Sort leagues: top leagues first
  const sortedLeagues = useMemo(() => {
    const topNames = new Set(appLeagues.filter((l) => l.top_league).map((l) => l.league_name));
    return [...leagues].sort((a, b) => {
      const aTop = topNames.has(a);
      const bTop = topNames.has(b);
      if (aTop !== bTop) return aTop ? -1 : 1;
      return a.localeCompare(b);
    });
  }, [leagues, appLeagues]);

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
      if (feedMode === 'deliveries') {
        const res = await fetchRecommendationDeliveriesPaginated(config, {
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
        setRows(res.rows.map(mapDeliveryToRecommendation));
        setTotal(res.total);
      } else {
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
      }
    } catch {
      // keep previous data
    } finally {
      setLoading(false);
    }
  }, [config, dateFrom, dateTo, feedMode, leagueFilter, resultFilter, betTypeFilter, riskFilter, search, sortCol, sortDir]);

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
      <PageHeader
        subtitle={<>
          <span style={{ color: 'var(--gray-500)' }}>{feedMode === 'shared' ? 'Shared feed' : 'My deliveries'}</span>
          <span>{summary.total} total</span>
          <span className="text-positive">{summary.won}W</span>
          <span className="text-negative">{summary.lost}L</span>
          <span className={summary.pnl >= 0 ? 'text-positive' : 'text-negative'} style={{ fontWeight: 600 }}>
            P/L: {summary.pnl >= 0 ? '+' : ''}${summary.pnl.toFixed(2)}
          </span>
          {loading && <span className="text-primary-color">Loading...</span>}
        </>}
      />

      {/* Filters + view/chart toggles */}
      <div className="card mb-16">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderBottom: '1px solid var(--gray-200)', background: 'var(--gray-50)', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', padding: '3px', borderRadius: '8px', background: 'white', border: '1px solid var(--gray-200)' }}>
            <button
              className="btn"
              onClick={() => { setFeedMode('shared'); setPage(1); }}
              style={{
                padding: '6px 10px',
                border: 'none',
                borderRadius: '6px',
                background: feedMode === 'shared' ? 'var(--gray-900)' : 'transparent',
                color: feedMode === 'shared' ? '#fff' : 'var(--gray-600)',
              }}
            >
              Shared Recommendations
            </button>
            <button
              className="btn"
              onClick={() => { setFeedMode('deliveries'); setPage(1); }}
              style={{
                padding: '6px 10px',
                border: 'none',
                borderRadius: '6px',
                background: feedMode === 'deliveries' ? 'var(--gray-900)' : 'transparent',
                color: feedMode === 'deliveries' ? '#fff' : 'var(--gray-600)',
              }}
            >
              My Deliveries
            </button>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>
            {feedMode === 'shared'
              ? 'Canonical recommendation history shared across users.'
              : 'User-scoped delivery history staged from matching watch subscriptions.'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--gray-200)' }}>
          <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', padding: '8px 12px' }}>
            <input
              ref={searchRef}
              type="text"
              className="filter-input"
              placeholder="Search match / selection… ( / )"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{ flex: '2 1 160px', minWidth: 0 }}
            />
            <select className="filter-input" value={resultFilter} onChange={(e) => { setResultFilter(e.target.value); setPage(1); }} style={{ flex: '1 1 100px', minWidth: 0 }}>
              <option value="all">All Status</option>
              <option value="win">Won</option>
              <option value="loss">Lost</option>
              <option value="push">Push</option>
              <option value="pending">Pending</option>
            </select>
            <select className="filter-input" value={leagueFilter} onChange={(e) => { setLeagueFilter(e.target.value); setPage(1); }} style={{ flex: '1 1 110px', minWidth: 0 }}>
              <option value="all">All Leagues</option>
              {sortedLeagues.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <select className="filter-input" value={betTypeFilter} onChange={(e) => { setBetTypeFilter(e.target.value); setPage(1); }} style={{ flex: '1 1 100px', minWidth: 0 }}>
              <option value="all">All Markets</option>
              {betTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="filter-input" value={riskFilter} onChange={(e) => { setRiskFilter(e.target.value); setPage(1); }} style={{ flex: '1 1 90px', minWidth: 0 }}>
              <option value="all">All Risk</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
            <DatePicker className="filter-input" value={dateFrom} onChange={(v) => { setDateFrom(v); setPage(1); }} title="From date" placeholder="From date" style={{ flex: '1 1 120px', minWidth: 0 }} />
            <DatePicker className="filter-input" value={dateTo} onChange={(v) => { setDateTo(v); setPage(1); }} title="To date" placeholder="To date" style={{ flex: '1 1 120px', minWidth: 0 }} />
            {activeFilterCount > 0 && (
              <button className="btn btn-secondary" onClick={clearFilters} style={{ flexShrink: 0 }}>Clear</button>
            )}
          </div>

          {/* Icon toggles: chart + view mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '0 12px', flexShrink: 0, borderLeft: '1px solid var(--gray-100)' }}>
            <button
              onClick={() => setShowChart((v) => !v)}
              title={showChart ? 'Hide chart' : 'Show P/L chart'}
              style={{ padding: '5px 7px', borderRadius: '5px', border: '1px solid', cursor: 'pointer', background: showChart ? 'var(--gray-800)' : 'transparent', borderColor: showChart ? 'var(--gray-800)' : 'var(--gray-300)', color: showChart ? '#fff' : 'var(--gray-500)', lineHeight: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </button>
            <button
              onClick={() => setViewMode('table')}
              title="Table view"
              style={{ padding: '5px 7px', borderRadius: '5px', border: '1px solid', cursor: 'pointer', background: viewMode === 'table' ? 'var(--gray-800)' : 'transparent', borderColor: viewMode === 'table' ? 'var(--gray-800)' : 'var(--gray-300)', color: viewMode === 'table' ? '#fff' : 'var(--gray-500)', lineHeight: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>
            </button>
            <button
              onClick={() => setViewMode('cards')}
              title="Card view"
              style={{ padding: '5px 7px', borderRadius: '5px', border: '1px solid', cursor: 'pointer', background: viewMode === 'cards' ? 'var(--gray-800)' : 'transparent', borderColor: viewMode === 'cards' ? 'var(--gray-800)' : 'var(--gray-300)', color: viewMode === 'cards' ? '#fff' : 'var(--gray-500)', lineHeight: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* P/L Chart */}
      {showChart && chartData.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div style={{ padding: '12px 16px 4px 16px', borderBottom: '1px solid var(--gray-100)' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--gray-700)' }}>Cumulative P/L</span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 8 }}>
              Running profit/loss over settled recommendations (win/loss), sorted by time — based on current filter
            </span>
          </div>
          <div style={{ padding: '8px 12px 8px 0' }}>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                <XAxis dataKey="idx" tick={{ fontSize: 10 }} label={{ value: 'Pick #', position: 'insideBottom', offset: -2, fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} label={{ value: 'P/L ($)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11 }} />
                <Tooltip
                  formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Cumulative P/L']}
                  labelFormatter={(label) => `Pick #${label}`}
                />
                <Area type="monotone" dataKey="cumulative" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Card view */}
      {viewMode === 'cards' && (
        <div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          {rows.length === 0 ? (
            <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)' }}>
              <p>{loading ? 'Loading...' : 'No recommendations match filters'}</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '10px' }}>
              {rows.map((rec, i) => (
                <RecommendationCard
                  key={rec.id ?? i}
                  rec={rec}
                  lang={notificationLang}
                  onViewMatch={(id, display) => {
                    const effectiveId = id || appMatches.find(
                      m => m.home_team === rec.home_team && m.away_team === rec.away_team,
                    )?.match_id || '';
                    if (effectiveId) setDetailMatch({ id: effectiveId, display });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && <div className="card">
        <div className="table-container table-cards">
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
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
                      <span className="cell-value"><span style={{ background: 'var(--gray-100)', padding: '3px 7px', borderRadius: '4px', fontWeight: 600, color: 'var(--gray-700)', fontSize: '12px', whiteSpace: 'nowrap' }}>{formatLocalDateTime(ts)}</span></span>
                    </td>
                    <td data-label="League">
                      <span className="cell-value" title={leagueName} style={{ fontSize: '12px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {leagueName}
                      </span>
                    </td>
                    <td data-label="Match">
                      <span
                        className="cell-value match-cell"
                        style={{ cursor: rec.match_id ? 'pointer' : undefined, color: 'var(--gray-800)', textDecoration: rec.match_id ? 'underline' : undefined, textDecorationColor: 'var(--gray-300)' }}
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
                            display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
                            fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
                            background: 'var(--gray-100)', color: 'var(--gray-600)',
                            border: '1px solid var(--gray-200)',
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
                    <td data-label="P/L" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span className="cell-value" style={{ fontWeight: 600, color: pnlVal >= 0 ? '#15803d' : '#b91c1c', whiteSpace: 'nowrap' }}>
                        {pnl}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
