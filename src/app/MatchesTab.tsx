import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MatchCard } from '@/components/ui/MatchCard';
import { LIVE_STATUSES, PLACEHOLDER_HOME, PLACEHOLDER_AWAY } from '@/config/constants';
import { convertSeoulToLocalDateTime, formatDateTimeDisplay, getLeagueDisplayName, debounce, parseKickoffForSave } from '@/lib/utils/helpers';
import { normalizeToISO } from '@/lib/utils/helpers';
import type { Match, SortState, League } from '@/types';
import type { PipelineMatchResult } from '@/features/live-monitor/types';
import { runPipelineForMatch } from '@/features/live-monitor/services/pipeline';
import { MatchScoutModal } from '@/components/ui/MatchScoutModal';

const PAGE_SIZE = 30;

export function MatchesTab() {
  const { state, addToWatchlist } = useAppState();
  const { showToast } = useToast();
  const { matches, watchlist, config, leagues } = state;

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [leagueFilter, setLeagueFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ column: 'time', order: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingAdds, setPendingAdds] = useState<Set<string>>(new Set());
  const [analyzingMatches, setAnalyzingMatches] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [aiResults, setAiResults] = useState<Map<string, { matchId: string; matchDisplay: string; result: PipelineMatchResult }>>(new Map());
  const [scoutMatch, setScoutMatch] = useState<Match | null>(null);
  const aiResultsRef = useRef<HTMLDivElement>(null);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debouncedSetSearch = useRef(debounce((v: string) => setDebouncedSearch(v), 250)).current;
  const searchRef = useRef<HTMLInputElement>(null);

  // `/` key focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const handleSearchChange = (v: string) => {
    setSearch(v);
    debouncedSetSearch(v);
  };

  // Watchlist lookup map
  const watchlistMap = useMemo(() => new Map(watchlist.map((w) => [String(w.match_id), w])), [watchlist]);

  // Available leagues for filter (top leagues first)
  const leagueOptions = useMemo(() => {
    const topIds = new Set(leagues.filter((l) => l.top_league).map((l) => String(l.league_id)));
    const map = new Map<string, { id: string; displayName: string; count: number; isTop: boolean }>();
    matches.forEach((m) => {
      const key = String(m.league_id);
      if (!map.has(key)) {
        map.set(key, { id: key, displayName: getLeagueDisplayName(m.league_id, m.league_name || '', leagues), count: 0, isTop: topIds.has(key) });
      }
      map.get(key)!.count++;
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.isTop !== b.isTop) return a.isTop ? -1 : 1;
      return b.count - a.count;
    });
  }, [matches, leagues]);

  // Filtered & sorted
  const filtered = useMemo(() => {
    let items = matches.filter((m) => {
      if (debouncedSearch) {
        const s = debouncedSearch.toLowerCase();
        if (!m.home_team.toLowerCase().includes(s) && !m.away_team.toLowerCase().includes(s) && !(m.league_name || '').toLowerCase().includes(s)) return false;
      }
      if (statusFilter) {
        if (statusFilter === 'LIVE') { if (!LIVE_STATUSES.includes(m.status)) return false; }
        else { if (m.status !== statusFilter) return false; }
      }
      if (leagueFilter && String(m.league_id) !== leagueFilter) return false;
      if (actionFilter) {
        const isWatched = watchlistMap.has(String(m.match_id));
        if (actionFilter === 'watched' && !isWatched) return false;
        if (actionFilter === 'not-watched' && isWatched) return false;
      }
      if (dateFrom || dateTo) {
        const iso = normalizeToISO(m.date);
        if (!iso) return false;
        if (dateFrom && iso < dateFrom) return false;
        if (dateTo && iso > dateTo) return false;
      }
      return true;
    });

    if (sort.column) {
      items = [...items].sort((a, b) => {
        let valA: string | number | Date, valB: string | number | Date;
        switch (sort.column) {
          case 'time':
            valA = convertSeoulToLocalDateTime(a.date, a.kickoff || '00:00');
            valB = convertSeoulToLocalDateTime(b.date, b.kickoff || '00:00');
            break;
          case 'league':
            valA = (a.league_name || '').toLowerCase();
            valB = (b.league_name || '').toLowerCase();
            break;
          case 'status':
            valA = a.status || ''; valB = b.status || ''; break;
          case 'action':
            valA = watchlistMap.has(String(a.match_id)) ? 1 : 0;
            valB = watchlistMap.has(String(b.match_id)) ? 1 : 0;
            break;
          default: return 0;
        }
        if (valA < valB) return sort.order === 'asc' ? -1 : 1;
        if (valA > valB) return sort.order === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [matches, debouncedSearch, statusFilter, leagueFilter, actionFilter, dateFrom, dateTo, sort, watchlistMap]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, leagueFilter, actionFilter, dateFrom, dateTo]);

  const handleSort = (col: string) => {
    setSort((prev) => ({ column: col, order: prev.column === col && prev.order === 'asc' ? 'desc' : 'asc' }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearch(''); setDebouncedSearch(''); setStatusFilter(''); setLeagueFilter('');
    setActionFilter(''); setDateFrom(''); setDateTo('');
    showToast('🔄 Filters cleared', 'success');
  };

  const quickAdd = useCallback(async (m: Match) => {
    const mid = String(m.match_id);
    if (watchlistMap.has(mid)) { showToast('✓ Already in watchlist', 'success'); return; }
    if (pendingAdds.has(mid)) { showToast('Saving... (already in progress)', 'info'); return; }

    setPendingAdds((prev) => new Set(prev).add(mid));
    showToast('Added to watchlist (saving...)', 'success');

    const ok = await addToWatchlist([{
      match_id: mid, date: m.date, league: m.league_name || '', home_team: m.home_team,
      away_team: m.away_team, kickoff: parseKickoffForSave(m.kickoff),
    }]);

    setPendingAdds((prev) => { const s = new Set(prev); s.delete(mid); return s; });
    if (!ok) showToast('❌ Failed to add to watchlist', 'error');
  }, [watchlistMap, pendingAdds, addToWatchlist, showToast]);

  const askAi = useCallback(async (m: Match) => {
    const mid = String(m.match_id);
    if (analyzingMatches.has(mid)) return; // Already analyzing this match

    // If result already exists, scroll to it instead of re-calling AI
    if (aiResults.has(mid)) {
      const el = document.getElementById(`ai-result-${mid}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        el.style.outline = '2px solid var(--primary)';
        setTimeout(() => { el.style.outline = ''; }, 1500);
      }
      showToast(`📋 ${m.home_team} vs ${m.away_team} — showing cached result`, 'info');
      return;
    }

    // If not in watchlist, add first
    if (!watchlistMap.has(mid)) {
      setPendingAdds((prev) => new Set(prev).add(mid));
      const ok = await addToWatchlist([{
        match_id: mid, date: m.date, league: m.league_name || '', home_team: m.home_team,
        away_team: m.away_team, kickoff: parseKickoffForSave(m.kickoff),
      }]);
      setPendingAdds((prev) => { const s = new Set(prev); s.delete(mid); return s; });
      if (!ok) { showToast('❌ Failed to add to watchlist', 'error'); return; }
    }

    setAnalyzingMatches((prev) => new Set(prev).add(mid));
    showToast(`🤖 Analyzing ${m.home_team} vs ${m.away_team}...`, 'info');

    try {
      const ctx = await runPipelineForMatch(config, mid);
      const matchResult = ctx.results[0];
      if (matchResult) {
        setAiResults((prev) => new Map(prev).set(mid, { matchId: mid, matchDisplay: `${m.home_team} vs ${m.away_team}`, result: matchResult }));
        if (matchResult.parsedAi && matchResult.error) {
          // AI succeeded but save/other step failed — show warning with detail
          showToast(`⚠️ ${m.home_team} vs ${m.away_team} — AI done but: ${matchResult.error}`, 'error');
        } else if (matchResult.parsedAi) {
          showToast(`✅ ${m.home_team} vs ${m.away_team} — done`, 'success');
        } else if (matchResult.error) {
          showToast(`⚠️ ${m.home_team} vs ${m.away_team} error: ${matchResult.error}`, 'error');
        } else {
          showToast(`⚠️ ${m.home_team} vs ${m.away_team} skipped by filters`, 'info');
        }
      } else {
        showToast(`⚠️ ${m.home_team} vs ${m.away_team} — no results`, 'info');
      }
    } catch (err) {
      showToast(`❌ ${m.home_team} vs ${m.away_team} failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setAnalyzingMatches((prev) => { const s = new Set(prev); s.delete(mid); return s; });
    }
  }, [analyzingMatches, aiResults, watchlistMap, addToWatchlist, config, showToast]);

  const toggleSelect = (mid: string, isWatched: boolean) => {
    if (isWatched) return;
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(mid)) s.delete(mid); else s.add(mid);
      return s;
    });
  };

  const toggleSelectAll = () => {
    const enabledIds = pageItems.filter((m) => !watchlistMap.has(String(m.match_id))).map((m) => String(m.match_id));
    const allSelected = enabledIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const s = new Set(prev);
      if (allSelected) enabledIds.forEach((id) => s.delete(id));
      else enabledIds.forEach((id) => s.add(id));
      return s;
    });
  };

  const addSelectedToWatchlist = async () => {
    const items = Array.from(selected).map((mid) => {
      const m = matches.find((x) => String(x.match_id) === mid);
      if (!m) return null;
      return { match_id: mid, date: m.date, league: m.league_name || '', home_team: m.home_team, away_team: m.away_team, kickoff: parseKickoffForSave(m.kickoff) };
    }).filter(Boolean) as Array<{match_id: string; date: string; league: string; home_team: string; away_team: string; kickoff: string}>;

    if (items.length === 0) return;
    const ok = await addToWatchlist(items);
    if (ok) { setSelected(new Set()); showToast(`✅ Added ${items.length} to watchlist`, 'success'); }
    else showToast('❌ Failed to add selected', 'error');
  };

  const sortIndicator = (col: string) => (sort.column === col ? (sort.order === 'asc' ? '▲' : '▼') : '');

  const enabledOnPage = pageItems.filter((m) => !watchlistMap.has(String(m.match_id)));
  const allPageSelected = enabledOnPage.length > 0 && enabledOnPage.every((m) => selected.has(String(m.match_id)));

  // Filter badges
  const badges = [];
  if (debouncedSearch) badges.push(`Teams: ${debouncedSearch}`);
  if (statusFilter) badges.push(`Status: ${statusFilter}`);
  if (leagueFilter) { const op = leagueOptions.find((l) => l.id === leagueFilter); badges.push(`League: ${op?.displayName || leagueFilter}`); }
  if (dateFrom || dateTo) badges.push(`Date: ${dateFrom || '—'} → ${dateTo || '—'}`);

  return (
    <div className="card">
      {/* Toolbar: filters + view toggle */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--gray-200)' }}>
        <div className="filters" style={{ flex: 1, borderBottom: 'none' }}>
          <input ref={searchRef} type="text" className="filter-input" placeholder="Search teams… ( / )" value={search} onChange={(e) => handleSearchChange(e.target.value)} />
          <select className="filter-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="NS">Not Started</option>
            <option value="LIVE">Live</option>
          </select>
          <select className="filter-input" value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}>
            <option value="">All Leagues</option>
            {leagueOptions.map((l) => <option key={l.id} value={l.id}>{l.displayName} ({l.count})</option>)}
          </select>
          <select className="filter-input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            <option value="not-watched">Not Watched</option>
            <option value="watched">Watched</option>
          </select>
          <input type="date" className="filter-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
          <input type="date" className="filter-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
          {(search || statusFilter || leagueFilter || actionFilter || dateFrom || dateTo) && (
            <button className="btn btn-secondary" onClick={clearFilters}>Clear</button>
          )}
        </div>
        {/* View toggle: icon buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '0 12px', flexShrink: 0, borderLeft: '1px solid var(--gray-100)' }}>
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

      {/* Contextual selection bar — only shown when items are checked */}
      {viewMode === 'table' && selected.size > 0 && (
        <div style={{ padding: '7px 16px', background: '#f0f9ff', borderBottom: '1px solid #bae6fd', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--gray-600)' }}>{selected.size} selected</span>
          <button className="btn btn-primary btn-sm" onClick={addSelectedToWatchlist}>+ Add to Watchlist</button>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {/* AI Result Panels */}
      {aiResults.size > 0 && (
        <div ref={aiResultsRef} style={{ margin: '12px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {aiResults.size > 1 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setAiResults(new Map())}>Close All ({aiResults.size})</button>
            </div>
          )}
          {Array.from(aiResults.values()).map((entry) => (
            <div key={entry.matchId} id={`ai-result-${entry.matchId}`} className="ai-result-panel" style={{ padding: '16px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: '8px', transition: 'outline 0.3s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '14px' }}>AI Analysis — {entry.matchDisplay}</h4>
                <button className="btn btn-secondary btn-sm" onClick={() => setAiResults((prev) => { const m = new Map(prev); m.delete(entry.matchId); return m; })}>Close</button>
              </div>
              {entry.result.parsedAi ? (() => {
                const ai = entry.result.parsedAi!;
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
                    <div><strong>Selection:</strong> {ai.selection}</div>
                    <div><strong>Market:</strong> {ai.bet_market}</div>
                    <div><strong>Confidence:</strong> {ai.confidence}%</div>
                    <div><strong>Risk:</strong> <span style={{ color: ai.risk_level === 'LOW' ? 'var(--green)' : ai.risk_level === 'HIGH' ? 'var(--red)' : 'var(--orange)' }}>{ai.risk_level}</span></div>
                    <div><strong>Stake:</strong> {ai.stake_percent}%</div>
                    <div><strong>Odds:</strong> {ai.odds_for_display ?? '—'}</div>
                    <div><strong>Value:</strong> {ai.value_percent}%</div>
                    <div><strong>Should Bet:</strong> {ai.final_should_bet ? 'Yes' : 'No'}</div>
                    <div style={{ gridColumn: '1 / -1' }}><strong>Reasoning:</strong> {ai.reasoning_vi || ai.reasoning_en}</div>
                    {ai.warnings.length > 0 && (
                      <div style={{ gridColumn: '1 / -1', color: 'var(--orange)' }}><strong>Warnings:</strong> {ai.warnings.join('; ')}</div>
                    )}
                  </div>
                );
              })() : entry.result.error ? (
                <div style={{ color: 'var(--red)', fontSize: '13px' }}>❌ {entry.result.error}</div>
              ) : (
                <div style={{ color: 'var(--gray-600)', fontSize: '13px' }}>Match was skipped by pipeline filters (not active or no data available).</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Card view */}
      {viewMode === 'cards' && (
        <div style={{ padding: '16px' }}>
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          {pageItems.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)' }}>
              <p>No matches found</p>
              <button className="btn btn-secondary" onClick={clearFilters} style={{ marginTop: '10px' }}>Clear Filters</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '12px' }}>
              {pageItems.map((m) => (
                <MatchCard
                  key={m.match_id}
                  match={m}
                  highlighted={selected.has(String(m.match_id))}
                  actions={[
                    watchlistMap.has(String(m.match_id))
                      ? { label: '✓ Watched', onClick: () => {}, variant: 'success', disabled: true }
                      : pendingAdds.has(String(m.match_id))
                        ? { label: 'Saving…', onClick: () => {}, disabled: true }
                        : { label: '+ Watch', onClick: (match) => quickAdd(match), variant: 'primary' },
                    {
                      label: analyzingMatches.has(String(m.match_id)) ? 'Analyzing…' : aiResults.has(String(m.match_id)) ? '✅ View Result' : 'Ask AI',
                      onClick: (match) => askAi(match),
                      variant: aiResults.has(String(m.match_id)) ? 'success' as const : 'secondary' as const,
                      loading: analyzingMatches.has(String(m.match_id)),
                      disabled: analyzingMatches.has(String(m.match_id)),
                    },
                  ]}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && <div className="table-container table-cards">
        <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
        <table>
          <thead>
            <tr>
              <th style={{ cursor: 'pointer' }} onClick={() => handleSort('time')}>Time {sortIndicator('time')}</th>
              <th style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => handleSort('league')}>League {sortIndicator('league')}</th>
              <th style={{ textAlign: 'center' }}>Match</th>
              <th style={{ width: 40, textAlign: 'center' }}>
                <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} />
              </th>
              <th style={{ textAlign: 'center' }}>Score</th>
              <th style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
              <th style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => handleSort('action')}>Action {sortIndicator('action')}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={7} className="empty-state">
                <p>No matches found</p>
                <button className="btn btn-secondary" onClick={clearFilters} style={{ marginTop: '10px' }}>Clear Filters</button>
              </td></tr>
            ) : pageItems.map((m) => (
              <MatchRow
                key={m.match_id}
                match={m}
                isWatched={watchlistMap.has(String(m.match_id))}
                isPending={pendingAdds.has(String(m.match_id))}
                isSelected={selected.has(String(m.match_id))}
                isAnalyzing={analyzingMatches.has(String(m.match_id))}
                hasResult={aiResults.has(String(m.match_id))}
                leagues={leagues}
                onQuickAdd={() => quickAdd(m)}
                onToggleSelect={() => toggleSelect(String(m.match_id), watchlistMap.has(String(m.match_id)))}
                onAskAi={() => askAi(m)}
                onDoubleClick={() => setScoutMatch(m)}
              />
            ))}
          </tbody>
        </table>
      </div>}

      {scoutMatch && (
        <MatchScoutModal
          open
          matchId={String(scoutMatch.match_id)}
          homeTeam={scoutMatch.home_team}
          awayTeam={scoutMatch.away_team}
          homeLogo={scoutMatch.home_logo}
          awayLogo={scoutMatch.away_logo}
          leagueName={scoutMatch.league_name ?? ''}
          leagueId={scoutMatch.league_id}
          status={scoutMatch.status}
          onClose={() => setScoutMatch(null)}
        />
      )}
    </div>
  );
}

interface MatchRowProps {
  match: Match;
  isWatched: boolean;
  isPending: boolean;
  isSelected: boolean;
  isAnalyzing: boolean;
  hasResult: boolean;
  leagues: League[];
  onQuickAdd: () => void;
  onToggleSelect: () => void;
  onAskAi: () => void;
  onDoubleClick: () => void;
}

function MatchRow({ match, isWatched, isPending, isSelected, isAnalyzing, hasResult, leagues, onQuickAdd, onToggleSelect, onAskAi, onDoubleClick }: MatchRowProps) {
  const localDT = convertSeoulToLocalDateTime(match.date, match.kickoff || '00:00');
  const timeDisplay = formatDateTimeDisplay(localDT);
  const leagueDisplay = getLeagueDisplayName(match.league_id, match.league_name || '', leagues);
  const score = match.home_score != null && match.home_score !== '' ? `${match.home_score} - ${match.away_score}` : '';
  const currentMinute = match.status === 'HT' ? 'HT' : (match.current_minute ? `${match.current_minute}'` : '');

  return (
    <tr onDoubleClick={onDoubleClick} style={{ cursor: 'pointer' }} title="Double-click to view match details">
      <td data-label="Time" style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
        <div className="cell-value">
          <div className="time-status">
            <span className="time-pill" style={{ background: 'var(--gray-200)', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, color: 'var(--gray-900)', fontSize: '13px' }}>{timeDisplay}</span>
            <span className="status-inline"><StatusBadge status={match.status} /></span>
          </div>
        </div>
      </td>
      <td data-label="League" style={{ textAlign: 'center' }}><div className="cell-value"><span style={{ fontWeight: 400 }}>{leagueDisplay}</span></div></td>
      <td data-label="Match" style={{ textAlign: 'center' }}>
        <div className="cell-value match-cell">
          <div className="match-teams">
            <div className="team-info">
              <img src={match.home_logo} loading="lazy" decoding="async" alt={match.home_team} className="team-logo" onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_HOME; }} />
              <span style={{ fontWeight: 400 }}>{match.home_team}</span>
              {(match.home_reds ?? 0) > 0 && <span title={`${match.home_reds} red card(s)`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, background: '#dc2626', color: '#fff', borderRadius: 3, padding: '1px 5px', marginLeft: 5, letterSpacing: '0.3px' }}>■ {match.home_reds}</span>}
            </div>
            <span className="match-vs">vs</span>
            <div className="team-info">
              {(match.away_reds ?? 0) > 0 && <span title={`${match.away_reds} red card(s)`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, background: '#dc2626', color: '#fff', borderRadius: 3, padding: '1px 5px', marginRight: 5, letterSpacing: '0.3px' }}>■ {match.away_reds}</span>}
              <span style={{ fontWeight: 400 }}>{match.away_team}</span>
              <img src={match.away_logo} loading="lazy" decoding="async" alt={match.away_team} className="team-logo" onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_AWAY; }} />
            </div>
          </div>
        </div>
      </td>
      <td className={`select-col ${isWatched ? 'select-disabled' : ''}`} data-label="Select">
        <div className="cell-value">
          <input type="checkbox" checked={isSelected} disabled={isWatched} onChange={onToggleSelect} title={isWatched ? 'Already in watchlist' : undefined} />
        </div>
      </td>
      <td data-label="Score" className={!score ? 'score-empty' : ''} style={{ textAlign: 'center' }}>
        <div className="cell-value">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
            <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--gray-900)' }}>{score}</div>
            {currentMinute && <div style={{ fontSize: '11px', color: 'var(--gray-600)', fontWeight: 500 }}>{currentMinute}</div>}
          </div>
        </div>
      </td>
      <td data-label="Status" className="status-cell" style={{ textAlign: 'center' }}>
        <div className="cell-value"><StatusBadge status={match.status} /></div>
      </td>
      <td data-label="Action" style={{ textAlign: 'center' }}>
        <div className="cell-value flex-row-gap-4 flex-center flex-wrap">
          {isWatched ? (
            <button className="btn btn-success btn-sm watch-btn" disabled><span className="btn-text">Watched</span></button>
          ) : isPending ? (
            <button className="btn btn-primary btn-sm watch-btn" disabled>
              <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
              <span className="btn-text">Saving...</span>
            </button>
          ) : (
            <button className="btn btn-primary btn-sm watch-btn" onClick={onQuickAdd}>
              <span className="btn-text">+ Watch</span>
            </button>
          )}
          <button className={`btn ${hasResult ? 'btn-success' : 'btn-secondary'} btn-sm`} onClick={onAskAi} disabled={isAnalyzing} title={hasResult ? 'View cached result' : 'Ask AI for analysis'}>
            {isAnalyzing && <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />}
            <span className="btn-text" style={{ marginLeft: isAnalyzing ? '2px' : undefined }}>{isAnalyzing ? 'Analyzing...' : hasResult ? '✅ View Result' : 'Ask AI'}</span>
          </button>
        </div>
      </td>
    </tr>
  );
}
