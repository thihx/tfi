import React, { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { useUiLanguage } from '@/hooks/useUiLanguage';
import { useUserTimeZone } from '@/hooks/useUserTimeZone';
import { useViewMode } from '@/hooks/useViewMode';
import { Pagination } from '@/components/ui/Pagination';
import { formatHalftimeParen, shouldShowHalftimeUnderScore } from '@/lib/utils/matchScoreDisplay';
import { DisciplineCardIcons } from '@/components/ui/MatchDisciplineCardIcons';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AiAnalysisPanel, type AiAnalysisPanelEntry } from '@/components/ui/AiAnalysisPanel';
import { AskAiMatchDialog } from '@/components/ui/AskAiMatchDialog';
import { AskAiMatchSplitControl } from '@/components/ui/AskAiMatchSplitControl';
import { MatchCard } from '@/components/ui/MatchCard';
import { WatchlistEditModal } from '@/components/ui/WatchlistEditModal';
import { LIVE_STATUSES, PLACEHOLDER_HOME, PLACEHOLDER_AWAY } from '@/config/constants';
import { formatDateTimeDisplay, getKickoffDateKey, getKickoffDateTime, getLeagueDisplayName, debounce, parseKickoffForSave, shouldFastRefreshMatch, normalizeToISO } from '@/lib/utils/helpers';
import { getDateGroupLabelInTimeZone, getDateKeyAtOffsetInTimeZone, getMatchDateKeyInTimeZone } from '@/lib/utils/timezone';
import type { Match, SortState, League, WatchlistItem } from '@/types';
import {
  analyzeMatchWithServerPipeline,
  type AskAiFollowUpMessage,
  type ServerMatchPipelineResult,
  getParsedAiResult,
} from '@/features/live-monitor/services/server-monitor.service';
import { MatchHubModal } from '@/components/ui/MatchHubModal';
import { Modal } from '@/components/ui/Modal';
import { applyFavoriteLeaguesToWatchlist, fetchFavoriteLeagueSelection } from '@/lib/services/api';
import { fetchCurrentUser } from '@/lib/services/auth';
import { loadMatchesAiResultsFromStorage, saveMatchesAiResultsToStorage } from '@/lib/matchesAiResultsStorage';

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

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

// Statuses where the ball is actually in play (excludes HT, BT, INT breaks)
const PLAYING_STATUSES = new Set(['1H', '2H', 'ET', 'P', 'LIVE']);

// Statuses where the match is definitively over — block adding to watchlist
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD']);

// ── Module-level store — persists across tab navigation ──────────────────────
type AiResultEntry = AiAnalysisPanelEntry;
const _matchesTabStore = {
  analyzingMatches: new Set<string>(),
  aiResults: new Map<string, AiResultEntry>(),
};

const PAGE_SIZE = 30;

/** `<select name=league>` value: chỉ hiện trận thuộc favorite leagues đã lưu (lọc client, không gọi API). */
const LEAGUE_FILTER_FAVORITES_VALUE = '__tfi_favorite_leagues__';

/** Scroll pagination: block auto flip right after programmatic scroll */
const SCROLL_PAGE_SUPPRESS_MS = 480;
/** Extra bottom space on last page so bottom sentinel can intersect (IO “next page”) */
const LAST_PAGE_BOTTOM_FUDGE = 'min(28vh, 160px)';
/** Debounce rapid IO callbacks */
const SCROLL_IO_NEXT_DEBOUNCE_MS = 650;

function normalizeFavoriteLeagueIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
    .filter((entry) => Number.isInteger(entry) && entry > 0) as number[];
  return Array.from(new Set(ids));
}

