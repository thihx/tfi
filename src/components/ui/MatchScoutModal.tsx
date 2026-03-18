// ============================================================
// Match Scout Modal — Pre-match analytics & Live match view
// Double-click a match row to open
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Modal } from './Modal';
import { formatLocalDateShortYear } from '@/lib/utils/helpers';
import { useAppState } from '@/hooks/useAppState';
import { fetchMatchScout, type MatchScoutData } from '@/lib/services/api';
import { LIVE_STATUSES } from '@/config/constants';

interface MatchScoutModalProps {
  open: boolean;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  leagueName?: string;
  leagueId?: number;
  status?: string;
  onClose: () => void;
}

export function MatchScoutModal({
  open, matchId, homeTeam, awayTeam, homeLogo, awayLogo,
  leagueName, leagueId, status, onClose,
}: MatchScoutModalProps) {
  const { state } = useAppState();
  const [data, setData] = useState<MatchScoutData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLive = status ? LIVE_STATUSES.includes(status) : false;
  const isFinished = status ? ['FT', 'AET', 'PEN'].includes(status) : false;
  const hasStarted = isLive || isFinished;

  const season = new Date().getMonth() < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear();

  const load = useCallback(async () => {
    if (!open || !matchId) return;
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
  }, [open, matchId, leagueId, season, status, state.config]);

  useEffect(() => { if (open) load(); }, [load, open]);

  const title = `${homeTeam} vs ${awayTeam}`;

  return (
    <Modal open={open} title={title} onClose={onClose} size="xl">
      <div style={{ minHeight: 300 }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, gap: 12, color: 'var(--gray-400)' }}>
            <div className="loading-spinner" />
            <span style={{ fontSize: 13 }}>Loading match data from Football API…</span>
          </div>
        )}
        {error && !loading && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ color: 'var(--gray-400)', fontSize: 13, marginBottom: 12 }}>{error}</div>
            <button className="btn btn-secondary btn-sm" onClick={load}>Retry</button>
          </div>
        )}
        {!loading && !error && data && (
          hasStarted
            ? <LiveView data={data} homeTeam={homeTeam} awayTeam={awayTeam} homeLogo={homeLogo} awayLogo={awayLogo} leagueName={leagueName} status={status} isLive={isLive} />
            : <PreMatchView data={data} homeTeam={homeTeam} awayTeam={awayTeam} homeLogo={homeLogo} awayLogo={awayLogo} leagueName={leagueName} />
        )}
      </div>
    </Modal>
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
  const pred = data.prediction;
  const standings = data.standings;

  const venue = fix?.fixture?.venue;
  const round = fix?.league?.round;
  const referee = fix?.fixture?.referee;

  // % values from prediction
  const pct = pred?.predictions?.percent;
  const homeP = pct ? parseFloat(pct.home) : null;
  const drawP = pct ? parseFloat(pct.draw) : null;
  const awayP = pct ? parseFloat(pct.away) : null;

  // Form from prediction teams
  const homeForm = pred?.teams?.home?.league?.form ?? '';
  const awayForm = pred?.teams?.away?.league?.form ?? '';

  // H2H from prediction (raw array)
  const h2h = Array.isArray(pred?.h2h) ? pred!.h2h!.slice(0, 5) : [];

  // Comparison
  const comp = pred?.comparison;

  // Standings: find positions of home/away teams
  const homeIdx = standings.findIndex((s) => s.team.name === homeTeam || homeTeam.includes(s.team.name) || s.team.name.includes(homeTeam));
  const awayIdx = standings.findIndex((s) => s.team.name === awayTeam || awayTeam.includes(s.team.name) || s.team.name.includes(awayTeam));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Match Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid var(--gray-100)' }}>
        <TeamBadge name={homeTeam} logo={homeLogo} align="left" />
        <div style={{ textAlign: 'center', flex: 1 }}>
          {leagueName && <div style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{leagueName}</div>}
          {round && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 }}>{round}</div>}
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--gray-800)', letterSpacing: '-1px' }}>vs</div>
          {venue?.name && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>{venue.name}{venue.city ? `, ${venue.city}` : ''}</div>}
          {referee && <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Ref: {referee}</div>}
        </div>
        <TeamBadge name={awayTeam} logo={awayLogo} align="right" />
      </div>

      {/* ── Win Probability ── */}
      {homeP !== null && (
        <Section title="Win Probability">
          <WinProbBar homeP={homeP} drawP={drawP ?? 0} awayP={awayP ?? 0} homeTeam={homeTeam} awayTeam={awayTeam} />
          {pred?.predictions?.advice && (
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 8, fontStyle: 'italic', textAlign: 'center' }}>
              "{pred.predictions.advice}"
            </div>
          )}
          {pred?.predictions?.under_over && (
            <div style={{ fontSize: 12, color: 'var(--gray-600)', textAlign: 'center', marginTop: 4 }}>
              Goals: <strong>{pred.predictions.under_over}</strong>
            </div>
          )}
        </Section>
      )}

      {/* ── Form + H2H (2 cols) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Form Guide */}
        <Section title="Recent Form (last 5)">
          <FormRow label={homeTeam} form={homeForm} />
          <FormRow label={awayTeam} form={awayForm} />
          {!homeForm && !awayForm && <EmptyNote>Form data not available</EmptyNote>}
        </Section>

        {/* H2H */}
        <Section title="Head to Head">
          {h2h.length > 0 ? (
            <>
              <H2HSummary h2h={h2h} homeTeam={homeTeam} awayTeam={awayTeam} />
              <div style={{ marginTop: 10 }}>
                {h2h.map((m, i) => <H2HRow key={i} match={m} homeTeam={homeTeam} />)}
              </div>
            </>
          ) : <EmptyNote>No H2H data available</EmptyNote>}
        </Section>
      </div>

      {/* ── Comparison + Standings (2 cols) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Comparison */}
        <Section title="Team Comparison">
          {comp ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CompBar label="Form" home={comp.form?.home} away={comp.form?.away} />
              <CompBar label="Attack" home={comp.att?.home} away={comp.att?.away} />
              <CompBar label="Defense" home={comp.def?.home} away={comp.def?.away} />
            </div>
          ) : <EmptyNote>Comparison data not available</EmptyNote>}
        </Section>

        {/* Standings */}
        <Section title={`League Table${leagueName ? ` · ${leagueName}` : ''}`}>
          {standings.length > 0 ? (
            <StandingsSnippet standings={standings} homeIdx={homeIdx} awayIdx={awayIdx} homeTeam={homeTeam} awayTeam={awayTeam} />
          ) : <EmptyNote>Standings not available</EmptyNote>}
        </Section>
      </div>
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
      <div style={{ background: isLive ? '#0f172a' : 'var(--gray-50)', borderRadius: 10, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <TeamBadge name={homeTeam} logo={homeLogo} align="left" dark={isLive} />
        <div style={{ textAlign: 'center', flex: 1 }}>
          {isLive && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', letterSpacing: '1px' }}>LIVE {elapsed ? `· ${elapsed}'` : ''}</span>
            </div>
          )}
          {!isLive && status && (
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', letterSpacing: '1px', marginBottom: 6 }}>{status === 'HT' ? 'HALF TIME' : 'FULL TIME'}</div>
          )}
          <div style={{ fontSize: 40, fontWeight: 900, color: isLive ? '#f9fafb' : 'var(--gray-900)', letterSpacing: '-2px', lineHeight: 1 }}>
            {homeGoals} <span style={{ color: isLive ? '#4b5563' : 'var(--gray-300)' }}>–</span> {awayGoals}
          </div>
          {leagueName && <div style={{ fontSize: 11, color: isLive ? '#6b7280' : 'var(--gray-400)', marginTop: 6 }}>{leagueName}</div>}
        </div>
        <TeamBadge name={awayTeam} logo={awayLogo} align="right" dark={isLive} />
      </div>

      {/* ── Events + Stats (2 cols) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 16, alignItems: 'start' }}>
        {/* Events Timeline */}
        <Section title="Match Events">
          {events.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 340, overflowY: 'auto' }}>
              {events.map((e, i) => <EventRow key={i} event={e} homeTeam={homeTeam} />)}
            </div>
          ) : <EmptyNote>No events recorded yet</EmptyNote>}
        </Section>

        {/* Match Stats */}
        <Section title="Match Statistics">
          {statRows.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {statRows.map((r) => (
                <StatBar key={r.label} label={r.label} home={r.home} away={r.away} suffix={r.suffix} isPercent={r.isPercent} />
              ))}
            </div>
          ) : <EmptyNote>Statistics not yet available</EmptyNote>}
        </Section>
      </div>

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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'flex-end', gap: 6, minWidth: 120, maxWidth: 180 }}>
      {logo && <img src={logo} alt={name} style={{ width: 44, height: 44, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
      <div style={{ fontSize: 14, fontWeight: 700, color, textAlign: align === 'left' ? 'left' : 'right', lineHeight: 1.2 }}>{name}</div>
    </div>
  );
}

function WinProbBar({ homeP, drawP, awayP, homeTeam, awayTeam }: { homeP: number; drawP: number; awayP: number; homeTeam: string; awayTeam: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--gray-600)' }}>
        <span>{homeTeam.split(' ').pop()}</span>
        <span style={{ color: 'var(--gray-400)' }}>Draw</span>
        <span>{awayTeam.split(' ').pop()}</span>
      </div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--gray-100)' }}>
        <div style={{ width: `${homeP}%`, background: '#3b82f6', transition: 'width 0.5s' }} />
        <div style={{ width: `${drawP}%`, background: '#d1d5db' }} />
        <div style={{ width: `${awayP}%`, background: '#f97316', transition: 'width 0.5s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginTop: 4 }}>
        <span style={{ color: '#3b82f6' }}>{homeP}%</span>
        <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>{drawP}%</span>
        <span style={{ color: '#f97316' }}>{awayP}%</span>
      </div>
    </div>
  );
}

function FormRow({ label, form }: { label: string; form: string }) {
  const last5 = form.slice(-5).split('');
  const colors: Record<string, { bg: string; color: string }> = {
    W: { bg: '#dcfce7', color: '#15803d' },
    D: { bg: 'var(--gray-100)', color: 'var(--gray-600)' },
    L: { bg: '#fee2e2', color: '#b91c1c' },
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--gray-600)', minWidth: 100, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ display: 'flex', gap: 3 }}>
        {last5.length > 0 ? last5.map((r, i) => {
          const c = colors[r] ?? { bg: 'var(--gray-100)', color: 'var(--gray-600)' };
          return (
            <span key={i} style={{ width: 22, height: 22, borderRadius: 4, background: c.bg, color: c.color, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {r}
            </span>
          );
        }) : <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>—</span>}
      </div>
    </div>
  );
}

type H2HArr = NonNullable<NonNullable<MatchScoutData['prediction']>['h2h']>;

function H2HSummary({ h2h, homeTeam, awayTeam }: { h2h: H2HArr | undefined; homeTeam: string; awayTeam: string }) {
  if (!h2h?.length) return null;
  let hw = 0, aw = 0, d = 0;
  for (const m of h2h) {
    const hg = m.goals.home ?? 0, ag = m.goals.away ?? 0;
    if (hg === ag) d++;
    else if (m.teams.home.winner) { if (m.teams.home.name.includes(homeTeam.split(' ')[0]!)) hw++; else aw++; }
    else if (m.teams.away.winner) { if (m.teams.away.name.includes(awayTeam.split(' ')[0]!)) hw++; else aw++; }
  }
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      {[{ v: hw, label: homeTeam.split(' ').pop()!, color: '#3b82f6' }, { v: d, label: 'Draw', color: 'var(--gray-400)' }, { v: aw, label: awayTeam.split(' ').pop()!, color: '#f97316' }].map((x) => (
        <div key={x.label} style={{ flex: 1, textAlign: 'center', background: 'var(--gray-50)', borderRadius: 6, padding: '6px 4px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: x.color }}>{x.v}</div>
          <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600 }}>{x.label}</div>
        </div>
      ))}
    </div>
  );
}

function H2HRow({ match: m, homeTeam }: { match: H2HArr[number]; homeTeam: string }) {
  const hg = m.goals.home ?? 0, ag = m.goals.away ?? 0;
  const date = formatLocalDateShortYear(m.fixture.date);
  const isHomeWin = m.teams.home.winner === true;
  const isAwayWin = m.teams.away.winner === true;
  const isHomeTeam = m.teams.home.name.includes(homeTeam.split(' ')[0]!);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--gray-100)', color: 'var(--gray-600)' }}>
      <span style={{ color: 'var(--gray-400)', minWidth: 62 }}>{date}</span>
      <span style={{ flex: 1, textAlign: 'right', fontWeight: (isHomeTeam && isHomeWin) || (!isHomeTeam && isAwayWin) ? 700 : 400 }}>{m.teams.home.name}</span>
      <span style={{ minWidth: 36, textAlign: 'center', fontWeight: 700, color: 'var(--gray-800)', background: 'var(--gray-100)', borderRadius: 4, padding: '1px 4px' }}>{hg}–{ag}</span>
      <span style={{ flex: 1, fontWeight: (!isHomeTeam && isHomeWin) || (isHomeTeam && isAwayWin) ? 700 : 400 }}>{m.teams.away.name}</span>
    </div>
  );
}

function CompBar({ label, home, away }: { label: string; home?: string; away?: string }) {
  const hp = home ? parseFloat(home) : null;
  const ap = away ? parseFloat(away) : null;
  if (hp === null && ap === null) return null;
  const hVal = hp ?? 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6', minWidth: 32, textAlign: 'right' }}>{home ?? '—'}</span>
      <div style={{ flex: 1, height: 6, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', right: `${100 - hVal}%`, left: 0, height: '100%', background: '#3b82f6', borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10, color: 'var(--gray-400)', minWidth: 55, textAlign: 'center', fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${ap ?? 0}%`, height: '100%', background: '#f97316', borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#f97316', minWidth: 32 }}>{away ?? '—'}</span>
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

function EventRow({ event: e, homeTeam }: { event: MatchScoutData['events'][number]; homeTeam: string }) {
  const isHome = e.team.name === homeTeam || homeTeam.includes(e.team.name) || e.team.name.includes(homeTeam);
  const min = `${e.time.elapsed}${e.time.extra ? `+${e.time.extra}` : ''}' `;

  let icon = '';
  let color = 'var(--gray-600)';
  if (e.type === 'Goal') { icon = '⚽'; color = '#15803d'; }
  else if (e.type === 'Card') {
    if (e.detail.includes('Yellow')) { icon = '🟨'; color = '#d97706'; }
    else if (e.detail.includes('Red') || e.detail.includes('Second Yellow')) { icon = '🟥'; color = '#b91c1c'; }
  } else if (e.type === 'subst') { icon = '🔄'; color = '#6366f1'; }
  else if (e.type === 'Var') { icon = 'VAR'; color = 'var(--gray-500)'; }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--gray-50)', flexDirection: isHome ? 'row' : 'row-reverse' }}>
      <span style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 700, minWidth: 32, marginTop: 2, textAlign: isHome ? 'left' : 'right' }}>{min}</span>
      <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
      <div style={{ flex: 1, textAlign: isHome ? 'left' : 'right' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color }}>{e.player.name ?? '—'}</div>
        {e.assist.name && <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>assist: {e.assist.name}</div>}
        {e.type === 'subst' && e.assist.name && <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>→ {e.assist.name}</div>}
        <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 500 }}>{e.team.name}</div>
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
