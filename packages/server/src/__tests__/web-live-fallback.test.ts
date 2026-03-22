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
  fetchDeterministicWebLiveFallback,
  fetchWebLiveFallback,
  validateWebLiveFallbackResult,
} = await import('../lib/web-live-fallback.js');

function makeHeaders(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function makeJsonResponse(url: string, payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: makeHeaders({}),
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    json: vi.fn().mockResolvedValue(payload),
  };
}

function makeHtmlResponse(url: string, html: string, status = 200, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: makeHeaders(headers ?? {}),
    text: vi.fn().mockResolvedValue(html),
    json: vi.fn(),
  };
}

function makeKLeagueCalendarHtml() {
  return `
    <div>
      <a
        href="#"
        onclick="javascript:ddrivetip('','','울산','김천','2026/03/22','14:00','문수경기장',''); fn_detailPopup('2026','1','하나은행 K리그1 2026','27','2','0');"
      >
        detail
      </a>
      <span class="flL pl5">울산 : 김천</span>
      <span class="flR pr5">(0:0)</span>
    </div>
  `;
}

function makeKLeaguePopupHtml() {
  const payload = [
    [],
    [],
    [{
      H_Warn_Qty: 0,
      H_Exit_Qty: 0,
      H_CK_Qty: 4,
      H_FO_Qty: 11,
      H_ST_Qty: 18,
      H_Valid_ST_Qty: 9,
      H_Goal_Qty: 0,
      A_Warn_Qty: 4,
      A_Exit_Qty: 0,
      A_CK_Qty: 2,
      A_FO_Qty: 21,
      A_ST_Qty: 4,
      A_Valid_ST_Qty: 2,
      A_Goal_Qty: 0,
    }],
    [{
      Meet_Name: '하나은행 K리그1 2026',
      RunMin: 58,
    }],
    [],
    [{
      Team_Share_Half: 39,
    }],
    [{
      Team_Share_Half: 61,
    }],
    [],
    [
      {
        Team_Id: 'K01',
        Action_Type: 'Y',
        Remark1: 'Lee Player',
        Remark2: '',
        Display_Time: '12',
        Min_Seq: 12,
      },
      {
        Team_Id: 'K35',
        Action_Type: 'C',
        Remark1: 'Kim In',
        Remark2: '(Kim Out)',
        Display_Time: '45+1',
        Min_Seq: 46,
      },
    ],
    [{
      Home_Team: 'K01',
      Away_Team: 'K35',
    }],
  ];

  return `<html><script>var jsonResultData = ${JSON.stringify(payload)};</script></html>`;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('web-live-fallback', () => {
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

  test('prefers deterministic Sofascore extraction before any Gemini grounding', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/search/teams/Liaoning%20Tieren', {
        teams: [
          {
            id: 610001,
            name: 'Liaoning Tieren FC',
            slug: 'liaoning-tieren-fc',
            national: false,
            gender: 'M',
            sport: { id: 1, slug: 'football', name: 'Football' },
            country: { alpha2: 'CN', name: 'China', slug: 'china' },
          },
        ],
      }))
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/search/teams/Tianjin%20Jinmen%20Tiger', {
        teams: [
          {
            id: 610002,
            name: 'Tianjin Jinmen Tiger',
            slug: 'tianjin-jinmen-tiger',
            national: false,
            gender: 'M',
            sport: { id: 1, slug: 'football', name: 'Football' },
            country: { alpha2: 'CN', name: 'China', slug: 'china' },
          },
        ],
      }))
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/team/610001/events/last/0', {
        events: [
          {
            id: 15551901,
            slug: 'liaoning-tieren-fc-tianjin-jinmen-tiger',
            customId: 'rrbsPzNb',
            startTimestamp: 1774137600,
            tournament: {
              name: 'Chinese Super League',
              uniqueTournament: { name: 'Chinese Super League' },
            },
            status: { type: 'finished', description: 'Ended' },
            homeTeam: { id: 610001, name: 'Liaoning Tieren FC' },
            awayTeam: { id: 610002, name: 'Tianjin Jinmen Tiger' },
            homeScore: { current: 3 },
            awayScore: { current: 0 },
          },
        ],
      }))
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/team/610001/events/next/0', { events: [] }))
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/event/15551901', {
        event: {
          homeTeam: { name: 'Liaoning Tieren FC' },
          awayTeam: { name: 'Tianjin Jinmen Tiger' },
          tournament: { name: 'Chinese Super League' },
          status: { description: 'Ended' },
          homeScore: { current: 3 },
          awayScore: { current: 0 },
        },
      }))
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/event/15551901/incidents', {
        incidents: [
          { incidentType: 'goal', isHome: true, time: 23, scoringPlayer: { name: 'Mbia' }, reason: 'Normal Goal' },
        ],
      }))
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/event/15551901/statistics', {
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
      }));

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
    expect(result.structured?.matched_url).toContain('sofascore.com');
    expect(countPrimaryStatPairs(result.structured!.stats)).toBeGreaterThanOrEqual(5);
    expect(result.structured?.events[0]).toMatchObject({ type: 'goal', team: 'home' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('generativelanguage.googleapis.com'))).toBe(false);
  });

  test('accepts deterministic ESPN stats fallback for supported Asian leagues', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/search/teams/Kashima%20Antlers', { teams: [] }))
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/search/teams/Kashima', { teams: [] }))
      .mockResolvedValueOnce(makeJsonResponse('https://www.sofascore.com/api/v1/search/teams/JEF%20United%20Chiba', { teams: [] }))
      .mockResolvedValueOnce(makeJsonResponse(
        'https://site.api.espn.com/apis/site/v2/sports/soccer/jpn.1/scoreboard?dates=20260322',
        {
          events: [
            {
              id: '401861800',
              name: 'JEF United Chiba at Kashima Antlers',
              competitions: [{
                competitors: [
                  { homeAway: 'home', team: { displayName: 'Kashima Antlers' }, score: '2' },
                  { homeAway: 'away', team: { displayName: 'JEF United Chiba' }, score: '1' },
                ],
              }],
              leagues: [{ name: 'Japanese J1 League' }],
              status: { type: { shortDetail: 'FT' } },
            },
          ],
        },
      ))
      .mockResolvedValueOnce(makeJsonResponse(
        'https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=401861800',
        {
          header: {
            competitions: [{
              status: { type: { shortDetail: 'FT', name: 'STATUS_FULL_TIME' } },
              groups: { name: 'Japanese J1 League' },
              competitors: [
                { homeAway: 'home', score: '2', team: { displayName: 'Kashima Antlers' } },
                { homeAway: 'away', score: '1', team: { displayName: 'JEF United Chiba' } },
              ],
              details: [
                {
                  clock: { displayValue: "14'" },
                  scoringPlay: true,
                  team: { displayName: 'Kashima Antlers' },
                  participants: [{ athlete: { displayName: 'Yuma Suzuki' } }],
                },
              ],
            }],
          },
        },
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://www.espn.com/soccer/matchstats/_/gameId/401861800',
        `
          <section>
            <header>Match Stats</header>
            <span>Possession</span><div><span>58<span>%</span></span><span>42<span>%</span></span></div>
            <span>Shots on Goal</span><div><span>7</span><span>3</span></div>
            <span>Shot Attempts</span><div><span>16</span><span>8</span></div>
            <span>Yellow Cards</span><div><span>1</span><span>2</span></div>
            <span>Red Cards</span><div><span>0</span><span>0</span></div>
            <span>Corner Kicks</span><div><span>8</span><span>4</span></div>
            <span>Fouls</span><div><span>9</span><span>11</span></div>
          </section>
        `,
      ));

    const result = await fetchDeterministicWebLiveFallback({
      homeTeam: 'Kashima Antlers',
      awayTeam: 'JEF United Chiba',
      league: 'Japanese J1 League',
      matchDate: '2026-03-22',
      status: 'FT',
      minute: 90,
      score: { home: 2, away: 1 },
      requestedSlots: { stats: true, events: true },
    });

    expect(result.success).toBe(true);
    expect(result.validation.accepted).toBe(true);
    expect(result.structured?.matched_url).toContain('espn.com');
    expect(result.structured?.stats.possession).toEqual({ home: 58, away: 42 });
    expect(result.structured?.events[0]).toMatchObject({ type: 'goal', team: 'home' });
    expect(result.sourceMeta.sources.some((source) => source.domain === 'espn.com')).toBe(true);
  });

  test('accepts deterministic K League portal stats and events for live match coverage', async () => {
    fetchMock
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://portal.kleague.com/user/loginById.do?portalGuest=FOE2iHDb67wBfj85uPpIgQ%3D%3D',
        '',
        302,
        { 'set-cookie': 'PORTAL_GUEST=test-session; Path=/; HttpOnly' },
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://portal.kleague.com/main/schedule/calendar.do',
        makeKLeagueCalendarHtml(),
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://portal.kleague.com/common/result/result0051popup.do',
        makeKLeaguePopupHtml(),
      ));

    const result = await fetchDeterministicWebLiveFallback({
      homeTeam: 'Ulsan Hyundai FC',
      awayTeam: 'Gimcheon Sangmu FC',
      league: 'K League 1',
      matchDate: '2026-03-22',
      status: '2H',
      minute: 58,
      score: { home: 0, away: 0 },
      requestedSlots: { stats: true, events: true },
    });

    expect(result.success).toBe(true);
    expect(result.validation.accepted).toBe(true);
    expect(result.structured?.matched_url).toContain('portal.kleague.com');
    expect(result.structured?.stats.corners).toEqual({ home: 4, away: 2 });
    expect(result.structured?.stats.shots_on_target).toEqual({ home: 9, away: 2 });
    expect(result.structured?.events).toEqual([
      { minute: 12, team: 'home', type: 'yellow_card', detail: 'Yellow Card', player: 'Lee Player' },
      { minute: 46, team: 'away', type: 'subst', detail: 'Kim In (Kim Out)', player: 'Kim In' },
    ]);
    expect(result.sourceMeta.sources.some((source) => source.domain === 'portal.kleague.com')).toBe(true);
  });
});
