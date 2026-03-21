import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-test',
    geminiTimeoutMs: 60000,
    geminiStrategicGroundedModel: 'gemini-grounded',
    geminiStrategicStructuredModel: 'gemini-structured',
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const {
  countPrimaryStatPairs,
  fetchWebLiveFallback,
  validateWebLiveFallbackResult,
} = await import('../lib/web-live-fallback.js');

function makeGeminiResponse(text: string, groundingMetadata?: Record<string, unknown>) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      candidates: [{
        content: {
          parts: [{ text }],
        },
        ...(groundingMetadata ? { groundingMetadata } : {}),
      }],
    }),
    text: vi.fn(),
  };
}

function makeHtmlResponse(url: string, html: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: vi.fn().mockResolvedValue(html),
    json: vi.fn(),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('web-live-fallback', () => {
  test('accepts strong exact-match stats+events extracted from grounded search', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        `MATCHED: true
MATCH_TITLE: Japan W vs Australia W
MATCH_URL: https://www.bing.com/sportsdetails?q=Japan%20vs%20Australia
HOME_TEAM: Japan W
AWAY_TEAM: Australia W
COMPETITION: AFC Asian Cup Women
STATUS: HT
MINUTE: 45
HOME_SCORE: 1
AWAY_SCORE: 0
POSSESSION_HOME: 45
POSSESSION_AWAY: 55
SHOTS_HOME: 9
SHOTS_AWAY: 5
SHOTS_ON_TARGET_HOME: 3
SHOTS_ON_TARGET_AWAY: 2
CORNERS_HOME: 2
CORNERS_AWAY: 1
FOULS_HOME: 0
FOULS_AWAY: 6
YELLOW_CARDS_HOME: 0
YELLOW_CARDS_AWAY: 0
RED_CARDS_HOME: 0
RED_CARDS_AWAY: 0
EVENTS: 17|home|goal|Normal Goal|M. Hamano
NOTES: Strong exact match.
SEARCH_QUERIES: Japan W vs Australia W stats
SOURCE_DOMAINS: bing.com, reuters.com`,
        {
          webSearchQueries: ['Japan W vs Australia W stats'],
          groundingChunks: [
            { web: { uri: 'https://www.bing.com/sportsdetails?q=Japan%20vs%20Australia', title: 'Japan vs Australia' } },
            { web: { uri: 'https://www.reuters.com/world/asia-pacific/example', title: 'Reuters' } },
          ],
        },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No better stats-reference URL found.',
        {
          groundingChunks: [],
          webSearchQueries: ['site:sofascore.com OR site:fotmob.com OR site:flashscore.com Japan vs Australia AFC Asian Cup Women'],
        },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No official event URL found.',
        {
          groundingChunks: [],
          webSearchQueries: ['site:the-afc.com Japan vs Australia AFC Asian Cup Women'],
        },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No exact Sofascore URL found.',
        {
          groundingChunks: [],
          webSearchQueries: ['site:sofascore.com Japan W vs Australia W'],
        },
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://www.bing.com/sportsdetails?q=Japan%20vs%20Australia',
        '<html><head><title>Japan vs Australia</title></head><body>Match Stats Shots on goal 3 2 Shots 9 5 Possession 45 55 Fouls 0 6 Corner 2 1 Yellow cards 0 0 Red cards 0 0 Timeline Goal 17 Hamano</body></html>',
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://www.reuters.com/world/asia-pacific/example',
        '<html><head><title>Reuters</title></head><body>Japan led Australia 1-0 at halftime via Hamano.</body></html>',
      ))
      .mockResolvedValueOnce(makeGeminiResponse(JSON.stringify({
        matched: true,
        matched_title: 'Japan W vs Australia W',
        matched_url: 'https://www.bing.com/sportsdetails?q=Japan%20vs%20Australia',
        home_team: 'Japan W',
        away_team: 'Australia W',
        competition: 'AFC Asian Cup Women',
        status: 'HT',
        minute: 45,
        score: { home: 1, away: 0 },
        stats: {
          possession: { home: 45, away: 55 },
          shots: { home: 9, away: 5 },
          shots_on_target: { home: 3, away: 2 },
          corners: { home: 2, away: 1 },
          fouls: { home: 0, away: 6 },
          yellow_cards: { home: 0, away: 0 },
          red_cards: { home: 0, away: 0 },
        },
        events: [
          { minute: 17, team: 'home', type: 'goal', detail: 'Normal Goal', player: 'M. Hamano' },
        ],
        notes: 'Strong exact match.',
      })));

    const result = await fetchWebLiveFallback({
      homeTeam: 'Japan W',
      awayTeam: 'Australia W',
      league: 'AFC Asian Cup Women',
      matchDate: '2026-03-21',
      status: 'HT',
      minute: 45,
      score: { home: 1, away: 0 },
      requestedSlots: { stats: true, events: true },
    });

    expect(result.success).toBe(true);
    expect(result.validation.accepted).toBe(true);
    expect(result.sourceMeta.trusted_source_count).toBeGreaterThanOrEqual(1);
    expect(result.structured?.matched_url).toContain('bing.com');
    expect(countPrimaryStatPairs(result.structured!.stats)).toBe(5);
    expect(result.structured?.events).toHaveLength(1);
  });

  test('rejects mismatched score and weak coverage', () => {
    const validation = validateWebLiveFallbackResult(
      {
        homeTeam: 'Japan W',
        awayTeam: 'Australia W',
        league: 'AFC Asian Cup Women',
        matchDate: '2026-03-21',
        status: 'HT',
        minute: 45,
        score: { home: 1, away: 0 },
        requestedSlots: { stats: true, events: true },
      },
      {
        matched: true,
        matched_title: 'Japan W vs Australia W',
        matched_url: 'https://example.com',
        home_team: 'Japan Women',
        away_team: 'Australia Women',
        competition: 'AFC Asian Cup Women',
        status: 'HT',
        minute: 45,
        score: { home: 2, away: 0 },
        stats: {
          possession: { home: 45, away: 55 },
          shots: { home: null, away: null },
          shots_on_target: { home: null, away: null },
          corners: { home: null, away: null },
          fouls: { home: null, away: null },
          yellow_cards: { home: null, away: null },
          red_cards: { home: null, away: null },
        },
        events: [],
        notes: '',
      },
      {
        search_quality: 'low',
        web_search_queries: [],
        sources: [],
        trusted_source_count: 0,
        rejected_source_count: 0,
        rejected_domains: [],
      },
    );

    expect(validation.accepted).toBe(false);
    expect(validation.reasons).toContain('SCORE_MISMATCH');
    expect(validation.reasons).toContain('INSUFFICIENT_STATS_COVERAGE');
    expect(validation.reasons).toContain('INSUFFICIENT_EVENTS_COVERAGE');
    expect(validation.reasons).toContain('LOW_TRUST_SOURCES');
  });

  test('prefers deterministic Sofascore extraction when a Sofascore page is resolved', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        'MATCHED: false',
        { groundingChunks: [], webSearchQueries: ['initial search'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No extra stats-reference URL found.',
        { groundingChunks: [], webSearchQueries: ['site:sofascore.com Liaoning Tieren vs Tianjin Jinmen Tiger'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No official event URL found.',
        { groundingChunks: [], webSearchQueries: ['site:csl.com.cn Liaoning Tieren vs Tianjin Jinmen Tiger'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'Resolved Sofascore result.',
        {
          groundingChunks: [
            { web: { uri: 'https://www.sofascore.com/football/match/liaoning-tieren-fc-tianjin-jinmen-tiger/rrbsPzNb', title: 'Sofascore' } },
          ],
          webSearchQueries: ['site:sofascore.com Liaoning Tieren vs Tianjin Jinmen Tiger'],
        },
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://www.sofascore.com/football/match/liaoning-tieren-fc-tianjin-jinmen-tiger/rrbsPzNb',
        '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialProps":{"event":{"id":15551901}}}}}</script>',
      ))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://www.sofascore.com/api/v1/event/15551901',
        text: vi.fn(),
        json: vi.fn().mockResolvedValue({
          event: {
            homeTeam: { name: 'Liaoning Tieren FC' },
            awayTeam: { name: 'Tianjin Jinmen Tiger' },
            tournament: { name: 'Chinese Super League' },
            status: { description: 'Ended' },
            homeScore: { current: 3 },
            awayScore: { current: 0 },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://www.sofascore.com/api/v1/event/15551901/incidents',
        text: vi.fn(),
        json: vi.fn().mockResolvedValue({
          incidents: [
            { incidentType: 'goal', isHome: true, time: 23, scoringPlayer: { name: 'Mbia' }, reason: 'Normal Goal' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://www.sofascore.com/api/v1/event/15551901/statistics',
        text: vi.fn(),
        json: vi.fn().mockResolvedValue({
          statistics: [
            {
              period: 'ALL',
              groups: [
                {
                  statisticsItems: [
                    { key: 'ballPossession', homeValue: 60, awayValue: 40 },
                    { key: 'totalShotsOnGoal', homeValue: 15, awayValue: 10 },
                    { key: 'shotsOnTarget', homeValue: 5, awayValue: 2 },
                    { key: 'cornerKicks', homeValue: 6, awayValue: 9 },
                    { key: 'fouls', homeValue: 11, awayValue: 11 },
                    { key: 'yellowCards', homeValue: 1, awayValue: 1 },
                    { key: 'redCards', homeValue: 0, awayValue: 1 },
                  ],
                },
              ],
            },
          ],
        }),
      });

    const result = await fetchWebLiveFallback({
      homeTeam: 'Liaoning Tieren',
      awayTeam: 'Tianjin Jinmen Tiger',
      league: 'Chinese Super League',
      matchDate: '2026-03-21',
      status: 'FT',
      minute: 90,
      score: { home: 3, away: 0 },
      requestedSlots: { stats: true, events: true },
    });

    expect(result.success).toBe(true);
    expect(result.validation.accepted).toBe(true);
    expect(result.sourceMeta.trusted_source_count).toBeGreaterThanOrEqual(1);
    expect(result.structured?.matched_url).toContain('sofascore.com');
    expect(result.structured?.stats.possession).toEqual({ home: 60, away: 40 });
    expect(result.structured?.events[0]).toMatchObject({ type: 'goal', team: 'home' });
  });

  test('fails safely when Gemini returns no structured JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        'MATCHED: false',
        { groundingChunks: [], webSearchQueries: [] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No stats-reference URL found.',
        { groundingChunks: [], webSearchQueries: ['site:sofascore.com Zeta Phantom FC vs Omega Mirage United'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No official event URL found.',
        { groundingChunks: [], webSearchQueries: ['site:fifa.com Zeta Phantom FC vs Omega Mirage United'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No exact Sofascore URL found.',
        { groundingChunks: [], webSearchQueries: ['site:sofascore.com Zeta Phantom FC vs Omega Mirage United'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse('not json at all'));

    const result = await fetchWebLiveFallback({
      homeTeam: 'Zeta Phantom FC',
      awayTeam: 'Omega Mirage United',
      league: 'Neverland Premier League',
      matchDate: '2026-03-21',
      status: 'HT',
      minute: 45,
      score: { home: 1, away: 0 },
      requestedSlots: { stats: true, events: true },
    });

    expect(result.success).toBe(false);
    expect(result.structured).toBeNull();
    expect(result.validation.accepted).toBe(false);
    expect(result.error).toBe('STRUCTURED_RESPONSE_NOT_JSON');
  });

  test('merges targeted trusted sources from direct URLs before structured extraction', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        'MATCHED: false',
        { groundingChunks: [], webSearchQueries: ['initial search'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'Use this exact stats page: https://www.fotmob.com/match/123456/japan-vs-australia',
        { groundingChunks: [], webSearchQueries: ['site:fotmob.com Japan vs Australia AFC Asian Cup Women'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'Official match page: https://www.the-afc.com/en/more/photo/japan_vs_australia.html',
        { groundingChunks: [], webSearchQueries: ['site:the-afc.com Japan vs Australia AFC Asian Cup Women'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No exact Sofascore URL found.',
        { groundingChunks: [], webSearchQueries: ['site:sofascore.com Japan vs Australia'] },
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://www.the-afc.com/en/more/photo/japan_vs_australia.html',
        '<html><head><title>Japan vs Australia Official</title></head><body>17 Hamano goal. Japan lead 1-0 at halftime.</body></html>',
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://www.fotmob.com/match/123456/japan-vs-australia',
        '<html><head><title>Japan vs Australia - FotMob</title></head><body>Match Stats Shots on goal 3 2 Shots 9 5 Possession 45 55 Fouls 0 6</body></html>',
      ))
      .mockResolvedValueOnce(makeGeminiResponse(JSON.stringify({
        matched: true,
        matched_title: 'Japan W vs Australia W',
        matched_url: 'https://www.fotmob.com/match/123456/japan-vs-australia',
        home_team: 'Japan W',
        away_team: 'Australia W',
        competition: 'AFC Asian Cup Women',
        status: 'HT',
        minute: 45,
        score: { home: 1, away: 0 },
        stats: {
          possession: { home: 45, away: 55 },
          shots: { home: 9, away: 5 },
          shots_on_target: { home: 3, away: 2 },
          corners: { home: null, away: null },
          fouls: { home: 0, away: 6 },
          yellow_cards: { home: null, away: null },
          red_cards: { home: null, away: null },
        },
        events: [
          { minute: 17, team: 'home', type: 'goal', detail: 'Normal Goal', player: 'M. Hamano' },
        ],
        notes: 'Merged targeted trusted sources.',
      })));

    const result = await fetchWebLiveFallback({
      homeTeam: 'Japan W',
      awayTeam: 'Australia W',
      league: 'AFC Asian Cup Women',
      matchDate: '2026-03-21',
      status: 'HT',
      minute: 45,
      score: { home: 1, away: 0 },
      requestedSlots: { stats: true, events: true },
    });

    expect(result.success).toBe(true);
    expect(result.sourceMeta.trusted_source_count).toBeGreaterThanOrEqual(2);
    expect(result.sourceMeta.sources.some((source) => source.domain === 'fotmob.com')).toBe(true);
    expect(result.sourceMeta.sources.some((source) => source.domain === 'the-afc.com')).toBe(true);
    expect(result.validation.accepted).toBe(true);
  });

  test('accepts deterministic events-only extraction from grounded draft when trusted sources are present', async () => {
    fetchMock
      .mockResolvedValueOnce(makeGeminiResponse(
        `MATCHED: true
MATCH_TITLE: Japan vs Australia, AFC Women's Asian Cup 2026 Final
MATCH_URL: https://www.aljazeera.com/sports/2026/3/21/live-japan-1-0-australia-womens-asian-cup-2026-final
HOME_TEAM: Japan W
AWAY_TEAM: Australia W
COMPETITION: AFC Asian Cup Women
STATUS: HT
MINUTE: 45
HOME_SCORE: 1
AWAY_SCORE: 0
EVENTS: [{"minute":17,"team":"Japan","type":"goal","player":"Maika Hamano","detail":"Goal"}]
NOTES: Exact live final page.
SEARCH_QUERIES: Japan W vs Australia W AFC Asian Cup Women 2026 live
SOURCE_DOMAINS: aljazeera.com, theguardian.com`,
        {
          groundingChunks: [
            { web: { uri: 'https://www.aljazeera.com/sports/2026/3/21/live-japan-1-0-australia-womens-asian-cup-2026-final', title: 'Al Jazeera' } },
            { web: { uri: 'https://www.theguardian.com/football/live/2026/mar/21/japan-vs-australia', title: 'The Guardian' } },
          ],
          webSearchQueries: ['Japan W vs Australia W AFC Asian Cup Women 2026 live'],
        },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'No extra stats-reference URL found.',
        { groundingChunks: [], webSearchQueries: ['site:sofascore.com Japan vs Australia'] },
      ))
      .mockResolvedValueOnce(makeGeminiResponse(
        'Official/tier-1 pages already found.',
        { groundingChunks: [], webSearchQueries: ['site:the-afc.com Japan vs Australia'] },
      ));

    const result = await fetchWebLiveFallback({
      homeTeam: 'Japan W',
      awayTeam: 'Australia W',
      league: 'AFC Asian Cup Women',
      matchDate: '2026-03-21',
      status: 'HT',
      minute: 45,
      score: { home: 1, away: 0 },
      requestedSlots: { events: true },
    });

    expect(result.success).toBe(true);
    expect(result.validation.accepted).toBe(true);
    expect(result.structured?.events).toEqual([
      { minute: 17, team: 'home', type: 'goal', detail: 'Goal', player: 'Maika Hamano' },
    ]);
    expect(result.fetchedPages ?? []).toHaveLength(0);
  });
});
