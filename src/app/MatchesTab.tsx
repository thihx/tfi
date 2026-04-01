import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { useUiLanguage } from '@/hooks/useUiLanguage';
import { useUserTimeZone } from '@/hooks/useUserTimeZone';
import { useViewMode } from '@/hooks/useViewMode';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AiAnalysisPanel, type AiAnalysisPanelEntry } from '@/components/ui/AiAnalysisPanel';
import { MatchCard } from '@/components/ui/MatchCard';
import { WatchlistEditModal } from '@/components/ui/WatchlistEditModal';
import { LIVE_STATUSES, PLACEHOLDER_HOME, PLACEHOLDER_AWAY } from '@/config/constants';
import { formatDateTimeDisplay, getKickoffDateKey, getKickoffDateTime, getLeagueDisplayName, debounce, parseKickoffForSave, shouldFastRefreshMatch, normalizeToISO } from '@/lib/utils/helpers';
import { getDateGroupLabelInTimeZone, getDateKeyAtOffsetInTimeZone, getMatchDateKeyInTimeZone } from '@/lib/utils/timezone';
import type { Match, SortState, League, WatchlistItem } from '@/types';
import {
  analyzeMatchWithServerPipeline,
  getParsedAiResult,
} from '@/features/live-monitor/services/server-monitor.service';
import { MatchScoutModal } from '@/components/ui/MatchScoutModal';

// ── Shared icon components ───────────────────────────────────────────────────
function EyeIcon({ checked }: { checked?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
      {checked && <path d="M9 12l2 2 4-4" strokeWidth="2.5"/>}
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z"/>
      <path d="M19 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z"/>
      <path d="M5 17l.6 1.4L7 19l-1.4.6L5 21l-.6-1.4L3 19l1.4-.6L5 17z"/>
    </svg>
  );
}

// ── Module-level store — persists across tab navigation ──────────────────────
type AiResultEntry = AiAnalysisPanelEntry;
const _matchesTabStore = {
  analyzingMatches: new Set<string>(),
  aiResults: new Map<string, AiResultEntry>(),
};

const PAGE_SIZE = 30;

function getMatchKickoffTime(match: Match): Date {
  return getKickoffDateTime(match);
}

export function shouldAutoRefreshMatch(match: Match, now = Date.now()): boolean {
  return shouldFastRefreshMatch(match, now);
}


