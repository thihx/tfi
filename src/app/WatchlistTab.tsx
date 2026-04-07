import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { useUiLanguage } from '@/hooks/useUiLanguage';
import { useUserTimeZone } from '@/hooks/useUserTimeZone';
import { useViewMode } from '@/hooks/useViewMode';
import { Pagination } from '@/components/ui/Pagination';
import { PLACEHOLDER_HOME, PLACEHOLDER_AWAY, LIVE_STATUSES } from '@/config/constants';
import { Modal } from '@/components/ui/Modal';
import { formatDateTimeDisplay, getKickoffDateKey, getKickoffDateTime, getLeagueDisplayName, debounce } from '@/lib/utils/helpers';
import { MatchHubModal } from '@/components/ui/MatchHubModal';
import { WatchlistEditModal } from '@/components/ui/WatchlistEditModal';
import { WatchlistCard } from '@/components/ui/WatchlistCard';
import { getDateGroupLabelInTimeZone, getDateKeyAtOffsetInTimeZone } from '@/lib/utils/timezone';
import type { WatchlistItem, SortState } from '@/types';

const PAGE_SIZE = 30;

export function WatchlistTab() {
  const { state, updateWatchlistItem, removeFromWatchlist } = useAppState();
  const { showToast } = useToast();
  const uiLanguage = useUiLanguage();
  const { effectiveTimeZone } = useUserTimeZone();
  const { watchlist, matches, leagues, config } = state;

  const [search, setSearch] = useState('');
  const [leagueFilter, setLeagueFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ column: 'kickoff', order: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useViewMode('viewMode:watchlist');

  const searchRef = useRef<HTMLInputElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [filterBarBottom, setFilterBarBottom] = useState(240);

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

  useEffect(() => {
    const el = filterBarRef.current;
    if (!el) return;
    const measure = () => {
      const scrollParent = el.closest('[style*="overflow"]') as HTMLElement | null;
      if (scrollParent) {
        const containerRect = scrollParent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const b = elRect.bottom - containerRect.top;
        if (b > 0) setFilterBarBottom(b);
      } else {
        const b = el.getBoundingClientRect().bottom;
        if (b > 0) setFilterBarBottom(b);
      }
    };
    // Wait for DOM layout to settle before first measurement
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // Edit modal state
  const [editItem, setEditItem] = useState<WatchlistItem | null>(null);

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
  const [scoutItem, setScoutItem] = useState<WatchlistItem | null>(null);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debouncedSetSearch = useRef(debounce((v: string) => setDebouncedSearch(v), 250)).current;

  // League options for filter (top leagues first)
  const leagueOptions = useMemo(() => {
    const topIds = new Set(leagues.filter((l) => l.top_league).map((l) => String(l.league_id)));
    const map = new Map<string, { id: string; displayName: string; count: number; isTop: boolean }>();
    watchlist.forEach((i) => {
      let leagueId = i.league_id;
      if (!leagueId && i.match_id) {
        const m = matches.find((x) => String(x.match_id) === String(i.match_id));
        if (m) leagueId = m.league_id;
      }
      if (!leagueId) return;
      const key = String(leagueId);
      if (!map.has(key)) {
        map.set(key, { id: key, displayName: getLeagueDisplayName(leagueId, i.league_name || i.league || '', leagues), count: 0, isTop: topIds.has(key) });
      }
      map.get(key)!.count++;
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.isTop !== b.isTop) return a.isTop ? -1 : 1;
      return b.count - a.count;
    });
  }, [watchlist, matches, leagues]);

  // Filtered & sorted
  const filtered = useMemo(() => {
    let items = [...watchlist];
    if (statusFilter) {
      items = items.filter((i) => (i.status || 'active') === statusFilter);
    }
    if (debouncedSearch) {
      const s = debouncedSearch.toLowerCase();
      items = items.filter((i) => `${i.home_team || ''} ${i.away_team || ''} ${i.league || ''}`.toLowerCase().includes(s));
    }
    if (leagueFilter) {
      items = items.filter((i) => {
        let lid = i.league_id;
        if (!lid && i.match_id) { const m = matches.find((x) => String(x.match_id) === String(i.match_id)); if (m) lid = m.league_id; }
        return String(lid) === leagueFilter;
      });
    }
    if (dateFrom || dateTo) {
      items = items.filter((i) => {
        const iso = getKickoffDateKey(i, effectiveTimeZone);
        if (!iso) return false;
        if (dateFrom && iso < dateFrom) return false;
        if (dateTo && iso > dateTo) return false;
        return true;
      });
    }

    if (sort.column) {
      items.sort((a, b) => {
        let valA: string | number | Date, valB: string | number | Date;
        switch (sort.column) {
          case 'kickoff':
            valA = getKickoffDateTime(a);
            valB = getKickoffDateTime(b);
            break;
          case 'league': valA = (a.league || '').toLowerCase(); valB = (b.league || '').toLowerCase(); break;
          case 'match': valA = `${a.home_team} vs ${a.away_team}`.toLowerCase(); valB = `${b.home_team} vs ${b.away_team}`.toLowerCase(); break;
          case 'mode': valA = a.mode || ''; valB = b.mode || ''; break;
          case 'priority': valA = parseInt(String(a.priority)) || 0; valB = parseInt(String(b.priority)) || 0; break;
          case 'status': valA = (a.status || '').toLowerCase(); valB = (b.status || '').toLowerCase(); break;
          default: return 0;
        }
        if (valA < valB) return sort.order === 'asc' ? -1 : 1;
        if (valA > valB) return sort.order === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [watchlist, debouncedSearch, leagueFilter, statusFilter, dateFrom, dateTo, sort, matches, effectiveTimeZone]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSort = (col: string) => {
    setSort((prev) => ({ column: col, order: prev.column === col && prev.order === 'asc' ? 'desc' : 'asc' }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearch(''); setDebouncedSearch(''); setLeagueFilter(''); setStatusFilter('active'); setDateFrom(''); setDateTo('');
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    debouncedSetSearch(value);
    setPage(1);
  };

  const handleLeagueFilterChange = (value: string) => {
    setLeagueFilter(value);
    setPage(1);
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    setPage(1);
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    setPage(1);
  };

  const toggleSelect = (mid: string) => {
    setSelected((prev) => { const s = new Set(prev); if (s.has(mid)) s.delete(mid); else s.add(mid); return s; });
  };

  const toggleSelectAll = () => {
    const ids = pageItems.map((i) => String(i.match_id));
    const allSel = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const s = new Set(prev);
      if (allSel) ids.forEach((id) => s.delete(id)); else ids.forEach((id) => s.add(id));
      return s;
    });
  };

  const openEdit = (item: WatchlistItem) => setEditItem(item);

  const handleDeleteSingle = (mid: string) => {
    setDeleteConfirm([mid]);
  };

  const handleDeleteSelected = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) { showToast('No items selected', 'info'); return; }
    setDeleteConfirm(ids);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const ok = await removeFromWatchlist(deleteConfirm);
    if (ok) {
      showToast(`Deleted ${deleteConfirm.length} item(s)`, 'success');
      setSelected((prev) => { const s = new Set(prev); deleteConfirm.forEach((id) => s.delete(id)); return s; });
    } else {
      showToast('Failed to delete', 'error');
    }
    setDeleteConfirm(null);
  };

  const sortIndicator = (col: string) => sort.column === col ? (sort.order === 'asc' ? '▲' : '▼') : '';
  const allPageSelected = pageItems.length > 0 && pageItems.every((i) => selected.has(String(i.match_id)));

  // Date tab shortcuts
  const dateToday = getDateKeyAtOffsetInTimeZone(0, effectiveTimeZone);
  const dateTomorrow = getDateKeyAtOffsetInTimeZone(1, effectiveTimeZone);
  const activeDateTab =
    dateFrom === dateToday    && dateTo === dateToday    ? 'today'
    : dateFrom === dateTomorrow && dateTo === dateTomorrow ? 'tomorrow'
    : (!dateFrom && !dateTo) ? 'all'
    : 'custom';
  const tabBtn = (active: boolean) => ({
    fontWeight: active ? 600 : 400,
    background: active ? 'var(--gray-800)' : 'transparent',
    borderColor: active ? 'var(--gray-800)' : 'var(--gray-300)',
    color: active ? '#fff' : 'var(--gray-500)',
  } as React.CSSProperties);

  // Get team logos: prefer logos stored on the watchlist item, fall back to live matches data
  const getLogos = (matchId: string, item?: { home_logo?: string; away_logo?: string }) => {
    const m = matches.find((x) => String(x.match_id) === matchId);
    return {
      home: item?.home_logo || m?.home_logo || PLACEHOLDER_HOME,
      away: item?.away_logo || m?.away_logo || PLACEHOLDER_AWAY,
    };
  };

  return (
    <>
      <div className="card" style={{ '--group-sticky-top': `${filterBarBottom}px`, '--filter-bar-bottom': `${filterBarBottom}px` } as React.CSSProperties}>
        {/* Sticky filter bar */}
        <div className="sticky-filter-bar" ref={filterBarRef}>
        {/* Date tab shortcuts */}
        <div className="date-tab-bar">
          <button style={tabBtn(activeDateTab === 'all')} onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>All</button>
          <button style={tabBtn(activeDateTab === 'today')} onClick={() => { setDateFrom(dateToday); setDateTo(dateToday); setPage(1); }}>Today</button>
          <button style={tabBtn(activeDateTab === 'tomorrow')} onClick={() => { setDateFrom(dateTomorrow); setDateTo(dateTomorrow); setPage(1); }}>Tomorrow</button>
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--gray-400)' }}>{filtered.length} items</span>
        </div>
        {/* Toolbar: filters + view toggle */}
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <div className="filters" style={{ flex: 1, borderBottom: 'none' }}>
            <input ref={searchRef} type="text" className="filter-input" placeholder="Search teams… ( / )" value={search} onChange={(e) => handleSearchChange(e.target.value)} />
            <select className="filter-input" value={leagueFilter} onChange={(e) => handleLeagueFilterChange(e.target.value)}>
              <option value="">All Leagues</option>
              {leagueOptions.map((l) => <option key={l.id} value={l.id}>{l.displayName} ({l.count})</option>)}
            </select>
            <select className="filter-input" value={statusFilter} onChange={(e) => handleStatusFilterChange(e.target.value)}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
            </select>
            <DatePicker className="filter-input" value={dateFrom} onChange={handleDateFromChange} title="From date" placeholder="From date" />
            <DatePicker className="filter-input" value={dateTo} onChange={handleDateToChange} title="To date" placeholder="To date" />
            <button className="btn btn-secondary" onClick={clearFilters}>Clear Filters</button>
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
        {totalPages > 1 && (
          <div style={{ borderTop: '1px solid var(--gray-100)' }}>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
        {/* Contextual delete strip — docked inside sticky bar */}
        {viewMode === 'table' && selected.size > 0 && (
          <div style={{ padding: '7px 16px', background: '#fff1f2', borderTop: '1px solid #fca5a5', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--gray-600)' }}>{selected.size} selected</span>
            <button className="btn btn-danger btn-sm" onClick={handleDeleteSelected}>Delete Selected</button>
            <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
        </div>

        {/* Card view */}
        {viewMode === 'cards' && (
          <div style={{ padding: '16px' }}>
            {pageItems.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)' }}>
                <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>
                <p>{debouncedSearch || leagueFilter || (statusFilter && statusFilter !== 'active') || dateFrom || dateTo ? 'No matches found for your filters' : 'Your watchlist is empty'}</p>
                {!debouncedSearch && !leagueFilter && statusFilter === 'active' && !dateFrom && !dateTo && (
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => window.dispatchEvent(new CustomEvent('tfi:navigate', { detail: 'matches' }))}>Browse Matches</button>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '12px' }}>
                {pageItems.map((item) => {
                  const logos = getLogos(String(item.match_id), item);
                  const localDT = getKickoffDateTime(item);
                  const timeDisplay = formatDateTimeDisplay(localDT);
                  let leagueId = item.league_id;
                  const liveMatch = matches.find((x) => String(x.match_id) === String(item.match_id));
                  if (!leagueId && liveMatch) leagueId = liveMatch.league_id;
                  const leagueDisplay = getLeagueDisplayName(leagueId || '', item.league_name || item.league || '', leagues);
                  return (
                    <WatchlistCard
                      key={item.match_id}
                      item={item}
                      liveMatch={liveMatch}
                      homeLogo={logos.home}
                      awayLogo={logos.away}
                      timeDisplay={timeDisplay}
                      leagueDisplay={leagueDisplay}
                      onEdit={() => openEdit(item)}
                      onDelete={() => handleDeleteSingle(String(item.match_id))}
                      onDoubleClick={() => setScoutItem(item)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {viewMode === 'table' && <div className="table-container table-cards" style={{ '--group-sticky-top': `${filterBarBottom}px` } as React.CSSProperties}>
          <table>
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('kickoff')}>Time {sortIndicator('kickoff')}</th>
                <th style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => handleSort('league')}>League {sortIndicator('league')}</th>
                <th style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => handleSort('match')}>Match {sortIndicator('match')}</th>
                <th style={{ width: 40, textAlign: 'center' }}>
                  <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} />
                </th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('mode')}>Mode {sortIndicator('mode')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('priority')}>Priority {sortIndicator('priority')}</th>
                <th style={{ textAlign: 'center' }}>Prediction</th>
                <th style={{ textAlign: 'center' }}>Condition</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr><td colSpan={10} className="empty-state">
                  <div className="empty-state-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>
                  <p>{debouncedSearch || leagueFilter || (statusFilter && statusFilter !== 'active') || dateFrom || dateTo ? 'No matches found for your filters' : 'Your watchlist is empty'}</p>
                  {!debouncedSearch && !leagueFilter && statusFilter === 'active' && !dateFrom && !dateTo && (
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: 8 }}
                      onClick={() => window.dispatchEvent(new CustomEvent('tfi:navigate', { detail: 'matches' }))}
                    >
                      Browse Matches
                    </button>
                  )}
                </td></tr>
              ) : (() => {
                const rows: React.ReactNode[] = [];
                let lastLabel = '';
                pageItems.forEach((item) => {
                const logos = getLogos(String(item.match_id), item);
                const localDT = getKickoffDateTime(item);
                const timeDisplay = formatDateTimeDisplay(localDT);
                const dateLabel = getDateGroupLabelInTimeZone(localDT, effectiveTimeZone);
                if (dateLabel !== lastLabel) {
                  lastLabel = dateLabel;
                  rows.push(<tr key={`grp-${dateLabel}`} className="date-group-row"><td colSpan={10}>{dateLabel}</td></tr>);
                }
                let leagueId = item.league_id;
                const liveMatchRow = matches.find((x) => String(x.match_id) === String(item.match_id));
                if (!leagueId && liveMatchRow) leagueId = liveMatchRow.league_id;
                const leagueDisplay = getLeagueDisplayName(leagueId || '', item.league_name || item.league || '', leagues);
                const isLiveRow = liveMatchRow ? LIVE_STATUSES.includes(liveMatchRow.status) : false;

                const modeColors: Record<string, { bg: string; color: string }> = { A: { bg: 'var(--gray-100)', color: 'var(--gray-700)' }, B: { bg: 'var(--gray-100)', color: 'var(--gray-700)' }, C: { bg: 'var(--gray-100)', color: 'var(--gray-700)' } };
                const mc = modeColors[item.mode] || modeColors.B!;
                const p = Math.max(1, Math.min(3, parseInt(String(item.priority)) || 2));

                rows.push(
                  <tr key={item.match_id} onDoubleClick={() => setScoutItem(item)} className={isLiveRow ? 'match-is-live' : undefined} style={{ cursor: 'pointer' }} title="Double-click to view match details">
                    <td data-label="Time" style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                      <div className="cell-value">
                        <span style={{ background: 'var(--gray-200)', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, color: 'var(--gray-900)', fontSize: '13px' }}>{timeDisplay}</span>
                      </div>
                    </td>
                    <td data-label="League" style={{ textAlign: 'center' }}><div className="cell-value"><span style={{ fontWeight: 400 }}>{leagueDisplay}</span></div></td>
                    <td data-label="Match" style={{ textAlign: 'center' }}>
                      <div className="cell-value match-cell">
                        <div className="match-teams">
                          <div className="team-info">
                            <img src={logos.home} loading="lazy" className="team-logo" onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_HOME; }} alt={item.home_team} />
                            <span style={{ fontWeight: 400 }}>{item.home_team}</span>
                          </div>
                          <span className="match-vs">vs</span>
                          <div className="team-info">
                            <span style={{ fontWeight: 400 }}>{item.away_team}</span>
                            <img src={logos.away} loading="lazy" className="team-logo" onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_AWAY; }} alt={item.away_team} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="select-col" data-label="Select">
                      <div className="cell-value">
                        <input type="checkbox" checked={selected.has(String(item.match_id))} onChange={() => toggleSelect(String(item.match_id))} />
                      </div>
                    </td>
                    <td data-label="Mode"><div className="cell-value"><span className="badge" style={{ background: mc.bg, color: mc.color }}>{item.mode}</span></div></td>
                    <td data-label="Priority" style={{ textAlign: 'center' }}><div className="cell-value" style={{ fontSize: '12px', color: 'var(--gray-600)', fontWeight: 500 }}>P{p}</div></td>
                    <td data-label="Prediction" style={{ textAlign: 'center' }}><div className="cell-value"><PredictionCell prediction={item.prediction} /></div></td>
                    <td data-label="Condition" style={{ textAlign: 'center' }}><div className="cell-value"><small style={{ whiteSpace: 'normal' }}>{item.custom_conditions || '-'}</small></div></td>
                    <td data-label="Status" className="status-cell" style={{ textAlign: 'center' }}>
                      <div className="cell-value">
                        {item.status === 'pending'
                          ? <span className="badge" style={{ background: 'var(--gray-100)', color: '#b45309', border: '1px solid #fde68a' }}>Pending</span>
                          : <span className="badge" style={{ background: 'var(--gray-100)', color: '#15803d', border: '1px solid #d1fae5' }}>Active</span>}
                      </div>
                    </td>
                    <td data-label="Actions" style={{ textAlign: 'center' }}>
                      <div className="cell-value">
                        <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                          <button className="btn btn-secondary btn-sm action-icon-btn" onClick={() => openEdit(item)} aria-label="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                          </button>
                          <button className="btn btn-secondary btn-sm btn-delete-row action-icon-btn" onClick={() => handleDeleteSingle(String(item.match_id))} aria-label="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              });
              return rows;
            })()}
            </tbody>
          </table>
        </div>}
      </div>

      {/* Edit Modal */}
      <WatchlistEditModal
        key={editItem ? String(editItem.match_id) : 'watchlist-edit-modal'}
        item={editItem}
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

      {/* Match Scout Modal */}
      {scoutItem && (() => {
        const m = matches.find((x) => String(x.match_id) === String(scoutItem.match_id));
        let leagueId = scoutItem.league_id;
        if (!leagueId && m) leagueId = m.league_id;
        return (
          <MatchHubModal
            open
            matchId={String(scoutItem.match_id)}
            matchDisplay={`${scoutItem.home_team ?? ''} vs ${scoutItem.away_team ?? ''}`}
            homeTeam={scoutItem.home_team ?? ''}
            awayTeam={scoutItem.away_team ?? ''}
            homeLogo={scoutItem.home_logo || m?.home_logo}
            awayLogo={scoutItem.away_logo || m?.away_logo}
            leagueName={scoutItem.league_name || scoutItem.league || ''}
            leagueId={leagueId ?? undefined}
            status={m?.status}
            homeTeamId={m?.home_team_id ?? undefined}
            awayTeamId={m?.away_team_id ?? undefined}
            onClose={() => setScoutItem(null)}
          />
        );
      })()}

      {/* Delete Confirm Modal */}
      <Modal
        open={!!deleteConfirm}
        title="Confirm Delete"
        onClose={() => setDeleteConfirm(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={confirmDelete}>Delete</button>
          </>
        }
      >
        <p>Are you sure you want to delete {deleteConfirm?.length || 0} item(s)?</p>
      </Modal>
    </>
  );
}

function PredictionCell({ prediction }: { prediction?: string }) {
  if (!prediction) return <div className="prediction-empty">-</div>;
  try {
    const pred = typeof prediction === 'string' ? JSON.parse(prediction) : prediction;
    if (!pred?.predictions) return <div className="prediction-empty">N/A</div>;
    const p = pred.predictions;
    const homePercent = parseInt(p.percent?.home) || 0;
    const drawPercent = parseInt(p.percent?.draw) || 0;
    const awayPercent = parseInt(p.percent?.away) || 0;
    const winnerName = p.winner?.name || 'N/A';
    const winnerShort = winnerName.length > 18 ? winnerName.substring(0, 15) + '...' : winnerName;
    const winnerClass = winnerName.toLowerCase().includes('draw') ? 'draw' : homePercent > awayPercent ? 'home' : 'away';
    const underOverBadge = p.under_over ? <span className="pred-tag">⚽ {p.under_over}</span> : null;

    return (
      <details className="pred-card">
        <summary>
          <div className="pred-box">
            <div className="pred-row">
              <span className={`pred-winner ${winnerClass}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg> {winnerShort}</span>
              {underOverBadge}
            </div>
            <div className="pred-bar">
              {homePercent > 0 && <div className="pred-seg home" style={{ width: `${homePercent}%` }} />}
              {drawPercent > 0 && <div className="pred-seg draw" style={{ width: `${drawPercent}%` }} />}
              {awayPercent > 0 && <div className="pred-seg away" style={{ width: `${awayPercent}%` }} />}
            </div>
            <div className="pred-percent">{homePercent}% | {drawPercent}% | {awayPercent}%</div>
          </div>
        </summary>
        <div className="pred-details">
          <div className="pred-detail-section">
            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> Predictions:</strong>
            <div className="pred-detail-item"><span>Winner:</span> <span>{winnerName}</span></div>
            <div className="pred-detail-item"><span>Advice:</span> <span>{p.advice || 'No advice'}</span></div>
            <div className="pred-detail-item"><span>Win %:</span> <span>{homePercent}% | {drawPercent}% | {awayPercent}%</span></div>
          </div>
        </div>
      </details>
    );
  } catch {
    return <div className="prediction-empty">Error</div>;
  }
}
