// ============================================================
// Investment Tracker — bankroll, ledger, and manual investment P/L
// APIs: /api/me/bankroll, /api/bets, /api/bets/stats
// ============================================================

import { useState, useEffect, useCallback, memo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchBets,
  fetchBetStats,
  fetchBetStatsByMarket,
  createBet,
  fetchMyBankroll,
  depositMyBankroll,
  withdrawMyBankroll,
  type BetRecord,
  type BetStats,
  type BetMarketStats,
} from '@/lib/services/api';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { MARKET_COLORS, BET_RESULT_BADGES } from '@/config/constants';
import type { BankrollSnapshot, BankrollLedgerEntry } from '@/types';

const PAGE_SIZE = 30;

const MARKET_OPTIONS = ['1x2', 'Over/Under', 'Asian Handicap', 'BTTS', 'Double Chance', 'Other'];
const FINAL_BET_RESULTS = new Set(['win', 'loss', 'push', 'void', 'half_win', 'half_loss']);

const BANKROLL_ENTRY_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  reset: 'Reset',
  withdrawal: 'Withdrawal',
  bet_stake: 'Stake',
  bet_payout: 'Payout',
  adjustment: 'Adjustment',
  settlement: 'Settlement',
};

function formatBankrollUnits(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '-';
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatSignedUnits(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${formatBankrollUnits(value)}`;
}

function formatBankrollEntryType(entryType: string): string {
  return BANKROLL_ENTRY_LABELS[entryType] ?? entryType.replace(/_/g, ' ');
}

function betStakeUnits(bet: BetRecord): number {
  return Number(bet.stake ?? bet.stake_amount ?? 0);
}

function openBankrollSettings(): void {
  window.dispatchEvent(new CustomEvent('tfi:navigate', { detail: 'settings' }));
}

// ==================== KPI Card ====================

const KpiCard = memo(function KpiCard({
  label, value, sub, positive,
}: { label: string; value: string; sub?: string; positive?: boolean | null }) {
  const tone = positive === true ? 'positive' : positive === false ? 'negative' : '';
  return (
    <div className="stat-card investment-tracker__stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value investment-tracker__stat-value ${tone}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
});

// ==================== Market Chart ====================

const MarketChart = memo(function MarketChart({
  data,
}: { data: BetMarketStats[] }) {
  if (!data.length) return null;
  const chartData = data.map((d) => ({
    name: d.market || 'Other',
    won: d.wins,
    lost: d.losses,
    pnl: parseFloat(d.total_pnl.toFixed(2)),
  }));
  return (
    <section className="card tab-section investment-tracker__chart" aria-label="P/L by market">
      <div className="chart-panel__header">
        <div>
          <span className="chart-panel__title">P/L by market</span>
          <span className="chart-panel__hint">Wins vs losses stacked; totals in units</span>
        </div>
      </div>
      <div className="chart-panel__body">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--gray-400)" />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} stroke="var(--gray-400)" />
            <Tooltip
              formatter={(v, name) => {
                const n = Number(v);
                if (name === 'pnl') return [`${formatSignedUnits(n)} units`, 'P/L'];
                return [n, name === 'won' ? 'Won' : 'Lost'];
              }}
            />
            <Bar dataKey="won" name="Won" stackId="wl" fill="var(--success)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="lost" name="Lost" stackId="wl" fill="var(--danger)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="investment-tracker__chart-legend">
        {chartData.map((d) => (
          <li key={d.name}>
            <strong style={{ color: MARKET_COLORS[d.name] ?? 'var(--gray-700)' }}>{d.name}</strong>
            <span className={d.pnl >= 0 ? 'positive' : 'negative'}>
              {formatSignedUnits(d.pnl)} units
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
});

// ==================== Add Investment Modal ====================

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
  availableBalance?: number | null;
  currency?: string;
}

function AddBetModal({ open, onClose, onSave, saving, availableBalance, currency = 'units' }: AddBetModalProps) {
  const [form, setForm] = useState<AddBetFormState>(EMPTY_FORM);

  const set = (field: keyof AddBetFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const stake = parseFloat(form.stake);
  const available = availableBalance ?? null;
  const overAvailable = available != null && stake > available;
  const valid = form.selection.trim()
    && parseFloat(form.odds) > 1
    && stake > 0
    && !overAvailable;

  const handleSubmit = async () => {
    if (!valid || saving) return;
    await onSave(form);
    setForm(EMPTY_FORM);
  };

  return (
    <Modal
      open={open}
      title="Log investment"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => { void handleSubmit(); }} disabled={!valid || saving}>
            {saving ? 'Saving…' : 'Add investment'}
          </button>
        </>
      }
    >
      <div className="investment-form-grid">
        <label className="investment-form-field investment-form-field--full">
          <span className="investment-form-field__label">Match ID (optional)</span>
          <input className="filter-input" placeholder="e.g. 987654" value={form.match_id} onChange={set('match_id')} />
        </label>
        <label className="investment-form-field">
          <span className="investment-form-field__label">Market *</span>
          <select className="filter-input" value={form.market} onChange={set('market')}>
            {MARKET_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="investment-form-field">
          <span className="investment-form-field__label">Selection *</span>
          <input className="filter-input" placeholder="e.g. Over 2.5" value={form.selection} onChange={set('selection')} />
        </label>
        <label className="investment-form-field">
          <span className="investment-form-field__label">Odds *</span>
          <input className="filter-input" type="number" min="1.01" step="0.01" placeholder="e.g. 1.85" value={form.odds} onChange={set('odds')} />
        </label>
        <label className="investment-form-field">
          <span className="investment-form-field__label">Stake (units) *</span>
          <input className="filter-input" type="number" min="0.01" step="0.01" placeholder="e.g. 50" value={form.stake} onChange={set('stake')} />
          {available != null && (
            <span className={`investment-form-field__hint ${overAvailable ? 'investment-form-field__hint--error' : ''}`}>
              Available {formatBankrollUnits(available)} {currency}
            </span>
          )}
        </label>
        <label className="investment-form-field investment-form-field--full">
          <span className="investment-form-field__label">Bookmaker</span>
          <input className="filter-input" placeholder="e.g. sportsbook name" value={form.bookmaker} onChange={set('bookmaker')} />
        </label>
      </div>
    </Modal>
  );
});

function LedgerRow({ entry }: { entry: BankrollLedgerEntry }) {
  const tone = entry.amount >= 0 ? 'positive' : 'negative';
  return (
    <div className="investment-ledger-row">
      <div className="investment-ledger-row__main">
        <span className="investment-ledger-row__type">{formatBankrollEntryType(entry.entry_type)}</span>
        <span className="investment-ledger-row__note">{entry.note || '—'}</span>
      </div>
      <time className="investment-ledger-row__time" dateTime={entry.created_at}>
        {formatLocalDateTime(entry.created_at)}
      </time>
      <span className={`investment-ledger-row__amount ${tone}`}>
        {formatSignedUnits(entry.amount)}
      </span>
    </div>
  );
}

function BankrollOverview({
  snapshot,
  loading,
  saving,
  stats,
  bets,
  onRefresh,
  onDeposit,
  onWithdraw,
}: {
  snapshot: BankrollSnapshot | null;
  loading: boolean;
  saving: boolean;
  stats: BetStats | null;
  bets: BetRecord[];
  onRefresh: () => void;
  onDeposit: (amount: number) => Promise<void>;
  onWithdraw: (amount: number) => Promise<void>;
}) {
  const [depositDraft, setDepositDraft] = useState('');
  const [withdrawDraft, setWithdrawDraft] = useState('');
  const account = snapshot?.account;
  const currency = account?.currency ?? 'VND';
  const multiplier = account?.unit_multiplier ?? 1000;
  const openExposure = bets
    .filter((bet) => !FINAL_BET_RESULTS.has(bet.result || ''))
    .reduce((sum, bet) => sum + betStakeUnits(bet), 0);
  const realizedPnl = stats?.total_pnl ?? 0;
  const bankrollDelta = account ? account.current_balance - account.initial_balance : 0;
  const availableBalance = account?.current_balance ?? null;
  const withdrawAmount = Number(withdrawDraft);
  const withdrawTooMuch = availableBalance != null
    && Number.isFinite(withdrawAmount)
    && withdrawAmount > availableBalance;

  const submitDeposit = async () => {
    const amount = Number(depositDraft);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await onDeposit(amount);
    setDepositDraft('');
  };

  const submitWithdraw = async () => {
    const amount = Number(withdrawDraft);
    if (!Number.isFinite(amount) || amount <= 0 || withdrawTooMuch) return;
    await onWithdraw(amount);
    setWithdrawDraft('');
  };

  return (
    <section className="investment-tracker__bankroll-block" aria-label="Bankroll overview">
      <div className="bankroll-summary-card">
        <div className="bankroll-summary-main">
          <span className="investment-tracker__eyebrow">Available capital</span>
          <div className="bankroll-summary-balance investment-tracker__balance" aria-busy={loading}>
            {loading && !account ? '…' : account ? `${formatBankrollUnits(account.current_balance)} units` : '—'}
          </div>
          {account && (
            <p className="investment-tracker__bankroll-meta">
              ×{multiplier} {currency} per unit · Initial {formatBankrollUnits(account.initial_balance)} units
            </p>
          )}
          <div className="investment-tracker__bankroll-links">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading || saving}>
              Refresh
            </button>
            <button type="button" className="bankroll-inline-bar__link" onClick={openBankrollSettings}>
              Bankroll settings
            </button>
          </div>
        </div>
        <div className="bankroll-summary-metrics">
          <div className="bankroll-summary-metric">
            <span className="investment-tracker__metric-label">Open exposure</span>
            <span className="bankroll-summary-value">{formatBankrollUnits(openExposure)}</span>
            <span className="investment-tracker__metric-sub">units at risk</span>
          </div>
          <div className="bankroll-summary-metric">
            <span className="investment-tracker__metric-label">Realized P/L</span>
            <span className={`bankroll-summary-value ${realizedPnl >= 0 ? 'positive' : 'negative'}`}>
              {formatSignedUnits(realizedPnl)}
            </span>
            <span className="investment-tracker__metric-sub">units settled</span>
          </div>
          <div className="bankroll-summary-metric">
            <span className="investment-tracker__metric-label">Bankroll delta</span>
            <span className={`bankroll-summary-value ${bankrollDelta >= 0 ? 'positive' : 'negative'}`}>
              {account ? formatSignedUnits(bankrollDelta) : '—'}
            </span>
            <span className="investment-tracker__metric-sub">vs initial</span>
          </div>
        </div>
      </div>

      <div className="card tab-section investment-tracker__cashflow">
        <div className="chart-panel__header">
          <div>
            <span className="chart-panel__title">Cash movements</span>
            <span className="chart-panel__hint">Top-ups and withdrawals update your available balance immediately</span>
          </div>
        </div>
        <div className="settings-form-grid investment-tracker__cashflow-grid">
          <div className="settings-form-card">
            <div className="settings-form-card__title">Top up</div>
            <div className="settings-form-card__fields">
              <label className="settings-field-label">
                Amount (units)
                <input
                  className="filter-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={depositDraft}
                  onChange={(e) => setDepositDraft(e.target.value)}
                  placeholder="Amount"
                />
              </label>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => { void submitDeposit(); }}
                disabled={saving || !depositDraft}
              >
                Add funds
              </button>
            </div>
          </div>
          <div className="settings-form-card">
            <div className="settings-form-card__title">Withdraw</div>
            <div className="settings-form-card__fields">
              <label className="settings-field-label">
                Amount (units)
                <input
                  className="filter-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={withdrawDraft}
                  onChange={(e) => setWithdrawDraft(e.target.value)}
                  placeholder="Amount"
                />
              </label>
              {withdrawTooMuch && (
                <span className="investment-form-field__hint investment-form-field__hint--error">
                  Exceeds available {formatBankrollUnits(availableBalance)} units
                </span>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => { void submitWithdraw(); }}
                disabled={saving || !withdrawDraft || withdrawTooMuch}
              >
                Withdraw
              </button>
            </div>
          </div>
        </div>
      </div>

      {snapshot && (
        <div className="card tab-section investment-tracker__ledger">
          <div className="chart-panel__header">
            <div>
              <span className="chart-panel__title">Recent ledger</span>
              <span className="chart-panel__hint">Stakes, payouts, deposits, and adjustments</span>
            </div>
          </div>
          {snapshot.recentLedger.length > 0 ? (
            <div className="investment-ledger-list" role="list">
              {snapshot.recentLedger.slice(0, 8).map((entry) => (
                <LedgerRow key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <EmptyState title="No ledger activity yet. Top up or log an investment to see entries here." />
          )}
        </div>
      )}
    </section>
  );
}

function MarketPill({ market }: { market: string }) {
  const color = MARKET_COLORS[market] ?? '#6b7280';
  return (
    <span className="market-pill" style={{ '--market-color': color } as React.CSSProperties}>
      {market || '—'}
    </span>
  );
}

// ==================== Main Tab ====================

export function BetTrackerTab() {
  const { state } = useAppState();
  const { config } = state;
  const { showToast } = useToast();

  const [bets, setBets] = useState<BetRecord[]>([]);
  const [stats, setStats] = useState<BetStats | null>(null);
  const [markets, setMarkets] = useState<BetMarketStats[]>([]);
  const [bankroll, setBankroll] = useState<BankrollSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bankrollSaving, setBankrollSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const [resultFilter, setResultFilter] = useState<string>('all');
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [b, s, m, bankrollSnapshot] = await Promise.all([
        fetchBets(config),
        fetchBetStats(config).catch(() => null),
        fetchBetStatsByMarket(config).catch(() => []),
        fetchMyBankroll(config).catch(() => null),
      ]);
      setBets(b);
      setStats(s);
      setMarkets(m);
      setBankroll(bankrollSnapshot);
    } catch {
      showToast('Failed to load investments', 'error');
    } finally {
      setLoading(false);
    }
  }, [config, showToast]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const filtered = bets.filter((b) => {
    if (resultFilter !== 'all' && b.result !== resultFilter) return false;
    if (marketFilter !== 'all' && b.market !== marketFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [resultFilter, marketFilter]);

  const availableMarkets = Array.from(new Set(bets.map((b) => b.market).filter(Boolean)));
  const unsettledCount = stats?.unsettled ?? stats?.pending ?? 0;
  const settledCount = stats ? stats.total - unsettledCount : 0;
  const hitRate = stats
    ? ((stats.wins / Math.max(stats.wins + stats.losses, 1)) * 100).toFixed(1)
    : null;

  const handleAddBet = async (form: AddBetFormState) => {
    setSaving(true);
    try {
      await createBet(config, {
        match_id: form.match_id.trim() || 'manual',
        market: form.market,
        selection: form.selection.trim(),
        odds: parseFloat(form.odds),
        stake: parseFloat(form.stake),
        bookmaker: form.bookmaker.trim() || 'Unknown',
        recommendation_id: null,
      });
      showToast('Investment logged', 'success');
      setShowAdd(false);
      await loadAll();
    } catch {
      showToast('Failed to save investment', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeposit = async (amount: number) => {
    setBankrollSaving(true);
    try {
      const next = await depositMyBankroll(config, { amount, note: 'Investment Tracker top-up' });
      setBankroll(next);
      showToast('Bankroll topped up', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to top up bankroll', 'error');
    } finally {
      setBankrollSaving(false);
    }
  };

  const handleWithdraw = async (amount: number) => {
    setBankrollSaving(true);
    try {
      const next = await withdrawMyBankroll(config, { amount, note: 'Investment Tracker withdrawal' });
      setBankroll(next);
      showToast('Withdrawal recorded', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to withdraw', 'error');
    } finally {
      setBankrollSaving(false);
    }
  };

  const pnlPositive = stats != null && stats.total_pnl >= 0;
  const roiPositive = stats != null && stats.roi >= 0;
  const bankrollAccount = bankroll?.account;
  const filtersActive = resultFilter !== 'all' || marketFilter !== 'all';

  return (
    <div className="investment-tracker">
      <header className="investment-tracker__intro">
        <p className="investment-tracker__intro-text">
          Track bankroll capital, log manual investments, and review settled P/L in one place.
          Currency and unit size are configured in Settings.
        </p>
      </header>

      <BankrollOverview
        snapshot={bankroll}
        loading={loading}
        saving={bankrollSaving || saving}
        stats={stats}
        bets={bets}
        onRefresh={() => { void loadAll(); }}
        onDeposit={handleDeposit}
        onWithdraw={handleWithdraw}
      />

      <section className="investment-tracker__performance" aria-label="Investment performance">
        <h2 className="investment-tracker__section-title">Performance</h2>
        <div className="stats-grid investment-tracker__stats">
          <KpiCard
            label="Total investments"
            value={stats ? String(stats.total) : '—'}
            sub={`${unsettledCount} unsettled · ${settledCount} settled`}
          />
          <KpiCard
            label="Hit rate (W/L)"
            value={hitRate != null ? `${hitRate}%` : '—'}
            sub={stats ? `${stats.wins}W · ${stats.losses}L · ${stats.pushes}P` : undefined}
          />
          <KpiCard
            label="Total P/L"
            value={stats ? `${formatSignedUnits(stats.total_pnl)} units` : '—'}
            positive={stats ? pnlPositive : null}
          />
          <KpiCard
            label="ROI on stake"
            value={stats ? `${roiPositive ? '+' : ''}${stats.roi.toFixed(1)}%` : '—'}
            positive={stats ? roiPositive : null}
          />
        </div>
      </section>

      <MarketChart data={markets} />

      <section className="card tab-page-card investment-tracker__log" aria-label="Investment log">
        <div className="chart-panel__header investment-tracker__log-header">
          <div>
            <span className="chart-panel__title">Investment log</span>
            <span className="chart-panel__hint">Stakes debited from bankroll; P/L applied on settlement</span>
          </div>
          <div className="investment-tracker__log-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
              + Log investment
            </button>
          </div>
        </div>

        <div className="sticky-filter-bar bet-tracker-filters">
          <div className="page-toolbar">
            <div className="page-toolbar__filters page-toolbar__filters--wrap">
              <select
                className="filter-input filter-input--compact"
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value)}
                aria-label="Filter by result"
              >
                <option value="all">All results</option>
                <option value="pending">Pending</option>
                <option value="win">Won</option>
                <option value="loss">Lost</option>
                <option value="push">Push</option>
              </select>
              <select
                className="filter-input filter-input--compact"
                value={marketFilter}
                onChange={(e) => setMarketFilter(e.target.value)}
                aria-label="Filter by market"
              >
                <option value="all">All markets</option>
                {availableMarkets.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {filtersActive && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setResultFilter('all'); setMarketFilter('all'); }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="table-container">
          {loading ? (
            <div className="loading-panel">
              <div className="loading-spinner" />
              <p>Loading investments…</p>
            </div>
          ) : pageItems.length === 0 ? (
            <EmptyState
              title={bets.length === 0 ? 'No investments logged yet' : 'No investments match these filters'}
              action={bets.length === 0 ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
                  + Log investment
                </button>
              ) : undefined}
            />
          ) : (
            <>
              <div className="table-container__scroll">
                <table className="data-table investment-tracker__table">
                  <thead>
                    <tr>
                      <th className="data-table__th--narrow">Placed</th>
                      <th>Match ID</th>
                      <th>Market</th>
                      <th>Selection</th>
                      <th className="data-table__th--center">Odds</th>
                      <th className="data-table__th--center">Stake</th>
                      <th>Bookmaker</th>
                      <th className="data-table__th--center">Result</th>
                      <th className="data-table__th--right">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((bet) => {
                      const pnl = bet.pnl ?? 0;
                      const badge = BET_RESULT_BADGES[bet.result] ?? { cls: 'badge-ns', label: bet.result };
                      const stakeUnits = betStakeUnits(bet);
                      return (
                        <tr key={bet.id}>
                          <td data-label="Placed">
                            <span className="cell-value">
                              <span className="cell-time-badge">{formatLocalDateTime(bet.placed_at)}</span>
                            </span>
                          </td>
                          <td className="investment-tracker__match-id">{bet.match_id || '—'}</td>
                          <td><MarketPill market={bet.market} /></td>
                          <td className="investment-tracker__selection">{bet.selection}</td>
                          <td className="investment-tracker__odds">{bet.odds}</td>
                          <td className="investment-tracker__stake">{formatBankrollUnits(stakeUnits)}</td>
                          <td className="investment-tracker__bookmaker">{bet.bookmaker || '—'}</td>
                          <td className="investment-tracker__result">
                            <span className={`badge ${badge.cls}`}>{badge.label}</span>
                          </td>
                          <td className={`investment-tracker__pnl ${pnl >= 0 ? 'positive' : 'negative'}`}>
                            {bet.result === 'pending' ? '—' : formatSignedUnits(pnl)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="page-toolbar__footer">
                  <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <AddBetModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={handleAddBet}
        saving={saving}
        availableBalance={bankrollAccount?.current_balance}
        currency={bankrollAccount?.currency ?? 'units'}
      />
    </div>
  );
}
