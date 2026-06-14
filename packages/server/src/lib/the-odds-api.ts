import { recordProviderRequestSafe } from '../repos/provider-request-ledger.repo.js';
import { THE_ODDS_API_PROVIDER, type TheOddsApiEventLike } from './canonical/the-odds-api-adapter.js';

const DEFAULT_THE_ODDS_API_BASE_URL = 'https://api.the-odds-api.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ODDS_MARKETS = 'h2h,spreads,totals';
const SUPPORTED_ODDS_MARKETS = new Set(['h2h', 'spreads', 'totals']);

export interface TheOddsApiRequestOptions {
  consumer?: string;
  jobName?: string;
  timeoutMs?: number;
}

export interface TheOddsApiQuota {
  requestsRemaining: number | null;
  requestsUsed: number | null;
  requestsLast: number | null;
}

export interface TheOddsApiCallResult<T> {
  data: T[];
  raw: T[];
  statusCode: number;
  latencyMs: number;
  quota: TheOddsApiQuota;
}

export interface FetchTheOddsApiOddsInput extends TheOddsApiRequestOptions {
  sportKey: string;
  regions?: string;
  markets?: string;
  oddsFormat?: 'decimal' | 'american';
  dateFormat?: 'iso' | 'unix';
  eventIds?: string[];
  bookmakers?: string;
  commenceTimeFrom?: string;
  commenceTimeTo?: string;
}

function token(): string {
  return process.env['THEODDSAPI_API_TOKEN']
    || process.env['THE_ODDS_API_TOKEN']
    || process.env['THE_ODDS_API_KEY']
    || '';
}

function baseUrl(): string {
  return (process.env['THEODDSAPI_BASE_URL']
    || process.env['THE_ODDS_API_BASE_URL']
    || DEFAULT_THE_ODDS_API_BASE_URL).replace(/\/+$/, '');
}

function timeoutMs(options: TheOddsApiRequestOptions): number {
  return options.timeoutMs
    ?? Number(process.env['THEODDSAPI_API_TIMEOUT_MS'] || process.env['THE_ODDS_API_TIMEOUT_MS'] || DEFAULT_TIMEOUT_MS);
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resultCount(value: unknown): number {
  return Array.isArray(value) ? value.length : value == null ? 0 : 1;
}

function parseQuota(headers: Headers): TheOddsApiQuota {
  return {
    requestsRemaining: numberOrNull(headers.get('x-requests-remaining')),
    requestsUsed: numberOrNull(headers.get('x-requests-used')),
    requestsLast: numberOrNull(headers.get('x-requests-last')),
  };
}

function quotaCurrent(quota: TheOddsApiQuota): number | null {
  return quota.requestsUsed;
}

function quotaLimit(quota: TheOddsApiQuota): number | null {
  if (quota.requestsUsed == null || quota.requestsRemaining == null) return null;
  return quota.requestsUsed + quota.requestsRemaining;
}

function redactParams(params: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    redacted[key] = key.toLowerCase().includes('apikey') || key.toLowerCase().includes('api_key')
      ? '[redacted]'
      : value;
  }
  return redacted;
}

function serializeErrorPayload(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeMarkets(value: string): string {
  const markets = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .filter((item) => SUPPORTED_ODDS_MARKETS.has(item));
  return markets.length > 0 ? markets.join(',') : DEFAULT_ODDS_MARKETS;
}

function formatCommenceTime(value: string): string {
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return trimmed.replace(/\.\d{3}Z$/, 'Z');
}

function buildOddsParams(input: FetchTheOddsApiOddsInput): Record<string, string> {
  const rawMarkets = input.markets ?? process.env['THEODDSAPI_MARKETS'] ?? process.env['THE_ODDS_API_MARKETS'] ?? DEFAULT_ODDS_MARKETS;
  const params: Record<string, string> = {
    apiKey: token(),
    regions: input.regions ?? process.env['THEODDSAPI_REGIONS'] ?? process.env['THE_ODDS_API_REGIONS'] ?? 'eu,uk,us',
    markets: sanitizeMarkets(rawMarkets),
    oddsFormat: input.oddsFormat ?? 'decimal',
    dateFormat: input.dateFormat ?? 'iso',
  };
  if (input.eventIds?.length) params.eventIds = input.eventIds.join(',');
  if (input.bookmakers) params.bookmakers = input.bookmakers;
  if (input.commenceTimeFrom) params.commenceTimeFrom = formatCommenceTime(input.commenceTimeFrom);
  if (input.commenceTimeTo) params.commenceTimeTo = formatCommenceTime(input.commenceTimeTo);
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ''));
}

function buildUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(`${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export function inferTheOddsApiQuotaState(quota: TheOddsApiQuota, statusCode?: number | null) {
  if (statusCode === 429) return 'daily_limit' as const;
  if (quota.requestsRemaining == null || quota.requestsUsed == null) return 'unknown' as const;
  const total = quota.requestsRemaining + quota.requestsUsed;
  if (total <= 0) return 'unknown' as const;
  const usedPct = (quota.requestsUsed / total) * 100;
  if (quota.requestsRemaining <= 0) return 'daily_limit' as const;
  if (usedPct >= 95) return 'critical' as const;
  if (usedPct >= 80) return 'high' as const;
  if (usedPct >= 60) return 'elevated' as const;
  return 'ok' as const;
}

export async function theOddsApiGet<T>(
  path: string,
  params: Record<string, string>,
  options: TheOddsApiRequestOptions = {},
): Promise<TheOddsApiCallResult<T>> {
  if (!token()) throw new Error('THEODDSAPI_API_TOKEN not configured');
  const url = buildUrl(path, params);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(options));

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    const latencyMs = Date.now() - startedAt;
    const quota = parseQuota(res.headers);
    const parsed = text ? JSON.parse(text) : [];

    if (!res.ok) {
      const error = serializeErrorPayload(parsed).slice(0, 500);
      await recordProviderRequestSafe({
        provider: THE_ODDS_API_PROVIDER,
        jobName: options.jobName ?? null,
        consumer: options.consumer ?? null,
        endpoint: path,
        params: redactParams(params),
        attempt: 1,
        success: false,
        rateLimited: res.status === 429,
        statusCode: res.status,
        latencyMs,
        quotaCurrent: quotaCurrent(quota),
        quotaLimit: quotaLimit(quota),
        error,
        responseMeta: { quota },
      });
      throw new Error(`The Odds API ${res.status}: ${error}`);
    }

    const raw = Array.isArray(parsed) ? parsed as T[] : [];
    await recordProviderRequestSafe({
      provider: THE_ODDS_API_PROVIDER,
      jobName: options.jobName ?? null,
      consumer: options.consumer ?? null,
      endpoint: path,
      params: redactParams(params),
      attempt: 1,
      success: true,
      rateLimited: false,
      statusCode: res.status,
      latencyMs,
      resultCount: resultCount(raw),
      quotaCurrent: quotaCurrent(quota),
      quotaLimit: quotaLimit(quota),
      responseMeta: { quota },
    });

    return { data: raw, raw, statusCode: res.status, latencyMs, quota };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    if (!error.startsWith('The Odds API ')) {
      await recordProviderRequestSafe({
        provider: THE_ODDS_API_PROVIDER,
        jobName: options.jobName ?? null,
        consumer: options.consumer ?? null,
        endpoint: path,
        params: redactParams(params),
        attempt: 1,
        success: false,
        statusCode: null,
        latencyMs,
        error,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTheOddsApiOdds(input: FetchTheOddsApiOddsInput): Promise<TheOddsApiCallResult<TheOddsApiEventLike>> {
  const path = `/v4/sports/${encodeURIComponent(input.sportKey)}/odds`;
  return theOddsApiGet<TheOddsApiEventLike>(path, buildOddsParams(input), input);
}
