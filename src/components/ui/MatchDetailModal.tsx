// ============================================================
// Match Detail Modal — Snapshots timeline + Odds movement chart
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Modal } from './Modal';
import { useAppState } from '@/hooks/useAppState';
import {
  fetchSnapshotsByMatch,
  fetchOddsHistory,
  type MatchSnapshot,
  type OddsMovement,
} from '@/lib/services/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface MatchDetailModalProps {
  open: boolean;
  matchId: string;
  matchDisplay: string;
  onClose: () => void;
}

type TabKey = 'timeline' | 'odds';

export function MatchDetailModal({ open, matchId, matchDisplay, onClose }: MatchDetailModalProps) {
  const { state } = useAppState();
  const [tab, setTab] = useState<TabKey>('timeline');
  const [snapshots, setSnapshots] = useState<MatchSnapshot[]>([]);
  const [odds, setOdds] = useState<OddsMovement[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!matchId || !open) return;
    setLoading(true);
    try {
      const [snaps, oddsData] = await Promise.all([
        fetchSnapshotsByMatch(state.config, matchId),
        fetchOddsHistory(state.config, matchId),
      ]);
      setSnapshots(snaps);
      setOdds(oddsData);
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
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-400)' }}>Loading...</div>
      ) : (
        <>
          {/* Tab Selector */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              className={`btn btn-sm ${tab === 'timeline' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('timeline')}
            >
              📋 Timeline ({snapshots.length})
            </button>
            <button
              className={`btn btn-sm ${tab === 'odds' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('odds')}
            >
              📈 Odds ({odds.length})
            </button>
            <button className="btn btn-sm btn-secondary" onClick={load} style={{ marginLeft: 'auto' }}>🔄</button>
          </div>

          {tab === 'timeline' ? (
            <TimelineView snapshots={snapshots} />
          ) : (
            <OddsView odds={odds} />
          )}
        </>
      )}
    </Modal>
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
  if (!odds.length) {
    return <EmptyState icon="📈" message="No odds movements recorded" />;
  }

  // Group by market
  const markets = [...new Set(odds.map((o) => o.market))];
  const [selectedMarket, setSelectedMarket] = useState(markets[0] || '');

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
