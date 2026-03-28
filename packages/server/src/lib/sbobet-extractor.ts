// ============================================================
// SBOBET Live Odds Extractor
// Reverse-engineers SBOBET internal REST API (cookie-based session)
//
// SETUP:
//  1. Run `npm run sbobet:discover` once to capture endpoint URLs
//     (requires SBO_USERNAME + SBO_PASSWORD in .env)
//  2. Set SBO_BASE_URL, SBO_ENABLED=true in .env
//  3. The extractor maintains a session in-memory; auto re-logins on expiry
// ============================================================

import { config } from '../config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SbobetOddsLine {
  /** Over/Under line (remaining goals) */
  ouLine: number;
  overOdds: number;
  underOdds: number;
  /** Asian Handicap — home team handicap (negative = home favoured) */
  ahLine: number | null;
  ahHomeOdds: number | null;
  ahAwayOdds: number | null;
  /** 1x2 (if available) */
  homeWinOdds: number | null;
  drawOdds: number | null;
  awayWinOdds: number | null;
  fetchedAt: string;
  matchedAs: string; // which SBO team names we matched against
}

interface SbobetSession {
  cookie: string;
  expiresAt: number; // ms timestamp
}

// ── Session state (module-level, shared across requests) ──────────────────────

let _session: SbobetSession | null = null;
let _loginInFlight: Promise<string> | null = null;

// ── Raw SBO response shapes (filled in after endpoint discovery) ──────────────
// These match the JSON that SBOBET's internal API returns.
// Run the discovery script and update these interfaces if the shape differs.

