import React, { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
import { formatHalftimeParen, formatMatchClock, shouldShowHalftimeUnderScore } from '@/lib/utils/matchScoreDisplay';
import { DisciplineCardIcons } from '@/components/ui/MatchDisciplineCardIcons';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AiAnalysisPanel, type AiAnalysisPanelEntry } from '@/components/ui/AiAnalysisPanel';
import { AskAiMatchDialog } from '@/components/ui/AskAiMatchDialog';
import { AskAiMatchSplitControl } from '@/components/ui/AskAiMatchSplitControl';
import { MatchCard } from '@/components/ui/MatchCard';
import { MatchLiveStreamControls } from '@/components/ui/MatchLiveStreamControls';
import { WatchlistEditModal } from '@/components/ui/WatchlistEditModal';
import { LIVE_STATUSES, PLACEHOLDER_HOME, PLACEHOLDER_AWAY, TFI_FOCUS_MATCH_IN_MATCHES_EVENT } from '@/config/constants';
import { formatDateTimeDisplay, getKickoffDateKey, getKickoffDateTime, getLeagueDisplayName, debounce, parseKickoffForSave, shouldFastRefreshMatch, normalizeToISO, countEligibleWatchlistCandidates, isNarrowTabViewport } from '@/lib/utils/helpers';
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
import {
  applyFavoriteLeaguesToWatchlist,
  createMatchAlertRule,
  deleteMatchAlertRule,
  fetchConditionAlertPresets,
  fetchFavoriteLeagueSelection,
  fetchMatchAlertRules,
  lookupMatchLiveStreams,
  type MatchLiveStreamLink,
  type MatchLiveStreamLookupResult,
} from '@/lib/services/api';
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

function BellIcon({ active }: { active?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}>
      <line x1="4" y1="21" x2="4" y2="14"/>
      <line x1="4" y1="10" x2="4" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12" y2="3"/>
      <line x1="20" y1="21" x2="20" y2="16"/>
      <line x1="20" y1="12" x2="20" y2="3"/>
      <line x1="1" y1="14" x2="7" y2="14"/>
      <line x1="9" y1="8" x2="15" y2="8"/>
      <line x1="17" y1="16" x2="23" y2="16"/>
    </svg>
  );
}

// Statuses where the ball is actually in play (excludes HT, BT, INT breaks)
const PLAYING_STATUSES = new Set(['1H', '2H', 'ET', 'P', 'LIVE']);

// Statuses where the match is definitively over — block adding to watchlist
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD']);
const NOT_STARTED_STATUSES = new Set(['NS', 'TBD', 'TIME']);

// ── Module-level store — persists across tab navigation ──────────────────────
type AiResultEntry = AiAnalysisPanelEntry;
const _matchesTabStore = {
  analyzingMatches: new Set<string>(),
  aiResults: new Map<string, AiResultEntry>(),
};

const PAGE_SIZE = 30;
const LIVE_STREAM_RETRY_MS = 2 * 60_000;
const LIVE_STREAM_FOUND_REFRESH_MS = 3 * 60_000;

