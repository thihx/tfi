export interface EspnStatPair {
  home: number | null;
  away: number | null;
}

export interface EspnStatsCompact {
  possession: EspnStatPair;
  shots: EspnStatPair;
  shots_on_target: EspnStatPair;
  corners: EspnStatPair;
  fouls: EspnStatPair;
  yellow_cards: EspnStatPair;
  red_cards: EspnStatPair;
}

export interface EspnEventCompact {
  minute: number | null;
  team: 'home' | 'away' | 'unknown';
  type: 'goal' | 'yellow_card' | 'red_card' | 'subst' | 'other';
  detail: string;
  player: string;
}

export interface EspnExtractedMatchData {
  eventId: string;
  leagueSlug: string;
  urls: {
    summary: string;
    stats: string;
  };
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
  stats: EspnStatsCompact;
  events: EspnEventCompact[];
  raw: {
    scoreboard: unknown;
    summary: unknown;
    statsHtml: string | null;
  };
}

export interface EspnExtractRequest {
  homeTeam: string;
  awayTeam: string;
  league?: string;
  matchDate?: string | null;
  status?: string;
  score?: {
    home: number | null;
    away: number | null;
  } | null;
  includeStats?: boolean;
  includeEvents?: boolean;
}

interface EspnScoreboardEventRef {
  eventId: string;
  leagueSlug: string;
  summaryUrl: string;
  statsUrl: string;
  name: string;
  competition: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
  score: {
    home: number | null;
    away: number | null;
  };
}

const ESPN_SITE_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const ESPN_TEAM_SUFFIXES = /\b(fc|sc|cf|afc|ac|as|us|ss|cd|rcd|rc|ca|se|fk|bk|if|sk|gf|hd)\b/gi;
const ESPN_TEAM_ALIAS_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\butd\b/g, 'united'],
  [/\bst\b/g, 'saint'],
  [/\bjef united ichihara chiba\b/g, 'jef united chiba'],
  [/\bgimcheon sangmu\b/g, 'gimcheon sangmu'],
  [/\bsangju sangmu\b/g, 'gimcheon sangmu'],
];

