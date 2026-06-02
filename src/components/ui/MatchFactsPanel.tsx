import type { MatchScoutData, MatchSnapshot } from '@/lib/services/api';

type FactTab = 'summary' | 'statistics' | 'table';

interface MatchFactsPanelProps {
  view: FactTab;
  data: MatchScoutData | null;
  snapshots?: MatchSnapshot[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  leagueName?: string;
  status?: string;
}

type ScoutEvent = MatchScoutData['events'][number];
type StandingRow = MatchScoutData['standings'][number];
type StatEntry = MatchScoutData['statistics'][number]['statistics'][number];

const STAT_ROWS = [
  { label: 'Ball possession', type: 'Ball Possession', suffix: '%', percent: true },
  { label: 'Shots total', type: 'Total Shots', suffix: '', percent: false },
  { label: 'Shots on target', type: 'Shots on Goal', suffix: '', percent: false },
  { label: 'Shots off target', type: 'Shots off Goal', suffix: '', percent: false },
  { label: 'Corners', type: 'Corner Kicks', suffix: '', percent: false },
  { label: 'Yellow cards', type: 'Yellow Cards', suffix: '', percent: false },
  { label: 'Red cards', type: 'Red Cards', suffix: '', percent: false },
  { label: 'Fouls', type: 'Fouls', suffix: '', percent: false },
];

function isHomeName(eventTeam: string, homeTeam: string): boolean {
  const eventName = eventTeam.toLowerCase();
  const homeName = homeTeam.toLowerCase();
  return eventName === homeName || eventName.includes(homeName) || homeName.includes(eventName);
}

function getMinuteLabel(event: ScoutEvent): string {
  return `${event.time.elapsed}${event.time.extra ? `+${event.time.extra}` : ''}'`;
}

function eventKind(event: ScoutEvent): 'goal' | 'yellow' | 'red' | 'sub' | 'var' | 'other' {
  const type = event.type.toLowerCase();
  const detail = event.detail.toLowerCase();
  if (type === 'goal') return 'goal';
  if (type === 'card') return detail.includes('red') || detail.includes('second yellow') ? 'red' : 'yellow';
  if (type === 'subst') return 'sub';
  if (type === 'var') return 'var';
  return 'other';
}

function eventIcon(event: ScoutEvent): string {
  const kind = eventKind(event);
  if (kind === 'goal') return 'G';
  if (kind === 'yellow') return 'YC';
  if (kind === 'red') return 'RC';
  if (kind === 'sub') return 'SUB';
  if (kind === 'var') return 'VAR';
  return '-';
}

function buildEventRows(events: ScoutEvent[], homeTeam: string) {
  let homeScore = 0;
  let awayScore = 0;

  return [...events]
    .sort((a, b) => (a.time.elapsed + (a.time.extra ?? 0) / 100) - (b.time.elapsed + (b.time.extra ?? 0) / 100))
    .map((event) => {
      const isHome = isHomeName(event.team.name, homeTeam);
      const kind = eventKind(event);
      let score = '';
      if (kind === 'goal') {
        const ownGoal = event.detail.toLowerCase().includes('own');
        if ((isHome && !ownGoal) || (!isHome && ownGoal)) homeScore += 1;
        else awayScore += 1;
        score = `${homeScore}-${awayScore}`;
      }
      return { event, isHome, score };
    });
}

function numberFromStat(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(String(value).replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function findStat(stats: StatEntry[], type: string): number | null {
  const found = stats.find((entry) => entry.type === type);
  return numberFromStat(found?.value);
}

function getStatRows(data: MatchScoutData) {
  const homeStats = data.statistics[0]?.statistics ?? [];
  const awayStats = data.statistics[1]?.statistics ?? [];
  return STAT_ROWS
    .map((row) => ({
      ...row,
      home: findStat(homeStats, row.type) ?? 0,
      away: findStat(awayStats, row.type) ?? 0,
    }))
    .filter((row) => row.home > 0 || row.away > 0 || row.type === 'Ball Possession');
}

function matchTeamName(name: string, target: string): boolean {
  const left = name.toLowerCase();
  const right = target.toLowerCase();
  return left === right || left.includes(right) || right.includes(left);
}

function getScore(data: MatchScoutData): { home: number; away: number } {
  return {
    home: data.fixture?.goals.home ?? 0,
    away: data.fixture?.goals.away ?? 0,
  };
}

function getDisplayStatus(data: MatchScoutData, status?: string): string {
  return data.fixture?.fixture.status.short ?? status ?? '';
}

function getElapsed(data: MatchScoutData): number | null {
  return data.fixture?.fixture.status.elapsed ?? null;
}

function logoSrc(data: MatchScoutData, side: 'home' | 'away', fallback?: string): string | undefined {
  return fallback || data.fixture?.teams[side].logo || undefined;
}

function MatchFactHeader({
  data,
  homeTeam,
  awayTeam,
  homeLogo,
  awayLogo,
  leagueName,
  status,
}: Omit<MatchFactsPanelProps, 'view' | 'loading' | 'error' | 'onRetry' | 'snapshots'> & { data: MatchScoutData }) {
  const score = getScore(data);
  const elapsed = getElapsed(data);
  const fixtureStatus = getDisplayStatus(data, status);
  const league = data.fixture?.league.name || leagueName || '';
  const country = data.fixture?.league.country || '';

  return (
    <div className="match-facts">
      <div className="match-facts__league-row">
        <span className="match-facts__league-name">{country ? `${country}, ${league}` : league || 'Match'}</span>
        <span className="match-facts__league-date">{fixtureStatus}</span>
      </div>
      <div className="match-facts__scoreboard">
        <TeamBlock name={homeTeam} logo={logoSrc(data, 'home', homeLogo)} />
        <div className="match-facts__score-center">
          {elapsed != null && <div className="match-facts__minute"><span />{elapsed}'</div>}
          <div className="match-facts__score">{score.home}-{score.away}</div>
          <div className="match-facts__status">{fixtureStatus}</div>
        </div>
        <TeamBlock name={awayTeam} logo={logoSrc(data, 'away', awayLogo)} align="right" />
      </div>
    </div>
  );
}

function TeamBlock({ name, logo, align = 'left' }: { name: string; logo?: string; align?: 'left' | 'right' }) {
  return (
    <div className={`match-facts__team match-facts__team--${align}`}>
      {logo ? (
        <img src={logo} alt="" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />
      ) : (
        <div className="match-facts__placeholder-logo" />
      )}
      <strong>{name}</strong>
    </div>
  );
}

function SummaryView({ data, homeTeam, awayTeam }: { data: MatchScoutData; homeTeam: string; awayTeam: string }) {
  const rows = buildEventRows(data.events, homeTeam);
  const elapsed = getElapsed(data);
  const shouldShowHalfTime = elapsed == null || elapsed >= 45 || rows.some((row) => row.event.time.elapsed >= 45);
  const htRowIndex = rows.findIndex((row) => row.event.time.elapsed > 45);

  if (rows.length === 0 && !shouldShowHalfTime) {
    return <CompactEmpty message="No match events recorded yet." />;
  }

  const rendered: Array<{ key: string; type: 'event' | 'ht'; row?: (typeof rows)[number] }> = [];
  rows.forEach((row, index) => {
    if (shouldShowHalfTime && index === htRowIndex) rendered.push({ key: 'ht', type: 'ht' });
    rendered.push({ key: `${row.event.time.elapsed}-${row.event.team.name}-${index}`, type: 'event', row });
  });
  if (shouldShowHalfTime && htRowIndex === -1) rendered.push({ key: 'ht', type: 'ht' });

  return (
    <div className="match-facts__summary-table" role="table" aria-label="Match summary">
      {rendered.map((item) => {
        if (item.type === 'ht') {
          return (
            <div key={item.key} className="match-facts__event-row match-facts__event-row--break">
              <span>HT</span>
              <span />
              <span />
              <span />
            </div>
          );
        }
        const row = item.row!;
        const player = row.event.player.name || row.event.detail || row.event.type;
        const icon = eventIcon(row.event);
        return (
          <div key={item.key} className="match-facts__event-row">
            <span className="match-facts__event-minute">{getMinuteLabel(row.event)}</span>
            <span className="match-facts__event-home">
              {row.isHome ? <EventText player={player} icon={icon} detail={row.event.detail} align="home" /> : null}
            </span>
            <span className="match-facts__event-score">{row.score}</span>
            <span className="match-facts__event-away">
              {!row.isHome ? <EventText player={player} icon={icon} detail={row.event.detail} align="away" /> : null}
            </span>
          </div>
        );
      })}
      <div className="match-facts__summary-legend">
        <span>{homeTeam}</span>
        <span>{awayTeam}</span>
      </div>
    </div>
  );
}

function EventText({ player, icon, detail, align }: { player: string; icon: string; detail: string; align: 'home' | 'away' }) {
  const kindClass = icon === 'YC' ? 'yellow' : icon === 'RC' ? 'red' : icon === 'G' ? 'goal' : 'neutral';
  return (
    <span className={`match-facts__event-text match-facts__event-text--${align}`} title={detail}>
      {align === 'away' && <EventToken label={icon} kind={kindClass} />}
      <strong>{player}</strong>
      {align === 'home' && <EventToken label={icon} kind={kindClass} />}
    </span>
  );
}

function EventToken({ label, kind }: { label: string; kind: string }) {
  return <span className={`match-facts__event-token match-facts__event-token--${kind}`}>{label}</span>;
}

function StatisticsView({ data, snapshots, homeTeam }: { data: MatchScoutData; snapshots?: MatchSnapshot[] | null; homeTeam: string }) {
  const rows = getStatRows(data);
  return (
    <div className="match-facts__stats">
      {rows.length > 0 ? rows.map((row) => <StatComparison key={row.type} row={row} />) : <CompactEmpty message="Statistics not yet available." />}
      <DominanceChart snapshots={snapshots ?? []} events={data.events} homeTeam={homeTeam} />
    </div>
  );
}

function StatComparison({ row }: { row: ReturnType<typeof getStatRows>[number] }) {
  const total = row.percent ? 100 : Math.max(row.home + row.away, 1);
  const homeWidth = Math.max(0, Math.min(100, (row.home / total) * 100));
  const awayWidth = Math.max(0, Math.min(100, (row.away / total) * 100));
  return (
    <div className="match-facts__stat-row">
      <div className="match-facts__stat-head">
        <strong>{row.home}{row.suffix}</strong>
        <span>{row.label}</span>
        <strong>{row.away}{row.suffix}</strong>
      </div>
      <div className="match-facts__stat-bars">
        <div><span style={{ width: `${homeWidth}%` }} /></div>
        <div><span style={{ width: `${awayWidth}%` }} /></div>
      </div>
    </div>
  );
}

function statObjectValue(stats: Record<string, unknown>, key: string, side: 'home' | 'away'): number {
  const value = stats[key];
  if (value && typeof value === 'object') {
    const parsed = Number((value as Record<string, unknown>)[side]);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function DominanceChart({ snapshots, events, homeTeam }: { snapshots: MatchSnapshot[]; events: ScoutEvent[]; homeTeam: string }) {
  const sortedSnapshots = [...snapshots].sort((a, b) => a.minute - b.minute).slice(-22);
  const points = sortedSnapshots.length > 1
    ? sortedSnapshots.map((snapshot) => {
      const stats = snapshot.stats || {};
      const home = statObjectValue(stats, 'shots_on_target', 'home') * 3
        + statObjectValue(stats, 'shots', 'home')
        + statObjectValue(stats, 'corners', 'home') * 1.5;
      const away = statObjectValue(stats, 'shots_on_target', 'away') * 3
        + statObjectValue(stats, 'shots', 'away')
        + statObjectValue(stats, 'corners', 'away') * 1.5;
      return { minute: snapshot.minute, value: Math.max(-8, Math.min(8, home - away)) };
    })
    : events.slice(-24).map((event) => {
      const weight = eventKind(event) === 'goal' ? 6 : eventKind(event) === 'yellow' ? -1 : 2;
      return { minute: event.time.elapsed, value: isHomeName(event.team.name, homeTeam) ? weight : -weight };
    });

  if (points.length === 0) return null;

  return (
    <div className="match-facts__dominance">
      <div className="match-facts__section-label">Dominance indicator</div>
      <div className="match-facts__dominance-chart">
        {points.map((point, index) => {
          const height = Math.max(8, Math.min(46, Math.abs(point.value) * 5));
          return (
            <span
              key={`${point.minute}-${index}`}
              title={`${point.minute}'`}
              className={point.value >= 0 ? 'match-facts__dom-home' : 'match-facts__dom-away'}
              style={{
                height,
                transform: point.value >= 0 ? 'translateY(-50%)' : `translateY(calc(-50% + ${height}px))`,
              }}
            />
          );
        })}
      </div>
      <div className="match-facts__dominance-axis">
        <span>0</span><span>15'</span><span>30'</span><span>45'</span><span>60'</span><span>75'</span><span>90'</span>
      </div>
    </div>
  );
}

function TableView({ data, homeTeam, awayTeam, leagueName }: { data: MatchScoutData; homeTeam: string; awayTeam: string; leagueName?: string }) {
  const rows = [...data.standings].sort((a, b) => a.rank - b.rank);
  if (rows.length === 0) return <CompactEmpty message="League table is not available for this match." />;

  return (
    <div className="match-facts__table-wrap">
      <div className="match-facts__table-title">
        <strong>{data.fixture?.league.name || leagueName || 'League table'}</strong>
        <span>Live</span>
      </div>
      <table className="match-facts__league-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>MP</th>
            <th>Pts</th>
            <th>Goals</th>
            <th>GD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <StandingTr
              key={`${row.rank}-${row.team.name}`}
              row={row}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandingTr({ row, homeTeam, awayTeam }: { row: StandingRow; homeTeam: string; awayTeam: string }) {
  const isHome = matchTeamName(row.team.name, homeTeam);
  const isAway = matchTeamName(row.team.name, awayTeam);
  return (
    <tr className={isHome || isAway ? 'match-facts__standing-active' : undefined}>
      <td><span className="match-facts__rank">{row.rank}</span></td>
      <td className="match-facts__team-cell">
        <span>{row.team.name}</span>
        {isHome || isAway ? <i>{isHome ? 'Home' : 'Away'}</i> : null}
      </td>
      <td>{row.all.played}</td>
      <td><strong>{row.points}</strong></td>
      <td>{row.all.goals.for} - {row.all.goals.against}</td>
      <td>{row.goalsDiff > 0 ? '+' : ''}{row.goalsDiff}</td>
    </tr>
  );
}

function CompactEmpty({ message }: { message: string }) {
  return <div className="match-facts__empty">{message}</div>;
}

export function MatchFactsPanel({
  view,
  data,
  snapshots,
  loading,
  error,
  onRetry,
  homeTeam,
  awayTeam,
  homeLogo,
  awayLogo,
  leagueName,
  status,
}: MatchFactsPanelProps) {
  if (loading) {
    return (
      <div className="loading-panel match-hub-loading">
        <div className="loading-spinner" />
        <p>Loading match facts...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="match-facts__error">
        <p>{error}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (!data) return <CompactEmpty message="No match facts available." />;

  return (
    <div>
      <MatchFactHeader
        data={data}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        homeLogo={homeLogo}
        awayLogo={awayLogo}
        leagueName={leagueName}
        status={status}
      />
      {view === 'summary' && <SummaryView data={data} homeTeam={homeTeam} awayTeam={awayTeam} />}
      {view === 'statistics' && <StatisticsView data={data} snapshots={snapshots} homeTeam={homeTeam} />}
      {view === 'table' && <TableView data={data} homeTeam={homeTeam} awayTeam={awayTeam} leagueName={leagueName} />}
    </div>
  );
}
