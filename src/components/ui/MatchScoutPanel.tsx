// ============================================================
// Match Scout Panel — Pre-match analytics & Live match view
// Embedded in MatchHubModal Scout tab; loads only when tab is active.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { fetchMatchScout, type MatchScoutData } from '@/lib/services/api';
import { LIVE_STATUSES } from '@/config/constants';

export interface MatchScoutPanelProps {
  /** Modal open (stop work when false) */
  open: boolean;
  /** Scout tab selected — fetch external scout API only when true */
  active: boolean;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  leagueName?: string;
  leagueId?: number;
  status?: string;
}

function TeamLabel({ name, logo, color }: { name: string; logo?: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
      {logo && (
        <img src={logo} alt="" style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }}
          onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
      )}
      <span style={{ fontSize: 11, fontWeight: 700, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
    </div>
  );
}

function TimelineMarker({ label, bg, textColor, size = 22 }: { label: string; bg: string; textColor: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, border: bg === '#fff' ? '2px solid #22c55e' : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, zIndex: 3,
    }}>
      <span style={{ fontSize: 8, fontWeight: 900, color: textColor, lineHeight: 1 }}>{label}</span>
    </div>
  );
}

export function MatchScoutPanel({
  open,
  active,
  matchId,
  homeTeam,
  awayTeam,
  homeLogo,
  awayLogo,
  leagueName,
  leagueId,
  status,
}: MatchScoutPanelProps) {
  const { state } = useAppState();
  const [data, setData] = useState<MatchScoutData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLive = status ? LIVE_STATUSES.includes(status) : false;
  const isFinished = status ? ['FT', 'AET', 'PEN'].includes(status) : false;
  const hasStarted = isLive || isFinished;

  const season = new Date().getMonth() < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear();

  const load = useCallback(async () => {
    if (!open || !active || !matchId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMatchScout(state.config, matchId, { leagueId, season, status });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load match data');
    } finally {
      setLoading(false);
    }
  }, [open, active, matchId, leagueId, season, status, state.config]);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!active || !matchId) return;
    void load();
  }, [open, active, matchId, load]);

  return (
    <div style={{ minHeight: 300 }}>
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, gap: 12, color: 'var(--gray-400)' }}>
          <div className="loading-spinner" />
          <span style={{ fontSize: 13 }}>Loading match data…</span>
        </div>
      )}
      {error && !loading && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ color: 'var(--gray-400)', fontSize: 13, marginBottom: 12 }}>{error}</div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {!loading && !error && data && (
        hasStarted
          ? <LiveView data={data} homeTeam={homeTeam} awayTeam={awayTeam} homeLogo={homeLogo} awayLogo={awayLogo} leagueName={leagueName} status={status} isLive={isLive} />
          : <PreMatchView data={data} homeTeam={homeTeam} awayTeam={awayTeam} homeLogo={homeLogo} awayLogo={awayLogo} leagueName={leagueName} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PRE-MATCH VIEW
// ═══════════════════════════════════════════════════════════

function PreMatchView({ data, homeTeam, awayTeam, homeLogo, awayLogo, leagueName }: {
  data: MatchScoutData;
  homeTeam: string; awayTeam: string;
  homeLogo?: string; awayLogo?: string;
  leagueName?: string;
}) {
  const fix = data.fixture;
  const standings = data.standings;

  const venue = fix?.fixture?.venue;
  const round = fix?.league?.round;
  const referee = fix?.fixture?.referee;
  const homeIdx = standings.findIndex((s) => s.team.name === homeTeam || homeTeam.includes(s.team.name) || s.team.name.includes(homeTeam));
  const awayIdx = standings.findIndex((s) => s.team.name === awayTeam || awayTeam.includes(s.team.name) || s.team.name.includes(awayTeam));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: 'var(--gray-50)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <TeamBadge name={homeTeam} logo={homeLogo} align="left" />
        <div style={{ textAlign: 'center', flex: 1 }}>
          {leagueName && <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{leagueName}</div>}
          {round && <div style={{ fontSize: 10, color: 'var(--gray-400)', marginBottom: 2 }}>{round}</div>}
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--gray-700)' }}>VS</div>
          {venue?.name && <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 2 }}>{venue.name}{venue.city ? `, ${venue.city}` : ''}</div>}
          {referee && <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>Ref: {referee}</div>}
        </div>
        <TeamBadge name={awayTeam} logo={awayLogo} align="right" />
      </div>

      <Section title={`League Table${leagueName ? ` - ${leagueName}` : ''}`}>
        {standings.length > 0 ? (
          <StandingsSnippet standings={standings} homeIdx={homeIdx} awayIdx={awayIdx} homeTeam={homeTeam} awayTeam={awayTeam} />
        ) : <EmptyNote>Standings not available</EmptyNote>}
      </Section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LIVE / FINISHED VIEW
