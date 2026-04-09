import React, { useEffect, useMemo, useState } from 'react';
import { formatLocalTime } from '@/lib/utils/helpers';
import type { MatchSnapshot, OddsMovement } from '@/lib/services/api';
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface SnapEvent {
  minute: number;
  extra: number | null;
  team: string;
  type: string;
  detail: string;
  player: string;
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--gray-400)' }}>
      <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <p>{message}</p>
    </div>
  );
}

function getEventColor(type: string, detail: string): string {
  const lowerType = type.toLowerCase();
  if (lowerType === 'goal') return '#16a34a';
  if (lowerType === 'card') return detail.toLowerCase().includes('red') ? '#dc2626' : '#eab308';
  if (lowerType === 'subst') return '#9ca3af';
  return '#a78bfa';
}

function EventTimeline({ snapshots, matchDisplay }: { snapshots: MatchSnapshot[]; matchDisplay: string }) {
  const parts = matchDisplay.split(/ vs |\s+v\s+|\s+-\s+/i).map((segment) => segment.trim());
  const homeName = parts[0] ?? '';
  const awayName = parts[1] ?? '';

  const seen = new Set<string>();
  const events: SnapEvent[] = [];
  for (const snapshot of snapshots) {
    for (const rawEvent of snapshot.events as SnapEvent[]) {
      if (rawEvent?.minute == null || !rawEvent?.team) continue;
      const key = `${rawEvent.minute}-${rawEvent.team}-${rawEvent.type}-${rawEvent.detail}-${rawEvent.player ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        events.push(rawEvent);
      }
    }
  }

  if (!events.length) return null;

  const maxMinute = Math.max(90, ...events.map((eventItem) => eventItem.minute));
  const minuteToPercent = (minute: number) => `${Math.min(100, (minute / maxMinute) * 100).toFixed(2)}%`;

  const matchesTeamName = (eventTeam: string, target: string) =>
    !!target && (eventTeam === target || eventTeam.includes(target) || target.includes(eventTeam));

  const teamNames = [...new Set(events.map((eventItem) => eventItem.team))];
  const resolvedHome = homeName || teamNames[0] || '';
  const resolvedAway = awayName || teamNames[1] || '';

  const homeEvents = events.filter((eventItem) =>
    matchesTeamName(eventItem.team, resolvedHome) && !matchesTeamName(eventItem.team, resolvedAway));
  const awayEvents = events.filter((eventItem) =>
    matchesTeamName(eventItem.team, resolvedAway) && !matchesTeamName(eventItem.team, resolvedHome));

  const barHeight = (type: string) =>
    type.toLowerCase() === 'goal' ? 30 : type.toLowerCase() === 'subst' ? 16 : 22;

  const legendItems = [
    { label: 'Goal', color: '#16a34a' },
    { label: 'Yellow', color: '#eab308' },
    { label: 'Red Card', color: '#dc2626' },
    { label: 'Sub', color: '#9ca3af' },
  ];

  const EventBar = ({ eventItem, direction }: { eventItem: SnapEvent; direction: 'up' | 'down' }) => (
    <div
      title={`${eventItem.minute}'${eventItem.extra ? `+${eventItem.extra}` : ''} ${eventItem.type}${eventItem.player ? ` - ${eventItem.player}` : ''} (${eventItem.detail})`}
      style={{
        position: 'absolute',
        left: minuteToPercent(eventItem.minute),
        [direction === 'up' ? 'bottom' : 'top']: 0,
        width: 4,
        height: barHeight(eventItem.type),
        background: getEventColor(eventItem.type, eventItem.detail),
        borderRadius: direction === 'up' ? '2px 2px 0 0' : '0 0 2px 2px',
        transform: 'translateX(-50%)',
        opacity: 0.9,
      }}
    />
  );

  return (
    <div style={{ marginBottom: '10px' }}>
      <ChartPanel title="Match Events" subtitle="hover for details">
        <div style={{ display: 'flex', gap: 14, padding: '2px 12px 6px', flexWrap: 'wrap' }}>
          {legendItems.map(({ label, color }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--gray-500)' }}>
              <span style={{ width: 4, height: 14, background: color, borderRadius: 1, display: 'inline-block' }} />
              {label}
            </span>
          ))}
        </div>

        <div style={{ padding: '0 12px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ width: 16, fontSize: 10, fontWeight: 700, color: '#3b82f6', flexShrink: 0, textAlign: 'right', paddingBottom: 2 }}>H</span>
            <div style={{ flex: 1, position: 'relative', height: 36 }}>
              {homeEvents.map((eventItem, index) => <EventBar key={index} eventItem={eventItem} direction="up" />)}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 16, flexShrink: 0 }} />
            <div style={{ flex: 1, position: 'relative', height: 18 }}>
              <div style={{ position: 'absolute', top: 4, left: 0, right: 0, height: 1, background: 'var(--gray-300)' }} />
              {[15, 30, 45, 60, 75, 90].map((minute) => (
                <div key={minute} style={{ position: 'absolute', left: minuteToPercent(minute), transform: 'translateX(-50%)', top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 1, height: 5, background: 'var(--gray-400)', marginTop: 2 }} />
                  <span style={{ fontSize: 9, color: 'var(--gray-400)', lineHeight: 1, marginTop: 1 }}>{minute === 45 ? 'HT' : `${minute}'`}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ width: 16, fontSize: 10, fontWeight: 700, color: '#ef4444', flexShrink: 0, textAlign: 'right', paddingTop: 2 }}>A</span>
            <div style={{ flex: 1, position: 'relative', height: 36 }}>
              {awayEvents.map((eventItem, index) => <EventBar key={index} eventItem={eventItem} direction="down" />)}
            </div>
          </div>
        </div>
      </ChartPanel>
    </div>
  );
}

function homeNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    const parsed = Number((value as Record<string, unknown>).home);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function awayNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    const parsed = Number((value as Record<string, unknown>).away);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

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

function chartLegend(items: { value: string; color: string; type?: 'square' | 'line' }[]) {
  return (
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
}

export function TimelineView({ snapshots, matchDisplay }: { snapshots: MatchSnapshot[]; matchDisplay: string }) {
  if (!snapshots.length) {
    return <EmptyState icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>} message="No snapshots captured yet" />;
  }

  const sorted = [...snapshots].sort((a, b) => a.minute - b.minute);

  const passPercent = (snapshot: MatchSnapshot, side: 'home' | 'away'): number | null => {
    const stats = (snapshot.stats || {}) as Record<string, unknown>;
    const accuratePasses = stats.passes_accurate;
    const totalPasses = stats.total_passes;
    if (!accuratePasses || !totalPasses || typeof accuratePasses !== 'object' || typeof totalPasses !== 'object') return null;
    const accurate = Number((accuratePasses as Record<string, unknown>)[side]);
    const total = Number((totalPasses as Record<string, unknown>)[side]);
    return total > 0 ? Math.round((accurate / total) * 100) : null;
  };

  const possessionData = sorted.map((snapshot) => {
    const stats = (snapshot.stats || {}) as Record<string, unknown>;
    const home = homeNumber(stats.possession) ?? 50;
    const away = awayNumber(stats.possession) ?? Math.max(0, 100 - home);
    return { min: `${snapshot.minute}'`, Home: home, Away: away };
  });
  const hasPossession = possessionData.some((row) => row.Home !== 50 || row.Away !== 50);

  const attackData = sorted.map((snapshot) => {
    const stats = (snapshot.stats || {}) as Record<string, unknown>;
    return {
      min: `${snapshot.minute}'`,
      'H Shots': homeNumber(stats.shots),
      'H SOT': homeNumber(stats.shots_on_target),
      'A Shots': awayNumber(stats.shots),
      'A SOT': awayNumber(stats.shots_on_target),
      'H Cor': homeNumber(stats.corners),
      'A Cor': awayNumber(stats.corners),
    };
  });
  const hasAttack = attackData.some((row) =>
    (row['H Shots'] ?? 0) + (row['A Shots'] ?? 0) + (row['H SOT'] ?? 0) + (row['A SOT'] ?? 0) + (row['H Cor'] ?? 0) + (row['A Cor'] ?? 0) > 0);

  const passData = sorted.map((snapshot) => ({
    min: `${snapshot.minute}'`,
    'H Pass%': passPercent(snapshot, 'home'),
    'A Pass%': passPercent(snapshot, 'away'),
  }));
  const hasPass = passData.some((row) => row['H Pass%'] != null || row['A Pass%'] != null);

  const disciplineData = sorted.map((snapshot) => {
    const stats = (snapshot.stats || {}) as Record<string, unknown>;
    return {
      min: `${snapshot.minute}'`,
      'H Fouls': homeNumber(stats.fouls),
      'A Fouls': awayNumber(stats.fouls),
      'H YC': homeNumber(stats.yellow_cards),
      'A YC': awayNumber(stats.yellow_cards),
    };
  });
  const hasDiscipline = disciplineData.some((row) =>
    (row['H Fouls'] ?? 0) + (row['A Fouls'] ?? 0) + (row['H YC'] ?? 0) + (row['A YC'] ?? 0) > 0);

  const tick = { fontSize: 10 } as const;
  const grid = { strokeDasharray: '3 3', stroke: 'var(--gray-200)' } as const;
  const hasAnyChart = sorted.length > 1 && (hasPossession || hasAttack || hasPass || hasDiscipline);

  return (
    <div>
      <EventTimeline snapshots={snapshots} matchDisplay={matchDisplay} />

      {hasAnyChart && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {hasPossession && (
            <ChartPanel title="Possession Battle" subtitle="who controls the ball">
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={possessionData} barCategoryGap="30%">
                  <CartesianGrid {...grid} vertical={false} />
                  <XAxis dataKey="min" tick={tick} />
                  <YAxis tick={tick} domain={[0, 100]} tickFormatter={(value) => `${value}%`} width={32} />
                  <Tooltip formatter={(value, name) => [`${value}%`, name]} />
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

          {hasAttack && (
            <ChartPanel title="Chance Creation" subtitle="dark = Shots · light = SOT · dashed = Corners">
              <ResponsiveContainer width="100%" height={155}>
                <ComposedChart data={attackData} barCategoryGap="25%" barGap={1}>
                  <CartesianGrid {...grid} vertical={false} />
                  <XAxis dataKey="min" tick={tick} />
                  <YAxis tick={tick} width={24} />
                  <Tooltip labelFormatter={(label) => `Min ${label}`} />
                  <Legend content={() => chartLegend([
                    { value: 'H Shots', type: 'square', color: '#1d4ed8' },
                    { value: 'H SOT', type: 'square', color: '#93c5fd' },
                    { value: 'A Shots', type: 'square', color: '#b91c1c' },
                    { value: 'A SOT', type: 'square', color: '#fca5a5' },
                    { value: 'H Cor', type: 'line', color: '#3b82f6' },
                    { value: 'A Cor', type: 'line', color: '#ef4444' },
                  ])} />
                  <Bar dataKey="H Shots" fill="#1d4ed8" />
                  <Bar dataKey="H SOT" fill="#93c5fd" />
                  <Bar dataKey="A Shots" fill="#b91c1c" />
                  <Bar dataKey="A SOT" fill="#fca5a5" />
                  <Line type="monotone" dataKey="H Cor" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="A Cor" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls strokeDasharray="4 2" />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartPanel>
          )}

          {hasPass && (
            <ChartPanel title="Passing Quality" subtitle="pass accuracy % over time">
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={passData}>
                  <CartesianGrid {...grid} />
                  <XAxis dataKey="min" tick={tick} />
                  <YAxis tick={tick} domain={[0, 100]} tickFormatter={(value) => `${value}%`} width={32} />
                  <Tooltip formatter={(value, name) => [`${value}%`, name]} labelFormatter={(label) => `Min ${label}`} />
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

          {hasDiscipline && (
            <ChartPanel title="Discipline" subtitle="fouls · yellow cards">
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={disciplineData} barCategoryGap="25%">
                  <CartesianGrid {...grid} vertical={false} />
                  <XAxis dataKey="min" tick={tick} />
                  <YAxis tick={tick} width={24} />
                  <Tooltip labelFormatter={(label) => `Min ${label}`} />
                  <Legend content={() => chartLegend([
                    { value: 'H Fouls', type: 'square', color: '#1d4ed8' },
                    { value: 'H YC', type: 'square', color: '#93c5fd' },
                    { value: 'A Fouls', type: 'square', color: '#b91c1c' },
                    { value: 'A YC', type: 'square', color: '#fca5a5' },
                  ])} />
                  <Bar dataKey="H Fouls" fill="#1d4ed8" />
                  <Bar dataKey="H YC" fill="#93c5fd" />
                  <Bar dataKey="A Fouls" fill="#b91c1c" />
                  <Bar dataKey="A YC" fill="#fca5a5" />
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
            {sorted.map((snapshot) => {
              const stats = (snapshot.stats || {}) as Record<string, unknown>;
              const stat = (key: string): string => {
                const value = stats[key];
                if (value == null) return '-';
                if (typeof value === 'object' && value !== null) {
                  const entry = value as Record<string, unknown>;
                  return entry.home != null && entry.away != null ? `${entry.home}/${entry.away}` : '-';
                }
                return String(value) || '-';
              };
              const yellowCards = stat('yellow_cards');
              const redCards = stat('red_cards');
              const yellowCardSvg = <svg width="12" height="14" viewBox="0 0 24 24" fill="#ca8a04" stroke="none"><rect x="4" y="3" width="10" height="14" rx="1"/></svg>;
              const redCardSvg = <svg width="12" height="14" viewBox="0 0 24 24" fill="#dc2626" stroke="none"><rect x="4" y="3" width="10" height="14" rx="1"/></svg>;
              const cards: React.ReactNode = redCards !== '-' && redCards !== '0/0'
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>{yellowCards} {yellowCardSvg} {redCards} {redCardSvg}</span>
                : yellowCards !== '-' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>{yellowCards} {yellowCardSvg}</span> : '-';
              const accuratePasses = stats.passes_accurate;
              const totalPasses = stats.total_passes;
              let passAccuracy = '-';
              if (accuratePasses && totalPasses && typeof accuratePasses === 'object' && typeof totalPasses === 'object') {
                const accurateHome = Number((accuratePasses as Record<string, unknown>).home);
                const totalHome = Number((totalPasses as Record<string, unknown>).home);
                const accurateAway = Number((accuratePasses as Record<string, unknown>).away);
                const totalAway = Number((totalPasses as Record<string, unknown>).away);
                const homePercent = totalHome > 0 ? Math.round((accurateHome / totalHome) * 100) : 0;
                const awayPercent = totalAway > 0 ? Math.round((accurateAway / totalAway) * 100) : 0;
                passAccuracy = `${homePercent}%/${awayPercent}%`;
              }
              return (
                <tr key={snapshot.id}>
                  <td><strong>{snapshot.minute}'</strong></td>
                  <td>{snapshot.home_score}-{snapshot.away_score}</td>
                  <td>{stat('possession')}</td>
                  <td>{stat('shots')}</td>
                  <td>{stat('shots_on_target')}</td>
                  <td>{stat('corners')}</td>
                  <td>{stat('fouls')}</td>
                  <td>{cards}</td>
                  <td>{stat('goalkeeper_saves')}</td>
                  <td>{passAccuracy}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ODDS_MARKET_TAB_ORDER = [
  '1x2', 'ou', 'ah', 'btts', 'corners_ou',
  'ht_1x2', 'ht_ou', 'ht_ah', 'ht_btts',
];

function sortOddsMarketKeys(markets: string[]): string[] {
  return [...markets].sort((a, b) => {
    const ia = ODDS_MARKET_TAB_ORDER.indexOf(a);
    const ib = ODDS_MARKET_TAB_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function formatOddsMarketTab(market: string): string {
  const labels: Record<string, string> = {
    '1x2': '1X2',
    ou: 'O/U goals',
    ah: 'Asian H.',
    btts: 'BTTS',
    corners_ou: 'Corners O/U',
    ht_1x2: 'H1 1X2',
    ht_ou: 'H1 O/U',
    ht_ah: 'H1 Asian H.',
    ht_btts: 'H1 BTTS',
  };
  return labels[market] ?? market;
}

function oddsMovementColumnLabels(market: string): { p1: string; p2: string; px: string } {
  switch (market) {
    case '1x2':
    case 'ht_1x2':
      return { p1: 'Home', p2: 'Away', px: 'Draw' };
    case 'ou':
    case 'ht_ou':
    case 'corners_ou':
      return { p1: 'Over', p2: 'Under', px: '—' };
    case 'ah':
    case 'ht_ah':
      return { p1: 'Home', p2: 'Away', px: '—' };
    case 'btts':
    case 'ht_btts':
      return { p1: 'Yes', p2: 'No', px: '—' };
    default:
      return { p1: 'P1', p2: 'P2', px: 'PX' };
  }
}

export function OddsView({ odds }: { odds: OddsMovement[] }) {
  const markets = useMemo(
    () => sortOddsMarketKeys([...new Set(odds.map((odd) => odd.market))]),
    [odds],
  );
  const [selectedMarket, setSelectedMarket] = useState(() => markets[0] || '');

  useEffect(() => {
    setSelectedMarket((prev) => (markets.includes(prev) ? prev : (markets[0] || '')));
  }, [markets]);

  if (!odds.length) {
    return <EmptyState icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>} message="No odds movements recorded" />;
  }

  const col = oddsMovementColumnLabels(selectedMarket);

  const marketOdds = odds
    .filter((odd) => odd.market === selectedMarket)
    .sort((left, right) => {
      const leftMinute = left.match_minute ?? -1;
      const rightMinute = right.match_minute ?? -1;
      if (leftMinute !== rightMinute) return leftMinute - rightMinute;
      return new Date(left.captured_at).getTime() - new Date(right.captured_at).getTime();
    });

  const chartData = marketOdds.map((odd) => ({
    label: odd.match_minute != null ? `${odd.match_minute}'` : formatLocalTime(odd.captured_at),
    price_1: odd.price_1,
    price_2: odd.price_2,
    price_x: odd.price_x,
  }));

  return (
    <div>
      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {markets.map((market) => (
          <button
            key={market}
            className={`btn btn-sm ${selectedMarket === market ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSelectedMarket(market)}
          >
            {formatOddsMarketTab(market)}
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
              {chartData.some((row) => row.price_1 != null) && (
                <Line type="monotone" dataKey="price_1" name={col.p1} stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
              )}
              {chartData.some((row) => row.price_2 != null) && (
                <Line type="monotone" dataKey="price_2" name={col.p2} stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
              )}
              {chartData.some((row) => row.price_x != null) && (
                <Line type="monotone" dataKey="price_x" name={col.px} stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
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
              <th style={{ textAlign: 'center' }}>{col.p1}</th>
              <th style={{ textAlign: 'center' }}>{col.px}</th>
              <th style={{ textAlign: 'center' }}>{col.p2}</th>
              <th style={{ color: 'var(--gray-400)' }}>Captured</th>
            </tr>
          </thead>
          <tbody>
            {marketOdds.map((odd) => (
              <tr key={odd.id}>
                <td>
                  <strong style={{ color: odd.match_minute != null ? 'var(--gray-900)' : 'var(--gray-400)' }}>
                    {odd.match_minute != null ? `${odd.match_minute}'` : 'Pre'}
                  </strong>
                </td>
                <td>{odd.line ?? '—'}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: '#3b82f6' }}>{odd.price_1 ?? '—'}</td>
                <td style={{ textAlign: 'center', color: '#f59e0b' }}>{odd.price_x ?? '—'}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: '#ef4444' }}>{odd.price_2 ?? '—'}</td>
                <td style={{ color: 'var(--gray-400)', fontSize: '11px' }}>{formatLocalTime(odd.captured_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}