interface SboLiveMatch {
  eventId: string | number;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  homeScore: number;
  awayScore: number;
  matchMinute: number;
  ouLine: number;           // e.g. 2.5 (remaining goals)
  overOdds: number;         // decimal, e.g. 1.90
  underOdds: number;
  ahLine: number | null;    // home handicap, e.g. -0.5
  ahHomeOdds: number | null;
  ahAwayOdds: number | null;
  homeOdds?: number | null; // 1x2 if available
  drawOdds?: number | null;
  awayOdds?: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(fc|sc|cf|afc|ac|as|us|fk|bk|if|sk|united|city|town|club)$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamSimilarity(a: string, b: string): number {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Token overlap
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

function findMatchInList(
  matches: SboLiveMatch[],
  homeTeam: string,
  awayTeam: string,
): SboLiveMatch | null {
  let best: SboLiveMatch | null = null;
  let bestScore = 0;

  for (const m of matches) {
    const homeScore = teamSimilarity(m.homeTeam, homeTeam);
    const awayScore = teamSimilarity(m.awayTeam, awayTeam);
    const score = homeScore * 0.5 + awayScore * 0.5;
    if (score > bestScore && homeScore >= 0.6 && awayScore >= 0.6) {
      bestScore = score;
      best = m;
    }
  }

  return best;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithSession(url: string, options: RequestInit = {}): Promise<Response> {
  const cookie = await getSession();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
        Cookie: cookie,
        ...options.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// ── Session / Login ───────────────────────────────────────────────────────────

async function login(): Promise<string> {
  const baseUrl = config.sbobetBaseUrl;
  if (!baseUrl) throw new Error('SBO_BASE_URL not configured');
  if (!config.sbobetUsername || !config.sbobetPassword) {
    throw new Error('SBO_USERNAME / SBO_PASSWORD not configured');
  }

  // POST to SBOBET login endpoint.
  // IMPORTANT: Run `npm run sbobet:discover` to confirm the exact login URL
  // and request body format for your SBO domain/agent.
  const loginUrl = `${baseUrl}${config.sbobetLoginPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(loginUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
      },
      body: JSON.stringify({
        username: config.sbobetUsername,
        password: config.sbobetPassword,
        // Some SBO agents also require: currencyCode, languageCode — check discovery
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SBO login failed ${res.status}: ${body.slice(0, 200)}`);
  }

  // Extract Set-Cookie headers
  const setCookie = res.headers.get('set-cookie') ?? '';
  const cookies = setCookie
    .split(',')
    .map((c) => (c.split(';')[0] ?? '').trim())
    .join('; ');

  if (!cookies) {
    // Some SBO implementations return token in body
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const token = body['token'] ?? body['sessionToken'] ?? body['accessToken'];
    if (token) return `token=${String(token)}`;
    throw new Error('SBO login: no session cookie or token in response');
  }

  return cookies;
}

async function getSession(): Promise<string> {
  if (_session && _session.expiresAt > Date.now() + 60_000) {
    return _session.cookie;
  }
  // Deduplicate concurrent login calls
  if (!_loginInFlight) {
    _loginInFlight = login().finally(() => { _loginInFlight = null; });
  }
  const cookie = await _loginInFlight;
  _session = {
    cookie,
    expiresAt: Date.now() + config.sbobetSessionTtlMs,
  };
  return cookie;
}

export function clearSbobetSession(): void {
  _session = null;
  _loginInFlight = null;
}

// ── Live matches feed ─────────────────────────────────────────────────────────

// In-flight dedup for the live feed (many pipeline runs hitting this concurrently)
let _liveFeedInFlight: Promise<SboLiveMatch[]> | null = null;
let _liveFeedCachedAt = 0;
let _liveFeedCache: SboLiveMatch[] = [];
const LIVE_FEED_TTL_MS = 15_000;

async function fetchLiveFeed(): Promise<SboLiveMatch[]> {
  // Return in-memory cache if fresh enough
  if (_liveFeedCache.length > 0 && Date.now() - _liveFeedCachedAt < LIVE_FEED_TTL_MS) {
    return _liveFeedCache;
  }

  // Dedup concurrent fetches
  if (!_liveFeedInFlight) {
    _liveFeedInFlight = doFetchLiveFeed().finally(() => { _liveFeedInFlight = null; });
  }
  return _liveFeedInFlight;
}

async function doFetchLiveFeed(): Promise<SboLiveMatch[]> {
  const baseUrl = config.sbobetBaseUrl;
  const url = `${baseUrl}${config.sbobetLiveFeedPath}`;

  const res = await fetchWithSession(url);

  if (res.status === 401 || res.status === 403) {
    // Session expired — force re-login on next call
    _session = null;
    throw new Error(`SBO session expired (${res.status})`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SBO live feed ${res.status}: ${body.slice(0, 200)}`);
  }

  const raw = await res.json() as unknown;
  const matches = normalizeLiveFeedResponse(raw);

  _liveFeedCache = matches;
  _liveFeedCachedAt = Date.now();
  return matches;
}

// ── Response normalizer ───────────────────────────────────────────────────────
// This is where the raw SBO JSON is mapped to SboLiveMatch[].
// After running the discovery script, update this function to match
// the actual response shape of your SBO domain.

function normalizeLiveFeedResponse(raw: unknown): SboLiveMatch[] {
  if (!raw || typeof raw !== 'object') return [];

  // SBO typically wraps in { data: [...] } or { events: [...] } or directly []
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)['data'])
      ? (raw as Record<string, unknown>)['data'] as unknown[]
      : Array.isArray((raw as Record<string, unknown>)['events'])
        ? (raw as Record<string, unknown>)['events'] as unknown[]
        : Array.isArray((raw as Record<string, unknown>)['matches'])
          ? (raw as Record<string, unknown>)['matches'] as unknown[]
          : [];

  return arr.flatMap((item) => {
    const m = (item ?? {}) as Record<string, unknown>;

    const homeTeam = String(m['homeTeam'] ?? m['home'] ?? m['homeName'] ?? '');
    const awayTeam = String(m['awayTeam'] ?? m['away'] ?? m['awayName'] ?? '');
    if (!homeTeam || !awayTeam) return [];

    // O/U line — SBO quotes remaining goals for live
    const ouLine = toFloat(m['ouLine'] ?? m['totalLine'] ?? m['overUnder'] ?? m['ou']);
    const overOdds = toFloat(m['overOdds'] ?? m['over'] ?? m['overPrice']);
    const underOdds = toFloat(m['underOdds'] ?? m['under'] ?? m['underPrice']);

    if (ouLine == null || overOdds == null || underOdds == null) return [];

    return [{
      eventId: String(m['eventId'] ?? m['id'] ?? m['matchId'] ?? ''),
      homeTeam,
      awayTeam,
      leagueName: String(m['leagueName'] ?? m['league'] ?? m['competition'] ?? ''),
      homeScore: toFloat(m['homeScore'] ?? m['home_score'] ?? 0) ?? 0,
      awayScore: toFloat(m['awayScore'] ?? m['away_score'] ?? 0) ?? 0,
      matchMinute: toFloat(m['minute'] ?? m['matchTime'] ?? 0) ?? 0,
      ouLine,
      overOdds,
      underOdds,
      ahLine: toFloat(m['ahLine'] ?? m['handicapLine'] ?? m['hdpLine']),
      ahHomeOdds: toFloat(m['ahHomeOdds'] ?? m['homeHandicapOdds'] ?? m['hdpHome']),
      ahAwayOdds: toFloat(m['ahAwayOdds'] ?? m['awayHandicapOdds'] ?? m['hdpAway']),
      homeOdds: toFloat(m['homeOdds'] ?? m['home1x2'] ?? m['moneylineHome']),
      drawOdds: toFloat(m['drawOdds'] ?? m['draw1x2'] ?? m['moneylineDraw']),
      awayOdds: toFloat(m['awayOdds'] ?? m['away1x2'] ?? m['moneylineAway']),
    }];
  });
}

function toFloat(val: unknown): number | null {
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch live O/U and AH odds from SBOBET for a specific match.
 * Returns null if SBO is disabled, match not found, or fetch fails.
 */
export async function fetchSbobetMatchOdds(
  homeTeam: string,
  awayTeam: string,
): Promise<SbobetOddsLine | null> {
  if (!config.sbobetEnabled) return null;
  if (!config.sbobetBaseUrl || !config.sbobetUsername || !config.sbobetPassword) return null;

  const matches = await fetchLiveFeed();
  const found = findMatchInList(matches, homeTeam, awayTeam);
  if (!found) return null;

  return {
    ouLine: found.ouLine,
    overOdds: found.overOdds,
    underOdds: found.underOdds,
    ahLine: found.ahLine,
    ahHomeOdds: found.ahHomeOdds,
    ahAwayOdds: found.ahAwayOdds,
    homeWinOdds: found.homeOdds ?? null,
    drawOdds: found.drawOdds ?? null,
    awayWinOdds: found.awayOdds ?? null,
    fetchedAt: new Date().toISOString(),
    matchedAs: `${found.homeTeam} vs ${found.awayTeam}`,
  };
}

/**
 * Convert SbobetOddsLine to the bookmaker array format used by odds-resolver.
 */
export function sbobetOddsToBookmakerEntry(line: SbobetOddsLine): object {
  const bets: Array<{ id: number; name: string; values: Array<{ value: string; odd: string; handicap?: string }> }> = [];

  // Over/Under
  bets.push({
    id: 5,
    name: 'Over/Under',
    values: [
      { value: 'Over', odd: String(line.overOdds), handicap: String(line.ouLine) },
      { value: 'Under', odd: String(line.underOdds), handicap: String(line.ouLine) },
    ],
  });

  // Asian Handicap
  if (line.ahLine != null && line.ahHomeOdds != null && line.ahAwayOdds != null) {
    bets.push({
      id: 6,
      name: 'Asian Handicap',
      values: [
        { value: 'Home', odd: String(line.ahHomeOdds), handicap: String(line.ahLine) },
        { value: 'Away', odd: String(line.ahAwayOdds), handicap: String(-line.ahLine) },
      ],
    });
  }

  // 1x2
  if (line.homeWinOdds && line.drawOdds && line.awayWinOdds) {
    bets.push({
      id: 1,
      name: 'Match Winner',
      values: [
        { value: 'Home', odd: String(line.homeWinOdds) },
        { value: 'Draw', odd: String(line.drawOdds) },
        { value: 'Away', odd: String(line.awayWinOdds) },
      ],
    });
  }

  return {
    bookmakers: [{
      id: 900,
      name: 'SBOBET',
      bets,
    }],
  };
}
