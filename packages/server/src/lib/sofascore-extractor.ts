export interface SofascoreTwoSideStat {
  home: number | null;
  away: number | null;
}

export interface SofascoreStatsCompact {
  possession: SofascoreTwoSideStat;
  shots: SofascoreTwoSideStat;
  shots_on_target: SofascoreTwoSideStat;
  corners: SofascoreTwoSideStat;
  fouls: SofascoreTwoSideStat;
  yellow_cards: SofascoreTwoSideStat;
  red_cards: SofascoreTwoSideStat;
}

export interface SofascoreEventCompact {
  minute: number | null;
  team: 'home' | 'away' | 'unknown';
  type: 'goal' | 'yellow_card' | 'red_card' | 'subst' | 'other';
  detail: string;
  player: string;
}

export interface SofascoreExtractedMatchData {
  pageUrl: string;
  eventId: string;
  finalUrl: string;
  match: {
    homeTeam: string;
    awayTeam: string;
    competition: string;
    status: string;
    minute: number | null;
    score: {
      home: number | null;
      away: number | null;
    };
  };
  stats: SofascoreStatsCompact;
  events: SofascoreEventCompact[];
  raw: {
    event: unknown;
    incidents: unknown;
    statistics: unknown;
  };
}

export interface SofascoreSearchTeam {
  id: number;
  name: string;
  slug: string;
  national: boolean;
  gender: string;
  sport: {
    id: number;
    slug: string;
    name: string;
  } | null;
  country: {
    alpha2: string;
    name: string;
    slug: string;
  } | null;
}