// ═══════════════════════════════════════════════════════════

function LiveView({ data, homeTeam, awayTeam, homeLogo, awayLogo, leagueName, status, isLive }: {
  data: MatchScoutData;
  homeTeam: string; awayTeam: string;
  homeLogo?: string; awayLogo?: string;
  leagueName?: string; status?: string; isLive: boolean;
}) {
  const fix = data.fixture;
  const events = data.events;
  const statistics = data.statistics;
  const lineups = data.lineups;

  const homeGoals = fix?.goals?.home ?? 0;
  const awayGoals = fix?.goals?.away ?? 0;
  const elapsed = fix?.fixture?.status?.elapsed;

  // Split stats by team (home = index 0)
  const homeStats = statistics[0]?.statistics ?? [];
  const awayStats = statistics[1]?.statistics ?? [];

  const getStatVal = (stats: typeof homeStats, type: string): number => {
    const s = stats.find((s) => s.type === type);
    if (s?.value == null) return 0;
    const v = String(s.value).replace('%', '').trim();
    return parseFloat(v) || 0;
  };

  const statRows = [
    { label: 'Possession', type: 'Ball Possession', suffix: '%', isPercent: true },
    { label: 'Shots', type: 'Total Shots', suffix: '', isPercent: false },
    { label: 'Shots on Target', type: 'Shots on Goal', suffix: '', isPercent: false },
    { label: 'Corners', type: 'Corner Kicks', suffix: '', isPercent: false },
    { label: 'Fouls', type: 'Fouls', suffix: '', isPercent: false },
    { label: 'Yellow Cards', type: 'Yellow Cards', suffix: '', isPercent: false },
    { label: 'Red Cards', type: 'Red Cards', suffix: '', isPercent: false },
    { label: 'Offsides', type: 'Offsides', suffix: '', isPercent: false },
  ].map(({ label, type, suffix, isPercent }) => ({
    label,
    home: getStatVal(homeStats, type),
    away: getStatVal(awayStats, type),
    suffix,
    isPercent,
  })).filter((r) => r.home > 0 || r.away > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Live Score Header ── */}
      <div style={{ background: isLive ? '#0f172a' : 'var(--gray-50)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <TeamBadge name={homeTeam} logo={homeLogo} align="left" dark={isLive} />
        <div style={{ textAlign: 'center', flex: 1 }}>
          {isLive && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', letterSpacing: '1px' }}>LIVE {elapsed ? `· ${elapsed}'` : ''}</span>
            </div>
          )}
          {!isLive && status && (
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-500)', letterSpacing: '1px', marginBottom: 4 }}>{status === 'HT' ? 'HT' : (status || '')}</div>
          )}
          <div style={{ fontSize: 28, fontWeight: 900, color: isLive ? '#f9fafb' : 'var(--gray-900)', letterSpacing: '-1px', lineHeight: 1 }}>
            {homeGoals} <span style={{ color: isLive ? '#4b5563' : 'var(--gray-300)' }}>–</span> {awayGoals}
          </div>
          {leagueName && <div style={{ fontSize: 10, color: isLive ? '#6b7280' : 'var(--gray-400)', marginTop: 4 }}>{leagueName}</div>}
        </div>
        <TeamBadge name={awayTeam} logo={awayLogo} align="right" dark={isLive} />
      </div>

      {/* ── Events Timeline (full width) ── */}
      <Section title="Match Events">
        <EventTimeline
          events={events}
          homeTeam={homeTeam} awayTeam={awayTeam}
          homeLogo={homeLogo} awayLogo={awayLogo}
        />
      </Section>

      {/* ── Match Stats (full width, 2-col grid) ── */}
      <Section title="Match Statistics">
        {statRows.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
            {statRows.map((r) => (
              <StatBar key={r.label} label={r.label} home={r.home} away={r.away} suffix={r.suffix} isPercent={r.isPercent} />
            ))}
          </div>
        ) : <EmptyNote>Statistics not yet available</EmptyNote>}
      </Section>

      {/* ── Lineups ── */}
      {lineups.length === 2 && (
        <Section title={`Lineups · ${lineups[0]!.formation} vs ${lineups[1]!.formation}`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {lineups.map((lineup, i) => (
              <LineupList key={i} lineup={lineup} isHome={i === 0} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--gray-400)', fontStyle: 'italic', padding: '8px 0' }}>{children}</div>;
}

function TeamBadge({ name, logo, align, dark }: { name: string; logo?: string; align: 'left' | 'right'; dark?: boolean }) {
  const color = dark ? '#f9fafb' : 'var(--gray-900)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'flex-end', gap: 4, minWidth: 100, maxWidth: 160 }}>
      {logo && <img src={logo} alt={name} style={{ width: 32, height: 32, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
      <div style={{ fontSize: 12, fontWeight: 700, color, textAlign: align === 'left' ? 'left' : 'right', lineHeight: 1.2 }}>{name}</div>
    </div>
  );
}


function StandingsSnippet({ standings, homeIdx, awayIdx, homeTeam, awayTeam }: {
  standings: MatchScoutData['standings'];
  homeIdx: number; awayIdx: number;
  homeTeam: string; awayTeam: string;
}) {
  // Show rows around both teams (±2), deduplicated, sorted by rank
  const indices = new Set<number>();
  [homeIdx, awayIdx].forEach((idx) => {
    if (idx < 0) return;
    for (let i = Math.max(0, idx - 2); i <= Math.min(standings.length - 1, idx + 2); i++) indices.add(i);
  });
  // If no teams found in standings, show top 6
  const rows = indices.size > 0
    ? Array.from(indices).sort((a, b) => a - b).map((i) => standings[i]!)
    : standings.slice(0, 6);

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr 24px 24px 24px 28px', gap: '2px 6px', color: 'var(--gray-400)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid var(--gray-100)' }}>
        <span>#</span><span>Team</span><span style={{ textAlign: 'center' }}>P</span><span style={{ textAlign: 'center' }}>GD</span><span style={{ textAlign: 'center' }}>Pts</span><span style={{ textAlign: 'center' }}>Form</span>
      </div>
      {rows.map((s, i) => {
        const isHome = s.team.name === homeTeam || homeTeam.includes(s.team.name) || s.team.name.includes(homeTeam);
        const isAway = s.team.name === awayTeam || awayTeam.includes(s.team.name) || s.team.name.includes(awayTeam);
        const highlight = isHome ? '#eff6ff' : isAway ? '#fff7ed' : 'transparent';
        const last3 = s.form?.slice(-3).split('') ?? [];
        const formColors: Record<string, string> = { W: '#15803d', D: 'var(--gray-400)', L: '#b91c1c' };
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 1fr 24px 24px 24px 28px', gap: '2px 6px', padding: '3px 4px', borderRadius: 4, background: highlight, alignItems: 'center' }}>
            <span style={{ color: 'var(--gray-400)', fontWeight: 600 }}>{s.rank}</span>
            <span style={{ fontWeight: isHome || isAway ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.team.name}</span>
            <span style={{ textAlign: 'center', color: 'var(--gray-500)' }}>{s.all.played}</span>
            <span style={{ textAlign: 'center', color: s.goalsDiff >= 0 ? '#15803d' : '#b91c1c' }}>{s.goalsDiff > 0 ? '+' : ''}{s.goalsDiff}</span>
            <span style={{ textAlign: 'center', fontWeight: 700 }}>{s.points}</span>
            <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
              {last3.map((r, j) => <span key={j} style={{ fontSize: 9, width: 12, height: 12, borderRadius: 2, background: formColors[r] ?? 'var(--gray-200)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{r}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Event Timeline (horizontal visual) ──────────────────────────────────────

type MatchEvent = MatchScoutData['events'][number];

function isHomeEvt(e: MatchEvent, homeTeam: string): boolean {
  return e.team.name === homeTeam || homeTeam.includes(e.team.name) || e.team.name.includes(homeTeam);
}

function evtStyle(type: string, detail: string): { icon: string; color: string; bg: string } {
  if (type === 'Goal') {
    if (detail.toLowerCase().includes('own')) return { icon: '⚽', color: '#b91c1c', bg: '#fee2e2' };
    return { icon: '⚽', color: '#166534', bg: '#dcfce7' };
  }
  if (type === 'Card') {
    if (detail.includes('Red') || detail.includes('Second Yellow'))
      return { icon: '🟥', color: '#b91c1c', bg: 'transparent' };
    return { icon: '🟨', color: '#d97706', bg: 'transparent' };
  }
  if (type === 'subst') return { icon: '⇆', color: '#6366f1', bg: '#ede9fe' };
  if (type === 'Var')   return { icon: 'V',  color: '#6b7280', bg: '#f3f4f6' };
  return { icon: '·', color: '#9ca3af', bg: '#f3f4f6' };
}

function EventTimeline({ events, homeTeam, awayTeam, homeLogo, awayLogo }: {
  events: MatchEvent[];
  homeTeam: string; awayTeam: string;
  homeLogo?: string; awayLogo?: string;
}) {
  if (events.length === 0) return <EmptyNote>No events recorded yet</EmptyNote>;

  const homeEvts = events.filter((e) => isHomeEvt(e, homeTeam));
  const awayEvts = events.filter((e) => !isHomeEvt(e, homeTeam));

  const maxMin = Math.max(95, ...events.map((e) => e.time.elapsed + (e.time.extra ?? 0)));
  const toPct = (elapsed: number, extra: number | null) =>
    Math.min(97, Math.max(3, ((elapsed + (extra ?? 0)) / maxMin) * 100));
  const htPct = toPct(45, null);

  const ICON_H = 60;
  const BAR_H  = 32;

  const renderIcons = (evts: MatchEvent[], above: boolean) => (
    <div style={{ height: ICON_H, position: 'relative' }}>
      {evts.map((e, i) => {
        const { icon, color, bg } = evtStyle(e.type, e.detail);
        const left = toPct(e.time.elapsed, e.time.extra);
        const minLabel = `${e.time.elapsed}${e.time.extra ? `+${e.time.extra}` : ''}'`;
        const tip = [minLabel, e.player.name, e.detail,
          e.type === 'subst' && e.assist.name ? `→ ${e.assist.name}` : null,
        ].filter(Boolean).join(' ');

        return (
          <div
            key={i}
            title={tip}
            style={{
              position: 'absolute',
              left: `${left}%`,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: above ? 'column-reverse' : 'column',
              alignItems: 'center',
              gap: 2,
              bottom: above ? 0 : undefined,
              top: above ? undefined : 0,
              cursor: 'default',
              zIndex: 1,
            }}
          >
            {/* Icon */}
            <div style={{
              width: 22, height: 22,
              borderRadius: bg === 'transparent' ? 3 : '50%',
              background: bg === 'transparent' ? 'none' : bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, lineHeight: 1, color,
              border: bg !== 'transparent' ? `1px solid ${color}30` : 'none',
              flexShrink: 0,
            }}>
              {icon}
            </div>
            {/* Minute label */}
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--gray-400)', whiteSpace: 'nowrap', lineHeight: 1 }}>
              {minLabel}
            </span>
            {/* Connector to bar */}
            <div style={{ width: 1, height: 6, background: 'var(--gray-200)', flexShrink: 0 }} />
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>

        {/* Team labels column */}
        <div style={{ width: 110, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: ICON_H, display: 'flex', alignItems: 'center' }}>
            <TeamLabel name={homeTeam} logo={homeLogo} color="#3b82f6" />
          </div>
          <div style={{ height: BAR_H }} />
          <div style={{ height: ICON_H, display: 'flex', alignItems: 'center' }}>
            <TeamLabel name={awayTeam} logo={awayLogo} color="#f97316" />
          </div>
        </div>

        {/* Timeline column */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Home events (above bar) */}
          {renderIcons(homeEvts, true)}

          {/* Bar */}
          <div style={{ height: BAR_H, position: 'relative', display: 'flex', alignItems: 'center' }}>
            {/* Green bar */}
            <div style={{
              position: 'absolute', left: 0, right: 0, height: 10,
              background: 'linear-gradient(90deg, #15803d 0%, #22c55e 60%, #16a34a 100%)',
              borderRadius: 999,
            }} />

            {/* Event ticks on bar */}
            {events.map((e, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: `${toPct(e.time.elapsed, e.time.extra)}%`,
                transform: 'translateX(-50%)',
                width: 2, height: 16,
                background: '#fff', borderRadius: 1, opacity: 0.65, zIndex: 1,
              }} />
            ))}

            {/* I marker */}
            <div style={{ position: 'absolute', left: -2, transform: 'translateX(-50%)', zIndex: 4 }}>
              <TimelineMarker label="I" bg="#15803d" textColor="#fff" />
            </div>

            {/* HT marker */}
            <div style={{ position: 'absolute', left: `${htPct}%`, transform: 'translateX(-50%)', zIndex: 4 }}>
              <TimelineMarker label="HT" bg="#fff" textColor="#15803d" size={24} />
            </div>

            {/* F marker */}
            <div style={{ position: 'absolute', right: -2, transform: 'translateX(50%)', zIndex: 4 }}>
              <TimelineMarker label="F" bg="#15803d" textColor="#fff" />
            </div>
          </div>

          {/* Away events (below bar) */}
          {renderIcons(awayEvts, false)}
        </div>
      </div>
    </div>
  );
}

