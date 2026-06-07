import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildTeamAliases,
  clearLiveStreamLookupCacheForTests,
  extractGridProviderMatches,
  extractStructuredProviderMatches,
  lookupLiveStreamLinks,
  normalizeSearchText,
  type LiveStreamProvider,
} from '../lib/live-stream-locator.js';
import { expandTeamAliases, LIVE_STREAM_TEAM_ALIASES } from '../lib/live-stream-team-aliases.js';
import type { MatchRow } from '../repos/matches.repo.js';

const providers: LiveStreamProvider[] = [
  { name: 'xoilacztu.tv', url: 'https://xoilacztu.tv/', hostname: 'xoilacztu.tv' },
];

const socoliveProvider: LiveStreamProvider = {
  name: 'socolive16.cv',
  url: 'https://socolive16.cv/',
  hostname: 'socolive16.cv',
};

function vleagueMatchRow(patch: Partial<MatchRow>): MatchRow {
  return matchRow({
    match_id: '200',
    date: '2026-06-07',
    kickoff: '18:00',
    league_id: 340,
    league_name: 'V.League 1',
    home_team: 'Phu Dong',
    away_team: 'Hồng Lĩnh Hà Tĩnh',
    status: '2H',
    home_score: 2,
    away_score: 0,
    current_minute: 78,
    last_updated: '2026-06-07T12:00:00.000Z',
    ...patch,
  });
}

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

  test('maps common V-League API names to provider labels', () => {
    expect(LIVE_STREAM_TEAM_ALIASES['pho hien']).toContain('pvf cand fc');
    expect(buildTeamAliases('Pho Hien')).toContain('pvf cand fc');
    expect(buildTeamAliases('Viettel')).toContain('the cong viettel');
    expect(buildTeamAliases('Công An Nhân Dân')).toContain('cong an ha noi fc');
    expect(expandTeamAliases('ninh binh', ['ninh binh'])).toContain('phu dong');
    expect(expandTeamAliases('vietnam u19', ['vietnam u19'])).toContain('viet nam u19');
    expect(expandTeamAliases('cyprus', ['cyprus'])).toContain('dao sip');
    expect(expandTeamAliases('usa', ['usa'])).toContain('my');
  });

  test('extracts xoilac grid-match team names from homepage HTML', () => {
    const html = `
      <a href="/truc-tiep/liechtenstein-vs-dao-sip-luc-2000-ngay-07-06-2026/">
        <span class="grid-match__team--home-name">Liechtenstein</span>
        <span class="grid-match__team--away-name">Đảo Síp</span>
      </a>
    `;
    expect(extractGridProviderMatches(html)).toEqual([
      {
        homeName: 'Liechtenstein',
        awayName: 'Đảo Síp',
        slug: 'liechtenstein-vs-dao-sip-luc-2000-ngay-07-06-2026',
      },
    ]);
  });

  test('extracts socolive matches-data JSON entries', () => {
    const html = `
      <script type="application/json" id="matches-data">[
        {"home_name":"Ninh Binh FC","away_name":"Hong Linh Ha Tinh","post_name":"ninh-binh-fc-vs-hong-linh-ha-tinh-07-06-2026-1800"},
        {"home_name":"Song Lam Nghe An","away_name":"PVF CAND","post_name":"song-lam-nghe-an-vs-pvf-cand-fc-07-06-2026-1800"}
      ]</script>
    `;
    expect(extractStructuredProviderMatches(html)).toEqual([
      {
        homeName: 'Ninh Binh FC',
        awayName: 'Hong Linh Ha Tinh',
        slug: 'ninh-binh-fc-vs-hong-linh-ha-tinh-07-06-2026-1800',
      },
      {
        homeName: 'Song Lam Nghe An',
        awayName: 'PVF CAND',
        slug: 'song-lam-nghe-an-vs-pvf-cand-fc-07-06-2026-1800',
      },
    ]);
  });

  test('finds socolive links for Phu Dong vs Hong Linh Ha Tinh via structured JSON', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://socolive16.cv/') {
        return new Response(
          `<script type="application/json" id="matches-data">[
            {"home_name":"Ninh Binh FC","away_name":"Hong Linh Ha Tinh","post_name":"ninh-binh-fc-vs-hong-linh-ha-tinh-07-06-2026-1800"}
          ]</script>`,
          { status: 200 },
        );
      }
      if (href.includes('ninh-binh-fc-vs-hong-linh-ha-tinh')) {
        return new Response('<main>Ninh Binh FC vs Hong Linh Ha Tinh <iframe></iframe></main>', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const [result] = await lookupLiveStreamLinks(
      [vleagueMatchRow({})],
      {
        providers: [socoliveProvider],
        fetchImpl,
        now: () => new Date('2026-06-07T12:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.url).toBe('https://socolive16.cv/truc-tiep/ninh-binh-fc-vs-hong-linh-ha-tinh-07-06-2026-1800/');
  });

  test('finds provider links for Song Lam Nghe An vs Pho Hien', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://socolive16.cv/') {
        return new Response(
          '<a href="/truc-tiep/song-lam-nghe-an-vs-pvf-cand-fc-07-06-2026-1800/">Song Lam Nghe An vs PVF CAND</a>',
          { status: 200 },
        );
      }
      if (href.includes('song-lam-nghe-an-vs-pvf-cand-fc')) {
        return new Response('<main>Song Lam Nghe An vs PVF CAND live player</main>', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const [result] = await lookupLiveStreamLinks(
      [vleagueMatchRow({ home_team: 'Song Lam Nghe An', away_team: 'Pho Hien' })],
      {
        providers: [socoliveProvider],
        fetchImpl,
        now: () => new Date('2026-06-07T12:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.url).toContain('song-lam-nghe-an-vs-pvf-cand-fc');
  });

  test('finds xoilac link for Viettel vs Cong An Nhan Dan', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://xoilacztu.tv/') {
        return new Response(
          '<a href="/truc-tiep/the-cong-viettel-vs-cong-an-ha-noi-luc-1800-ngay-07-06-2026/">The Cong Viettel vs Cong An Ha Noi</a>',
          { status: 200 },
        );
      }
      if (href.includes('the-cong-viettel-vs-cong-an-ha-noi')) {
        return new Response('<main>The Cong Viettel vs Cong An Ha Noi FC <iframe></iframe></main>', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const [result] = await lookupLiveStreamLinks(
      [vleagueMatchRow({ home_team: 'Viettel', away_team: 'Công An Nhân Dân' })],
      {
        providers,
        fetchImpl,
        now: () => new Date('2026-06-07T12:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.url).toContain('the-cong-viettel-vs-cong-an-ha-noi');
  });

  test('finds xoilac link for Liechtenstein vs Cyprus using Vietnamese provider label', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://xoilacztu.tv/') {
        return new Response(
          '<a href="/truc-tiep/liechtenstein-vs-dao-sip-luc-2000-ngay-07-06-2026/" title="Liechtenstein vs Dao Sip"></a>',
          { status: 200 },
        );
      }
      if (href.includes('liechtenstein-vs-dao-sip')) {
        return new Response('<main>Liechtenstein vs Dao Sip <iframe></iframe></main>', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const [result] = await lookupLiveStreamLinks(
      [matchRow({ home_team: 'Liechtenstein', away_team: 'Cyprus', status: 'HT' })],
      {
        providers,
        fetchImpl,
        now: () => new Date('2026-06-07T13:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.url).toContain('liechtenstein-vs-dao-sip');
  });

  test('finds xoilac link for Indonesia U19 vs Vietnam U19 from title-only anchor', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://xoilacztu.tv/') {
        return new Response(
          '<a href="/truc-tiep/indonesia-u19-vs-viet-nam-u19-luc-2000-ngay-07-06-2026/" title="Indonesia U19 vs Viet Nam U19"></a>',
          { status: 200 },
        );
      }
      if (href.includes('indonesia-u19-vs-viet-nam-u19')) {
        return new Response('<main>Indonesia U19 vs Viet Nam U19 live player</main>', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const [result] = await lookupLiveStreamLinks(
      [matchRow({ home_team: 'Indonesia U19', away_team: 'Vietnam U19', status: 'HT' })],
      {
        providers,
        fetchImpl,
        now: () => new Date('2026-06-07T13:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.url).toContain('indonesia-u19-vs-viet-nam-u19');
  });

  test('finds socolive link from aria-label when anchor text is empty', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://socolive16.cv/') {
        return new Response(
          '<a href="/truc-tiep/korea-republic-vs-japan/" aria-label="Han Quoc vs Nhat Ban"></a>',
          { status: 200 },
        );
      }
      if (href.includes('korea-republic-vs-japan')) {
        return new Response('<main>Han Quoc vs Nhat Ban live player</main>', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const [result] = await lookupLiveStreamLinks(
      [matchRow({ home_team: 'South Korea', away_team: 'Japan', status: 'HT' })],
      {
        providers: [socoliveProvider],
        fetchImpl,
        now: () => new Date('2026-06-07T13:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.url).toContain('korea-republic-vs-japan');
  });

  test('finds xoilac link from homepage grid when title-only anchor has no text', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://xoilacztu.tv/') {
        return new Response(
          `<a href="/truc-tiep/liechtenstein-vs-dao-sip-luc-2000-ngay-07-06-2026/">
            <span class="grid-match__team--home-name">Liechtenstein</span>
            <span class="grid-match__team--away-name">Đảo Síp</span>
          </a>`,
          { status: 200 },
        );
      }
      if (href.includes('liechtenstein-vs-dao-sip')) {
        return new Response('<main>Liechtenstein vs Dao Sip <iframe></iframe></main>', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const [result] = await lookupLiveStreamLinks(
      [matchRow({ home_team: 'Liechtenstein', away_team: 'Cyprus', status: 'HT' })],
      {
        providers,
        fetchImpl,
        now: () => new Date('2026-06-07T13:05:00.000Z'),
        useCache: false,
      },
    );

    expect(result?.found).toBe(true);
    expect(result?.url).toContain('liechtenstein-vs-dao-sip');
  });
});
