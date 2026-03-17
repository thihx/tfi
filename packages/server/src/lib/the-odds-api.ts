// ============================================================
// The Odds API Client — fallback odds provider
// https://the-odds-api.com/liveapi/guides/v4/
// ============================================================

import { config } from '../config.js';

const API_TIMEOUT_MS = 10_000;

// ==================== Types ====================

export interface TheOddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string; // ISO-8601
  home_team: string;
  away_team: string;
  bookmakers: TheOddsBookmaker[];
}

interface TheOddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: TheOddsMarket[];
}

interface TheOddsMarket {
  key: string; // h2h, spreads, totals
  last_update: string;
  outcomes: TheOddsOutcome[];
}

interface TheOddsOutcome {
  name: string;
  price: number; // decimal odds
  point?: number; // line for spreads/totals
}

// ==================== Team Name Matching ====================

const TEAM_NOISE = /\b(fc|sc|cf|afc|ac|as|us|ss|cd|rcd|rc|ca|se|fk|bk|if|sk|gf|bfc|1\.|united|city|town|wanderers|rovers|albion|athletic|hotspur|wednesday|argyle|olympique|sporting|real|inter|dynamo|lokomotiv|zenit)\b/gi;

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(TEAM_NOISE, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= la; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lb; j++) {
    matrix[0]![j] = j;
  }
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

/**
 * Match an API-Sports fixture to a The Odds API event using team names + kickoff time.
 */
export function findMatchingEvent(
  events: TheOddsEvent[],
  homeTeam: string,
  awayTeam: string,
  kickoffTimestamp?: number,
): TheOddsEvent | null {
  const normHome = normalizeTeamName(homeTeam);
  const normAway = normalizeTeamName(awayTeam);

  let bestMatch: TheOddsEvent | null = null;
  let bestScore = 0;

  for (const ev of events) {
    const evHome = normalizeTeamName(ev.home_team);
    const evAway = normalizeTeamName(ev.away_team);

    const homeScore = Math.max(
      levenshteinRatio(normHome, evHome),
      // Also try checking if one contains the other
      evHome.includes(normHome) || normHome.includes(evHome) ? 0.85 : 0,
    );
    const awayScore = Math.max(
      levenshteinRatio(normAway, evAway),
      evAway.includes(normAway) || normAway.includes(evAway) ? 0.85 : 0,
    );

    // Both teams must match reasonably
    if (homeScore < 0.6 || awayScore < 0.6) continue;

    let combinedScore = (homeScore + awayScore) / 2;

    // Time proximity bonus/penalty
    if (kickoffTimestamp) {
      const evTime = new Date(ev.commence_time).getTime() / 1000;
      const timeDiffHours = Math.abs(evTime - kickoffTimestamp) / 3600;
      if (timeDiffHours > 6) continue; // Too far apart
      if (timeDiffHours <= 0.5) combinedScore += 0.05; // Very close = bonus
    }

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestMatch = ev;
    }
  }

  // Require minimum confidence
  return bestScore >= 0.7 ? bestMatch : null;
}

// ==================== Convert to API-Sports Format ====================

/**
 * Convert The Odds API event to API-Sports bookmaker format
 * so it plugs directly into existing mergeOddsToMatch pipeline.
 */
export function convertToApiSportsFormat(
  event: TheOddsEvent,
  fixtureId: number,
): { fixture: { id: number }; bookmakers: Array<{ id: number; name: string; bets: Array<{ id: number; name: string; values: Array<{ value: string; odd: string; handicap?: string }> }> }> } {
  const bookmakers = event.bookmakers.map((bk, idx) => {
    const bets: Array<{ id: number; name: string; values: Array<{ value: string; odd: string; handicap?: string }> }> = [];

    for (const market of bk.markets) {
      if (market.key === 'h2h') {
        // Match Winner / 1X2
        const values = market.outcomes.map((o) => {
          let value = o.name;
          if (o.name === event.home_team) value = 'Home';
          else if (o.name === event.away_team) value = 'Away';
          else if (o.name === 'Draw') value = 'Draw';
          return { value, odd: String(o.price) };
        });
        bets.push({ id: 1, name: 'Match Winner', values });
      }

      if (market.key === 'totals') {
        // Over/Under
        const values = market.outcomes.map((o) => ({
          value: o.name, // "Over" or "Under"
          odd: String(o.price),
          handicap: o.point != null ? String(o.point) : undefined,
        }));
        bets.push({ id: 2, name: 'Over/Under', values });
      }

      if (market.key === 'spreads') {
        // Asian Handicap
        const values = market.outcomes.map((o) => {
          let value = o.name;
          if (o.name === event.home_team) value = 'Home';
          else if (o.name === event.away_team) value = 'Away';
          return {
            value,
            odd: String(o.price),
            handicap: o.point != null ? String(o.point) : undefined,
          };
        });
        bets.push({ id: 3, name: 'Asian Handicap', values });
      }
    }

    return { id: idx + 100, name: bk.title, bets };
  });

  return { fixture: { id: fixtureId }, bookmakers };
}

// ==================== API Calls ====================

/**
 * Fetch live/upcoming odds for soccer from The Odds API.
 * Uses sport 'soccer' with all available sub-sports.
 */
export async function fetchTheOddsLive(
  homeTeam: string,
  awayTeam: string,
  fixtureId: number,
  kickoffTimestamp?: number,
): Promise<{ fixture: { id: number }; bookmakers: unknown[] } | null> {
  if (!config.theOddsApiKey) return null;

  // Fetch odds for multiple soccer leagues at once
  const sportKeys = [
    'soccer_epl', 'soccer_spain_la_liga', 'soccer_italy_serie_a',
    'soccer_germany_bundesliga', 'soccer_france_ligue_one',
    'soccer_uefa_champs_league', 'soccer_uefa_europa_league',
    'soccer_turkey_super_league', 'soccer_portugal_primeira_liga',
    'soccer_netherlands_eredivisie', 'soccer_belgium_first_div',
    'soccer_brazil_serie_a', 'soccer_mexico_ligamx',
    'soccer_korea_kleague1', 'soccer_japan_j_league',
    'soccer_australia_aleague', 'soccer_usa_mls',
    'soccer_russia_premier_league', 'soccer_china_superleague',
    'soccer_saudi_professional_league',
  ];

  for (const sportKey of sportKeys) {
    try {
      const events = await fetchOddsForSport(sportKey);
      const match = findMatchingEvent(events, homeTeam, awayTeam, kickoffTimestamp);
      if (match && match.bookmakers.length > 0) {
        console.log(`[the-odds-api] Matched "${homeTeam} vs ${awayTeam}" → "${match.home_team} vs ${match.away_team}" (${sportKey})`);
        return convertToApiSportsFormat(match, fixtureId);
      }
    } catch {
      // This sport key failed or doesn't exist, try next
    }
  }

  return null;
}

async function fetchOddsForSport(sportKey: string): Promise<TheOddsEvent[]> {
  const url = new URL(`${config.theOddsApiBaseUrl}/sports/${sportKey}/odds`);
  url.searchParams.set('apiKey', config.theOddsApiKey);
  url.searchParams.set('regions', 'eu,uk');
  url.searchParams.set('markets', 'h2h,totals,spreads');
  url.searchParams.set('oddsFormat', 'decimal');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      if (res.status === 401) throw new Error('THE_ODDS_API_KEY invalid');
      if (res.status === 429) throw new Error('The Odds API rate limited');
      throw new Error(`The Odds API ${res.status}`);
    }

    return await res.json() as TheOddsEvent[];
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
