import { config } from '../config.js';
import {
  classifyStrategicSourceDomain,
  type StrategicSearchQuality,
  type StrategicSourceTrustTier,
  type StrategicSourceType,
} from '../config/strategic-source-policy.js';
import {
  fetchEspnSoccerMatchData,
  type EspnExtractedMatchData,
} from './espn-soccer-extractor.js';
import {
  fetchKLeaguePortalMatchData,
  type KLeaguePortalExtractedMatchData,
} from './kleague-portal-extractor.js';
import {
  buildSofascoreMatchPageUrl,
  fetchSofascoreMatchDataFromEventId,
  fetchSofascoreMatchDataFromPageUrl,
  fetchSofascoreTeamEvents,
  searchSofascoreTeams,
  type SofascoreSearchTeam,
  type SofascoreTeamEventSummary,
} from './sofascore-extractor.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const SEARCH_TIMEOUT_MS = Math.min(Math.max(config.geminiTimeoutMs, 45_000), 90_000);
const STRUCTURE_TIMEOUT_MS = Math.min(Math.max(config.geminiTimeoutMs, 30_000), 60_000);
const DEFAULT_MODEL = config.geminiStrategicGroundedModel || config.geminiModel;
const DEFAULT_STRUCTURED_MODEL = config.geminiStrategicStructuredModel || config.geminiModel;

export interface WebFallbackSource {
  title: string;
  url: string;
  domain: string;
  publisher: string;
  language: 'en' | 'vi' | 'unknown';
  source_type: StrategicSourceType;
  trust_tier: StrategicSourceTrustTier;
}

export interface WebFallbackSourceMeta {
  search_quality: StrategicSearchQuality;
  web_search_queries: string[];
  sources: WebFallbackSource[];
  trusted_source_count: number;
  rejected_source_count: number;
  rejected_domains: string[];
}

export interface WebFallbackTwoSideStat {
  home: number | null;
  away: number | null;
}

export interface WebFallbackStats {
  possession: WebFallbackTwoSideStat;
  shots: WebFallbackTwoSideStat;
  shots_on_target: WebFallbackTwoSideStat;
  corners: WebFallbackTwoSideStat;
  fouls: WebFallbackTwoSideStat;
  yellow_cards: WebFallbackTwoSideStat;
  red_cards: WebFallbackTwoSideStat;
}

export interface WebFallbackEvent {
  minute: number | null;
  team: 'home' | 'away' | 'unknown';
  type: 'goal' | 'yellow_card' | 'red_card' | 'subst' | 'other';
  detail: string;
  player: string;
}

export interface WebFallbackStructuredData {
  matched: boolean;
  matched_title: string;
  matched_url: string;
  home_team: string;
  away_team: string;
  competition: string;
  status: string;
  minute: number | null;
  score: {
    home: number | null;
    away: number | null;
  };
  stats: WebFallbackStats;
  events: WebFallbackEvent[];
  notes: string;
}

export interface WebFallbackRequestedSlots {
  stats?: boolean;
  events?: boolean;
  odds?: boolean;
}

export interface WebFallbackRequest {
  homeTeam: string;
  awayTeam: string;
  league?: string;
  matchDate?: string | null;
  status?: string;
  minute?: number | null;
  score?: {
    home: number | null;
    away: number | null;
  } | null;
  requestedSlots: WebFallbackRequestedSlots;
}

export interface WebFallbackValidation {
  accepted: boolean;
  reasons: string[];
  home_similarity: number;
  away_similarity: number;
  score_matches: boolean;
  score_checked: boolean;
  status_matches: boolean;
  minute_delta: number | null;
  primary_stat_pairs: number;
  event_count: number;
  trusted_source_count: number;
  search_quality: StrategicSearchQuality;
}

export interface WebLiveFallbackResult {
  success: boolean;
  request: WebFallbackRequest;
  rawDraft: string;
  structured: WebFallbackStructuredData | null;
  sourceMeta: WebFallbackSourceMeta;
  fetchedPages?: Array<{
    source_url: string;
    final_url: string;
    domain: string;
    title: string;
    status_code: number | null;
    excerpt: string;
    fetched: boolean;
  }>;
  validation: WebFallbackValidation;
  error?: string;
}

function cleanText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function detectLanguage(domain: string, url: string): 'en' | 'vi' | 'unknown' {
  const haystack = `${domain} ${url}`.toLowerCase();
  if (haystack.includes('.vn') || haystack.includes('/vi/') || haystack.includes('vietnam')) return 'vi';
  if (haystack) return 'en';
  return 'unknown';
}

function normalizeGroundedSourceIdentity(url: string, title: string): { domain: string; publisher: string } {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const titleDomain = cleanText(title).toLowerCase();
    if (
      parsed.hostname.includes('vertexaisearch.cloud.google.com')
      && titleDomain
      && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(titleDomain)
    ) {
      return { domain: titleDomain, publisher: titleDomain };
    }
    return { domain, publisher: domain || cleanText(title, 'unknown') };
  } catch {
    const titleDomain = cleanText(title).toLowerCase();
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(titleDomain)) {
      return { domain: titleDomain, publisher: titleDomain };
    }
    return { domain: '', publisher: cleanText(title, 'unknown') };
  }
}

function computeSearchQuality(sources: WebFallbackSource[]): StrategicSearchQuality {
  if (sources.length === 0) return 'unknown';
  const trusted = sources.filter((source) => source.trust_tier === 'tier_1' || source.trust_tier === 'tier_2').length;
  const rejected = sources.filter((source) => source.trust_tier === 'rejected').length;
  if (trusted >= 2 && rejected === 0) return 'high';
  if (trusted >= 1) return 'medium';
  if (rejected > 0) return 'low';
  return 'low';
}

