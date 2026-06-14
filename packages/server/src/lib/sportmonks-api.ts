import { recordProviderRequestSafe } from '../repos/provider-request-ledger.repo.js';
import {
  normalizeSportmonksFixture,
  type NormalizedSportmonksFixture,
  type SportmonksFixtureLike,
} from './sportmonks-normalize.js';

export const SPORTMONKS_PROVIDER = 'sportmonks';
const DEFAULT_SPORTMONKS_API_BASE_URL = 'https://api.sportmonks.com/v3/football';
const DEFAULT_SPORTMONKS_API_TIMEOUT_MS = 15_000;

interface SportmonksResponse<T> {
  data: T | T[];
  pagination?: unknown;
  rate_limit?: unknown;
  subscription?: unknown;
  timezone?: unknown;
}

export interface SportmonksRateLimit {
  remaining: number | null;
  resetsInSeconds: number | null;
  requestedEntity: string | null;
}

export interface SportmonksRequestOptions {
  consumer?: string;
  jobName?: string;
  timeoutMs?: number;
}

export interface SportmonksCallResult<T> {
  data: T[];
  raw: SportmonksResponse<T>;
  statusCode: number;
  latencyMs: number;
  rateLimit: SportmonksRateLimit | null;
}

const DEFAULT_FIXTURE_INCLUDES = [
  'participants',
  'league',
  'state',
  'scores',
  'events',
  'statistics',
  'periods',
].join(';');

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function redactParams(params: Record<string, string>): Record<string, string> {
  const redacted = { ...params };
  delete redacted['api_token'];
  return redacted;
}

function resultCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value == null ? 0 : 1;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function parseSportmonksRateLimit(value: unknown): SportmonksRateLimit | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  return {
    remaining: numberOrNull(row['remaining']),
    resetsInSeconds: numberOrNull(row['resets_in_seconds']),
    requestedEntity: stringOrNull(row['requested_entity']),
  };
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

function buildUrl(endpoint: string, params: Record<string, string>): URL {
  const base = (
    process.env['SPORTMONKS_API_BASE_URL']
    || process.env['SPORTMONKS_BASE_URL']
    || DEFAULT_SPORTMONKS_API_BASE_URL
  ).replace(/\/+$/, '');
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== '') url.searchParams.set(key, value);
  }
  url.searchParams.set('api_token', sportmonksToken());
  return url;
}

function sportmonksToken(): string {
  return process.env['SPORTMONKS_API_TOKEN'] || '';
}

export async function sportmonksGet<T>(
  endpoint: string,
  params: Record<string, string> = {},
  options: SportmonksRequestOptions = {},
): Promise<SportmonksCallResult<T>> {
  if (!sportmonksToken()) throw new Error('SPORTMONKS_API_TOKEN not configured');

  const url = buildUrl(endpoint, params);
  const timeoutMs = options.timeoutMs ?? Number(process.env['SPORTMONKS_API_TIMEOUT_MS'] || DEFAULT_SPORTMONKS_API_TIMEOUT_MS);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    const latencyMs = Date.now() - startedAt;
    const parsed = text ? JSON.parse(text) as SportmonksResponse<T> & { message?: unknown; errors?: unknown } : { data: [] };
    const rateLimit = parseSportmonksRateLimit(parsed.rate_limit);

    if (!res.ok) {
      const error = serializeErrorPayload(parsed.errors ?? parsed.message ?? text).slice(0, 500);
      await recordProviderRequestSafe({
        provider: SPORTMONKS_PROVIDER,
        jobName: options.jobName ?? null,
        consumer: options.consumer ?? null,
        endpoint,
        params: redactParams(params),
        attempt: 1,
        success: false,
        rateLimited: res.status === 429,
        statusCode: res.status,
        latencyMs,
        error,
        responseMeta: {
          rateLimit,
        },
      });
      throw new Error(`Sportmonks API ${res.status}: ${error}`);
    }

    const raw = parsed as SportmonksResponse<T>;
    await recordProviderRequestSafe({
      provider: SPORTMONKS_PROVIDER,
      jobName: options.jobName ?? null,
      consumer: options.consumer ?? null,
      endpoint,
      params: redactParams(params),
      attempt: 1,
      success: true,
      rateLimited: false,
      statusCode: res.status,
      latencyMs,
      resultCount: resultCount(raw.data),
      responseMeta: {
        hasPagination: raw.pagination != null,
        hasRateLimit: raw.rate_limit != null,
        rateLimit,
        hasSubscription: raw.subscription != null,
        timezone: raw.timezone ?? null,
      },
    });

    return {
      data: raw.data == null ? [] : asArray(raw.data),
      raw,
      statusCode: res.status,
      latencyMs,
      rateLimit,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    if (!error.startsWith('Sportmonks API ')) {
      await recordProviderRequestSafe({
        provider: SPORTMONKS_PROVIDER,
        jobName: options.jobName ?? null,
        consumer: options.consumer ?? null,
        endpoint,
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

export async function fetchSportmonksLivescores(options: SportmonksRequestOptions & {
  include?: string;
} = {}): Promise<SportmonksCallResult<SportmonksFixtureLike>> {
  return sportmonksGet<SportmonksFixtureLike>(
    '/livescores',
    { include: options.include ?? DEFAULT_FIXTURE_INCLUDES },
    options,
  );
}

export async function fetchSportmonksLatestLivescores(options: SportmonksRequestOptions & {
  include?: string;
} = {}): Promise<SportmonksCallResult<SportmonksFixtureLike>> {
  return sportmonksGet<SportmonksFixtureLike>(
    '/livescores/latest',
    { include: options.include ?? DEFAULT_FIXTURE_INCLUDES },
    options,
  );
}

export async function fetchSportmonksFixtureById(
  fixtureId: string,
  options: SportmonksRequestOptions & { include?: string } = {},
): Promise<SportmonksCallResult<SportmonksFixtureLike>> {
  return sportmonksGet<SportmonksFixtureLike>(
    `/fixtures/${encodeURIComponent(fixtureId)}`,
    { include: options.include ?? DEFAULT_FIXTURE_INCLUDES },
    options,
  );
}

export async function fetchSportmonksFixturesByDate(
  date: string,
  options: SportmonksRequestOptions & { include?: string } = {},
): Promise<SportmonksCallResult<SportmonksFixtureLike>> {
  return sportmonksGet<SportmonksFixtureLike>(
    `/fixtures/date/${encodeURIComponent(date)}`,
    { include: options.include ?? DEFAULT_FIXTURE_INCLUDES },
    options,
  );
}

export function normalizeSportmonksFixtures(fixtures: SportmonksFixtureLike[]): NormalizedSportmonksFixture[] {
  return fixtures.map((fixture) => normalizeSportmonksFixture(fixture));
}
