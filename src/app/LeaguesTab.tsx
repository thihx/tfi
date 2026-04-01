import { useState, useEffect, useMemo, useCallback, memo, useRef, Fragment } from 'react';
import { Pagination } from '@/components/ui/Pagination';
import { LeagueFixturesDialog } from '@/components/ui/LeagueFixturesDialog';
import { LeagueProfileModal } from '@/components/ui/LeagueProfileModal';
import { TeamProfileModal } from '@/components/ui/TeamProfileModal';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { formatLocalDate } from '@/lib/utils/helpers';
import type { TeamProfileDraft } from '@/lib/utils/teamProfileDeepResearch';
import { isOverlayEligibleLeague } from '@/lib/utils/tacticalOverlayEligibility';
import {
  fetchLeaguesInitData, toggleLeagueActive, bulkSetLeagueActive, fetchLeaguesFromApi,
  toggleLeagueTopLeague, bulkSetTopLeague,
  fetchLeagueProfile, saveLeagueProfile, deleteLeagueProfile,
  fetchLeagueTeams, addFavoriteTeam, removeFavoriteTeam,
  fetchTeamProfile, saveTeamProfile, deleteTeamProfile,
  type LeagueTeam,
} from '@/lib/services/api';
import type { League, LeagueProfile, TeamProfile, TopLeagueProfileCoverage } from '@/types';

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
  profiledTeamIds: Set<string>;
  onToggleFavorite: (team: LeagueTeam, isFav: boolean) => void;
  onOpenTeamProfile: (team: LeagueTeam) => void;
}

