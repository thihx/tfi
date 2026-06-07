import { describe, expect, it } from 'vitest';
import {
  formatLiveStreamCacheTtl,
  liveStreamProviderHostname,
  normalizeLiveStreamProviderUrl,
} from './live-stream-provider-url';

describe('live-stream-provider-url', () => {
  it('normalizes valid provider URLs and strips hash fragments', () => {
    expect(normalizeLiveStreamProviderUrl('https://xoilacztu.tv/#top')).toEqual({
      url: 'https://xoilacztu.tv/',
      error: null,
    });
  });

  it('rejects invalid and unsupported provider URLs', () => {
    expect(normalizeLiveStreamProviderUrl('')).toEqual({ url: null, error: 'Enter a provider URL.' });
    expect(normalizeLiveStreamProviderUrl('not-a-url')).toMatchObject({ url: null });
    expect(normalizeLiveStreamProviderUrl('ftp://bad.example/')).toEqual({
      url: null,
      error: 'Provider URLs must use http or https.',
    });
  });

  it('formats cache ttl labels', () => {
    expect(formatLiveStreamCacheTtl(45)).toBe('45s');
    expect(formatLiveStreamCacheTtl(180)).toBe('3 min');
  });

  it('extracts hostname labels', () => {
    expect(liveStreamProviderHostname('https://www.socolive16.cv/live')).toBe('socolive16.cv');
  });
});
