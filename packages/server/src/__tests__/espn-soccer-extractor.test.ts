import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const {
  fetchEspnSoccerMatchData,
  parseEspnMatchStatsHtml,
  resolveEspnLeagueSlugs,
} = await import('../lib/espn-soccer-extractor.js');

function makeJsonResponse(url: string, payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    json: vi.fn().mockResolvedValue(payload),
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

describe('espn-soccer-extractor', () => {
  test('maps supported Asian leagues to ESPN slugs', () => {
    expect(resolveEspnLeagueSlugs('Japanese J1 League')).toContain('jpn.1');
    expect(resolveEspnLeagueSlugs('Chinese Super League')).toContain('chn.1');
    expect(resolveEspnLeagueSlugs('AFC Champions League Elite')).toContain('afc.champions');
    expect(resolveEspnLeagueSlugs('K League 1')).toEqual([]);
  });

  test('parses stats from ESPN matchstats HTML', () => {
    const html = `
      <section>
        <header>Match Stats</header>
        <span>Possession</span>
        <div><span>33<span>%</span></span><span>67<span>%</span></span></div>
        <span>Shots on Goal</span>
        <div><span>5</span><span>6</span></div>
        <span>Shot Attempts</span>
        <div><span>11</span><span>23</span></div>
        <span>Yellow Cards</span>
        <div><span>0</span><span>1</span></div>
        <span>Red Cards</span>
        <div><span>0</span><span>0</span></div>
        <span>Corner Kicks</span>
        <div><span>3</span><span>5</span></div>
        <span>Fouls</span>
        <div><span>9</span><span>12</span></div>
      </section>
    `;

    expect(parseEspnMatchStatsHtml(html)).toEqual({
      possession: { home: 33, away: 67 },
      shots: { home: 11, away: 23 },
      shots_on_target: { home: 5, away: 6 },
      corners: { home: 3, away: 5 },
      fouls: { home: 9, away: 12 },
      yellow_cards: { home: 0, away: 1 },
      red_cards: { home: 0, away: 0 },
    });
  });

  test('resolves Chinese Super League event and extracts stats plus key events', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(
        'https://site.api.espn.com/apis/site/v2/sports/soccer/chn.1/scoreboard?dates=20260321',
        {
          events: [
            {
              id: '401861519',
              name: 'Tianjin Jinmen Tiger at Liaoning Tieren',
              competitions: [{
                competitors: [
                  { homeAway: 'home', team: { displayName: 'Liaoning Tieren' }, score: '3' },
                  { homeAway: 'away', team: { displayName: 'Tianjin Jinmen Tiger' }, score: '0' },
                ],
              }],
              leagues: [{ name: 'Chinese Super League' }],
              status: { type: { shortDetail: 'FT' } },
            },
          ],
        },
      ))
      .mockResolvedValueOnce(makeJsonResponse(
        'https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=401861519',
        {
          header: {
            competitions: [{
              status: {
                type: {
                  shortDetail: 'FT',
                  name: 'STATUS_FULL_TIME',
                },
              },
              groups: { name: 'Chinese Super League' },
              competitors: [
                { homeAway: 'home', score: '3', team: { displayName: 'Liaoning Tieren' } },
                { homeAway: 'away', score: '0', team: { displayName: 'Tianjin Jinmen Tiger' } },
              ],
              details: [
                {
                  clock: { displayValue: "23'" },
                  scoringPlay: true,
                  penaltyKick: false,
                  ownGoal: false,
                  team: { displayName: 'Liaoning Tieren' },
                  participants: [{ athlete: { displayName: 'Guy Mbenza' } }],
                },
                {
                  clock: { displayValue: "90'+7'" },
                  scoringPlay: false,
                  redCard: true,
                  team: { displayName: 'Tianjin Jinmen Tiger' },
                  participants: [{ athlete: { displayName: 'Xiandiao Wang' } }],
                },
              ],
            }],
          },
        },
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://www.espn.com/soccer/matchstats/_/gameId/401861519',
        `
          <section>
            <header>Match Stats</header>
            <span>Possession</span><div><span>60<span>%</span></span><span>40<span>%</span></span></div>
            <span>Shots on Goal</span><div><span>6</span><span>2</span></div>
            <span>Shot Attempts</span><div><span>15</span><span>8</span></div>
            <span>Yellow Cards</span><div><span>1</span><span>1</span></div>
            <span>Red Cards</span><div><span>0</span><span>1</span></div>
            <span>Corner Kicks</span><div><span>6</span><span>9</span></div>
            <span>Fouls</span><div><span>11</span><span>11</span></div>
          </section>
        `,
      ));

    const result = await fetchEspnSoccerMatchData({
      homeTeam: 'Liaoning Tieren',
      awayTeam: 'Tianjin Jinmen Tiger',
      league: 'Chinese Super League',
      matchDate: '2026-03-21',
      status: 'FT',
      score: { home: 3, away: 0 },
      includeStats: true,
      includeEvents: true,
    });

    expect(result).not.toBeNull();
    expect(result?.leagueSlug).toBe('chn.1');
    expect(result?.match.competition).toBe('Chinese Super League');
    expect(result?.match.score).toEqual({ home: 3, away: 0 });
    expect(result?.stats.possession).toEqual({ home: 60, away: 40 });
    expect(result?.stats.shots_on_target).toEqual({ home: 6, away: 2 });
    expect(result?.stats.corners).toEqual({ home: 6, away: 9 });
    expect(result?.events).toEqual([
      { minute: 23, team: 'home', type: 'goal', detail: 'Goal', player: 'Guy Mbenza' },
      { minute: 90, team: 'away', type: 'red_card', detail: 'Red Card', player: 'Xiandiao Wang' },
    ]);
  });
});