function StatBar({ label, home, away, suffix, isPercent }: {
  label: string; home: number; away: number; suffix: string; isPercent: boolean;
}) {
  const total = isPercent ? 100 : (home + away || 1);
  const homeW = (home / total) * 100;
  const awayW = (away / total) * 100;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>
        <span style={{ color: '#3b82f6' }}>{home}{suffix}</span>
        <span style={{ color: 'var(--gray-500)', fontSize: 10 }}>{label}</span>
        <span style={{ color: '#f97316' }}>{away}{suffix}</span>
      </div>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: `${homeW}%`, height: '100%', background: '#3b82f6', borderRadius: 3 }} />
        </div>
        <div style={{ flex: 1, display: 'flex' }}>
          <div style={{ width: `${awayW}%`, height: '100%', background: '#f97316', borderRadius: 3 }} />
        </div>
      </div>
    </div>
  );
}

function LineupList({ lineup, isHome }: { lineup: MatchScoutData['lineups'][number]; isHome: boolean }) {
  const color = isHome ? '#3b82f6' : '#f97316';
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 6 }}>
        {lineup.team.name} · <span style={{ fontWeight: 400, color: 'var(--gray-500)' }}>{lineup.formation}</span>
        {lineup.coach.name && <span style={{ fontWeight: 400, color: 'var(--gray-400)', fontSize: 11 }}> · {lineup.coach.name}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {lineup.startXI.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '2px 0' }}>
            <span style={{ color: 'var(--gray-400)', minWidth: 18, fontSize: 10 }}>{p.player.number}</span>
            <span style={{ fontWeight: 500 }}>{p.player.name}</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: 'var(--gray-400)', background: 'var(--gray-100)', padding: '1px 4px', borderRadius: 3 }}>{p.player.pos}</span>
          </div>
        ))}
        {lineup.substitutes.length > 0 && (
          <>
            <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600, marginTop: 6, marginBottom: 2, textTransform: 'uppercase' }}>Substitutes</div>
            {lineup.substitutes.slice(0, 7).map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '1px 0', color: 'var(--gray-500)' }}>
                <span style={{ color: 'var(--gray-300)', minWidth: 18, fontSize: 10 }}>{p.player.number}</span>
                <span>{p.player.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: 'var(--gray-300)', background: 'var(--gray-50)', padding: '1px 4px', borderRadius: 3 }}>{p.player.pos}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
