import { createContext, useContext, useReducer, useCallback, useRef, type ReactNode } from 'react';
import type { AppConfig, Match, WatchlistItem, Recommendation, League } from '@/types';
import { loadConfig, saveConfig as persistConfig } from '@/config/config';
import * as api from '@/lib/services/api';
import { useToast } from '@/hooks/useToast';

// ==================== State ====================
interface AppState {
  config: AppConfig;
  matches: Match[];
  watchlist: WatchlistItem[];
  recommendations: Recommendation[];
  leagues: League[];
  loading: boolean;
  loadingProgress: number;
  loadingMessage: string;
}

type Action =
  | { type: 'SET_CONFIG'; payload: AppConfig }
  | { type: 'SET_MATCHES'; payload: Match[] }
  | { type: 'SET_WATCHLIST'; payload: WatchlistItem[] }
  | { type: 'SET_RECOMMENDATIONS'; payload: Recommendation[] }
  | { type: 'SET_LEAGUES'; payload: League[] }
  | { type: 'SET_LOADING'; payload: { loading: boolean; progress?: number; message?: string } }
  | { type: 'ADD_WATCHLIST_ITEMS'; payload: WatchlistItem[] }
  | { type: 'UPDATE_WATCHLIST_ITEM'; payload: Partial<WatchlistItem> & { match_id: string } }
  | { type: 'REMOVE_WATCHLIST_ITEMS'; payload: string[] };

const initialState: AppState = {
  config: loadConfig(),
  matches: [],
  watchlist: [],
  recommendations: [],
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
    case 'SET_WATCHLIST':
      return { ...state, watchlist: action.payload };
    case 'SET_RECOMMENDATIONS':
      return { ...state, recommendations: action.payload };
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
  saveConfig: (config: AppConfig) => void;
  addToWatchlist: (items: Partial<WatchlistItem>[]) => Promise<boolean>;
  updateWatchlistItem: (item: Partial<WatchlistItem> & { match_id: string }) => Promise<boolean>;
  removeFromWatchlist: (matchIds: string[]) => Promise<boolean>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { showToast } = useToast();

  const loadAllData = useCallback(async (silent = false) => {
    const config = stateRef.current.config;
    if (!silent) {
      dispatch({ type: 'SET_LOADING', payload: { loading: true, progress: 15, message: 'Loading...' } });
    }

    const errors: string[] = [];

    // All 4 calls in parallel — no sequential dependency
    const [leagues, matches, watchlist, recommendations] = await Promise.all([
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
      api.fetchRecommendations(config).catch((err: unknown) => {
        errors.push('recommendations');
        console.error('[AppState] fetchRecommendations failed:', err);
        return [] as Recommendation[];
      }),
    ]);

    dispatch({ type: 'SET_LEAGUES', payload: leagues });
    dispatch({ type: 'SET_MATCHES', payload: matches });
    dispatch({ type: 'SET_WATCHLIST', payload: watchlist });
    dispatch({ type: 'SET_RECOMMENDATIONS', payload: recommendations });

    if (errors.length > 0 && !silent) {
      showToast(`Failed to load: ${errors.join(', ')}. Check network or API.`, 'error');
    }

    if (!silent) {
      dispatch({ type: 'SET_LOADING', payload: { loading: false, progress: 100, message: '' } });
    }
  }, [showToast]);

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
        const result = await api.updateWatchlistItems(config, [item]);
        if (result.updatedCount && result.updatedCount > 0) return true;
        if (previous) dispatch({ type: 'UPDATE_WATCHLIST_ITEM', payload: previous });
        return false;
      } catch {
        if (previous) dispatch({ type: 'UPDATE_WATCHLIST_ITEM', payload: previous });
        return false;
      }
    },
    [],
  );

  const removeFromWatchlist = useCallback(async (matchIds: string[]): Promise<boolean> => {
    const config = stateRef.current.config;
    const previous = stateRef.current.watchlist.filter((w) => matchIds.includes(w.match_id));
    dispatch({ type: 'REMOVE_WATCHLIST_ITEMS', payload: matchIds });

    try {
      const result = await api.deleteWatchlistItems(config, matchIds);
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
      value={{ state, dispatch, loadAllData, saveConfig: saveConfigFn, addToWatchlist, updateWatchlistItem, removeFromWatchlist }}
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
