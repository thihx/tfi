import { config } from '../config.js';
import * as settingsRepo from '../repos/settings.repo.js';
import { normalizeCountryCode, normalizeUnknownPolicy, type LiveStreamRegionUnknownPolicy } from './live-stream-region.js';

export type LiveStreamSourceType = 'provider_homepage' | 'direct_hls' | 'external_page';

export interface LiveStreamSource {
  id: string;
  name: string;
  url: string;
  countries: string[];
  priority: number;
  active: boolean;
  sourceType: LiveStreamSourceType;
  notes?: string;
}

export interface LiveStreamRegionSettings {
  enabled: boolean;
  unknownPolicy: LiveStreamRegionUnknownPolicy;
}

export interface LiveStreamLocatorRuntimeSettings {
  enabled: boolean;
  sources: LiveStreamSource[];
  providerUrls: string[];
  timeoutMs: number;
  cacheTtlMs: number;
  maxMatches: number;
  regionFiltering: LiveStreamRegionSettings;
}

interface NormalizePatchResult {
  patch: Record<string, unknown>;
  error: string | null;
}

const PROVIDER_URLS_KEY = 'LIVE_STREAM_PROVIDER_URLS';
const SOURCES_KEY = 'LIVE_STREAM_SOURCES';
const ENABLED_KEY = 'LIVE_STREAM_LOCATOR_ENABLED';
const TIMEOUT_MS_KEY = 'LIVE_STREAM_LOCATOR_TIMEOUT_MS';
const CACHE_TTL_MS_KEY = 'LIVE_STREAM_LOCATOR_CACHE_TTL_MS';
const MAX_MATCHES_KEY = 'LIVE_STREAM_LOCATOR_MAX_MATCHES';
const REGION_ENABLED_KEY = 'LIVE_STREAM_REGION_ENABLED';
const REGION_UNKNOWN_POLICY_KEY = 'LIVE_STREAM_REGION_UNKNOWN_POLICY';

const MAX_PROVIDER_URLS = 12;
const MAX_SOURCES = 50;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15_000;
const MIN_CACHE_TTL_MS = 15_000;
const MAX_CACHE_TTL_MS = 60 * 60_000;
const MIN_MAX_MATCHES = 1;
const MAX_MAX_MATCHES = 100;
const SOURCE_TYPES = new Set<LiveStreamSourceType>(['provider_homepage', 'direct_hls', 'external_page']);

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseProviderUrlsInput(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === 'string' ? item.split(/[\n,]/) : []));
  }
  if (typeof value === 'string') return value.split(/[\n,]/);
  return [];
}

export function normalizeLiveStreamProviderUrls(value: unknown, fallback: readonly string[] = config.liveStreamProviderUrls): string[] {
  const rawValues = parseProviderUrlsInput(value);
  const source = rawValues.length > 0 ? rawValues : [...fallback];
  const urls = new Map<string, string>();

  for (const raw of source) {
    const candidate = raw.trim();
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
      parsed.hash = '';
      urls.set(parsed.toString(), parsed.toString());
    } catch {
      // Ignore invalid persisted values. Strict validation happens before saving.
    }
  }

  return [...urls.values()].slice(0, MAX_PROVIDER_URLS);
}

function normalizeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function sourceIdFromUrl(url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${host || 'source'}-${index + 1}`;
  } catch {
    return `source-${index + 1}`;
  }
}

function sourceNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'Live source';
  }
}

function uniqueCountries(values: unknown): string[] {
  const rawValues = Array.isArray(values) ? values : [];
  const countries: string[] = [];
  for (const raw of rawValues) {
    const normalized = normalizeCountryCode(raw);
    if (!normalized || countries.includes(normalized)) continue;
    countries.push(normalized);
  }
  return countries;
}

function legacySourcesFromProviderUrls(providerUrls: readonly string[]): LiveStreamSource[] {
  return providerUrls.map((url, index) => ({
    id: sourceIdFromUrl(url, index),
    name: sourceNameFromUrl(url),
    url,
    countries: ['*'],
    priority: 100 + index,
    active: true,
    sourceType: 'provider_homepage',
  }));
}

function parseSourcesInput(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeLiveStreamSources(value: unknown, fallbackProviderUrls: readonly string[] = config.liveStreamProviderUrls): LiveStreamSource[] {
  const rawSources = parseSourcesInput(value);
  if (rawSources.length === 0) return legacySourcesFromProviderUrls(normalizeLiveStreamProviderUrls(fallbackProviderUrls));

  const sources: LiveStreamSource[] = [];
  const seen = new Set<string>();
  rawSources.slice(0, MAX_SOURCES).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const record = entry as Record<string, unknown>;
    const rawUrl = typeof record['url'] === 'string' ? record['url'] : '';
    const url = normalizeUrl(rawUrl);
    if (!url) return;
    const countries = uniqueCountries(record['countries']);
    if (countries.length === 0) return;
    const rawType = typeof record['sourceType'] === 'string' ? record['sourceType'] : 'provider_homepage';
    const sourceType = SOURCE_TYPES.has(rawType as LiveStreamSourceType) ? rawType as LiveStreamSourceType : 'provider_homepage';
    const dedupeKey = `${url}|${[...countries].sort().join(',')}|${sourceType}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const rawName = typeof record['name'] === 'string' ? record['name'].trim() : '';
    const rawId = typeof record['id'] === 'string' ? record['id'].trim() : '';
    const priority = normalizeInteger(record['priority'], 100 + index, 0, 10_000);
    const active = normalizeBoolean(record['active'], true);
    const notes = typeof record['notes'] === 'string' && record['notes'].trim() ? record['notes'].trim().slice(0, 500) : undefined;
    sources.push({
      id: rawId || sourceIdFromUrl(url, index),
      name: rawName || sourceNameFromUrl(url),
      url,
      countries,
      priority,
      active,
      sourceType,
      ...(notes ? { notes } : {}),
    });
  });
  return sources;
}

