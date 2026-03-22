import { useState, useEffect, useMemo, useCallback, memo, useRef, Fragment } from 'react';
import { Pagination } from '@/components/ui/Pagination';
import { LeagueFixturesDialog } from '@/components/ui/LeagueFixturesDialog';
import { LeagueProfileModal } from '@/components/ui/LeagueProfileModal';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import {
  fetchApprovedLeagues, toggleLeagueActive, bulkSetLeagueActive, fetchLeaguesFromApi,
  toggleLeagueTopLeague, bulkSetTopLeague,
  fetchLeagueProfile, saveLeagueProfile, deleteLeagueProfile,
  fetchLeagueTeams, fetchFavoriteTeams, addFavoriteTeam, removeFavoriteTeam,
  type LeagueTeam,
} from '@/lib/services/api';
import type { League, LeagueProfile } from '@/types';

// ── Constants ──

const TIER_ORDER: Record<string, number> = {
  International: 0, '1': 1, '2': 2, Cup: 3, '3': 4, Other: 5,
};

const TIER_LABELS: Record<string, string> = {
  International: 'International',
  '1': 'Tier 1',
  '2': 'Tier 2',
  '3': 'Tier 3',
  Cup: 'Cup',
  Other: 'Other',
};

const PAGE_SIZE = 50;

const TIER_COLORS: Record<string, string> = {
  International: '#8b5cf6',
  '1': '#22c55e',
  '2': '#3b82f6',
  '3': '#64748b',
  Cup: '#f59e0b',
  Other: '#94a3b8',
};

// ── Sub-components ──

interface LeagueTeamsPanelProps {
  teams: LeagueTeam[];
  loading: boolean;
  favoriteIds: Set<string>;
  onToggleFavorite: (team: LeagueTeam, isFav: boolean) => void;
}

