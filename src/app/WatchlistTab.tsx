import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { useUserTimeZone } from '@/hooks/useUserTimeZone';
import { useViewMode } from '@/hooks/useViewMode';
import { Pagination } from '@/components/ui/Pagination';
import { ActiveFilterChips, type ActiveFilterChip } from '@/components/ui/ActiveFilterChips';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { PLACEHOLDER_HOME, PLACEHOLDER_AWAY, LIVE_STATUSES } from '@/config/constants';
import { Modal } from '@/components/ui/Modal';
import { formatDateTimeDisplay, getKickoffDateKey, getKickoffDateTime, getLeagueDisplayName, debounce, isNarrowTabViewport } from '@/lib/utils/helpers';
import { MatchHubModal } from '@/components/ui/MatchHubModal';
import { WatchlistEditModal } from '@/components/ui/WatchlistEditModal';
import { WatchlistCard } from '@/components/ui/WatchlistCard';
import { getDateGroupLabelInTimeZone, getDateKeyAtOffsetInTimeZone } from '@/lib/utils/timezone';
import type { WatchlistItem, SortState } from '@/types';

const PAGE_SIZE = 30;

export function WatchlistTab() {
  const { state, updateWatchlistItem, removeFromWatchlist } = useAppState();
  const { showToast } = useToast();
  const { effectiveTimeZone } = useUserTimeZone();
  const { watchlist, matches, leagues } = state;

  const [search, setSearch] = useState('');
  const [leagueFilter, setLeagueFilter] = useState('');
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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

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
          default: return 0;
        }
        if (valA < valB) return sort.order === 'asc' ? -1 : 1;
        if (valA > valB) return sort.order === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [watchlist, debouncedSearch, leagueFilter, dateFrom, dateTo, sort, matches, effectiveTimeZone]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSort = (col: string) => {
    setSort((prev) => ({ column: col, order: prev.column === col && prev.order === 'asc' ? 'desc' : 'asc' }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearch(''); setDebouncedSearch(''); setLeagueFilter(''); setDateFrom(''); setDateTo('');
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

  const hasActiveFilters = !!(search || leagueFilter || dateFrom || dateTo);
  const toolbarFilterCount = [leagueFilter, dateFrom, dateTo].filter(Boolean).length;

  const activeFilterChips = useMemo((): ActiveFilterChip[] => {
    const chips: ActiveFilterChip[] = [];
    if (debouncedSearch) {
      chips.push({
        key: 'search',
        label: `Teams: ${debouncedSearch}`,
        onRemove: () => { setSearch(''); setDebouncedSearch(''); setPage(1); },
      });
    }
    if (leagueFilter) {
      const op = leagueOptions.find((l) => l.id === leagueFilter);
      chips.push({
        key: 'league',
        label: `League: ${op?.displayName || leagueFilter}`,
        onRemove: () => { setLeagueFilter(''); setPage(1); },
      });
    }
    if (dateFrom || dateTo) {
      chips.push({
        key: 'date',
        label: `Date: ${dateFrom || '—'} → ${dateTo || '—'}`,
        onRemove: () => { setDateFrom(''); setDateTo(''); setPage(1); },
      });
    }
    return chips;
  }, [debouncedSearch, leagueFilter, dateFrom, dateTo, leagueOptions]);

  const emptyWatchlist = !debouncedSearch && !leagueFilter && !dateFrom && !dateTo;
  const emptyTitle = emptyWatchlist ? 'Your watchlist is empty' : 'No matches found for your filters';

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
      <div
        className="card tab-page-card"
        style={{ '--group-sticky-top': `${filterBarBottom}px`, '--filter-bar-bottom': `${filterBarBottom}px` } as React.CSSProperties}
      >
        {/* Sticky filter bar */}
        <div className="sticky-filter-bar" ref={filterBarRef}>
        {/* Date tab shortcuts */}
        <div className="date-tab-bar">
          <button type="button" className={`date-tab-btn${activeDateTab === 'all' ? ' date-tab-btn--active' : ''}`} onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>All</button>
          <button type="button" className={`date-tab-btn${activeDateTab === 'today' ? ' date-tab-btn--active' : ''}`} onClick={() => { setDateFrom(dateToday); setDateTo(dateToday); setPage(1); }}>Today</button>
          <button type="button" className={`date-tab-btn${activeDateTab === 'tomorrow' ? ' date-tab-btn--active' : ''}`} onClick={() => { setDateFrom(dateTomorrow); setDateTo(dateTomorrow); setPage(1); }}>Tomorrow</button>
          <span className="date-tab-bar__meta">{filtered.length} items</span>
        </div>
        <div className="page-toolbar">
          <div className="page-toolbar__filters filters tab-page-toolbar-filters">
            <input ref={searchRef} id="watchlist-filter-search" type="text" className="filter-input" placeholder="Search teams… ( / )" value={search} onChange={(e) => handleSearchChange(e.target.value)} />
            <button
              type="button"
              className="btn btn-secondary tab-filter-sheet-btn tab-toolbar-mobile-only"
              onClick={() => setFilterSheetOpen(true)}
              aria-label={`Open filters${toolbarFilterCount > 0 ? `, ${toolbarFilterCount} active` : ''}`}
            >
              Filters{toolbarFilterCount > 0 ? ` (${toolbarFilterCount})` : ''}
            </button>
            <div className="tab-page-filters-inline">
            <select id="watchlist-filter-league" className="filter-input" value={leagueFilter} onChange={(e) => handleLeagueFilterChange(e.target.value)}>
              <option value="">All Leagues</option>
              {leagueOptions.map((l) => <option key={l.id} value={l.id}>{l.displayName} ({l.count})</option>)}
            </select>
            <DatePicker id="watchlist-filter-from" className="filter-input" value={dateFrom} onChange={handleDateFromChange} title="From date" placeholder="From date" />
            <DatePicker id="watchlist-filter-to" className="filter-input" value={dateTo} onChange={handleDateToChange} title="To date" placeholder="To date" />
            {hasActiveFilters && (
              <button className="btn btn-secondary" onClick={clearFilters}>Clear Filters</button>
            )}
            </div>
          </div>
          <div className="page-toolbar__actions">
            <ViewToggle mode={viewMode} onModeChange={setViewMode} />
          </div>
        </div>
        <ActiveFilterChips chips={activeFilterChips} onClearAll={clearFilters} />
        {totalPages > 1 && (
          <div className="page-toolbar__footer">
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
        {viewMode === 'table' && selected.size > 0 && (
          <BulkActionBar count={selected.size} variant="danger" onClear={() => setSelected(new Set())}>
            <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteSelected}>Delete Selected</button>
          </BulkActionBar>
        )}
        </div>

        {/* Card view */}
        {viewMode === 'cards' && (
          <div className="tab-panel tab-panel--cards">
            {pageItems.length === 0 ? (
              <EmptyState
                title={emptyTitle}
                action={emptyWatchlist ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => window.dispatchEvent(new CustomEvent('tfi:navigate', { detail: 'matches' }))}
                  >
                    Browse Matches
                  </button>
                ) : undefined}
              />
            ) : (
              <div className="card-grid">
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
                      onOpenHub={() => setScoutItem(item)}
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
                <th className="data-table__th--sortable" onClick={() => handleSort('kickoff')}>Time {sortIndicator('kickoff')}</th>
                <th className="data-table__th--sortable data-table__th--center" onClick={() => handleSort('league')}>League {sortIndicator('league')}</th>
                <th className="data-table__th--sortable data-table__th--center" onClick={() => handleSort('match')}>Match {sortIndicator('match')}</th>
                <th className="data-table__th--checkbox">
                  <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} aria-label="Select all on page" />
                </th>
                <th className="data-table__th--center">Condition</th>
                <th className="data-table__th--center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr><td colSpan={6}>
                  <EmptyState
                    title={emptyTitle}
                    action={emptyWatchlist ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => window.dispatchEvent(new CustomEvent('tfi:navigate', { detail: 'matches' }))}
                      >
                        Browse Matches
                      </button>
                    ) : undefined}
                  />
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
                  rows.push(<tr key={`grp-${dateLabel}`} className="date-group-row"><td colSpan={6}>{dateLabel}</td></tr>);
                }
                let leagueId = item.league_id;
                const liveMatchRow = matches.find((x) => String(x.match_id) === String(item.match_id));
                if (!leagueId && liveMatchRow) leagueId = liveMatchRow.league_id;
                const leagueDisplay = getLeagueDisplayName(leagueId || '', item.league_name || item.league || '', leagues);
                const isLiveRow = liveMatchRow ? LIVE_STATUSES.includes(liveMatchRow.status) : false;

                rows.push(
                  <tr
                    key={item.match_id}
                    onClick={(e) => {
                      if (!isNarrowTabViewport()) return;
                      const target = e.target as HTMLElement;
                      if (target.closest('button, input, a, select, details, summary')) return;
                      setScoutItem(item);
                    }}
                    onDoubleClick={() => {
                      if (isNarrowTabViewport()) return;
                      setScoutItem(item);
                    }}
                    className={isLiveRow ? 'match-is-live' : undefined}
                    style={{ cursor: 'pointer' }}
                    title="Tap or double-click to view match details"
                  >
                    <td data-label="Time" className="data-table__th--center">
                      <div className="cell-value">
                        <span className="cell-time-badge">{timeDisplay}</span>
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
                    <td data-label="Condition" style={{ textAlign: 'center' }}><div className="cell-value"><small style={{ whiteSpace: 'normal' }}>{item.custom_conditions || '-'}</small></div></td>
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

        {totalPages > 1 && (
          <div className="tab-page-pagination--bottom">
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      <Modal
        open={filterSheetOpen}
        title="Watchlist filters"
        onClose={() => setFilterSheetOpen(false)}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => { clearFilters(); setFilterSheetOpen(false); }}>
              Reset
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setFilterSheetOpen(false)}>Apply</button>
          </>
        )}
      >
        <div className="leagues-filter-sheet">
          <label className="leagues-filter-sheet__field">
            <span className="leagues-filter-sheet__label">League</span>
            <select className="filter-input" value={leagueFilter} onChange={(e) => handleLeagueFilterChange(e.target.value)}>
              <option value="">All Leagues</option>
              {leagueOptions.map((l) => <option key={l.id} value={l.id}>{l.displayName} ({l.count})</option>)}
            </select>
          </label>
          <label className="leagues-filter-sheet__field">
            <span className="leagues-filter-sheet__label">From date</span>
            <DatePicker className="filter-input" value={dateFrom} onChange={handleDateFromChange} title="From date" placeholder="From date" />
          </label>
          <label className="leagues-filter-sheet__field">
            <span className="leagues-filter-sheet__label">To date</span>
            <DatePicker className="filter-input" value={dateTo} onChange={handleDateToChange} title="To date" placeholder="To date" />
          </label>
        </div>
      </Modal>

      {/* Edit Modal */}
      <WatchlistEditModal
        key={editItem ? String(editItem.match_id) : 'watchlist-edit-modal'}
        item={editItem}
        onClose={() => setEditItem(null)}
        onSave={async ({ custom_conditions, auto_apply_recommended_condition, notify_enabled }) => {
          if (!editItem) return;
          const ok = await updateWatchlistItem({
            id: editItem.id,
            match_id: editItem.match_id,
            custom_conditions,
            auto_apply_recommended_condition,
            notify_enabled,
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