export function liveStreamProviderUrlsFromSources(sources: readonly LiveStreamSource[]): string[] {
  return [...new Set(sources.map((source) => source.url))];
}

export function resolveLiveStreamLocatorSettings(raw: Record<string, unknown> = {}): LiveStreamLocatorRuntimeSettings {
  const providerUrls = normalizeLiveStreamProviderUrls(raw[PROVIDER_URLS_KEY]);
  const sources = hasOwn(raw, SOURCES_KEY)
    ? normalizeLiveStreamSources(raw[SOURCES_KEY], providerUrls)
    : legacySourcesFromProviderUrls(providerUrls);
  const unknownPolicy = normalizeUnknownPolicy(raw[REGION_UNKNOWN_POLICY_KEY] ?? config.liveStreamRegionUnknownPolicy);
  return {
    enabled: normalizeBoolean(raw[ENABLED_KEY], config.liveStreamLocatorEnabled),
    sources,
    providerUrls: hasOwn(raw, SOURCES_KEY) ? liveStreamProviderUrlsFromSources(sources) : providerUrls,
    timeoutMs: normalizeInteger(raw[TIMEOUT_MS_KEY], config.liveStreamLocatorTimeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    cacheTtlMs: normalizeInteger(raw[CACHE_TTL_MS_KEY], config.liveStreamLocatorCacheTtlMs, MIN_CACHE_TTL_MS, MAX_CACHE_TTL_MS),
    maxMatches: normalizeInteger(raw[MAX_MATCHES_KEY], config.liveStreamLocatorMaxMatches, MIN_MAX_MATCHES, MAX_MAX_MATCHES),
    regionFiltering: {
      enabled: normalizeBoolean(raw[REGION_ENABLED_KEY], config.liveStreamRegionEnabled),
      unknownPolicy: config.nodeEnv === 'production' && unknownPolicy === 'allow_all' ? 'global_only' : unknownPolicy,
    },
  };
}

function validateProviderUrls(value: unknown): { urls: string[]; error: string | null } {
  const rawValues = parseProviderUrlsInput(value).map((item) => item.trim()).filter(Boolean);
  if (rawValues.length > MAX_PROVIDER_URLS) {
    return { urls: [], error: `Live stream provider list supports at most ${MAX_PROVIDER_URLS} URLs.` };
  }

  const urls = new Map<string, string>();
  for (const raw of rawValues) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { urls: [], error: 'Live stream provider URLs must use http or https.' };
      }
      parsed.hash = '';
      urls.set(parsed.toString(), parsed.toString());
    } catch {
      return { urls: [], error: `Invalid live stream provider URL: ${raw}` };
    }
  }
  return { urls: [...urls.values()], error: null };
}

export function validateLiveStreamProviderUrls(value: unknown): { urls: string[]; error: string | null } {
  return validateProviderUrls(value);
}