function extractCandidateText(data: Record<string, unknown>): string {
  const candidates = Array.isArray(data.candidates) ? data.candidates as Array<Record<string, unknown>> : [];
  for (const candidate of candidates) {
    const content = typeof candidate.content === 'object' && candidate.content ? candidate.content as Record<string, unknown> : null;
    const parts = Array.isArray(content?.parts) ? content?.parts as Array<Record<string, unknown>> : [];
    const joined = parts
      .map((part) => cleanText(part.text))
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  return '';
}

function extractGroundingMeta(data: unknown): WebFallbackSourceMeta {
  const root = typeof data === 'object' && data ? data as Record<string, unknown> : {};
  const candidates = Array.isArray(root.candidates) ? root.candidates as Array<Record<string, unknown>> : [];
  const urls = new Set<string>();
  const queries = new Set<string>();
  const sources: WebFallbackSource[] = [];

  for (const candidate of candidates) {
    const grounding = typeof candidate.groundingMetadata === 'object' && candidate.groundingMetadata
      ? candidate.groundingMetadata as Record<string, unknown>
      : null;
    if (!grounding) continue;

    const groundingChunks = Array.isArray(grounding.groundingChunks)
      ? grounding.groundingChunks as Array<Record<string, unknown>>
      : [];
    for (const chunk of groundingChunks) {
      const web = typeof chunk.web === 'object' && chunk.web ? chunk.web as Record<string, unknown> : null;
      const url = cleanText(web?.uri);
      if (!url || urls.has(url)) continue;
      urls.add(url);
      const title = cleanText(web?.title, 'Unknown source');
      const { domain, publisher } = normalizeGroundedSourceIdentity(url, title);
      const classification = classifyStrategicSourceDomain(domain);
      sources.push({
        title,
        url,
        domain,
        publisher,
        language: detectLanguage(domain, url),
        source_type: classification.sourceType,
        trust_tier: classification.trustTier,
      });
    }

    const webSearchQueries = Array.isArray(grounding.webSearchQueries)
      ? grounding.webSearchQueries
      : [];
    for (const query of webSearchQueries) {
      const normalized = cleanText(query);
      if (normalized) queries.add(normalized);
    }
  }

  const rejected = sources.filter((source) => source.trust_tier === 'rejected');
  const trustedCount = sources.filter((source) => source.trust_tier === 'tier_1' || source.trust_tier === 'tier_2').length;
  return {
    search_quality: computeSearchQuality(sources),
    web_search_queries: Array.from(queries),
    sources,
    trusted_source_count: trustedCount,
    rejected_source_count: rejected.length,
    rejected_domains: Array.from(new Set(rejected.map((source) => source.domain).filter(Boolean))),
  };
}

function extractJsonString(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return null;
}

function extractSingleDraftField(draftText: string, key: string): string {
  const match = draftText.match(new RegExp(`^${key}:\\s*(.+)$`, 'im'));
  return cleanText(match?.[1] || '');
}

function parseDraftBoolean(value: string): boolean {
  return value.trim().toLowerCase() === 'true';
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStats(input: unknown): WebFallbackStats {
  const obj = typeof input === 'object' && input ? input as Record<string, unknown> : {};
  const pair = (key: string): WebFallbackTwoSideStat => {
    const raw = typeof obj[key] === 'object' && obj[key] ? obj[key] as Record<string, unknown> : {};
    return {
      home: toNumber(raw.home),
      away: toNumber(raw.away),
    };
  };
  return {
    possession: pair('possession'),
    shots: pair('shots'),
    shots_on_target: pair('shots_on_target'),
    corners: pair('corners'),
    fouls: pair('fouls'),
    yellow_cards: pair('yellow_cards'),
    red_cards: pair('red_cards'),
  };
}

function normalizeEvents(input: unknown): WebFallbackEvent[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    const obj = typeof item === 'object' && item ? item as Record<string, unknown> : {};
    const team = cleanText(obj.team).toLowerCase();
    const type = cleanText(obj.type).toLowerCase();
    return {
      minute: toNumber(obj.minute),
      team: team === 'home' || team === 'away' ? team : 'unknown',
      type: type === 'goal' || type === 'yellow_card' || type === 'red_card' || type === 'subst' ? type : 'other',
      detail: cleanText(obj.detail),
      player: cleanText(obj.player),
    } satisfies WebFallbackEvent;
  });
}

function normalizeStructuredPayload(payload: unknown): WebFallbackStructuredData {
  const obj = typeof payload === 'object' && payload ? payload as Record<string, unknown> : {};
  const score = typeof obj.score === 'object' && obj.score ? obj.score as Record<string, unknown> : {};
  return {
    matched: Boolean(obj.matched),
    matched_title: cleanText(obj.matched_title),
    matched_url: cleanText(obj.matched_url),
    home_team: cleanText(obj.home_team),
    away_team: cleanText(obj.away_team),
    competition: cleanText(obj.competition),
    status: cleanText(obj.status),
    minute: toNumber(obj.minute),
    score: {
      home: toNumber(score.home),
      away: toNumber(score.away),
    },
    stats: normalizeStats(obj.stats),
    events: normalizeEvents(obj.events),
    notes: cleanText(obj.notes),
  };
}

function inferDraftEventTeam(rawTeam: string, request: WebFallbackRequest): 'home' | 'away' | 'unknown' {
  const team = cleanText(rawTeam);
  if (!team) return 'unknown';
  const homeScore = similarity(team, request.homeTeam);
  const awayScore = similarity(team, request.awayTeam);
  if (homeScore >= 0.78 && homeScore >= awayScore) return 'home';
  if (awayScore >= 0.78 && awayScore >= homeScore) return 'away';
  return 'unknown';
}

function parseLooseDraftEventString(value: string, request: WebFallbackRequest): WebFallbackEvent | null {
  const text = cleanText(value);
  if (!text) return null;
  const minuteMatch = text.match(/(\d{1,2})(?:\+\d{1,2})?\s*['’]?/);
  const goalMatch = text.match(/goal/i);
  const teamMatch = text.match(/\(([^)]+)\)/);
  const playerMatch = text.match(/goal\s*:?\s*([^()|]+?)(?:\s*\(|\s*$)/i);

  return {
    minute: minuteMatch?.[1] ? toNumber(minuteMatch[1]) : null,
    team: inferDraftEventTeam(teamMatch?.[1] || '', request),
    type: goalMatch ? 'goal' : 'other',
    detail: goalMatch ? 'Goal' : text,
    player: cleanText(playerMatch?.[1] || ''),
  };
}

function parseDraftEventsValue(draftText: string, request: WebFallbackRequest): WebFallbackEvent[] {
  const raw = extractSingleDraftField(draftText, 'EVENTS');
  if (!raw || raw === '[]' || raw.toLowerCase() === 'null') return [];

  const tryNormalizeObjectArray = (input: unknown): WebFallbackEvent[] => {
    if (!Array.isArray(input)) return [];
    return input.map((item) => {
      if (typeof item === 'string') return parseLooseDraftEventString(item, request);
      const obj = typeof item === 'object' && item ? item as Record<string, unknown> : {};
      return {
        minute: toNumber(obj.minute),
        team: inferDraftEventTeam(cleanText(obj.team), request),
        type: cleanText(obj.type).toLowerCase() === 'goal' ? 'goal'
          : cleanText(obj.type).toLowerCase() === 'yellow_card' ? 'yellow_card'
            : cleanText(obj.type).toLowerCase() === 'red_card' ? 'red_card'
              : cleanText(obj.type).toLowerCase() === 'subst' ? 'subst'
                : 'other',
        detail: cleanText(obj.detail || obj.reason || obj.text),
        player: cleanText(obj.player),
      } satisfies WebFallbackEvent;
    }).filter((event): event is WebFallbackEvent => Boolean(event));
  };

  try {
    const parsed = JSON.parse(raw);
    const normalized = tryNormalizeObjectArray(parsed);
    if (normalized.length > 0) return normalized;
  } catch {
    // ignore and fall back to loose parsing
  }

  const single = parseLooseDraftEventString(raw, request);
  return single ? [single] : [];
}

function buildDeterministicDraftEventResult(
  request: WebFallbackRequest,
  draftText: string,
): WebFallbackStructuredData | null {
  if (!request.requestedSlots.events || request.requestedSlots.stats || request.requestedSlots.odds) {
    return null;
  }

  const matched = parseDraftBoolean(extractSingleDraftField(draftText, 'MATCHED'));
  const homeTeam = extractSingleDraftField(draftText, 'HOME_TEAM') || request.homeTeam;
  const awayTeam = extractSingleDraftField(draftText, 'AWAY_TEAM') || request.awayTeam;
  const events = parseDraftEventsValue(draftText, request);
  if (!matched || events.length < 1) return null;

  return {
    matched: true,
    matched_title: extractSingleDraftField(draftText, 'MATCH_TITLE'),
    matched_url: extractSingleDraftField(draftText, 'MATCH_URL'),
    home_team: homeTeam,
    away_team: awayTeam,
    competition: extractSingleDraftField(draftText, 'COMPETITION') || cleanText(request.league || ''),
    status: extractSingleDraftField(draftText, 'STATUS') || cleanText(request.status || ''),
    minute: toNumber(extractSingleDraftField(draftText, 'MINUTE')) ?? request.minute ?? null,
    score: {
      home: toNumber(extractSingleDraftField(draftText, 'HOME_SCORE')) ?? request.score?.home ?? null,
      away: toNumber(extractSingleDraftField(draftText, 'AWAY_SCORE')) ?? request.score?.away ?? null,
    },
    stats: normalizeStats(null),
    events,
    notes: extractSingleDraftField(draftText, 'NOTES') || 'Deterministic event extraction from grounded draft.',
  };
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bhd\b/g, 'hyundai')
    .replace(/\butd\b/g, 'united')
    .replace(/\bst\b/g, 'saint')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => cleanText(value)).filter(Boolean)));
}