function cleanText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function emptyStats(): EspnStatsCompact {
  const pair = (): EspnStatPair => ({ home: null, away: null });
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

function normalizeText(value: string): string {
  let normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  for (const [pattern, replacement] of ESPN_TEAM_ALIAS_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(ESPN_TEAM_SUFFIXES, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLeagueText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function tokenOverlapRatio(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= la; i++) matrix[i] = [i];
  for (let j = 0; j <= lb; j++) matrix[0]![j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  return 1 - matrix[la]![lb]! / Math.max(la, lb);
}

function similarity(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const containsScore =
    (normA.length >= 5 && normB.includes(normA)) || (normB.length >= 5 && normA.includes(normB))
      ? 0.92
      : 0;

  return Math.max(containsScore, tokenOverlapRatio(normA, normB), levenshteinRatio(normA, normB));
}

function normalizeStatus(value: string): string {
  const normalized = value.toUpperCase();
  if (normalized.includes('FULL') || normalized === 'FT') return 'FT';
  if (normalized.includes('HALF') || normalized === 'HT') return 'HT';
  if (normalized.includes('SECOND HALF') || normalized === 'SH') return '2H';
  if (normalized.includes('FIRST HALF') || normalized === 'FH') return '1H';
  if (normalized.includes('NOT START') || normalized === 'NS') return 'NS';
  return normalized;
}

function parseMinuteFromStatus(detail: string | undefined): number | null {
  const match = cleanText(detail).match(/(\d+)(?:\+\d+)?'?/);
  return match?.[1] ? Number(match[1]) : null;
}

function buildDirectUrls(eventId: string): { summary: string; stats: string } {
  return {
    summary: `https://www.espn.com/soccer/match/_/gameId/${eventId}`,
    stats: `https://www.espn.com/soccer/matchstats/_/gameId/${eventId}`,
  };
}

function buildScoreboardDates(matchDate?: string | null): string[] {
  const cleaned = cleanText(matchDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return [new Date().toISOString().slice(0, 10).replace(/-/g, '')];
  }

  const base = new Date(`${cleaned}T00:00:00Z`);
  const dates = new Set<string>();
  for (const delta of [0, -1, 1]) {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + delta);
    dates.add(date.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return Array.from(dates);
}

export function resolveEspnLeagueSlugs(leagueName?: string): string[] {
  const normalized = normalizeLeagueText(cleanText(leagueName));
  if (!normalized) return [];

  const candidates: string[] = [];
  if (/\bjapan\b/.test(normalized) || /\bj league\b/.test(normalized) || /\bj1\b/.test(normalized)) {
    candidates.push('jpn.1');
  }
  if (/\bchina\b/.test(normalized) || /\bchinese super league\b/.test(normalized) || /\bcsl\b/.test(normalized)) {
    candidates.push('chn.1');
  }
  if (/\bsaudi\b/.test(normalized) || /\bsaudi pro league\b/.test(normalized)) {
    candidates.push('ksa.1');
  }
  if (/\bafc champions\b/.test(normalized) || /\bafc champions league elite\b/.test(normalized)) {
    candidates.push('afc.champions');
  }
  if (/\ba league\b/.test(normalized) || /\baustralian a league\b/.test(normalized)) {
    candidates.push('aus.1');
  }
  if (/\bthai league\b/.test(normalized)) {
    candidates.push('tha.1');
  }
  if (/\bindonesian super league\b/.test(normalized) || /\bliga 1\b/.test(normalized)) {
    candidates.push('idn.1');
  }

  return Array.from(new Set(candidates));
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ESPN ${response.status}: ${text.slice(0, 300)}`);
  }
  return await response.json() as Record<string, unknown>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ESPN ${response.status}: ${text.slice(0, 300)}`);
  }
  return await response.text();
}

function extractCompetitorName(event: Record<string, unknown>, side: 'home' | 'away'): string {
  const competitions = Array.isArray(event.competitions) ? event.competitions as Array<Record<string, unknown>> : [];
  const competitors = Array.isArray(competitions[0]?.competitors)
    ? competitions[0]?.competitors as Array<Record<string, unknown>>
    : [];
  const competitor = competitors.find((entry) => cleanText(entry.homeAway).toLowerCase() === side);
  const team = typeof competitor?.team === 'object' && competitor.team ? competitor.team as Record<string, unknown> : {};
  return cleanText(team.displayName || team.shortDisplayName || team.name || team.location);
}

function extractCompetitionName(event: Record<string, unknown>): string {
  const leagues = Array.isArray(event.leagues) ? event.leagues as Array<Record<string, unknown>> : [];
  if (leagues[0]) return cleanText(leagues[0].name || leagues[0].abbreviation || leagues[0].slug);
  const competitions = Array.isArray(event.competitions) ? event.competitions as Array<Record<string, unknown>> : [];
  const group = typeof competitions[0]?.groups === 'object' && competitions[0]?.groups ? competitions[0].groups as Record<string, unknown> : {};
  return cleanText(group.name || group.abbreviation);
}

function extractScoreFromEvent(event: Record<string, unknown>): { home: number | null; away: number | null } {
  const competitions = Array.isArray(event.competitions) ? event.competitions as Array<Record<string, unknown>> : [];
  const competitors = Array.isArray(competitions[0]?.competitors)
    ? competitions[0]?.competitors as Array<Record<string, unknown>>
    : [];
  const home = competitors.find((entry) => cleanText(entry.homeAway).toLowerCase() === 'home');
  const away = competitors.find((entry) => cleanText(entry.homeAway).toLowerCase() === 'away');
  return {
    home: toNumber(home?.score),
    away: toNumber(away?.score),
  };
}

function scoreEventCandidate(request: EspnExtractRequest, event: Record<string, unknown>, leagueSlug: string): number {
  const homeTeam = extractCompetitorName(event, 'home');
  const awayTeam = extractCompetitorName(event, 'away');
  if (!homeTeam || !awayTeam) return 0;

  let score = 0;
  score += similarity(request.homeTeam, homeTeam) * 0.5;
  score += similarity(request.awayTeam, awayTeam) * 0.5;

  const providerScore = extractScoreFromEvent(event);
  if (
    request.score?.home != null &&
    request.score?.away != null &&
    providerScore.home === request.score.home &&
    providerScore.away === request.score.away
  ) {
    score += 0.08;
  }

  const status = typeof event.status === 'object' && event.status ? event.status as Record<string, unknown> : {};
  const statusType = typeof status.type === 'object' && status.type ? status.type as Record<string, unknown> : {};
  const requestStatus = normalizeStatus(cleanText(request.status));
  const providerStatus = normalizeStatus(cleanText(statusType.shortDetail || statusType.detail || statusType.description || statusType.name));
  if (requestStatus && providerStatus && requestStatus === providerStatus) {
    score += 0.04;
  }

  if (resolveEspnLeagueSlugs(request.league).includes(leagueSlug)) {
    score += 0.04;
  }

  return Math.min(score, 1);
}

async function resolveEventReference(request: EspnExtractRequest): Promise<EspnScoreboardEventRef | null> {
  const leagueSlugs = resolveEspnLeagueSlugs(request.league);
  if (leagueSlugs.length === 0) return null;

  const dates = buildScoreboardDates(request.matchDate);
  let bestRef: EspnScoreboardEventRef | null = null;
  let bestScore = 0;

  for (const leagueSlug of leagueSlugs) {
    for (const date of dates) {
      let payload: Record<string, unknown>;
      try {
        payload = await fetchJson(`${ESPN_SITE_API_BASE}/${leagueSlug}/scoreboard?dates=${date}`);
      } catch {
        continue;
      }

      const events = Array.isArray(payload.events) ? payload.events as Array<Record<string, unknown>> : [];
      for (const event of events) {
        const score = scoreEventCandidate(request, event, leagueSlug);
        if (score < 0.82) continue;
        const eventId = cleanText(event.id);
        if (!eventId) continue;
        const directUrls = buildDirectUrls(eventId);
        const homeTeam = extractCompetitorName(event, 'home');
        const awayTeam = extractCompetitorName(event, 'away');
        const candidate: EspnScoreboardEventRef = {
          eventId,
          leagueSlug,
          summaryUrl: directUrls.summary,
          statsUrl: directUrls.stats,
          name: cleanText(event.name),
          competition: extractCompetitionName(event),
          status: cleanText(
            (typeof event.status === 'object' && event.status
              ? (event.status as Record<string, unknown>).type as Record<string, unknown>
              : null)?.shortDetail || '',
          ),
          homeTeam,
          awayTeam,
          score: extractScoreFromEvent(event),
        };
        if (!bestRef || score > bestScore) {
          bestRef = candidate;
          bestScore = score;
        }
      }

      if (bestRef && bestScore >= 0.97) {
        return bestRef;
      }
    }
  }

  return bestRef;
}

function extractSummaryEvents(summary: Record<string, unknown>, homeName: string, awayName: string): EspnEventCompact[] {
  const competitions = Array.isArray((summary.header as Record<string, unknown> | undefined)?.competitions)
    ? (summary.header as Record<string, unknown>).competitions as Array<Record<string, unknown>>
    : [];
  const details = Array.isArray(competitions[0]?.details)
    ? competitions[0]?.details as Array<Record<string, unknown>>
    : [];

  return details.map((detail) => {
    const team = typeof detail.team === 'object' && detail.team ? detail.team as Record<string, unknown> : {};
    const participants = Array.isArray(detail.participants) ? detail.participants as Array<Record<string, unknown>> : [];
    const athlete = typeof participants[0]?.athlete === 'object' && participants[0].athlete
      ? participants[0].athlete as Record<string, unknown>
      : {};
    const teamName = cleanText(team.displayName || team.name || team.location);
    const side: EspnEventCompact['team'] = similarity(teamName, homeName) >= 0.9
      ? 'home'
      : similarity(teamName, awayName) >= 0.9
        ? 'away'
        : 'unknown';

    let type: EspnEventCompact['type'] = 'other';
    let detailText = 'Match event';
    if (detail.scoringPlay === true) {
      type = 'goal';
      if (detail.penaltyKick === true) detailText = 'Penalty Goal';
      else if (detail.ownGoal === true) detailText = 'Own Goal';
      else detailText = 'Goal';
    } else if (detail.redCard === true) {
      type = 'red_card';
      detailText = 'Red Card';
    } else if (String(detail.yellowCard).toLowerCase() === 'true') {
      type = 'yellow_card';
      detailText = 'Yellow Card';
    } else if (detail.substitution === true) {
      type = 'subst';
      detailText = 'Substitution';
    }

    const clockDisplay = cleanText(
      (typeof detail.clock === 'object' && detail.clock
        ? (detail.clock as Record<string, unknown>).displayValue
        : '') || '',
    );

    const minuteMatch = clockDisplay.match(/^(\d+)/);
    return {
      minute: minuteMatch?.[1] ? Number(minuteMatch[1]) : toNumber(detail.minute),
      team: side,
      type,
      detail: detailText,
      player: cleanText(athlete.displayName || athlete.shortName),
    };
  }).filter((event) => event.type !== 'other' || event.player || event.minute != null);
}

function parseEspnStatValue(raw: string | undefined): number | null {
  const cleaned = cleanText(raw).replace(/%/g, '');
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match?.[0] ? Number(match[0]) : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractEspnStatPair(sectionHtml: string, label: string): EspnStatPair {
  const pattern = new RegExp(
    `>${escapeRegex(label)}<\\/span>[\\s\\S]{0,5000}?<span[^>]*>(-?\\d+(?:\\.\\d+)?)(?:<span[^>]*>[^<]*<\\/span>)?<\\/span>[\\s\\S]{0,5000}?<span[^>]*>(-?\\d+(?:\\.\\d+)?)(?:<span[^>]*>[^<]*<\\/span>)?<\\/span>`,
    'i',
  );
  const match = sectionHtml.match(pattern);
  if (!match) return { home: null, away: null };
  return {
    home: parseEspnStatValue(match[1]),
    away: parseEspnStatValue(match[2]),
  };
}

export function parseEspnMatchStatsHtml(html: string): EspnStatsCompact {
  const stats = emptyStats();
  const idx = html.indexOf('Match Stats');
  const section = idx >= 0 ? html.slice(idx, idx + 120_000) : html;

  stats.possession = extractEspnStatPair(section, 'Possession');
  stats.shots_on_target = extractEspnStatPair(section, 'Shots on Goal');
  stats.shots = extractEspnStatPair(section, 'Shot Attempts');
  stats.corners = extractEspnStatPair(section, 'Corner Kicks');
  stats.fouls = extractEspnStatPair(section, 'Fouls');
  stats.yellow_cards = extractEspnStatPair(section, 'Yellow Cards');
  stats.red_cards = extractEspnStatPair(section, 'Red Cards');

  return stats;
}

export async function fetchEspnSoccerMatchData(request: EspnExtractRequest): Promise<EspnExtractedMatchData | null> {
  const eventRef = await resolveEventReference(request);
  if (!eventRef) return null;

  const summary = await fetchJson(`${ESPN_SITE_API_BASE}/all/summary?event=${encodeURIComponent(eventRef.eventId)}`);
  const competitions = Array.isArray((summary.header as Record<string, unknown> | undefined)?.competitions)
    ? (summary.header as Record<string, unknown>).competitions as Array<Record<string, unknown>>
    : [];
  const competition = competitions[0] || {};
  const competitors = Array.isArray(competition.competitors) ? competition.competitors as Array<Record<string, unknown>> : [];
  const home = competitors.find((entry) => cleanText(entry.homeAway).toLowerCase() === 'home');
  const away = competitors.find((entry) => cleanText(entry.homeAway).toLowerCase() === 'away');
  const homeTeam = cleanText(
    ((home?.team as Record<string, unknown> | undefined)?.displayName)
    || ((home?.team as Record<string, unknown> | undefined)?.name)
    || eventRef.homeTeam,
  );
  const awayTeam = cleanText(
    ((away?.team as Record<string, unknown> | undefined)?.displayName)
    || ((away?.team as Record<string, unknown> | undefined)?.name)
    || eventRef.awayTeam,
  );

  const statusType = typeof competition.status === 'object' && competition.status ? competition.status as Record<string, unknown> : {};
  const typeObj = typeof statusType.type === 'object' && statusType.type ? statusType.type as Record<string, unknown> : {};
  const shortDetail = cleanText(typeObj.shortDetail || typeObj.detail || typeObj.description || typeObj.name);

  const statsHtml = request.includeStats !== false
    ? await fetchText(eventRef.statsUrl)
    : null;

  return {
    eventId: eventRef.eventId,
    leagueSlug: eventRef.leagueSlug,
    urls: {
      summary: eventRef.summaryUrl,
      stats: eventRef.statsUrl,
    },
    match: {
      homeTeam,
      awayTeam,
      competition: cleanText(
        request.league
        || eventRef.competition
        || (competition.groups as Record<string, unknown> | undefined)?.name
        || '',
      ),
      status: normalizeStatus(shortDetail || eventRef.status || cleanText(request.status)),
      minute: parseMinuteFromStatus(shortDetail),
      score: {
        home: toNumber(home?.score ?? eventRef.score.home),
        away: toNumber(away?.score ?? eventRef.score.away),
      },
    },
    stats: statsHtml ? parseEspnMatchStatsHtml(statsHtml) : emptyStats(),
    events: request.includeEvents === false ? [] : extractSummaryEvents(summary, homeTeam, awayTeam),
    raw: {
      scoreboard: eventRef,
      summary,
      statsHtml,
    },
  };
}