export function validateLiveStreamSources(value: unknown): { sources: LiveStreamSource[]; error: string | null } {
  const rawSources = parseSourcesInput(value);
  if (rawSources.length > MAX_SOURCES) {
    return { sources: [], error: `Live stream source list supports at most ${MAX_SOURCES} entries.` };
  }
  const sources: LiveStreamSource[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < rawSources.length; index += 1) {
    const entry = rawSources[index];
    if (!entry || typeof entry !== 'object') {
      return { sources: [], error: `Live stream source ${index + 1} must be an object.` };
    }
    const record = entry as Record<string, unknown>;
    const rawUrl = typeof record['url'] === 'string' ? record['url'].trim() : '';
    const url = normalizeUrl(rawUrl);
    if (!url) return { sources: [], error: rawUrl ? `Invalid live stream source URL: ${rawUrl}` : 'Live stream source URL is required.' };

    const rawProtocol = new URL(url).protocol;
    if (rawProtocol !== 'https:' && rawProtocol !== 'http:') {
      return { sources: [], error: 'Live stream source URLs must use http or https.' };
    }

    const rawCountries = Array.isArray(record['countries']) ? record['countries'] : [];
    if (rawCountries.length === 0) return { sources: [], error: 'Live stream source countries are required.' };
    const countries: string[] = [];
    for (const rawCountry of rawCountries) {
      const normalized = normalizeCountryCode(rawCountry);
      if (!normalized) return { sources: [], error: `Invalid live stream country code: ${String(rawCountry)}` };
      if (!countries.includes(normalized)) countries.push(normalized);
    }

    const rawType = typeof record['sourceType'] === 'string' ? record['sourceType'] : 'provider_homepage';
    if (!SOURCE_TYPES.has(rawType as LiveStreamSourceType)) {
      return { sources: [], error: `Invalid live stream source type: ${rawType}` };
    }

    const dedupeKey = `${url}|${[...countries].sort().join(',')}|${rawType}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const priority = validateInteger(record['priority'] ?? 100 + index, 'Live stream source priority', 0, 10_000);
    if (priority.error) return { sources: [], error: priority.error };
    const active = validateBoolean(record['active'] ?? true, 'Live stream source active');
    if (active.error) return { sources: [], error: active.error };
    const rawName = typeof record['name'] === 'string' ? record['name'].trim() : '';
    const rawId = typeof record['id'] === 'string' ? record['id'].trim() : '';
    const notes = typeof record['notes'] === 'string' && record['notes'].trim() ? record['notes'].trim().slice(0, 500) : undefined;

    sources.push({
      id: rawId || sourceIdFromUrl(url, index),
      name: rawName || sourceNameFromUrl(url),
      url,
      countries,
      priority: priority.value,
      active: active.value,
      sourceType: rawType as LiveStreamSourceType,
      ...(notes ? { notes } : {}),
    });
  }

  return { sources, error: null };
}

function validateBoolean(value: unknown, label: string): { value: boolean; error: string | null } {
  if (typeof value === 'boolean') return { value, error: null };
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return { value: true, error: null };
    if (normalized === 'false') return { value: false, error: null };
  }
  return { value: false, error: `${label} must be true or false.` };
}

function validateInteger(value: unknown, label: string, min: number, max: number): { value: number; error: string | null } {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { value: min, error: `${label} must be an integer from ${min} to ${max}.` };
  }
  return { value: parsed, error: null };
}

export function normalizeLiveStreamLocatorSettingsPatch(body: Record<string, unknown>): NormalizePatchResult {
  const patch: Record<string, unknown> = {};

  if (hasOwn(body, 'enabled')) {
    const parsed = validateBoolean(body['enabled'], 'Live stream locator enabled');
    if (parsed.error) return { patch, error: parsed.error };
    patch[ENABLED_KEY] = parsed.value;
  }

  if (hasOwn(body, 'providerUrls')) {
    const parsed = validateProviderUrls(body['providerUrls']);
    if (parsed.error) return { patch, error: parsed.error };
    patch[PROVIDER_URLS_KEY] = parsed.urls;
  }

  if (hasOwn(body, 'sources')) {
    const parsed = validateLiveStreamSources(body['sources']);
    if (parsed.error) return { patch, error: parsed.error };
    patch[SOURCES_KEY] = parsed.sources;
  }

  if (hasOwn(body, 'timeoutMs')) {
    const parsed = validateInteger(body['timeoutMs'], 'Live stream request timeout', MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    if (parsed.error) return { patch, error: parsed.error };
    patch[TIMEOUT_MS_KEY] = parsed.value;
  }

  if (hasOwn(body, 'cacheTtlMs')) {
    const parsed = validateInteger(body['cacheTtlMs'], 'Live stream cache TTL', MIN_CACHE_TTL_MS, MAX_CACHE_TTL_MS);
    if (parsed.error) return { patch, error: parsed.error };
    patch[CACHE_TTL_MS_KEY] = parsed.value;
  }

  if (hasOwn(body, 'maxMatches')) {
    const parsed = validateInteger(body['maxMatches'], 'Live stream max matches', MIN_MAX_MATCHES, MAX_MAX_MATCHES);
    if (parsed.error) return { patch, error: parsed.error };
    patch[MAX_MATCHES_KEY] = parsed.value;
  }

  if (hasOwn(body, 'regionFiltering')) {
    const record = body['regionFiltering'];
    if (!record || typeof record !== 'object') {
      return { patch, error: 'Live stream region filtering must be an object.' };
    }
    const region = record as Record<string, unknown>;
    if (hasOwn(region, 'enabled')) {
      const parsed = validateBoolean(region['enabled'], 'Live stream region filtering enabled');
      if (parsed.error) return { patch, error: parsed.error };
      patch[REGION_ENABLED_KEY] = parsed.value;
    }
    if (hasOwn(region, 'unknownPolicy')) {
      if (region['unknownPolicy'] !== 'global_only' && region['unknownPolicy'] !== 'hide_all' && region['unknownPolicy'] !== 'allow_all') {
        return { patch, error: 'Live stream unknown region policy must be global_only, hide_all, or allow_all.' };
      }
      patch[REGION_UNKNOWN_POLICY_KEY] = region['unknownPolicy'];
    }
  }

  return { patch, error: null };
}

export async function loadLiveStreamLocatorSettings(): Promise<LiveStreamLocatorRuntimeSettings> {
  const raw = await settingsRepo.getSettings('default', { fallbackToDefault: false }).catch(() => ({}));
  return resolveLiveStreamLocatorSettings(raw);
}