function normalizePositiveLimit(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function getFollowUpAnswerText(result: ReturnType<typeof getParsedAiResult>): string {
  if (!result) return 'The advisory follow-up returned no grounded answer for this match.';
  return (
    result.follow_up_answer_vi
    || result.follow_up_answer_en
    || result.reasoning_vi
    || result.reasoning_en
    || 'The advisory follow-up returned no grounded answer for this match.'
  );
}

/** First run with a steered question: show user line in chat + optional short advisory reply (not full reasoning). */
function buildInitialFollowUpMessages(
  question: string,
  matchResult: ServerMatchPipelineResult,
): AskAiFollowUpMessage[] {
  const parsed = getParsedAiResult(matchResult);
  const messages: AskAiFollowUpMessage[] = [{ role: 'user', text: question }];
  const reply = (parsed?.follow_up_answer_vi || parsed?.follow_up_answer_en || '').trim();
  if (reply) {
    messages.push({ role: 'assistant', text: reply });
  }
  return messages;
}

function getMatchKickoffTime(match: Match): Date {
  return getKickoffDateTime(match);
}

export function shouldAutoRefreshMatch(match: Match, now = Date.now()): boolean {
  return shouldFastRefreshMatch(match, now);
}


export function MatchesTab() {
  const { state, addToWatchlist, updateWatchlistItem, removeFromWatchlist, loadAllData, refreshMatches } = useAppState();
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
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(new Set());
  const [analyzingMatches, _setAnalyzingMatches] = useState<Set<string>>(() => new Set(_matchesTabStore.analyzingMatches));
  const [aiResults, _setAiResults] = useState<Map<string, AiResultEntry>>(() => {
    const fromDisk = loadMatchesAiResultsFromStorage();
    const merged = new Map<string, AiResultEntry>();
    if (fromDisk) {
      for (const [k, v] of fromDisk) merged.set(k, v);
    }
    for (const [k, v] of _matchesTabStore.aiResults) {
      const diskEntry = fromDisk?.get(k);
      const storeLen = v.followUpMessages?.length ?? 0;
      const diskLen = diskEntry?.followUpMessages?.length ?? 0;
      if (!diskEntry || storeLen >= diskLen) merged.set(k, v);
    }
    _matchesTabStore.aiResults = merged;
    return merged;
  });
  const [viewMode, setViewMode] = useViewMode('viewMode:matches');
  const [scoutMatch, setScoutMatch] = useState<Match | null>(null);
  const [askAiDialogMatch, setAskAiDialogMatch] = useState<Match | null>(null);
  const [lastAddedResultId, setLastAddedResultId] = useState<string | null>(null);
  const [favoriteLeagueIds, setFavoriteLeagueIds] = useState<number[]>([]);
  const [favoritePickerOpen, setFavoritePickerOpen] = useState(false);
  const [favoriteDraftIds, setFavoriteDraftIds] = useState<number[]>([]);
  const [savingFavoriteLeagues, setSavingFavoriteLeagues] = useState(false);
  const [favoriteLeaguesEnabled, setFavoriteLeaguesEnabled] = useState(true);
  const [favoriteLeaguesLimit, setFavoriteLeaguesLimit] = useState<number | null>(null);
  const [favoriteLeagueOptions, setFavoriteLeagueOptions] = useState<League[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('member');
  const aiResultsRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [filterBarBottom, setFilterBarBottom] = useState(240);

  // ── Scroll-based pagination refs ──────────────────────────────────────────
  // null = window is the scroll parent (mobile); element = desktop scroll div
  const scrollElRef = useRef<HTMLElement | null>(null);
  const scrollListenerCleanupRef = useRef<(() => void) | null>(null);
  const paginationSuppressUntilRef = useRef(0);
  const autoScrollingRef = useRef(false);     // suppresses handler during programmatic scroll
  const prevSafePageRef = useRef(1);
  const safePageRef = useRef(1);
  const totalPagesRef = useRef(1);
  /** Sau khi lùi trang (scroll tới đáy), chặn IO “tới trang sau” cho tới khi rời đáy */
  const blockScrollNextAfterPrevRef = useRef(false);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const lastIoNextAtRef = useRef(0);
  /** Mỗi trang: chỉ tự tới trang sau khi user đã cuộn (tránh nhảy trang lúc load) */
  const userHasScrolledOnPageRef = useRef(false);

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

  const persistAiResultsDebounced = useRef(
    debounce((m: Map<string, AiResultEntry>) => {
      saveMatchesAiResultsToStorage(m);
    }, 400),
  );

  // Wrapped setters: update `_matchesTabStore` synchronously from the module copy so pipeline
  // callbacks still run after MatchesTab unmounts (React may drop setState updaters — store stays truth).
  const setAnalyzingMatches = useCallback((fn: (prev: Set<string>) => Set<string>) => {
    const next = fn(new Set(_matchesTabStore.analyzingMatches));
    _matchesTabStore.analyzingMatches = next;
    _setAnalyzingMatches(next);
  }, []);
  const setAiResults = useCallback((fn: (prev: Map<string, AiResultEntry>) => Map<string, AiResultEntry>) => {
    const next = fn(new Map(_matchesTabStore.aiResults));
    _matchesTabStore.aiResults = next;
    _setAiResults(next);
    persistAiResultsDebounced.current(next);
  }, []);

  useEffect(() => {
    persistAiResultsDebounced.current(aiResults);
  }, [aiResults]);

  useEffect(() => () => {
    saveMatchesAiResultsToStorage(_matchesTabStore.aiResults);
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      _setAnalyzingMatches(new Set(_matchesTabStore.analyzingMatches));
      _setAiResults(new Map(_matchesTabStore.aiResults));
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Auto-scroll to result panel after DOM has updated (e.g. user was scrolled down in card grid)
  useEffect(() => {
    if (!lastAddedResultId) return;
    const id = lastAddedResultId;
    let cancelled = false;

    const highlight = (el: HTMLElement) => {
      el.style.outline = '2px solid var(--primary)';
      window.setTimeout(() => {
        if (!cancelled && el.isConnected) el.style.outline = '';
      }, 1500);
    };

    const scrollToResult = (attempt: number) => {
      if (cancelled) return;
      const el = document.getElementById(`ai-result-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        highlight(el);
        setLastAddedResultId(null);
        return;
      }
      if (attempt < 12) {
        window.setTimeout(() => scrollToResult(attempt + 1), 40);
        return;
      }
      aiResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
      setLastAddedResultId(null);
    };

    const run = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToResult(0));
      });
    };

    const timer = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lastAddedResultId]);

  const loadAllDataRef = useRef(loadAllData);
  useEffect(() => { loadAllDataRef.current = loadAllData; });

  const refreshMatchesRef = useRef(refreshMatches);
  useEffect(() => { refreshMatchesRef.current = refreshMatches; });

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

  // Full sync when entering this tab (component mounts each time user opens Matches — avoids showing only global/polling state from other screens).
  useEffect(() => {
    void loadAllDataRef.current(true);
  }, []);

  // When the browser tab / PWA comes back to the foreground while this screen is open, timers may have been throttled — merge-refresh once.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshMatchesRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Merge-refresh from GET /api/matches while this tab is mounted: live scores (3s) + list hygiene (10s) so removals/status FT stay in sync without full reload.
  useEffect(() => {
    const fast = window.setInterval(() => {
      const now = Date.now();
      if (allMatchesRef.current.some((m) => shouldAutoRefreshMatch(m, now))) {
        void refreshMatchesRef.current();
      }
    }, 3000);
    const steady = window.setInterval(() => {
      void refreshMatchesRef.current();
    }, 10_000);
    return () => {
      window.clearInterval(fast);
      window.clearInterval(steady);
    };
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
      const la = leagues.find((l) => String(l.league_id) === a.id);
      const lb = leagues.find((l) => String(l.league_id) === b.id);
      const oa = la?.sort_order ?? 0;
      const ob = lb?.sort_order ?? 0;
      if (oa !== ob) return oa - ob;
      if (a.isTop !== b.isTop) return a.isTop ? -1 : 1;
      return b.count - a.count;
    });
  }, [matches, leagues]);

  const favoriteLeagueChoices = useMemo(() => (
    (favoriteLeagueOptions.length > 0 ? favoriteLeagueOptions : leagues.filter((league) => league.top_league))
      .map((league) => ({
        id: league.league_id,
        displayName: getLeagueDisplayName(league.league_id, league.league_name || '', leagues),
        logo: league.logo,
        sort_order: league.sort_order ?? 0,
      }))
      .sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.displayName.localeCompare(b.displayName);
      })
  ), [favoriteLeagueOptions, leagues]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      fetchFavoriteLeagueSelection(config.apiUrl),
      fetchCurrentUser(config.apiUrl),
    ]).then(([favoriteSelectionResult, currentUserResult]) => {
      if (!active) return;
      if (favoriteSelectionResult.status === 'fulfilled') {
        setFavoriteLeagueIds(normalizeFavoriteLeagueIds(favoriteSelectionResult.value.selectedLeagueIds));
        setFavoriteLeaguesEnabled(favoriteSelectionResult.value.favoriteLeaguesEnabled !== false);
        setFavoriteLeaguesLimit(normalizePositiveLimit(favoriteSelectionResult.value.favoriteLeagueLimit));
        setFavoriteLeagueOptions(favoriteSelectionResult.value.availableLeagues ?? []);
      }
      if (currentUserResult.status === 'fulfilled' && currentUserResult.value?.role) {
        setCurrentUserRole(currentUserResult.value.role);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [config.apiUrl]);

  const userBypassesFavoriteLeagueLimits = currentUserRole === 'admin' || currentUserRole === 'owner';

  const effectiveFavoriteLeagueIds = useMemo(() => {
    const topIds = favoriteLeagueChoices.map((league) => league.id);
    if (topIds.length === 0) return [] as number[];
    const topIdSet = new Set(topIds);
    const filteredIds = favoriteLeagueIds.filter((id) => topIdSet.has(id));
    return userBypassesFavoriteLeagueLimits || favoriteLeaguesLimit == null
      ? filteredIds
      : filteredIds.slice(0, favoriteLeaguesLimit);
  }, [favoriteLeagueIds, favoriteLeaguesLimit, favoriteLeagueChoices, userBypassesFavoriteLeagueLimits]);

  const favoriteFeatureVisible = favoriteLeaguesEnabled && favoriteLeagueChoices.length > 0;

  const favoriteLeagueIdSet = useMemo(
    () => new Set(effectiveFavoriteLeagueIds),
    [effectiveFavoriteLeagueIds],
  );

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
      if (leagueFilter) {
        if (leagueFilter === LEAGUE_FILTER_FAVORITES_VALUE) {
          if (!favoriteLeagueIdSet.has(Number(m.league_id))) return false;
        } else if (String(m.league_id) !== leagueFilter) {
          return false;
        }
      }
      if (actionFilter) {
        const isWatched = watchlistMap.has(String(m.match_id));
        if (actionFilter === 'watched' && !isWatched) return false;
        if (actionFilter === 'not-watched' && isWatched) return false;
      }
      if (dateFrom || dateTo) {
        const kickoffDateKey =
          getKickoffDateKey(m, effectiveTimeZone)
          ?? getMatchDateKeyInTimeZone(m.date, m.kickoff || '00:00', effectiveTimeZone)
          ?? normalizeToISO(m.date);
        if (!kickoffDateKey) return false;
        const inRange =
          (!dateFrom || kickoffDateKey >= dateFrom) &&
          (!dateTo || kickoffDateKey <= dateTo);
        if (inRange) return true;
        // Tab Today: trận vẫn LIVE nhưng ngày kickoff (theo TZ user) là hôm qua — thường gặp lúc rạng sáng
        // khi giải khác múi giờ đá từ chiều/tối hôm trước.
        const overnightLive =
          LIVE_STATUSES.includes(m.status)
          && dateFrom != null
          && dateTo != null
          && dateFrom === dateTo
          && dateFrom === getDateKeyAtOffsetInTimeZone(0, effectiveTimeZone)
          && kickoffDateKey === getDateKeyAtOffsetInTimeZone(-1, effectiveTimeZone);
        return overnightLive;
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
  }, [matches, debouncedSearch, statusFilter, leagueFilter, actionFilter, dateFrom, dateTo, sort, watchlistMap, effectiveTimeZone, favoriteLeagueIdSet]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  allMatchesRef.current = matches;

  // Keep refs in sync so scroll handler always reads latest values
  safePageRef.current = safePage;
  totalPagesRef.current = totalPages;

  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  // ── IntersectionObserver: tới trang sau (ổn định). Lùi trang: dùng Pagination. ──
  useLayoutEffect(() => {
    function findScrollParent(node: HTMLElement | null): HTMLElement | null {
      if (!node || node === document.documentElement) return null;
      const { overflowY } = getComputedStyle(node);
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
      return findScrollParent(node.parentElement as HTMLElement);
    }

    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const scrollEl = filterBarRef.current
        ? findScrollParent(filterBarRef.current.parentElement as HTMLElement)
        : null;
      scrollElRef.current = scrollEl;

      const markUserScroll = () => {
        userHasScrolledOnPageRef.current = true;
      };
      window.addEventListener('scroll', markUserScroll, { passive: true });
      scrollEl?.addEventListener('scroll', markUserScroll, { passive: true });

      const onScrollEnd = () => { autoScrollingRef.current = false; };
      window.addEventListener('scrollend', onScrollEnd as EventListener, { passive: true });
      scrollEl?.addEventListener('scrollend', onScrollEnd as EventListener, { passive: true });

      const bottom = bottomSentinelRef.current;
      const nowMs = () => Date.now();
      const isSuppressed = () =>
        nowMs() < paginationSuppressUntilRef.current || autoScrollingRef.current;

      let io: IntersectionObserver | null = null;
      if (bottom && totalPages > 1) {
        io = new IntersectionObserver(
          ([entry]) => {
            if (!entry) return;
            if (!entry.isIntersecting) {
              blockScrollNextAfterPrevRef.current = false;
              return;
            }
            if (isSuppressed()) return;
            if (!userHasScrolledOnPageRef.current) return;
            if (blockScrollNextAfterPrevRef.current) return;
            const sp = safePageRef.current;
            const tp = totalPagesRef.current;
            if (sp >= tp) return;
            const t = nowMs();
            if (t - lastIoNextAtRef.current < SCROLL_IO_NEXT_DEBOUNCE_MS) return;
            lastIoNextAtRef.current = t;
            paginationSuppressUntilRef.current = t + SCROLL_PAGE_SUPPRESS_MS;
            setPage((p) => Math.min(p + 1, totalPagesRef.current));
          },
          {
            root: scrollEl ?? null,
            rootMargin: '0px 0px 96px 0px',
            threshold: 0,
          },
        );
        io.observe(bottom);
      }

      scrollListenerCleanupRef.current = () => {
        window.removeEventListener('scroll', markUserScroll);
        scrollEl?.removeEventListener('scroll', markUserScroll);
        window.removeEventListener('scrollend', onScrollEnd as EventListener);
        scrollEl?.removeEventListener('scrollend', onScrollEnd as EventListener);
        io?.disconnect();
      };
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      scrollListenerCleanupRef.current?.();
      scrollListenerCleanupRef.current = null;
    };
  }, [viewMode, safePage, totalPages, pageItems.length]);

  useEffect(() => {
    userHasScrolledOnPageRef.current = false;
  }, [safePage]);

  // Scroll to correct position after page changes (infinite-scroll style)
  useEffect(() => {
    if (prevSafePageRef.current === safePage) return;
    const wentForward = safePage > prevSafePageRef.current;
    prevSafePageRef.current = safePage;
    autoScrollingRef.current = true;
    paginationSuppressUntilRef.current = Date.now() + SCROLL_PAGE_SUPPRESS_MS;
    const el = scrollElRef.current;
    const viewportH = window.visualViewport?.height ?? window.innerHeight;
    if (wentForward) {
      blockScrollNextAfterPrevRef.current = false;
      if (el) el.scrollTo({ top: 0 });
      else window.scrollTo({ top: 0 });
    } else {
      blockScrollNextAfterPrevRef.current = true;
      const sh = el ? el.scrollHeight : Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
      const ch = el ? el.clientHeight : viewportH;
      const top = Math.max(0, sh - ch);
      if (el) el.scrollTo({ top });
      else window.scrollTo({ top });
    }
    const tid = setTimeout(() => { autoScrollingRef.current = false; }, SCROLL_PAGE_SUPPRESS_MS);
    return () => clearTimeout(tid);
  }, [safePage]);

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
    if (FINISHED_STATUSES.has(m.status)) { showToast('Cannot watch a finished match', 'error'); return; }
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

  const quickRemove = useCallback(async (m: Match) => {
    const mid = String(m.match_id);
    if (pendingRemoves.has(mid)) return;
    const snapshot = watchlistMap.get(mid);
    if (!snapshot) return;

    setPendingRemoves((prev) => new Set(prev).add(mid));

    // Optimistic: remove from state immediately, offer undo
    await removeFromWatchlist([mid]);
    setPendingRemoves((prev) => { const s = new Set(prev); s.delete(mid); return s; });

    showToast('Removed from watchlist', 'info', {
      label: 'Undo',
      onClick: () => addToWatchlist([{
        match_id: snapshot.match_id, date: snapshot.date,
        league: snapshot.league, home_team: snapshot.home_team,
        away_team: snapshot.away_team, kickoff: snapshot.kickoff,
      }]),
    });
  }, [watchlistMap, pendingRemoves, removeFromWatchlist, addToWatchlist, showToast]);

  const executeAskAiPipeline = useCallback(async (m: Match, opts?: { question?: string }) => {
    const mid = String(m.match_id);
    setAnalyzingMatches((prev) => new Set(prev).add(mid));
    showToast(`Analyzing ${m.home_team} vs ${m.away_team}...`, 'info');

    try {
      const matchResult = await analyzeMatchWithServerPipeline(config, mid, {
        question: opts?.question?.trim() || undefined,
        history: [],
      });
      if (matchResult) {
        const parsed = getParsedAiResult(matchResult);
        const steeredQuestion = opts?.question?.trim() ?? '';
        setAiResults((prev) => new Map(prev).set(mid, {
          matchId: mid,
          matchDisplay: `${m.home_team} vs ${m.away_team}`,
          result: matchResult,
          followUpMessages: steeredQuestion
            ? buildInitialFollowUpMessages(steeredQuestion, matchResult)
            : (prev.get(mid)?.followUpMessages ?? []),
        }));
        setLastAddedResultId(mid);
        if (parsed && matchResult.error) {
          showToast(`${m.home_team} vs ${m.away_team} — Analysis finished with an issue: ${matchResult.error}`, 'error');
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
  }, [config, showToast, setAiResults, setAnalyzingMatches]);

  /** Primary: run analysis immediately, or scroll to cached result. */
  const askAiQuick = useCallback((m: Match) => {
    const mid = String(m.match_id);
    if (analyzingMatches.has(mid)) return;

    if (aiResults.has(mid)) {
      const el = document.getElementById(`ai-result-${mid}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        el.style.outline = '2px solid var(--primary)';
        setTimeout(() => { el.style.outline = ''; }, 1500);
      }
      showToast(`${m.home_team} vs ${m.away_team} — showing cached result`, 'info');
      return;
    }

    if (!watchlistMap.has(mid)) {
      showToast('Add this match to Watchlist before running analysis', 'info');
      return;
    }

    void executeAskAiPipeline(m);
  }, [analyzingMatches, aiResults, watchlistMap, showToast, executeAskAiPipeline]);

  /** Chat: first run opens optional-question dialog; if analysis already exists, jump to the panel chat instead. */
  const askAiOpenQuestionDialog = useCallback((m: Match) => {
    const mid = String(m.match_id);
    if (analyzingMatches.has(mid)) return;
    if (!watchlistMap.has(mid)) {
      showToast('Add this match to Watchlist before running analysis', 'info');
      return;
    }
    if (aiResults.has(mid)) {
      const el = document.getElementById(`ai-result-${mid}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
      window.setTimeout(() => {
        document.getElementById(`ai-followup-input-${mid}`)?.focus({ preventScroll: true });
      }, 400);
      return;
    }
    setAskAiDialogMatch(m);
  }, [analyzingMatches, watchlistMap, showToast, aiResults]);

  /** Close the dialog immediately; pipeline runs in the background (same as quick run). */
  const handleAskAiDialogSubmit = useCallback((question: string) => {
    if (!askAiDialogMatch) return;
    const m = askAiDialogMatch;
    setAskAiDialogMatch(null);
    void executeAskAiPipeline(m, { question });
  }, [askAiDialogMatch, executeAskAiPipeline]);

  const askAiFollowUp = useCallback(async (
    entry: AiAnalysisPanelEntry,
    question: string,
    history: AskAiFollowUpMessage[],
  ) => {
    const mid = entry.matchId;
    const match = matches.find((candidate) => String(candidate.match_id) === mid);
    if (!match) {
      showToast('Match context is no longer available for this follow-up', 'error');
      throw new Error('MATCH_NOT_FOUND');
    }
    if (analyzingMatches.has(mid)) {
      showToast('Please wait for the current analysis run to finish for this match.', 'info');
      throw new Error('BUSY');
    }

    setAnalyzingMatches((prev) => new Set(prev).add(mid));
    try {
      const matchResult = await analyzeMatchWithServerPipeline(config, mid, {
        question,
        history,
      });
      const parsed = getParsedAiResult(matchResult);
      const assistantText = getFollowUpAnswerText(parsed);
      setAiResults((prev) => {
        const next = new Map(prev);
        const previous = next.get(mid) ?? entry;
        next.set(mid, {
          ...previous,
          result: matchResult,
          followUpMessages: [
            ...(previous.followUpMessages ?? []),
            { role: 'user', text: question },
            { role: 'assistant', text: assistantText },
          ],
        });
        return next;
      });
      showToast(`${match.home_team} vs ${match.away_team} — follow-up ready`, 'success');
    } catch (err) {
      showToast(`${match.home_team} vs ${match.away_team} follow-up failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      throw err;
    } finally {
      setAnalyzingMatches((prev) => { const s = new Set(prev); s.delete(mid); return s; });
    }
  }, [analyzingMatches, config, matches, setAiResults, setAnalyzingMatches, showToast]);

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
  const activeDateTab =
    dateFrom === dateToday    && dateTo === dateToday    ? 'today'
    : dateFrom === dateTomorrow && dateTo === dateTomorrow ? 'tomorrow'
    : dateFrom === dateYesterday && dateTo === dateYesterday ? 'yesterday'
    : (!dateFrom && !dateTo) ? 'all'
    : 'custom';
  const tabBtn = (active: boolean) => ({
    fontWeight: active ? 600 : 400,
    background: active ? 'var(--gray-800)' : 'transparent',
    borderColor: active ? 'var(--gray-800)' : 'var(--gray-300)',
    color: active ? '#fff' : 'var(--gray-500)',
  } as React.CSSProperties);

  // Filter badges
  const badges = [];
  if (debouncedSearch) badges.push(`Teams: ${debouncedSearch}`);
  if (statusFilter) badges.push(`Status: ${statusFilter}`);
  if (leagueFilter) {
    if (leagueFilter === LEAGUE_FILTER_FAVORITES_VALUE) badges.push('League: Favorite Leagues');
    else {
      const op = leagueOptions.find((l) => l.id === leagueFilter);
      badges.push(`League: ${op?.displayName || leagueFilter}`);
    }
  }
  if (dateFrom || dateTo) badges.push(`Date: ${dateFrom || '—'} → ${dateTo || '—'}`);

  const handleOpenFavoritePicker = () => {
    setFavoriteDraftIds(effectiveFavoriteLeagueIds);
    setFavoritePickerOpen(true);
  };

  const toggleFavoriteDraftLeague = (leagueId: number) => {
    setFavoriteDraftIds((prev: number[]) => {
      const next = new Set(prev);
      if (next.has(leagueId)) {
        next.delete(leagueId);
        return Array.from(next);
      }
      if (!userBypassesFavoriteLeagueLimits && favoriteLeaguesLimit != null && next.size >= favoriteLeaguesLimit) {
        showToast(`Your plan allows up to ${favoriteLeaguesLimit} favorite leagues.`, 'info');
        return prev;
      }
      next.add(leagueId);
      return Array.from(next);
    });
  };

  const saveFavoriteLeagues = async () => {
    setSavingFavoriteLeagues(true);
    const availableIds = favoriteLeagueChoices.map((league) => league.id);
    const normalizedDraft = normalizeFavoriteLeagueIds(favoriteDraftIds)
      .filter((id) => availableIds.includes(id))
      .slice(0, userBypassesFavoriteLeagueLimits || favoriteLeaguesLimit == null ? availableIds.length : favoriteLeaguesLimit);
    try {
      const result = await applyFavoriteLeaguesToWatchlist(config, normalizedDraft);
      setFavoriteLeagueIds(result.savedLeagueIds);
      setFavoritePickerOpen(false);
      await loadAllDataRef.current(true);
      if (result.limitExceeded) {
        showToast(
          result.error || 'Favorite leagues saved, but your watchlist limit would be exceeded. No matches were added.',
          'info',
        );
      } else {
        showToast(
          `Favorite leagues saved. Added ${result.added} match${result.added === 1 ? '' : 'es'}${result.alreadyWatched > 0 ? ` (${result.alreadyWatched} already in watchlist)` : ''}.`,
          'success',
        );
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save favorite leagues', 'error');
    } finally {
      setSavingFavoriteLeagues(false);
    }
  };

  return (
    <div className="card" style={{ '--group-sticky-top': `${filterBarBottom}px`, '--filter-bar-bottom': `${filterBarBottom}px` } as React.CSSProperties}>
      {/* Sticky filter bar */}
      <div className="sticky-filter-bar" ref={filterBarRef}>
        {/* Date tab shortcuts */}
        <div className="date-tab-bar">
          <button style={tabBtn(activeDateTab === 'all')} onClick={() => { setDateFrom(''); setDateTo(''); }}>All</button>
          <button style={tabBtn(activeDateTab === 'yesterday')} onClick={() => { setDateFrom(dateYesterday); setDateTo(dateYesterday); }}>Yesterday</button>
          <button style={tabBtn(activeDateTab === 'today')} onClick={() => { setDateFrom(dateToday); setDateTo(dateToday); }}>Today</button>
          <button style={tabBtn(activeDateTab === 'tomorrow')} onClick={() => { setDateFrom(dateTomorrow); setDateTo(dateTomorrow); }}>Tomorrow</button>
          {favoriteFeatureVisible && (
            <button
              onClick={handleOpenFavoritePicker}
              title="Add matches from your favorite leagues to Watchlist"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--gray-200)',
                background: effectiveFavoriteLeagueIds.length > 0 ? 'rgba(37,99,235,0.06)' : 'transparent',
                color: effectiveFavoriteLeagueIds.length > 0 ? 'var(--primary)' : 'var(--gray-500)',
                fontSize: '12px', fontWeight: 500, cursor: 'pointer', lineHeight: 1,
              }}
            >
              + Watchlist by Favorite Leagues
            </button>
          )}
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
            {favoriteFeatureVisible && (
              <option value={LEAGUE_FILTER_FAVORITES_VALUE}>Favorite Leagues</option>
            )}
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
        {totalPages > 1 && (
          <div style={{ borderTop: '1px solid var(--gray-100)' }}>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
        {/* Contextual selection bar — docked inside sticky bar */}
        {viewMode === 'table' && selected.size > 0 && (
          <div style={{ padding: '7px 16px', background: '#f0f9ff', borderTop: '1px solid #bae6fd', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--gray-600)' }}>{selected.size} selected</span>
            <button className="btn btn-primary btn-sm" onClick={addSelectedToWatchlist}>+ Add to Watchlist</button>
            <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {/* AI Result Panels */}
      {aiResults.size > 0 && (
        <div ref={aiResultsRef} style={{ margin: '12px 0', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
              onFollowUp={(question, history) => askAiFollowUp(entry, question, history)}
            />
          ))}
        </div>
      )}

      {/* Card view */}
      {viewMode === 'cards' && (
        <div
          style={{
            padding: '16px',
            paddingBottom:
              safePage === totalPages && totalPages > 1 && pageItems.length > 0
                ? `calc(16px + ${LAST_PAGE_BOTTOM_FUDGE})`
                : '16px',
          }}
        >
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
                  flashMap={flashMap}
                  watchedAction={watchlistMap.has(String(m.match_id)) ? {
                    onRemove: () => quickRemove(m),
                    isPendingRemove: pendingRemoves.has(String(m.match_id)),
                    isPlaying: PLAYING_STATUSES.has(m.status),
                  } : undefined}
                  actions={[
                    ...(watchlistMap.has(String(m.match_id))
                      ? [
                          { label: 'Rules', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>, title: 'Watch alerts and conditions', onClick: (match: Match) => { const entry = watchlistMap.get(String(match.match_id)); if (entry) setEditItem(entry); }, variant: 'secondary' as const },
                        ]
                      : [
                          FINISHED_STATUSES.has(m.status)
                            ? { label: 'FT', icon: <EyeIcon />, title: 'Match is finished', onClick: () => {}, disabled: true }
                            : pendingAdds.has(String(m.match_id))
                              ? { label: 'Saving…', onClick: () => {}, disabled: true }
                              : { label: '+ Watch', icon: <EyeIcon />, title: 'Watch this match', onClick: (match: Match) => quickAdd(match), variant: 'primary' as const },
                        ]),
                    {
                      label: 'Analysis',
                      render: () => (
                        <AskAiMatchSplitControl
                          variant="card"
                          hasResult={aiResults.has(String(m.match_id))}
                          isAnalyzing={analyzingMatches.has(String(m.match_id))}
                          isWatched={watchlistMap.has(String(m.match_id))}
                          onQuick={() => askAiQuick(m)}
                          onOpenQuestion={() => askAiOpenQuestionDialog(m)}
                        />
                      ),
                    },
                  ]}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && <div
        className="table-container table-cards matches-table"
        style={{
          '--group-sticky-top': `${filterBarBottom}px`,
          ...(safePage === totalPages && totalPages > 1 && pageItems.length > 0
            ? { paddingBottom: LAST_PAGE_BOTTOM_FUDGE }
            : {}),
        } as React.CSSProperties}
      >
        <table>
          <thead>
            <tr>
              <th style={{ cursor: 'pointer' }} onClick={() => handleSort('time')}>Time {sortIndicator('time')}</th>
              <th style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => handleSort('league')}>League {sortIndicator('league')}</th>
              <th style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => handleSort('status')} title="Sort by match status">
                Match {sortIndicator('status')}
              </th>
              <th style={{ width: 40, textAlign: 'center' }}>
                <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} />
              </th>
              <th style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => handleSort('action')}>Action {sortIndicator('action')}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={5} className="empty-state">
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
                  rows.push(<tr key={`grp-${label}`} className="date-group-row"><td colSpan={5}>{label}</td></tr>);
                }
                rows.push(
                  <MatchRow
                    key={m.match_id}
                    match={m}
                    isWatched={watchlistMap.has(String(m.match_id))}
                    isPending={pendingAdds.has(String(m.match_id))}
                    isPendingRemove={pendingRemoves.has(String(m.match_id))}
                    isSelected={selected.has(String(m.match_id))}
                    isAnalyzing={analyzingMatches.has(String(m.match_id))}
                    hasResult={aiResults.has(String(m.match_id))}
                    leagues={leagues}
                    flashMap={flashMap}
                    onQuickAdd={() => quickAdd(m)}
                    onQuickRemove={() => quickRemove(m)}
                    onToggleSelect={() => toggleSelect(String(m.match_id), watchlistMap.has(String(m.match_id)))}
                    onAskAiQuick={() => askAiQuick(m)}
                    onAskAiOpenQuestion={() => askAiOpenQuestionDialog(m)}
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

      {pageItems.length > 0 && totalPages > 1 && (
        <div
          ref={bottomSentinelRef}
          aria-hidden
          style={{ height: 1, width: '100%', overflow: 'hidden', pointerEvents: 'none' }}
        />
      )}

      <AskAiMatchDialog
        open={askAiDialogMatch != null}
        match={askAiDialogMatch}
        isRunning={askAiDialogMatch != null && analyzingMatches.has(String(askAiDialogMatch.match_id))}
        onClose={() => setAskAiDialogMatch(null)}
        onSubmit={(q) => { void handleAskAiDialogSubmit(q); }}
      />

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

      {scoutMatch && (
        <MatchHubModal
          open
          matchId={String(scoutMatch.match_id)}
          matchDisplay={`${scoutMatch.home_team} vs ${scoutMatch.away_team}`}
          homeTeam={scoutMatch.home_team}
          awayTeam={scoutMatch.away_team}
          homeLogo={scoutMatch.home_logo}
          awayLogo={scoutMatch.away_logo}
          leagueName={scoutMatch.league_name ?? ''}
          leagueId={scoutMatch.league_id}
          status={scoutMatch.status}
          homeTeamId={scoutMatch.home_team_id ?? undefined}
          awayTeamId={scoutMatch.away_team_id ?? undefined}
          onClose={() => setScoutMatch(null)}
        />
      )}

      <Modal
        open={favoritePickerOpen}
        title="Watchlist by Favorite Leagues"
        size="lg"
        onClose={() => setFavoritePickerOpen(false)}
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setFavoritePickerOpen(false)} disabled={savingFavoriteLeagues}>Cancel</button>
            <button className="btn btn-primary" onClick={saveFavoriteLeagues} disabled={savingFavoriteLeagues}>
              {savingFavoriteLeagues ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      >
        <div className="watchlist-favorite-leagues-picker" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Description */}
          <p style={{ margin: 0, fontSize: '11px', color: 'var(--gray-500)', lineHeight: 1.45 }}>
            Choose your favorite leagues to add their matches from the list to your watchlist.
            {!userBypassesFavoriteLeagueLimits && favoriteLeaguesLimit != null && (
              <span style={{ color: 'var(--gray-400)' }}> Up to {favoriteLeaguesLimit} allowed.</span>
            )}
          </p>

          {/* Toolbar: count + select/deselect toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{
              fontSize: '11px', fontWeight: 600,
              color: favoriteDraftIds.length > 0 ? 'var(--primary)' : 'var(--gray-400)',
              background: favoriteDraftIds.length > 0 ? 'rgba(37,99,235,0.08)' : 'var(--gray-100)',
              padding: '2px 8px', borderRadius: '999px',
            }}>
              {favoriteDraftIds.length} / {favoriteLeagueChoices.length} selected
            </span>
            <button
              onClick={() => {
                const allIds = favoriteLeagueChoices
                  .map((l) => l.id)
                  .slice(0, userBypassesFavoriteLeagueLimits || favoriteLeaguesLimit == null ? favoriteLeagueChoices.length : favoriteLeaguesLimit);
                const allSelected = allIds.every((id) => favoriteDraftIds.includes(id));
                setFavoriteDraftIds(allSelected ? [] : allIds);
              }}
              disabled={savingFavoriteLeagues}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--primary)', fontWeight: 500, padding: '2px 0' }}
            >
              {favoriteLeagueChoices
                .map((l) => l.id)
                .slice(0, userBypassesFavoriteLeagueLimits || favoriteLeaguesLimit == null ? favoriteLeagueChoices.length : favoriteLeaguesLimit)
                .every((id) => favoriteDraftIds.includes(id))
                ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {/* League grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '6px' }}>
            {favoriteLeagueChoices.map((league) => {
              const checked = favoriteDraftIds.includes(league.id);
              return (
                <label key={league.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '8px',
                  padding: '7px 10px', borderRadius: '8px', cursor: 'pointer',
                  border: `1px solid ${checked ? 'var(--primary)' : 'var(--gray-200)'}`,
                  background: checked ? 'rgba(37,99,235,0.05)' : '#fff',
                  transition: 'border-color 0.15s, background 0.15s',
                }}>
                  <span style={{
                    width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, marginTop: '1px',
                    border: `2px solid ${checked ? 'var(--primary)' : 'var(--gray-300)'}`,
                    background: checked ? 'var(--primary)' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}>
                    {checked && (
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="2 6 5 9 10 3"/>
                      </svg>
                    )}
                  </span>
                  <input type="checkbox" checked={checked} onChange={() => toggleFavoriteDraftLeague(league.id)} style={{ display: 'none' }} />
                  {league.logo && (
                    <img
                      src={league.logo}
                      alt=""
                      width="16" height="16"
                      style={{ objectFit: 'contain', flexShrink: 0, opacity: checked ? 1 : 0.6, marginTop: '1px' }}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <span style={{
                    fontSize: '11px',
                    lineHeight: 1.35,
                    color: checked ? 'var(--gray-800)' : 'var(--gray-600)',
                    fontWeight: checked ? 500 : 400,
                  }}
                  >
                    {league.displayName}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface MatchRowProps {
  match: Match;
  isWatched: boolean;
  isPending: boolean;
  isPendingRemove: boolean;
  isSelected: boolean;
  isAnalyzing: boolean;
  hasResult: boolean;
  leagues: League[];
  flashMap: Map<string, number>;
  onQuickAdd: () => void;
  onQuickRemove: () => void;
  onToggleSelect: () => void;
  onAskAiQuick: () => void;
  onAskAiOpenQuestion: () => void;
  onEdit: () => void;
  onDoubleClick: () => void;
}

function MatchRow({ match, isWatched, isPending, isPendingRemove, isSelected, isAnalyzing, hasResult, leagues, flashMap, onQuickAdd, onQuickRemove, onToggleSelect, onAskAiQuick, onAskAiOpenQuestion, onEdit, onDoubleClick }: MatchRowProps) {
  const [watchHovered, setWatchHovered] = React.useState(false);
  const isPlaying = PLAYING_STATUSES.has(match.status);
  const isFinished = FINISHED_STATUSES.has(match.status);
  const localDT = getMatchKickoffTime(match);
  const timeDisplay = formatDateTimeDisplay(localDT);
  const leagueDisplay = getLeagueDisplayName(match.league_id, match.league_name || '', leagues);
  const score = match.home_score != null && match.home_score !== '' ? `${match.home_score} - ${match.away_score}` : '';
  const currentMinute = match.status === 'HT' ? 'HT' : (match.current_minute ? `${match.current_minute}'` : '');
  const showHalftimeUnder = shouldShowHalftimeUnderScore(match);

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
          <span className="time-pill" style={{ background: 'var(--gray-200)', padding: '3px 7px', borderRadius: '4px', fontWeight: 600, color: 'var(--gray-900)', fontSize: '12px' }}>{timeDisplay}</span>
        </div>
      </td>
      <td data-label="League" style={{ textAlign: 'center' }}><div className="cell-value"><span style={{ fontWeight: 400 }}>{leagueDisplay}</span></div></td>
      <td data-label="Match" style={{ textAlign: 'center' }}>
        <div className="cell-value match-cell">
          <div className="match-teams">
            <div className="team-info">
              <img src={match.home_logo} loading="lazy" decoding="async" alt={match.home_team} className="team-logo" onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_HOME; }} />
              <span style={{ fontWeight: 400 }}>{match.home_team}</span>
              {(match.home_yellows ?? 0) > 0 ? <DisciplineCardIcons key={`hy-${homeYellowGen}`} variant="yellow" count={match.home_yellows ?? 0} flashGen={homeYellowGen} style={{ marginLeft: 4, gap: 1 }} /> : null}
              {(match.home_reds ?? 0) > 0 ? <DisciplineCardIcons key={`hr-${homeRedGen}`} variant="red" count={match.home_reds ?? 0} flashGen={homeRedGen} style={{ marginLeft: 4, gap: 1 }} /> : null}
            </div>
            <span className="match-vs">vs</span>
            <div className="team-info">
              {(match.away_reds ?? 0) > 0 ? <DisciplineCardIcons key={`ar-${awayRedGen}`} variant="red" count={match.away_reds ?? 0} flashGen={awayRedGen} style={{ marginRight: 4, gap: 1 }} /> : null}
              {(match.away_yellows ?? 0) > 0 ? <DisciplineCardIcons key={`ay-${awayYellowGen}`} variant="yellow" count={match.away_yellows ?? 0} flashGen={awayYellowGen} style={{ marginRight: 4, gap: 1 }} /> : null}
              <span style={{ fontWeight: 400 }}>{match.away_team}</span>
              <img src={match.away_logo} loading="lazy" decoding="async" alt={match.away_team} className="team-logo" onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_AWAY; }} />
            </div>
          </div>
          <div
            className={match.status === 'NS' ? 'match-meta-row match-meta-row--pre' : 'match-meta-row'}
            aria-label={match.status === 'NS' ? 'Match status' : 'Score and status'}
          >
            {match.status === 'NS' ? (
              <StatusBadge status={match.status} />
            ) : (
              <>
                <div className="match-meta-row__score">
                  <div className="match-score-line">
                    <span
                      key={scoreFlashGen}
                      className={`match-score-line__main${scoreFlashGen ? ' flash-goal' : ''}`}
                      style={{ fontWeight: 700, fontSize: '12px', color: score ? 'var(--gray-900)' : 'var(--gray-400)', lineHeight: 1.2 }}
                    >
                      {score || '\u2014'}
                    </span>
                    {showHalftimeUnder ? (
                      <span
                        className="match-score-line__ht"
                        aria-label={`First half ${match.halftime_home}-${match.halftime_away}`}
                      >
                        {formatHalftimeParen(match)}
                      </span>
                    ) : null}
                  </div>
                  {currentMinute ? <div className="match-meta-row__min">{currentMinute}</div> : null}
                </div>
                {match.status !== 'HT' ? <StatusBadge status={match.status} /> : null}
              </>
            )}
          </div>
        </div>
      </td>
      <td className={`select-col ${isWatched ? 'select-disabled' : ''}`} data-label="Select">
        <div className="cell-value">
          <input type="checkbox" checked={isSelected} disabled={isWatched} onChange={onToggleSelect} title={isWatched ? 'Already in watchlist' : undefined} />
        </div>
      </td>
      <td data-label="Action" style={{ textAlign: 'center' }}>
        <div className="cell-value flex-row-gap-4 flex-center flex-wrap">
          {isWatched ? (
            <>
              <button
                className={`btn btn-sm watch-btn${isPlaying && !watchHovered && !isPendingRemove ? ' eye-live-pulse' : ''}`}
                onClick={isPendingRemove ? undefined : onQuickRemove}
                onMouseEnter={() => setWatchHovered(true)}
                onMouseLeave={() => setWatchHovered(false)}
                disabled={isPendingRemove}
                title={isPendingRemove ? 'Removing…' : isPlaying ? 'Analysis active — click to unwatch' : 'Click to unwatch'}
                aria-label={isPendingRemove ? 'Removing…' : 'Unwatch this match'}
                style={{
                  background: watchHovered ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                  border: `1px solid ${watchHovered ? 'rgba(239,68,68,0.35)' : 'rgba(16,185,129,0.35)'}`,
                  color: watchHovered ? '#ef4444' : '#10b981',
                  transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                }}
              >
                {isPendingRemove
                  ? <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
                  : watchHovered ? <EyeOffIcon /> : <EyeIcon checked />}
              </button>
              <button className="btn btn-secondary btn-sm action-icon-btn" onClick={onEdit} aria-label="Watch alerts and conditions" title="Watch alerts and conditions">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
              </button>
            </>
          ) : isPending ? (
            <button className="btn btn-primary btn-sm watch-btn" disabled>
              <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
            </button>
          ) : isFinished ? (
            <button className="btn btn-secondary btn-sm watch-btn" disabled title="Match is finished" aria-label="Match is finished">
              <EyeIcon />
            </button>
          ) : (
            <button className="btn btn-primary btn-sm watch-btn" onClick={onQuickAdd} title="Watch this match" aria-label="Watch this match">
              <EyeIcon />
            </button>
          )}
          <AskAiMatchSplitControl
            variant="table"
            hasResult={hasResult}
            isAnalyzing={isAnalyzing}
            isWatched={isWatched}
            onQuick={onAskAiQuick}
            onOpenQuestion={onAskAiOpenQuestion}
          />
        </div>
      </td>
    </tr>
  );
}
