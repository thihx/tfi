import type { ApiFixtureEvent, ApiFixtureStat } from './football-api.js';

export interface SportmonksFixtureLike {
  id?: number | string;
  name?: string | null;
  league_id?: number | string | null;
  season_id?: number | string | null;
  state_id?: number | string | null;
  starting_at?: string | null;
  starting_at_timestamp?: number | string | null;
  result_info?: string | null;
  length?: number | string | null;
  has_odds?: boolean | null;
  has_premium_odds?: boolean | null;
  participants?: unknown;
  scores?: unknown;
  events?: unknown;
  statistics?: unknown;
  periods?: unknown;
  inplayOdds?: unknown;
  odds?: unknown;
  league?: unknown;
  state?: unknown;
}

export interface NormalizedSportmonksFixture {
  provider: 'sportmonks';
  providerFixtureId: string;
  name: string;
  leagueId: string | null;
  leagueName: string | null;
  seasonId: string | null;
  stateId: string | null;
  startingAt: string | null;
  startingAtTimestamp: number | null;
  resultInfo: string;
  lengthMinutes: number | null;
  hasOdds: boolean | null;
  hasPremiumOdds: boolean | null;
  participants: unknown[];
  scores: unknown[];
  events: unknown[];
  statistics: unknown[];
  periods: unknown[];
  inplayOdds: unknown[];
  rawIncludes: {
    league: boolean;
    state: boolean;
  };
}

export interface SportmonksCoverageFlags {
  has_fixture: boolean;
  has_participants: boolean;
  has_scores: boolean;
  has_events: boolean;
  has_statistics: boolean;
  has_periods: boolean;
  has_inplay_odds: boolean;
  provider_has_odds_flag: boolean;
  provider_has_premium_odds_flag: boolean;
  participant_count: number;
  score_count: number;
  event_count: number;
  statistic_count: number;
  period_count: number;
  inplay_odds_count: number;
}

export interface SportmonksParticipantSide {
  id: number | null;
  name: string;
  logo: string;
}

export interface SportmonksFixtureSides {
  home: SportmonksParticipantSide | null;
  away: SportmonksParticipantSide | null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data;
  }
  return [];
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value == null) return null;
  const text = String(value).toLowerCase().trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  return recordOf(recordOf(value)?.[key]);
}

