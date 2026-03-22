// ============================================================
// Match Scout Panel — Context · Timeline · Odds · AI Recs · Bets
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Modal } from './Modal';
import { RecommendationCard } from './RecommendationCard';
import { formatLocalTime, formatLocalDateTime } from '@/lib/utils/helpers';
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
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

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

          {tab === 'context'  && <ContextView watchlist={watchlist} recs={recs} />}
          {tab === 'timeline' && <TimelineView snapshots={snapshots} matchDisplay={matchDisplay} />}
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
  const rotationRisk = getStrategicNarrative(ctx, 'rotation_risk', uiLanguage);
  const keyAbsences = getStrategicNarrative(ctx, 'key_absences', uiLanguage);
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
            {fixtureCongestion && <InfoBlock label="Fixture Congestion" value={fixtureCongestion} />}
            {rotationRisk && <InfoBlock label="Rotation Risk" value={rotationRisk} />}
            {keyAbsences && <InfoBlock label="Key Absences" value={keyAbsences} />}
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

// ==================== Timeline View ====================

// ── Event types ───────────────────────────────────────────────────────────────

// EventCompact matches what the pipeline actually saves to DB
interface SnapEvent {
  minute: number;
  extra: number | null;
  team: string;   // plain team name string
  type: string;
  detail: string;
  player: string;
}

function getEventColor(type: string, detail: string): string {
  const t = type.toLowerCase();
  if (t === 'goal') return '#16a34a';
  if (t === 'card') return detail.toLowerCase().includes('red') ? '#dc2626' : '#eab308';
  if (t === 'subst') return '#9ca3af';
  return '#a78bfa';
}

// ── Event waveform timeline ───────────────────────────────────────────────────

