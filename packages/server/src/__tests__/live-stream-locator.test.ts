import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildTeamAliases,
  clearLiveStreamLookupCacheForTests,
  lookupLiveStreamLinks,
  normalizeSearchText,
  type LiveStreamProvider,
} from '../lib/live-stream-locator.js';
import type { MatchRow } from '../repos/matches.repo.js';

const providers: LiveStreamProvider[] = [
  { name: 'xoilacztu.tv', url: 'https://xoilacztu.tv/', hostname: 'xoilacztu.tv' },
];

function matchRow(patch: Partial<MatchRow>): MatchRow {
  return {
    match_id: '100',
    date: '2026-03-24',
    kickoff: '19:00',
    league_id: 39,
    league_name: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    home_logo: '',
    away_logo: '',
    venue: '',
    status: '1H',
    home_score: 1,
    away_score: 0,
    current_minute: 41,
    last_updated: '2026-03-24T10:00:00.000Z',
    ...patch,
  };
}

describe('live stream locator', () => {
  beforeEach(() => {
    clearLiveStreamLookupCacheForTests();
  });

  test('normalizes Vietnamese accents and builds useful team aliases', () => {
    expect(normalizeSearchText('Trực tiếp bóng đá')).toBe('truc tiep bong da');
    expect(buildTeamAliases('Manchester United FC')).toContain('manchester united');
    expect(buildTeamAliases('Vanraure Hachinohe FC')).toContain('vanraure');
  });

  test('finds a same-provider live stream link for a live match', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      const html = href.endsWith('/truc-tiep/arsenal-chelsea')
        ? '<main>Arsenal vs Chelsea live stream is on now</main>'
        : '<a href="/truc-tiep/arsenal-chelsea">Arsenal vs Chelsea live</a>';
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });

    const [result] = await lookupLiveStreamLinks(
      [matchRow({})],
      {
        providers,
        fetchImpl,
        now: () => new Date('2026-03-24T10:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result).toMatchObject({
      matchId: '100',
      found: true,
      status: 'found',
      url: 'https://xoilacztu.tv/truc-tiep/arsenal-chelsea',
      sourceName: 'xoilacztu.tv',
    });
    expect(result?.links).toHaveLength(1);
    expect(result?.links[0]).toMatchObject({
      url: 'https://xoilacztu.tv/truc-tiep/arsenal-chelsea',
      verificationStatus: 'team_match',
      liveHint: true,
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  test('returns one verified link per matching provider and rejects dead links', async () => {
    const multiProviders: LiveStreamProvider[] = [
      ...providers,
      { name: 'socolive16.cv', url: 'https://socolive16.cv/', hostname: 'socolive16.cv' },
      { name: 'dead.example', url: 'https://dead.example/', hostname: 'dead.example' },
    ];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://xoilacztu.tv/') {
        return new Response('<a href="/arsenal-chelsea">Arsenal vs Chelsea live</a>', { status: 200 });
      }
      if (href === 'https://xoilacztu.tv/arsenal-chelsea') {
        return new Response('<iframe></iframe><main>Arsenal vs Chelsea</main>', { status: 200 });
      }
      if (href === 'https://socolive16.cv/') {
        return new Response('<a href="/watch/arsenal-chelsea">Arsenal vs Chelsea</a>', { status: 200 });
      }
      if (href === 'https://socolive16.cv/watch/arsenal-chelsea') {
        return new Response('<main>video player</main>', { status: 200 });
      }
      if (href === 'https://dead.example/') {
        return new Response('<a href="/bad">Arsenal vs Chelsea live</a>', { status: 200 });
      }
      return new Response('gone', { status: 404 });
    });

    const [result] = await lookupLiveStreamLinks(
      [matchRow({})],
      {
        providers: multiProviders,
        fetchImpl,
        now: () => new Date('2026-03-24T10:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.links.map((link) => link.sourceName)).toEqual(['xoilacztu.tv', 'socolive16.cv']);
    expect(result?.links.map((link) => link.url)).toEqual([
      'https://xoilacztu.tv/arsenal-chelsea',
      'https://socolive16.cv/watch/arsenal-chelsea',
    ]);
  });


  test('matches provider slugs that abbreviate a team name to a distinctive token', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://xoilacztu.tv/') {
        return new Response(
          '<a href="/truc-tiep/vanraure-hachi-vs-fc-imabari-luc-1100-ngay-07-06-2026/">Vanraure vs Imabari</a>',
          { status: 200 },
        );
      }
      if (href === 'https://xoilacztu.tv/truc-tiep/vanraure-hachi-vs-fc-imabari-luc-1100-ngay-07-06-2026/') {
        return new Response('<main>Vanraure vs Imabari <iframe></iframe></main>', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const [result] = await lookupLiveStreamLinks(
      [matchRow({ home_team: 'Vanraure Hachinohe FC', away_team: 'Imabari FC' })],
      {
        providers,
        fetchImpl,
        now: () => new Date('2026-06-07T02:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.url).toBe('https://xoilacztu.tv/truc-tiep/vanraure-hachi-vs-fc-imabari-luc-1100-ngay-07-06-2026/');
  });

  test('keeps a team-matched provider link when detail verification is blocked', async () => {
    const multiProviders: LiveStreamProvider[] = [
      { name: 'socolive16.cv', url: 'https://socolive16.cv/', hostname: 'socolive16.cv' },
    ];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://socolive16.cv/') {
        return new Response(
          '<a href="/truc-tiep/tokushima-vortis-vs-iwaki-fc-07-06-2026-1105/">Tokushima Vortis vs Iwaki FC</a>',
          { status: 200 },
        );
      }
      return new Response('Too many requests', { status: 429 });
    });

    const [result] = await lookupLiveStreamLinks(
      [matchRow({ home_team: 'Tokushima Vortis', away_team: 'Iwaki FC' })],
      {
        providers: multiProviders,
        fetchImpl,
        now: () => new Date('2026-06-07T02:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.links[0]).toMatchObject({
      url: 'https://socolive16.cv/truc-tiep/tokushima-vortis-vs-iwaki-fc-07-06-2026-1105/',
      verificationStatus: 'team_match',
    });
  });

  test('does not scan provider pages for matches that are not live', async () => {
    const fetchImpl = vi.fn(async () => new Response('<a>Arsenal vs Chelsea</a>', { status: 200 }));

    const [result] = await lookupLiveStreamLinks(
      [matchRow({ status: 'NS', current_minute: null })],
      {
        providers,
        fetchImpl,
        now: () => new Date('2026-03-24T09:30:00.000Z'),
        useCache: false,
      },
    );

    expect(result).toMatchObject({
      matchId: '100',
      found: false,
      status: 'not_live',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
