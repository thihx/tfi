import { useState, useEffect, useMemo, useCallback, memo, useRef, Fragment } from 'react';
import { Pagination } from '@/components/ui/Pagination';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import { LeagueFixturesDialog } from '@/components/ui/LeagueFixturesDialog';
import { LeagueProfileModal } from '@/components/ui/LeagueProfileModal';
import { TeamProfileModal } from '@/components/ui/TeamProfileModal';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { formatLocalDate } from '@/lib/utils/helpers';
import type { TeamProfileDraft } from '@/lib/utils/teamProfileDeepResearch';
import { isOverlayEligibleLeague } from '@/lib/utils/tacticalOverlayEligibility';
import {
  fetchLeaguesInitData, fetchLeaguesProfileCoverage, fetchApprovedLeagues, toggleLeagueActive, bulkSetLeagueActive,
  toggleLeagueTopLeague, bulkSetTopLeague,
  updateLeagueDisplayName, reorderLeaguesCatalog,
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

/** API/cache may return league_id as string; keep sort/move logic stable. */
function leagueIdNum(id: unknown): number {
  if (typeof id === 'bigint') {
    const n = Number(id);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = typeof id === 'number' ? id : Number(String(id).trim());
  return Number.isFinite(n) ? n : NaN;
}

function activeLeagueSnapshot(leagues: League[]): League[] {
  return leagues.filter((league) => league.active === true);
}

function sortOrderNum(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
}

/** Full-catalog order (matches DB ordering intent). */
function sortedLeagueIds(leagues: League[]): number[] {
  return [...leagues]
    .sort(
      (a, b) =>
        sortOrderNum(a.sort_order) - sortOrderNum(b.sort_order)
        || String(a.league_name ?? '').localeCompare(String(b.league_name ?? '')),
    )
    .map((l) => leagueIdNum(l.league_id))
    .filter((id) => !Number.isNaN(id));
}

/**
 * From a global index, find the next index in `dir` whose league is in `visible`.
 * Used so ↑/↓ swaps leagues that are still shown under the current filters (e.g. Active-only).
 */
function findNeighborVisibleIndex(
  globalIds: number[],
  fromIdx: number,
  dir: -1 | 1,
  visible: Set<number>,
): number {
  let j = fromIdx + dir;
  while (j >= 0 && j < globalIds.length) {
    if (visible.has(globalIds[j]!)) return j;
    j += dir;
  }
  return -1;
}

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
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveOrder: (id: number, dir: -1 | 1) => void;
  onSaveDisplayName: (league: League, draft: string) => void | Promise<void>;
}

const LeagueRow = memo(function LeagueRow({
  league,
  onToggle,
  onToggleTop,
  onViewFixtures,
  onEditProfile,
  selected,
  onSelect,
  toggling,
  togglingTop,
  teamsExpanded,
  onToggleTeams,
  canMoveUp,
  canMoveDown,
  onMoveOrder,
  onSaveDisplayName,
}: LeagueRowProps) {
  const [nameDraft, setNameDraft] = useState(() => league.display_name ?? '');
  useEffect(() => {
    setNameDraft(league.display_name ?? '');
  }, [league.league_id, league.display_name]);

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
      <td style={{ width: 44, textAlign: 'center', verticalAlign: 'middle' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!canMoveUp}
            title="Move up in list"
            aria-label="Move league up"
            style={{ padding: '1px 6px', minWidth: 28, lineHeight: 1.1 }}
            onClick={(e) => {
              e.stopPropagation();
              onMoveOrder(leagueIdNum(league.league_id), -1);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!canMoveDown}
            title="Move down in list"
            aria-label="Move league down"
            style={{ padding: '1px 6px', minWidth: 28, lineHeight: 1.1 }}
            onClick={(e) => {
              e.stopPropagation();
              onMoveOrder(leagueIdNum(league.league_id), 1);
            }}
          >
            ↓
          </button>
        </div>
      </td>
      <td style={{ cursor: 'pointer' }} title="Click to view upcoming fixtures" onClick={() => onViewFixtures(league)}>
        <div className="league-name-cell" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <input
              type="text"
              className="filter-input"
              placeholder={league.league_name}
              value={nameDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => { void onSaveDisplayName(league, nameDraft); }}
              title="Display name (optional). Provider name is shown below."
              style={{ fontSize: 13, fontWeight: 600, maxWidth: 280, flex: '1 1 160px', minWidth: 120 }}
            />
            <button
              type="button"
              className="league-teams-toggle"
              onClick={(e) => { e.stopPropagation(); onToggleTeams(league.league_id); }}
              title={teamsExpanded ? 'Collapse team list' : 'Show teams in this league'}
              aria-expanded={teamsExpanded}
              aria-label={teamsExpanded ? 'Collapse team list' : 'Show teams in this league'}
              style={{
                background: teamsExpanded ? 'var(--gray-200)' : 'none',
                border: '1px solid var(--gray-200)',
                borderRadius: 6,
                cursor: 'pointer',
                width: 28,
                height: 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                lineHeight: 1,
                color: teamsExpanded ? 'var(--gray-800)' : 'var(--primary, #2563eb)',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {teamsExpanded ? '−' : '+'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--gray-400)', lineHeight: 1.3 }}>
            Provider: {league.league_name}
          </div>
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

interface LeagueMobileCardProps {
  league: League;
  selected: boolean;
  toggling: boolean;
  togglingTop: boolean;
  teamsExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: (id: number) => void;
  onToggle: (id: number, active: boolean) => void;
  onToggleTop: (id: number, topLeague: boolean) => void;
  onViewFixtures: (league: League) => void;
  onEditProfile: (league: League) => void;
  onToggleTeams: (id: number) => void;
  onMoveOrder: (id: number, dir: -1 | 1) => void;
  onRename: (league: League) => void;
}

function leagueDisplayName(league: League): string {
  return league.display_name?.trim() || league.league_name;
}

const LeagueMobileCard = memo(function LeagueMobileCard({
  league,
  selected,
  toggling,
  togglingTop,
  teamsExpanded,
  canMoveUp,
  canMoveDown,
  onSelect,
  onToggle,
  onToggleTop,
  onViewFixtures,
  onEditProfile,
  onToggleTeams,
  onMoveOrder,
  onRename,
}: LeagueMobileCardProps) {
  const tierColor = TIER_COLORS[league.tier] || '#94a3b8';
  const id = leagueIdNum(league.league_id);

  return (
    <article className={`league-mobile-card${league.active ? '' : ' league-mobile-card--inactive'}`}>
      <div className="league-mobile-card__header">
        <label className="league-mobile-card__select">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(id)}
            aria-label={`Select ${leagueDisplayName(league)}`}
          />
        </label>
        <div className="league-mobile-card__logo">
          {league.logo
            ? <img src={league.logo} alt="" className="league-logo" loading="lazy" />
            : <span className="league-logo-placeholder">🏟️</span>}
        </div>
        <button type="button" className="league-mobile-card__title" onClick={() => onViewFixtures(league)}>
          <span className="league-mobile-card__name">{leagueDisplayName(league)}</span>
          {league.display_name?.trim() && (
            <span className="league-mobile-card__provider">Provider: {league.league_name}</span>
          )}
        </button>
        <button
          type="button"
          className={`league-toggle ${league.active ? 'on' : 'off'}`}
          onClick={() => onToggle(id, !league.active)}
          disabled={toggling}
          aria-label={league.active ? 'Deactivate league' : 'Activate league'}
        >
          {toggling
            ? <span className="inline-spinner" style={{ width: 12, height: 12, display: 'inline-block' }} />
            : <span className="league-toggle-dot" />}
        </button>
      </div>
      <div className="league-mobile-card__meta">
        <span>{league.country || '—'}</span>
        <span className="league-mobile-card__sep" aria-hidden>·</span>
        <span className="league-tier-badge" style={{ borderColor: tierColor, color: tierColor }}>{league.tier || '—'}</span>
        <span className="league-mobile-card__sep" aria-hidden>·</span>
        <span>{league.type || '—'}</span>
        {league.has_profile && (
          <>
            <span className="league-mobile-card__sep" aria-hidden>·</span>
            <span className="league-mobile-card__profile-tag">Profile</span>
          </>
        )}
      </div>
      <div className="league-mobile-card__actions">
        <button type="button" className="league-mobile-card__action" disabled={!canMoveUp} onClick={() => onMoveOrder(id, -1)} aria-label="Move league up">↑</button>
        <button type="button" className="league-mobile-card__action" disabled={!canMoveDown} onClick={() => onMoveOrder(id, 1)} aria-label="Move league down">↓</button>
        <button type="button" className={`league-mobile-card__action league-mobile-card__action--teams${teamsExpanded ? ' is-active' : ''}`} onClick={() => onToggleTeams(id)} aria-expanded={teamsExpanded}>{teamsExpanded ? 'Teams −' : 'Teams +'}</button>
        <button type="button" className="league-mobile-card__action" onClick={() => onRename(league)}>Rename</button>
        <button type="button" className="league-mobile-card__action" onClick={() => onViewFixtures(league)}>Fixtures</button>
        <button type="button" className={`league-mobile-card__action league-mobile-card__action--star${league.top_league ? ' is-active' : ''}`} onClick={() => onToggleTop(id, !league.top_league)} disabled={togglingTop}>{togglingTop ? '…' : (league.top_league ? '★ Fav' : '☆ Fav')}</button>
        <button type="button" className={`league-mobile-card__action${league.has_profile ? ' is-active' : ''}`} onClick={() => onEditProfile(league)}>{league.has_profile ? 'Profile ✓' : 'Profile'}</button>
      </div>
    </article>
  );
});

interface LeagueMobileTeamsPanelProps {
  teams: LeagueTeam[];
  loading: boolean;
  favoriteIds: Set<string>;
  profiledTeamIds: Set<string>;
  onToggleFavorite: (team: LeagueTeam, isFav: boolean) => void;
  onOpenTeamProfile: (team: LeagueTeam) => void;
}

const LeagueMobileTeamsPanel = memo(function LeagueMobileTeamsPanel({
  teams,
  loading,
  favoriteIds,
  profiledTeamIds,
  onToggleFavorite,
  onOpenTeamProfile,
}: LeagueMobileTeamsPanelProps) {
  if (loading) {
    return (
      <div className="league-mobile-teams league-mobile-teams--loading">
        <div className="loading-spinner" style={{ width: 18, height: 18 }} />
        Loading teams…
      </div>
    );
  }
  if (teams.length === 0) {
    return <div className="league-mobile-teams league-mobile-teams--empty">No teams found</div>;
  }
  return (
    <ul className="league-mobile-teams">
      {teams.map((t) => {
        const isFav = favoriteIds.has(String(t.team.id));
        const hasProfile = profiledTeamIds.has(String(t.team.id));
        return (
          <li key={t.team.id} className="league-mobile-team">
            <div className="league-mobile-team__main">
              {t.team.logo ? <img src={t.team.logo} alt="" width={22} height={22} loading="lazy" /> : <span aria-hidden>⚽</span>}
              <span className={`league-mobile-team__name${isFav ? ' is-fav' : ''}`}>{t.team.name}</span>
              {t.rank != null && <span className="league-mobile-team__rank">#{t.rank}</span>}
            </div>
            <div className="league-mobile-team__actions">
              <button type="button" className={`league-mobile-card__action league-mobile-card__action--star${isFav ? ' is-active' : ''}`} onClick={() => onToggleFavorite(t, isFav)}>{isFav ? '★' : '☆'}</button>
              <button type="button" className={`league-mobile-card__action${hasProfile ? ' is-active' : ''}`} onClick={() => onOpenTeamProfile(t)}>{hasProfile ? 'Profile ✓' : 'Profile'}</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
});

interface StatsFilterBarProps {
  leagues: League[];
  profileCoverage: TopLeagueProfileCoverage | null;
  filterActive: string;
  filterTier: string;
  filterTopLeague: string;
  filterProfile: string;
  coverageMode?: 'full' | 'compact';
  onFilterActive: (v: string) => void;
  onFilterTier: (v: string) => void;
  onFilterTopLeague: (v: string) => void;
  onFilterProfile: (v: string) => void;
}

const StatsBar = memo(function StatsBar({
  leagues, profileCoverage, filterActive, filterTier, filterTopLeague, filterProfile,
  coverageMode = 'full',
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
    {profileCoverage && (() => {
      const coveragePct = profileCoverage.summary.teamProfileCoverage != null
        ? `${Math.round(profileCoverage.summary.teamProfileCoverage * 100)}%`
        : 'N/A';
      const gapCount = profileCoverage.summary.partialCoverageLeagues + profileCoverage.summary.missingCoverageLeagues;
      const gapNote = (() => {
        const gaps = profileCoverage.leagues
          .filter((league) => league.missingTeamProfiles > 0 || !league.hasLeagueProfile)
          .slice(0, 3)
          .map((league) => `${league.leagueName} (${league.profiledTeams}/${league.candidateTeams})`);
        return gaps.length > 0
          ? `Gaps: ${gaps.join(' · ')}`
          : 'Top leagues currently have full profile coverage.';
      })();

      const coverageBody = (
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
            <strong>{coveragePct}</strong>
          </div>
          <div className="leagues-coverage-chip">
            <span className="leagues-coverage-label">Fully Covered</span>
            <strong>{profileCoverage.summary.fullCoverageLeagues}</strong>
          </div>
          <div className="leagues-coverage-chip">
            <span className="leagues-coverage-label">Coverage Gaps</span>
            <strong>{gapCount}</strong>
          </div>
          {profileCoverage.leagues.length > 0 && (
            <div className="leagues-coverage-note">{gapNote}</div>
          )}
        </div>
      );

      if (coverageMode === 'compact') {
        return (
          <details className="leagues-coverage-compact">
            <summary>
              Profile coverage {coveragePct} · {gapCount} gap{gapCount === 1 ? '' : 's'} · tap for details
            </summary>
            {coverageBody}
          </details>
        );
      }

      return coverageBody;
    })()}
    </>
  );
});

// ── Main component ──

export function LeaguesTab() {
  const { state, dispatch } = useAppState();
  const { showToast } = useToast();
  const config = state.config;
  /** Avoid unstable `config` identity retriggering effects / useCallback churn. */
  const configRef = useRef(config);
  configRef.current = config;
  const apiUrl = config.apiUrl;

  const [allLeagues, setAllLeagues] = useState<League[]>([]);
  const allLeaguesRef = useRef<League[]>([]);
  allLeaguesRef.current = allLeagues;
  /** Latest filtered list for reorder — must match what the table shows (excluding pagination). */
  const filteredRef = useRef<League[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [renameLeague, setRenameLeague] = useState<League | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [bulkSheetOpen, setBulkSheetOpen] = useState(false);

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

  // Load all Leagues-tab data (init is light; coverage loads after)
  const loadLeagues = useCallback(async () => {
    const cfg = configRef.current;
    setLoading(true);
    try {
      const { leagues, favoriteTeamIds, profiledTeamIds } = await fetchLeaguesInitData(cfg);
      setAllLeagues(leagues);
      dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(leagues) });
      setFavoriteIds(new Set(favoriteTeamIds));
      setProfiledTeamIds(new Set(profiledTeamIds));
      void fetchLeaguesProfileCoverage(cfg)
        .then(setProfileCoverage)
        .catch(() => {
          setProfileCoverage(null);
        });
    } catch (err) {
      console.error('[LeaguesTab] loadLeagues failed:', err);
      showToast('Failed to load leagues', 'error');
    } finally {
      setLoading(false);
    }
  }, [dispatch, showToast]);

  useEffect(() => {
    let cancelled = false;
    const cfg = configRef.current;
    (async () => {
      setLoading(true);
      try {
        const { leagues, favoriteTeamIds, profiledTeamIds } = await fetchLeaguesInitData(cfg);
        if (cancelled) return;
        setAllLeagues(leagues);
        dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(leagues) });
        setFavoriteIds(new Set(favoriteTeamIds));
        setProfiledTeamIds(new Set(profiledTeamIds));
        void fetchLeaguesProfileCoverage(cfg)
          .then((cov) => {
            if (!cancelled) setProfileCoverage(cov);
          })
          .catch(() => {
            if (!cancelled) setProfileCoverage(null);
          });
      } catch (err) {
        if (!cancelled) {
          console.error('[LeaguesTab] loadLeagues failed:', err);
          showToast('Failed to load leagues', 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, dispatch, showToast]);

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
        (l.display_name?.toLowerCase().includes(q) ?? false) ||
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
      const sa = sortOrderNum(a.sort_order);
      const sb = sortOrderNum(b.sort_order);
      if (sa !== sb) return sa - sb;
      const na = a.display_name?.trim() || a.league_name;
      const nb = b.display_name?.trim() || b.league_name;
      return na.localeCompare(nb);
    });
  }, [allLeagues, search, filterTier, filterCountry, filterType, filterActive, filterTopLeague, filterProfile]);

  filteredRef.current = filtered;

  /** Global list order for ↑↓ (swap with next visible neighbor when filters hide leagues in between). */
  const globalSortedLeagueIds = useMemo(() => sortedLeagueIds(allLeagues), [allLeagues]);

  const visibleLeagueIdSet = useMemo(
    () => new Set(filtered.map((l) => leagueIdNum(l.league_id)).filter((id) => !Number.isNaN(id))),
    [filtered],
  );

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
      setAllLeagues((prev) => { dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(prev) }); return prev; });
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
        dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(prev) });
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
      setAllLeagues((prev) => { dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(prev) }); return prev; });
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
        dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(prev) });
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

  const handleMoveLeagueOrder = useCallback(
    async (leagueId: number, dir: -1 | 1) => {
      const id = leagueIdNum(leagueId);
      if (Number.isNaN(id)) return;
      const ids = sortedLeagueIds(allLeaguesRef.current);
      const visible = new Set(
        filteredRef.current.map((l) => leagueIdNum(l.league_id)).filter((x) => !Number.isNaN(x)),
      );
      const i = ids.indexOf(id);
      if (i < 0) return;
      const j = findNeighborVisibleIndex(ids, i, dir, visible);
      if (j < 0) return;
      const next = [...ids];
      [next[i], next[j]] = [next[j]!, next[i]!];
      const sortById = new Map(next.map((lid, idx) => [lid, (idx + 1) * 10]));
      const cfg = configRef.current;
      const previous = allLeaguesRef.current;
      // Optimistic UI immediately (API may touch ~1500 rows but is now one fast UPDATE)
      setAllLeagues((prev) => {
        const merged = prev.map((l) => {
          const lid = leagueIdNum(l.league_id);
          const so = sortById.get(lid);
          return so != null ? { ...l, sort_order: so } : l;
        });
        dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(merged) });
        return merged;
      });
      try {
        await reorderLeaguesCatalog(cfg, next);
        void fetchApprovedLeagues(cfg)
          .then((fresh) => {
            setAllLeagues(fresh);
            dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(fresh) });
          })
          .catch(() => { /* keep optimistic state */ });
      } catch {
        showToast('Failed to reorder leagues', 'error');
        setAllLeagues(previous);
        dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(previous) });
      }
    },
    [showToast, dispatch],
  );

  const handleSaveLeagueDisplayName = useCallback(
    async (league: League, draft: string) => {
      const trimmed = draft.trim();
      const normalized = !trimmed || trimmed === league.league_name ? null : trimmed;
      const cur = league.display_name?.trim() || null;
      if (normalized === cur) return;
      try {
        await updateLeagueDisplayName(config, league.league_id, normalized);
        await loadLeagues();
      } catch {
        showToast('Failed to update display name', 'error');
      }
    },
    [config, loadLeagues, showToast],
  );

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
        dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(next) });
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
        dispatch({ type: 'SET_LEAGUES', payload: activeLeagueSnapshot(next) });
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

  const activeLeagueCount = useMemo(() => allLeagues.filter((l) => l.active).length, [allLeagues]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    const resetPage = () => setPage(1);
    if (search.trim()) {
      chips.push({ key: 'search', label: `Search: ${search.trim()}`, onRemove: () => { setSearch(''); resetPage(); } });
    }
    if (filterActive !== 'all') {
      chips.push({ key: 'active', label: `Status: ${filterActive}`, onRemove: () => { setFilterActive('all'); resetPage(); } });
    }
    if (filterTier !== 'all') {
      chips.push({ key: 'tier', label: `Tier: ${TIER_LABELS[filterTier] || filterTier}`, onRemove: () => { setFilterTier('all'); resetPage(); } });
    }
    if (filterCountry !== 'all') {
      chips.push({ key: 'country', label: `Country: ${filterCountry}`, onRemove: () => { setFilterCountry('all'); resetPage(); } });
    }
    if (filterType !== 'all') {
      chips.push({ key: 'type', label: `Type: ${filterType}`, onRemove: () => { setFilterType('all'); resetPage(); } });
    }
    if (filterTopLeague !== 'all') {
      chips.push({
        key: 'fav',
        label: filterTopLeague === 'top' ? 'Favorites' : 'Non-Favorites',
        onRemove: () => { setFilterTopLeague('all'); resetPage(); },
      });
    }
    if (filterProfile !== 'all') {
      chips.push({ key: 'profile', label: `Profile: ${filterProfile}`, onRemove: () => { setFilterProfile('all'); resetPage(); } });
    }
    return chips;
  }, [filterActive, filterCountry, filterProfile, filterTier, filterTopLeague, filterType, search]);

  const toolbarFilterCount = useMemo(() => {
    let count = 0;
    if (filterActive !== 'all' && filterActive !== 'active') count += 1;
    if (filterTier !== 'all') count += 1;
    if (filterCountry !== 'all') count += 1;
    if (filterType !== 'all') count += 1;
    if (filterTopLeague !== 'all') count += 1;
    return count;
  }, [filterActive, filterCountry, filterTier, filterTopLeague, filterType]);

  const openRenameModal = useCallback((league: League) => {
    setRenameLeague(league);
    setRenameDraft(league.display_name ?? '');
  }, []);

  const handleSaveRename = useCallback(async () => {
    if (!renameLeague) return;
    setRenameSaving(true);
    try {
      await handleSaveLeagueDisplayName(renameLeague, renameDraft);
      setRenameLeague(null);
      setRenameDraft('');
    } finally {
      setRenameSaving(false);
    }
  }, [handleSaveLeagueDisplayName, renameDraft, renameLeague]);

  const clearAllFilters = useCallback(() => {
    setSearch('');
    setFilterActive('all');
    setFilterTier('all');
    setFilterCountry('all');
    setFilterType('all');
    setFilterTopLeague('all');
    setFilterProfile('all');
    setPage(1);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setConfirmDeactivate(false);
    setBulkSheetOpen(false);
  }, []);

  if (loading) {
    return (
      <div className="loading-panel">
        <div className="loading-spinner" />
        <p>Loading leagues...</p>
      </div>
    );
  }

  return (
    <>
    <div className={`card tab-page-card leagues-tab${selectedIds.size > 0 ? ' leagues-tab--bulk-dock' : ''}`}>
      {/* Stats — collapsible on mobile, always open on desktop */}
      <details className="leagues-stats-collapse leagues-mobile-only">
        <summary className="leagues-stats-collapse__summary">
          {activeLeagueCount} active · {allLeagues.length} total — stats &amp; quick filters
        </summary>
        <StatsBar
          leagues={allLeagues}
          profileCoverage={profileCoverage}
          filterActive={filterActive}
          filterTier={filterTier}
          filterTopLeague={filterTopLeague}
          filterProfile={filterProfile}
          coverageMode="compact"
          onFilterActive={setFilterActive}
          onFilterTier={setFilterTier}
          onFilterTopLeague={setFilterTopLeague}
          onFilterProfile={setFilterProfile}
        />
      </details>
      <div className="leagues-desktop-only">
        <StatsBar
          leagues={allLeagues}
          profileCoverage={profileCoverage}
          filterActive={filterActive}
          filterTier={filterTier}
          filterTopLeague={filterTopLeague}
          filterProfile={filterProfile}
          coverageMode="full"
          onFilterActive={setFilterActive}
          onFilterTier={setFilterTier}
          onFilterTopLeague={setFilterTopLeague}
          onFilterProfile={setFilterProfile}
        />
      </div>

      <div className="sticky-filter-bar leagues-toolbar-sticky">
        <div className="page-toolbar leagues-toolbar">
          <div className="leagues-search">
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

          <button
            type="button"
            className="btn btn-secondary leagues-filter-sheet-btn leagues-mobile-only"
            onClick={() => setFilterSheetOpen(true)}
            aria-label={`Open filters${toolbarFilterCount > 0 ? `, ${toolbarFilterCount} active` : ''}`}
          >
            Filters{toolbarFilterCount > 0 ? ` (${toolbarFilterCount})` : ''}
          </button>

          <div className="leagues-toolbar-filters">
            <select className="filter-input leagues-toolbar-filter--stat-dupe" value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <select className="filter-input leagues-toolbar-filter--stat-dupe" value={filterTier} onChange={(e) => setFilterTier(e.target.value)}>
              <option value="all">All Tiers</option>
              {tiers.map((t) => <option key={t} value={t}>{TIER_LABELS[t] || t}</option>)}
            </select>

            <select className="filter-input" value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}>
              <option value="all">All Countries</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>

            <select className="filter-input" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              <option value="League">League</option>
              <option value="Cup">Cup</option>
            </select>

            <select className="filter-input leagues-toolbar-filter--stat-dupe" value={filterTopLeague} onChange={(e) => setFilterTopLeague(e.target.value)}>
              <option value="all">All Leagues</option>
              <option value="top">Favorites</option>
              <option value="normal">Non-Favorites</option>
            </select>
          </div>
        </div>
      </div>

      {activeFilterChips.length > 0 && (
        <div className="filter-chips-row" aria-label="Active filters">
          {activeFilterChips.map((chip) => (
            <span key={chip.key} className="filter-chip">
              {chip.label}
              <button
                type="button"
                className="filter-chip__remove"
                onClick={chip.onRemove}
                aria-label={`Remove ${chip.label} filter`}
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" onClick={clearAllFilters}>Clear all</button>
        </div>
      )}

      {selectedIds.size > 0 && confirmDeactivate && (
        <div className="bulk-bar bulk-bar--warning leagues-desktop-only" role="status">
          <span className="bulk-bar__message">
            Deactivate {selectedIds.size} league{selectedIds.size > 1 ? 's' : ''}? This will remove them from all scans.
          </span>
          <div className="bulk-bar__actions">
            <button type="button" className="btn btn-sm btn-danger" onClick={() => { setConfirmDeactivate(false); handleBulkToggle(false); }}>Confirm</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirmDeactivate(false)}>Cancel</button>
          </div>
        </div>
      )}
      {selectedIds.size > 0 && !confirmDeactivate && (
        <div className="leagues-desktop-only">
          <BulkActionBar count={selectedIds.size} variant="info" onClear={clearSelection}>
            <button type="button" className="btn btn-sm btn-success" onClick={() => handleBulkToggle(true)}>Activate</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDeactivate(true)}>Deactivate</button>
            <button type="button" className="btn btn-sm btn-warning" onClick={() => handleBulkTopLeague(true)}>Add to Favorites</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleBulkTopLeague(false)}>Remove from Favorites</button>
          </BulkActionBar>
        </div>
      )}
      {selectedIds.size > 0 && (
        <div className="leagues-bulk-dock leagues-mobile-only" role="status">
          <span className="leagues-bulk-dock__count">{selectedIds.size} selected</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setBulkSheetOpen(true)}>
            {confirmDeactivate ? 'Confirm deactivate' : 'Actions'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={clearSelection}>Clear</button>
        </div>
      )}
      {bulkSheetOpen && selectedIds.size > 0 && (
        <div
          className="leagues-bottom-sheet-overlay leagues-mobile-only"
          onClick={(e) => e.target === e.currentTarget && setBulkSheetOpen(false)}
          role="presentation"
        >
          <div className="leagues-bottom-sheet" role="dialog" aria-label="Bulk league actions">
            <div className="leagues-bottom-sheet__header">
              <span>{selectedIds.size} league{selectedIds.size > 1 ? 's' : ''} selected</span>
              <button type="button" className="leagues-bottom-sheet__close" onClick={() => setBulkSheetOpen(false)} aria-label="Close">×</button>
            </div>
            {confirmDeactivate ? (
              <div className="leagues-bottom-sheet__body">
                <p className="leagues-bottom-sheet__warning">
                  Deactivate {selectedIds.size} league{selectedIds.size > 1 ? 's' : ''}? This removes them from all scans.
                </p>
                <button
                  type="button"
                  className="btn btn-danger leagues-bottom-sheet__action"
                  onClick={() => { setConfirmDeactivate(false); setBulkSheetOpen(false); void handleBulkToggle(false); }}
                >
                  Confirm deactivate
                </button>
                <button
                  type="button"
                  className="btn btn-secondary leagues-bottom-sheet__action"
                  onClick={() => setConfirmDeactivate(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="leagues-bottom-sheet__body">
                <button
                  type="button"
                  className="btn btn-success leagues-bottom-sheet__action"
                  onClick={() => { setBulkSheetOpen(false); void handleBulkToggle(true); }}
                >
                  Activate
                </button>
                <button
                  type="button"
                  className="btn btn-danger leagues-bottom-sheet__action"
                  onClick={() => setConfirmDeactivate(true)}
                >
                  Deactivate
                </button>
                <button
                  type="button"
                  className="btn btn-warning leagues-bottom-sheet__action"
                  onClick={() => { setBulkSheetOpen(false); void handleBulkTopLeague(true); }}
                >
                  Add to Favorites
                </button>
                <button
                  type="button"
                  className="btn btn-secondary leagues-bottom-sheet__action"
                  onClick={() => { setBulkSheetOpen(false); void handleBulkTopLeague(false); }}
                >
                  Remove from Favorites
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pagination — top */}
      <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />

      {/* Desktop table */}
      <div className="table-container leagues-table leagues-desktop-only">
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
              <th style={{ width: '1%', whiteSpace: 'nowrap', textAlign: 'center' }} title="Change order in the full catalog">Order</th>
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
            {paginated.map((league) => {
              const gIdx = globalSortedLeagueIds.indexOf(leagueIdNum(league.league_id));
              const canMoveUp = gIdx >= 0 && findNeighborVisibleIndex(globalSortedLeagueIds, gIdx, -1, visibleLeagueIdSet) >= 0;
              const canMoveDown = gIdx >= 0 && findNeighborVisibleIndex(globalSortedLeagueIds, gIdx, 1, visibleLeagueIdSet) >= 0;
              return (
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
                  canMoveUp={canMoveUp}
                  canMoveDown={canMoveDown}
                  onMoveOrder={handleMoveLeagueOrder}
                  onSaveDisplayName={handleSaveLeagueDisplayName}
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
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
                  {search || filterTier !== 'all' || filterCountry !== 'all' || filterActive !== 'all' || filterTopLeague !== 'all'
                    ? 'No leagues match your filters'
                    : 'No leagues available yet. Use Sync Reference Data in Settings if a refresh is needed.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="leagues-mobile-only leagues-mobile-list">
        {paginated.length === 0 ? (
          <EmptyState
            title={search || filterTier !== 'all' || filterCountry !== 'all' || filterActive !== 'all' || filterTopLeague !== 'all'
              ? 'No leagues match your filters'
              : 'No leagues available yet. Use Sync Reference Data in Settings if a refresh is needed.'}
          />
        ) : (
          paginated.map((league) => {
            const gIdx = globalSortedLeagueIds.indexOf(leagueIdNum(league.league_id));
            const canMoveUp = gIdx >= 0 && findNeighborVisibleIndex(globalSortedLeagueIds, gIdx, -1, visibleLeagueIdSet) >= 0;
            const canMoveDown = gIdx >= 0 && findNeighborVisibleIndex(globalSortedLeagueIds, gIdx, 1, visibleLeagueIdSet) >= 0;
            return (
              <Fragment key={league.league_id}>
                <LeagueMobileCard
                  league={league}
                  selected={selectedIds.has(league.league_id)}
                  toggling={togglingIds.has(league.league_id)}
                  togglingTop={togglingTopIds.has(league.league_id)}
                  teamsExpanded={expandedLeagueId === league.league_id}
                  canMoveUp={canMoveUp}
                  canMoveDown={canMoveDown}
                  onSelect={handleSelect}
                  onToggle={handleToggle}
                  onToggleTop={handleToggleTop}
                  onViewFixtures={setFixtureLeague}
                  onEditProfile={handleEditProfile}
                  onToggleTeams={handleToggleTeams}
                  onMoveOrder={handleMoveLeagueOrder}
                  onRename={openRenameModal}
                />
                {expandedLeagueId === league.league_id && (
                  <LeagueMobileTeamsPanel
                    teams={leagueTeamsCache[league.league_id] ?? []}
                    loading={teamsLoading && !leagueTeamsCache[league.league_id]}
                    favoriteIds={favoriteIds}
                    profiledTeamIds={profiledTeamIds}
                    onToggleFavorite={handleToggleFavorite}
                    onOpenTeamProfile={(team) => handleOpenTeamProfile(team, league.league_name)}
                  />
                )}
              </Fragment>
            );
          })
        )}
      </div>

      <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />

    </div>

    <Modal
      open={filterSheetOpen}
      title="League filters"
      onClose={() => setFilterSheetOpen(false)}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => { clearAllFilters(); setFilterSheetOpen(false); }}>
            Reset
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setFilterSheetOpen(false)}>Apply</button>
        </>
      }
    >
      <div className="leagues-filter-sheet">
        <label className="leagues-filter-sheet__field">
          <span className="leagues-filter-sheet__label">Status</span>
          <select className="filter-input" value={filterActive} onChange={(e) => { setFilterActive(e.target.value); setPage(1); }}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="leagues-filter-sheet__field">
          <span className="leagues-filter-sheet__label">Tier</span>
          <select className="filter-input" value={filterTier} onChange={(e) => { setFilterTier(e.target.value); setPage(1); }}>
            <option value="all">All Tiers</option>
            {tiers.map((t) => <option key={t} value={t}>{TIER_LABELS[t] || t}</option>)}
          </select>
        </label>
        <label className="leagues-filter-sheet__field">
          <span className="leagues-filter-sheet__label">Country</span>
          <select className="filter-input" value={filterCountry} onChange={(e) => { setFilterCountry(e.target.value); setPage(1); }}>
            <option value="all">All Countries</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="leagues-filter-sheet__field">
          <span className="leagues-filter-sheet__label">Type</span>
          <select className="filter-input" value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }}>
            <option value="all">All Types</option>
            <option value="League">League</option>
            <option value="Cup">Cup</option>
          </select>
        </label>
        <label className="leagues-filter-sheet__field">
          <span className="leagues-filter-sheet__label">Favorites</span>
          <select className="filter-input" value={filterTopLeague} onChange={(e) => { setFilterTopLeague(e.target.value); setPage(1); }}>
            <option value="all">All Leagues</option>
            <option value="top">Favorites</option>
            <option value="normal">Non-Favorites</option>
          </select>
        </label>
      </div>
    </Modal>

    <Modal
      open={renameLeague != null}
      title={renameLeague ? `Rename: ${renameLeague.league_name}` : 'Rename league'}
      onClose={() => !renameSaving && setRenameLeague(null)}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => setRenameLeague(null)} disabled={renameSaving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSaveRename()} disabled={renameSaving}>
            {renameSaving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Display name (optional)</span>
        <input
          className="filter-input"
          type="text"
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          placeholder={renameLeague?.league_name ?? ''}
          autoFocus
        />
        <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>Leave empty to use the provider name only.</span>
      </label>
    </Modal>

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

