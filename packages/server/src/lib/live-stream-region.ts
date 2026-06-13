import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { LiveStreamSource } from './live-stream-settings.js';

export type LiveStreamRegionUnknownPolicy = 'global_only' | 'hide_all' | 'allow_all';

export interface ResolvedViewerRegion {
  country: string | null;
  source: 'cloudflare' | 'trusted_proxy_header' | 'geoip' | 'accept_language' | 'override' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}

export interface LiveStreamRegionFilteringSettings {
  enabled: boolean;
  unknownPolicy: LiveStreamRegionUnknownPolicy;
}

function firstHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function parseGeoipCountryMap(): Record<string, string> {
  if (!config.liveStreamGeoipCountryMap.trim()) return {};
  try {
    const parsed = JSON.parse(config.liveStreamGeoipCountryMap) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [ip, country] of Object.entries(parsed)) {
      const normalized = normalizeCountryCode(country);
      if (normalized && normalized !== '*') result[ip] = normalized;
    }
    return result;
  } catch {
    return {};
  }
}

function normalizeIp(value: string): string {
  return value.trim().replace(/^::ffff:/, '');
}

function countryFromAcceptLanguage(value: string): string | null {
  const candidates = value
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.find((param) => param.trim().toLowerCase().startsWith('q='));
      const q = qParam ? Number(qParam.split('=')[1]) : 1;
      return {
        tag: tag.trim(),
        q: Number.isFinite(q) ? q : 0,
        index,
      };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const candidate of candidates) {
    const subtags = candidate.tag.split('-').map((part) => part.trim()).filter(Boolean);
    for (let index = subtags.length - 1; index >= 0; index -= 1) {
      const region = subtags[index];
      if (!/^[A-Za-z]{2}$/.test(region ?? '')) continue;
      const country = normalizeCountryCode(region);
      if (country && country !== '*') return country;
      break;
    }
  }

  return null;
}

export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === '*') return '*';
  if (!/^[A-Z]{2}$/.test(normalized)) return null;
  return normalized;
}

export function normalizeUnknownPolicy(value: unknown): LiveStreamRegionUnknownPolicy {
  if (value === 'hide_all' || value === 'allow_all') return value;
  return 'global_only';
}

export function resolveLiveStreamRegionFilteringSettings(): LiveStreamRegionFilteringSettings {
  const unknownPolicy = normalizeUnknownPolicy(config.liveStreamRegionUnknownPolicy);
  return {
    enabled: config.liveStreamRegionEnabled,
    unknownPolicy: config.nodeEnv === 'production' && unknownPolicy === 'allow_all'
      ? 'global_only'
      : unknownPolicy,
  };
}

export function resolveViewerRegion(req: FastifyRequest): ResolvedViewerRegion {
  const override = normalizeCountryCode(config.liveStreamDevCountryOverride);
  if (override && override !== '*' && config.nodeEnv !== 'production') {
    return { country: override, source: 'override', confidence: 'high' };
  }

  const trustedHeader = config.liveStreamTrustedCountryHeader.trim().toLowerCase();
  if (trustedHeader) {
    const country = normalizeCountryCode(firstHeaderValue(req.headers[trustedHeader]));
    if (country && country !== '*') {
      return { country, source: 'trusted_proxy_header', confidence: 'high' };
    }
  }

  if (config.liveStreamTrustCfIpCountry) {
    const country = normalizeCountryCode(firstHeaderValue(req.headers['cf-ipcountry']));
    if (country && country !== '*') {
      return { country, source: 'cloudflare', confidence: 'high' };
    }
  }

  const geoipMap = parseGeoipCountryMap();
  const geoipCountry = geoipMap[normalizeIp(req.ip)];
  if (geoipCountry) {
    return { country: geoipCountry, source: 'geoip', confidence: 'medium' };
  }

  const acceptLanguageCountry = countryFromAcceptLanguage(firstHeaderValue(req.headers['accept-language']));
  if (acceptLanguageCountry) {
    return { country: acceptLanguageCountry, source: 'accept_language', confidence: 'low' };
  }

  return { country: null, source: 'unknown', confidence: 'low' };
}

function countryRank(source: LiveStreamSource, country: string | null): number {
  if (country && source.countries.includes(country)) return 0;
  if (source.countries.includes('*')) return 1;
  return 2;
}

export function filterLiveStreamSourcesForRegion(
  sources: readonly LiveStreamSource[],
  viewerRegion: ResolvedViewerRegion,
  settings: LiveStreamRegionFilteringSettings = resolveLiveStreamRegionFilteringSettings(),
): LiveStreamSource[] {
  const activeSources = sources.filter((source) => source.active);
  if (!settings.enabled) {
    return [...activeSources].sort(compareLiveStreamSourcesForRegion(null));
  }

  const country = viewerRegion.country;
  let eligible: LiveStreamSource[];
  if (country) {
    eligible = activeSources.filter((source) => source.countries.includes(country) || source.countries.includes('*'));
  } else if (settings.unknownPolicy === 'hide_all') {
    eligible = [];
  } else if (settings.unknownPolicy === 'allow_all') {
    eligible = [...activeSources];
  } else {
    eligible = activeSources.filter((source) => source.countries.includes('*'));
  }

  return eligible.sort(compareLiveStreamSourcesForRegion(country));
}

export function compareLiveStreamSourcesForRegion(country: string | null) {
  return (a: LiveStreamSource, b: LiveStreamSource): number => (
    countryRank(a, country) - countryRank(b, country)
    || a.priority - b.priority
    || a.name.localeCompare(b.name)
    || a.url.localeCompare(b.url)
  );
}
