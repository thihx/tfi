import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const {
  clearKLeaguePortalCaches,
  fetchKLeaguePortalMatchData,
} = await import('../lib/kleague-portal-extractor.js');

function makeHeaders(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
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

function makeCalendarHtml() {
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

function makePopupHtml() {
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
  clearKLeaguePortalCaches();
});

describe('kleague-portal-extractor', () => {
  test('returns null for unsupported leagues', async () => {
    const result = await fetchKLeaguePortalMatchData({
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      league: 'Japanese J1 League',
      matchDate: '2026-03-22',
      status: '2H',
      minute: 58,
      score: { home: 0, away: 0 },
      includeStats: true,
      includeEvents: true,
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('extracts live stats and events from K League portal popup data', async () => {
    fetchMock
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://portal.kleague.com/user/loginById.do?portalGuest=FOE2iHDb67wBfj85uPpIgQ%3D%3D',
        '',
        302,
        { 'set-cookie': 'PORTAL_GUEST=test-session; Path=/; HttpOnly' },
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://portal.kleague.com/main/schedule/calendar.do',
        makeCalendarHtml(),
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        'https://portal.kleague.com/common/result/result0051popup.do',
        makePopupHtml(),
      ));

    const result = await fetchKLeaguePortalMatchData({
      homeTeam: 'Ulsan Hyundai FC',
      awayTeam: 'Gimcheon Sangmu FC',
      league: 'K League 1',
      matchDate: '2026-03-22',
      status: '2H',
      minute: 58,
      score: { home: 0, away: 0 },
      includeStats: true,
      includeEvents: true,
    });

    expect(result).not.toBeNull();
    expect(result?.match.competition).toBe('하나은행 K리그1 2026');
    expect(result?.match.status).toBe('2H');
    expect(result?.match.minute).toBe(58);
    expect(result?.match.score).toEqual({ home: 0, away: 0 });
    expect(result?.stats.possession).toEqual({ home: 39, away: 61 });
    expect(result?.stats.shots).toEqual({ home: 18, away: 4 });
    expect(result?.stats.shots_on_target).toEqual({ home: 9, away: 2 });
    expect(result?.stats.corners).toEqual({ home: 4, away: 2 });
    expect(result?.events).toEqual([
      { minute: 12, team: 'home', type: 'yellow_card', detail: 'Yellow Card', player: 'Lee Player' },
      { minute: 46, team: 'away', type: 'subst', detail: 'Kim In (Kim Out)', player: 'Kim In' },
    ]);
  });
});