export function MatchesTab() {
  const { state, addToWatchlist, updateWatchlistItem, loadAllData, refreshMatches } = useAppState();
  const { showToast } = useToast();
  const uiLanguage = useUiLanguage();
  const { effectiveTimeZone } = useUserTimeZone();
  const { matches, watchlist, config, leagues } = state;
  const [editItem, setEditItem] = useState<WatchlistItem | null>(null);

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
  const [analyzingMatches, _setAnalyzingMatches] = useState<Set<string>>(() => new Set(_matchesTabStore.analyzingMatches));
  const [aiResults, _setAiResults] = useState<Map<string, AiResultEntry>>(() => new Map(_matchesTabStore.aiResults));
  const [viewMode, setViewMode] = useViewMode('viewMode:matches');
  const [scoutMatch, setScoutMatch] = useState<Match | null>(null);
  const [lastAddedResultId, setLastAddedResultId] = useState<string | null>(null);
  const aiResultsRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [filterBarBottom, setFilterBarBottom] = useState(160);

  useEffect(() => {
    const el = filterBarRef.current;
    if (!el) return;
    const update = () => {
      const b = el.getBoundingClientRect().bottom;
      if (b > 0) setFilterBarBottom(b);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wrapped setters that sync state back to the module-level store
  const setAnalyzingMatches = useCallback((fn: (prev: Set<string>) => Set<string>) => {
    _setAnalyzingMatches((prev) => {
      const next = fn(prev);
      _matchesTabStore.analyzingMatches = next;
      return next;
    });
  }, []);
  const setAiResults = useCallback((fn: (prev: Map<string, AiResultEntry>) => Map<string, AiResultEntry>) => {
    _setAiResults((prev) => {
      const next = fn(prev);
      _matchesTabStore.aiResults = next;
      return next;
    });
  }, []);

  // Auto-scroll to result panel after DOM has updated
  useEffect(() => {
    if (!lastAddedResultId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`ai-result-${lastAddedResultId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        el.style.outline = '2px solid var(--primary)';
        setTimeout(() => { el.style.outline = ''; }, 1500);
      }
      setLastAddedResultId(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [lastAddedResultId]);

  const loadAllDataRef = useRef(loadAllData);
  useEffect(() => { loadAllDataRef.current = loadAllData; });

  const refreshMatchesRef = useRef(refreshMatches);
  useEffect(() => { refreshMatchesRef.current = refreshMatches; });

  // Ref to ALL loaded matches — used by interval to detect live activity across all pages/filters
  const allMatchesRef = useRef<Match[]>([]);

  // ── Live flash ─────────────────────────────────────────────────────────────
  // flashMap: key → generation counter; incrementing forces CSS animation restart via `key` prop
  const [flashMap, setFlashMap] = useState<Map<string, number>>(new Map());
  const prevMatchesRef = useRef<Map<string, Match>>(new Map());
  // Per-key cleanup timers: new event for same key cancels the previous timer.
  const flashTidsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const prevMap = prevMatchesRef.current;

    if (prevMap.size > 0) {
      const changes: string[] = [];

      matches.forEach((m) => {
        const prev = prevMap.get(m.match_id);
        if (!prev || !LIVE_STATUSES.includes(m.status)) return;

        // Score: only flash when a valid numeric score strictly increases
        const toScore = (v: string | number | null | undefined): number | null => {
          if (v == null || v === '') return null;
          const n = Number(v);
          return Number.isFinite(n) && n >= 0 ? n : null;
        };
        const pH = toScore(prev.home_score), nH = toScore(m.home_score);
        const pA = toScore(prev.away_score), nA = toScore(m.away_score);
        if ((pH !== null && nH !== null && nH > pH) || (pA !== null && nA !== null && nA > pA)) {
          changes.push(`${m.match_id}:score`);
        }

        // Cards: flash when count increases (treat null as 0)
        const cardUp = (p: number | null | undefined, n: number | null | undefined) =>
          (n ?? 0) > (p ?? 0) && (n ?? 0) > 0;
        if (cardUp(prev.home_yellows, m.home_yellows)) changes.push(`${m.match_id}:hy`);
        if (cardUp(prev.away_yellows, m.away_yellows)) changes.push(`${m.match_id}:ay`);
        if (cardUp(prev.home_reds,    m.home_reds))    changes.push(`${m.match_id}:hr`);
        if (cardUp(prev.away_reds,    m.away_reds))    changes.push(`${m.match_id}:ar`);
      });

      if (changes.length > 0) {
        setFlashMap((prev) => {
          const next = new Map(prev);
          changes.forEach((k) => next.set(k, (next.get(k) ?? 0) + 1));
          return next;
        });
        // Per-key cleanup: if the same event fires again before the 8s window,
        // cancel the previous timer and start a fresh 8s window for that key.
        changes.forEach((k) => {
          const existing = flashTidsRef.current.get(k);
          if (existing !== undefined) clearTimeout(existing);
          const tid = setTimeout(() => {
            setFlashMap((prev) => {
              const next = new Map(prev);
              next.delete(k);
              return next;
            });
            flashTidsRef.current.delete(k);
          }, 8000);
          flashTidsRef.current.set(k, tid);
        });
      }
    }

    prevMatchesRef.current = new Map(matches.map((m) => [m.match_id, m]));
  }, [matches]);

  // Clean up flash timeouts on unmount
  useEffect(() => () => { flashTidsRef.current.forEach(clearTimeout); flashTidsRef.current.clear(); }, []);

  // Refresh on mount
  useEffect(() => { void loadAllDataRef.current(true); }, []);

  // Every 3s: merge-refresh only matches (not leagues/watchlist) to avoid full re-render
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      const hasLikelyLive = allMatchesRef.current.some((m) => shouldAutoRefreshMatch(m, now));
      if (hasLikelyLive) void refreshMatchesRef.current();
    }, 3000);
    return () => clearInterval(tick);
  }, []);

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
        const iso = getMatchDateKeyInTimeZone(m.date, m.kickoff || '00:00', effectiveTimeZone) ?? normalizeToISO(m.date);
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
            valA = getMatchKickoffTime(a);
            valB = getMatchKickoffTime(b);
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
        // Stable tiebreaker: match_id prevents position swaps between polls
        return String(a.match_id) < String(b.match_id) ? -1 : 1;
      });
    }
    return items;
  }, [matches, debouncedSearch, statusFilter, leagueFilter, actionFilter, dateFrom, dateTo, sort, watchlistMap, effectiveTimeZone]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  allMatchesRef.current = matches; // keep ref in sync so interval checks across all pages/filters

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
    showToast('Filters cleared', 'success');
  };

  const quickAdd = useCallback(async (m: Match) => {
    const mid = String(m.match_id);
    if (watchlistMap.has(mid)) { showToast('Already in watchlist', 'success'); return; }
    if (pendingAdds.has(mid)) { showToast('Saving... (already in progress)', 'info'); return; }

    setPendingAdds((prev) => new Set(prev).add(mid));
    showToast('Added to watchlist (saving...)', 'success');

    const ok = await addToWatchlist([{
      match_id: mid, date: m.date, league: m.league_name || '', home_team: m.home_team,
      away_team: m.away_team, kickoff: parseKickoffForSave(m.kickoff),
    }]);

    setPendingAdds((prev) => { const s = new Set(prev); s.delete(mid); return s; });
    if (!ok) showToast('Failed to add to watchlist', 'error');
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
      showToast(`${m.home_team} vs ${m.away_team} — showing cached result`, 'info');
      return;
    }

    if (!watchlistMap.has(mid)) {
      showToast('Add this match to Watchlist before using Ask AI', 'info');
      return;
    }

    setAnalyzingMatches((prev) => new Set(prev).add(mid));
    showToast(`Analyzing ${m.home_team} vs ${m.away_team}...`, 'info');

    try {
      const matchResult = await analyzeMatchWithServerPipeline(config, mid);
      if (matchResult) {
        const parsed = getParsedAiResult(matchResult);
        setAiResults((prev) => new Map(prev).set(mid, { matchId: mid, matchDisplay: `${m.home_team} vs ${m.away_team}`, result: matchResult }));
        setLastAddedResultId(mid);
        if (parsed && matchResult.error) {
          showToast(`${m.home_team} vs ${m.away_team} — AI done but: ${matchResult.error}`, 'error');
        } else if (parsed) {
          showToast(`${m.home_team} vs ${m.away_team} — done`, 'success');
        } else if (matchResult.error) {
          showToast(`${m.home_team} vs ${m.away_team} error: ${matchResult.error}`, 'error');
        } else {
          showToast(`${m.home_team} vs ${m.away_team} skipped by filters`, 'info');
        }
      } else {
        showToast(`${m.home_team} vs ${m.away_team} — no results`, 'info');
      }
    } catch (err) {
      showToast(`${m.home_team} vs ${m.away_team} failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setAnalyzingMatches((prev) => { const s = new Set(prev); s.delete(mid); return s; });
    }
  }, [analyzingMatches, aiResults, watchlistMap, config, showToast, setAiResults, setAnalyzingMatches]);

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
    if (ok) { setSelected(new Set()); showToast(`Added ${items.length} to watchlist`, 'success'); }
    else showToast('Failed to add selected', 'error');
  };

  const sortIndicator = (col: string) => (sort.column === col ? (sort.order === 'asc' ? '▲' : '▼') : '');

  const enabledOnPage = pageItems.filter((m) => !watchlistMap.has(String(m.match_id)));
  const allPageSelected = enabledOnPage.length > 0 && enabledOnPage.every((m) => selected.has(String(m.match_id)));

  // Date tab shortcuts
  const dateToday = getDateKeyAtOffsetInTimeZone(0, effectiveTimeZone);
  const dateTomorrow = getDateKeyAtOffsetInTimeZone(1, effectiveTimeZone);
  const dateYesterday = getDateKeyAtOffsetInTimeZone(-1, effectiveTimeZone);
  const hasYesterday = matches.some((m) => {
    const iso = getKickoffDateKey(m, effectiveTimeZone);
    return iso === dateYesterday;
  });
  const activeDateTab =
    dateFrom === dateToday    && dateTo === dateToday    ? 'today'
    : dateFrom === dateTomorrow && dateTo === dateTomorrow ? 'tomorrow'
    : dateFrom === dateYesterday && dateTo === dateYesterday ? 'yesterday'
    : (!dateFrom && !dateTo) ? 'all'
    : 'custom';
  const tabBtn = (active: boolean) => ({
    padding: '10px 10px', lineHeight: '1.6', minHeight: '32px', display: 'flex', alignItems: 'center', borderRadius: '12px', border: '1px solid',
    cursor: 'pointer', fontSize: '12px', fontWeight: active ? 600 : 400,
    background: active ? 'var(--gray-800)' : 'transparent',
    borderColor: active ? 'var(--gray-800)' : 'var(--gray-300)',
    color: active ? '#fff' : 'var(--gray-500)',
  } as React.CSSProperties);

  // Filter badges
  const badges = [];
  if (debouncedSearch) badges.push(`Teams: ${debouncedSearch}`);
  if (statusFilter) badges.push(`Status: ${statusFilter}`);
  if (leagueFilter) { const op = leagueOptions.find((l) => l.id === leagueFilter); badges.push(`League: ${op?.displayName || leagueFilter}`); }
  if (dateFrom || dateTo) badges.push(`Date: ${dateFrom || '—'} → ${dateTo || '—'}`);

  return (
    <div className="card" style={{ '--group-sticky-top': `${filterBarBottom}px` } as React.CSSProperties}>
      {/* Sticky filter bar */}
      <div className="sticky-filter-bar" ref={filterBarRef}>
        {/* Date tab shortcuts */}
        <div style={{ display: 'flex', gap: '6px', padding: '12px 12px', borderBottom: '1px solid var(--gray-100)', alignItems: 'center', flexWrap: 'wrap', overflow: 'visible', maxHeight: 'none' }}>
          <button style={tabBtn(activeDateTab === 'all')} onClick={() => { setDateFrom(''); setDateTo(''); }}>All</button>
          {hasYesterday && (
            <button style={tabBtn(activeDateTab === 'yesterday')} onClick={() => { setDateFrom(dateYesterday); setDateTo(dateYesterday); }}>Yesterday</button>
          )}
          <button style={tabBtn(activeDateTab === 'today')} onClick={() => { setDateFrom(dateToday); setDateTo(dateToday); }}>Today</button>
          <button style={tabBtn(activeDateTab === 'tomorrow')} onClick={() => { setDateFrom(dateTomorrow); setDateTo(dateTomorrow); }}>Tomorrow</button>
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--gray-400)' }}>{filtered.length} matches</span>
        </div>
        {/* Toolbar: filters + view toggle */}
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
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
          <DatePicker className="filter-input" value={dateFrom} onChange={setDateFrom} title="From date" placeholder="From date" />
          <DatePicker className="filter-input" value={dateTo} onChange={setDateTo} title="To date" placeholder="To date" />
          {(search || statusFilter || leagueFilter || actionFilter || dateFrom || dateTo) && (
            <button className="btn btn-secondary" onClick={clearFilters}>Clear</button>
          )}
        </div>
        {/* View toggle */}
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
              <button
                onClick={() => setAiResults(() => new Map())}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--gray-400)', padding: '2px 4px' }}
              >
                × Close all ({aiResults.size})
              </button>
            </div>
          )}
          {Array.from(aiResults.values()).map((entry) => (
            <AiAnalysisPanel
              key={entry.matchId}
              entry={entry}
              onClose={() => setAiResults((prev) => { const m = new Map(prev); m.delete(entry.matchId); return m; })}
            />
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
                      ? { label: 'Watched', icon: <EyeIcon checked />, title: 'Already watching', onClick: () => {}, variant: 'success', disabled: true }
                      : pendingAdds.has(String(m.match_id))
                        ? { label: 'Saving…', onClick: () => {}, disabled: true }
                        : { label: '+ Watch', icon: <EyeIcon />, title: 'Watch this match', onClick: (match) => quickAdd(match), variant: 'primary' },
                    {
                      label: analyzingMatches.has(String(m.match_id)) ? 'Analyzing…' : aiResults.has(String(m.match_id)) ? 'View Result' : 'Ask AI',
                      icon: aiResults.has(String(m.match_id)) ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> : <SparkleIcon />,
                      title: !watchlistMap.has(String(m.match_id)) ? 'Add to Watchlist to use Ask AI' : aiResults.has(String(m.match_id)) ? 'View AI result' : 'Ask AI for analysis',
                      onClick: (match) => askAi(match),
                      variant: aiResults.has(String(m.match_id)) ? 'success' as const : 'secondary' as const,
                      loading: analyzingMatches.has(String(m.match_id)),
                      disabled: analyzingMatches.has(String(m.match_id)) || !watchlistMap.has(String(m.match_id)),
                    },
                  ]}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && <div className="table-container table-cards" style={{ '--group-sticky-top': `${filterBarBottom}px` } as React.CSSProperties}>
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
            ) : (() => {
              const rows: React.ReactNode[] = [];
              let lastLabel = '';
              pageItems.forEach((m) => {
                const label = getDateGroupLabelInTimeZone(getMatchKickoffTime(m), effectiveTimeZone);
                if (label !== lastLabel) {
                  lastLabel = label;
                  rows.push(<tr key={`grp-${label}`} className="date-group-row"><td>{label}</td><td colSpan={6} /></tr>);
                }
                rows.push(
                  <MatchRow
                    key={m.match_id}
                    match={m}
                    isWatched={watchlistMap.has(String(m.match_id))}
                    isPending={pendingAdds.has(String(m.match_id))}
                    isSelected={selected.has(String(m.match_id))}
                    isAnalyzing={analyzingMatches.has(String(m.match_id))}
                    hasResult={aiResults.has(String(m.match_id))}
                    leagues={leagues}
                    flashMap={flashMap}
                    onQuickAdd={() => quickAdd(m)}
                    onToggleSelect={() => toggleSelect(String(m.match_id), watchlistMap.has(String(m.match_id)))}
                    onAskAi={() => askAi(m)}
                    onEdit={() => { const entry = watchlistMap.get(String(m.match_id)); if (entry) setEditItem(entry); }}
                    onDoubleClick={() => setScoutMatch(m)}
                  />
                );
              });
              return rows;
            })()}
          </tbody>
        </table>
      </div>}

      <WatchlistEditModal
        key={editItem ? String(editItem.match_id) : 'watchlist-edit-modal'}
        item={editItem}
        match={editItem ? matches.find((m) => String(m.match_id) === String(editItem.match_id)) ?? null : null}
        config={config}
        defaultMode={config.defaultMode}
        uiLanguage={uiLanguage}
        onClose={() => setEditItem(null)}
        onSave={async ({ mode, priority, status, custom_conditions, auto_apply_recommended_condition }) => {
          if (!editItem) return;
          const ok = await updateWatchlistItem({
            id: editItem.id,
            match_id: editItem.match_id,
            mode,
            priority,
            status,
            custom_conditions,
            auto_apply_recommended_condition,
          });
          setEditItem(null);
          if (ok) showToast('Watchlist item updated', 'success');
          else showToast('Failed to update', 'error');
        }}
      />

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
  flashMap: Map<string, number>;
  onQuickAdd: () => void;
  onToggleSelect: () => void;
  onAskAi: () => void;
  onEdit: () => void;
  onDoubleClick: () => void;
}

