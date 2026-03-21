import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const {
  extractSofascoreEventIdFromHtml,
  fetchSofascoreMatchDataFromPageUrl,
  parseSofascoreStatisticsPayload,
  parseSofascoreIncidentsPayload,
} = await import('../lib/sofascore-extractor.js');

beforeEach(() => {
  fetchMock.mockReset();
});

describe('sofascore-extractor', () => {
  test('extracts event id from __NEXT_DATA__ payload', () => {
    const html = `
      <html>
        <head></head>
        <body>
          <script id="__NEXT_DATA__" type="application/json">
            {"props":{"pageProps":{"initialProps":{"event":{"id":15551901}}}}}
          </script>
        </body>
      </html>
    `;

    expect(extractSofascoreEventIdFromHtml(html)).toBe('15551901');
  });

  test('parses statistics payload into compact shape', () => {
    const stats = parseSofascoreStatisticsPayload({
      statistics: [
        {
          period: 'ALL',
          groups: [
            {
              groupName: 'Match overview',
              statisticsItems: [
                { key: 'ballPossession', homeValue: 60, awayValue: 40 },
                { key: 'totalShotsOnGoal', homeValue: 15, awayValue: 10 },
                { key: 'shotsOnTarget', homeValue: 6, awayValue: 2 },
                { key: 'cornerKicks', homeValue: 6, awayValue: 9 },
                { key: 'fouls', homeValue: 11, awayValue: 11 },
                { key: 'yellowCards', homeValue: 1, awayValue: 1 },
                { key: 'redCards', homeValue: 0, awayValue: 1 },
              ],
            },
          ],
        },
      ],
    });

    expect(stats).toEqual({
      possession: { home: 60, away: 40 },
      shots: { home: 15, away: 10 },
      shots_on_target: { home: 6, away: 2 },
      corners: { home: 6, away: 9 },
      fouls: { home: 11, away: 11 },
      yellow_cards: { home: 1, away: 1 },
      red_cards: { home: 0, away: 1 },
    });
  });

  test('parses incidents payload into goal/card/subst events', () => {
    const events = parseSofascoreIncidentsPayload({
      incidents: [
        {
          incidentType: 'goal',
          isHome: true,
          time: 23,
          scoringPlayer: { name: 'Mbia' },
          reason: 'Normal Goal',
        },
        {
          incidentType: 'card',
          incidentClass: 'yellow',
          isHome: false,
          time: 61,
          player: { name: 'Smith' },
        },
        {
          incidentType: 'substitution',
          isHome: true,
          time: 78,
          playerIn: { name: 'Player In' },
          playerOut: { name: 'Player Out' },
        },
      ],
    });

    expect(events).toEqual([
      { minute: 23, team: 'home', type: 'goal', detail: 'Normal Goal', player: 'Mbia' },
      { minute: 61, team: 'away', type: 'yellow_card', detail: 'yellow', player: 'Smith' },
      { minute: 78, team: 'home', type: 'subst', detail: 'Player In for Player Out', player: 'Player In' },
    ]);
  });

  test('keeps event and incident data when statistics endpoint is missing', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://www.sofascore.com/football/match/japan-australia/kYcstYc',
        text: vi.fn().mockResolvedValue(`
          <html>
            <head>
              <meta property="og:image" content="https://img.sofascore.com/api/v1/event/14372336/share-image/16x9" />
            </head>
            <body></body>
          </html>
        `),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          event: {
            homeTeam: { name: 'Japan' },
            awayTeam: { name: 'Australia' },
            tournament: { name: 'AFC Asian Cup, Women, Knockout stage' },
            status: { description: 'Finished' },
            homeScore: { current: 1, normaltime: 1 },
            awayScore: { current: 0, normaltime: 0 },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          incidents: [
            { incidentType: 'goal', isHome: true, time: 17, scoringPlayer: { name: 'Maika Hamano' }, reason: 'Normal Goal' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue('{"error":{"code":404,"message":"Not Found"}}'),
      });

    const result = await fetchSofascoreMatchDataFromPageUrl('https://vertexaisearch.cloud.google.com/fake-sofascore-redirect');

    expect(result.eventId).toBe('14372336');
    expect(result.match.score).toEqual({ home: 1, away: 0 });
    expect(result.events).toEqual([
      { minute: 17, team: 'home', type: 'goal', detail: 'Normal Goal', player: 'Maika Hamano' },
    ]);
    expect(result.stats).toEqual({
      possession: { home: null, away: null },
      shots: { home: null, away: null },
      shots_on_target: { home: null, away: null },
      corners: { home: null, away: null },
      fouls: { home: null, away: null },
      yellow_cards: { home: null, away: null },
      red_cards: { home: null, away: null },
    });
  });
});
