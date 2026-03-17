// ============================================================
// Match Scout Panel — Timeline · Odds · AI Recs · Bets
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Modal } from './Modal';
import { RecommendationCard } from './RecommendationCard';
import { useAppState } from '@/hooks/useAppState';
import {
  fetchSnapshotsByMatch,
  fetchOddsHistory,
  fetchRecommendationsByMatch,
  fetchBetsByMatch,
  type MatchSnapshot,
  type OddsMovement,
  type BetRecord,
} from '@/lib/services/api';
import type { Recommendation } from '@/types';
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

type TabKey = 'timeline' | 'odds' | 'recs' | 'bets';

export function MatchDetailModal({ open, matchId, matchDisplay, onClose }: MatchDetailModalProps) {
  const { state } = useAppState();
  const [tab, setTab] = useState<TabKey>('timeline');
  const [snapshots, setSnapshots] = useState<MatchSnapshot[]>([]);
  const [odds, setOdds]           = useState<OddsMovement[]>([]);
  const [recs, setRecs]           = useState<Recommendation[]>([]);
  const [bets, setBets]           = useState<BetRecord[]>([]);
  const [loading, setLoading]     = useState(false);

  const load = useCallback(async () => {
    if (!matchId || !open) return;
    setLoading(true);
    try {
      const [snaps, oddsData, recsData, betsData] = await Promise.all([
        fetchSnapshotsByMatch(state.config, matchId),
        fetchOddsHistory(state.config, matchId),
        fetchRecommendationsByMatch(state.config, matchId).catch(() => [] as Recommendation[]),
        fetchBetsByMatch(state.config, matchId).catch(() => [] as BetRecord[]),
      ]);
      setSnapshots(snaps);
      setOdds(oddsData);
      setRecs(recsData);
      setBets(betsData);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, [matchId, open, state.config]);

  useEffect(() => { load(); }, [load]);

  return (
    <Modal open={open} title={`📊 ${matchDisplay}`} onClose={onClose}>
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-400)' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
          Loading match intelligence…
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
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

          {tab === 'timeline' && <TimelineView snapshots={snapshots} />}
          {tab === 'odds'     && <OddsView odds={odds} />}
          {tab === 'recs'     && <RecsView recs={recs} />}
          {tab === 'bets'     && <BetsView bets={bets} />}
        </>
      )}
    </Modal>
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

// ==================== Timeline View ====================

function TimelineView({ snapshots }: { snapshots: MatchSnapshot[] }) {
  if (!snapshots.length) {
    return <EmptyState icon="📋" message="No snapshots captured yet" />;
  }

  const sorted = [...snapshots].sort((a, b) => a.minute - b.minute);

  // Chart data: goals + shots over time
  const chartData = sorted.map((s) => {
    const stats = (s.stats || {}) as Record<string, string | number | null>;
    return {
      minute: s.minute,
      score: `${s.home_score}-${s.away_score}`,
      goals: (s.home_score || 0) + (s.away_score || 0),
      possession: parseStatPair(stats.possession)?.[0] ?? null,
      shots: parseStatPair(stats.shots_on_target)?.[0] ?? null,
    };
  });

  return (
    <div>
      {/* Mini chart */}
      {chartData.length > 1 && (
        <div style={{ marginBottom: '16px' }}>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis dataKey="minute" tick={{ fontSize: 10 }} label={{ value: 'Min', position: 'insideBottom', offset: -2, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="goals" name="Goals" stroke="var(--danger)" strokeWidth={2} dot={{ r: 3 }} />
              {chartData.some((d) => d.possession != null) && (
                <Line type="monotone" dataKey="possession" name="Poss% (H)" stroke="var(--primary)" strokeWidth={1} dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Snapshot table */}
      <div className="table-container" style={{ maxHeight: '300px', overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Min</th>
              <th>Score</th>
              <th>Status</th>
              <th>Poss</th>
              <th>Shots</th>
              <th>Corners</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const stats = (s.stats || {}) as Record<string, string | null>;
              return (
                <tr key={s.id}>
                  <td><span className="cell-value"><strong>{s.minute}'</strong></span></td>
                  <td><span className="cell-value">{s.home_score} - {s.away_score}</span></td>
                  <td><span className="cell-value">{s.status}</span></td>
                  <td><span className="cell-value">{stats.possession || '-'}</span></td>
                  <td><span className="cell-value">{stats.shots_on_target || stats.shots || '-'}</span></td>
                  <td><span className="cell-value">{stats.corners || '-'}</span></td>
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
  // Hooks must be called before any early return (Rules of Hooks)
  const markets = [...new Set(odds.map((o) => o.market))];
  const [selectedMarket, setSelectedMarket] = useState(markets[0] || '');

  if (!odds.length) {
    return <EmptyState icon="📈" message="No odds movements recorded" />;
  }

  const marketOdds = odds
    .filter((o) => o.market === selectedMarket)
    .sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());

  const chartData = marketOdds.map((o) => ({
    time: o.match_minute != null ? `${o.match_minute}'` : new Date(o.captured_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    price_1: o.price_1,
    price_2: o.price_2,
    price_x: o.price_x,
  }));

  return (
    <div>
      {/* Market selector */}
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

      {/* Odds chart */}
      {chartData.length > 1 && (
        <div style={{ marginBottom: '16px' }}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
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

      {/* Odds table */}
      <div className="table-container" style={{ maxHeight: '250px', overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Min</th>
              <th>Market</th>
              <th>Line</th>
              <th>P1</th>
              <th>PX</th>
              <th>P2</th>
            </tr>
          </thead>
          <tbody>
            {marketOdds.map((o) => (
              <tr key={o.id}>
                <td><span className="cell-value">{new Date(o.captured_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></td>
                <td><span className="cell-value">{o.match_minute ?? '-'}</span></td>
                <td><span className="cell-value">{o.market}</span></td>
                <td><span className="cell-value">{o.line ?? '-'}</span></td>
                <td><span className="cell-value"><strong>{o.price_1 ?? '-'}</strong></span></td>
                <td><span className="cell-value">{o.price_x ?? '-'}</span></td>
                <td><span className="cell-value"><strong>{o.price_2 ?? '-'}</strong></span></td>
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
    <div style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
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
      {/* Summary row */}
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

      <div className="table-container" style={{ maxHeight: '320px', overflow: 'auto' }}>
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

function parseStatPair(val: string | number | null | undefined): [number, number] | null {
  if (val == null) return null;
  const parts = String(val).split('-').map((s) => parseInt(s.trim(), 10));
  if (parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
    return [parts[0]!, parts[1]!];
  }
  return null;
}
