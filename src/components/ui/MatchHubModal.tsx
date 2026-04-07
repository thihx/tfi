// Match Hub - unified modal
import { useState, useEffect, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { MatchScoutPanel } from '@/components/ui/MatchScoutPanel';
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
  type MatchSnapshot,
  type OddsMovement,
  type BetRecord,
} from '@/lib/services/api';
import type { Recommendation, WatchlistItem } from '@/types';

const TimelineView = lazy(() => import('./MatchDetailChartViews').then((m) => ({ default: m.TimelineView })));
const OddsView = lazy(() => import('./MatchDetailChartViews').then((m) => ({ default: m.OddsView })));

export type MatchHubTabKey = 'tfi' | 'scout' | 'timeline' | 'odds' | 'recs' | 'bets';

export interface MatchHubModalProps {
  open: boolean;
  matchId: string;
  matchDisplay: string;
  onClose: () => void;
  initialTab?: MatchHubTabKey | 'context';
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
  if (raw === 'tfi' || raw === 'scout' || raw === 'timeline' || raw === 'odds' || raw === 'recs' || raw === 'bets') {
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
      setOdds(null);
      setBets(null);
      return;
    }
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
    if (!open || tab !== 'timeline' || snapshots !== null) return;
    void loadSnapshots();
  }, [open, tab, snapshots, loadSnapshots]);

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
    setOdds(null);
    setBets(null);
    void loadTfiPack();
    if (tab === 'timeline') void loadSnapshots();
    if (tab === 'odds') void loadOdds();
    if (tab === 'bets') void loadBets();
  }, [loadTfiPack, loadSnapshots, loadOdds, loadBets, tab]);

  const latest =
    snapshots && snapshots.length > 0
      ? [...snapshots].sort((a, b) => b.minute - a.minute)[0]
      : null;
  const leagueIdForPriors = leagueIdProp ?? watchlistTfi?.league_id ?? null;
  const snapLen = snapshots?.length ?? 0;
  const oddsLen = odds?.length ?? 0;
  const betsLen = bets?.length ?? 0;
  const titleText = matchDisplay || `${homeTeam} vs ${awayTeam}`;

  return (
    <Modal open={open} title={titleText} onClose={onClose} size="xl">
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
        <HubTabBtn active={tab === 'scout'} onClick={() => setTab('scout')}>
          Scout
        </HubTabBtn>
        <HubTabBtn active={tab === 'timeline'} onClick={() => setTab('timeline')}>
          Timeline{snapLen > 0 ? ` (${snapLen})` : ''}
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
          <div className="match-hub-loading">
            <div className="loading-spinner match-hub-loading-spinner" />
            Loading TFI match intelligence...
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

      {tab === 'scout' && (
        <MatchScoutPanel
          open={open}
          active={tab === 'scout'}
          matchId={matchId}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homeLogo={homeLogo ?? watchlistTfi?.home_logo}
          awayLogo={awayLogo ?? watchlistTfi?.away_logo}
          leagueName={leagueName ?? watchlistTfi?.league_name ?? watchlistTfi?.league}
          leagueId={leagueIdForPriors ?? undefined}
          status={status}
        />
      )}

      {tab === 'timeline' &&
        (snapshotsLoading ? (
          <div className="match-hub-loading">
            <div className="loading-spinner match-hub-loading-spinner" />
            Loading timeline...
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
            <TimelineView snapshots={snapshots ?? []} matchDisplay={titleText} />
          </Suspense>
        ))}

      {tab === 'odds' &&
        (oddsLoading ? (
          <div className="match-hub-loading">
            <div className="loading-spinner match-hub-loading-spinner" />
            Loading odds...
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
          <div className="match-hub-loading">
            <div className="loading-spinner match-hub-loading-spinner" />
            Loading bets...
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
