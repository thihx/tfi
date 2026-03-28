/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { AppConfig, Match, WatchlistItem, League } from '@/types';
import { loadConfig, saveConfig as persistConfig } from '@/config/config';
import * as api from '@/lib/services/api';
import { useToast } from '@/hooks/useToast';

// ==================== State ====================
interface AppState {
  config: AppConfig;
  matches: Match[];
  watchlist: WatchlistItem[];
  leagues: League[];
  loading: boolean;
  loadingProgress: number;
  loadingMessage: string;
}

type Action =
  | { type: 'SET_CONFIG'; payload: AppConfig }
  | { type: 'SET_MATCHES'; payload: Match[] }
  | { type: 'MERGE_MATCHES'; payload: Match[] }
  | { type: 'SET_WATCHLIST'; payload: WatchlistItem[] }
  | { type: 'SET_LEAGUES'; payload: League[] }
  | { type: 'SET_LOADING'; payload: { loading: boolean; progress?: number; message?: string } }
  | { type: 'ADD_WATCHLIST_ITEMS'; payload: WatchlistItem[] }
  | { type: 'UPDATE_WATCHLIST_ITEM'; payload: Partial<WatchlistItem> & { match_id: string } }
  | { type: 'REMOVE_WATCHLIST_ITEMS'; payload: string[] };

const initialState: AppState = {
  config: loadConfig(),
  matches: [],
  watchlist: [],
  leagues: [],
  loading: false,
  loadingProgress: 0,
  loadingMessage: '',
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CONFIG':
      return { ...state, config: action.payload };
    case 'SET_MATCHES':
      return { ...state, matches: action.payload };
    case 'MERGE_MATCHES': {
      // Update existing matches in-place; append new ones; preserve order so rows don't jump.
      const incoming = new Map(action.payload.map((m) => [String(m.match_id), m]));
      let changed = false;
      const merged = state.matches.map((existing) => {
        const fresh = incoming.get(String(existing.match_id));
        if (!fresh) return existing;
        incoming.delete(String(existing.match_id)); // mark as handled
        // Bidirectional compare: union of both objects' keys to catch added AND dropped fields.
        // Using String() coercion so DB number vs JS string (e.g. current_minute: 14 vs "14")
        // doesn't create a false-equal that hides a real type mismatch from a prior poll.
        const allKeys = new Set([
          ...Object.keys(existing),
          ...Object.keys(fresh),
        ]) as Set<keyof Match>;
        const isDiff = Array.from(allKeys).some(
          (k) => String(existing[k] ?? '') !== String(fresh[k] ?? ''),
        );
        if (!isDiff) return existing;
        changed = true;
        return fresh;
      });
      // Append genuinely new matches (match_id not previously in state)
      const appended = [...merged, ...Array.from(incoming.values())];
      if (!changed && appended.length === state.matches.length) return state; // nothing changed
      return { ...state, matches: appended };
    }
    case 'SET_WATCHLIST':
      return { ...state, watchlist: action.payload };
    case 'SET_LEAGUES':
      return { ...state, leagues: action.payload };
    case 'SET_LOADING':
      return {
        ...state,
        loading: action.payload.loading,
        loadingProgress: action.payload.progress ?? state.loadingProgress,
        loadingMessage: action.payload.message ?? state.loadingMessage,
      };
    case 'ADD_WATCHLIST_ITEMS':
      return { ...state, watchlist: [...state.watchlist, ...action.payload] };
    case 'UPDATE_WATCHLIST_ITEM': {
      const idx = state.watchlist.findIndex((w) => w.match_id === action.payload.match_id);
      if (idx === -1) return state;
      const updated = [...state.watchlist];
      updated[idx] = { ...updated[idx]!, ...action.payload };
      return { ...state, watchlist: updated };
    }
    case 'REMOVE_WATCHLIST_ITEMS':
      return {
        ...state,
        watchlist: state.watchlist.filter((w) => !action.payload.includes(w.match_id)),
      };
    default:
      return state;
  }
}

