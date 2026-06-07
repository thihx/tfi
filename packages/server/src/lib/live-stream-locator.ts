import { config } from '../config.js';
import type { MatchRow } from '../repos/matches.repo.js';
import { validateLiveStreamProviderUrls } from './live-stream-settings.js';
import { expandTeamAliases } from './live-stream-team-aliases.js';
import { mentionsMatchWithContext as matchWithContextSignals } from './live-stream-match-signals.js';

export type LiveStreamLookupStatus = 'found' | 'not_found' | 'not_live' | 'disabled' | 'error';

export interface LiveStreamProvider {
  name: string;
  url: string;
  hostname: string;
}

export type LiveStreamLinkVerificationStatus = 'team_match' | 'reachable';

export interface LiveStreamLink {
  url: string;
  sourceName: string;
  sourceUrl: string;
  title: string;
  verificationStatus: LiveStreamLinkVerificationStatus;
  liveHint: boolean;
}

export interface LiveStreamLookupResult {
  matchId: string;
  found: boolean;
  status: LiveStreamLookupStatus;
  url: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  title: string | null;
  links: LiveStreamLink[];
  checkedAt: string;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface LiveStreamLookupOptions {
  providers?: LiveStreamProvider[];
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  cacheTtlMs?: number;
  useCache?: boolean;
  enabled?: boolean;
  cacheKeySalt?: string;
}

interface ProviderPage {
  provider: LiveStreamProvider;
  url: string;
  html: string;
}

interface AnchorLink {
  url: string;
  text: string;
}

interface StructuredProviderMatch {
  homeName: string;
  awayName: string;
  slug: string;
}

interface FetchHtmlResult {
  html: string | null;
  status: number | null;
}

const MAX_HTML_CHARS = 700_000;
const MAX_DISCOVERY_LINKS_PER_PROVIDER = 3;
const MAX_ALIAS_POSITIONS = 18;
const MAX_TEAM_NAME_DISTANCE = 180;

const DISCOVERY_HINTS = [
  'truc tiep',
  'tructiep',
  'live',
  'lich',
  'bong da',
  'football',
  'soccer',
  'xem',
  'match',
  'schedule',
] as const;

const LIVE_PAGE_HINTS = [
  'embed',
  'iframe',
  'live',
  'm3u8',
  'player',
  'stream',
  'truc tiep',
  'tructiep',
  'video',
  'xem',
] as const;

const DROPPED_TEAM_TOKENS = new Set([
  'afc',
  'cf',
  'club',
  'fc',
  'fk',
  'sc',
]);

const SINGLE_ALIAS_DENY = new Set([
  'city',
  'club',
  'real',
  'sporting',
  'team',
  'united',
]);

const resultCache = new Map<string, { expiresAt: number; result: LiveStreamLookupResult }>();

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function parseLiveStreamProviderUrls(urls: readonly string[] = config.liveStreamProviderUrls): LiveStreamProvider[] {
  const providers = new Map<string, LiveStreamProvider>();
  for (const raw of urls) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
      parsed.hash = '';
      const hostname = normalizeHostname(parsed.hostname);
      providers.set(parsed.toString(), {
        name: hostname,
        url: parsed.toString(),
        hostname,
      });
    } catch {
      // Ignore invalid allowlist entries. The server config is the source of truth.
    }
  }
  return [...providers.values()];
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/&amp;/gi, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueSortedAliases(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
    .filter((alias) => {
      const tokens = alias.split(' ').filter(Boolean);
      if (tokens.length === 0 || alias.length < 3) return false;
      if (tokens.length === 1 && (alias.length < 4 || SINGLE_ALIAS_DENY.has(alias))) return false;
      return true;
    })
    .sort((a, b) => b.length - a.length);
}

function distinctiveSingleTokenAliases(value: string): string[] {
  return value
    .split(' ')
    .filter((token) => (
      token.length >= 5
      && !DROPPED_TEAM_TOKENS.has(token)
      && !SINGLE_ALIAS_DENY.has(token)
    ));
}

export function buildTeamAliases(teamName: string): string[] {
  const normalized = normalizeSearchText(teamName);
  const noParentheses = normalizeSearchText(teamName.replace(/\([^)]*\)/g, ' '));
  const withoutSportTokens = normalized
    .split(' ')
    .filter((token) => !DROPPED_TEAM_TOKENS.has(token))
    .join(' ');
  const baseAliases = [
    normalized,
    noParentheses,
    withoutSportTokens,
    ...distinctiveSingleTokenAliases(withoutSportTokens),
  ];
  return uniqueSortedAliases(expandTeamAliases(normalized, baseAliases));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findAliasPositions(normalizedText: string, alias: string): number[] {
  const positions: number[] = [];
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?=\\s|$)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalizedText)) && positions.length < MAX_ALIAS_POSITIONS) {
    positions.push(match.index + (match[0].startsWith(' ') ? 1 : 0));
    if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
  }
  return positions;
}

