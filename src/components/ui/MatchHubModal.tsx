// Match Hub - unified modal
import { useState, useEffect, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { MatchFactsPanel } from '@/components/ui/MatchFactsPanel';
import { MatchPriorsPanel } from '@/components/ui/MatchPriorsPanel';
import {
  MatchHubContextView,
  MatchHubRecsView,
  MatchHubBetsView,
  MatchHubEmptyState,
} from '@/components/ui/matchHubPanels';
import { useAppState } from '@/hooks/useAppState';
import {
  fetchSnapshotsByMatch,
  fetchOddsHistory,
  fetchRecommendationsByMatch,
  fetchBetsByMatch,
  fetchWatchlistItem,
  fetchMatchScout,
  type MatchSnapshot,
  type OddsMovement,
  type BetRecord,
  type MatchScoutData,
} from '@/lib/services/api';
import type { Recommendation, WatchlistItem } from '@/types';

const OddsView = lazy(() => import('./MatchDetailChartViews').then((m) => ({ default: m.OddsView })));

/** Match over or voided — same semantics as MatchesTab FINISHED_STATUSES */
const HUB_FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD']);

export type MatchHubTabKey = 'tfi' | 'summary' | 'statistics' | 'table' | 'odds' | 'recs' | 'bets';

export interface MatchHubModalProps {
  open: boolean;
  matchId: string;
  matchDisplay: string;
  onClose: () => void;
  initialTab?: MatchHubTabKey | 'context' | 'scout' | 'timeline';
  homeTeam?: string;
  awayTeam?: string;
  homeLogo?: string;
  awayLogo?: string;
  leagueName?: string;
  leagueId?: number;
  status?: string;
  homeTeamId?: number | string;
  awayTeamId?: number | string;
}

function parseTeamsFromDisplay(display: string): { home: string; away: string } {
  const trimmed = display.trim();
  const m = trimmed.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (m) return { home: m[1]!.trim(), away: m[2]!.trim() };
  return { home: 'Home', away: 'Away' };
}

function normalizeHubTab(raw: MatchHubModalProps['initialTab']): MatchHubTabKey {
  if (raw === 'context') return 'tfi';
  if (raw === 'scout' || raw === 'timeline') return raw === 'timeline' ? 'statistics' : 'summary';
  if (raw === 'tfi' || raw === 'summary' || raw === 'statistics' || raw === 'table' || raw === 'odds' || raw === 'recs' || raw === 'bets') {
    return raw;
  }
  return 'tfi';
}

export function MatchHubModal(props: MatchHubModalProps) {
  return <MatchHubModalInner {...props} />;
}

function MatchHubModalInner({
  open,
  matchId,
  matchDisplay,
  onClose,
  initialTab,
  homeTeam: homeTeamProp,
  awayTeam: awayTeamProp,
  homeLogo,
  awayLogo,
  leagueName,
  leagueId: leagueIdProp,
  status,
  homeTeamId,
  awayTeamId,
}: MatchHubModalProps) {
  const { state } = useAppState();
  const parsed = parseTeamsFromDisplay(matchDisplay);
  const homeTeam = homeTeamProp ?? parsed.home;
  const awayTeam = awayTeamProp ?? parsed.away;
  const [tab, setTab] = useState<MatchHubTabKey>(() => normalizeHubTab(initialTab));
  const [tfiLoading, setTfiLoading] = useState(false);
  const [watchlistTfi, setWatchlistTfi] = useState<WatchlistItem | null>(null);
  const [recsTfi, setRecsTfi] = useState<Recommendation[]>([]);
  const [snapshots, setSnapshots] = useState<MatchSnapshot[] | null>(null);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [scoutData, setScoutData] = useState<MatchScoutData | null>(null);
  const [scoutLoading, setScoutLoading] = useState(false);
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [odds, setOdds] = useState<OddsMovement[] | null>(null);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [bets, setBets] = useState<BetRecord[] | null>(null);
  const [betsLoading, setBetsLoading] = useState(false);

  const loadTfiPack = useCallback(async () => {
    if (!matchId || !open) return;
    setTfiLoading(true);
    try {
      const [wl, r] = await Promise.all([
        fetchWatchlistItem(state.config, matchId).catch(() => null),
        fetchRecommendationsByMatch(state.config, matchId).catch(() => [] as Recommendation[]),
      ]);
      setWatchlistTfi(wl);
      setRecsTfi(r);
    } catch {
      setWatchlistTfi(null);
      setRecsTfi([]);
    } finally {
      setTfiLoading(false);
    }
  }, [matchId, open, state.config]);

  useEffect(() => {
    if (open) setTab(normalizeHubTab(initialTab));
  }, [open, initialTab]);

  useEffect(() => {
    if (!open || !matchId) {
      setWatchlistTfi(null);
      setRecsTfi([]);
      setSnapshots(null);
      setScoutData(null);
      setScoutError(null);
      setOdds(null);
      setBets(null);
      return;
    }
    setScoutData(null);
    setScoutError(null);
    void loadTfiPack();
  }, [open, matchId, loadTfiPack]);

  const loadSnapshots = useCallback(async () => {
    if (!matchId || !open) return;
    setSnapshotsLoading(true);
    try {
      setSnapshots(await fetchSnapshotsByMatch(state.config, matchId));
    } catch {
      setSnapshots([]);
    } finally {
      setSnapshotsLoading(false);
    }
  }, [matchId, open, state.config]);

  const season = new Date().getMonth() < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear();
  const leagueIdForScout = leagueIdProp ?? watchlistTfi?.league_id ?? undefined;

  const loadScout = useCallback(async () => {
    if (!matchId || !open) return;
    setScoutLoading(true);
    setScoutError(null);
    try {
      setScoutData(await fetchMatchScout(state.config, matchId, {
        leagueId: leagueIdForScout,
        season,
        status,
      }));
    } catch (err) {
      setScoutData(null);
      setScoutError(err instanceof Error ? err.message : 'Failed to load match facts');
    } finally {
      setScoutLoading(false);
    }
  }, [matchId, open, leagueIdForScout, season, status, state.config]);

  const loadOdds = useCallback(async () => {
    if (!matchId || !open) return;
    setOddsLoading(true);
    try {
      setOdds(await fetchOddsHistory(state.config, matchId));
    } catch {
      setOdds([]);
    } finally {
      setOddsLoading(false);
    }
  }, [matchId, open, state.config]);

  const loadBets = useCallback(async () => {
    if (!matchId || !open) return;
    setBetsLoading(true);
    try {
      setBets(await fetchBetsByMatch(state.config, matchId));
    } catch {
      setBets([]);
    } finally {
      setBetsLoading(false);
    }
  }, [matchId, open, state.config]);

  useEffect(() => {
    if (!open || (tab !== 'statistics') || snapshots !== null) return;
    void loadSnapshots();
  }, [open, tab, snapshots, loadSnapshots]);

  useEffect(() => {
    if (!open || !['summary', 'statistics', 'table'].includes(tab) || scoutData !== null || scoutLoading) return;
    void loadScout();
  }, [open, tab, scoutData, scoutLoading, loadScout]);

  useEffect(() => {
    if (!open || tab !== 'odds' || odds !== null) return;
    void loadOdds();
  }, [open, tab, odds, loadOdds]);

  useEffect(() => {
    if (!open || tab !== 'bets' || bets !== null) return;
    void loadBets();
  }, [open, tab, bets, loadBets]);

  const refreshAll = useCallback(() => {
    setSnapshots(null);
    setScoutData(null);
    setScoutError(null);
    setOdds(null);
    setBets(null);
    void loadTfiPack();
    if (tab === 'statistics') void loadSnapshots();
    if (tab === 'summary' || tab === 'statistics' || tab === 'table') void loadScout();
    if (tab === 'odds') void loadOdds();
    if (tab === 'bets') void loadBets();
  }, [loadTfiPack, loadSnapshots, loadScout, loadOdds, loadBets, tab]);

  const latest =
    snapshots && snapshots.length > 0
      ? [...snapshots].sort((a, b) => b.minute - a.minute)[0]
      : null;
  const leagueIdForPriors = leagueIdProp ?? watchlistTfi?.league_id ?? null;
  const snapLen = snapshots?.length ?? 0;
  const oddsLen = odds?.length ?? 0;
  const betsLen = bets?.length ?? 0;
  const titleText = matchDisplay || `${homeTeam} vs ${awayTeam}`;

  const matchRow = state.matches.find((m) => String(m.match_id) === String(matchId));
  const finished = matchRow ? HUB_FINISHED_STATUSES.has(String(matchRow.status).toUpperCase()) : false;
  const notInFeed = !state.loading && !matchRow;
  const hubNotice =
    open && !tfiLoading && (finished || notInFeed)
      ? finished
        ? 'This match has finished. Saved picks, match facts, and odds history (if captured) remain available in the tabs below.'
        : 'This match is not in your current fixtures list. It may have ended or been removed from the feed — saved picks and charts may still load below.'
      : null;

  return (
    <Modal open={open} title={titleText} onClose={onClose} size="xl">
      {hubNotice && (
        <div role="status" className="match-hub-notice-banner">
          {hubNotice}
        </div>
      )}
      {latest && (
        <div className="match-hub-kpi-strip">
          <KpiChip label="Score" value={`${latest.home_score} - ${latest.away_score}`} bold />
          <KpiChip label="Minute" value={`${latest.minute}'`} />
          <KpiChip label="Status" value={latest.status} />
          {snapLen > 0 && <KpiChip label="Snapshots" value={String(snapLen)} />}
          {recsTfi.length > 0 && <KpiChip label="Picks" value={String(recsTfi.length)} />}
          {betsLen > 0 && <KpiChip label="Bets" value={String(betsLen)} />}
        </div>
      )}

      <div className="match-hub-tab-row">
        <HubTabBtn active={tab === 'tfi'} onClick={() => setTab('tfi')}>
          TFI
        </HubTabBtn>
        <HubTabBtn active={tab === 'summary'} onClick={() => setTab('summary')}>
          Summary
        </HubTabBtn>
        <HubTabBtn active={tab === 'statistics'} onClick={() => setTab('statistics')}>
          Statistics
        </HubTabBtn>
        <HubTabBtn active={tab === 'table'} onClick={() => setTab('table')}>
          Table
        </HubTabBtn>
        <HubTabBtn active={tab === 'odds'} onClick={() => setTab('odds')}>
          Odds{oddsLen > 0 ? ` (${oddsLen})` : ''}
        </HubTabBtn>
        <HubTabBtn active={tab === 'recs'} onClick={() => setTab('recs')}>
          Picks{recsTfi.length > 0 ? ` (${recsTfi.length})` : ''}
        </HubTabBtn>
        <HubTabBtn active={tab === 'bets'} onClick={() => setTab('bets')}>
          Bets{betsLen > 0 ? ` (${betsLen})` : ''}
        </HubTabBtn>
        <button
          type="button"
          className="btn btn-sm btn-secondary match-hub-tab-row-refresh"
          onClick={() => void refreshAll()}
          title="Refresh"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {tab === 'tfi' &&
        (tfiLoading ? (
          <div className="loading-panel match-hub-loading">
            <div className="loading-spinner" />
            <p>Loading TFI match intelligence...</p>
          </div>
        ) : (
          <div className="match-hub-stack">
            <MatchPriorsPanel
              open={open}
              active={tab === 'tfi'}
              config={state.config}
              leagueId={leagueIdForPriors}
              homeTeamId={homeTeamId}
              awayTeamId={awayTeamId}
              homeTeamName={watchlistTfi?.home_team ?? homeTeam}
              awayTeamName={watchlistTfi?.away_team ?? awayTeam}
            />
            <div className="strategic-context-box strategic-context-box--compact">
              <div className="strategic-context-header strategic-context-header--tight">
                Match context and analysis
              </div>
              <MatchHubContextView watchlist={watchlistTfi} recs={recsTfi} />
            </div>
          </div>
        ))}

      {(tab === 'summary' || tab === 'statistics' || tab === 'table') && (
        <MatchFactsPanel
          view={tab}
          data={scoutData}
          snapshots={snapshots}
          loading={scoutLoading || (tab === 'statistics' && snapshotsLoading && !scoutData)}
          error={scoutError}
          onRetry={() => void loadScout()}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homeLogo={homeLogo ?? watchlistTfi?.home_logo}
          awayLogo={awayLogo ?? watchlistTfi?.away_logo}
          leagueName={leagueName ?? watchlistTfi?.league_name ?? watchlistTfi?.league}
          status={status}
        />
      )}

      {tab === 'odds' &&
        (oddsLoading ? (
          <div className="loading-panel match-hub-loading">
            <div className="loading-spinner" />
            <p>Loading odds...</p>
          </div>
        ) : (
          <Suspense
            fallback={
              <MatchHubEmptyState
                icon={
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                }
                message="Loading charts..."
              />
            }
          >
            <OddsView odds={odds ?? []} />
          </Suspense>
        ))}

      {tab === 'recs' && <MatchHubRecsView recs={recsTfi} />}

      {tab === 'bets' &&
        (betsLoading ? (
          <div className="loading-panel match-hub-loading">
            <div className="loading-spinner" />
            <p>Loading bets...</p>
          </div>
        ) : (
          <MatchHubBetsView bets={bets ?? []} />
        ))}
    </Modal>
  );
}

function KpiChip({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="match-hub-kpi-chip">
      <span className="match-hub-kpi-chip-label">{label}</span>
      <span className={`match-hub-kpi-chip-value${bold ? ' match-hub-kpi-chip-value--bold' : ''}`}>{value}</span>
    </div>
  );
}

function HubTabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`btn btn-sm match-hub-tab-btn ${active ? 'btn-primary' : 'btn-secondary'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
