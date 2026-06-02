import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MatchDetailModal } from '@/components/ui/MatchDetailModal';
import { RecommendationCard } from '@/components/ui/RecommendationCard';
import { Modal } from '@/components/ui/Modal';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  fetchRecommendationsPaginated,
  fetchRecommendationsSummary,
  fetchRecommendationsChartSeries,
  fetchRecommendationDeliveriesPaginated,
  fetchRecommendationDeliveriesSummary,
  fetchRecommendationDeliveriesChartSeries,
  fetchBetTypes,
  fetchDistinctLeagues,
  settleRecommendationFinal,
  investInRecommendation,
  deleteRecommendation,
  deleteRecommendationsBulk,
} from '@/lib/services/api';
import type { RecommendationListSummary, RecommendationChartPoint } from '@/lib/services/api';
import { formatLocalDateTime } from '@/lib/utils/helpers';
import { PageHeader } from '@/components/ui/PageHeader';
import { DatePicker } from '@/components/ui/DatePicker';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { FeedModeToggle } from '@/components/ui/FeedModeToggle';
import { sortIndicator as tableSortIndicator } from '@/lib/utils/sortable-table';
import { fetchMonitorConfig } from '@/features/live-monitor/config';
import { fetchCurrentUser, getToken, getUser } from '@/lib/services/auth';
import type { Recommendation, RecommendationDelivery } from '@/types';

type ViewMode = 'cards' | 'table';
type RecommendationFeedMode = 'shared' | 'deliveries';
type DeliveryKindFilter = 'actionable' | 'all' | 'no_action';

const PAGE_SIZE = 30;

const EMPTY_SUMMARY: RecommendationListSummary = {
  total: 0,
  won: 0,
  lost: 0,
  push: 0,
  voided: 0,
  pending: 0,
  review: 0,
  pnl: 0,
};

const RESULT_FILTER_LABELS: Record<string, string> = {
  correct: 'Won',
  incorrect: 'Lost',
  push: 'Push',
  void: 'Void',
  pending: 'Unsettled',
  review: 'Needs Review',
};

const DELIVERY_KIND_LABELS: Record<DeliveryKindFilter, string> = {
  actionable: 'Actionable only',
  all: 'All delivered',
  no_action: 'No-action only',
};

/** Display label for API `bet_type` values (keeps stored values unchanged). */
function betTypeLabel(value: string): string {
  if (value === 'AI') return 'Model';
  return value;
}

type SortCol = 'time' | 'odds' | 'confidence' | 'pnl' | 'league' | '';
type SortDir = 'asc' | 'desc';

const SORT_COL_MAP: Record<string, string> = {
  time: 'time',
  odds: 'odds',
  confidence: 'confidence',
  pnl: 'pnl',
  league: 'league',
};

const DIRECTIONAL_WIN_RESULTS = new Set(['win', 'half_win']);
const DIRECTIONAL_LOSS_RESULTS = new Set(['loss', 'half_loss']);
const FINAL_RESULTS = new Set(['win', 'loss', 'push', 'void', 'half_win', 'half_loss']);
const MANUAL_SETTLE_OPTIONS = [
  { value: 'win', label: 'Won' },
  { value: 'loss', label: 'Lost' },
  { value: 'half_win', label: 'Half Won' },
  { value: 'half_loss', label: 'Half Lost' },
  { value: 'push', label: 'Push' },
  { value: 'void', label: 'Void' },
] as const;

type FinalResultValue = typeof MANUAL_SETTLE_OPTIONS[number]['value'];

function isFinalResult(result: string | null | undefined): boolean {
  return FINAL_RESULTS.has(String(result));
}

function isUnsettledResult(result: string | null | undefined): boolean {
  return !isFinalResult(result);
}

function isSettlementDelayed(rec: Recommendation): boolean {
  if (!isUnsettledResult(rec.result ?? null)) return false;
  const rawTs = rec.timestamp || rec.created_at;
  if (!rawTs) return false;
  const ts = new Date(rawTs).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > 36 * 60 * 60 * 1000;
}

function needsReview(rec: Recommendation): boolean {
  return rec.settlement_status === 'unresolved' && isFinalResult(rec.result ?? null);
}