/** DOM id for `document.getElementById` when scrolling to a match from push / hub modal */
function tfiMatchAnchorId(matchId: string): string {
  return `tfi-match-${String(matchId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

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

function areFavoriteLeagueIdsEqual(a: number[], b: number[]): boolean {
  const left = normalizeFavoriteLeagueIds(a).slice().sort((x, y) => x - y);
  const right = normalizeFavoriteLeagueIds(b).slice().sort((x, y) => x - y);
  return left.length === right.length && left.every((id, index) => id === right[index]);
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

export function shouldShowKickoffAlertAction(match: Match, now = Date.now()): boolean {
  const status = String(match.status || '').toUpperCase();
  if (NOT_STARTED_STATUSES.has(status)) return true;
  if (PLAYING_STATUSES.has(status) || LIVE_STATUSES.includes(status) || FINISHED_STATUSES.has(status)) return false;
  if (match.home_score != null || match.away_score != null || match.current_minute) return false;
  const kickoff = getMatchKickoffTime(match).getTime();
  return Number.isFinite(kickoff) && kickoff > now;
}

function shouldRefreshLiveStreamLookup(result: MatchLiveStreamLookupResult | undefined, now = Date.now()): boolean {
  if (!result) return true;
  const checkedAtMs = Date.parse(result.checkedAt);
  if (!Number.isFinite(checkedAtMs)) return true;
  const refreshMs = result.found ? LIVE_STREAM_FOUND_REFRESH_MS : LIVE_STREAM_RETRY_MS;
  return now - checkedAtMs >= refreshMs;
}

function isMatchLiveForStream(match: Match): boolean {
  return LIVE_STATUSES.includes(String(match.status || '').toUpperCase());
}

function getLiveStreamLinks(result: MatchLiveStreamLookupResult | undefined): MatchLiveStreamLink[] {
  if (!result?.found) return [];
  if (result.links?.length) return result.links;
  if (!result.url) return [];
  return [{
    url: result.url,
    sourceName: result.sourceName || 'source site',
    sourceUrl: result.sourceUrl || result.url,
    title: result.title || 'Live stream',
    verificationStatus: 'reachable',
    liveHint: false,
  }];
}

export function MatchesTab() {
  const { state, addToWatchlist, updateWatchlistItem, removeFromWatchlist, loadAllData, refreshMatches } = useAppState();
  const { showToast } = useToast();
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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
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
  const [matchFocusTick, setMatchFocusTick] = useState(0);
  const [matchStartAlertRules, setMatchStartAlertRules] = useState<Map<string, number>>(new Map());
  const [pendingMatchStartAlerts, setPendingMatchStartAlerts] = useState<Set<string>>(new Set());
  const [liveStreamLinks, setLiveStreamLinks] = useState<Map<string, MatchLiveStreamLookupResult>>(new Map());
  const [pendingLiveStreamLookups, setPendingLiveStreamLookups] = useState<Set<string>>(new Set());
  const [liveStreamLookupTick, setLiveStreamLookupTick] = useState(0);
  const aiResultsRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [filterBarBottom, setFilterBarBottom] = useState(240);
  const liveStreamLinksRef = useRef(liveStreamLinks);
  const pendingLiveStreamLookupsRef = useRef(pendingLiveStreamLookups);

  useEffect(() => {
    liveStreamLinksRef.current = liveStreamLinks;
  }, [liveStreamLinks]);

  useEffect(() => {
    pendingLiveStreamLookupsRef.current = pendingLiveStreamLookups;
  }, [pendingLiveStreamLookups]);

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

  const openLiveStream = useCallback((link: MatchLiveStreamLink | undefined) => {
    if (!link?.url) {
      showToast('No live stream link found yet', 'info');
      return;
    }
    window.open(link.url, '_blank', 'noopener,noreferrer');
  }, [showToast]);

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

  useEffect(() => {
    let cancelled = false;
    void fetchMatchAlertRules(config, { alertKind: 'match_start' })
      .then((rules) => {
        if (cancelled) return;
        const next = new Map<string, number>();
        for (const rule of rules) {
          if (rule.enabled && rule.matchId) next.set(String(rule.matchId), rule.id);
        }
        setMatchStartAlertRules(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [config]);

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

  // Merge-refresh from GET /api/matches while this tab is mounted: live scores (2s) + list hygiene (10s) so removals/status FT stay in sync without full reload.
  useEffect(() => {
    const fast = window.setInterval(() => {
      const now = Date.now();
      if (allMatchesRef.current.some((m) => shouldAutoRefreshMatch(m, now))) {
        void refreshMatchesRef.current();
      }
    }, 2000);
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
    leagues.forEach((league) => {
      const key = String(league.league_id);
      map.set(key, {
        id: key,
        displayName: getLeagueDisplayName(league.league_id, league.league_name || '', leagues),
        count: 0,
        isTop: topIds.has(key),
      });
    });
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
        country: (league.country || '').trim(),
        leagueName: (league.display_name?.trim() || league.league_name || '').trim(),
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

  const favoriteDraftUnchanged = useMemo(
    () => areFavoriteLeagueIdsEqual(favoriteDraftIds, effectiveFavoriteLeagueIds),
    [favoriteDraftIds, effectiveFavoriteLeagueIds],
  );

  const favoriteWatchlistPreview = useMemo(() => {
    const normalizedDraft = normalizeFavoriteLeagueIds(favoriteDraftIds);
    const watchedMatchIds = new Set(watchlist.map((item) => String(item.match_id)));
    return countEligibleWatchlistCandidates(matches, normalizedDraft, watchedMatchIds);
  }, [favoriteDraftIds, matches, watchlist]);

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
  const liveStreamLookupMatchIds = useMemo(
    () => pageItems.filter(isMatchLiveForStream).map((match) => String(match.match_id)).join('|'),
    [pageItems],
  );
  allMatchesRef.current = matches;

  // Keep refs in sync so scroll handler always reads latest values
  safePageRef.current = safePage;
  totalPagesRef.current = totalPages;

  const filteredRef = useRef(filtered);
  useEffect(() => {
    filteredRef.current = filtered;
  }, [filtered]);

  useEffect(() => {
    const now = Date.now();
    const matchIds = liveStreamLookupMatchIds
      .split('|')
      .filter(Boolean)
      .filter((matchId) => (
        !pendingLiveStreamLookupsRef.current.has(matchId)
        && shouldRefreshLiveStreamLookup(liveStreamLinksRef.current.get(matchId), now)
      ));

    if (matchIds.length === 0) return;
    let cancelled = false;

    setPendingLiveStreamLookups((prev) => {
      const next = new Set(prev);
      matchIds.forEach((matchId) => next.add(matchId));
      return next;
    });

    lookupMatchLiveStreams(config, matchIds)
      .then((results) => {
        if (cancelled) return;
        setLiveStreamLinks((prev) => {
          const next = new Map(prev);
          results.forEach((result) => next.set(result.matchId, result));
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        const checkedAt = new Date().toISOString();
        setLiveStreamLinks((prev) => {
          const next = new Map(prev);
          matchIds.forEach((matchId) => next.set(matchId, {
            matchId,
            found: false,
            status: 'error',
            url: null,
            sourceName: null,
            sourceUrl: null,
            title: null,
            links: [],
            checkedAt,
          }));
          return next;
        });
      })
      .finally(() => {
        if (cancelled) return;
        setPendingLiveStreamLookups((prev) => {
          const next = new Set(prev);
          matchIds.forEach((matchId) => next.delete(matchId));
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [liveStreamLookupMatchIds, config, liveStreamLookupTick]);

  useEffect(() => {
    const hasLiveMatch = pageItems.some(isMatchLiveForStream);
    if (!hasLiveMatch) return;
    const tid = window.setTimeout(() => setLiveStreamLookupTick((tick) => tick + 1), LIVE_STREAM_RETRY_MS);
    return () => window.clearTimeout(tid);
  }, [pageItems, liveStreamLinks, liveStreamLookupTick]);

  const pendingFocusMatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    const onFocusMatch = (e: Event) => {
      const mid = String((e as CustomEvent<{ matchId?: string }>).detail?.matchId ?? '').trim();
      if (!mid) return;
      const list = filteredRef.current;
      const idx = list.findIndex((m) => String(m.match_id) === mid);
      if (idx < 0) return;
      const totalP = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      const targetPage = Math.min(Math.floor(idx / PAGE_SIZE) + 1, totalP);
      pendingFocusMatchIdRef.current = mid;
      setPage(targetPage);
      setMatchFocusTick((t) => t + 1);
    };
    window.addEventListener(TFI_FOCUS_MATCH_IN_MATCHES_EVENT, onFocusMatch as EventListener);
    return () => window.removeEventListener(TFI_FOCUS_MATCH_IN_MATCHES_EVENT, onFocusMatch as EventListener);
  }, []);

  useLayoutEffect(() => {
    const mid = pendingFocusMatchIdRef.current;
    if (!mid) return;
    if (!pageItems.some((m) => String(m.match_id) === mid)) return;
    const domId = tfiMatchAnchorId(mid);
    const el = document.getElementById(domId);
    if (!el) return;
    pendingFocusMatchIdRef.current = null;
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    const prevOutline = el.style.outline;
    el.style.outline = '2px solid var(--primary)';
    const tid = window.setTimeout(() => {
      if (el.isConnected) el.style.outline = prevOutline;
    }, 2200);
    return () => window.clearTimeout(tid);
  }, [pageItems, viewMode, matchFocusTick]);

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

  const toggleMatchStartAlert = useCallback(async (m: Match) => {
    const mid = String(m.match_id);
    if (!shouldShowKickoffAlertAction(m)) {
      showToast('Kickoff alerts are only available before the match starts', 'error');
      return;
    }
    if (pendingMatchStartAlerts.has(mid)) return;
    const existingRuleId = matchStartAlertRules.get(mid);
    setPendingMatchStartAlerts((prev) => new Set(prev).add(mid));
    try {
      if (existingRuleId) {
        await deleteMatchAlertRule(config, existingRuleId);
        setMatchStartAlertRules((prev) => {
          const next = new Map(prev);
          next.delete(mid);
          return next;
        });
        showToast('Kickoff alert removed', 'info');
      } else {
        const rule = await createMatchAlertRule(config, {
          matchId: mid,
          alertKind: 'match_start',
          source: 'manual',
          metadata: {
            matchDisplay: `${m.home_team} vs ${m.away_team}`,
            league: m.league_name,
          },
        });
        setMatchStartAlertRules((prev) => new Map(prev).set(mid, rule.id));
        showToast('Kickoff alert enabled', 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update kickoff alert', 'error');
    } finally {
      setPendingMatchStartAlerts((prev) => {
        const next = new Set(prev);
        next.delete(mid);
        return next;
      });
    }
  }, [config, matchStartAlertRules, pendingMatchStartAlerts, showToast]);

  const executeAskAiPipeline = useCallback(async (m: Match, opts?: { question?: string }) => {
    const mid = String(m.match_id);
    setAnalyzingMatches((prev) => new Set(prev).add(mid));
    showToast(`Analyzing ${m.home_team} vs ${m.away_team}...`, 'info');

    try {
      const matchResult = await analyzeMatchWithServerPipeline(config, mid, {
        question: opts?.question?.trim() || undefined,
        history: [],
        advisoryOnly: false,
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
        advisoryOnly: true,
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
  const hasActiveFilters = !!(search || statusFilter || leagueFilter || actionFilter || dateFrom || dateTo);
  const toolbarFilterCount = [statusFilter, leagueFilter, actionFilter, dateFrom, dateTo].filter(Boolean).length;

  const activeFilterChips = useMemo((): ActiveFilterChip[] => {
    const chips: ActiveFilterChip[] = [];
    if (debouncedSearch) {
      chips.push({
        key: 'search',
        label: `Teams: ${debouncedSearch}`,
        onRemove: () => { setSearch(''); setDebouncedSearch(''); },
      });
    }
    if (statusFilter) {
      const statusLabel = statusFilter === 'NS' ? 'Not Started' : statusFilter === 'LIVE' ? 'Live' : statusFilter;
      chips.push({ key: 'status', label: `Status: ${statusLabel}`, onRemove: () => setStatusFilter('') });
    }
    if (leagueFilter) {
      if (leagueFilter === LEAGUE_FILTER_FAVORITES_VALUE) {
        chips.push({ key: 'league', label: 'League: Favorite Leagues', onRemove: () => setLeagueFilter('') });
      } else {
        const op = leagueOptions.find((l) => l.id === leagueFilter);
        chips.push({ key: 'league', label: `League: ${op?.displayName || leagueFilter}`, onRemove: () => setLeagueFilter('') });
      }
    }
    if (actionFilter) {
      const actionLabel = actionFilter === 'watched' ? 'Watched' : actionFilter === 'not-watched' ? 'Not Watched' : actionFilter;
      chips.push({ key: 'action', label: `Action: ${actionLabel}`, onRemove: () => setActionFilter('') });
    }
    if (dateFrom || dateTo) {
      chips.push({
        key: 'date',
        label: `Date: ${dateFrom || '—'} → ${dateTo || '—'}`,
        onRemove: () => { setDateFrom(''); setDateTo(''); },
      });
    }
    return chips;
  }, [debouncedSearch, statusFilter, leagueFilter, actionFilter, dateFrom, dateTo, leagueOptions]);

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
    <div
      className="card tab-page-card"
      style={{ '--group-sticky-top': `${filterBarBottom}px`, '--filter-bar-bottom': `${filterBarBottom}px` } as React.CSSProperties}
    >
      {/* Sticky filter bar */}
      <div className="sticky-filter-bar" ref={filterBarRef}>
        {/* Date tab shortcuts */}
        <div className="date-tab-bar">
          <button type="button" className={`date-tab-btn${activeDateTab === 'all' ? ' date-tab-btn--active' : ''}`} onClick={() => { setDateFrom(''); setDateTo(''); }}>All</button>
          <button type="button" className={`date-tab-btn${activeDateTab === 'yesterday' ? ' date-tab-btn--active' : ''}`} onClick={() => { setDateFrom(dateYesterday); setDateTo(dateYesterday); }}>Yesterday</button>
          <button type="button" className={`date-tab-btn${activeDateTab === 'today' ? ' date-tab-btn--active' : ''}`} onClick={() => { setDateFrom(dateToday); setDateTo(dateToday); }}>Today</button>
          <button type="button" className={`date-tab-btn${activeDateTab === 'tomorrow' ? ' date-tab-btn--active' : ''}`} onClick={() => { setDateFrom(dateTomorrow); setDateTo(dateTomorrow); }}>Tomorrow</button>
          {favoriteFeatureVisible && (
            <button
              type="button"
              onClick={handleOpenFavoritePicker}
              title="Choose favorite leagues and add their eligible matches to your watchlist"
              className={`date-tab-bar__chip${effectiveFavoriteLeagueIds.length > 0 ? ' date-tab-bar__chip--active' : ''}`}
            >
              <span className="date-tab-bar__chip-label--long">+ Watchlist by Favorite Leagues</span>
              <span className="date-tab-bar__chip-label--short">+ Fav Leagues</span>
            </button>
          )}
        </div>
        <div className="page-toolbar">
        <div className="page-toolbar__filters filters tab-page-toolbar-filters">
          <input ref={searchRef} id="filter-search" type="text" className="filter-input" placeholder="Search teams… ( / )" value={search} onChange={(e) => handleSearchChange(e.target.value)} />
          <button
            type="button"
            className="btn btn-secondary tab-filter-sheet-btn tab-toolbar-mobile-only"
            onClick={() => setFilterSheetOpen(true)}
            aria-label={`Open filters${toolbarFilterCount > 0 ? `, ${toolbarFilterCount} active` : ''}`}
          >
            Filters{toolbarFilterCount > 0 ? ` (${toolbarFilterCount})` : ''}
          </button>
          <div className="tab-page-filters-inline">
          <select id="filter-status" className="filter-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="NS">Not Started</option>
            <option value="LIVE">Live</option>
          </select>
          <select id="filter-league" className="filter-input" value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}>
            <option value="">All Leagues</option>
            {favoriteFeatureVisible && (
              <option value={LEAGUE_FILTER_FAVORITES_VALUE}>Favorite Leagues</option>
            )}
            {leagueOptions.map((l) => <option key={l.id} value={l.id}>{l.displayName} ({l.count})</option>)}
          </select>
          <select id="filter-action" className="filter-input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            <option value="not-watched">Not Watched</option>
            <option value="watched">Watched</option>
          </select>
          <DatePicker id="filter-from" className="filter-input" value={dateFrom} onChange={setDateFrom} title="From date" placeholder="From date" />
          <DatePicker id="filter-to" className="filter-input" value={dateTo} onChange={setDateTo} title="To date" placeholder="To date" />
          {hasActiveFilters && (
            <button className="btn btn-secondary" onClick={clearFilters}>Clear</button>
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
          <BulkActionBar count={selected.size} variant="info" onClear={() => setSelected(new Set())}>
            <button type="button" className="btn btn-primary btn-sm" onClick={addSelectedToWatchlist}>+ Add to Watchlist</button>
          </BulkActionBar>
        )}
      </div>

      {/* AI Result Panels */}
      {aiResults.size > 0 && (
        <div ref={aiResultsRef} className="ai-results-stack">
          {aiResults.size > 1 && (
            <div className="ai-results-stack__toolbar">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setAiResults(() => new Map())}
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
          className="tab-panel tab-panel--cards"
          style={
            safePage === totalPages && totalPages > 1 && pageItems.length > 0
              ? { paddingBottom: `calc(var(--space-4) + ${LAST_PAGE_BOTTOM_FUDGE})` }
              : undefined
          }
        >
          {pageItems.length === 0 ? (
            <EmptyState
              title="No matches found"
              action={<button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear Filters</button>}
            />
          ) : (
            <div className="card-grid">
              {pageItems.map((m) => {
                const matchId = String(m.match_id);
                const liveStream = liveStreamLinks.get(matchId);
                const liveStreamActionLinks = isMatchLiveForStream(m) ? getLiveStreamLinks(liveStream) : [];
                return (
                <div key={m.match_id} id={tfiMatchAnchorId(String(m.match_id))} className="card-grid__item card-grid__item--match">
                <div className="card-grid__item-layout">
                {liveStreamActionLinks.length > 0 ? (
                  <MatchLiveStreamControls
                    links={liveStreamActionLinks}
                    onOpen={openLiveStream}
                    className="match-live-stream-controls--card"
                  />
                ) : null}
                <MatchCard
                  match={m}
                  onClick={() => setScoutMatch(m)}
                  highlighted={selected.has(String(m.match_id))}
                  flashMap={flashMap}
                  watchedAction={watchlistMap.has(String(m.match_id)) ? {
                    onRemove: () => quickRemove(m),
                    isPendingRemove: pendingRemoves.has(String(m.match_id)),
                    isPlaying: PLAYING_STATUSES.has(m.status),
                  } : undefined}
                  actions={[
                    ...(shouldShowKickoffAlertAction(m) ? [{
                      label: matchStartAlertRules.has(String(m.match_id)) ? 'Alert On' : 'Alert',
                      icon: pendingMatchStartAlerts.has(String(m.match_id))
                        ? <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
                        : <BellIcon active={matchStartAlertRules.has(String(m.match_id))} />,
                      title: matchStartAlertRules.has(String(m.match_id)) ? 'Kickoff alert enabled' : 'Notify when match starts',
                      onClick: (match: Match) => void toggleMatchStartAlert(match),
                      disabled: pendingMatchStartAlerts.has(String(m.match_id)),
                      variant: 'secondary' as const,
                    }] : []),
                    ...(watchlistMap.has(String(m.match_id))
                      ? [
                          { label: 'Rules', icon: <SlidersIcon />, title: 'Watch alerts and conditions', onClick: (match: Match) => { const entry = watchlistMap.get(String(match.match_id)); if (entry) setEditItem(entry); }, variant: 'secondary' as const },
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
                </div>
                </div>
                );
              })}
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
              <th className="data-table__th--sortable" onClick={() => handleSort('time')}>Time {sortIndicator('time')}</th>
              <th className="data-table__th--sortable data-table__th--center" onClick={() => handleSort('league')}>League {sortIndicator('league')}</th>
              <th className="data-table__th--sortable data-table__th--center" onClick={() => handleSort('status')} title="Sort by match status">
                Match {sortIndicator('status')}
              </th>
              <th style={{ width: 40, textAlign: 'center' }}>
                <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} />
              </th>
              <th className="data-table__th--sortable data-table__th--center" onClick={() => handleSort('action')}>Action {sortIndicator('action')}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={5}>
                <EmptyState
                  title="No matches found"
                  action={<button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear Filters</button>}
                />
              </td></tr>
            ) : (() => {
              const rows: React.ReactNode[] = [];
              let lastLabel = '';
              pageItems.forEach((m) => {
                const matchId = String(m.match_id);
                const label = getDateGroupLabelInTimeZone(getMatchKickoffTime(m), effectiveTimeZone);
                if (label !== lastLabel) {
                  lastLabel = label;
                  rows.push(<tr key={`grp-${label}`} className="date-group-row"><td colSpan={5}>{label}</td></tr>);
                }
                rows.push(
                  <MatchRow
                    key={m.match_id}
                    anchorId={tfiMatchAnchorId(String(m.match_id))}
                    match={m}
                    isWatched={watchlistMap.has(String(m.match_id))}
                    isPending={pendingAdds.has(String(m.match_id))}
                    isPendingRemove={pendingRemoves.has(String(m.match_id))}
                    hasMatchStartAlert={matchStartAlertRules.has(String(m.match_id))}
                    isPendingMatchStartAlert={pendingMatchStartAlerts.has(String(m.match_id))}
                    canShowMatchStartAlert={shouldShowKickoffAlertAction(m)}
                    isSelected={selected.has(String(m.match_id))}
                    isAnalyzing={analyzingMatches.has(String(m.match_id))}
                    hasResult={aiResults.has(String(m.match_id))}
                    liveStream={liveStreamLinks.get(matchId)}
                    leagues={leagues}
                    flashMap={flashMap}
                    onQuickAdd={() => quickAdd(m)}
                    onQuickRemove={() => quickRemove(m)}
                    onToggleMatchStartAlert={() => toggleMatchStartAlert(m)}
                    onToggleSelect={() => toggleSelect(String(m.match_id), watchlistMap.has(String(m.match_id)))}
                    onAskAiQuick={() => askAiQuick(m)}
                    onAskAiOpenQuestion={() => askAiOpenQuestionDialog(m)}
                    onEdit={() => { const entry = watchlistMap.get(String(m.match_id)); if (entry) setEditItem(entry); }}
                    onOpenHub={() => setScoutMatch(m)}
                    onOpenLiveStream={(link) => openLiveStream(link)}
                  />
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
        onClose={() => setEditItem(null)}
        onSave={async ({ custom_conditions, auto_apply_recommended_condition, notify_enabled, condition_preset_ids }) => {
          if (!editItem) return;
          let conditionAlertSyncFailed = false;
          const ok = await updateWatchlistItem({
            id: editItem.id,
            match_id: editItem.match_id,
            custom_conditions,
            auto_apply_recommended_condition,
            notify_enabled,
          });
          if (ok && condition_preset_ids) {
            const selectedPresetIds = notify_enabled === false ? new Set<string>() : new Set(condition_preset_ids);
            const existingConditionRules = await fetchMatchAlertRules(config, {
              matchId: String(editItem.match_id),
              alertKind: 'condition_signal',
            }).catch(() => {
              conditionAlertSyncFailed = true;
              return [];
            });
            const presetDefaults = new Map(
              (await fetchConditionAlertPresets(config).catch(() => {
                conditionAlertSyncFailed = true;
                return [];
              })).map((preset) => [preset.id, preset] as const),
            );
            const existingPresetRules = existingConditionRules.filter((rule) => rule.source.startsWith('preset:'));
            const existingPresetIds = new Set(
              existingPresetRules.map((rule) => rule.source.slice('preset:'.length)),
            );
            await Promise.all(
              existingPresetRules
                .filter((rule) => !selectedPresetIds.has(rule.source.slice('preset:'.length)))
                .map((rule) => deleteMatchAlertRule(config, rule.id).catch(() => {
                  conditionAlertSyncFailed = true;
                  return null;
                })),
            );
            await Promise.all(
              Array.from(selectedPresetIds)
                .filter((presetId) => !existingPresetIds.has(presetId))
                .map((presetId) => {
                  const preset = presetDefaults.get(presetId);
                  return createMatchAlertRule(config, {
                    matchId: String(editItem.match_id),
                    alertKind: 'condition_signal',
                    source: `preset:${presetId}`,
                    presetId,
                    cooldownMinutes: preset?.defaultCooldownMinutes,
                    oncePerMatch: preset?.defaultOncePerMatch,
                    metadata: {
                      watchSubscriptionId: editItem.id,
                      matchDisplay: `${editItem.home_team} vs ${editItem.away_team}`,
                    },
                  }).catch(() => {
                    conditionAlertSyncFailed = true;
                    return null;
                  });
                }),
            );

            const existingFreeTextRules = existingConditionRules.filter((rule) => rule.source === 'manual:free_text');
            await Promise.all(
              existingFreeTextRules.map((rule) => deleteMatchAlertRule(config, rule.id).catch(() => {
                conditionAlertSyncFailed = true;
                return null;
              })),
            );
            const trimmedConditions = custom_conditions.trim();
            if (notify_enabled !== false && trimmedConditions) {
              await createMatchAlertRule(config, {
                matchId: String(editItem.match_id),
                alertKind: 'condition_signal',
                source: 'manual:free_text',
                conditionText: trimmedConditions,
                cooldownMinutes: 10,
                oncePerMatch: true,
                metadata: {
                  watchSubscriptionId: editItem.id,
                  matchDisplay: `${editItem.home_team} vs ${editItem.away_team}`,
                },
              }).catch(() => {
                conditionAlertSyncFailed = true;
                return null;
              });
            }
          }
          setEditItem(null);
          if (ok) showToast(
            conditionAlertSyncFailed
              ? 'Watchlist saved, but one condition alert could not be synced'
              : 'Watchlist item updated',
            conditionAlertSyncFailed ? 'error' : 'success',
          );
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
            <button
              className="btn btn-primary"
              onClick={saveFavoriteLeagues}
              disabled={savingFavoriteLeagues || favoriteDraftUnchanged}
              title={favoriteDraftUnchanged ? 'No changes to save' : undefined}
            >
              {savingFavoriteLeagues ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      >
        <div className="watchlist-favorite-leagues-picker">
          <p className="watchlist-favorite-leagues-picker__desc">
            Choose your favorite leagues. Save updates your selection and adds eligible upcoming or live matches from those leagues to your watchlist — across all dates, not just the filter on this tab.
            {!userBypassesFavoriteLeagueLimits && favoriteLeaguesLimit != null && (
              <span className="watchlist-favorite-leagues-picker__limit"> Up to {favoriteLeaguesLimit} allowed.</span>
            )}
          </p>

          {favoriteDraftIds.length > 0 && (
            <p className="watchlist-favorite-leagues-picker__preview" aria-live="polite">
              {favoriteWatchlistPreview.newMatches > 0 ? (
                <>
                  About <strong>{favoriteWatchlistPreview.newMatches}</strong> new match{favoriteWatchlistPreview.newMatches === 1 ? '' : 'es'} will be added
                  {favoriteWatchlistPreview.eligible > favoriteWatchlistPreview.newMatches
                    ? ` (${favoriteWatchlistPreview.eligible - favoriteWatchlistPreview.newMatches} already in watchlist)`
                    : ''}.
                </>
              ) : favoriteWatchlistPreview.eligible > 0 ? (
                <>All {favoriteWatchlistPreview.eligible} eligible match{favoriteWatchlistPreview.eligible === 1 ? '' : 'es'} from these leagues are already in your watchlist.</>
              ) : (
                <>No eligible matches found for the selected leagues right now.</>
              )}
            </p>
          )}

          <div className="watchlist-favorite-leagues-picker__toolbar">
            <span className={`watchlist-favorite-leagues-picker__count${favoriteDraftIds.length > 0 ? ' watchlist-favorite-leagues-picker__count--active' : ''}`}>
              {favoriteDraftIds.length} / {favoriteLeagueChoices.length} selected
            </span>
            <button
              type="button"
              className="watchlist-favorite-leagues-picker__toggle"
              onClick={() => {
                const allIds = favoriteLeagueChoices
                  .map((l) => l.id)
                  .slice(0, userBypassesFavoriteLeagueLimits || favoriteLeaguesLimit == null ? favoriteLeagueChoices.length : favoriteLeaguesLimit);
                const allSelected = allIds.every((id) => favoriteDraftIds.includes(id));
                setFavoriteDraftIds(allSelected ? [] : allIds);
              }}
              disabled={savingFavoriteLeagues}
            >
              {favoriteLeagueChoices
                .map((l) => l.id)
                .slice(0, userBypassesFavoriteLeagueLimits || favoriteLeaguesLimit == null ? favoriteLeagueChoices.length : favoriteLeaguesLimit)
                .every((id) => favoriteDraftIds.includes(id))
                ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="watchlist-favorite-leagues-picker__grid">
            {favoriteLeagueChoices.map((league) => {
              const checked = favoriteDraftIds.includes(league.id);
              return (
                <label
                  key={league.id}
                  className={`watchlist-favorite-league-choice${checked ? ' watchlist-favorite-league-choice--checked' : ''}`}
                >
                  <span className="watchlist-favorite-league-choice__check" aria-hidden="true">
                    {checked && (
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="2 6 5 9 10 3"/>
                      </svg>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFavoriteDraftLeague(league.id)}
                    className="watchlist-favorite-league-choice__input"
                    aria-label={league.leagueName || league.displayName}
                  />
                  {league.logo && (
                    <img
                      src={league.logo}
                      alt=""
                      width="18"
                      height="18"
                      className="watchlist-favorite-league-choice__logo"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <span className="watchlist-favorite-league-choice__text">
                    {league.country && (
                      <span className="watchlist-favorite-league-choice__country">{league.country}</span>
                    )}
                    <span className="watchlist-favorite-league-choice__name">{league.leagueName || league.displayName}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </Modal>

      <Modal
        open={filterSheetOpen}
        title="Match filters"
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
            <span className="leagues-filter-sheet__label">Status</span>
            <select className="filter-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="NS">Not Started</option>
              <option value="LIVE">Live</option>
            </select>
          </label>
          <label className="leagues-filter-sheet__field">
            <span className="leagues-filter-sheet__label">League</span>
            <select className="filter-input" value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}>
              <option value="">All Leagues</option>
              {favoriteFeatureVisible && (
                <option value={LEAGUE_FILTER_FAVORITES_VALUE}>Favorite Leagues</option>
              )}
              {leagueOptions.map((l) => <option key={l.id} value={l.id}>{l.displayName} ({l.count})</option>)}
            </select>
          </label>
          <label className="leagues-filter-sheet__field">
            <span className="leagues-filter-sheet__label">Action</span>
            <select className="filter-input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">All Actions</option>
              <option value="not-watched">Not Watched</option>
              <option value="watched">Watched</option>
            </select>
          </label>
          <label className="leagues-filter-sheet__field">
            <span className="leagues-filter-sheet__label">From date</span>
            <DatePicker className="filter-input" value={dateFrom} onChange={setDateFrom} title="From date" placeholder="From date" />
          </label>
          <label className="leagues-filter-sheet__field">
            <span className="leagues-filter-sheet__label">To date</span>
            <DatePicker className="filter-input" value={dateTo} onChange={setDateTo} title="To date" placeholder="To date" />
          </label>
        </div>
      </Modal>
    </div>
  );
}

interface MatchRowProps {
  anchorId: string;
  match: Match;
  isWatched: boolean;
  isPending: boolean;
  isPendingRemove: boolean;
  hasMatchStartAlert: boolean;
  isPendingMatchStartAlert: boolean;
  canShowMatchStartAlert: boolean;
  isSelected: boolean;
  isAnalyzing: boolean;
  hasResult: boolean;
  liveStream?: MatchLiveStreamLookupResult;
  leagues: League[];
  flashMap: Map<string, number>;
  onQuickAdd: () => void;
  onQuickRemove: () => void;
  onToggleMatchStartAlert: () => void;
  onToggleSelect: () => void;
  onAskAiQuick: () => void;
  onAskAiOpenQuestion: () => void;
  onEdit: () => void;
  onOpenHub: () => void;
  onOpenLiveStream: (link: MatchLiveStreamLink) => void;
}

function MatchRow({ anchorId, match, isWatched, isPending, isPendingRemove, hasMatchStartAlert, isPendingMatchStartAlert, canShowMatchStartAlert, isSelected, isAnalyzing, hasResult, liveStream, leagues, flashMap, onQuickAdd, onQuickRemove, onToggleMatchStartAlert, onToggleSelect, onAskAiQuick, onAskAiOpenQuestion, onEdit, onOpenHub, onOpenLiveStream }: MatchRowProps) {
  const [watchHovered, setWatchHovered] = React.useState(false);
  const isPlaying = PLAYING_STATUSES.has(match.status);
  const isFinished = FINISHED_STATUSES.has(match.status);
  const liveStreamActionLinks = getLiveStreamLinks(liveStream);
  const localDT = getMatchKickoffTime(match);
  const timeDisplay = formatDateTimeDisplay(localDT);
  const leagueDisplay = getLeagueDisplayName(match.league_id, match.league_name || '', leagues);
  const score = match.home_score != null && match.home_score !== '' ? `${match.home_score} - ${match.away_score}` : '';
  const currentMinute = formatMatchClock(match);
  const showHalftimeUnder = shouldShowHalftimeUnderScore(match);

  const id = match.match_id;
  const scoreFlashGen   = flashMap.get(`${id}:score`) ?? 0;
  const homeYellowGen   = flashMap.get(`${id}:hy`)    ?? 0;
  const awayYellowGen   = flashMap.get(`${id}:ay`)    ?? 0;
  const homeRedGen      = flashMap.get(`${id}:hr`)    ?? 0;
  const awayRedGen      = flashMap.get(`${id}:ar`)    ?? 0;

  const handleRowActivate = (e: React.MouseEvent<HTMLTableRowElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, select, details, summary')) return;
    onOpenHub();
  };

  return (
    <tr
      id={anchorId}
      onClick={(e) => { if (isNarrowTabViewport()) handleRowActivate(e); }}
      onDoubleClick={() => { if (!isNarrowTabViewport()) onOpenHub(); }}
      className={LIVE_STATUSES.includes(match.status) ? 'match-is-live' : undefined}
      style={{ cursor: 'pointer' }}
      title="Tap or double-click to view match details"
    >
      <td data-label="Time" style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
        <div className="cell-value">
          <span className="time-pill" style={{ background: 'var(--gray-200)', padding: '3px 7px', borderRadius: '4px', fontWeight: 600, color: 'var(--gray-900)', fontSize: '12px' }}>{timeDisplay}</span>
        </div>
      </td>
      <td data-label="League" style={{ textAlign: 'center' }}><div className="cell-value"><span style={{ fontWeight: 400 }}>{leagueDisplay}</span></div></td>
      <td data-label="Match" style={{ textAlign: 'center' }}>
        <div className="cell-value match-cell">
          <div className="match-cell__layout">
            <MatchLiveStreamControls links={liveStreamActionLinks} onOpen={onOpenLiveStream} />
            <div className="match-cell__body">
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
            className={NOT_STARTED_STATUSES.has(match.status) ? 'match-meta-row match-meta-row--pre' : 'match-meta-row'}
            aria-label={NOT_STARTED_STATUSES.has(match.status) ? 'Match details' : 'Score and status'}
          >
            {!NOT_STARTED_STATUSES.has(match.status) ? (
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
            ) : null}
          </div>
            </div>
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
          {canShowMatchStartAlert ? (
            <button
              className="btn btn-secondary btn-sm action-icon-btn"
              onClick={onToggleMatchStartAlert}
              disabled={isPendingMatchStartAlert}
              aria-label={hasMatchStartAlert ? 'Disable kickoff alert' : 'Enable kickoff alert'}
              title={hasMatchStartAlert ? 'Kickoff alert enabled' : 'Notify when match starts'}
              style={{
                color: hasMatchStartAlert ? '#047857' : undefined,
                borderColor: hasMatchStartAlert ? 'rgba(4,120,87,0.35)' : undefined,
                background: hasMatchStartAlert ? 'rgba(4,120,87,0.10)' : undefined,
              }}
            >
              {isPendingMatchStartAlert
                ? <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
                : <BellIcon active={hasMatchStartAlert} />}
            </button>
          ) : null}
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
                <SlidersIcon />
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
