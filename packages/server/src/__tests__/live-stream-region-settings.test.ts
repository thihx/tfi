import { describe, expect, test } from 'vitest';
import {
  filterLiveStreamSourcesForRegion,
  normalizeCountryCode,
} from '../lib/live-stream-region.js';
import {
  normalizeLiveStreamLocatorSettingsPatch,
  resolveLiveStreamLocatorSettings,
  validateLiveStreamSources,
  type LiveStreamSource,
} from '../lib/live-stream-settings.js';

const sources: LiveStreamSource[] = [
  {
    id: 'kr',
    name: 'Korea Source',
    url: 'https://kr.example/',
    countries: ['KR'],
    priority: 10,
    active: true,
    sourceType: 'provider_homepage',
  },
  {
    id: 'vn',
    name: 'Vietnam Source',
    url: 'https://vn.example/',
    countries: ['VN'],
    priority: 20,
    active: true,
    sourceType: 'provider_homepage',
  },
  {
    id: 'global',
    name: 'Global Source',
    url: 'https://global.example/',
    countries: ['*'],
    priority: 5,
    active: true,
    sourceType: 'external_page',
  },
  {
    id: 'off',
    name: 'Disabled Source',
    url: 'https://off.example/',
    countries: ['VN'],
    priority: 1,
    active: false,
    sourceType: 'provider_homepage',
  },
];

describe('live stream region and source settings', () => {
  test('normalizes ISO country codes and rejects free-text countries', () => {
    expect(normalizeCountryCode('VN')).toBe('VN');
    expect(normalizeCountryCode('kr')).toBe('KR');
    expect(normalizeCountryCode('*')).toBe('*');
    expect(normalizeCountryCode('Vietnam')).toBeNull();
    expect(normalizeCountryCode('KOREA')).toBeNull();
  });

  test('validates source countries and URL shape', () => {
    expect(validateLiveStreamSources([
      { url: 'https://vn.example/#top', countries: ['vn'], sourceType: 'provider_homepage' },
    ])).toMatchObject({
      sources: [{ url: 'https://vn.example/', countries: ['VN'] }],
      error: null,
    });

    expect(validateLiveStreamSources([
      { url: 'https://vn.example/', countries: ['Vietnam'], sourceType: 'provider_homepage' },
    ])).toMatchObject({ error: 'Invalid live stream country code: Vietnam' });

    expect(validateLiveStreamSources([
      { url: 'https://vn.example/', countries: [], sourceType: 'provider_homepage' },
    ])).toMatchObject({ error: 'Live stream source countries are required.' });

    expect(validateLiveStreamSources([
      { url: 'ftp://vn.example/', countries: ['VN'], sourceType: 'provider_homepage' },
    ])).toMatchObject({ error: 'Invalid live stream source URL: ftp://vn.example/' });
  });

  test('converts legacy providerUrls to global sources', () => {
    const resolved = resolveLiveStreamLocatorSettings({
      LIVE_STREAM_PROVIDER_URLS: ['https://legacy.example/#top'],
    });

    expect(resolved.providerUrls).toEqual(['https://legacy.example/']);
    expect(resolved.sources).toEqual([
      expect.objectContaining({
        name: 'legacy.example',
        url: 'https://legacy.example/',
        countries: ['*'],
        active: true,
        sourceType: 'provider_homepage',
      }),
    ]);
  });

  test('filters exact country before global fallback', () => {
    const filtered = filterLiveStreamSourcesForRegion(
      sources,
      { country: 'VN', source: 'cloudflare', confidence: 'high' },
      { enabled: true, unknownPolicy: 'global_only' },
    );

    expect(filtered.map((source) => source.id)).toEqual(['vn', 'global']);
  });

  test('handles unknown country policies', () => {
    const unknownRegion = { country: null, source: 'unknown' as const, confidence: 'low' as const };

    expect(filterLiveStreamSourcesForRegion(sources, unknownRegion, { enabled: true, unknownPolicy: 'global_only' }).map((source) => source.id))
      .toEqual(['global']);
    expect(filterLiveStreamSourcesForRegion(sources, unknownRegion, { enabled: true, unknownPolicy: 'hide_all' }))
      .toEqual([]);
    expect(filterLiveStreamSourcesForRegion(sources, unknownRegion, { enabled: true, unknownPolicy: 'allow_all' }).map((source) => source.id))
      .toEqual(['global', 'kr', 'vn']);
  });

  test('normalizes settings patches with sources and region filtering', () => {
    const normalized = normalizeLiveStreamLocatorSettingsPatch({
      sources: [
        { url: 'https://vn.example/#top', countries: ['vn'], priority: 2, active: true, sourceType: 'external_page' },
      ],
      regionFiltering: { enabled: true, unknownPolicy: 'hide_all' },
    });

    expect(normalized.error).toBeNull();
    expect(normalized.patch).toMatchObject({
      LIVE_STREAM_SOURCES: [
        expect.objectContaining({
          url: 'https://vn.example/',
          countries: ['VN'],
          priority: 2,
          active: true,
          sourceType: 'external_page',
        }),
      ],
      LIVE_STREAM_REGION_ENABLED: true,
      LIVE_STREAM_REGION_UNKNOWN_POLICY: 'hide_all',
    });
  });
});