function parseNumber(value: number | string | null | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function calcSuggestedPnl(result: FinalResultValue, odds: number | null, stakePercent: number | null): number | null {
  if (odds == null || stakePercent == null) return null;
  switch (result) {
    case 'win':
      return round((odds - 1) * stakePercent);
    case 'loss':
      return round(-stakePercent);
    case 'half_win':
      return round(((odds - 1) * stakePercent) / 2);
    case 'half_loss':
      return round(-stakePercent / 2);
    case 'push':
    case 'void':
      return 0;
  }
}

function mapDeliveryToRecommendation(row: RecommendationDelivery): Recommendation {
  const homeTeam = row.recommendation_home_team ?? '';
  const awayTeam = row.recommendation_away_team ?? '';
  return {
    id: row.recommendation_id,
    delivery_id: row.id,
    match_id: row.match_id,
    match_display: homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : row.match_id,
    home_team: homeTeam || undefined,
    away_team: awayTeam || undefined,
    league: row.recommendation_league ?? undefined,
    timestamp: row.recommendation_timestamp ?? row.created_at,
    minute: row.recommendation_minute ?? undefined,
    score: row.recommendation_score ?? undefined,
    actual_outcome: row.recommendation_actual_outcome ?? undefined,
    bet_type: row.recommendation_bet_type ?? 'AI',
    bet_market: row.recommendation_bet_market ?? undefined,
    selection: row.recommendation_selection ?? '-',
    odds: row.recommendation_odds ?? '-',
    confidence: row.recommendation_confidence ?? '-',
    value_percent: row.recommendation_value_percent ?? undefined,
    risk_level: row.recommendation_risk_level ?? undefined,
    stake_percent: row.recommendation_stake_percent ?? undefined,
    stake_amount: row.recommendation_stake_amount ?? 0,
    bankroll_currency: row.bankroll_currency,
    bankroll_unit_multiplier: row.bankroll_unit_multiplier,
    bankroll_balance_before: row.bankroll_balance_before,
    bankroll_balance_after: row.bankroll_balance_after,
    reasoning: row.recommendation_reasoning ?? undefined,
    reasoning_vi: row.recommendation_reasoning_vi ?? undefined,
    key_factors: row.recommendation_key_factors ?? undefined,
    warnings: row.recommendation_warnings ?? undefined,
    result: row.recommendation_result ?? row.delivery_status,
    pnl: row.recommendation_pnl ?? 0,
    settlement_status: row.recommendation_settlement_status ?? undefined,
    settlement_note: row.recommendation_settlement_note ?? undefined,
    created_at: row.created_at,
  };
}

function latestPerMatch(rows: Recommendation[]): Recommendation[] {
  const byMatch = new Map<string, Recommendation>();
  for (const row of rows) {
    const key = row.match_id || row.match_display || String(row.id ?? '');
    const current = byMatch.get(key);
    const rowTs = new Date(row.timestamp || row.created_at || 0).getTime();
    const currentTs = current ? new Date(current.timestamp || current.created_at || 0).getTime() : -Infinity;
    if (!current || rowTs > currentTs || (rowTs === currentTs && Number(row.delivery_id ?? row.id ?? 0) > Number(current.delivery_id ?? current.id ?? 0))) {
      byMatch.set(key, row);
    }
  }
  return Array.from(byMatch.values());
}

export function RecommendationsTab() {
  const { state } = useAppState();
  const { config, leagues: appLeagues, matches: appMatches } = state;
  const { showToast } = useToast();
  const [authUser, setAuthUser] = useState(() => getUser(getToken()));
  const isAdmin = authUser?.role === 'admin' || authUser?.role === 'owner';
  const [notificationLang, setNotificationLang] = useState<'vi' | 'en' | 'both'>('vi');
  const [feedMode, setFeedMode] = useState<RecommendationFeedMode>('shared');
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState<string>('all');
  const [betTypeFilter, setBetTypeFilter] = useState<string>('all');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [deliveryKindFilter, setDeliveryKindFilter] = useState<DeliveryKindFilter>('actionable');
  const [latestByMatch, setLatestByMatch] = useState(true);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sortCol, setSortCol] = useState<SortCol>('');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showChart, setShowChart] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [detailMatch, setDetailMatch] = useState<{ id: string; display: string } | null>(null);
  const [settleTarget, setSettleTarget] = useState<Recommendation | null>(null);
  const [settleResult, setSettleResult] = useState<FinalResultValue>('win');
  const [settlePnl, setSettlePnl] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [settleSaving, setSettleSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<number[] | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [investTarget, setInvestTarget] = useState<Recommendation | null>(null);
  const [investOdds, setInvestOdds] = useState('');
  const [investStakePercent, setInvestStakePercent] = useState('');
  const [investStakeAmount, setInvestStakeAmount] = useState('');
  const [investBookmaker, setInvestBookmaker] = useState('');
  const [investSaving, setInvestSaving] = useState(false);

  // Server data
  const [rows, setRows] = useState<Recommendation[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<RecommendationListSummary>(EMPTY_SUMMARY);
  const [summaryScope, setSummaryScope] = useState<'filtered' | 'page'>('filtered');
  const [chartSeries, setChartSeries] = useState<RecommendationChartPoint[]>([]);
  const [chartScope, setChartScope] = useState<'filtered' | 'page'>('filtered');
  const [betTypes, setBetTypes] = useState<string[]>([]);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const adminCanDelete = isAdmin;

  // `/` key focuses search
  useEffect(() => {
    let mounted = true;
    const syncNotificationLanguage = () => {
      void fetchMonitorConfig()
        .then((monitorConfig) => {
          if (!mounted) return;
          setNotificationLang((monitorConfig.NOTIFICATION_LANGUAGE as 'vi' | 'en' | 'both') || 'vi');
        })
        .catch(() => undefined);
    };

    syncNotificationLanguage();
    window.addEventListener('tfi:settings-updated', syncNotificationLanguage as EventListener);

    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      mounted = false;
      window.removeEventListener('keydown', handler);
      window.removeEventListener('tfi:settings-updated', syncNotificationLanguage as EventListener);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void fetchCurrentUser(config.apiUrl)
      .then((user) => {
        if (!mounted || !user) return;
        setAuthUser(user);
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, [config.apiUrl]);

  // Sort leagues: top leagues first
  const sortedLeagues = useMemo(() => {
    const topNames = new Set(appLeagues.filter((l) => l.top_league).map((l) => l.league_name));
    return [...leagues].sort((a, b) => {
      const aTop = topNames.has(a);
      const bTop = topNames.has(b);
      if (aTop !== bTop) return aTop ? -1 : 1;
      return a.localeCompare(b);
    });
  }, [leagues, appLeagues]);

  // Count active filters
  const activeFilterCount = [
    search.trim() !== '',
    resultFilter !== 'all',
    betTypeFilter !== 'all',
    leagueFilter !== 'all',
    riskFilter !== 'all',
    feedMode === 'deliveries' && deliveryKindFilter !== 'actionable',
    feedMode === 'deliveries' && !latestByMatch,
    dateFrom !== '',
    dateTo !== '',
  ].filter(Boolean).length;

  const listFilterParams = useMemo(() => ({
    result: resultFilter !== 'all' ? resultFilter : undefined,
    bet_type: betTypeFilter !== 'all' ? betTypeFilter : undefined,
    league: leagueFilter !== 'all' ? leagueFilter : undefined,
    risk_level: riskFilter !== 'all' ? riskFilter : undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    search: search.trim() || undefined,
    deliveryKind: feedMode === 'deliveries' ? deliveryKindFilter : undefined,
  }), [betTypeFilter, dateFrom, dateTo, deliveryKindFilter, feedMode, leagueFilter, resultFilter, riskFilter, search]);

  const computePageSummary = useCallback((pageRows: Recommendation[], pageTotal: number): RecommendationListSummary => {
    const settled = pageRows.filter((r) => isFinalResult(r.result ?? null));
    return {
      total: pageTotal,
      won: settled.filter((r) => DIRECTIONAL_WIN_RESULTS.has(String(r.result))).length,
      lost: settled.filter((r) => DIRECTIONAL_LOSS_RESULTS.has(String(r.result))).length,
      push: settled.filter((r) => r.result === 'push').length,
      voided: settled.filter((r) => r.result === 'void').length,
      pending: pageRows.filter((r) => !isFinalResult(r.result ?? null)).length,
      review: pageRows.filter((r) => needsReview(r)).length,
      pnl: settled.reduce((s, r) => s + parseFloat(String(r.pnl ?? 0)), 0),
    };
  }, []);

  const computePageChartSeries = useCallback((pageRows: Recommendation[]): RecommendationChartPoint[] => {
    const sorted = [...pageRows]
      .filter((r) => isFinalResult(r.result ?? null) && (r.timestamp || r.created_at))
      .sort((a, b) => new Date(a.timestamp || a.created_at!).getTime() - new Date(b.timestamp || b.created_at!).getTime());

    let cum = 0;
    return sorted.map((r, i) => {
      cum += parseFloat(String(r.pnl ?? 0));
      return { idx: i + 1, cumulative: parseFloat(cum.toFixed(2)) };
    });
  }, []);

  // Fetch recommendations from server
  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    const queryParams = {
      ...listFilterParams,
      limit: PAGE_SIZE,
      offset: (p - 1) * PAGE_SIZE,
      sort_by: sortCol ? SORT_COL_MAP[sortCol] : undefined,
      sort_dir: sortCol ? sortDir : undefined,
    };

    try {
      if (feedMode === 'deliveries') {
        const [res, summaryRes] = await Promise.all([
          fetchRecommendationDeliveriesPaginated(config, queryParams),
          fetchRecommendationDeliveriesSummary(config, listFilterParams).catch(() => null),
        ]);
        const mappedRows = res.rows.map(mapDeliveryToRecommendation);
        setRows(mappedRows);
        setTotal(res.total);
        if (summaryRes) {
          setSummary(summaryRes);
          setSummaryScope('filtered');
        } else {
          setSummary(computePageSummary(mappedRows, res.total));
          setSummaryScope('page');
        }
      } else {
        const [res, summaryRes] = await Promise.all([
          fetchRecommendationsPaginated(config, queryParams),
          fetchRecommendationsSummary(config, listFilterParams).catch(() => null),
        ]);
        setRows(res.rows);
        setTotal(res.total);
        if (summaryRes) {
          setSummary(summaryRes);
          setSummaryScope('filtered');
        } else {
          setSummary(computePageSummary(res.rows, res.total));
          setSummaryScope('page');
        }
      }
    } catch {
      // keep previous data
    } finally {
      setLoading(false);
    }
  }, [computePageSummary, config, feedMode, listFilterParams, sortCol, sortDir]);

  // Load filter options once
  useEffect(() => {
    fetchBetTypes(config).then(setBetTypes).catch(() => {});
    fetchDistinctLeagues(config).then(setLeagues).catch(() => {});
  }, [config]);

  // Debounced fetch on filter/page change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData(page);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [fetchData, page]);

  useEffect(() => {
    if (!showChart) {
      setChartSeries([]);
      return;
    }

    let cancelled = false;
    const loadChart = async () => {
      try {
        const series = feedMode === 'deliveries'
          ? await fetchRecommendationDeliveriesChartSeries(config, listFilterParams)
          : await fetchRecommendationsChartSeries(config, listFilterParams);
        if (!cancelled) {
          setChartSeries(series);
          setChartScope('filtered');
        }
      } catch {
        if (!cancelled) {
          setChartSeries(computePageChartSeries(rows));
          setChartScope('page');
        }
      }
    };

    void loadChart();
    return () => { cancelled = true; };
  }, [computePageChartSeries, config, feedMode, listFilterParams, rows, showChart]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(rows.map((row) => row.id).filter((id): id is number => typeof id === 'number'));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const chartData = showChart ? chartSeries : [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleRows = feedMode === 'deliveries' && latestByMatch ? latestPerMatch(rows) : rows;

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      chips.push({ key: 'search', label: `Search: ${trimmedSearch}`, onRemove: () => { setSearch(''); setPage(1); } });
    }
    if (resultFilter !== 'all') {
      chips.push({
        key: 'result',
        label: `Status: ${RESULT_FILTER_LABELS[resultFilter] ?? resultFilter}`,
        onRemove: () => { setResultFilter('all'); setPage(1); },
      });
    }
    if (betTypeFilter !== 'all') {
      chips.push({
        key: 'market',
        label: `Market: ${betTypeLabel(betTypeFilter)}`,
        onRemove: () => { setBetTypeFilter('all'); setPage(1); },
      });
    }
    if (leagueFilter !== 'all') {
      chips.push({
        key: 'league',
        label: `League: ${leagueFilter}`,
        onRemove: () => { setLeagueFilter('all'); setPage(1); },
      });
    }
    if (riskFilter !== 'all') {
      chips.push({
        key: 'risk',
        label: `Risk: ${riskFilter}`,
        onRemove: () => { setRiskFilter('all'); setPage(1); },
      });
    }
    if (feedMode === 'deliveries' && deliveryKindFilter !== 'actionable') {
      chips.push({
        key: 'deliveryKind',
        label: DELIVERY_KIND_LABELS[deliveryKindFilter],
        onRemove: () => { setDeliveryKindFilter('actionable'); setPage(1); },
      });
    }
    if (feedMode === 'deliveries' && !latestByMatch) {
      chips.push({
        key: 'latestByMatch',
        label: 'Showing every delivery',
        onRemove: () => { setLatestByMatch(true); setPage(1); },
      });
    }
    if (dateFrom) {
      chips.push({
        key: 'dateFrom',
        label: `From: ${dateFrom}`,
        onRemove: () => { setDateFrom(''); setPage(1); },
      });
    }
    if (dateTo) {
      chips.push({
        key: 'dateTo',
        label: `To: ${dateTo}`,
        onRemove: () => { setDateTo(''); setPage(1); },
      });
    }
    return chips;
  }, [betTypeFilter, dateFrom, dateTo, deliveryKindFilter, feedMode, latestByMatch, leagueFilter, resultFilter, riskFilter, search]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
    setPage(1);
  };

  const sortIcon = (col: SortCol) => tableSortIndicator(sortCol, col, sortDir);

  const clearFilters = () => {
    setResultFilter('all');
    setBetTypeFilter('all');
    setLeagueFilter('all');
    setRiskFilter('all');
    setDeliveryKindFilter('actionable');
    setLatestByMatch(true);
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setPage(1);
  };

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const pageIds = visibleRows
      .map((row) => row.id)
      .filter((id): id is number => typeof id === 'number');
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [selectedIds, visibleRows]);

  const handleDeleteSingle = useCallback((recommendationId: number) => {
    setDeleteConfirmIds([recommendationId]);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      showToast('No recommendations selected', 'info');
      return;
    }
    setDeleteConfirmIds(ids);
  }, [selectedIds, showToast]);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirmIds || deleteConfirmIds.length === 0) return;
    setDeleteSaving(true);
    try {
      const result = deleteConfirmIds.length === 1
        ? await deleteRecommendation(config, deleteConfirmIds[0]!)
        : await deleteRecommendationsBulk(config, deleteConfirmIds);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        result.deletedRecommendationIds.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteConfirmIds(null);
      showToast(`Deleted ${result.recommendationsDeleted} recommendation(s)`, 'success');
      await fetchData(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete recommendation(s).';
      showToast(message, 'error');
    } finally {
      setDeleteSaving(false);
    }
  }, [config, deleteConfirmIds, fetchData, page, showToast]);

  const openSettleModal = useCallback((rec: Recommendation) => {
    const defaultResult = isFinalResult(rec.result ?? '') ? rec.result : 'win';
    const resultValue = (defaultResult as FinalResultValue);
    const odds = parseNumber(rec.odds);
    const stakePercent = parseNumber(rec.stake_percent);
    const existingPnl = parseNumber(rec.pnl);
    const suggestedPnl = calcSuggestedPnl(resultValue, odds, stakePercent);
    setSettleTarget(rec);
    setSettleResult(resultValue);
    setSettlePnl(String(existingPnl ?? suggestedPnl ?? 0));
    setSettleNote(rec.actual_outcome || '');
  }, []);

  useEffect(() => {
    if (!settleTarget) return;
    const suggested = calcSuggestedPnl(settleResult, parseNumber(settleTarget.odds), parseNumber(settleTarget.stake_percent));
    if (suggested != null) {
      setSettlePnl(String(suggested));
    }
  }, [settleResult, settleTarget]);

  const handleFinalizeSettle = useCallback(async () => {
    if (!settleTarget?.id) return;
    const pnlValue = Number(settlePnl);
    if (!Number.isFinite(pnlValue)) {
      showToast('P/L must be a valid number.', 'error');
      return;
    }
    setSettleSaving(true);
    try {
      await settleRecommendationFinal(config, settleTarget.id, {
        result: settleResult,
        pnl: pnlValue,
        actual_outcome: settleNote.trim() || undefined,
      });
      showToast('Final settlement saved.', 'success');
      setSettleTarget(null);
      await fetchData(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save final settlement.';
      showToast(message, 'error');
    } finally {
      setSettleSaving(false);
    }
  }, [config, fetchData, page, settleNote, settlePnl, settleResult, settleTarget, showToast]);

  const canInvest = useCallback((rec: Recommendation): boolean => {
    return Boolean(rec.id && !isFinalResult(rec.result ?? null) && rec.selection && parseNumber(rec.odds) != null);
  }, []);

  const openInvestModal = useCallback((rec: Recommendation) => {
    setInvestTarget(rec);
    setInvestOdds(String(parseNumber(rec.odds) ?? ''));
    setInvestStakePercent(String(parseNumber(rec.stake_percent) ?? ''));
    setInvestStakeAmount('');
    setInvestBookmaker('');
  }, []);

  const handleConfirmInvest = useCallback(async () => {
    if (!investTarget?.id) return;
    const odds = Number(investOdds);
    const stakePercent = investStakePercent.trim() ? Number(investStakePercent) : null;
    const stakeAmount = investStakeAmount.trim() ? Number(investStakeAmount) : null;
    if (!Number.isFinite(odds) || odds <= 1) {
      showToast('Odds must be above 1.00.', 'error');
      return;
    }
    if (stakePercent != null && (!Number.isFinite(stakePercent) || stakePercent <= 0)) {
      showToast('Stake percent must be greater than 0.', 'error');
      return;
    }
    if (stakeAmount != null && (!Number.isFinite(stakeAmount) || stakeAmount <= 0)) {
      showToast('Stake amount must be greater than 0.', 'error');
      return;
    }
    setInvestSaving(true);
    try {
      await investInRecommendation(config, investTarget.id, {
        deliveryId: investTarget.delivery_id ?? null,
        odds,
        stakePercent,
        stakeAmount,
        bookmaker: investBookmaker.trim() || null,
      });
      showToast('Investment confirmed.', 'success');
      setInvestTarget(null);
      await fetchData(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to confirm investment.';
      showToast(message, 'error');
    } finally {
      setInvestSaving(false);
    }
  }, [config, fetchData, investBookmaker, investOdds, investStakeAmount, investStakePercent, investTarget, page, showToast]);

  const showActionColumn = adminCanDelete || visibleRows.some((row) => canInvest(row));

  return (
    <div>
      <PageHeader
        subtitle={
          <div className="stat-strip">
            <span className="stat-strip__label">
              {feedMode === 'shared' ? 'Shared feed' : 'My deliveries'}
              {summaryScope === 'page' ? ' · page stats' : ' · filtered'}
            </span>
            <span className="stat-strip__item">{summary.total} total</span>
            <span className="stat-strip__item text-positive">{summary.won} Won</span>
            <span className="stat-strip__item text-negative">{summary.lost} Lost</span>
            <span className="stat-strip__item">{summary.push} Push</span>
            <span className="stat-strip__item">{summary.voided} Void</span>
            <span className="stat-strip__item">{summary.pending} Unsettled</span>
            <span className="stat-strip__item">{summary.review} Needs Review</span>
            <span className={`stat-strip__item ${summary.pnl >= 0 ? 'text-positive' : 'text-negative'}`} style={{ fontWeight: 600 }}>
              P/L: {summary.pnl >= 0 ? '+' : ''}${summary.pnl.toFixed(2)}
            </span>
            {loading && <span className="stat-strip__item text-primary-color">Loading...</span>}
          </div>
        }
      />

      {/* Filters + view/chart toggles */}
      <div className="card mb-16 tab-page-card">
        <FeedModeToggle
          value={feedMode}
          onChange={(mode) => { setFeedMode(mode); setPage(1); }}
          options={[
            { value: 'shared', label: 'Shared Recommendations' },
            { value: 'deliveries', label: 'My Deliveries' },
          ]}
          hint={
            feedMode === 'shared'
              ? 'Shared recommendation history for all users.'
              : 'Recommendations delivered to your watch subscriptions.'
          }
        />
        <div className="sticky-filter-bar">
        <div className="page-toolbar">
          <div className="page-toolbar__filters page-toolbar__filters--wrap">
            <input
              ref={searchRef}
              type="text"
              className="filter-input filter-input--search"
              placeholder="Search match / selection… ( / )"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            <select className="filter-input filter-input--compact" value={resultFilter} onChange={(e) => { setResultFilter(e.target.value); setPage(1); }}>
              <option value="all">All Status</option>
              <option value="correct">Won</option>
              <option value="incorrect">Lost</option>
              <option value="push">Push</option>
              <option value="void">Void</option>
              <option value="pending">Pending</option>
              <option value="review">Needs Review</option>
            </select>
            <select className="filter-input filter-input--league" value={leagueFilter} onChange={(e) => { setLeagueFilter(e.target.value); setPage(1); }}>
              <option value="all">All Leagues</option>
              {sortedLeagues.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <select className="filter-input filter-input--compact" value={betTypeFilter} onChange={(e) => { setBetTypeFilter(e.target.value); setPage(1); }}>
              <option value="all">All Markets</option>
              {betTypes.map((t) => (
                <option key={t} value={t}>{betTypeLabel(t)}</option>
              ))}
            </select>
            <select className="filter-input filter-input--compact" value={riskFilter} onChange={(e) => { setRiskFilter(e.target.value); setPage(1); }}>
              <option value="all">All Risk</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
            {feedMode === 'deliveries' && (
              <>
                <select
                  className="filter-input filter-input--compact"
                  value={deliveryKindFilter}
                  onChange={(e) => { setDeliveryKindFilter(e.target.value as DeliveryKindFilter); setPage(1); }}
                  title="Delivery type"
                >
                  <option value="actionable">Actionable only</option>
                  <option value="all">All delivered</option>
                  <option value="no_action">No-action only</option>
                </select>
                <label className="filter-toggle" title="Show only the latest delivered recommendation for each match on this page">
                  <input
                    type="checkbox"
                    checked={latestByMatch}
                    onChange={(e) => { setLatestByMatch(e.target.checked); setPage(1); }}
                  />
                  Latest per match
                </label>
              </>
            )}
            <DatePicker className="filter-input filter-input--date" value={dateFrom} onChange={(v) => { setDateFrom(v); setPage(1); }} title="From date" placeholder="From date" />
            <DatePicker className="filter-input filter-input--date" value={dateTo} onChange={(v) => { setDateTo(v); setPage(1); }} title="To date" placeholder="To date" />
            {activeFilterCount > 0 && (
              <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear</button>
            )}
          </div>
          <div className="page-toolbar__actions">
            <ViewToggle
              mode={viewMode}
              onModeChange={setViewMode}
              showChart
              chartActive={showChart}
              onChartToggle={() => setShowChart((v) => !v)}
            />
          </div>
        </div>
        {activeFilterChips.length > 0 && (
          <div className="filter-chips-row">
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
          </div>
        )}
        </div>
      </div>

      {/* P/L Chart */}
      {showChart && chartData.length > 0 && (
        <div className="card mb-16">
          <div className="chart-panel__header">
            <span className="chart-panel__title">Cumulative P/L</span>
            <span className="chart-panel__hint">
              {chartScope === 'filtered'
                ? 'Settled picks over time (current filters)'
                : 'Settled picks on this page only'}
            </span>
          </div>
          <div className="chart-panel__body">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                <XAxis dataKey="idx" tick={{ fontSize: 10 }} label={{ value: 'Pick #', position: 'insideBottom', offset: -2, fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} label={{ value: 'P/L ($)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11 }} />
                <Tooltip
                  formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Cumulative P/L']}
                  labelFormatter={(label) => `Pick #${label}`}
                />
                <Area type="monotone" dataKey="cumulative" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Card view */}
      {viewMode === 'cards' && (
        <div className="tab-panel">
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          {visibleRows.length === 0 ? (
            <div className="card">
              <EmptyState title={loading ? 'Loading...' : 'No recommendations match filters'} />
            </div>
          ) : (
            <div className="card-grid">
              {visibleRows.map((rec, i) => (
                <div key={rec.id ?? i} className="card-grid__item">
                <RecommendationCard
                  rec={rec}
                  lang={notificationLang}
                  adminAction={rec.id ? (
                    <div className="admin-card-actions">
                      {isSettlementDelayed(rec) && (
                        <span className="badge badge-pending" title="This item is older than 36 hours and still has no settled result.">
                          Settlement delayed
                        </span>
                      )}
                      {canInvest(rec) && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => openInvestModal(rec)}
                          title="Confirm investment"
                        >
                          Invest
                        </button>
                      )}
                      {needsReview(rec) && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openSettleModal(rec)}
                          title="Final Settle"
                        >
                          Settle
                        </button>
                      )}
                      {adminCanDelete && (
                        <button
                          type="button"
                          className="icon-btn-danger"
                          onClick={() => handleDeleteSingle(rec.id!)}
                          title="Delete recommendation"
                          aria-label="Delete recommendation"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  ) : null}
                  onViewMatch={(id, display) => {
                    const effectiveId = id || appMatches.find(
                      m => m.home_team === rec.home_team && m.away_team === rec.away_team,
                    )?.match_id || '';
                    if (effectiveId) setDetailMatch({ id: effectiveId, display });
                  }}
                />
                </div>
              ))}
            </div>
          )}
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && <div className="card">
        <div className="table-container table-cards">
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          {adminCanDelete && selectedIds.size > 0 && (
            <BulkActionBar count={selectedIds.size} variant="danger" onClear={() => setSelectedIds(new Set())}>
              <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteSelected}>Delete Selected</button>
            </BulkActionBar>
          )}
          <table>
            <thead>
              <tr>
                {adminCanDelete && (
                  <th style={{ width: '40px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label="Select all recommendations on page"
                      checked={visibleRows.length > 0 && visibleRows.every((rec) => rec.id != null && selectedIds.has(rec.id))}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
                <th className="data-table__th--sortable" style={{ width: '100px' }} onClick={() => handleSort('time')}>Date{sortIcon('time')}</th>
                <th className="data-table__th--sortable" onClick={() => handleSort('league')}>League{sortIcon('league')}</th>
                <th>Match</th>
                <th>Selection</th>
                <th className="data-table__th--sortable data-table__th--center" onClick={() => handleSort('odds')}>Odds{sortIcon('odds')}</th>
                <th className="data-table__th--sortable data-table__th--center" onClick={() => handleSort('confidence')}>Conf.{sortIcon('confidence')}</th>
                <th className="data-table__th--center">Risk</th>
                <th>Outcome</th>
                <th className="data-table__th--center">Result</th>
                <th className="data-table__th--sortable data-table__th--right" onClick={() => handleSort('pnl')}>P/L{sortIcon('pnl')}</th>
                {showActionColumn && <th style={{ textAlign: 'center', width: '180px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr><td colSpan={(adminCanDelete ? 11 : 10) + (showActionColumn ? 1 : 0)}>
                  <EmptyState title={loading ? 'Loading...' : 'No recommendations match filters'} />
                </td></tr>
              ) : visibleRows.map((rec, i) => {
                const pnlVal = parseFloat(String(rec.pnl ?? 0));
                const pnl = rec.pnl != null ? `${pnlVal >= 0 ? '+' : ''}$${pnlVal.toFixed(2)}` : '-';
                const conf = rec.confidence != null ? `${parseFloat(String(rec.confidence))}/10` : '-';
                const display = rec.home_team && rec.away_team
                  ? `${rec.home_team} vs ${rec.away_team}`
                  : rec.match_display || 'N/A';
                const ts = rec.timestamp || rec.created_at;
                const risk = rec.risk_level || '';
                const leagueName = rec.league || '-';
                const outcome = rec.actual_outcome || '';
                const outcomeShort = outcome.length > 40 ? outcome.slice(0, 38) + '…' : outcome;
                return (
                  <tr key={rec.id ?? i}>
                    {adminCanDelete && (
                      <td data-label="Select" style={{ textAlign: 'center' }}>
                        <span className="cell-value">
                          {rec.id ? (
                            <input
                              type="checkbox"
                              aria-label={`Select recommendation ${rec.id}`}
                              checked={selectedIds.has(rec.id)}
                              onChange={() => toggleSelect(rec.id!)}
                            />
                          ) : null}
                        </span>
                      </td>
                    )}
                    <td data-label="Date">
                      <span className="cell-value"><span style={{ background: 'var(--gray-100)', padding: '3px 7px', borderRadius: '4px', fontWeight: 600, color: 'var(--gray-700)', fontSize: '12px', whiteSpace: 'nowrap' }}>{formatLocalDateTime(ts)}</span></span>
                    </td>
                    <td data-label="League">
                      <span className="cell-value" title={leagueName} style={{ fontSize: '12px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {leagueName}
                      </span>
                    </td>
                    <td data-label="Match">
                      <span
                        className="cell-value match-cell"
                        style={{ cursor: rec.match_id ? 'pointer' : undefined, color: 'var(--gray-800)', textDecoration: rec.match_id ? 'underline' : undefined, textDecorationColor: 'var(--gray-300)' }}
                        onClick={() => rec.match_id && setDetailMatch({ id: rec.match_id, display })}
                      >
                        {display}
                      </span>
                    </td>
                    <td data-label="Selection">
                      <span className="cell-value">
                        <div><strong>{rec.selection || '-'}</strong></div>
                      </span>
                    </td>
                    <td data-label="Odds" style={{ textAlign: 'center' }}><span className="cell-value"><strong>{rec.odds || '-'}</strong></span></td>
                    <td data-label="Confidence" style={{ textAlign: 'center' }}><span className="cell-value">{conf}</span></td>
                    <td data-label="Risk" style={{ textAlign: 'center' }}>
                      <span className="cell-value">
                        {risk ? (
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
                            fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
                            background: 'var(--gray-100)', color: 'var(--gray-600)',
                            border: '1px solid var(--gray-200)',
                          }}>
                            {risk}
                          </span>
                        ) : '-'}
                      </span>
                    </td>
                    <td data-label="Outcome">
                      <span className="cell-value" title={outcome} style={{ fontSize: '12px', color: 'var(--gray-600)', maxWidth: '250px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {outcomeShort || '-'}
                      </span>
                    </td>
                    <td data-label="Result" style={{ textAlign: 'center' }}>
                      <span className="cell-value" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {isSettlementDelayed(rec)
                          ? <span className="badge badge-pending" title="Older than 36 hours and still unsettled">Settlement delayed</span>
                          : rec.result ? <StatusBadge status={rec.result.toUpperCase()} /> : '-'}
                        {needsReview(rec) && (
                          <span className="badge badge-pending">Review</span>
                        )}
                      </span>
                    </td>
                    <td data-label="P/L" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span className="cell-value" style={{ fontWeight: 600, color: pnlVal >= 0 ? '#15803d' : '#b91c1c', whiteSpace: 'nowrap' }}>
                        {pnl}
                      </span>
                    </td>
                    {showActionColumn && (
                      <td data-label="Actions" style={{ textAlign: 'center' }}>
                        <span className="cell-value" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          {canInvest(rec) && rec.id && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => openInvestModal(rec)}
                            >
                              Invest
                            </button>
                          )}
                          {needsReview(rec) && rec.id && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => openSettleModal(rec)}
                            >
                              Final Settle
                            </button>
                          )}
                          {adminCanDelete && rec.id && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDeleteSingle(rec.id!)}
                            >
                              Delete
                            </button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>}

      {detailMatch && (
        <MatchDetailModal
          open
          matchId={detailMatch.id}
          matchDisplay={detailMatch.display}
          onClose={() => setDetailMatch(null)}
        />
      )}

      <Modal
        open={settleTarget != null}
        title={settleTarget ? `Final Settle: ${settleTarget.match_display}` : 'Final Settle'}
        onClose={() => !settleSaving && setSettleTarget(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setSettleTarget(null)} disabled={settleSaving}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void handleFinalizeSettle()} disabled={settleSaving}>
              {settleSaving ? 'Saving...' : 'Save Final Settlement'}
            </button>
          </>
        }
      >
        {settleTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>
              Only admin can finalize review items. This action will mark the settlement as trusted.
            </div>
            <div style={{ fontSize: '13px', color: 'var(--gray-700)' }}>
              <strong>{settleTarget.selection}</strong>
              <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--gray-500)' }}>
                Current: {settleTarget.result || 'n/a'} | Odds {settleTarget.odds || '-'} | Stake {settleTarget.stake_percent || '-'}%
              </div>
              {settleTarget.settlement_note && (
                <div style={{ marginTop: '4px', fontSize: '12px', color: '#92400e' }}>
                  Review note: {settleTarget.settlement_note}
                </div>
              )}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Final Result</span>
              <select className="filter-input" value={settleResult} onChange={(e) => setSettleResult(e.target.value as FinalResultValue)}>
                {MANUAL_SETTLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>P/L</span>
              <input
                className="filter-input"
                type="number"
                step="0.01"
                value={settlePnl}
                onChange={(e) => setSettlePnl(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Final Note / Outcome</span>
              <textarea
                className="filter-input"
                rows={4}
                value={settleNote}
                onChange={(e) => setSettleNote(e.target.value)}
                placeholder="Optional final note or actual outcome"
                style={{ resize: 'vertical' }}
              />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={investTarget != null}
        title={investTarget ? `Invest: ${investTarget.match_display || investTarget.selection}` : 'Invest'}
        onClose={() => !investSaving && setInvestTarget(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setInvestTarget(null)} disabled={investSaving}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void handleConfirmInvest()} disabled={investSaving}>
              {investSaving ? 'Confirming...' : 'Confirm Invest'}
            </button>
          </>
        }
      >
        {investTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '13px', color: 'var(--gray-700)' }}>
              <strong>{investTarget.selection}</strong>
              <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--gray-500)' }}>
                Suggested stake {investTarget.stake_percent || '-'}% | Recommendation odds {investTarget.odds || '-'}
              </div>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Executed Odds</span>
              <input
                className="filter-input"
                type="number"
                min="1.01"
                step="0.01"
                value={investOdds}
                onChange={(e) => setInvestOdds(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Stake %</span>
              <input
                className="filter-input"
                type="number"
                min="0.01"
                step="0.01"
                value={investStakePercent}
                onChange={(e) => setInvestStakePercent(e.target.value)}
                placeholder="Use recommendation stake"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Stake Amount Override</span>
              <input
                className="filter-input"
                type="number"
                min="0.01"
                step="0.01"
                value={investStakeAmount}
                onChange={(e) => setInvestStakeAmount(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Bookmaker</span>
              <input
                className="filter-input"
                value={investBookmaker}
                onChange={(e) => setInvestBookmaker(e.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={deleteConfirmIds != null}
        title="Confirm Delete"
        onClose={() => !deleteSaving && setDeleteConfirmIds(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteConfirmIds(null)} disabled={deleteSaving}>Cancel</button>
            <button className="btn btn-danger" onClick={() => void confirmDelete()} disabled={deleteSaving}>
              {deleteSaving ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        <p>Are you sure you want to delete {deleteConfirmIds?.length || 0} recommendation(s)?</p>
      </Modal>
    </div>
  );
}
