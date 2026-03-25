// ============================================================
// Match Scout Panel — Context · Timeline · Odds · AI Recs · Bets
// ============================================================

import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Modal } from './Modal';
import { RecommendationCard } from './RecommendationCard';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { useAppState } from '@/hooks/useAppState';
import { useUiLanguage } from '@/hooks/useUiLanguage';
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
import {
  getStrategicNarrative,
  getStrategicQuantitativeEntries,
  getStrategicRefreshMeta,
  getStrategicSourceMeta,
  hasStrategicNarrative,
  isStructuredStrategicContext,
} from '@/lib/utils/strategicContext';
import { BET_RESULT_BADGES } from '@/config/constants';

const TimelineView = lazy(() => import('./MatchDetailChartViews').then((module) => ({ default: module.TimelineView })));
const OddsView = lazy(() => import('./MatchDetailChartViews').then((module) => ({ default: module.OddsView })));

interface MatchDetailModalProps {
  open: boolean;
  matchId: string;
  matchDisplay: string;
  onClose: () => void;
  initialTab?: TabKey;
}

type TabKey = 'context' | 'timeline' | 'odds' | 'recs' | 'bets';

export function MatchDetailModal({ open, matchId, matchDisplay, onClose, initialTab }: MatchDetailModalProps) {
  const { state } = useAppState();
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'context');
  const [snapshots, setSnapshots] = useState<MatchSnapshot[]>([]);
  const [odds, setOdds]           = useState<OddsMovement[]>([]);
  const [recs, setRecs]           = useState<Recommendation[]>([]);
  const [bets, setBets]           = useState<BetRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem | null>(null);
  const [loading, setLoading]     = useState(false);

  const load = useCallback(async () => {
    if (!matchId || !open) return;
    setLoading(true);
    try {
      const [snaps, oddsData, recsData, betsData, wlItem] = await Promise.all([
        fetchSnapshotsByMatch(state.config, matchId),
        fetchOddsHistory(state.config, matchId),
        fetchRecommendationsByMatch(state.config, matchId).catch(() => [] as Recommendation[]),
        fetchBetsByMatch(state.config, matchId).catch(() => [] as BetRecord[]),
        fetchWatchlistItem(state.config, matchId).catch(() => null),
      ]);
      setSnapshots(snaps);
      setOdds(oddsData);
      setRecs(recsData);
      setBets(betsData);
      setWatchlist(wlItem);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, [matchId, open, state.config]);

  useEffect(() => { load(); }, [load]);

  // Latest snapshot for header KPIs
  const latest = snapshots.length > 0
    ? [...snapshots].sort((a, b) => b.minute - a.minute)[0]
    : null;

  return (
    <Modal open={open} title={`📊 ${matchDisplay}`} onClose={onClose} size="xl">
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-400)' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
          Loading match intelligence…
        </div>
      ) : (
        <>
          {/* Live KPI banner */}
          {latest && (
            <div style={{
              display: 'flex', gap: '16px', padding: '10px 14px', marginBottom: '14px',
              background: 'var(--gray-50)', borderRadius: '8px', flexWrap: 'wrap',
              border: '1px solid var(--gray-200)', alignItems: 'center',
            }}>
              <KpiChip label="Score" value={`${latest.home_score} – ${latest.away_score}`} bold />
              <KpiChip label="Minute" value={`${latest.minute}'`} />
              <KpiChip label="Status" value={latest.status} />
              {snapshots.length > 0 && <KpiChip label="Snapshots" value={String(snapshots.length)} />}
              {recs.length > 0 && <KpiChip label="AI Recs" value={String(recs.length)} />}
              {bets.length > 0 && <KpiChip label="Bets" value={String(bets.length)} />}
            </div>
          )}

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <TabBtn active={tab === 'context'} onClick={() => setTab('context')}>
              🔍 Context
            </TabBtn>
            <TabBtn active={tab === 'timeline'} onClick={() => setTab('timeline')}>
              📋 Timeline{snapshots.length > 0 ? ` (${snapshots.length})` : ''}
            </TabBtn>
            <TabBtn active={tab === 'odds'} onClick={() => setTab('odds')}>
              📈 Odds{odds.length > 0 ? ` (${odds.length})` : ''}
            </TabBtn>
            <TabBtn active={tab === 'recs'} onClick={() => setTab('recs')}>
              🎯 AI Recs{recs.length > 0 ? ` (${recs.length})` : ''}
            </TabBtn>
            <TabBtn active={tab === 'bets'} onClick={() => setTab('bets')}>
              💰 Bets{bets.length > 0 ? ` (${bets.length})` : ''}
            </TabBtn>
            <button className="btn btn-sm btn-secondary" onClick={load} style={{ marginLeft: 'auto' }}>🔄</button>
          </div>

          {tab === 'context' && <ContextView watchlist={watchlist} recs={recs} />}
          {tab === 'timeline' && (
            <Suspense fallback={<EmptyState icon="📊" message="Loading charts…" />}>
              <TimelineView snapshots={snapshots} matchDisplay={matchDisplay} />
            </Suspense>
          )}
          {tab === 'odds' && (
            <Suspense fallback={<EmptyState icon="📊" message="Loading charts…" />}>
              <OddsView odds={odds} />
            </Suspense>
          )}
          {tab === 'recs' && <RecsView recs={recs} />}
          {tab === 'bets' && <BetsView bets={bets} />}
        </>
      )}
    </Modal>
  );
}