// LeagueTeamsPanel renders <tr> fragments directly into the parent <tbody>
// so team columns align exactly with the league table's columns (9 cols):
//   [0] indent  [1] logo  [2] name  [3] rank  [4] —  [5] —  [6] Favorite  [7] Profile  [8] —
function LeagueTeamsPanel({ teams, loading, favoriteIds, profiledTeamIds, onToggleFavorite, onOpenTeamProfile }: LeagueTeamsPanelProps) {
  const teamRowStyle: React.CSSProperties = {
    background: 'var(--gray-50)',
    borderBottom: '1px solid var(--gray-100)',
  };
  const indentCellStyle: React.CSSProperties = {
    borderLeft: '3px solid var(--blue-200)',
    padding: 0,
    width: 36,
  };

  if (loading) {
    return (
      <tr className="league-teams-row">
        <td style={indentCellStyle} />
        <td colSpan={8} style={{ padding: '14px 10px', background: 'var(--gray-50)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-400)', fontSize: 12 }}>
            <div className="loading-spinner" style={{ width: 16, height: 16, flexShrink: 0 }} />
            Loading teams…
          </div>
        </td>
      </tr>
    );
  }
  if (teams.length === 0) {
    return (
      <>
        <tr className="league-teams-row" style={teamRowStyle}>
          <td style={indentCellStyle} />
          <td colSpan={8} style={{ padding: '12px 10px', fontSize: 12, color: 'var(--gray-400)' }}>No teams found</td>
        </tr>
        <tr className="league-teams-row">
          <td colSpan={9} style={{ padding: 0, height: 2, background: 'var(--gray-200)' }} />
        </tr>
      </>
    );
  }
  return (
    <>
      {teams.map((t) => {
        const isFav = favoriteIds.has(String(t.team.id));
        const hasProfile = profiledTeamIds.has(String(t.team.id));
        return (
          <tr key={t.team.id} className="league-teams-row" style={teamRowStyle}>
            {/* [0] indent accent */}
            <td style={indentCellStyle} />
            {/* [1] team logo */}
            <td style={{ padding: '4px 6px' }}>
              {t.team.logo
                ? <img src={t.team.logo} alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block' }} loading="lazy" />
                : <span style={{ width: 22, height: 22, display: 'inline-block', fontSize: 13 }}>⚽</span>}
            </td>
            {/* [2] team name */}
            <td style={{ padding: '4px 8px', fontSize: 13 }}>
              <span style={{ fontWeight: isFav ? 600 : 400, color: isFav ? 'var(--gray-900)' : 'var(--gray-700)', whiteSpace: 'nowrap' }}>
                {t.team.name}
              </span>
            </td>
            {/* [3] rank (country col) */}
            <td style={{ padding: '4px 8px', fontSize: 11, color: 'var(--gray-400)', textAlign: 'center', whiteSpace: 'nowrap' }}>
              {t.rank != null ? `#${t.rank}` : '—'}
            </td>
            {/* [4] tier col — empty */}
            <td />
            {/* [5] type col — empty */}
            <td />
            {/* [6] Favorite — aligns with league Favorite column */}
            <td style={{ textAlign: 'center', padding: '4px 8px' }}>
              <button
                onClick={() => onToggleFavorite(t, isFav)}
                title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 18, lineHeight: 1, padding: '2px 4px',
                  color: isFav ? '#f59e0b' : 'var(--gray-300)',
                  transition: 'color 0.15s',
                }}
              >
                {isFav
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                }
              </button>
            </td>
            {/* [7] Profile — aligns with league Profile column */}
            <td style={{ textAlign: 'center', padding: '4px 8px' }}>
              <button
                onClick={() => onOpenTeamProfile(t)}
                title={hasProfile ? 'Edit team profile' : 'Create team profile'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, lineHeight: 1, padding: '2px 4px',
                  color: hasProfile ? 'var(--blue-500, #3b82f6)' : 'var(--gray-300)',
                  transition: 'color 0.15s',
                }}
              >
                {hasProfile ? '📋' : '📄'}
              </button>
            </td>
            {/* [8] active col — empty */}
            <td />
          </tr>
        );
      })}
      {/* Bottom border to close the expanded section */}
      <tr className="league-teams-row">
        <td colSpan={9} style={{ padding: 0, height: 2, background: 'var(--gray-200)' }} />
      </tr>
    </>
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
      <td style={{ cursor: 'pointer' }} title="Click to view upcoming fixtures" onClick={() => onViewFixtures(league)}>
        <div className="league-name-cell" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="league-name">{league.league_name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleTeams(league.league_id); }}
            title={teamsExpanded ? 'Collapse teams' : 'Show teams'}
            style={{
              background: teamsExpanded ? 'var(--gray-200)' : 'none',
              border: '1px solid var(--gray-200)',
              borderRadius: 4,
              cursor: 'pointer',
              width: 20, height: 20,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, color: teamsExpanded ? 'var(--gray-700)' : 'var(--gray-400)',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {teamsExpanded ? '−' : '+'}
          </button>
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
          title={league.top_league ? 'Remove from Favorites' : 'Add to Favorites'}
        >
          {togglingTop ? <span className="inline-spinner" style={{ width: 12, height: 12 }} /> : (league.top_league
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          )}
        </button>
      </td>
      <td style={{ textAlign: 'center' }}>
        <button
          onClick={() => onEditProfile(league)}
          title={league.has_profile
            ? `Edit league profile${league.profile_updated_at ? ` · Updated ${formatLocalDate(league.profile_updated_at)}` : ''}${league.profile_volatility_tier ? ` · Volatility: ${league.profile_volatility_tier}` : ''}`
            : 'Create league profile'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, lineHeight: 1, padding: '2px 6px',
            color: league.has_profile ? 'var(--blue-500, #3b82f6)' : 'var(--gray-300)',
            transition: 'color 0.15s',
          }}
        >
          {league.has_profile ? '📋' : '📄'}
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
    </tr>
  );
});

interface StatsFilterBarProps {
  leagues: League[];
  profileCoverage: TopLeagueProfileCoverage | null;
  filterActive: string;
  filterTier: string;
  filterTopLeague: string;
  filterProfile: string;
  onFilterActive: (v: string) => void;
  onFilterTier: (v: string) => void;
  onFilterTopLeague: (v: string) => void;
  onFilterProfile: (v: string) => void;
}

