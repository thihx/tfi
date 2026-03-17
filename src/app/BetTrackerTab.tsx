// ============================================================
// Bet Tracker Tab
// Dedicated view for manual bet tracking and P&L analysis.
// Uses existing API endpoints: /api/bets, /api/bets/stats,
// /api/bets/stats/by-market, /api/recommendations (for linking).
// ============================================================

import { useState, useEffect, useCallback, memo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import {
  fetchBets,
  fetchBetStats,
  fetchBetStatsByMarket,
  createBet,
  type BetRecord,
  type BetStats,
} from '@/lib/services/api';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { MARKET_COLORS, BET_RESULT_BADGES } from '@/config/constants';

const PAGE_SIZE = 30;

const MARKET_OPTIONS = ['1x2', 'Over/Under', 'Asian Handicap', 'BTTS', 'Double Chance', 'Other'];

// ==================== KPI Card ====================

const KpiCard = memo(function KpiCard({
  label, value, sub, positive,
}: { label: string; value: string; sub?: string; positive?: boolean | null }) {
  const valueColor = positive === true
    ? 'var(--success)'
    : positive === false
      ? 'var(--danger)'
      : 'var(--gray-900)';
  return (
    <div className="stat-card">
      <div className="stat-label">
        {label}
      </div>
      <div style={{ fontSize: '26px', fontWeight: 800, color: valueColor, letterSpacing: '-0.5px' }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
});

// ==================== Market Chart ====================

const MarketChart = memo(function MarketChart({
  data,
}: { data: Array<{ market: string } & BetStats> }) {
  if (!data.length) return null;
  const chartData = data.map((d) => ({
    name: d.market || 'Other',
    won:  d.won,
    lost: d.lost,
    pnl:  parseFloat(d.total_pnl.toFixed(2)),
  }));
  return (
    <div className="card" style={{ marginBottom: '12px' }}>
      <div className="card-header">
        <div className="card-title">P&amp;L by Market</div>
      </div>
      <div style={{ padding: '16px 8px 8px 0' }}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--gray-400)" />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} stroke="var(--gray-400)" />
            <Tooltip
              formatter={(v: number, name: string) =>
                name === 'pnl' ? [`$${v.toFixed(2)}`, 'P/L'] : [v, name === 'won' ? 'Won' : 'Lost']
              }
            />
            <Bar dataKey="won"  name="Won"  stackId="wl" fill="var(--success)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="lost" name="Lost" stackId="wl" fill="var(--danger)"  radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-row-gap-16 flex-wrap" style={{ padding: '0 20px 16px' }}>
        {chartData.map((d) => (
          <span key={d.name} style={{ fontSize: '12px', color: 'var(--gray-600)' }}>
            <strong style={{ color: MARKET_COLORS[d.name] ?? 'var(--gray-700)' }}>{d.name}</strong>{' '}
            <span style={{ color: d.pnl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
              {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
});

// ==================== Add Bet Form ====================

interface AddBetFormState {
  match_id: string;
  market: string;
  selection: string;
  odds: string;
  stake: string;
  bookmaker: string;
}

const EMPTY_FORM: AddBetFormState = {
  match_id: '', market: '1x2', selection: '', odds: '', stake: '', bookmaker: '',
};

interface AddBetModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (bet: AddBetFormState) => Promise<void>;
  saving: boolean;
}

function AddBetModal({ open, onClose, onSave, saving }: AddBetModalProps) {
  const [form, setForm] = useState<AddBetFormState>(EMPTY_FORM);

  const set = (field: keyof AddBetFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const valid = form.selection.trim() && parseFloat(form.odds) > 1 && parseFloat(form.stake) > 0;

  const handleSubmit = async () => {
    if (!valid || saving) return;
    await onSave(form);
    setForm(EMPTY_FORM);
  };

  return (
    <Modal
      open={open}
      title="Log Investment"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!valid || saving}>
            {saving ? 'Saving…' : 'Add'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Match ID (optional)</label>
          <input className="filter-input" style={inputStyle} placeholder="e.g. 987654" value={form.match_id} onChange={set('match_id')} />
        </div>
        <div>
          <label style={labelStyle}>Market *</label>
          <select className="filter-input" style={inputStyle} value={form.market} onChange={set('market')}>
            {MARKET_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Selection *</label>
          <input className="filter-input" style={inputStyle} placeholder="e.g. Over 2.5" value={form.selection} onChange={set('selection')} />
        </div>
        <div>
          <label style={labelStyle}>Odds *</label>
          <input className="filter-input" style={inputStyle} type="number" min="1.01" step="0.01" placeholder="e.g. 1.85" value={form.odds} onChange={set('odds')} />
        </div>
        <div>
          <label style={labelStyle}>Stake ($) *</label>
          <input className="filter-input" style={inputStyle} type="number" min="0.01" step="0.01" placeholder="e.g. 50" value={form.stake} onChange={set('stake')} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Bookmaker</label>
          <input className="filter-input" style={inputStyle} placeholder="e.g. Bet365" value={form.bookmaker} onChange={set('bookmaker')} />
        </div>
      </div>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)',
  marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px',
};
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };

// ==================== Main Tab ====================

export function BetTrackerTab() {
  const { state } = useAppState();
  const { config } = state;
  const { showToast } = useToast();

  const [bets, setBets]   = useState<BetRecord[]>([]);
  const [stats, setStats] = useState<BetStats | null>(null);
  const [markets, setMarkets] = useState<Array<{ market: string } & BetStats>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // Filters
  const [resultFilter, setResultFilter] = useState<string>('all');
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [b, s, m] = await Promise.all([
        fetchBets(config),
        fetchBetStats(config).catch(() => null),
        fetchBetStatsByMarket(config).catch(() => []),
      ]);
      setBets(b);
      setStats(s);
      setMarkets(m);
    } catch {
      showToast('Failed to load bets', 'error');
    } finally {
      setLoading(false);
    }
  }, [config, showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Filter bets
  const filtered = bets.filter((b) => {
    if (resultFilter !== 'all' && b.result !== resultFilter) return false;
    if (marketFilter !== 'all' && b.market !== marketFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [resultFilter, marketFilter]);

  const availableMarkets = Array.from(new Set(bets.map((b) => b.market).filter(Boolean)));

  const handleAddBet = async (form: AddBetFormState) => {
    setSaving(true);
    try {
      await createBet(config, {
        match_id:  form.match_id.trim() || 'manual',
        market:    form.market,
        selection: form.selection.trim(),
        odds:      parseFloat(form.odds),
        stake:     parseFloat(form.stake),
        bookmaker: form.bookmaker.trim() || 'Unknown',
        recommendation_id: null,
      });
      showToast('Investment logged', 'success');
      setShowAdd(false);
      await loadAll();
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const pnlPositive = stats && stats.total_pnl >= 0;
  const roiPositive = stats && stats.roi >= 0;

  return (
    <div>
      {/* KPI Row */}
      <div className="stats-grid" style={{ marginBottom: '12px' }}>
        <KpiCard label="Total Investments" value={String(stats?.total ?? '—')} sub={`${stats?.pending ?? 0} pending`} />
        <KpiCard label="Win Rate"     value={stats ? `${((stats.won / Math.max(stats.won + stats.lost, 1)) * 100).toFixed(1)}%` : '—'}
                 sub={stats ? `${stats.won}W · ${stats.lost}L` : undefined} />
        <KpiCard label="Total P/L"    value={stats ? `${pnlPositive ? '+' : ''}$${stats.total_pnl.toFixed(2)}` : '—'}
                 positive={stats ? pnlPositive : null} />
        <KpiCard label="ROI"          value={stats ? `${roiPositive ? '+' : ''}${stats.roi.toFixed(1)}%` : '—'}
                 positive={stats ? roiPositive : null} />
        <KpiCard label="Open (Pending)" value={stats ? String(stats.pending) : '—'}
                 sub={stats ? `${stats.total - stats.pending} settled` : undefined} />
      </div>

      {/* Market Chart */}
      <MarketChart data={markets} />

      {/* Bets List */}
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Log Investment</button>
          </div>
        </div>

        {/* Filters */}
        <div className="filters" style={{ padding: '12px 16px' }}>
          <select className="filter-input" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
            <option value="all">All Results</option>
            <option value="pending">Pending</option>
            <option value="win">Won</option>
            <option value="loss">Lost</option>
            <option value="push">Push</option>
          </select>
          <select className="filter-input" value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)}>
            <option value="all">All Markets</option>
            {availableMarkets.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {(resultFilter !== 'all' || marketFilter !== 'all') && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setResultFilter('all'); setMarketFilter('all'); }}>
              Clear
            </button>
          )}
        </div>

        <div className="table-container">
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)' }}>
              <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
              <p>Loading…</p>
            </div>
          ) : pageItems.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)' }}>
              <p>{bets.length === 0 ? 'No investments logged yet — click "+ Log Investment" to get started' : 'No investments match filters'}</p>
            </div>
          ) : (
            <>
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            <table>
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Placed</th>
                  <th>Match ID</th>
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
                {pageItems.map((bet) => {
                  const pnl = bet.pnl ?? 0;
                  const badge = BET_RESULT_BADGES[bet.result] ?? { cls: 'badge-ns', label: bet.result };
                  return (
                    <tr key={bet.id}>
                      <td style={{ fontSize: '12px', color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                        {formatLocalDateTime(bet.placed_at)}
                      </td>
                      <td style={{ fontSize: '13px', color: 'var(--gray-600)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {bet.match_id || '—'}
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
                          fontSize: '11px', fontWeight: 600,
                          background: `${MARKET_COLORS[bet.market] ?? '#6b7280'}18`,
                          color: MARKET_COLORS[bet.market] ?? 'var(--gray-600)',
                          border: `1px solid ${MARKET_COLORS[bet.market] ?? '#6b7280'}40`,
                        }}>
                          {bet.market || '—'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{bet.selection}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--primary)' }}>{bet.odds}</td>
                      <td style={{ textAlign: 'center', color: 'var(--gray-700)' }}>${bet.stake.toFixed(2)}</td>
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
            </>
          )}
        </div>
      </div>

      <AddBetModal open={showAdd} onClose={() => setShowAdd(false)} onSave={handleAddBet} saving={saving} />
    </div>
  );
}
