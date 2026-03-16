import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LIVE_STATUSES, PLACEHOLDER_HOME, PLACEHOLDER_AWAY } from '@/config/constants';
import { convertSeoulToLocalDateTime, formatDateTimeDisplay, getLeagueDisplayName, debounce, parseKickoffForSave } from '@/lib/utils/helpers';
import { normalizeToISO } from '@/lib/utils/helpers';
import type { Match, SortState, ApprovedLeague } from '@/types';
import * as api from '@/lib/services/api';

const PAGE_SIZE = 30;

export function MatchesTab() {
  const { state, addToWatchlist, loadAllData } = useAppState();
  const { showToast } = useToast();
  const { matches, watchlist, config, approvedLeagues } = state;

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

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debouncedSetSearch = useRef(debounce((v: string) => setDebouncedSearch(v), 250)).current;
  const handleSearchChange = (v: string) => {
    setSearch(v);
    debouncedSetSearch(v);
  };

  // Watchlist lookup map
  const watchlistMap = useMemo(() => new Map(watchlist.map((w) => [String(w.match_id), w])), [watchlist]);

  // Available leagues for filter
  const leagueOptions = useMemo(() => {
    const map = new Map<string, { id: string; displayName: string; count: number }>();
    matches.forEach((m) => {
      const key = String(m.league_id);
      if (!map.has(key)) {
        map.set(key, { id: key, displayName: getLeagueDisplayName(m.league_id, m.league_name || '', approvedLeagues), count: 0 });
      }
      map.get(key)!.count++;
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [matches, approvedLeagues]);

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

  // Auto-refresh every 60s
  useEffect(() => {
    const timer = setInterval(() => {
      api.fetchMatches(config).then(() => {
        // Re-fetch handled via loadAllData
      }).catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [config]);

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
      <div className="card-header">
        <div className="card-title">📅 Matches</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-primary btn-sm" disabled={selected.size === 0} onClick={addSelectedToWatchlist} style={{ fontSize: '13px' }}>
            {selected.size > 0 ? `+ Selected Watches (${selected.size})` : '+ Selected Watches'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={loadAllData}>🔄 Refresh</button>
        </div>
      </div>

      <div className="filters">
        <input type="text" className="filter-input" placeholder="🔍 Search teams..." value={search} onChange={(e) => handleSearchChange(e.target.value)} />
        <select className="filter-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="NS">⏱️ Not Started</option>
          <option value="LIVE">🔴 Live</option>
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
        <button className="btn btn-secondary" onClick={clearFilters}>✖ Clear Filters</button>
        {badges.length > 0 && (
          <div style={{ marginLeft: '8px', display: 'inline-block' }}>
            {badges.map((b, i) => <span key={i} className="filter-badge">{b}</span>)}
          </div>
        )}
      </div>

      <div className="table-container table-cards">
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
                <div className="empty-state-icon">🔍</div>
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
                approvedLeagues={approvedLeagues}
                onQuickAdd={() => quickAdd(m)}
                onToggleSelect={() => toggleSelect(String(m.match_id), watchlistMap.has(String(m.match_id)))}
              />
            ))}
          </tbody>
        </table>
        <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}

interface MatchRowProps {
  match: Match;
  isWatched: boolean;
  isPending: boolean;
  isSelected: boolean;
  approvedLeagues: ApprovedLeague[];
  onQuickAdd: () => void;
  onToggleSelect: () => void;
}

function MatchRow({ match, isWatched, isPending, isSelected, approvedLeagues, onQuickAdd, onToggleSelect }: MatchRowProps) {
  const localDT = convertSeoulToLocalDateTime(match.date, match.kickoff || '00:00');
  const timeDisplay = formatDateTimeDisplay(localDT);
  const leagueDisplay = getLeagueDisplayName(match.league_id, match.league_name || '', approvedLeagues);
  const score = match.home_score != null && match.home_score !== '' ? `${match.home_score} - ${match.away_score}` : '';
  const currentMinute = match.status === 'HT' ? 'HT' : (match.current_minute ? `${match.current_minute}'` : '');

  return (
    <tr>
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
            </div>
            <span className="match-vs">vs</span>
            <div className="team-info">
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
        <div className="cell-value">
          {isWatched ? (
            <div className="watch-wrapper">
              <button className="btn btn-success btn-sm watch-btn" disabled><span className="btn-text">✓ Watched</span></button>
            </div>
          ) : isPending ? (
            <div className="watch-wrapper">
              <button className="btn btn-primary btn-sm watch-btn" disabled>
                <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
                <span className="btn-text">Saving...</span>
              </button>
            </div>
          ) : (
            <div className="watch-wrapper">
              <button className="btn btn-primary btn-sm watch-btn" onClick={onQuickAdd}>
                <span className="btn-text">+&nbsp;Watch</span>
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