export interface SofascoreTeamEventSummary {
  id: number;
  slug: string;
  customId: string;
  startTimestamp: number | null;
  tournament: {
    name: string;
    uniqueTournamentName: string;
  };
  status: {
    type: string;
    description: string;
  };
  homeTeam: {
    id: number | null;
    name: string;
  };
  awayTeam: {
    id: number | null;
    name: string;
  };
  homeScore: {
    current: number | null;
  };
  awayScore: {
    current: number | null;
  };
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parsePercentLike(value: unknown): number | null {
  if (typeof value === 'string') {
    const cleaned = value.replace('%', '').trim();
    return toNumber(cleaned);
  }
  return toNumber(value);
}

function emptyStats(): SofascoreStatsCompact {
  const pair = (): SofascoreTwoSideStat => ({ home: null, away: null });
  return {
    possession: pair(),
    shots: pair(),
    shots_on_target: pair(),
    corners: pair(),
    fouls: pair(),
    yellow_cards: pair(),
    red_cards: pair(),
  };
}

export function extractSofascoreEventIdFromHtml(html: string): string | null {
  const nextData = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (nextData?.[1]) {
    try {
      const parsed = JSON.parse(nextData[1]);
      const eventId = parsed?.props?.pageProps?.initialProps?.event?.id;
      if (eventId != null) return String(eventId);
    } catch {
      // ignore and fall back to regex
    }
  }

  const direct = html.match(/https:\/\/img\.sofascore\.com\/api\/v1\/event\/(\d+)\/share-image/i);
  if (direct?.[1]) return direct[1];

  const alternate = html.match(/https\/www\.sofascore\.com\/event\/(\d+)/i);
  if (alternate?.[1]) return alternate[1];

  return null;
}

export function parseSofascoreStatisticsPayload(payload: unknown): SofascoreStatsCompact {
  const stats = emptyStats();
  const root = typeof payload === 'object' && payload ? payload as Record<string, unknown> : {};
  const periods = Array.isArray(root.statistics) ? root.statistics as Array<Record<string, unknown>> : [];
  const allPeriod = periods.find((period) => String(period.period || '').toUpperCase() === 'ALL') || periods[0];
  const groups = Array.isArray(allPeriod?.groups) ? allPeriod.groups as Array<Record<string, unknown>> : [];

  const items = groups
    .flatMap((group) => Array.isArray(group.statisticsItems) ? group.statisticsItems as Array<Record<string, unknown>> : []);

  for (const item of items) {
    const key = String(item.key || '');
    const name = String(item.name || '').toLowerCase();
    const pair: SofascoreTwoSideStat = {
      home: parsePercentLike(item.homeValue ?? item.home),
      away: parsePercentLike(item.awayValue ?? item.away),
    };

    if (key === 'ballPossession' || name === 'ball possession') stats.possession = pair;
    else if (key === 'totalShotsOnGoal' || name === 'total shots') stats.shots = pair;
    else if (key === 'shotsOnTarget' || name === 'shots on target') stats.shots_on_target = pair;
    else if (key === 'cornerKicks' || name === 'corner kicks') stats.corners = pair;
    else if (key === 'fouls' || name === 'fouls') stats.fouls = pair;
    else if (key === 'yellowCards' || name === 'yellow cards') stats.yellow_cards = pair;
    else if (key === 'redCards' || name === 'red cards') stats.red_cards = pair;
  }

  return stats;
}

export function parseSofascoreIncidentsPayload(payload: unknown): SofascoreEventCompact[] {
  const root = typeof payload === 'object' && payload ? payload as Record<string, unknown> : {};
  const incidents = Array.isArray(root.incidents) ? root.incidents as Array<Record<string, unknown>> : [];
  const output: SofascoreEventCompact[] = [];

  for (const incident of incidents) {
    const type = String(incident.incidentType || '');
    const teamSide = String(incident.isHome ? 'home' : incident.isHome === false ? 'away' : 'unknown') as 'home' | 'away' | 'unknown';
    const minute = toNumber(incident.time);
    const player = String(
      (incident.player as Record<string, unknown> | undefined)?.name
      || (incident.scoringPlayer as Record<string, unknown> | undefined)?.name
      || (incident.playerIn as Record<string, unknown> | undefined)?.name
      || '',
    );

    if (type === 'goal') {
      output.push({
        minute,
        team: teamSide,
        type: 'goal',
        detail: String(incident.reason || incident.text || 'goal'),
        player,
      });
      continue;
    }

    if (type === 'card') {
      const incidentClass = String(incident.incidentClass || '').toLowerCase();
      output.push({
        minute,
        team: teamSide,
        type: incidentClass.includes('red') ? 'red_card' : 'yellow_card',
        detail: String(incident.incidentClass || incident.text || 'card'),
        player,
      });
      continue;
    }

    if (type === 'substitution') {
      output.push({
        minute,
        team: teamSide,
        type: 'subst',
        detail: `${String((incident.playerIn as Record<string, unknown> | undefined)?.name || '')} for ${String((incident.playerOut as Record<string, unknown> | undefined)?.name || '')}`.trim(),
        player: String((incident.playerIn as Record<string, unknown> | undefined)?.name || ''),
      });
      continue;
    }
  }

  return output;
}

async function fetchJson(url: string, options?: { allowNotFound?: boolean }): Promise<unknown | null> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
    redirect: 'follow',
  });
  if (response.status === 404 && options?.allowNotFound) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Sofascore ${response.status}: ${text.slice(0, 300)}`);
  }
  return await response.json();
}

function normalizeSearchTeam(input: unknown): SofascoreSearchTeam | null {
  const team = typeof input === 'object' && input ? input as Record<string, unknown> : {};
  const sport = typeof team.sport === 'object' && team.sport ? team.sport as Record<string, unknown> : {};
  const country = typeof team.country === 'object' && team.country ? team.country as Record<string, unknown> : {};
  const id = toNumber(team.id);
  if (id == null) return null;
  return {
    id,
    name: String(team.name || ''),
    slug: String(team.slug || ''),
    national: Boolean(team.national),
    gender: String(team.gender || ''),
    sport: sport && Object.keys(sport).length > 0 ? {
      id: toNumber(sport.id) || 0,
      slug: String(sport.slug || ''),
      name: String(sport.name || ''),
    } : null,
    country: country && Object.keys(country).length > 0 ? {
      alpha2: String(country.alpha2 || ''),
      name: String(country.name || ''),
      slug: String(country.slug || ''),
    } : null,
  };
}

function normalizeTeamEvent(input: unknown): SofascoreTeamEventSummary | null {
  const event = typeof input === 'object' && input ? input as Record<string, unknown> : {};
  const tournament = typeof event.tournament === 'object' && event.tournament ? event.tournament as Record<string, unknown> : {};
  const uniqueTournament = typeof tournament.uniqueTournament === 'object' && tournament.uniqueTournament
    ? tournament.uniqueTournament as Record<string, unknown>
    : {};
  const status = typeof event.status === 'object' && event.status ? event.status as Record<string, unknown> : {};
  const homeTeam = typeof event.homeTeam === 'object' && event.homeTeam ? event.homeTeam as Record<string, unknown> : {};
  const awayTeam = typeof event.awayTeam === 'object' && event.awayTeam ? event.awayTeam as Record<string, unknown> : {};
  const homeScore = typeof event.homeScore === 'object' && event.homeScore ? event.homeScore as Record<string, unknown> : {};
  const awayScore = typeof event.awayScore === 'object' && event.awayScore ? event.awayScore as Record<string, unknown> : {};
  const id = toNumber(event.id);
  if (id == null) return null;
  return {
    id,
    slug: String(event.slug || ''),
    customId: String(event.customId || ''),
    startTimestamp: toNumber(event.startTimestamp),
    tournament: {
      name: String(tournament.name || ''),
      uniqueTournamentName: String(uniqueTournament.name || tournament.name || ''),
    },
    status: {
      type: String(status.type || ''),
      description: String(status.description || ''),
    },
    homeTeam: {
      id: toNumber(homeTeam.id),
      name: String(homeTeam.name || ''),
    },
    awayTeam: {
      id: toNumber(awayTeam.id),
      name: String(awayTeam.name || ''),
    },
    homeScore: {
      current: toNumber(homeScore.current ?? homeScore.display ?? homeScore.normaltime),
    },
    awayScore: {
      current: toNumber(awayScore.current ?? awayScore.display ?? awayScore.normaltime),
    },
  };
}

export async function searchSofascoreTeams(query: string): Promise<SofascoreSearchTeam[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const payload = await fetchJson(
    `https://www.sofascore.com/api/v1/search/teams/${encodeURIComponent(normalized)}`,
    { allowNotFound: true },
  );
  const root = typeof payload === 'object' && payload ? payload as Record<string, unknown> : {};
  const teams = Array.isArray(root.teams) ? root.teams : [];
  return teams
    .map((team) => normalizeSearchTeam(team))
    .filter((team): team is SofascoreSearchTeam => Boolean(team))
    .filter((team) => team.sport?.slug === 'football');
}