function mentionsMatch(rawText: string, homeAliases: readonly string[], awayAliases: readonly string[]): boolean {
  const normalized = normalizeSearchText(rawText);
  if (!normalized || homeAliases.length === 0 || awayAliases.length === 0) return false;

  for (const homeAlias of homeAliases) {
    const homePositions = findAliasPositions(normalized, homeAlias);
    if (homePositions.length === 0) continue;
    for (const awayAlias of awayAliases) {
      const awayPositions = findAliasPositions(normalized, awayAlias);
      if (awayPositions.length === 0) continue;
      for (const homePos of homePositions) {
        for (const awayPos of awayPositions) {
          if (Math.abs(homePos - awayPos) <= MAX_TEAM_NAME_DISTANCE) return true;
        }
      }
    }
  }
  return false;
}

function mentionsMatchForProvider(
  rawText: string,
  match: MatchRow,
  homeAliases: string[],
  awayAliases: string[],
): boolean {
  return matchWithContextSignals(rawText, match, homeAliases, awayAliases, mentionsMatch);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key === 'amp') return '&';
    if (key === 'apos') return "'";
    if (key === 'gt') return '>';
    if (key === 'lt') return '<';
    if (key === 'nbsp') return ' ';
    if (key === 'quot') return '"';
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameProviderUrl(rawHref: string, baseUrl: string, provider: LiveStreamProvider): string | null {
  const href = decodeHtmlEntities(rawHref).trim();
  if (!href || href.startsWith('#') || /^javascript:/i.test(href) || /^mailto:/i.test(href)) return null;
  try {
    const parsed = new URL(href, baseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (normalizeHostname(parsed.hostname) !== provider.hostname) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function readAnchorAttr(attrs: string, name: string): string {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = attrs.match(pattern);
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function extractAnchors(html: string, baseUrl: string, provider: LiveStreamProvider): AnchorLink[] {
  const anchors: AnchorLink[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html))) {
    const attrs = match[1] ?? '';
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '';
    const url = sameProviderUrl(rawHref, baseUrl, provider);
    if (!url) continue;
    const text = [
      stripTags(match[2] ?? ''),
      readAnchorAttr(attrs, 'title'),
      readAnchorAttr(attrs, 'aria-label'),
    ].filter(Boolean).join(' ');
    anchors.push({ url, text });
  }
  return anchors;
}

function isDiscoveryLink(anchor: AnchorLink): boolean {
  const normalized = normalizeSearchText(`${anchor.text} ${anchor.url}`);
  return DISCOVERY_HINTS.some((hint) => normalized.includes(hint));
}

export function extractStructuredProviderMatches(html: string): StructuredProviderMatch[] {
  const scriptMatch = html.match(/<script\b[^>]*\bid=["']matches-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch?.[1]) return [];
  try {
    const parsed = JSON.parse(scriptMatch[1]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      const homeName = typeof record.home_name === 'string' ? record.home_name.trim() : '';
      const awayName = typeof record.away_name === 'string' ? record.away_name.trim() : '';
      const slug = typeof record.post_name === 'string' ? record.post_name.trim() : '';
      if (!homeName || !awayName || !slug) return [];
      return [{ homeName, awayName, slug }];
    });
  } catch {
    return [];
  }
}

export function extractGridProviderMatches(html: string): StructuredProviderMatch[] {
  const results: StructuredProviderMatch[] = [];
  const blockPattern = /<a\b[^>]*\bhref\s*=\s*["']([^"']*\/truc-tiep\/([^"'/?#]+))\/?[^"']*["'][^>]*>[\s\S]{0,5000}?grid-match__team--home-name">\s*([^<]+?)\s*<[\s\S]{0,2500}?grid-match__team--away-name">\s*([^<]+?)\s*</gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) && results.length < 250) {
    const slug = decodeHtmlEntities(match[2]?.trim() ?? '');
    const homeName = stripTags(match[3]?.trim() ?? '');
    const awayName = stripTags(match[4]?.trim() ?? '');
    if (!slug || !homeName || !awayName) continue;
    results.push({ homeName, awayName, slug });
  }
  return results;
}

function extractAllStructuredProviderMatches(html: string): StructuredProviderMatch[] {
  const bySlug = new Map<string, StructuredProviderMatch>();
  for (const entry of [...extractStructuredProviderMatches(html), ...extractGridProviderMatches(html)]) {
    bySlug.set(entry.slug, entry);
  }
  return [...bySlug.values()];
}

function buildProviderMatchUrl(provider: LiveStreamProvider, slug: string): string | null {
  const trimmedSlug = slug.replace(/^\/+|\/+$/g, '');
  if (!trimmedSlug) return null;
  try {
    const parsed = new URL(provider.url);
    parsed.hash = '';
    const basePath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${basePath}/truc-tiep/${trimmedSlug}/`.replace(/\/{2,}/g, '/');
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchHtmlWithStatus(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<FetchHtmlResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'TFI-LiveStreamLocator/1.0',
      },
      signal: controller.signal,
    });
    if (!response.ok) return { html: null, status: response.status };
    const text = await response.text();
    return { html: text.slice(0, MAX_HTML_CHARS), status: response.status };
  } catch {
    return { html: null, status: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<string | null> {
  return (await fetchHtmlWithStatus(url, fetchImpl, timeoutMs)).html;
}

async function loadProviderPages(
  provider: LiveStreamProvider,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<ProviderPage[]> {
  const homeHtml = await fetchHtml(provider.url, fetchImpl, timeoutMs);
  if (!homeHtml) return [];

  const pageUrls = new Set<string>([provider.url]);
  for (const anchor of extractAnchors(homeHtml, provider.url, provider)) {
    if (pageUrls.size >= MAX_DISCOVERY_LINKS_PER_PROVIDER + 1) break;
    if (isDiscoveryLink(anchor)) pageUrls.add(anchor.url);
  }

  const extraUrls = [...pageUrls].slice(1);
  const extraPages = await Promise.all(
    extraUrls.map(async (url) => {
      const html = await fetchHtml(url, fetchImpl, timeoutMs);
      return html ? { provider, url, html } : null;
    }),
  );

  return [
    { provider, url: provider.url, html: homeHtml },
    ...extraPages.filter((page): page is ProviderPage => page != null),
  ];
}

function hasLivePageHint(value: string): boolean {
  const normalized = normalizeSearchText(value);
  return LIVE_PAGE_HINTS.some((hint) => normalized.includes(hint));
}

async function verifyStreamLink(
  link: Omit<LiveStreamLink, 'verificationStatus' | 'liveHint'>,
  html: string | null,
  match: MatchRow,
  homeAliases: string[],
  awayAliases: string[],
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<LiveStreamLink | null> {
  const fetched = html == null ? await fetchHtmlWithStatus(link.url, fetchImpl, timeoutMs) : null;
  const candidateHtml = html ?? fetched?.html ?? null;
  if (candidateHtml == null) {
    const verificationBlocked = fetched?.status === 403 || fetched?.status === 429;
    if (!verificationBlocked) return null;
    const linkMatchesTeams = mentionsMatchForProvider(`${link.title} ${link.url}`, match, homeAliases, awayAliases);
    if (!linkMatchesTeams) return null;
    return {
      ...link,
      verificationStatus: 'team_match',
      liveHint: hasLivePageHint(`${link.title} ${link.url}`),
    };
  }
  const text = stripTags(candidateHtml);
  const contentMatchesTeams = mentionsMatchForProvider(text, match, homeAliases, awayAliases);
  return {
    ...link,
    verificationStatus: contentMatchesTeams ? 'team_match' : 'reachable',
    liveHint: hasLivePageHint(`${link.title} ${link.url} ${text}`),
  };
}

async function findStreamsInPages(
  match: MatchRow,
  pages: ProviderPage[],
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<LiveStreamLink[]> {
  const homeAliases = buildTeamAliases(match.home_team);
  const awayAliases = buildTeamAliases(match.away_team);
  if (homeAliases.length === 0 || awayAliases.length === 0) return [];

  const linksByUrl = new Map<string, {
    base: Omit<LiveStreamLink, 'verificationStatus' | 'liveHint'>;
    html: string | null;
  }>();

  for (const page of pages) {
    for (const anchor of extractAnchors(page.html, page.url, page.provider)) {
      const searchable = `${anchor.text} ${anchor.url}`;
      if (!mentionsMatchForProvider(searchable, match, homeAliases, awayAliases)) continue;
      if (linksByUrl.has(anchor.url)) continue;
      linksByUrl.set(anchor.url, {
        base: {
          url: anchor.url,
          sourceName: page.provider.name,
          sourceUrl: page.provider.url,
          title: anchor.text || `${match.home_team} vs ${match.away_team}`,
        },
        html: pages.find((candidate) => candidate.url === anchor.url)?.html ?? null,
      });
    }
  }

  for (const page of pages) {
    for (const structured of extractAllStructuredProviderMatches(page.html)) {
      const searchable = `${structured.homeName} ${structured.awayName} ${structured.slug}`;
      if (!mentionsMatchForProvider(searchable, match, homeAliases, awayAliases)) continue;
      const url = buildProviderMatchUrl(page.provider, structured.slug);
      if (!url || linksByUrl.has(url)) continue;
      linksByUrl.set(url, {
        base: {
          url,
          sourceName: page.provider.name,
          sourceUrl: page.provider.url,
          title: `${structured.homeName} vs ${structured.awayName}`,
        },
        html: pages.find((candidate) => candidate.url === url)?.html ?? null,
      });
    }
  }

  for (const page of pages) {
    if (page.url === page.provider.url) continue;
    if (!mentionsMatchForProvider(stripTags(page.html), match, homeAliases, awayAliases)) continue;
    if (linksByUrl.has(page.url)) continue;
    linksByUrl.set(page.url, {
      base: {
        url: page.url,
        sourceName: page.provider.name,
        sourceUrl: page.provider.url,
        title: `${match.home_team} vs ${match.away_team}`,
      },
      html: page.html,
    });
  }

  const verified = await Promise.all(
    [...linksByUrl.values()].map((candidate) => (
      verifyStreamLink(candidate.base, candidate.html, match, homeAliases, awayAliases, fetchImpl, timeoutMs)
    )),
  );

  const byProvider = new Map<string, LiveStreamLink>();
  for (const link of verified) {
    if (!link) continue;
    const existing = byProvider.get(link.sourceName);
    if (!existing || (existing.verificationStatus !== 'team_match' && link.verificationStatus === 'team_match')) {
      byProvider.set(link.sourceName, link);
    }
  }
  return [...byProvider.values()];
}

function resultFor(
  match: MatchRow,
  status: LiveStreamLookupStatus,
  checkedAt: string,
  patch: Partial<LiveStreamLookupResult> = {},
): LiveStreamLookupResult {
  return {
    matchId: String(match.match_id),
    found: status === 'found',
    status,
    url: null,
    sourceName: null,
    sourceUrl: null,
    title: null,
    links: [],
    checkedAt,
    ...patch,
  };
}

function cacheKey(match: MatchRow, salt: string): string {
  return [
    salt,
    match.match_id,
    String(match.status || '').toUpperCase(),
    normalizeSearchText(match.home_team),
    normalizeSearchText(match.away_team),
  ].join('|');
}

function readCache(match: MatchRow, nowMs: number, salt: string): LiveStreamLookupResult | null {
  const cached = resultCache.get(cacheKey(match, salt));
  if (!cached || cached.expiresAt <= nowMs) return null;
  return cached.result;
}

function writeCache(match: MatchRow, result: LiveStreamLookupResult, nowMs: number, ttlMs: number, salt: string): void {
  resultCache.set(cacheKey(match, salt), { result, expiresAt: nowMs + ttlMs });
}

export function clearLiveStreamLookupCache(): void {
  resultCache.clear();
}

export const clearLiveStreamLookupCacheForTests = clearLiveStreamLookupCache;

export async function lookupLiveStreamLinks(
  matches: MatchRow[],
  options: LiveStreamLookupOptions = {},
): Promise<LiveStreamLookupResult[]> {
  const now = options.now?.() ?? new Date();
  const checkedAt = now.toISOString();
  const nowMs = now.getTime();
  const providers = options.providers ?? parseLiveStreamProviderUrls();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(500, options.timeoutMs ?? config.liveStreamLocatorTimeoutMs);
  const cacheTtlMs = Math.max(15_000, options.cacheTtlMs ?? config.liveStreamLocatorCacheTtlMs);
  const useCache = options.useCache !== false;
  const enabled = options.enabled ?? config.liveStreamLocatorEnabled;
  const cacheKeySalt = options.cacheKeySalt ?? [
    enabled ? 'enabled' : 'disabled',
    ...providers.map((provider) => provider.url),
  ].join('|');
  const liveStatuses = new Set(config.liveStatuses.map((status) => status.toUpperCase()));

  const results = new Map<string, LiveStreamLookupResult>();
  const scanCandidates: MatchRow[] = [];

  for (const match of matches) {
    const matchId = String(match.match_id);
    const isLive = liveStatuses.has(String(match.status || '').toUpperCase());
    if (!isLive) {
      results.set(matchId, resultFor(match, 'not_live', checkedAt));
      continue;
    }
    if (!enabled || providers.length === 0) {
      const disabled = resultFor(match, 'disabled', checkedAt);
      results.set(matchId, disabled);
      if (useCache) writeCache(match, disabled, nowMs, cacheTtlMs, cacheKeySalt);
      continue;
    }
    const cached = useCache ? readCache(match, nowMs, cacheKeySalt) : null;
    if (cached) {
      results.set(matchId, cached);
      continue;
    }
    scanCandidates.push(match);
  }

  if (scanCandidates.length > 0) {
    const pagesByProvider = await Promise.all(
      providers.map((provider) => loadProviderPages(provider, fetchImpl, timeoutMs)),
    );
    const pages = pagesByProvider.flat();

    for (const match of scanCandidates) {
      const links = await findStreamsInPages(match, pages, fetchImpl, timeoutMs);
      const first = links[0] ?? null;
      const result = first
        ? resultFor(match, 'found', checkedAt, {
            url: first.url,
            sourceName: first.sourceName,
            sourceUrl: first.sourceUrl,
            title: first.title,
            links,
          })
        : resultFor(match, pages.length > 0 ? 'not_found' : 'error', checkedAt);
      results.set(String(match.match_id), result);
      if (useCache) writeCache(match, result, nowMs, cacheTtlMs, cacheKeySalt);
    }
  }

  return matches.map((match) => results.get(String(match.match_id)) ?? resultFor(match, 'error', checkedAt));
}

export interface LiveStreamProviderProbeResult {
  url: string;
  hostname: string;
  reachable: boolean;
  httpStatus: number | null;
  error: string | null;
  anchorLinkCount: number;
  structuredMatchCount: number;
  gridMatchCount: number;
  discoveryLinkCount: number;
  detectedParsers: string[];
}

export async function probeLiveStreamProvider(
  rawUrl: string,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<LiveStreamProviderProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(500, options.timeoutMs ?? config.liveStreamLocatorTimeoutMs);
  const providers = parseLiveStreamProviderUrls([rawUrl]);
  if (providers.length === 0) {
    return {
      url: rawUrl.trim(),
      hostname: '',
      reachable: false,
      httpStatus: null,
      error: 'Invalid provider URL.',
      anchorLinkCount: 0,
      structuredMatchCount: 0,
      gridMatchCount: 0,
      discoveryLinkCount: 0,
      detectedParsers: [],
    };
  }

  const provider = providers[0]!;
  const fetched = await fetchHtmlWithStatus(provider.url, fetchImpl, timeoutMs);
  if (!fetched.html) {
    return {
      url: provider.url,
      hostname: provider.hostname,
      reachable: false,
      httpStatus: fetched.status,
      error: fetched.status == null ? 'Request failed or timed out.' : `Homepage returned HTTP ${fetched.status}.`,
      anchorLinkCount: 0,
      structuredMatchCount: 0,
      gridMatchCount: 0,
      discoveryLinkCount: 0,
      detectedParsers: [],
    };
  }

  const anchors = extractAnchors(fetched.html, provider.url, provider);
  const structuredMatches = extractStructuredProviderMatches(fetched.html);
  const gridMatches = extractGridProviderMatches(fetched.html);
  const discoveryLinkCount = anchors.filter((anchor) => isDiscoveryLink(anchor)).length;
  const detectedParsers: string[] = [];
  if (anchors.length > 0) detectedParsers.push('anchors');
  if (structuredMatches.length > 0) detectedParsers.push('matches-data');
  if (gridMatches.length > 0) detectedParsers.push('grid-match');

  return {
    url: provider.url,
    hostname: provider.hostname,
    reachable: true,
    httpStatus: fetched.status,
    error: null,
    anchorLinkCount: anchors.length,
    structuredMatchCount: structuredMatches.length,
    gridMatchCount: gridMatches.length,
    discoveryLinkCount,
    detectedParsers,
  };
}

export async function probeLiveStreamProviders(
  urls: readonly string[],
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<LiveStreamProviderProbeResult[]> {
  const validated = validateLiveStreamProviderUrls(urls);
  if (validated.error) {
    throw new Error(validated.error);
  }
  return Promise.all(validated.urls.map((url) => probeLiveStreamProvider(url, options)));
}