const StatsBar = memo(function StatsBar({
  leagues, profileCoverage, filterActive, filterTier, filterTopLeague, filterProfile,
  onFilterActive, onFilterTier, onFilterTopLeague, onFilterProfile,
}: StatsFilterBarProps) {
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

  const isClean = filterActive === 'all' && filterTier === 'all'
    && filterTopLeague === 'all' && filterProfile === 'all';

  const handleTotal = () => {
    onFilterActive('all');
    onFilterTier('all');
    onFilterTopLeague('all');
    onFilterProfile('all');
  };

  return (
    <>
    <div className="leagues-stats-bar">

      {/* Total — resets all stat-bar filters */}
      <button
        className={`leagues-stat-btn${isClean ? ' stat-active stat-active--primary' : ''}`}
        onClick={handleTotal}
        title="Show all (reset filters)"
      >
        <span className="leagues-stat-value">{total}</span>
        <span className="leagues-stat-label">Total</span>
      </button>

      {/* Active */}
      <button
        className={`leagues-stat-btn${filterActive === 'active' ? ' stat-active stat-active--success' : ''}`}
        onClick={() => onFilterActive(filterActive === 'active' ? 'all' : 'active')}
        title="Filter: Active leagues only"
      >
        <span className="leagues-stat-value" style={{ color: 'var(--success)' }}>{active}</span>
        <span className="leagues-stat-label">Active</span>
      </button>

      {/* Inactive */}
      <button
        className={`leagues-stat-btn${filterActive === 'inactive' ? ' stat-active stat-active--gray' : ''}`}
        onClick={() => onFilterActive(filterActive === 'inactive' ? 'all' : 'inactive')}
        title="Filter: Inactive leagues only"
      >
        <span className="leagues-stat-value">{total - active}</span>
        <span className="leagues-stat-label">Inactive</span>
      </button>

      {/* Top Leagues */}
      <button
        className={`leagues-stat-btn${filterTopLeague === 'top' ? ' stat-active stat-active--amber' : ''}`}
        onClick={() => onFilterTopLeague(filterTopLeague === 'top' ? 'all' : 'top')}
        title="Filter: Favorite Leagues only"
      >
        <span className="leagues-stat-value" style={{ color: '#f59e0b' }}>{topCount}</span>
        <span className="leagues-stat-label">Favorites</span>
      </button>

      {/* Profiles */}
      <button
        className={`leagues-stat-btn${filterProfile === 'has-profile' ? ' stat-active stat-active--teal' : ''}`}
        onClick={() => onFilterProfile(filterProfile === 'has-profile' ? 'all' : 'has-profile')}
        title="Filter: Leagues with profiles only"
      >
        <span className="leagues-stat-value" style={{ color: '#0f766e' }}>{profileCount}</span>
        <span className="leagues-stat-label">Profiles</span>
      </button>

      <div className="leagues-stats-divider" />

      {/* Per-tier */}
      {byTier.map(([tier, counts]) => (
        <button
          key={tier}
          className={`leagues-stat-btn${filterTier === tier ? ' stat-active' : ''}`}
          style={filterTier === tier
            ? { '--stat-active-color': TIER_COLORS[tier] || '#64748b' } as React.CSSProperties
            : undefined}
          onClick={() => onFilterTier(filterTier === tier ? 'all' : tier)}
          title={`Filter: ${TIER_LABELS[tier] || tier}`}
        >
          <span className="leagues-stat-value" style={{ color: TIER_COLORS[tier] }}>
            {counts.active}/{counts.total}
          </span>
          <span className="leagues-stat-label">{TIER_LABELS[tier] || tier}</span>
        </button>
      ))}
    </div>
    {profileCoverage && (
      <div className="leagues-coverage-bar">
        <div className="leagues-coverage-chip">
          <span className="leagues-coverage-label">Top League Profiles</span>
          <strong>{profileCoverage.summary.topLeagueProfiles}/{profileCoverage.summary.topLeagues}</strong>
        </div>
        <div className="leagues-coverage-chip">
          <span className="leagues-coverage-label">Top Team Profiles</span>
          <strong>{profileCoverage.summary.topLeagueTeamsWithProfile}/{profileCoverage.summary.topLeagueTeams}</strong>
        </div>
        <div className="leagues-coverage-chip">
          <span className="leagues-coverage-label">Coverage</span>
          <strong>
            {profileCoverage.summary.teamProfileCoverage != null
              ? `${Math.round(profileCoverage.summary.teamProfileCoverage * 100)}%`
              : 'N/A'}
          </strong>
        </div>
        <div className="leagues-coverage-chip">
          <span className="leagues-coverage-label">Fully Covered</span>
          <strong>{profileCoverage.summary.fullCoverageLeagues}</strong>
        </div>
        <div className="leagues-coverage-chip">
          <span className="leagues-coverage-label">Coverage Gaps</span>
          <strong>{profileCoverage.summary.partialCoverageLeagues + profileCoverage.summary.missingCoverageLeagues}</strong>
        </div>
        {profileCoverage.leagues.length > 0 && (
          <div className="leagues-coverage-note">
            {(() => {
              const gaps = profileCoverage.leagues
                .filter((league) => league.missingTeamProfiles > 0 || !league.hasLeagueProfile)
                .slice(0, 3)
                .map((league) => `${league.leagueName} (${league.profiledTeams}/${league.candidateTeams})`);
              return gaps.length > 0
                ? `Gaps: ${gaps.join(' · ')}`
                : 'Top leagues currently have full profile coverage.';
            })()}
          </div>
        )}
      </div>
    )}
    </>
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
  const [filterProfile, setFilterProfile] = useState<string>('all');
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
  const [profileCoverage, setProfileCoverage] = useState<TopLeagueProfileCoverage | null>(null);

  // Team profile modal state
  const [teamProfileTarget, setTeamProfileTarget] = useState<{ teamId: string; teamName: string; leagueName: string } | null>(null);
  const [teamProfile, setTeamProfile] = useState<TeamProfile | null>(null);
  const [teamProfileLoading, setTeamProfileLoading] = useState(false);
  const [teamProfileSaving, setTeamProfileSaving] = useState(false);
  const [profiledTeamIds, setProfiledTeamIds] = useState<Set<string>>(new Set());

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

  // Load all Leagues-tab data in a single request
  const loadLeagues = useCallback(async () => {
    try {
      const { leagues, favoriteTeamIds, profiledTeamIds, profileCoverage } = await fetchLeaguesInitData(config);
      setAllLeagues(leagues);
      dispatch({ type: 'SET_LEAGUES', payload: leagues });
      setFavoriteIds(new Set(favoriteTeamIds));
      setProfiledTeamIds(new Set(profiledTeamIds));
      setProfileCoverage(profileCoverage);
    } catch (err) {
      console.error('[LeaguesTab] loadLeagues failed:', err);
      showToast('Failed to load leagues', 'error');
    } finally {
      setLoading(false);
    }
  }, [config, dispatch, showToast]);

  useEffect(() => { loadLeagues(); }, [loadLeagues]);

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

  const handleOpenTeamProfile = useCallback(async (team: LeagueTeam, leagueName: string) => {
    const teamId = String(team.team.id);
    setTeamProfileTarget({ teamId, teamName: team.team.name, leagueName });
    setTeamProfileLoading(true);
    try {
      const profile = await fetchTeamProfile(config, teamId);
      setTeamProfile(profile);
    } catch (err) {
      console.error('[LeaguesTab] load team profile failed:', err);
      setTeamProfile(null);
      showToast('Failed to load team profile', 'error');
    } finally {
      setTeamProfileLoading(false);
    }
  }, [config, showToast]);

  const handleSaveTeamProfile = useCallback(async (_teamId: string, draft: TeamProfileDraft) => {
    if (!teamProfileTarget) return;
    setTeamProfileSaving(true);
    try {
      const saved = await saveTeamProfile(config, teamProfileTarget.teamId, draft);
      setTeamProfile(saved);
      setProfiledTeamIds((prev) => new Set([...prev, teamProfileTarget.teamId]));
      void loadLeagues();
      showToast('Team profile saved', 'success');
    } catch (err) {
      console.error('[LeaguesTab] save team profile failed:', err);
      showToast('Failed to save team profile', 'error');
    } finally {
      setTeamProfileSaving(false);
    }
  }, [config, loadLeagues, teamProfileTarget, showToast]);

  const handleDeleteTeamProfile = useCallback(async () => {
    if (!teamProfileTarget) return;
    setTeamProfileSaving(true);
    try {
      await deleteTeamProfile(config, teamProfileTarget.teamId);
      setTeamProfile(null);
      setProfiledTeamIds((prev) => {
        const next = new Set(prev);
        next.delete(teamProfileTarget.teamId);
        return next;
      });
      void loadLeagues();
      showToast('Team profile deleted', 'success');
      setTeamProfileTarget(null);
    } catch (err) {
      console.error('[LeaguesTab] delete team profile failed:', err);
      showToast('Failed to delete team profile', 'error');
    } finally {
      setTeamProfileSaving(false);
    }
  }, [config, loadLeagues, teamProfileTarget, showToast]);

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
    if (filterProfile === 'has-profile') data = data.filter((l) => l.has_profile);

    return data.sort((a, b) => {
      // Top leagues first, then by tier, then by name
      if (a.top_league !== b.top_league) return a.top_league ? -1 : 1;
      const ta = TIER_ORDER[a.tier] ?? 99;
      const tb = TIER_ORDER[b.tier] ?? 99;
      if (ta !== tb) return ta - tb;
      return a.league_name.localeCompare(b.league_name);
    });
  }, [allLeagues, search, filterTier, filterCountry, filterType, filterActive, filterTopLeague, filterProfile]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [search, filterTier, filterCountry, filterType, filterActive, filterTopLeague, filterProfile]);

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
      showToast(`${ids.length} leagues ${topLeague ? 'added to' : 'removed from'} Favorites`, 'success');
    } catch (err) {
      console.error('[LeaguesTab] bulkTopLeague failed:', err);
      loadLeagues();
      showToast('Failed to update favorites', 'error');
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
              profile_volatility_tier: saved.profile.volatility_tier,
              profile_data_reliability_tier: saved.profile.data_reliability_tier,
            }
          : league);
        dispatch({ type: 'SET_LEAGUES', payload: next });
        return next;
      });
      void loadLeagues();
      showToast('League profile saved', 'success');
    } catch (err) {
      console.error('[LeaguesTab] save profile failed:', err);
      showToast('Failed to save league profile', 'error');
    } finally {
      setProfileSaving(false);
    }
  }, [config, dispatch, loadLeagues, profileLeague, showToast]);

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
      void loadLeagues();
      showToast('League profile deleted', 'success');
      setProfileLeague(null);
    } catch (err) {
      console.error('[LeaguesTab] delete profile failed:', err);
      showToast('Failed to delete league profile', 'error');
    } finally {
      setProfileSaving(false);
    }
  }, [config, dispatch, loadLeagues, profileLeague, showToast]);

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
      {/* Stats bar — doubles as quick-filter buttons */}
      <StatsBar
        leagues={allLeagues}
        profileCoverage={profileCoverage}
        filterActive={filterActive}
        filterTier={filterTier}
        filterTopLeague={filterTopLeague}
        filterProfile={filterProfile}
        onFilterActive={setFilterActive}
        onFilterTier={setFilterTier}
        onFilterTopLeague={setFilterTopLeague}
        onFilterProfile={setFilterProfile}
      />

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
          <option value="top">Favorites</option>
          <option value="normal">Non-Favorites</option>
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
          <button className="btn btn-sm btn-warning" onClick={() => handleBulkTopLeague(true)}>Add to Favorites</button>
          <button className="btn btn-sm btn-secondary" onClick={() => handleBulkTopLeague(false)}>Remove from Favorites</button>
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
              <th style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'center' }}>Favorite</th>
              <th style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'center' }}>Profile</th>
              <th style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'center' }}>Active</th>
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
                  <LeagueTeamsPanel
                    teams={leagueTeamsCache[league.league_id] ?? []}
                    loading={teamsLoading && !leagueTeamsCache[league.league_id]}
                    favoriteIds={favoriteIds}
                    profiledTeamIds={profiledTeamIds}
                    onToggleFavorite={handleToggleFavorite}
                    onOpenTeamProfile={(team) => handleOpenTeamProfile(team, league.league_name)}
                  />
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
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
      key={profileLeague ? `${profileLeague.league_id}:${profileDraft?.updated_at ?? 'draft'}` : 'league-profile-modal'}
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
    <TeamProfileModal
      key={teamProfileTarget ? `${teamProfileTarget.teamId}:${teamProfile?.updated_at ?? 'draft'}` : 'team-profile-modal'}
      team={teamProfileTarget ? { id: teamProfileTarget.teamId, name: teamProfileTarget.teamName } : null}
      leagueName={teamProfileTarget?.leagueName}
      overlayEligible={isOverlayEligibleLeague(allLeagues.find((league) => league.league_name === teamProfileTarget?.leagueName))}
      profile={teamProfile}
      loading={teamProfileLoading}
      saving={teamProfileSaving}
      onClose={() => {
        if (teamProfileSaving) return;
        setTeamProfileTarget(null);
        setTeamProfile(null);
      }}
      onSave={handleSaveTeamProfile}
      onDelete={handleDeleteTeamProfile}
    />
    </>
  );
}