function recordName(value: unknown): string | null {
  const row = recordOf(value);
  return stringOrNull(row?.name)
    ?? stringOrNull(row?.display_name)
    ?? stringOrNull(row?.code);
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    const pct = Number(value.trim().slice(0, -1));
    return Number.isFinite(pct) ? pct : null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeSportmonksFixture(input: SportmonksFixtureLike): NormalizedSportmonksFixture {
  const providerFixtureId = stringOrNull(input.id) ?? '';
  return {
    provider: 'sportmonks',
    providerFixtureId,
    name: stringOrNull(input.name) ?? '',
    leagueId: stringOrNull(input.league_id),
    leagueName: recordName(input.league),
    seasonId: stringOrNull(input.season_id),
    stateId: stringOrNull(input.state_id),
    startingAt: stringOrNull(input.starting_at),
    startingAtTimestamp: numberOrNull(input.starting_at_timestamp),
    resultInfo: stringOrNull(input.result_info) ?? '',
    lengthMinutes: numberOrNull(input.length),
    hasOdds: boolOrNull(input.has_odds),
    hasPremiumOdds: boolOrNull(input.has_premium_odds),
    participants: asArray(input.participants),
    scores: asArray(input.scores),
    events: asArray(input.events),
    statistics: asArray(input.statistics),
    periods: asArray(input.periods),
    inplayOdds: asArray(input.inplayOdds ?? input.odds),
    rawIncludes: {
      league: input.league != null,
      state: input.state != null,
    },
  };
}

export function getSportmonksFixtureSides(fixture: NormalizedSportmonksFixture): SportmonksFixtureSides {
  const sideOf = (wanted: 'home' | 'away'): SportmonksParticipantSide | null => {
    const participant = fixture.participants.find((entry) => {
      const meta = nestedRecord(entry, 'meta');
      return String(meta?.location ?? '').toLowerCase() === wanted;
    });
    const row = recordOf(participant);
    if (!row) return null;
    return {
      id: numberOrNull(row.id),
      name: stringOrNull(row.name) ?? '',
      logo: stringOrNull(row.image_path) ?? '',
    };
  };
  return {
    home: sideOf('home'),
    away: sideOf('away'),
  };
}

export function getSportmonksCurrentScore(fixture: NormalizedSportmonksFixture): {
  home: number | null;
  away: number | null;
} {
  const result = { home: null as number | null, away: null as number | null };
  for (const score of fixture.scores) {
    const row = recordOf(score);
    if (!row || String(row.description ?? '').toUpperCase() !== 'CURRENT') continue;
    const scorePayload = recordOf(row.score);
    const side = String(scorePayload?.participant ?? '').toLowerCase();
    const goals = numberValue(scorePayload?.goals);
    if (side === 'home') result.home = goals;
    if (side === 'away') result.away = goals;
  }
  return result;
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function statTypeName(row: Record<string, unknown>): string {
  const type = recordOf(row.type);
  return stringOrNull(type?.name)
    ?? stringOrNull(type?.display_name)
    ?? stringOrNull(type?.code)
    ?? stringOrNull(row.name)
    ?? stringOrNull(row.type)
    ?? SPORTMONKS_STAT_TYPE_NAME_BY_ID[stringOrNull(row.type_id) ?? '']
    ?? stringOrNull(row.type_id)
    ?? '';
}

const SPORTMONKS_STAT_TYPE_NAME_BY_ID: Record<string, string> = {
  '34': 'Corners',
  '42': 'Shots Total',
  '43': 'Attacks',
  '44': 'Dangerous Attacks',
  '45': 'Ball Possession',
  '56': 'Fouls',
  '80': 'Passes',
  '83': 'Red Cards',
  '84': 'Yellow Cards',
  '86': 'Shots On Target',
};

function statValue(row: Record<string, unknown>): string | number | null {
  const data = recordOf(row.data);
  const value = data?.value ?? row.value;
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  return text ? text : null;
}

function translateStatType(value: string): string {
  const normalized = normalizeName(value);
  const byName: Record<string, string> = {
    possession: 'Ball Possession',
    'ball possession': 'Ball Possession',
    'ball possession percentage': 'Ball Possession',
    'shots total': 'Total Shots',
    'total shots': 'Total Shots',
    shots: 'Total Shots',
    'shots on target': 'Shots on Goal',
    'shots on goal': 'Shots on Goal',
    corners: 'Corner Kicks',
    'corner kicks': 'Corner Kicks',
    fouls: 'Fouls',
    offsides: 'Offsides',
    'yellow cards': 'Yellow Cards',
    yellowcards: 'Yellow Cards',
    'red cards': 'Red Cards',
    redcards: 'Red Cards',
    'goalkeeper saves': 'Goalkeeper Saves',
    saves: 'Goalkeeper Saves',
    'blocked shots': 'Blocked Shots',
    passes: 'Total passes',
    'total passes': 'Total passes',
    'accurate passes': 'Passes accurate',
    'passes accurate': 'Passes accurate',
    'successful passes': 'Passes accurate',
    'shots off target': 'Shots off Goal',
    'shots off goal': 'Shots off Goal',
    'shots inside box': 'Shots insidebox',
    'shots insidebox': 'Shots insidebox',
    'shots outside box': 'Shots outsidebox',
    'shots outsidebox': 'Shots outsidebox',
    'expected goals': 'expected_goals',
    xg: 'expected_goals',
    'goals prevented': 'goals_prevented',
    'pass accuracy': 'Passes %',
    'passes percentage': 'Passes %',
  };
  return byName[normalized] ?? value;
}

export function sportmonksStatisticsToApiFixtureStats(
  fixture: NormalizedSportmonksFixture,
): ApiFixtureStat[] {
  const sides = getSportmonksFixtureSides(fixture);
  const byParticipant = new Map<number, ApiFixtureStat>();
  for (const side of [sides.home, sides.away]) {
    if (!side?.id) continue;
    byParticipant.set(side.id, {
      team: { id: side.id, name: side.name, logo: side.logo },
      statistics: [],
    });
  }

  for (const statistic of fixture.statistics) {
    const row = recordOf(statistic);
    if (!row) continue;
    const participantId = numberOrNull(row.participant_id);
    if (!participantId || !byParticipant.has(participantId)) continue;
    const type = translateStatType(statTypeName(row));
    if (!type) continue;
    byParticipant.get(participantId)!.statistics.push({
      type,
      value: statValue(row),
    });
  }

  return [sides.home?.id, sides.away?.id]
    .map((id) => (id ? byParticipant.get(id) : null))
    .filter((row): row is ApiFixtureStat => row != null);
}

function eventType(row: Record<string, unknown>): string {
  const typeName = normalizeName(recordOf(row.type)?.name ?? row.type ?? row.type_id);
  const typeId = Number(row.type_id);
  if (typeName.includes('goal') || typeId === 14 || typeId === 16) return 'Goal';
  if (typeName.includes('card') || typeId === 19 || typeId === 20 || typeId === 21) return 'Card';
  if (typeName.includes('substitution') || typeName.includes('subst') || typeId === 18) return 'subst';
  return stringOrNull(recordOf(row.type)?.name) ?? stringOrNull(row.type) ?? String(row.type_id ?? '');
}

function eventDetail(row: Record<string, unknown>, type: string): string {
  const addition = stringOrNull(row.addition);
  const info = stringOrNull(row.info);
  if (type === 'Card' && addition) return addition;
  if (type === 'Goal' && addition) return addition;
  if (type === 'subst') return 'Substitution';
  return info ?? addition ?? '';
}

export function sportmonksEventsToApiFixtureEvents(
  fixture: NormalizedSportmonksFixture,
): ApiFixtureEvent[] {
  const sides = getSportmonksFixtureSides(fixture);
  const teamByParticipant = new Map<number, SportmonksParticipantSide>();
  for (const side of [sides.home, sides.away]) {
    if (side?.id) teamByParticipant.set(side.id, side);
  }

  return fixture.events
    .map((event): ApiFixtureEvent | null => {
      const row = recordOf(event);
      if (!row) return null;
      const participantId = numberOrNull(row.participant_id);
      const team = participantId ? teamByParticipant.get(participantId) : null;
      const type = eventType(row);
      return {
        time: {
          elapsed: numberOrNull(row.minute) ?? 0,
          extra: numberOrNull(row.extra_minute),
        },
        team: {
          id: team?.id ?? participantId ?? 0,
          name: team?.name ?? '',
          logo: team?.logo ?? '',
        },
        player: {
          id: numberOrNull(row.player_id),
          name: stringOrNull(row.player_name),
        },
        assist: {
          id: numberOrNull(row.related_player_id),
          name: stringOrNull(row.related_player_name),
        },
        type,
        detail: eventDetail(row, type),
        comments: stringOrNull(row.info),
      };
    })
    .filter((event): event is ApiFixtureEvent => event != null);
}

export function summarizeSportmonksCoverage(
  fixture: NormalizedSportmonksFixture | null,
): SportmonksCoverageFlags {
  return {
    has_fixture: fixture != null && fixture.providerFixtureId !== '',
    has_participants: (fixture?.participants.length ?? 0) > 0,
    has_scores: (fixture?.scores.length ?? 0) > 0,
    has_events: (fixture?.events.length ?? 0) > 0,
    has_statistics: (fixture?.statistics.length ?? 0) > 0,
    has_periods: (fixture?.periods.length ?? 0) > 0,
    has_inplay_odds: (fixture?.inplayOdds.length ?? 0) > 0,
    provider_has_odds_flag: fixture?.hasOdds === true,
    provider_has_premium_odds_flag: fixture?.hasPremiumOdds === true,
    participant_count: fixture?.participants.length ?? 0,
    score_count: fixture?.scores.length ?? 0,
    event_count: fixture?.events.length ?? 0,
    statistic_count: fixture?.statistics.length ?? 0,
    period_count: fixture?.periods.length ?? 0,
    inplay_odds_count: fixture?.inplayOdds.length ?? 0,
  };
}
