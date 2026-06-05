import type { MatchRow } from '../repos/matches.repo.js';
import type { MatchSnapshotRow } from '../repos/match-snapshots.repo.js';
import type { MatchAlertContext } from './match-alert-rule-engine.js';

type Side = 'home' | 'away';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/%/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function statPair(stats: Record<string, unknown>, key: string): { home: number | null; away: number | null } {
  const value = stats[key];
  if (!isRecord(value)) return { home: null, away: null };
  return {
    home: toNumber(value.home),
    away: toNumber(value.away),
  };
}

function teamSide(team: unknown, homeTeam: string, awayTeam: string): Side | null {
  if (typeof team !== 'string') return null;
  const normalized = team.trim().toLowerCase();
  if (normalized && normalized === homeTeam.trim().toLowerCase()) return 'home';
  if (normalized && normalized === awayTeam.trim().toLowerCase()) return 'away';
  return null;
}

function normalizeEvents(rawEvents: unknown, homeTeam: string, awayTeam: string): Array<{
  minute: number;
  type: string;
  detail: string;
  side: Side | null;
}> {
  if (!Array.isArray(rawEvents)) return [];
  return rawEvents
    .map((event) => {
      if (!isRecord(event)) return null;
      const minute = toNumber(event.minute ?? getPath(event, 'time.elapsed')) ?? 0;
      const rawType = String(event.type ?? '').trim();
      const rawDetail = String(event.detail ?? '').trim();
      const compactSide = event.side === 'home' || event.side === 'away' ? event.side : null;
      const side = compactSide ?? teamSide(event.team ?? getPath(event, 'team.name'), homeTeam, awayTeam);
      const type = rawType.toLowerCase();
      return {
        minute,
        type: type === 'goal' || rawType === 'Goal' ? 'goal' : (type === 'card' || rawType === 'Card' ? 'card' : type),
        detail: rawDetail,
        side,
      };
    })
    .filter((event): event is { minute: number; type: string; detail: string; side: Side | null } => event !== null)
    .sort((a, b) => a.minute - b.minute);
}

function getPath(root: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function buildEventFacts(
  events: ReturnType<typeof normalizeEvents>,
  homeScore: number,
  awayScore: number,
): Record<string, unknown> {
  const goals = events.filter((event) => event.type === 'goal' && event.side);
  const redCards = events.filter((event) => (
    event.type === 'card'
    && event.side
    && event.detail.toLowerCase().includes('red')
  ));
  const firstGoal = goals[0] ?? null;
  const lastGoal = goals[goals.length - 1] ?? null;
  const lastRedCard = redCards[redCards.length - 1] ?? null;

  let lastGoalType: 'equalizer' | 'lead_change' | 'opener' | 'goal' | null = null;
  if (lastGoal) {
    if (homeScore === awayScore) lastGoalType = 'equalizer';
    else if (goals.length === 1) lastGoalType = 'opener';
    else lastGoalType = 'goal';
  }

  return {
    first_goal: firstGoal ? { side: firstGoal.side, minute: firstGoal.minute } : {},
    last_goal: lastGoal ? { side: lastGoal.side, minute: lastGoal.minute, type: lastGoalType } : {},
    red_card: lastRedCard ? { side: lastRedCard.side, minute: lastRedCard.minute } : {},
    red_cards: redCards.map((event) => ({ side: event.side, minute: event.minute })),
  };
}

function sideDiff(pair: { home: number | null; away: number | null }): { home: number | null; away: number | null } {
  if (pair.home == null || pair.away == null) return { home: null, away: null };
  return {
    home: pair.home - pair.away,
    away: pair.away - pair.home,
  };
}

function snapshotAgeSeconds(snapshot: MatchSnapshotRow | null | undefined, now = Date.now()): number | null {
  if (!snapshot?.captured_at) return null;
  const ts = Date.parse(snapshot.captured_at);
  return Number.isFinite(ts) ? Math.max(0, Math.round((now - ts) / 1000)) : null;
}

export function buildMatchAlertContext(
  match: MatchRow,
  snapshot: MatchSnapshotRow | null | undefined,
  now = new Date(),
): MatchAlertContext {
  const stats = snapshot?.stats && isRecord(snapshot.stats) ? snapshot.stats : {};
  const events = normalizeEvents(snapshot?.events ?? [], match.home_team, match.away_team);
  const homeScore = snapshot?.home_score ?? match.home_score ?? 0;
  const awayScore = snapshot?.away_score ?? match.away_score ?? 0;
  const minute = snapshot?.minute ?? match.current_minute ?? null;
  const scoreState = homeScore === awayScore ? 'draw' : (homeScore > awayScore ? 'home_leading' : 'away_leading');
  const leadingSide = homeScore === awayScore ? null : (homeScore > awayScore ? 'home' : 'away');
  const losingSide = homeScore === awayScore ? null : (homeScore > awayScore ? 'away' : 'home');
  const shots = statPair(stats, 'shots');
  const shotsOnTarget = statPair(stats, 'shots_on_target');
  const corners = statPair(stats, 'corners');
  const redCards = statPair(stats, 'red_cards');
  const yellowCards = statPair(stats, 'yellow_cards');

  return {
    matchId: String(match.match_id),
    status: snapshot?.status || match.status || '',
    minute,
    kickoffAtUtc: match.kickoff_at_utc ?? null,
    nowIso: now.toISOString(),
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    leagueName: match.league_name,
    score: {
      home: homeScore,
      away: awayScore,
      total: homeScore + awayScore,
      state: scoreState,
      leadingSide,
      losingSide,
    },
    stats: {
      shots,
      shots_on_target: shotsOnTarget,
      corners,
      red_cards: {
        home: redCards.home ?? match.home_reds ?? 0,
        away: redCards.away ?? match.away_reds ?? 0,
      },
      yellow_cards: {
        home: yellowCards.home ?? match.home_yellows ?? 0,
        away: yellowCards.away ?? match.away_yellows ?? 0,
      },
    },
    events: buildEventFacts(events, homeScore, awayScore),
    derived: {
      sot_diff: sideDiff(shotsOnTarget),
      shots_diff: sideDiff(shots),
      corners_diff: sideDiff(corners),
      corners_total: (corners.home ?? 0) + (corners.away ?? 0),
      btts: homeScore > 0 && awayScore > 0,
      leading_side: leadingSide,
      losing_side: losingSide,
    },
    dataFreshness: {
      snapshotAgeSeconds: snapshotAgeSeconds(snapshot, now.getTime()),
    },
  };
}