function LeagueTeamsPanel({ teams, loading, favoriteIds, onToggleFavorite }: LeagueTeamsPanelProps) {
  if (loading) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray-400)' }}>
        <div className="loading-spinner" style={{ margin: '0 auto 8px', width: 20, height: 20 }} />
        <div style={{ fontSize: 12 }}>Loading teams…</div>
      </div>
    );
  }
  if (teams.length === 0) {
    return <div style={{ padding: '16px', fontSize: 12, color: 'var(--gray-400)', textAlign: 'center' }}>No teams found</div>;
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--gray-100)' }}>
          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--gray-400)', width: 36 }}>#</th>
          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--gray-400)' }}>Team</th>
          <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600, color: 'var(--gray-400)', width: 90 }}>Favorite</th>
          <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600, color: 'var(--gray-400)', width: 90, opacity: 0.4 }}>Push</th>
        </tr>
      </thead>
      <tbody>
        {teams.map((t) => {
          const isFav = favoriteIds.has(String(t.team.id));
          return (
            <tr key={t.team.id} style={{ borderBottom: '1px solid var(--gray-50)' }}>
              <td style={{ padding: '5px 10px', color: 'var(--gray-400)', textAlign: 'center' }}>
                {t.rank ?? '—'}
              </td>
              <td style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                {t.team.logo
                  ? <img src={t.team.logo} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} loading="lazy" />
                  : <span style={{ width: 22, height: 22, display: 'inline-block' }}>⚽</span>}
                <span style={{ fontWeight: isFav ? 600 : 400, color: isFav ? 'var(--gray-900)' : 'var(--gray-700)' }}>{t.team.name}</span>
              </td>
              <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                <button
                  onClick={() => onToggleFavorite(t, isFav)}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 18, lineHeight: 1, padding: '2px 6px',
                    color: isFav ? '#f59e0b' : 'var(--gray-300)',
                    transition: 'color 0.15s',
                  }}
                >
                  {isFav ? '⭐' : '☆'}
                </button>
              </td>
              <td style={{ padding: '5px 10px', textAlign: 'center', opacity: 0.35 }} title="Coming soon">
                <button style={{ background: 'none', border: 'none', cursor: 'not-allowed', fontSize: 16, color: 'var(--gray-300)' }} disabled>🔔</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface LeagueRowProps {
  league: League;
  onToggle: (id: number, active: boolean) => void;
  onToggleTop: (id: number, topLeague: boolean) => void;
  onViewFixtures: (league: League) => void;
  onEditProfile: (league: League) => void;
  selected: boolean;
  onSelect: (id: number) => void;
  toggling: boolean;
  togglingTop: boolean;
  teamsExpanded: boolean;
  onToggleTeams: (id: number) => void;
}

const LeagueRow = memo(function LeagueRow({ league, onToggle, onToggleTop, onViewFixtures, onEditProfile, selected, onSelect, toggling, togglingTop, teamsExpanded, onToggleTeams }: LeagueRowProps) {
  return (
    <tr className={`league-row ${league.active ? '' : 'inactive'}`}>
      <td style={{ width: 36 }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(league.league_id)}
        />
      </td>
      <td style={{ width: 42 }}>
        {league.logo ? (
          <img src={league.logo} alt="" className="league-logo" loading="lazy" />
        ) : (
          <span className="league-logo-placeholder">🏟️</span>
        )}
      </td>
      <td
        style={{ cursor: 'pointer' }}
        title="Click to view upcoming fixtures"
        onClick={() => onViewFixtures(league)}
      >
        <div className="league-name-cell">
          <span className="league-name" style={{ textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{league.league_name}</span>
          <span className="league-id">#{league.league_id}</span>
        </div>
      </td>
      <td style={{ whiteSpace: 'nowrap', width: '1%' }}>{league.country || '-'}</td>
      <td style={{ whiteSpace: 'nowrap', width: '1%' }}>
        <span className="league-tier-badge" style={{ borderColor: TIER_COLORS[league.tier] || '#94a3b8', color: TIER_COLORS[league.tier] || '#94a3b8' }}>
          {league.tier || '-'}
        </span>
      </td>
      <td style={{ whiteSpace: 'nowrap', width: '1%' }}>{league.type || '-'}</td>
      <td style={{ width: 48, textAlign: 'center' }}>
        <button
          className={`league-top-star ${league.top_league ? 'active' : ''}`}
          onClick={() => onToggleTop(league.league_id, !league.top_league)}
          disabled={togglingTop}
          title={league.top_league ? 'Remove from Top Leagues' : 'Add to Top Leagues'}
        >
          {togglingTop ? <span className="inline-spinner" style={{ width: 12, height: 12 }} /> : (league.top_league ? '⭐' : '☆')}
        </button>
      </td>
      <td style={{ width: 118, textAlign: 'center' }}>
        <button
          className="btn btn-secondary"
          onClick={() => onEditProfile(league)}
          style={{ fontSize: 11, padding: '4px 8px', whiteSpace: 'nowrap' }}
          title={league.has_profile ? 'Edit league profile' : 'Create league profile'}
        >
          {league.has_profile ? `Profile${league.profile_volatility_tier ? ` (${league.profile_volatility_tier})` : ''}` : 'Add Profile'}
        </button>
      </td>
      <td>
        <button
          className={`league-toggle ${league.active ? 'on' : 'off'}`}
          onClick={() => onToggle(league.league_id, !league.active)}
          disabled={toggling}
          title={league.active ? 'Click to deactivate' : 'Click to activate'}
        >
          {toggling ? <span className="inline-spinner" style={{ width: 12, height: 12, display: 'inline-block' }} /> : <span className="league-toggle-dot" />}
        </button>
      </td>
      <td style={{ width: 40, textAlign: 'center' }}>
        <button
          onClick={() => onToggleTeams(league.league_id)}
          title={teamsExpanded ? 'Collapse teams' : 'Show teams'}
          style={{
            background: teamsExpanded ? 'var(--gray-100)' : 'none',
            border: '1px solid var(--gray-200)',
            borderRadius: 4,
            cursor: 'pointer',
            width: 26, height: 26,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, color: teamsExpanded ? 'var(--gray-700)' : 'var(--gray-400)',
            fontWeight: 600,
          }}
        >
          {teamsExpanded ? '−' : '+'}
        </button>
      </td>
    </tr>
  );
});

const StatsBar = memo(function StatsBar({ leagues }: { leagues: League[] }) {
  const total = leagues.length;
  const active = leagues.filter((l) => l.active).length;
  const topCount = leagues.filter((l) => l.top_league).length;
  const profileCount = leagues.filter((l) => l.has_profile).length;
  const byTier = useMemo(() => {
    const map: Record<string, { total: number; active: number }> = {};
    leagues.forEach((l) => {
      const key = l.tier || 'Other';
      if (!map[key]) map[key] = { total: 0, active: 0 };
      map[key]!.total++;
      if (l.active) map[key]!.active++;
    });
    return Object.entries(map)
      .sort(([a], [b]) => (TIER_ORDER[a] ?? 99) - (TIER_ORDER[b] ?? 99));
  }, [leagues]);

  return (
    <div className="leagues-stats-bar">
      <div className="leagues-stat">
        <span className="leagues-stat-value">{total}</span>
        <span className="leagues-stat-label">Total</span>
      </div>
      <div className="leagues-stat active">
        <span className="leagues-stat-value">{active}</span>
        <span className="leagues-stat-label">Active</span>
      </div>
      <div className="leagues-stat">
        <span className="leagues-stat-value">{total - active}</span>
        <span className="leagues-stat-label">Inactive</span>
      </div>
      <div className="leagues-stat top-league">
        <span className="leagues-stat-value" style={{ color: '#f59e0b' }}>{topCount}</span>
        <span className="leagues-stat-label">Top Leagues</span>
      </div>
      <div className="leagues-stat">
        <span className="leagues-stat-value" style={{ color: '#0f766e' }}>{profileCount}</span>
        <span className="leagues-stat-label">Profiles</span>
      </div>
      <div className="leagues-stats-divider" />
      {byTier.map(([tier, counts]) => (
        <div className="leagues-stat" key={tier}>
          <span className="leagues-stat-value" style={{ color: TIER_COLORS[tier] }}>{counts.active}/{counts.total}</span>
          <span className="leagues-stat-label">{TIER_LABELS[tier] || tier}</span>
        </div>
      ))}
    </div>
  );
});

// ── Main component ──

export function LeaguesTab() {
  const { state, dispatch } = useAppState();
  const { showToast } = useToast();
  const config = state.config;

  const [allLeagues, setAllLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterTier, setFilterTier] = useState<string>('all');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterActive, setFilterActive] = useState<string>('active');
  const [page, setPage] = useState(1);
  const [filterTopLeague, setFilterTopLeague] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
  const [togglingTopIds, setTogglingTopIds] = useState<Set<number>>(new Set());
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [fixtureLeague, setFixtureLeague] = useState<League | null>(null);
  const [profileLeague, setProfileLeague] = useState<League | null>(null);
  const [profileDraft, setProfileDraft] = useState<LeagueProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Teams expansion
  const [expandedLeagueId, setExpandedLeagueId] = useState<number | null>(null);
  const [leagueTeamsCache, setLeagueTeamsCache] = useState<Record<number, LeagueTeam[]>>({});
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

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

  // Load leagues
  const loadLeagues = useCallback(async () => {
    try {
      const data = await fetchApprovedLeagues(config);
      setAllLeagues(data);
      dispatch({ type: 'SET_LEAGUES', payload: data });
    } catch (err) {
      console.error('[LeaguesTab] loadLeagues failed:', err);
      showToast('Failed to load leagues', 'error');
    } finally {
      setLoading(false);
    }
  }, [config, dispatch, showToast]);

  useEffect(() => { loadLeagues(); }, [loadLeagues]);

  // Load favorite teams on mount
  useEffect(() => {
    fetchFavoriteTeams(config)
      .then((favs) => setFavoriteIds(new Set(favs.map((f) => f.team_id))))
      .catch(() => {});
  }, [config]);

  const handleToggleTeams = useCallback(async (leagueId: number) => {
    if (expandedLeagueId === leagueId) {
      setExpandedLeagueId(null);
      return;
    }
    setExpandedLeagueId(leagueId);
    if (leagueTeamsCache[leagueId]) return; // already fetched
    setTeamsLoading(true);
    try {
      const teams = await fetchLeagueTeams(config, leagueId);
      setLeagueTeamsCache((prev) => ({ ...prev, [leagueId]: teams }));
    } catch {
      setLeagueTeamsCache((prev) => ({ ...prev, [leagueId]: [] }));
    } finally {
      setTeamsLoading(false);
    }
  }, [config, expandedLeagueId, leagueTeamsCache]);

  const handleToggleFavorite = useCallback(async (team: LeagueTeam, isFav: boolean) => {
    const teamId = String(team.team.id);
    // Optimistic update
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(teamId); else next.add(teamId);
      return next;
    });
    try {
      if (isFav) {
        await removeFavoriteTeam(config, teamId);
      } else {
        await addFavoriteTeam(config, { team_id: teamId, team_name: team.team.name, team_logo: team.team.logo });
      }
    } catch {
      // Revert on error
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.add(teamId); else next.delete(teamId);
        return next;
      });
    }
  }, [config]);

  // Filter options
  const countries = useMemo(() => {
    const set = new Set<string>();
    allLeagues.forEach((l) => { if (l.country) set.add(l.country); });
    return Array.from(set).sort();
  }, [allLeagues]);

  const tiers = useMemo(() => {
    const set = new Set<string>();
    allLeagues.forEach((l) => { if (l.tier) set.add(l.tier); });
    return Array.from(set).sort((a, b) => (TIER_ORDER[a] ?? 99) - (TIER_ORDER[b] ?? 99));
  }, [allLeagues]);

  // Filtered leagues
  const filtered = useMemo(() => {
    let data = allLeagues;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter((l) =>
        l.league_name.toLowerCase().includes(q) ||
        l.country.toLowerCase().includes(q) ||
        String(l.league_id).includes(q),
      );
    }
    if (filterTier !== 'all') data = data.filter((l) => l.tier === filterTier);
    if (filterCountry !== 'all') data = data.filter((l) => l.country === filterCountry);
    if (filterType !== 'all') data = data.filter((l) => l.type === filterType);
    if (filterActive === 'active') data = data.filter((l) => l.active);
    else if (filterActive === 'inactive') data = data.filter((l) => !l.active);
    if (filterTopLeague === 'top') data = data.filter((l) => l.top_league);
    else if (filterTopLeague === 'normal') data = data.filter((l) => !l.top_league);

    return data.sort((a, b) => {
      // Top leagues first, then by tier, then by name
      if (a.top_league !== b.top_league) return a.top_league ? -1 : 1;
      const ta = TIER_ORDER[a.tier] ?? 99;
      const tb = TIER_ORDER[b.tier] ?? 99;
      if (ta !== tb) return ta - tb;
      return a.league_name.localeCompare(b.league_name);
    });
  }, [allLeagues, search, filterTier, filterCountry, filterType, filterActive, filterTopLeague]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [search, filterTier, filterCountry, filterType, filterActive, filterTopLeague]);

  // Toggle single league
  const handleToggle = useCallback(async (id: number, active: boolean) => {
    setTogglingIds((s) => { const n = new Set(s); n.add(id); return n; });
    setAllLeagues((prev) => prev.map((l) => l.league_id === id ? { ...l, active } : l));
    try {
      await toggleLeagueActive(config, id, active);
      setAllLeagues((prev) => { dispatch({ type: 'SET_LEAGUES', payload: prev }); return prev; });
    } catch {
      setAllLeagues((prev) => prev.map((l) => l.league_id === id ? { ...l, active: !active } : l));
      showToast('Failed to toggle league', 'error');
    } finally {
      setTogglingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [config, dispatch, showToast]);

  // Bulk toggle
  const handleBulkToggle = useCallback(async (active: boolean) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    // Optimistic
    setAllLeagues((prev) => prev.map((l) => ids.includes(l.league_id) ? { ...l, active } : l));
    try {
      await bulkSetLeagueActive(config, ids, active);
      setAllLeagues((prev) => {
        dispatch({ type: 'SET_LEAGUES', payload: prev });
        return prev;
      });
      setSelectedIds(new Set());
      showToast(`${ids.length} leagues ${active ? 'activated' : 'deactivated'}`, 'success');
    } catch {
      loadLeagues();
      showToast('Failed to update leagues', 'error');
    }
  }, [config, dispatch, selectedIds, showToast, loadLeagues]);

  // Toggle single league top status
  const handleToggleTop = useCallback(async (id: number, topLeague: boolean) => {
    setTogglingTopIds((s) => { const n = new Set(s); n.add(id); return n; });
    setAllLeagues((prev) => prev.map((l) => l.league_id === id ? { ...l, top_league: topLeague } : l));
    try {
      await toggleLeagueTopLeague(config, id, topLeague);
      setAllLeagues((prev) => { dispatch({ type: 'SET_LEAGUES', payload: prev }); return prev; });
    } catch (err) {
      console.error('[LeaguesTab] toggleTop failed:', err);
      setAllLeagues((prev) => prev.map((l) => l.league_id === id ? { ...l, top_league: !topLeague } : l));
      showToast('Failed to toggle top league', 'error');
    } finally {
      setTogglingTopIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [config, dispatch, showToast]);

  // Bulk toggle top league
  const handleBulkTopLeague = useCallback(async (topLeague: boolean) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setAllLeagues((prev) => prev.map((l) => ids.includes(l.league_id) ? { ...l, top_league: topLeague } : l));
    try {
      await bulkSetTopLeague(config, ids, topLeague);
      setAllLeagues((prev) => {
        dispatch({ type: 'SET_LEAGUES', payload: prev });
        return prev;
      });
      setSelectedIds(new Set());
      showToast(`${ids.length} leagues ${topLeague ? 'added to' : 'removed from'} Top Leagues`, 'success');
    } catch (err) {
      console.error('[LeaguesTab] bulkTopLeague failed:', err);
      loadLeagues();
      showToast('Failed to update top leagues', 'error');
    }
  }, [config, dispatch, selectedIds, showToast, loadLeagues]);

  // Sync from Football API
  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await fetchLeaguesFromApi(config);
      showToast(`Synced ${result.fetched} leagues from Football API (${result.upserted} updated)`, 'success');
      await loadLeagues();
    } catch (err) {
      console.error('[LeaguesTab] sync failed:', err);
      showToast('Failed to sync from Football API', 'error');
    } finally {
      setSyncing(false);
    }
  }, [config, showToast, loadLeagues]);

  const handleEditProfile = useCallback(async (league: League) => {
    setProfileLeague(league);
    setProfileLoading(true);
    try {
      const profile = await fetchLeagueProfile(config, league.league_id);
      setProfileDraft(profile);
    } catch (err) {
      console.error('[LeaguesTab] load profile failed:', err);
      setProfileDraft(null);
      showToast('Failed to load league profile', 'error');
    } finally {
      setProfileLoading(false);
    }
  }, [config, showToast]);

  const handleSaveProfile = useCallback(async (draft: Omit<LeagueProfile, 'league_id' | 'created_at' | 'updated_at'>) => {
    if (!profileLeague) return;
    setProfileSaving(true);
    try {
      const saved = await saveLeagueProfile(config, profileLeague.league_id, draft);
      setProfileDraft(saved);
      setAllLeagues((prev) => {
        const next = prev.map((league) => league.league_id === profileLeague.league_id
          ? {
              ...league,
              has_profile: true,
              profile_updated_at: saved.updated_at,
              profile_volatility_tier: saved.volatility_tier,
              profile_data_reliability_tier: saved.data_reliability_tier,
            }
          : league);
        dispatch({ type: 'SET_LEAGUES', payload: next });
        return next;
      });
      showToast('League profile saved', 'success');
    } catch (err) {
      console.error('[LeaguesTab] save profile failed:', err);
      showToast('Failed to save league profile', 'error');
    } finally {
      setProfileSaving(false);
    }
  }, [config, dispatch, profileLeague, showToast]);

  const handleDeleteProfile = useCallback(async () => {
    if (!profileLeague) return;
    setProfileSaving(true);
    try {
      await deleteLeagueProfile(config, profileLeague.league_id);
      setProfileDraft(null);
      setAllLeagues((prev) => {
        const next = prev.map((league) => league.league_id === profileLeague.league_id
          ? {
              ...league,
              has_profile: false,
              profile_updated_at: null,
              profile_volatility_tier: null,
              profile_data_reliability_tier: null,
            }
          : league);
        dispatch({ type: 'SET_LEAGUES', payload: next });
        return next;
      });
      showToast('League profile deleted', 'success');
      setProfileLeague(null);
    } catch (err) {
      console.error('[LeaguesTab] delete profile failed:', err);
      showToast('Failed to delete league profile', 'error');
    } finally {
      setProfileSaving(false);
    }
  }, [config, dispatch, profileLeague, showToast]);

  // Select helpers
  const handleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const filteredIds = filtered.map((l) => l.league_id);
    const allSelected = filteredIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredIds));
    }
  }, [filtered, selectedIds]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selectedIds.has(l.league_id));

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray-400)' }}>
        <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
        <p>Loading leagues...</p>
      </div>
    );
  }

  return (
    <>
    <div className="card leagues-tab">
      {/* Stats bar */}
      <StatsBar leagues={allLeagues} />

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--white)' }}>
        {/* Search */}
        <div className="leagues-search" style={{ flex: '0 0 220px' }}>
          <span className="leagues-search-icon" style={{ fontSize: 13 }}>
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2"/><path d="m15 15 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </span>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search name, country, ID… ( / )"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="leagues-search-input"
          />
          {search && (
            <button className="leagues-search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>

        {/* Filters */}
        <select className="filter-input" value={filterActive} onChange={(e) => setFilterActive(e.target.value)} style={{ flex: '0 0 110px' }}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <select className="filter-input" value={filterTier} onChange={(e) => setFilterTier(e.target.value)} style={{ flex: '0 0 110px' }}>
          <option value="all">All Tiers</option>
          {tiers.map((t) => <option key={t} value={t}>{TIER_LABELS[t] || t}</option>)}
        </select>

        <select className="filter-input" value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)} style={{ flex: '0 0 130px' }}>
          <option value="all">All Countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select className="filter-input" value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ flex: '0 0 115px' }}>
          <option value="all">All Types</option>
          <option value="League">League</option>
          <option value="Cup">Cup</option>
        </select>

        <select className="filter-input" value={filterTopLeague} onChange={(e) => setFilterTopLeague(e.target.value)} style={{ flex: '0 0 120px' }}>
          <option value="all">All Leagues</option>
          <option value="top">Top Leagues</option>
          <option value="normal">Normal</option>
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 8, borderLeft: '1px solid var(--gray-100)' }}>
          <span style={{ fontSize: 12, color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>
            {filtered.length} / {allLeagues.length}
          </span>
          <button
            className="btn btn-secondary"
            onClick={handleSync}
            disabled={syncing}
            style={{ fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
          >
            {syncing ? 'Syncing…' : 'Sync API'}
          </button>
        </div>
      </div>

      {/* Contextual bulk actions */}
      {selectedIds.size > 0 && confirmDeactivate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', background: '#fff1f2', borderBottom: '1px solid #fecdd3', fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: '#b91c1c' }}>
            Deactivate {selectedIds.size} league{selectedIds.size > 1 ? 's' : ''}? This will remove them from all scans.
          </span>
          <button className="btn btn-sm btn-danger" onClick={() => { setConfirmDeactivate(false); handleBulkToggle(false); }}>Confirm</button>
          <button className="btn btn-sm btn-secondary" onClick={() => setConfirmDeactivate(false)}>Cancel</button>
        </div>
      )}
      {selectedIds.size > 0 && !confirmDeactivate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', background: '#f0f9ff', borderBottom: '1px solid #bae6fd', fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: 'var(--gray-700)', marginRight: 4 }}>{selectedIds.size} selected</span>
          <button className="btn btn-sm btn-success" onClick={() => handleBulkToggle(true)}>Activate</button>
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmDeactivate(true)}>Deactivate</button>
          <button className="btn btn-sm btn-warning" onClick={() => handleBulkTopLeague(true)}>Set Top</button>
          <button className="btn btn-sm btn-secondary" onClick={() => handleBulkTopLeague(false)}>Unset Top</button>
          <button className="btn btn-sm btn-secondary" onClick={() => { setSelectedIds(new Set()); setConfirmDeactivate(false); }} style={{ marginLeft: 'auto' }}>Clear</button>
        </div>
      )}

      {/* Pagination — top */}
      <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />

      {/* Table */}
      <div className="table-container leagues-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={handleSelectAll}
                  title="Select all visible"
                />
              </th>
              <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Logo</th>
              <th>League</th>
              <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Country</th>
              <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Tier</th>
              <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Type</th>
              <th style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'center' }}>Top</th>
              <th style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'center' }}>Profile</th>
              <th style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'center' }}>Active</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {paginated.map((league) => (
              <Fragment key={league.league_id}>
                <LeagueRow
                  league={league}
                  onToggleTop={handleToggleTop}
                  onToggle={handleToggle}
                  onViewFixtures={setFixtureLeague}
                  onEditProfile={handleEditProfile}
                  selected={selectedIds.has(league.league_id)}
                  onSelect={handleSelect}
                  toggling={togglingIds.has(league.league_id)}
                  togglingTop={togglingTopIds.has(league.league_id)}
                  teamsExpanded={expandedLeagueId === league.league_id}
                  onToggleTeams={handleToggleTeams}
                />
                {expandedLeagueId === league.league_id && (
                  <tr>
                    <td colSpan={10} style={{ padding: 0, background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)' }}>
                      <LeagueTeamsPanel
                        teams={leagueTeamsCache[league.league_id] ?? []}
                        loading={teamsLoading && !leagueTeamsCache[league.league_id]}
                        favoriteIds={favoriteIds}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
                  {search || filterTier !== 'all' || filterCountry !== 'all' || filterActive !== 'all' || filterTopLeague !== 'all'
                    ? 'No leagues match your filters'
                    : 'No leagues found. Click "Sync API" to fetch leagues.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>

    <LeagueFixturesDialog
      league={fixtureLeague}
      onClose={() => setFixtureLeague(null)}
    />
    <LeagueProfileModal
      league={profileLeague}
      profile={profileDraft}
      loading={profileLoading}
      saving={profileSaving}
      onClose={() => {
        if (profileSaving) return;
        setProfileLeague(null);
        setProfileDraft(null);
      }}
      onSave={handleSaveProfile}
      onDelete={handleDeleteProfile}
    />
    </>
  );
}