export async function fetchSofascoreTeamEvents(teamId: number, bucket: 'last' | 'next'): Promise<SofascoreTeamEventSummary[]> {
  const payload = await fetchJson(
    `https://www.sofascore.com/api/v1/team/${teamId}/events/${bucket}/0`,
    { allowNotFound: true },
  );
  const root = typeof payload === 'object' && payload ? payload as Record<string, unknown> : {};
  const events = Array.isArray(root.events) ? root.events : [];
  return events
    .map((event) => normalizeTeamEvent(event))
    .filter((event): event is SofascoreTeamEventSummary => Boolean(event));
}

export function buildSofascoreMatchPageUrl(event: Pick<SofascoreTeamEventSummary, 'slug' | 'customId'>): string | null {
  const slug = String(event.slug || '').trim();
  const customId = String(event.customId || '').trim();
  if (!slug || !customId) return null;
  return `https://www.sofascore.com/football/match/${slug}/${customId}`;
}

export async function fetchSofascoreMatchDataFromEventId(
  eventId: string | number,
  options?: { pageUrl?: string | null },
): Promise<SofascoreExtractedMatchData> {
  const normalizedEventId = String(eventId).trim();
  if (!normalizedEventId) {
    throw new Error('SOFASCORE_EVENT_ID_REQUIRED');
  }

  const [eventPayload, incidentsPayload, statisticsPayload] = await Promise.all([
    fetchJson(`https://www.sofascore.com/api/v1/event/${normalizedEventId}`),
    fetchJson(`https://www.sofascore.com/api/v1/event/${normalizedEventId}/incidents`, { allowNotFound: true }),
    fetchJson(`https://www.sofascore.com/api/v1/event/${normalizedEventId}/statistics`, { allowNotFound: true }),
  ]);

  const eventRoot = typeof eventPayload === 'object' && eventPayload ? eventPayload as Record<string, unknown> : {};
  const event = typeof eventRoot.event === 'object' && eventRoot.event ? eventRoot.event as Record<string, unknown> : {};
  const homeTeam = typeof event.homeTeam === 'object' && event.homeTeam ? event.homeTeam as Record<string, unknown> : {};
  const awayTeam = typeof event.awayTeam === 'object' && event.awayTeam ? event.awayTeam as Record<string, unknown> : {};
  const tournament = typeof event.tournament === 'object' && event.tournament ? event.tournament as Record<string, unknown> : {};
  const status = typeof event.status === 'object' && event.status ? event.status as Record<string, unknown> : {};
  const homeScore = typeof event.homeScore === 'object' && event.homeScore ? event.homeScore as Record<string, unknown> : {};
  const awayScore = typeof event.awayScore === 'object' && event.awayScore ? event.awayScore as Record<string, unknown> : {};

  return {
    pageUrl: options?.pageUrl || `https://www.sofascore.com/api/v1/event/${normalizedEventId}`,
    eventId: normalizedEventId,
    finalUrl: options?.pageUrl || `https://www.sofascore.com/api/v1/event/${normalizedEventId}`,
    match: {
      homeTeam: String(homeTeam.name || ''),
      awayTeam: String(awayTeam.name || ''),
      competition: String(tournament.name || ''),
      status: String(status.description || status.type || ''),
      minute: null,
      score: {
        home: toNumber(homeScore.current ?? homeScore.display ?? homeScore.normaltime),
        away: toNumber(awayScore.current ?? awayScore.display ?? awayScore.normaltime),
      },
    },
    stats: parseSofascoreStatisticsPayload(statisticsPayload),
    events: parseSofascoreIncidentsPayload(incidentsPayload),
    raw: {
      event: eventPayload,
      incidents: incidentsPayload,
      statistics: statisticsPayload,
    },
  };
}

export async function fetchSofascoreMatchDataFromPageUrl(pageUrl: string): Promise<SofascoreExtractedMatchData> {
  const pageResponse = await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
  });
  if (!pageResponse.ok) {
    throw new Error(`Sofascore page ${pageResponse.status}`);
  }
  const html = await pageResponse.text();
  const eventId = extractSofascoreEventIdFromHtml(html);
  if (!eventId) {
    throw new Error('SOFASCORE_EVENT_ID_NOT_FOUND');
  }
  return fetchSofascoreMatchDataFromEventId(eventId, { pageUrl: pageResponse.url || pageUrl });
}