function buildTeamSearchVariants(teamName: string): string[] {
  const base = cleanText(teamName);
  if (!base) return [];

  const variants = new Set<string>([base]);
  const withoutWomenSuffix = base
    .replace(/\bwomen\b/ig, '')
    .replace(/\bw\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (withoutWomenSuffix && withoutWomenSuffix !== base) {
    variants.add(withoutWomenSuffix);
    variants.add(`${withoutWomenSuffix} Women`);
  }

  const withoutNationalSuffix = withoutWomenSuffix
    .replace(/\b(fc|cf|sc|afc|cfc)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutNationalSuffix && withoutNationalSuffix !== withoutWomenSuffix) {
    variants.add(withoutNationalSuffix);
  }

  return uniqueStrings(variants);
}

function buildMatchSearchPhrases(request: WebFallbackRequest): string[] {
  const homeVariants = buildTeamSearchVariants(request.homeTeam);
  const awayVariants = buildTeamSearchVariants(request.awayTeam);
  const competition = cleanText(request.league);
  const matchDate = cleanText(request.matchDate || '');
  const phrases = new Set<string>();

  for (const home of homeVariants.slice(0, 3)) {
    for (const away of awayVariants.slice(0, 3)) {
      phrases.add(`${home} vs ${away}`.trim());
      if (competition) phrases.add(`${home} vs ${away} ${competition}`.trim());
      if (matchDate) phrases.add(`${home} vs ${away} ${matchDate}`.trim());
      if (competition && matchDate) phrases.add(`${home} vs ${away} ${competition} ${matchDate}`.trim());
    }
  }

  return uniqueStrings(phrases).slice(0, 6);
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

interface ScoredSofascoreTeamCandidate {
  team: SofascoreSearchTeam;
  score: number;
}

interface ScoredSofascoreEventCandidate {
  event: SofascoreTeamEventSummary;
  score: number;
}

function normalizedMatchDateTimestamp(matchDate?: string | null): number | null {
  const value = cleanText(matchDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ts = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ts) ? ts : null;
}

function dayDistanceFromRequest(matchDate: string | null | undefined, startTimestamp: number | null): number | null {
  if (!startTimestamp) return null;
  const requestDay = normalizedMatchDateTimestamp(matchDate);
  if (requestDay == null) return null;
  const eventDate = new Date(startTimestamp * 1000);
  const eventDay = Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());
  return Math.round(Math.abs(eventDay - requestDay) / 86_400_000);
}

function scoreSofascoreTeamCandidate(requestTeamName: string, candidate: SofascoreSearchTeam): number {
  if (candidate.sport?.slug !== 'football') return 0;
  let score = similarity(requestTeamName, candidate.name);
  if (cleanText(candidate.gender).toUpperCase() === 'W' && /\bw(?:omen)?\b/i.test(requestTeamName)) {
    score += 0.04;
  }
  if (candidate.national && /\b(w|women|u\d{2})\b/i.test(requestTeamName)) {
    score += 0.03;
  }
  return Math.min(score, 1);
}

function buildSofascoreSpiderQueryLabel(request: WebFallbackRequest): string {
  return `sofascore_spider:${request.homeTeam} vs ${request.awayTeam}`;
}

async function resolveSofascoreTeamCandidates(teamName: string): Promise<ScoredSofascoreTeamCandidate[]> {
  const scored = new Map<number, ScoredSofascoreTeamCandidate>();
  for (const query of buildTeamSearchVariants(teamName).slice(0, 3)) {
    const teams = await searchSofascoreTeams(query);
    for (const team of teams.slice(0, 6)) {
      const score = scoreSofascoreTeamCandidate(teamName, team);
      if (score < 0.55) continue;
      const existing = scored.get(team.id);
      if (!existing || score > existing.score) {
        scored.set(team.id, { team, score });
      }
    }
    const currentBest = Array.from(scored.values()).sort((a, b) => b.score - a.score)[0];
    if (currentBest && currentBest.score >= 0.94) break;
  }
  return Array.from(scored.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function scoreSofascoreStatusCompatibility(request: WebFallbackRequest, event: SofascoreTeamEventSummary): number {
  const requestStatus = normalizeStatus(request.status || '');
  const eventStatus = cleanText(event.status.type).toUpperCase();
  if (!requestStatus) return 0.5;
  if (requestStatus === 'FT' || requestStatus === 'AET' || requestStatus === 'PEN') {
    return eventStatus === 'FINISHED' ? 1 : 0;
  }
  if (requestStatus === 'NS') {
    return eventStatus === 'NOTSTARTED' ? 1 : 0;
  }
  if (requestStatus === 'HT' || requestStatus === '1H' || requestStatus === '2H') {
    if (eventStatus === 'INPROGRESS') return 1;
    if (eventStatus === 'FINISHED') return 0.35;
    return 0;
  }
  if (request.minute != null) {
    if (eventStatus === 'INPROGRESS') return 1;
    if (eventStatus === 'FINISHED') return 0.35;
  }
  return 0.5;
}

function scoreSofascoreEventCandidate(
  request: WebFallbackRequest,
  homeCandidate: ScoredSofascoreTeamCandidate,
  awayCandidates: ScoredSofascoreTeamCandidate[],
  event: SofascoreTeamEventSummary,
): number {
  const homeIsHome = event.homeTeam.id === homeCandidate.team.id;
  const homeIsAway = event.awayTeam.id === homeCandidate.team.id;
  if (!homeIsHome && !homeIsAway) return 0;

  const opponent = homeIsHome ? event.awayTeam : event.homeTeam;
  const opponentSimilarity = similarity(request.awayTeam, opponent.name);
  if (opponentSimilarity < 0.72) return 0;

  const awayIdMatch = awayCandidates.some((candidate) => candidate.team.id === opponent.id);
  const competitionName = event.tournament.uniqueTournamentName || event.tournament.name;
  const competitionSimilarity = request.league ? similarity(request.league, competitionName) : 0.65;
  const dateDistance = dayDistanceFromRequest(request.matchDate, event.startTimestamp);
  const dateScore = dateDistance == null
    ? 0.5
    : dateDistance === 0
      ? 1
      : dateDistance === 1
        ? 0.75
        : dateDistance === 2
          ? 0.35
          : 0;
  if (dateDistance != null && dateDistance > 2) return 0;

  let score = (homeCandidate.score * 0.22) + (opponentSimilarity * 0.38) + (competitionSimilarity * 0.16) + (dateScore * 0.16);
  if (awayIdMatch) score += 0.18;

  const statusScore = scoreSofascoreStatusCompatibility(request, event);
  score += statusScore * 0.08;
  if (request.score) {
    const expectedHome = request.score.home;
    const expectedAway = request.score.away;
    const actualHome = homeIsHome ? event.homeScore.current : event.awayScore.current;
    const actualAway = homeIsHome ? event.awayScore.current : event.homeScore.current;
    if (expectedHome != null && expectedAway != null && actualHome != null && actualAway != null) {
      if (expectedHome === actualHome && expectedAway === actualAway) {
        score += 0.14;
      } else {
        score -= 0.18;
      }
    }
  }
  return score;
}

function buildDeterministicSofascoreSourceMeta(
  request: WebFallbackRequest,
  sourceMeta: WebFallbackSourceMeta,
  event: SofascoreTeamEventSummary,
): WebFallbackSourceMeta {
  const pageUrl = buildSofascoreMatchPageUrl(event) || `https://www.sofascore.com/api/v1/event/${event.id}`;
  const source = sourceFromResolvedUrl(pageUrl, 'Sofascore');
  if (!source) return sourceMeta;
  return mergeSourceMeta(
    sourceMeta,
    sourceMetaFromSources([source], [buildSofascoreSpiderQueryLabel(request)]),
  );
}

export function countPrimaryStatPairs(stats: WebFallbackStats): number {
  const tracked = [
    stats.possession,
    stats.shots,
    stats.shots_on_target,
    stats.corners,
    stats.fouls,
  ];
  return tracked.filter((pair) => pair.home != null && pair.away != null).length;
}

function normalizeStatus(status: string): string {
  return cleanText(status).toUpperCase().replace(/[^\w+]/g, '');
}

export function validateWebLiveFallbackResult(
  request: WebFallbackRequest,
  structured: WebFallbackStructuredData | null,
  sourceMeta: WebFallbackSourceMeta,
): WebFallbackValidation {
  const reasons: string[] = [];
  if (!structured || !structured.matched) {
    reasons.push('NO_MATCHED_RESULT');
  }

  const homeSimilarity = similarity(request.homeTeam, structured?.home_team || '');
  const awaySimilarity = similarity(request.awayTeam, structured?.away_team || '');
  if (homeSimilarity < 0.78) reasons.push('HOME_TEAM_MISMATCH');
  if (awaySimilarity < 0.78) reasons.push('AWAY_TEAM_MISMATCH');

  const scoreChecked = request.score?.home != null && request.score?.away != null
    && structured?.score.home != null && structured?.score.away != null;
  const scoreMatches = !scoreChecked
    || (
      request.score?.home === structured?.score.home
      && request.score?.away === structured?.score.away
    );
  if (scoreChecked && !scoreMatches) reasons.push('SCORE_MISMATCH');

  const normalizedRequestedStatus = normalizeStatus(request.status || '');
  const normalizedStructuredStatus = normalizeStatus(structured?.status || '');
  const statusMatches = !normalizedRequestedStatus
    || !normalizedStructuredStatus
    || normalizedRequestedStatus === normalizedStructuredStatus
    || (normalizedRequestedStatus === 'HT' && ['HT', 'HALFTIME', 'HALFTIMEBREAK'].includes(normalizedStructuredStatus))
    || (normalizedRequestedStatus === 'FT' && ['FT', 'FINAL', 'FULLTIME'].includes(normalizedStructuredStatus));
  if (!statusMatches) reasons.push('STATUS_MISMATCH');

  const minuteDelta = request.minute != null && structured?.minute != null
    ? Math.abs(request.minute - structured.minute)
    : null;
  if (minuteDelta != null && minuteDelta > 12 && normalizedRequestedStatus !== 'HT') {
    reasons.push('MINUTE_TOO_FAR');
  }

  const primaryStatPairs = countPrimaryStatPairs(structured?.stats || normalizeStats(null));
  const eventCount = structured?.events.length ?? 0;
  const statsRequested = request.requestedSlots.stats === true;
  const eventsRequested = request.requestedSlots.events === true;

  if (statsRequested && primaryStatPairs < 3) reasons.push('INSUFFICIENT_STATS_COVERAGE');
  if (eventsRequested && eventCount < 1) reasons.push('INSUFFICIENT_EVENTS_COVERAGE');
  if (sourceMeta.search_quality === 'low' || sourceMeta.trusted_source_count === 0) reasons.push('LOW_TRUST_SOURCES');

  return {
    accepted: reasons.length === 0,
    reasons,
    home_similarity: homeSimilarity,
    away_similarity: awaySimilarity,
    score_matches: scoreMatches,
    score_checked: scoreChecked,
    status_matches: statusMatches,
    minute_delta: minuteDelta,
    primary_stat_pairs: primaryStatPairs,
    event_count: eventCount,
    trusted_source_count: sourceMeta.trusted_source_count,
    search_quality: sourceMeta.search_quality,
  };
}

interface GeminiGenerateOptions {
  withSearch: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  responseMimeType: string;
  model?: string;
}

interface FetchedSourcePage {
  source_url: string;
  final_url: string;
  domain: string;
  title: string;
  status_code: number | null;
  excerpt: string;
  fetched: boolean;
}

function mergeSourceMeta(a: WebFallbackSourceMeta, b: WebFallbackSourceMeta): WebFallbackSourceMeta {
  const sourceMap = new Map<string, WebFallbackSource>();
  for (const source of [...a.sources, ...b.sources]) {
    const key = `${source.domain}|${source.url}`;
    if (!sourceMap.has(key)) sourceMap.set(key, source);
  }
  const mergedSources = Array.from(sourceMap.values());
  const rejected = mergedSources.filter((source) => source.trust_tier === 'rejected');
  const trustedCount = mergedSources.filter((source) => source.trust_tier === 'tier_1' || source.trust_tier === 'tier_2').length;
  return {
    search_quality: computeSearchQuality(mergedSources),
    web_search_queries: Array.from(new Set([...a.web_search_queries, ...b.web_search_queries])),
    sources: mergedSources,
    trusted_source_count: trustedCount,
    rejected_source_count: rejected.length,
    rejected_domains: Array.from(new Set(rejected.map((source) => source.domain).filter(Boolean))),
  };
}

function sourceMetaFromSources(
  sources: WebFallbackSource[],
  queries: string[] = [],
): WebFallbackSourceMeta {
  const rejected = sources.filter((source) => source.trust_tier === 'rejected');
  const trustedCount = sources.filter((source) => source.trust_tier === 'tier_1' || source.trust_tier === 'tier_2').length;
  return {
    search_quality: computeSearchQuality(sources),
    web_search_queries: uniqueStrings(queries),
    sources,
    trusted_source_count: trustedCount,
    rejected_source_count: rejected.length,
    rejected_domains: uniqueStrings(rejected.map((source) => source.domain).filter(Boolean)),
  };
}

function extractDraftSources(draftText: string): WebFallbackSource[] {
  const matchedUrl = extractSingleDraftField(draftText, 'MATCH_URL');
  const matchedTitle = extractSingleDraftField(draftText, 'MATCH_TITLE');
  const directSources = extractResolvedSourcesFromText(draftText);
  const output = new Map<string, WebFallbackSource>();

  for (const source of directSources) {
    output.set(`${source.domain}|${source.url}`, source);
  }

  const matchedSource = sourceFromResolvedUrl(matchedUrl, matchedTitle);
  if (matchedSource) {
    output.set(`${matchedSource.domain}|${matchedSource.url}`, matchedSource);
  }

  return Array.from(output.values());
}

function sourceMetaFromFetchedPages(
  fetchedPages: FetchedSourcePage[],
  existingQueries: string[],
): WebFallbackSourceMeta {
  const sources = fetchedPages
    .map((page) => sourceFromResolvedUrl(page.final_url || page.source_url, page.title))
    .filter((source): source is WebFallbackSource => Boolean(source));
  return sourceMetaFromSources(sources, existingQueries);
}

function sourceFromResolvedUrl(url: string, title = ''): WebFallbackSource | null {
  const normalized = cleanText(url);
  if (!/^https?:\/\//i.test(normalized)) return null;
  const { domain, publisher } = normalizeGroundedSourceIdentity(normalized, title);
  const classification = classifyStrategicSourceDomain(domain);
  return {
    title: cleanText(title, domain || normalized),
    url: normalized,
    domain,
    publisher,
    language: detectLanguage(domain, normalized),
    source_type: classification.sourceType,
    trust_tier: classification.trustTier,
  };
}

function extractResolvedSourcesFromText(text: string): WebFallbackSource[] {
  const urls = text.match(/https?:\/\/[^\s)"]+/ig) || [];
  const deduped = uniqueStrings(urls);
  return deduped
    .map((url) => sourceFromResolvedUrl(url))
    .filter((source): source is WebFallbackSource => Boolean(source));
}

async function generateGeminiContent(
  prompt: string,
  options: GeminiGenerateOptions,
): Promise<Record<string, unknown> | null> {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const model = options.model || DEFAULT_MODEL;
  const requestUrl = `${GEMINI_BASE}/${model}:generateContent?key=${config.geminiApiKey}`;
  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(options.withSearch ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: {
          temperature: options.withSearch ? 0.1 : 0,
          maxOutputTokens: options.maxOutputTokens,
          responseMimeType: options.responseMimeType,
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gemini API ${response.status}: ${text.substring(0, 300)}`);
    }
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(match?.[1] || '');
}

function extractInterestingExcerpt(html: string): string {
  const text = stripHtmlToText(html);
  if (!text) return '';

  const windows = new Set<string>();
  const keywords = [
    'shots on goal',
    'shots',
    'possession',
    'corner',
    'fouls',
    'yellow cards',
    'red cards',
    'timeline',
    'match stats',
    'goal',
    'substitution',
  ];

  for (const keyword of keywords) {
    const regex = new RegExp(`.{0,160}${keyword}.{0,220}`, 'ig');
    const matches = text.match(regex) || [];
    for (const snippet of matches.slice(0, 6)) {
      windows.add(snippet.trim());
      if (windows.size >= 14) break;
    }
    if (windows.size >= 14) break;
  }

  if (windows.size === 0) {
    return text.slice(0, 2400);
  }
  return Array.from(windows).join('\n').slice(0, 4000);
}

function preferSourceForRequestedSlots(source: WebFallbackSource, requestedSlots: WebFallbackRequestedSlots): number {
  let score = 0;
  if (source.trust_tier === 'tier_1') score += 40;
  else if (source.trust_tier === 'tier_2') score += 30;
  else if (source.trust_tier === 'tier_3') score += 10;
  else score -= 40;

  if (requestedSlots.stats) {
    if (source.source_type === 'stats_reference') score += 30;
    if (source.domain.includes('sofascore') || source.domain.includes('flashscore') || source.domain.includes('fotmob')) score += 20;
  }
  if (requestedSlots.events) {
    if (source.source_type === 'stats_reference' || source.source_type === 'major_news') score += 10;
    if (source.source_type === 'official') score += 18;
  }

  if (source.domain.includes('bing.com')) score += 25;
  if (source.domain.includes('vertexaisearch.cloud.google.com')) score -= 10;
  return score;
}

async function fetchCandidatePages(
  sourceMeta: WebFallbackSourceMeta,
  requestedSlots: WebFallbackRequestedSlots,
): Promise<FetchedSourcePage[]> {
  const candidates = [...sourceMeta.sources]
    .filter((source) => source.trust_tier !== 'rejected')
    .sort((a, b) => preferSourceForRequestedSlots(b, requestedSlots) - preferSourceForRequestedSlots(a, requestedSlots))
    .slice(0, 3);

  const pages = await Promise.all(candidates.map(async (source) => {
    try {
      const response = await fetch(source.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
      });
      const html = await response.text();
      const finalUrl = response.url || source.url;
      const { domain } = normalizeGroundedSourceIdentity(finalUrl, extractTitleFromHtml(html) || source.title);
      return {
        source_url: source.url,
        final_url: finalUrl,
        domain,
        title: extractTitleFromHtml(html) || source.title,
        status_code: response.status,
        excerpt: extractInterestingExcerpt(html),
        fetched: response.ok,
      } satisfies FetchedSourcePage;
    } catch {
      return {
        source_url: source.url,
        final_url: '',
        domain: source.domain,
        title: source.title,
        status_code: null,
        excerpt: '',
        fetched: false,
      } satisfies FetchedSourcePage;
    }
  }));

  return pages.filter((page) => page.fetched && page.excerpt);
}

function buildRequestedSlotsLabel(requestedSlots: WebFallbackRequestedSlots): string {
  const slots = [
    requestedSlots.stats ? 'stats' : '',
    requestedSlots.events ? 'events' : '',
    requestedSlots.odds ? 'odds' : '',
  ].filter(Boolean);
  return slots.length > 0 ? slots.join(', ') : 'none';
}

function buildGroundedDraftPrompt(request: WebFallbackRequest): string {
  return `You are extracting football match data for a live betting system.

TARGET MATCH:
- Home team: ${request.homeTeam}
- Away team: ${request.awayTeam}
- Competition: ${request.league || 'unknown'}
- Match date: ${request.matchDate || 'today/unknown'}
- Known status: ${request.status || 'unknown'}
- Known minute: ${request.minute ?? 'unknown'}
- Known score: ${request.score?.home ?? 'unknown'}-${request.score?.away ?? 'unknown'}

REQUESTED SLOTS:
- ${buildRequestedSlotsLabel(request.requestedSlots)}

SEARCH DISCIPLINE:
- Use Google Search grounding.
- Prefer exact match pages only.
- Prioritize Bing sportsdetails pages, official competition/live pages, and reputable stats/live-score references.
- Ignore betting tips, forums, social posts, and rumor pages.
- If multiple sources disagree, prefer the one that matches BOTH team names and the known score/status.
- If you cannot verify the exact match, set MATCHED to false.
- Do not invent any number.

OUTPUT FORMAT:
- Return PLAIN TEXT only.
- Keep each key exactly once.
- Use null when a requested numeric field cannot be verified.
- Use [] when events cannot be verified.

KEYS:
MATCHED:
MATCH_TITLE:
MATCH_URL:
HOME_TEAM:
AWAY_TEAM:
COMPETITION:
STATUS:
MINUTE:
HOME_SCORE:
AWAY_SCORE:
POSSESSION_HOME:
POSSESSION_AWAY:
SHOTS_HOME:
SHOTS_AWAY:
SHOTS_ON_TARGET_HOME:
SHOTS_ON_TARGET_AWAY:
CORNERS_HOME:
CORNERS_AWAY:
FOULS_HOME:
FOULS_AWAY:
YELLOW_CARDS_HOME:
YELLOW_CARDS_AWAY:
RED_CARDS_HOME:
RED_CARDS_AWAY:
EVENTS:
NOTES:
SEARCH_QUERIES:
SOURCE_DOMAINS:
`;
}

function buildStructuredPrompt(
  draftText: string,
  request: WebFallbackRequest,
  sourceMeta: WebFallbackSourceMeta,
  fetchedPages: FetchedSourcePage[],
): string {
  const pageExcerpts = fetchedPages.length > 0
    ? fetchedPages.map((page, index) => [
      `SOURCE_PAGE_${index + 1}: ${page.final_url || page.source_url}`,
      `SOURCE_PAGE_${index + 1}_DOMAIN: ${page.domain}`,
      `SOURCE_PAGE_${index + 1}_TITLE: ${page.title}`,
      `SOURCE_PAGE_${index + 1}_EXCERPT:`,
      page.excerpt,
    ].join('\n')).join('\n\n')
    : 'No fetched page excerpts available.';

  return `Convert grounded football match notes into STRICT JSON.

TARGET MATCH:
- Home team: ${request.homeTeam}
- Away team: ${request.awayTeam}
- Competition: ${request.league || 'unknown'}
- Known status: ${request.status || 'unknown'}
- Known minute: ${request.minute ?? 'unknown'}
- Known score: ${request.score?.home ?? 'unknown'}-${request.score?.away ?? 'unknown'}

SOURCE_QUALITY: ${sourceMeta.search_quality}
TRUSTED_SOURCE_COUNT: ${sourceMeta.trusted_source_count}
TRUSTED_SOURCE_DOMAINS: ${sourceMeta.sources
    .filter((source) => source.trust_tier === 'tier_1' || source.trust_tier === 'tier_2')
    .map((source) => source.domain)
    .join(', ') || '(none)'}

RULES:
- Use ONLY facts from GROUNDED NOTES below.
- Prefer exact numeric values from FETCHED SOURCE PAGE EXCERPTS when available.
- Do NOT add commentary outside JSON.
- If exact match confidence is weak, set "matched" to false.
- Keep team names exactly as found in grounded notes.
- For stats not verified, use null.
- For events not verified, return [].
- Events must use team values: "home", "away", or "unknown".
- Event types allowed: "goal", "yellow_card", "red_card", "subst", "other".

GROUNDED NOTES:
${draftText}

FETCHED SOURCE PAGE EXCERPTS:
${pageExcerpts}

Return STRICT JSON only with this schema:
{
  "matched": boolean,
  "matched_title": string,
  "matched_url": string,
  "home_team": string,
  "away_team": string,
  "competition": string,
  "status": string,
  "minute": number | null,
  "score": {
    "home": number | null,
    "away": number | null
  },
  "stats": {
    "possession": { "home": number | null, "away": number | null },
    "shots": { "home": number | null, "away": number | null },
    "shots_on_target": { "home": number | null, "away": number | null },
    "corners": { "home": number | null, "away": number | null },
    "fouls": { "home": number | null, "away": number | null },
    "yellow_cards": { "home": number | null, "away": number | null },
    "red_cards": { "home": number | null, "away": number | null }
  },
  "events": [
    {
      "minute": number | null,
      "team": "home" | "away" | "unknown",
      "type": "goal" | "yellow_card" | "red_card" | "subst" | "other",
      "detail": string,
      "player": string
    }
  ],
  "notes": string
}`;
}

async function fetchGroundedDraft(request: WebFallbackRequest): Promise<{ draft: string; sourceMeta: WebFallbackSourceMeta }> {
  const data = await generateGeminiContent(
    buildGroundedDraftPrompt(request),
    {
      withSearch: true,
      timeoutMs: SEARCH_TIMEOUT_MS,
      maxOutputTokens: 2048,
      responseMimeType: 'text/plain',
      model: DEFAULT_MODEL,
    },
  );
  if (!data) {
    throw new Error('EMPTY_GROUNDED_RESPONSE');
  }
  const draft = extractCandidateText(data);
  if (!draft) {
    throw new Error('EMPTY_GROUNDED_DRAFT');
  }
  return { draft, sourceMeta: extractGroundingMeta(data) };
}

function buildSofascoreResolverPrompt(request: WebFallbackRequest): string {
  const phrases = buildMatchSearchPhrases(request).map((phrase) => `- ${phrase}`).join('\n');
  return `Find the exact Sofascore football match page for this match.

MATCH:
- Home team: ${request.homeTeam}
- Away team: ${request.awayTeam}
- Competition: ${request.league || 'unknown'}
- Match date: ${request.matchDate || 'today/unknown'}
- Known status: ${request.status || 'unknown'}
- Known score: ${request.score?.home ?? 'unknown'}-${request.score?.away ?? 'unknown'}

ALIAS QUERIES:
${phrases || '- (none)'}

RULES:
- Use Google Search grounding.
- Search specifically for Sofascore only.
- Prioritize an exact match page, not team page or tournament page.
- If exact match is not found, it is OK to return no useful text.
- Return plain text only.
`;
}

function buildStatsReferenceResolverPrompt(request: WebFallbackRequest): string {
  const phrases = buildMatchSearchPhrases(request).map((phrase) => `- ${phrase}`).join('\n');
  return `Find exact football live/stats reference pages for this match.

MATCH:
- Home team: ${request.homeTeam}
- Away team: ${request.awayTeam}
- Competition: ${request.league || 'unknown'}
- Match date: ${request.matchDate || 'today/unknown'}
- Known status: ${request.status || 'unknown'}
- Known score: ${request.score?.home ?? 'unknown'}-${request.score?.away ?? 'unknown'}

ALIAS QUERIES:
${phrases || '- (none)'}

TARGET DOMAINS:
- sofascore.com
- fotmob.com
- flashscore.com
- bing.com/sportsdetails

RULES:
- Use Google Search grounding.
- Search specifically for exact match pages on the target domains above.
- Prioritize pages that match BOTH teams and the known score/status.
- Team names may appear without the "W" suffix or as "Women".
- Return plain text only and include URLs when found.
`;
}

function buildOfficialEventsResolverPrompt(request: WebFallbackRequest): string {
  const phrases = buildMatchSearchPhrases(request).map((phrase) => `- ${phrase}`).join('\n');
  return `Find exact official or tier-1 live/article pages for this football match that can confirm events/timeline.

MATCH:
- Home team: ${request.homeTeam}
- Away team: ${request.awayTeam}
- Competition: ${request.league || 'unknown'}
- Match date: ${request.matchDate || 'today/unknown'}
- Known status: ${request.status || 'unknown'}
- Known score: ${request.score?.home ?? 'unknown'}-${request.score?.away ?? 'unknown'}

ALIAS QUERIES:
${phrases || '- (none)'}

TARGET SOURCE TYPES:
- official competition or federation pages
- official team match centres
- tier-1 sports/news pages with exact live match coverage

RULES:
- Use Google Search grounding.
- Prioritize official competition/federation pages first.
- If official pages are missing, use exact-match tier-1 live/news pages.
- Team names may appear without the "W" suffix or as "Women".
- Return plain text only and include URLs when found.
`;
}

async function searchGroundedSourcesOnly(
  prompt: string,
): Promise<{ text: string; sourceMeta: WebFallbackSourceMeta }> {
  const data = await generateGeminiContent(prompt, {
    withSearch: true,
    timeoutMs: SEARCH_TIMEOUT_MS,
    maxOutputTokens: 256,
    responseMimeType: 'text/plain',
    model: DEFAULT_MODEL,
  });
  return data ? {
    text: extractCandidateText(data),
    sourceMeta: extractGroundingMeta(data),
  } : {
    text: '',
    sourceMeta: {
      search_quality: 'unknown',
      web_search_queries: [],
      sources: [],
      trusted_source_count: 0,
      rejected_source_count: 0,
      rejected_domains: [],
    },
  };
}

async function enrichSourceMetaForRequestedSlots(
  request: WebFallbackRequest,
  sourceMeta: WebFallbackSourceMeta,
): Promise<WebFallbackSourceMeta> {
  let mergedMeta = sourceMeta;

  const targetedPrompts: string[] = [];
  if (request.requestedSlots.stats || request.requestedSlots.events) {
    targetedPrompts.push(buildStatsReferenceResolverPrompt(request));
  }
  if (request.requestedSlots.events) {
    targetedPrompts.push(buildOfficialEventsResolverPrompt(request));
  }

  for (const prompt of targetedPrompts) {
    const targeted = await searchGroundedSourcesOnly(prompt);
    const directSources = extractResolvedSourcesFromText(targeted.text);
    const extraMeta = directSources.length > 0
      ? mergeSourceMeta(
        targeted.sourceMeta,
        sourceMetaFromSources(directSources, targeted.sourceMeta.web_search_queries),
      )
      : targeted.sourceMeta;
    mergedMeta = mergeSourceMeta(mergedMeta, extraMeta);
  }

  return mergedMeta;
}

function toStructuredFromSofascore(extracted: Awaited<ReturnType<typeof fetchSofascoreMatchDataFromPageUrl>>): WebFallbackStructuredData {
  const normalizedStatus = (() => {
    const raw = extracted.match.status.toLowerCase();
    if (raw.includes('half')) return 'HT';
    if (raw.includes('end') || raw.includes('finish') || raw.includes('full')) return 'FT';
    return extracted.match.status;
  })();

  return {
    matched: true,
    matched_title: `${extracted.match.homeTeam} vs ${extracted.match.awayTeam}`,
    matched_url: extracted.finalUrl,
    home_team: extracted.match.homeTeam,
    away_team: extracted.match.awayTeam,
    competition: extracted.match.competition,
    status: normalizedStatus,
    minute: extracted.match.minute,
    score: extracted.match.score,
    stats: {
      possession: extracted.stats.possession,
      shots: extracted.stats.shots,
      shots_on_target: extracted.stats.shots_on_target,
      corners: extracted.stats.corners,
      fouls: extracted.stats.fouls,
      yellow_cards: extracted.stats.yellow_cards,
      red_cards: extracted.stats.red_cards,
    },
    events: extracted.events.map((event) => ({
      minute: event.minute,
      team: event.team,
      type: event.type,
      detail: event.detail,
      player: event.player,
    })),
    notes: 'Deterministic extractor via Sofascore JSON endpoints.',
  };
}

function toStructuredFromEspn(extracted: EspnExtractedMatchData): WebFallbackStructuredData {
  return {
    matched: true,
    matched_title: `${extracted.match.homeTeam} vs ${extracted.match.awayTeam}`,
    matched_url: extracted.urls.stats || extracted.urls.summary,
    home_team: extracted.match.homeTeam,
    away_team: extracted.match.awayTeam,
    competition: extracted.match.competition,
    status: extracted.match.status,
    minute: extracted.match.minute,
    score: extracted.match.score,
    stats: {
      possession: extracted.stats.possession,
      shots: extracted.stats.shots,
      shots_on_target: extracted.stats.shots_on_target,
      corners: extracted.stats.corners,
      fouls: extracted.stats.fouls,
      yellow_cards: extracted.stats.yellow_cards,
      red_cards: extracted.stats.red_cards,
    },
    events: extracted.events.map((event) => ({
      minute: event.minute,
      team: event.team,
      type: event.type,
      detail: event.detail,
      player: event.player,
    })),
    notes: 'Deterministic extractor via ESPN site API and stats page.',
  };
}

function toStructuredFromKLeaguePortal(extracted: KLeaguePortalExtractedMatchData): WebFallbackStructuredData {
  return {
    matched: true,
    matched_title: `${extracted.match.homeTeam} vs ${extracted.match.awayTeam}`,
    matched_url: extracted.urls.popup,
    home_team: extracted.match.homeTeam,
    away_team: extracted.match.awayTeam,
    competition: extracted.match.competition,
    status: extracted.match.status,
    minute: extracted.match.minute,
    score: extracted.match.score,
    stats: {
      possession: extracted.stats.possession,
      shots: extracted.stats.shots,
      shots_on_target: extracted.stats.shots_on_target,
      corners: extracted.stats.corners,
      fouls: extracted.stats.fouls,
      yellow_cards: extracted.stats.yellow_cards,
      red_cards: extracted.stats.red_cards,
    },
    events: extracted.events.map((event) => ({
      minute: event.minute,
      team: event.team,
      type: event.type,
      detail: event.detail,
      player: event.player,
    })),
    notes: 'Deterministic extractor via official K League portal popup data.',
  };
}

async function tryResolveSofascoreDataDeterministic(
  request: WebFallbackRequest,
  sourceMeta: WebFallbackSourceMeta,
): Promise<{ structured: WebFallbackStructuredData | null; sourceMeta: WebFallbackSourceMeta }> {
  const homeCandidates = await resolveSofascoreTeamCandidates(request.homeTeam);
  if (homeCandidates.length === 0) {
    return { structured: null, sourceMeta };
  }

  const awayCandidates = await resolveSofascoreTeamCandidates(request.awayTeam);
  const eventCandidates: ScoredSofascoreEventCandidate[] = [];

  for (const homeCandidate of homeCandidates.slice(0, 2)) {
    for (const bucket of ['last', 'next'] as const) {
      let events: SofascoreTeamEventSummary[] = [];
      try {
        events = await fetchSofascoreTeamEvents(homeCandidate.team.id, bucket);
      } catch {
        continue;
      }
      for (const event of events) {
        const score = scoreSofascoreEventCandidate(request, homeCandidate, awayCandidates, event);
        if (score >= 0.9) {
          eventCandidates.push({ event, score });
        }
      }
    }
  }

  const bestCandidate = eventCandidates.sort((a, b) => b.score - a.score)[0];
  if (!bestCandidate) {
    return { structured: null, sourceMeta };
  }

  const pageUrl = buildSofascoreMatchPageUrl(bestCandidate.event);
  try {
    const extracted = await fetchSofascoreMatchDataFromEventId(bestCandidate.event.id, { pageUrl });
    return {
      structured: toStructuredFromSofascore(extracted),
      sourceMeta: buildDeterministicSofascoreSourceMeta(request, sourceMeta, bestCandidate.event),
    };
  } catch {
    return { structured: null, sourceMeta };
  }
}

async function tryResolveSofascoreData(
  request: WebFallbackRequest,
  sourceMeta: WebFallbackSourceMeta,
  options?: { skipDeterministic?: boolean },
): Promise<{ structured: WebFallbackStructuredData | null; sourceMeta: WebFallbackSourceMeta }> {
  let mergedMeta = sourceMeta;
  let sofascoreSources = mergedMeta.sources.filter((source) => source.domain.includes('sofascore.com'));

  if (!options?.skipDeterministic) {
    const deterministic = await tryResolveSofascoreDataDeterministic(request, mergedMeta);
    if (deterministic.structured) {
      return deterministic;
    }
    mergedMeta = deterministic.sourceMeta;
  }

  if (sofascoreSources.length === 0) {
    const targeted = await searchGroundedSourcesOnly(buildSofascoreResolverPrompt(request));
    mergedMeta = mergeSourceMeta(mergedMeta, targeted.sourceMeta);
    const directUrlMatches = targeted.text.match(/https?:\/\/(?:www\.)?sofascore\.com[^\s)"]*/ig) || [];
    for (const url of directUrlMatches) {
      sofascoreSources.push({
        title: 'sofascore.com',
        url,
        domain: 'sofascore.com',
        publisher: 'sofascore.com',
        language: 'en',
        source_type: 'stats_reference',
        trust_tier: 'tier_2',
      });
    }
    sofascoreSources = mergedMeta.sources.filter((source) => source.domain.includes('sofascore.com'));
    if (directUrlMatches.length > 0) {
      sofascoreSources = [
        ...sofascoreSources,
        ...directUrlMatches.map((url) => ({
          title: 'sofascore.com',
          url,
          domain: 'sofascore.com',
          publisher: 'sofascore.com',
          language: 'en' as const,
          source_type: 'stats_reference' as const,
          trust_tier: 'tier_2' as const,
        })),
      ];
    }
  }

  for (const source of sofascoreSources) {
    try {
      const extracted = await fetchSofascoreMatchDataFromPageUrl(source.url);
      return {
        structured: toStructuredFromSofascore(extracted),
        sourceMeta: mergedMeta,
      };
    } catch {
      continue;
    }
  }

  return { structured: null, sourceMeta: mergedMeta };
}

function buildEspnSpiderQueryLabel(request: WebFallbackRequest): string {
  return `espn_site_api:${request.homeTeam} vs ${request.awayTeam}`;
}

function buildKLeaguePortalQueryLabel(request: WebFallbackRequest): string {
  return `kleague_portal:${request.homeTeam} vs ${request.awayTeam}`;
}

async function tryResolveKLeaguePortalDataDeterministic(
  request: WebFallbackRequest,
  sourceMeta: WebFallbackSourceMeta,
): Promise<{ structured: WebFallbackStructuredData | null; sourceMeta: WebFallbackSourceMeta }> {
  try {
    const extracted = await fetchKLeaguePortalMatchData({
      homeTeam: request.homeTeam,
      awayTeam: request.awayTeam,
      league: request.league,
      matchDate: request.matchDate,
      status: request.status,
      minute: request.minute,
      score: request.score,
      includeStats: Boolean(request.requestedSlots.stats),
      includeEvents: Boolean(request.requestedSlots.events),
    });
    if (!extracted) {
      return { structured: null, sourceMeta };
    }

    const sources = uniqueStrings([extracted.urls.calendar, extracted.urls.popup])
      .map((url) => sourceFromResolvedUrl(url, 'K League Portal'))
      .filter((source): source is WebFallbackSource => Boolean(source));
    const mergedMeta = sources.length > 0
      ? mergeSourceMeta(sourceMeta, sourceMetaFromSources(sources, [buildKLeaguePortalQueryLabel(request)]))
      : sourceMeta;

    return {
      structured: toStructuredFromKLeaguePortal(extracted),
      sourceMeta: mergedMeta,
    };
  } catch {
    return { structured: null, sourceMeta };
  }
}

async function tryResolveEspnDataDeterministic(
  request: WebFallbackRequest,
  sourceMeta: WebFallbackSourceMeta,
): Promise<{ structured: WebFallbackStructuredData | null; sourceMeta: WebFallbackSourceMeta }> {
  try {
    const extracted = await fetchEspnSoccerMatchData({
      homeTeam: request.homeTeam,
      awayTeam: request.awayTeam,
      league: request.league,
      matchDate: request.matchDate,
      status: request.status,
      score: request.score,
      includeStats: Boolean(request.requestedSlots.stats),
      includeEvents: Boolean(request.requestedSlots.events),
    });
    if (!extracted) {
      return { structured: null, sourceMeta };
    }

    const espnSources = uniqueStrings([extracted.urls.summary, extracted.urls.stats])
      .map((url) => sourceFromResolvedUrl(url, 'ESPN'))
      .filter((source): source is WebFallbackSource => Boolean(source));

    const mergedMeta = espnSources.length > 0
      ? mergeSourceMeta(sourceMeta, sourceMetaFromSources(espnSources, [buildEspnSpiderQueryLabel(request)]))
      : sourceMeta;

    return {
      structured: toStructuredFromEspn(extracted),
      sourceMeta: mergedMeta,
    };
  } catch {
    return { structured: null, sourceMeta };
  }
}

async function buildStructuredResult(
  request: WebFallbackRequest,
  draft: string,
  sourceMeta: WebFallbackSourceMeta,
  fetchedPages: FetchedSourcePage[],
): Promise<WebFallbackStructuredData> {
  const data = await generateGeminiContent(
    buildStructuredPrompt(draft, request, sourceMeta, fetchedPages),
    {
      withSearch: false,
      timeoutMs: STRUCTURE_TIMEOUT_MS,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      model: DEFAULT_STRUCTURED_MODEL,
    },
  );
  if (!data) {
    throw new Error('EMPTY_STRUCTURED_RESPONSE');
  }
  const text = extractCandidateText(data);
  const json = extractJsonString(text);
  if (!json) {
    throw new Error('STRUCTURED_RESPONSE_NOT_JSON');
  }
  return normalizeStructuredPayload(JSON.parse(json));
}

function emptySourceMeta(): WebFallbackSourceMeta {
  return {
    search_quality: 'unknown',
    web_search_queries: [],
    sources: [],
    trusted_source_count: 0,
    rejected_source_count: 0,
    rejected_domains: [],
  };
}

function compareStructuredCoverage(a: WebFallbackStructuredData | null, b: WebFallbackStructuredData | null): number {
  const aScore = (a ? countPrimaryStatPairs(a.stats) : 0) * 10 + (a?.events.length || 0);
  const bScore = (b ? countPrimaryStatPairs(b.stats) : 0) * 10 + (b?.events.length || 0);
  return aScore - bScore;
}

export async function fetchDeterministicWebLiveFallback(
  request: WebFallbackRequest,
): Promise<WebLiveFallbackResult> {
  let sourceMeta = emptySourceMeta();
  let bestStructured: WebFallbackStructuredData | null = null;
  let bestMeta = sourceMeta;
  const resolverErrors: string[] = [];

  const deterministicResolvers = [
    tryResolveKLeaguePortalDataDeterministic,
    tryResolveSofascoreDataDeterministic,
    tryResolveEspnDataDeterministic,
  ] as const;

  for (const resolver of deterministicResolvers) {
    let resolved: { structured: WebFallbackStructuredData | null; sourceMeta: WebFallbackSourceMeta };
    try {
      resolved = await resolver(request, sourceMeta);
    } catch (err) {
      resolverErrors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    sourceMeta = resolved.sourceMeta;
    if (!resolved.structured) continue;

    const validation = validateWebLiveFallbackResult(request, resolved.structured, sourceMeta);
    if (validation.accepted) {
      return {
        success: true,
        request,
        rawDraft: '',
        structured: resolved.structured,
        sourceMeta,
        fetchedPages: [],
        validation,
      };
    }

    if (!bestStructured || compareStructuredCoverage(resolved.structured, bestStructured) > 0) {
      bestStructured = resolved.structured;
      bestMeta = sourceMeta;
    }
  }

  if (bestStructured) {
    return {
      success: true,
      request,
      rawDraft: '',
      structured: bestStructured,
      sourceMeta: bestMeta,
      fetchedPages: [],
      validation: validateWebLiveFallbackResult(request, bestStructured, bestMeta),
    };
  }

  return {
    success: false,
    request,
    rawDraft: '',
    structured: null,
    sourceMeta,
    fetchedPages: [],
    validation: validateWebLiveFallbackResult(request, null, sourceMeta),
    error: resolverErrors.length > 0
      ? `NO_DETERMINISTIC_MATCH: ${resolverErrors.slice(0, 3).join(' | ')}`
      : 'NO_DETERMINISTIC_MATCH',
  };
}

export async function fetchWebLiveFallback(
  request: WebFallbackRequest,
): Promise<WebLiveFallbackResult> {
  let rawDraft = '';
  let sourceMeta: WebFallbackSourceMeta = emptySourceMeta();
  let fetchedPages: FetchedSourcePage[] = [];

  try {
    const deterministic = await fetchDeterministicWebLiveFallback(request);
    if (deterministic.validation.accepted) {
      return deterministic;
    }
    if (deterministic.structured) {
      sourceMeta = deterministic.sourceMeta;
    }

    const grounded = await fetchGroundedDraft(request);
    rawDraft = grounded.draft;
    sourceMeta = mergeSourceMeta(
      grounded.sourceMeta,
      sourceMetaFromSources(extractDraftSources(grounded.draft), grounded.sourceMeta.web_search_queries),
    );
    sourceMeta = await enrichSourceMetaForRequestedSlots(request, sourceMeta);
    const deterministicDraftStructured = buildDeterministicDraftEventResult(request, grounded.draft);
    if (deterministicDraftStructured) {
      const validation = validateWebLiveFallbackResult(request, deterministicDraftStructured, sourceMeta);
      if (validation.accepted) {
        return {
          success: true,
          request,
          rawDraft,
          structured: deterministicDraftStructured,
          sourceMeta,
          fetchedPages,
          validation,
        };
      }
    }
    const resolvedSofascore = await tryResolveSofascoreData(request, sourceMeta, { skipDeterministic: true });
    sourceMeta = resolvedSofascore.sourceMeta;
    if (resolvedSofascore.structured) {
      const validation = validateWebLiveFallbackResult(request, resolvedSofascore.structured, sourceMeta);
      if (validation.accepted) {
        return {
          success: true,
          request,
          rawDraft,
          structured: resolvedSofascore.structured,
          sourceMeta,
          fetchedPages,
          validation,
        };
      }
    }

    fetchedPages = await fetchCandidatePages(sourceMeta, request.requestedSlots);
    sourceMeta = mergeSourceMeta(sourceMeta, sourceMetaFromFetchedPages(fetchedPages, sourceMeta.web_search_queries));
    const structured = await buildStructuredResult(request, grounded.draft, sourceMeta, fetchedPages);
    const validation = validateWebLiveFallbackResult(request, structured, sourceMeta);
    return {
      success: true,
      request,
      rawDraft,
      structured,
      sourceMeta,
      fetchedPages,
      validation,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      request,
      rawDraft,
      structured: null,
      sourceMeta,
      fetchedPages,
      validation: validateWebLiveFallbackResult(request, null, sourceMeta),
      error,
    };
  }
}
