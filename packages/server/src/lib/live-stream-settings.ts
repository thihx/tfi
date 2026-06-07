import { config } from '../config.js';
import * as settingsRepo from '../repos/settings.repo.js';

export interface LiveStreamLocatorRuntimeSettings {
  enabled: boolean;
  providerUrls: string[];
  timeoutMs: number;
  cacheTtlMs: number;
  maxMatches: number;
}

interface NormalizePatchResult {
  patch: Record<string, unknown>;
  error: string | null;
}

const PROVIDER_URLS_KEY = 'LIVE_STREAM_PROVIDER_URLS';
const ENABLED_KEY = 'LIVE_STREAM_LOCATOR_ENABLED';
const TIMEOUT_MS_KEY = 'LIVE_STREAM_LOCATOR_TIMEOUT_MS';
const CACHE_TTL_MS_KEY = 'LIVE_STREAM_LOCATOR_CACHE_TTL_MS';
const MAX_MATCHES_KEY = 'LIVE_STREAM_LOCATOR_MAX_MATCHES';

const MAX_PROVIDER_URLS = 12;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15_000;
const MIN_CACHE_TTL_MS = 15_000;
const MAX_CACHE_TTL_MS = 60 * 60_000;
const MIN_MAX_MATCHES = 1;
const MAX_MAX_MATCHES = 100;

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

export function resolveLiveStreamLocatorSettings(raw: Record<string, unknown> = {}): LiveStreamLocatorRuntimeSettings {
  return {
    enabled: normalizeBoolean(raw[ENABLED_KEY], config.liveStreamLocatorEnabled),
    providerUrls: normalizeLiveStreamProviderUrls(raw[PROVIDER_URLS_KEY]),
    timeoutMs: normalizeInteger(raw[TIMEOUT_MS_KEY], config.liveStreamLocatorTimeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    cacheTtlMs: normalizeInteger(raw[CACHE_TTL_MS_KEY], config.liveStreamLocatorCacheTtlMs, MIN_CACHE_TTL_MS, MAX_CACHE_TTL_MS),
    maxMatches: normalizeInteger(raw[MAX_MATCHES_KEY], config.liveStreamLocatorMaxMatches, MIN_MAX_MATCHES, MAX_MAX_MATCHES),
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

  return { patch, error: null };
}

export async function loadLiveStreamLocatorSettings(): Promise<LiveStreamLocatorRuntimeSettings> {
  const raw = await settingsRepo.getSettings('default', { fallbackToDefault: false }).catch(() => ({}));
  return resolveLiveStreamLocatorSettings(raw);
}