function KpiChip({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minWidth: '60px' }}>
      <span style={{ fontSize: '10px', color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
      <span style={{ fontSize: '14px', fontWeight: bold ? 700 : 600, color: 'var(--gray-900)' }}>{value}</span>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ==================== Context View ====================

function ContextView({ watchlist, recs }: { watchlist: WatchlistItem | null; recs: Recommendation[] }) {
  const uiLanguage = useUiLanguage();
  const latestRec = recs.length > 0
    ? [...recs].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())[0]
    : null;

  const ctx = watchlist?.strategic_context;
  const hasContext = hasStrategicNarrative(ctx, uiLanguage);
  const hasConditions = !!(watchlist?.custom_conditions || watchlist?.recommended_custom_condition);
  const hasReasoning = !!(latestRec?.reasoning || latestRec?.key_factors || latestRec?.warnings);
  const summary = getStrategicNarrative(ctx, 'summary', uiLanguage);
  const homeMotivation = getStrategicNarrative(ctx, 'home_motivation', uiLanguage);
  const awayMotivation = getStrategicNarrative(ctx, 'away_motivation', uiLanguage);
  const leaguePositions = getStrategicNarrative(ctx, 'league_positions', uiLanguage);
  const fixtureCongestion = getStrategicNarrative(ctx, 'fixture_congestion', uiLanguage);
  const homeFixtureCongestion = getStrategicNarrative(ctx, 'home_fixture_congestion', uiLanguage);
  const awayFixtureCongestion = getStrategicNarrative(ctx, 'away_fixture_congestion', uiLanguage);
  const rotationRisk = getStrategicNarrative(ctx, 'rotation_risk', uiLanguage);
  const keyAbsences = getStrategicNarrative(ctx, 'key_absences', uiLanguage);
  const homeKeyAbsences = getStrategicNarrative(ctx, 'home_key_absences', uiLanguage);
  const awayKeyAbsences = getStrategicNarrative(ctx, 'away_key_absences', uiLanguage);
  const h2hNarrative = getStrategicNarrative(ctx, 'h2h_narrative', uiLanguage);
  const sourceMeta = getStrategicSourceMeta(ctx);
  const refreshMeta = getStrategicRefreshMeta(ctx);
  const quantitativeEntries = getStrategicQuantitativeEntries(ctx);
  const structuredContext = isStructuredStrategicContext(ctx);
  const trustedDomains = Array.from(new Set((sourceMeta?.sources || []).map((source) => source.domain).filter(Boolean)));
  const searchQueries = (sourceMeta?.web_search_queries || []).filter(Boolean);

  if (!watchlist && !latestRec) {
    return <EmptyState icon="🔍" message="No context data available for this match" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Conditions */}
      {hasConditions && (
        <Section title="📌 Betting Conditions">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {watchlist?.custom_conditions && (
              <InfoBlock label="Custom Condition" value={watchlist.custom_conditions} />
            )}
            {watchlist?.recommended_custom_condition && (
              <InfoBlock label="AI Recommended Condition" value={watchlist.recommended_custom_condition} highlight />
            )}
            {watchlist?.recommended_condition_reason_vi && (
              <InfoBlock label="Reason (VI)" value={watchlist.recommended_condition_reason_vi} colSpan />
            )}
            {watchlist?.recommended_condition_reason && !watchlist?.recommended_condition_reason_vi && (
              <InfoBlock label="Reason" value={watchlist.recommended_condition_reason} colSpan />
            )}
          </div>
        </Section>
      )}

      {/* Strategic Context */}
      {hasContext && ctx && (
        <Section title="🌐 Strategic Context">
          {(structuredContext || refreshMeta) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              {structuredContext && (
                <>
                  <InfoBlock label="Source Quality" value={sourceMeta?.search_quality || 'unknown'} />
                  <InfoBlock label="Trusted Sources" value={String(sourceMeta?.trusted_source_count ?? 0)} />
                  {ctx.competition_type && <InfoBlock label="Competition Type" value={ctx.competition_type} />}
                </>
              )}
              {refreshMeta?.refresh_status && <InfoBlock label="Refresh Status" value={refreshMeta.refresh_status} />}
              {refreshMeta?.retry_after && <InfoBlock label="Retry After" value={formatLocalDateTime(refreshMeta.retry_after)} />}
              {refreshMeta?.last_error && <InfoBlock label="Last Error" value={refreshMeta.last_error} colSpan warn />}
            </div>
          )}
          {summary && (
            <div style={{
              padding: '12px 16px', background: 'var(--gray-50)', borderRadius: '8px',
              borderLeft: '3px solid var(--primary)', marginBottom: '12px',
              fontSize: '13px', lineHeight: '1.6', color: 'var(--gray-700)',
            }}>
              {summary}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {homeMotivation && <InfoBlock label="Home Motivation" value={homeMotivation} />}
            {awayMotivation && <InfoBlock label="Away Motivation" value={awayMotivation} />}
            {leaguePositions && <InfoBlock label="League Positions" value={leaguePositions} />}
            {homeFixtureCongestion && <InfoBlock label={`Home Congestion (${watchlist?.home_team || 'Home'})`} value={homeFixtureCongestion} />}
            {awayFixtureCongestion && <InfoBlock label={`Away Congestion (${watchlist?.away_team || 'Away'})`} value={awayFixtureCongestion} />}
            {fixtureCongestion && <InfoBlock label="Fixture Congestion Summary" value={fixtureCongestion} />}
            {rotationRisk && <InfoBlock label="Rotation Risk" value={rotationRisk} />}
            {homeKeyAbsences && <InfoBlock label={`Home Absences (${watchlist?.home_team || 'Home'})`} value={homeKeyAbsences} />}
            {awayKeyAbsences && <InfoBlock label={`Away Absences (${watchlist?.away_team || 'Away'})`} value={awayKeyAbsences} />}
            {keyAbsences && <InfoBlock label="Key Absences Summary" value={keyAbsences} />}
            {h2hNarrative && <InfoBlock label="H2H Narrative" value={h2hNarrative} colSpan />}
            {ctx.ai_condition && <InfoBlock label="AI Condition Signal" value={ctx.ai_condition} highlight />}
            {ctx.ai_condition_reason_vi && <InfoBlock label="Condition Reason (VI)" value={ctx.ai_condition_reason_vi} colSpan />}
            {structuredContext && quantitativeEntries.length > 0 && (
              <InfoBlock
                label="Quantitative Priors"
                value={quantitativeEntries.map((entry) => `${entry.label}: ${entry.value}`).join(' | ')}
                colSpan
              />
            )}
            {structuredContext && trustedDomains.length > 0 && (
              <InfoBlock
                label="Trusted Domains"
                value={trustedDomains.join(', ')}
                colSpan
              />
            )}
            {structuredContext && searchQueries.length > 0 && (
              <InfoBlock
                label="Search Queries"
                value={searchQueries.join(' | ')}
                colSpan
              />
            )}
            {!structuredContext && (
              <InfoBlock
                label="Trust Note"
                value="Legacy context detected. Trust metadata is missing, so this context should be refreshed before relying on it."
                colSpan
                warn
              />
            )}
          </div>
          {ctx.searched_at && (
            <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '8px' }}>
              Context captured: {formatLocalDateTime(ctx.searched_at)}
            </div>
          )}
        </Section>
      )}

      {/* Latest AI Reasoning */}
      {hasReasoning && latestRec && (
        <Section title={`🤖 Latest AI Analysis${latestRec.minute != null ? ` @ ${latestRec.minute}'` : ''}`}>
          {latestRec.reasoning && (
            <InfoBlock label="Reasoning" value={latestRec.reasoning} colSpan />
          )}
          {latestRec.key_factors && (
            <InfoBlock label="Key Factors" value={latestRec.key_factors} colSpan />
          )}
          {latestRec.warnings && (
            <InfoBlock label="⚠️ Warnings" value={latestRec.warnings} colSpan warn />
          )}
          <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '8px' }}>
            {latestRec.ai_model && <span>Model: {latestRec.ai_model} · </span>}
            {latestRec.created_at && <span>Generated: {formatLocalDateTime(latestRec.created_at)}</span>}
          </div>
        </Section>
      )}

      {!hasContext && !hasConditions && !hasReasoning && (
        <EmptyState icon="🔍" message="No enriched context available yet — run Enrich Watchlist job to populate" />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoBlock({ label, value, highlight, warn, colSpan }: {
  label: string; value: string; highlight?: boolean; warn?: boolean; colSpan?: boolean;
}) {
  return (
    <div style={{ gridColumn: colSpan ? '1 / -1' : undefined }}>
      <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </div>
      <div style={{
        padding: '8px 10px', borderRadius: '6px', fontSize: '12px', lineHeight: '1.5',
        background: warn ? '#fef3c7' : highlight ? '#eff6ff' : 'var(--gray-50)',
        border: `1px solid ${warn ? '#fcd34d' : highlight ? '#bfdbfe' : 'var(--gray-200)'}`,
        color: warn ? '#92400e' : highlight ? '#1e40af' : 'var(--gray-700)',
        fontWeight: highlight ? 600 : 400,
        whiteSpace: 'pre-wrap',
      }}>
        {value}
      </div>
    </div>
  );
}

// ==================== AI Recs View ====================

function RecsView({ recs }: { recs: Recommendation[] }) {
  if (!recs.length) {
    return <EmptyState icon="🎯" message="No AI recommendations for this match yet" />;
  }
  return (
    <div style={{ maxHeight: '500px', overflowY: 'auto', paddingRight: '4px' }}>
      {recs.map((rec, i) => (
        <RecommendationCard key={rec.id ?? i} rec={rec} />
      ))}
    </div>
  );
}

// ==================== Bets View ====================

function BetsView({ bets }: { bets: BetRecord[] }) {
  if (!bets.length) {
    return <EmptyState icon="💰" message="No bets recorded for this match" />;
  }

  const totalPnl = bets
    .filter((b) => b.result !== 'pending')
    .reduce((s, b) => s + (b.pnl ?? 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '13px', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--gray-500)' }}>💰 {bets.length} bet{bets.length !== 1 ? 's' : ''}</span>
        <span style={{ color: 'var(--gray-500)' }}>
          ✅ {bets.filter((b) => b.result === 'win').length}W ·{' '}
          ❌ {bets.filter((b) => b.result === 'loss').length}L ·{' '}
          ⏳ {bets.filter((b) => b.result === 'pending').length} open
        </span>
        {bets.some((b) => b.result !== 'pending') && (
          <span style={{ fontWeight: 700, color: totalPnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            P/L: {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </span>
        )}
      </div>

      <div className="table-container" style={{ maxHeight: '400px', overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th>Selection</th>
              <th style={{ textAlign: 'center' }}>Odds</th>
              <th style={{ textAlign: 'center' }}>Stake</th>
              <th>Bookmaker</th>
              <th style={{ textAlign: 'center' }}>Result</th>
              <th style={{ textAlign: 'right' }}>P/L</th>
            </tr>
          </thead>
          <tbody>
            {bets.map((bet) => {
              const badge = BET_RESULT_BADGES[bet.result] ?? { cls: '', label: bet.result };
              const pnl = bet.pnl ?? 0;
              return (
                <tr key={bet.id}>
                  <td style={{ fontSize: '12px', color: 'var(--gray-600)' }}>{bet.market || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{bet.selection}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--primary)' }}>{bet.odds}</td>
                  <td style={{ textAlign: 'center' }}>${bet.stake.toFixed(2)}</td>
                  <td style={{ fontSize: '12px', color: 'var(--gray-500)' }}>{bet.bookmaker || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`badge ${badge.cls}`} style={{ fontSize: '11px' }}>{badge.label}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {bet.result === 'pending' ? '—' : `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==================== Helpers ====================

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--gray-400)' }}>
      <div style={{ fontSize: '32px', marginBottom: '8px' }}>{icon}</div>
      <p>{message}</p>
    </div>
  );
}