// ==================== Context ====================
interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  loadAllData: (silent?: boolean) => Promise<void>;
  refreshMatches: () => Promise<void>;
  saveConfig: (config: AppConfig) => void;
  addToWatchlist: (items: Partial<WatchlistItem>[]) => Promise<boolean>;
  updateWatchlistItem: (item: Partial<WatchlistItem> & { match_id: string }) => Promise<boolean>;
  removeFromWatchlist: (matchIds: string[]) => Promise<boolean>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const { showToast } = useToast();

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const resolveWatchSubscription = useCallback(async (config: AppConfig, matchId: string): Promise<WatchlistItem | null> => {
    const localItem = stateRef.current.watchlist.find((watchItem) => watchItem.match_id === matchId);
    if (localItem && typeof localItem.id === 'number' && localItem.id > 0) {
      return localItem;
    }

    try {
      return await api.fetchWatchlistItem(config, matchId);
    } catch {
      return null;
    }
  }, []);

  const loadAllData = useCallback(async (silent = false) => {
    const config = stateRef.current.config;
    if (!silent) {
      dispatch({ type: 'SET_LOADING', payload: { loading: true, progress: 15, message: 'Loading...' } });
    }

    const errors: string[] = [];

    // All 3 calls in parallel — no sequential dependency
    const [leagues, matches, watchlist] = await Promise.all([
      api.fetchActiveLeagues(config).catch((err: unknown) => {
        errors.push('leagues');
        console.error('[AppState] fetchActiveLeagues failed:', err);
        return [] as League[];
      }),
      api.fetchMatches(config).catch((err: unknown) => {
        errors.push('matches');
        console.error('[AppState] fetchMatches failed:', err);
        return [] as Match[];
      }),
      api.fetchWatchlist(config).catch((err: unknown) => {
        errors.push('watchlist');
        console.error('[AppState] fetchWatchlist failed:', err);
        return [] as WatchlistItem[];
      }),
    ]);

    dispatch({ type: 'SET_LEAGUES', payload: leagues });
    dispatch({ type: 'SET_MATCHES', payload: matches });
    dispatch({ type: 'SET_WATCHLIST', payload: watchlist });

    if (errors.length > 0 && !silent) {
      showToast(`Failed to load: ${errors.join(', ')}. Check network or API.`, 'error');
    }

    if (!silent) {
      dispatch({ type: 'SET_LOADING', payload: { loading: false, progress: 100, message: '' } });
    }
  }, [showToast]);

  // Lightweight live-poll refresh: only fetch matches, merge into existing state.
  // Avoids replacing the entire array reference (which re-renders all rows) and
  // avoids unnecessary leagues/watchlist round-trips.
  const refreshMatches = useCallback(async () => {
    const config = stateRef.current.config;
    try {
      const matches = await api.fetchMatches(config);
      dispatch({ type: 'MERGE_MATCHES', payload: matches });
    } catch { /* silent — interval will retry */ }
  }, []);

  const saveConfigFn = useCallback((config: AppConfig) => {
    persistConfig(config);
    dispatch({ type: 'SET_CONFIG', payload: config });
  }, []);

  const addToWatchlist = useCallback(async (items: Partial<WatchlistItem>[]): Promise<boolean> => {
    const config = stateRef.current.config;
    // Optimistic update
    const optimistic = items.map((i) => ({
      match_id: i.match_id || '',
      date: i.date || '',
      league: i.league || '',
      home_team: i.home_team || '',
      away_team: i.away_team || '',
      kickoff: i.kickoff || '',
      mode: i.mode || config.defaultMode,
      priority: i.priority || 2,
      custom_conditions: i.custom_conditions || '',
      status: 'active',
      added_at: new Date().toISOString(),
    }));
    dispatch({ type: 'ADD_WATCHLIST_ITEMS', payload: optimistic });

    try {
      const result = await api.createWatchlistItems(config, items);
      if (result.insertedCount && result.insertedCount > 0) {
        // Reload to get server state
        const fresh = await api.fetchWatchlist(config);
        dispatch({ type: 'SET_WATCHLIST', payload: fresh });
        return true;
      }
      // Rollback
      dispatch({ type: 'REMOVE_WATCHLIST_ITEMS', payload: optimistic.map((i) => i.match_id) });
      return false;
    } catch {
      dispatch({ type: 'REMOVE_WATCHLIST_ITEMS', payload: optimistic.map((i) => i.match_id) });
      return false;
    }
  }, []);

  const updateWatchlistItem = useCallback(
    async (item: Partial<WatchlistItem> & { match_id: string }): Promise<boolean> => {
      const config = stateRef.current.config;
      const previous = stateRef.current.watchlist.find((w) => w.match_id === item.match_id);
      dispatch({ type: 'UPDATE_WATCHLIST_ITEM', payload: item });

      try {
        const requestItem = previous ? { ...previous, ...item } : item;
        const resolvedItem = typeof requestItem.id === 'number' && requestItem.id > 0
          ? requestItem
          : await resolveWatchSubscription(config, item.match_id);
        const canonicalRequestItem = resolvedItem
          ? { ...resolvedItem, ...requestItem, id: resolvedItem.id }
          : requestItem;
        const result = await api.updateWatchlistItems(config, [canonicalRequestItem]);
        if (result.updatedCount && result.updatedCount > 0) return true;
        if (previous) dispatch({ type: 'UPDATE_WATCHLIST_ITEM', payload: previous });
        return false;
      } catch {
        if (previous) dispatch({ type: 'UPDATE_WATCHLIST_ITEM', payload: previous });
        return false;
      }
    },
    [resolveWatchSubscription],
  );

  const removeFromWatchlist = useCallback(async (matchIds: string[]): Promise<boolean> => {
    const config = stateRef.current.config;
    const previous = stateRef.current.watchlist.filter((w) => matchIds.includes(w.match_id));
    dispatch({ type: 'REMOVE_WATCHLIST_ITEMS', payload: matchIds });

    try {
      const previousByMatchId = new Map(previous.map((item) => [item.match_id, item] as const));
      const unresolvedMatchIds = matchIds.filter((matchId) => {
        const watchItem = previousByMatchId.get(matchId);
        return !(watchItem && typeof watchItem.id === 'number' && watchItem.id > 0);
      });
      const resolvedByMatchId = new Map<string, WatchlistItem>();

      if (unresolvedMatchIds.length > 0) {
        try {
          const freshWatchlist = await api.fetchWatchlist(config);
          freshWatchlist.forEach((watchItem) => {
            if (unresolvedMatchIds.includes(watchItem.match_id)) {
              resolvedByMatchId.set(watchItem.match_id, watchItem);
            }
          });
        } catch {
          // Keep compatibility delete fallback for unresolved items.
        }
      }

      const deleteTargets = matchIds.map((matchId) => {
        const watchItem = previousByMatchId.get(matchId) ?? resolvedByMatchId.get(matchId);
        if (watchItem && typeof watchItem.id === 'number' && watchItem.id > 0) {
          return { id: watchItem.id, match_id: watchItem.match_id };
        }
        return null;
      });
      if (deleteTargets.some((target) => target == null)) {
        dispatch({ type: 'ADD_WATCHLIST_ITEMS', payload: previous });
        return false;
      }

      const result = await api.deleteWatchlistItems(
        config,
        deleteTargets.filter((target): target is { id: number; match_id: string } => target != null),
      );
      if (result.deletedCount !== undefined && result.deletedCount >= 0) return true;
      dispatch({ type: 'ADD_WATCHLIST_ITEMS', payload: previous });
      return false;
    } catch {
      dispatch({ type: 'ADD_WATCHLIST_ITEMS', payload: previous });
      return false;
    }
  }, []);

  return (
    <AppContext.Provider
      value={{ state, dispatch, loadAllData, refreshMatches, saveConfig: saveConfigFn, addToWatchlist, updateWatchlistItem, removeFromWatchlist }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}