function MatchRow({ match, isWatched, isPending, isSelected, isAnalyzing, hasResult, leagues, flashMap, onQuickAdd, onToggleSelect, onAskAi, onEdit, onDoubleClick }: MatchRowProps) {
  const localDT = getMatchKickoffTime(match);
  const timeDisplay = formatDateTimeDisplay(localDT);
  const leagueDisplay = getLeagueDisplayName(match.league_id, match.league_name || '', leagues);
  const score = match.home_score != null && match.home_score !== '' ? `${match.home_score} - ${match.away_score}` : '';
  const currentMinute = match.status === 'HT' ? 'HT' : (match.current_minute ? `${match.current_minute}'` : '');

  const id = match.match_id;
  const scoreFlashGen   = flashMap.get(`${id}:score`) ?? 0;
  const homeYellowGen   = flashMap.get(`${id}:hy`)    ?? 0;
  const awayYellowGen   = flashMap.get(`${id}:ay`)    ?? 0;
  const homeRedGen      = flashMap.get(`${id}:hr`)    ?? 0;
  const awayRedGen      = flashMap.get(`${id}:ar`)    ?? 0;

  return (
    <tr onDoubleClick={onDoubleClick} className={LIVE_STATUSES.includes(match.status) ? 'match-is-live' : undefined} style={{ cursor: 'pointer' }} title="Double-click to view match details">
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
              {(match.home_yellows ?? 0) > 0 && <span key={homeYellowGen} title={`${match.home_yellows} yellow card(s)`} className={homeYellowGen ? 'flash-yellow-card' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, background: '#ca8a04', color: '#fff', borderRadius: 3, padding: '1px 5px', marginLeft: 4, letterSpacing: '0.3px' }}>▪ {match.home_yellows}</span>}
              {(match.home_reds ?? 0) > 0 && <span key={homeRedGen} title={`${match.home_reds} red card(s)`} className={homeRedGen ? 'flash-red-card' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, background: '#dc2626', color: '#fff', borderRadius: 3, padding: '1px 5px', marginLeft: 4, letterSpacing: '0.3px' }}>■ {match.home_reds}</span>}
            </div>
            <span className="match-vs">vs</span>
            <div className="team-info">
              {(match.away_reds ?? 0) > 0 && <span key={awayRedGen} title={`${match.away_reds} red card(s)`} className={awayRedGen ? 'flash-red-card' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, background: '#dc2626', color: '#fff', borderRadius: 3, padding: '1px 5px', marginRight: 4, letterSpacing: '0.3px' }}>■ {match.away_reds}</span>}
              {(match.away_yellows ?? 0) > 0 && <span key={awayYellowGen} title={`${match.away_yellows} yellow card(s)`} className={awayYellowGen ? 'flash-yellow-card' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700, background: '#ca8a04', color: '#fff', borderRadius: 3, padding: '1px 5px', marginRight: 4, letterSpacing: '0.3px' }}>▪ {match.away_yellows}</span>}
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
            <div key={scoreFlashGen} className={scoreFlashGen ? 'flash-goal' : undefined} style={{ fontWeight: 700, fontSize: '12px', color: 'var(--gray-900)' }}>{score}</div>
            {currentMinute && <div style={{ fontSize: '11px', color: 'var(--gray-600)', fontWeight: 500 }}>{currentMinute}</div>}
          </div>
        </div>
      </td>
      <td data-label="Status" className="status-cell" style={{ textAlign: 'center' }}>
        <div className="cell-value">
          <StatusBadge status={match.status} />
        </div>
      </td>
      <td data-label="Action" style={{ textAlign: 'center' }}>
        <div className="cell-value flex-row-gap-4 flex-center flex-wrap">
          {isWatched ? (
            <>
              <button className="btn btn-success btn-sm watch-btn" disabled title="Already watching" aria-label="Already watching"><EyeIcon checked /></button>
              <button className="btn btn-secondary btn-sm action-icon-btn" onClick={onEdit} aria-label="Edit watchlist item" title="Edit watchlist item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
              </button>
            </>
          ) : isPending ? (
            <button className="btn btn-primary btn-sm watch-btn" disabled>
              <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
            </button>
          ) : (
            <button className="btn btn-primary btn-sm watch-btn" onClick={onQuickAdd} title="Watch this match" aria-label="Watch this match">
              <EyeIcon />
            </button>
          )}
          <button className={`btn ${hasResult ? 'btn-success' : 'btn-secondary'} btn-sm action-icon-btn`} onClick={onAskAi} disabled={isAnalyzing || !isWatched} title={!isWatched ? 'Add this match to Watchlist to use Ask AI' : hasResult ? 'View cached result' : 'Ask AI for analysis'}>
            {isAnalyzing
              ? <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
              : hasResult
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                : <SparkleIcon />
            }
          </button>
        </div>
      </td>
    </tr>
  );
}