function EventTimeline({ snapshots, matchDisplay }: { snapshots: MatchSnapshot[]; matchDisplay: string }) {
  // Parse home / away names from "Home vs Away" or "Home - Away"
  const parts = matchDisplay.split(/ vs |\s+v\s+|\s+-\s+/i).map(s => s.trim());
  const homeName = parts[0] ?? '';
  const awayName = parts[1] ?? '';

  // Deduplicate events across all snapshots (later snapshots repeat earlier ones)
  const seen = new Set<string>();
  const events: SnapEvent[] = [];
  for (const snap of snapshots) {
    for (const raw of (snap.events as SnapEvent[])) {
      if (raw?.minute == null || !raw?.team) continue;
      const key = `${raw.minute}-${raw.team}-${raw.type}-${raw.detail}-${raw.player ?? ''}`;
      if (!seen.has(key)) { seen.add(key); events.push(raw); }
    }
  }

  if (!events.length) return null;

  const maxMin = Math.max(90, ...events.map(e => e.minute));
  const pct = (m: number) => `${Math.min(100, (m / maxMin) * 100).toFixed(2)}%`;

  // Match team names with partial-match fallback
  const nameMatch = (eventTeam: string, target: string) =>
    !!target && (eventTeam === target || eventTeam.includes(target) || target.includes(eventTeam));

  // Fallback: use first/second unique team name found in events
  const teamNames = [...new Set(events.map(e => e.team))];
  const resolvedHome = homeName || teamNames[0] || '';
  const resolvedAway = awayName || teamNames[1] || '';

  const homeEvents = events.filter(e =>
    nameMatch(e.team, resolvedHome) && !nameMatch(e.team, resolvedAway),
  );
  const awayEvents = events.filter(e =>
    nameMatch(e.team, resolvedAway) && !nameMatch(e.team, resolvedHome),
  );

  const barH = (type: string) =>
    type.toLowerCase() === 'goal' ? 30 : type.toLowerCase() === 'subst' ? 16 : 22;

  const LEGEND_ITEMS = [
    { label: 'Goal', color: '#16a34a' },
    { label: 'Yellow', color: '#eab308' },
    { label: 'Red Card', color: '#dc2626' },
    { label: 'Sub', color: '#9ca3af' },
  ];

  const EventBar = ({ e, dir }: { e: SnapEvent; dir: 'up' | 'down' }) => (
    <div
      title={`${e.minute}'${e.extra ? `+${e.extra}` : ''} ${e.type}${e.player ? ` — ${e.player}` : ''} (${e.detail})`}
      style={{
        position: 'absolute',
        left: pct(e.minute),
        [dir === 'up' ? 'bottom' : 'top']: 0,
        width: 4,
        height: barH(e.type),
        background: getEventColor(e.type, e.detail),
        borderRadius: dir === 'up' ? '2px 2px 0 0' : '0 0 2px 2px',
        transform: 'translateX(-50%)',
        opacity: 0.9,
      }}
    />
  );

  return (
    <div style={{ marginBottom: '10px' }}>
    <ChartPanel title="Match Events" subtitle="hover for details">
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, padding: '2px 12px 6px', flexWrap: 'wrap' }}>
        {LEGEND_ITEMS.map(({ label, color }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--gray-500)' }}>
            <span style={{ width: 4, height: 14, background: color, borderRadius: 1, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>

      <div style={{ padding: '0 12px 10px' }}>
        {/* Home row — events grow upward */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <span style={{ width: 16, fontSize: 10, fontWeight: 700, color: '#3b82f6', flexShrink: 0, textAlign: 'right', paddingBottom: 2 }}>H</span>
          <div style={{ flex: 1, position: 'relative', height: 36 }}>
            {homeEvents.map((e, i) => <EventBar key={i} e={e} dir="up" />)}
          </div>
        </div>

        {/* Minute axis */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, flexShrink: 0 }} />
          <div style={{ flex: 1, position: 'relative', height: 18 }}>
            <div style={{ position: 'absolute', top: 4, left: 0, right: 0, height: 1, background: 'var(--gray-300)' }} />
            {[15, 30, 45, 60, 75, 90].map(m => (
              <div key={m} style={{ position: 'absolute', left: pct(m), transform: 'translateX(-50%)', top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 1, height: 5, background: 'var(--gray-400)', marginTop: 2 }} />
                <span style={{ fontSize: 9, color: 'var(--gray-400)', lineHeight: 1, marginTop: 1 }}>{m === 45 ? 'HT' : `${m}'`}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Away row — events grow downward */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{ width: 16, fontSize: 10, fontWeight: 700, color: '#ef4444', flexShrink: 0, textAlign: 'right', paddingTop: 2 }}>A</span>
          <div style={{ flex: 1, position: 'relative', height: 36 }}>
            {awayEvents.map((e, i) => <EventBar key={i} e={e} dir="down" />)}
          </div>
        </div>
      </div>
    </ChartPanel>
    </div>
  );
}

/** Extract home numeric value from a stat that may be a {home,away} object or plain number/string */
function hNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const n = Number((v as Record<string, unknown>).home);
    return isNaN(n) ? null : n;
  }
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

function aNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const n = Number((v as Record<string, unknown>).away);
    return isNaN(n) ? null : n;
  }
  return null;
}

/** Thin labeled wrapper around each chart */
function ChartPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--gray-50)', borderRadius: '8px', padding: '10px 2px 6px' }}>
      <div style={{ paddingLeft: '12px', marginBottom: '2px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{title}</span>
        {subtitle && <span style={{ fontSize: '10px', color: 'var(--gray-400)', marginLeft: '6px' }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function TimelineView({ snapshots, matchDisplay }: { snapshots: MatchSnapshot[]; matchDisplay: string }) {
  if (!snapshots.length) {
    return <EmptyState icon="📋" message="No snapshots captured yet" />;
  }

  const sorted = [...snapshots].sort((a, b) => a.minute - b.minute);

  // Compute pass% from accurate/total passes objects
  const passPercent = (s: MatchSnapshot, side: 'home' | 'away'): number | null => {
    const stats = (s.stats || {}) as Record<string, unknown>;
    const acc = stats.passes_accurate;
    const tot = stats.total_passes;
    if (!acc || !tot || typeof acc !== 'object' || typeof tot !== 'object') return null;
    const a = Number((acc as Record<string, unknown>)[side]);
    const t = Number((tot as Record<string, unknown>)[side]);
    return t > 0 ? Math.round(a / t * 100) : null;
  };

  // ── Dataset 1: Possession Battle ──────────────────────────────────
  const possData = sorted.map((s) => {
    const stats = (s.stats || {}) as Record<string, unknown>;
    const h = hNum(stats.possession) ?? 50;
    const a = aNum(stats.possession) ?? Math.max(0, 100 - h);
    return { min: `${s.minute}'`, Home: h, Away: a };
  });
  const hasPoss = possData.some((d) => d.Home !== 50 || d.Away !== 50);

  // ── Dataset 2: Chance Creation ────────────────────────────────────
  const attackData = sorted.map((s) => {
    const stats = (s.stats || {}) as Record<string, unknown>;
    return {
      min: `${s.minute}'`,
      'H Shots': hNum(stats.shots),
      'H SOT':   hNum(stats.shots_on_target),
      'A Shots': aNum(stats.shots),
      'A SOT':   aNum(stats.shots_on_target),
      'H Cor':   hNum(stats.corners),
      'A Cor':   aNum(stats.corners),
    };
  });
  const hasAttack = attackData.some(
    (d) => (d['H Shots'] ?? 0) + (d['A Shots'] ?? 0) + (d['H SOT'] ?? 0) + (d['A SOT'] ?? 0) + (d['H Cor'] ?? 0) + (d['A Cor'] ?? 0) > 0,
  );

  // ── Dataset 3: Passing Quality ────────────────────────────────────
  const passData = sorted.map((s) => ({
    min: `${s.minute}'`,
    'H Pass%': passPercent(s, 'home'),
    'A Pass%': passPercent(s, 'away'),
  }));
  const hasPass = passData.some((d) => d['H Pass%'] != null || d['A Pass%'] != null);

  // ── Dataset 4: Discipline ─────────────────────────────────────────
  const disciplineData = sorted.map((s) => {
    const stats = (s.stats || {}) as Record<string, unknown>;
    return {
      min: `${s.minute}'`,
      'H Fouls': hNum(stats.fouls),
      'A Fouls': aNum(stats.fouls),
      'H YC':    hNum(stats.yellow_cards),
      'A YC':    aNum(stats.yellow_cards),
    };
  });
  const hasDiscipline = disciplineData.some(
    (d) => (d['H Fouls'] ?? 0) + (d['A Fouls'] ?? 0) + (d['H YC'] ?? 0) + (d['A YC'] ?? 0) > 0,
  );

  const TICK = { fontSize: 10 } as const;
  const GRID = { strokeDasharray: '3 3', stroke: 'var(--gray-200)' } as const;
  const hasAnyChart = sorted.length > 1 && (hasPoss || hasAttack || hasPass || hasDiscipline);

  const chartLegend = (items: { value: string; color: string; type?: 'square' | 'line' }[]) => (
    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', paddingTop: 4 }}>
      {items.map((item) => (
        <span key={item.value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          {item.type === 'line' ? (
            <span style={{ width: 14, height: 2, background: item.color, display: 'inline-block' }} />
          ) : (
            <span style={{ width: 10, height: 10, background: item.color, borderRadius: 2, display: 'inline-block' }} />
          )}
          {item.value}
        </span>
      ))}
    </div>
  );

  return (
    <div>
      {/* Event waveform — goals, cards, subs per team on a 0-90 axis */}
      <EventTimeline snapshots={snapshots} matchDisplay={matchDisplay} />

      {hasAnyChart && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>

          {/* 1. Possession Battle — stacked 100% bar, shows who dominates */}
          {hasPoss && (
            <ChartPanel title="Possession Battle" subtitle="who controls the ball">
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={possData} barCategoryGap="30%">
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="min" tick={TICK} />
                  <YAxis tick={TICK} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={32} />
                  <Tooltip formatter={(v, name) => [`${v}%`, name]} />
                  <Legend content={() => chartLegend([
                    { value: 'Home', type: 'square', color: '#3b82f6' },
                    { value: 'Away', type: 'square', color: '#ef4444' },
                  ])} />
                  <Bar dataKey="Home" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="Away" stackId="a" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
          )}

          {/* 2. Chance Creation — grouped bars: Shots vs SOT per team, Corners as line */}
          {hasAttack && (
            <ChartPanel title="Chance Creation" subtitle="dark = Shots · light = SOT · dashed = Corners">
              <ResponsiveContainer width="100%" height={155}>
                <ComposedChart data={attackData} barCategoryGap="25%" barGap={1}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="min" tick={TICK} />
                  <YAxis tick={TICK} width={24} />
                  <Tooltip labelFormatter={(l) => `Min ${l}`} />
                  <Legend content={() => chartLegend([
                    { value: 'H Shots', type: 'square', color: '#1d4ed8' },
                    { value: 'H SOT',   type: 'square', color: '#93c5fd' },
                    { value: 'A Shots', type: 'square', color: '#b91c1c' },
                    { value: 'A SOT',   type: 'square', color: '#fca5a5' },
                    { value: 'H Cor',   type: 'line',   color: '#3b82f6' },
                    { value: 'A Cor',   type: 'line',   color: '#ef4444' },
                  ])} />
                  <Bar dataKey="H Shots" fill="#1d4ed8" />
                  <Bar dataKey="H SOT"   fill="#93c5fd" />
                  <Bar dataKey="A Shots" fill="#b91c1c" />
                  <Bar dataKey="A SOT"   fill="#fca5a5" />
                  <Line type="monotone" dataKey="H Cor" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="A Cor" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls strokeDasharray="4 2" />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartPanel>
          )}

          {/* 3. Passing Quality — technical control H vs A */}
          {hasPass && (
            <ChartPanel title="Passing Quality" subtitle="pass accuracy % over time">
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={passData}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="min" tick={TICK} />
                  <YAxis tick={TICK} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={32} />
                  <Tooltip formatter={(v, name) => [`${v}%`, name]} labelFormatter={(l) => `Min ${l}`} />
                  <Legend content={() => chartLegend([
                    { value: 'H Pass%', type: 'line', color: '#3b82f6' },
                    { value: 'A Pass%', type: 'line', color: '#ef4444' },
                  ])} />
                  <Line type="monotone" dataKey="H Pass%" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="A Pass%" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
          )}

          {/* 4. Discipline — fouls & yellow cards, match aggression risk */}
          {hasDiscipline && (
            <ChartPanel title="Discipline" subtitle="fouls · yellow cards">
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={disciplineData} barCategoryGap="25%">
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="min" tick={TICK} />
                  <YAxis tick={TICK} width={24} />
                  <Tooltip labelFormatter={(l) => `Min ${l}`} />
                  <Legend content={() => chartLegend([
                    { value: 'H Fouls', type: 'square', color: '#1d4ed8' },
                    { value: 'H YC',    type: 'square', color: '#93c5fd' },
                    { value: 'A Fouls', type: 'square', color: '#b91c1c' },
                    { value: 'A YC',    type: 'square', color: '#fca5a5' },
                  ])} />
                  <Bar dataKey="H Fouls" fill="#1d4ed8" />
                  <Bar dataKey="H YC"    fill="#93c5fd" />
                  <Bar dataKey="A Fouls" fill="#b91c1c" />
                  <Bar dataKey="A YC"    fill="#fca5a5" />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
          )}
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
