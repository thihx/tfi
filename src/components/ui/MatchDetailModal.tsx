// ============================================================
// Match Scout Panel — Context · Timeline · Odds · AI Recs · Bets
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Modal } from './Modal';
import { RecommendationCard } from './RecommendationCard';
import { formatLocalTime, formatLocalDateTime } from '@/lib/utils/helpers';
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
import { BET_RESULT_BADGES } from '@/config/constants';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface MatchDetailModalProps {
  open: boolean;
  matchId: string;
  matchDisplay: string;
  onClose: () => void;
}

type TabKey = 'context' | 'timeline' | 'odds' | 'recs' | 'bets';

export function MatchDetailModal({ open, matchId, matchDisplay, onClose }: MatchDetailModalProps) {
  const { state } = useAppState();
  const [tab, setTab] = useState<TabKey>('context');
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

          {tab === 'context'  && <ContextView watchlist={watchlist} recs={recs} />}
          {tab === 'timeline' && <TimelineView snapshots={snapshots} />}
          {tab === 'odds'     && <OddsView odds={odds} />}
          {tab === 'recs'     && <RecsView recs={recs} />}
          {tab === 'bets'     && <BetsView bets={bets} />}
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
  const latestRec = recs.length > 0
    ? [...recs].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())[0]
    : null;

  const ctx = watchlist?.strategic_context;
  const hasContext = !!(ctx && (ctx.summary || ctx.home_motivation || ctx.away_motivation));
  const hasConditions = !!(watchlist?.custom_conditions || watchlist?.recommended_custom_condition);
  const hasReasoning = !!(latestRec?.reasoning || latestRec?.key_factors || latestRec?.warnings);

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
          {ctx.summary && (
            <div style={{
              padding: '12px 16px', background: 'var(--gray-50)', borderRadius: '8px',
              borderLeft: '3px solid var(--primary)', marginBottom: '12px',
              fontSize: '13px', lineHeight: '1.6', color: 'var(--gray-700)',
            }}>
              {ctx.summary}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {ctx.home_motivation && <InfoBlock label="Home Motivation" value={ctx.home_motivation} />}
            {ctx.away_motivation && <InfoBlock label="Away Motivation" value={ctx.away_motivation} />}
            {ctx.league_positions && <InfoBlock label="League Positions" value={ctx.league_positions} />}
            {ctx.fixture_congestion && <InfoBlock label="Fixture Congestion" value={ctx.fixture_congestion} />}
            {ctx.rotation_risk && <InfoBlock label="Rotation Risk" value={ctx.rotation_risk} />}
            {ctx.key_absences && <InfoBlock label="Key Absences" value={ctx.key_absences} />}
            {ctx.h2h_narrative && <InfoBlock label="H2H Narrative" value={ctx.h2h_narrative} colSpan />}
            {ctx.ai_condition && <InfoBlock label="AI Condition Signal" value={ctx.ai_condition} highlight />}
            {ctx.ai_condition_reason_vi && <InfoBlock label="Condition Reason (VI)" value={ctx.ai_condition_reason_vi} colSpan />}
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

// ==================== Timeline View ====================

function TimelineView({ snapshots }: { snapshots: MatchSnapshot[] }) {
  if (!snapshots.length) {
    return <EmptyState icon="📋" message="No snapshots captured yet" />;
  }

  const sorted = [...snapshots].sort((a, b) => a.minute - b.minute);

  const homeNum = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v === 'object' && v !== null) {
      const n = Number((v as Record<string, unknown>).home);
      return isNaN(n) ? null : n;
    }
    const n = parseInt(String(v), 10);
    return isNaN(n) ? null : n;
  };

  const awayNum = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v === 'object' && v !== null) {
      const n = Number((v as Record<string, unknown>).away);
      return isNaN(n) ? null : n;
    }
    return null;
  };

  const chartData = sorted.map((s) => {
    const stats = (s.stats || {}) as Record<string, unknown>;
    const cornersHome = homeNum(stats.corners) ?? 0;
    const cornersAway = awayNum(stats.corners) ?? 0;
    return {
      minute: s.minute,
      goals: (s.home_score || 0) + (s.away_score || 0),
      possession: homeNum(stats.possession),
      sot: homeNum(stats.shots_on_target),
      corners: cornersHome + cornersAway,
    };
  });

  return (
    <div>
      {chartData.length > 1 && (
        <div style={{ marginBottom: '16px' }}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis dataKey="minute" tick={{ fontSize: 10 }} label={{ value: 'Min', position: 'insideBottom', offset: -2, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v, name) => [v, name]} labelFormatter={(l) => `Min ${l}'`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="goals" name="Goals" stroke="var(--danger)" strokeWidth={2} dot={{ r: 3 }} />
              {chartData.some((d) => d.possession != null) && (
                <Line type="monotone" dataKey="possession" name="Poss% (H)" stroke="var(--primary)" strokeWidth={1} dot={false} />
              )}
              {chartData.some((d) => d.sot != null) && (
                <Line type="monotone" dataKey="sot" name="SOT (H)" stroke="var(--success)" strokeWidth={1} dot={false} />
              )}
              {chartData.some((d) => d.corners > 0) && (
                <Line type="monotone" dataKey="corners" name="Corners" stroke="var(--warning)" strokeWidth={1} dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="table-container" style={{ maxHeight: '380px', overflow: 'auto' }}>
        <table style={{ fontSize: '12px' }}>
          <thead>
            <tr>
              <th>Min</th>
              <th>Score</th>
              <th>Poss</th>
              <th title="Shots (total)">Shots</th>
              <th title="Shots on Target">SOT</th>
              <th>Corners</th>
              <th>Fouls</th>
              <th title="Yellow / Red Cards">Cards</th>
              <th title="Goalkeeper Saves">GK Saves</th>
              <th title="Pass Accuracy">Pass%</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const stats = (s.stats || {}) as Record<string, unknown>;
              const stat = (key: string): string => {
                const v = stats[key];
                if (v == null) return '-';
                if (typeof v === 'object' && v !== null) {
                  const o = v as Record<string, unknown>;
                  return o.home != null && o.away != null ? `${o.home}/${o.away}` : '-';
                }
                return String(v) || '-';
              };
              const yc = stat('yellow_cards');
              const rc = stat('red_cards');
              const cards = rc !== '-' && rc !== '0/0' ? `${yc} 🟡 ${rc} 🔴` : yc !== '-' ? yc : '-';
              const accPasses = stats.passes_accurate;
              const totPasses = stats.total_passes;
              let passAcc = '-';
              if (accPasses && totPasses && typeof accPasses === 'object' && typeof totPasses === 'object') {
                const ah = Number((accPasses as Record<string, unknown>).home);
                const th = Number((totPasses as Record<string, unknown>).home);
                const aa = Number((accPasses as Record<string, unknown>).away);
                const ta = Number((totPasses as Record<string, unknown>).away);
                const hp = th > 0 ? Math.round(ah / th * 100) : 0;
                const ap = ta > 0 ? Math.round(aa / ta * 100) : 0;
                passAcc = `${hp}%/${ap}%`;
              }
              return (
                <tr key={s.id}>
                  <td><strong>{s.minute}'</strong></td>
                  <td>{s.home_score}-{s.away_score}</td>
                  <td>{stat('possession')}</td>
                  <td>{stat('shots')}</td>
                  <td>{stat('shots_on_target')}</td>
                  <td>{stat('corners')}</td>
                  <td>{stat('fouls')}</td>
                  <td>{cards}</td>
                  <td>{stat('goalkeeper_saves')}</td>
                  <td>{passAcc}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==================== Odds View ====================

function OddsView({ odds }: { odds: OddsMovement[] }) {
  const markets = [...new Set(odds.map((o) => o.market))];
  const [selectedMarket, setSelectedMarket] = useState(markets[0] || '');

  if (!odds.length) {
    return <EmptyState icon="📈" message="No odds movements recorded" />;
  }

  const marketOdds = odds
    .filter((o) => o.market === selectedMarket)
    .sort((a, b) => {
      // Sort by minute first (pre-match nulls go to front), then by captured_at
      const mA = a.match_minute ?? -1;
      const mB = b.match_minute ?? -1;
      if (mA !== mB) return mA - mB;
      return new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime();
    });

  const chartData = marketOdds.map((o) => ({
    label: o.match_minute != null ? `${o.match_minute}'` : formatLocalTime(o.captured_at),
    price_1: o.price_1,
    price_2: o.price_2,
    price_x: o.price_x,
  }));

  return (
    <div>
      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {markets.map((m) => (
          <button
            key={m}
            className={`btn btn-sm ${selectedMarket === m ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSelectedMarket(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {chartData.length > 1 && (
        <div style={{ marginBottom: '16px' }}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {chartData.some((d) => d.price_1 != null) && (
                <Line type="monotone" dataKey="price_1" name="Price 1" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
              )}
              {chartData.some((d) => d.price_2 != null) && (
                <Line type="monotone" dataKey="price_2" name="Price 2" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
              )}
              {chartData.some((d) => d.price_x != null) && (
                <Line type="monotone" dataKey="price_x" name="Draw" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="table-container" style={{ maxHeight: '280px', overflow: 'auto' }}>
        <table style={{ fontSize: '12px' }}>
          <thead>
            <tr>
              <th>Min</th>
              <th>Line</th>
              <th style={{ textAlign: 'center' }}>P1</th>
              <th style={{ textAlign: 'center' }}>PX</th>
              <th style={{ textAlign: 'center' }}>P2</th>
              <th style={{ color: 'var(--gray-400)' }}>Captured</th>
            </tr>
          </thead>
          <tbody>
            {marketOdds.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong style={{ color: o.match_minute != null ? 'var(--gray-900)' : 'var(--gray-400)' }}>
                    {o.match_minute != null ? `${o.match_minute}'` : 'Pre'}
                  </strong>
                </td>
                <td>{o.line ?? '—'}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: '#3b82f6' }}>{o.price_1 ?? '—'}</td>
                <td style={{ textAlign: 'center', color: '#f59e0b' }}>{o.price_x ?? '—'}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: '#ef4444' }}>{o.price_2 ?? '—'}</td>
                <td style={{ color: 'var(--gray-400)', fontSize: '11px' }}>{formatLocalTime(o.captured_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
