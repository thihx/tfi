interface KLeagueTwoSideStat {
  home: number | null;
  away: number | null;
}

export interface KLeaguePortalStatsCompact {
  possession: KLeagueTwoSideStat;
  shots: KLeagueTwoSideStat;
  shots_on_target: KLeagueTwoSideStat;
  corners: KLeagueTwoSideStat;
  fouls: KLeagueTwoSideStat;
  yellow_cards: KLeagueTwoSideStat;
  red_cards: KLeagueTwoSideStat;
}

export interface KLeaguePortalEventCompact {
  minute: number | null;
  team: 'home' | 'away' | 'unknown';
  type: 'goal' | 'yellow_card' | 'red_card' | 'subst' | 'other';
  detail: string;
  player: string;
}

export interface KLeaguePortalExtractRequest {
  homeTeam: string;
  awayTeam: string;
  league?: string;
  matchDate?: string | null;
  status?: string;
  minute?: number | null;
  score?: {
    home: number | null;
    away: number | null;
  } | null;
  includeStats?: boolean;
  includeEvents?: boolean;
}

interface KLeaguePortalMatchReference {
  meetYear: string;
  meetSeq: string;
  meetName: string;
  gameId: string;
  leagueId: string;
  endFlag: string;
  matchDate: string;
  kickoffTime: string;
  fieldName: string;
  homeTeamKo: string;
  awayTeamKo: string;
  score: {
    home: number | null;
    away: number | null;
  };
}

export interface KLeaguePortalExtractedMatchData {
  reference: KLeaguePortalMatchReference;
  urls: {
    calendar: string;
    popup: string;
  };
  match: {
    homeTeam: string;
    awayTeam: string;
    competition: string;
    status: string;
    minute: number | null;
    score: {
      home: number | null;
      away: number | null;
    };
  };
  stats: KLeaguePortalStatsCompact;
  events: KLeaguePortalEventCompact[];
  raw: {
    calendarHtml: string;
    popupHtml: string;
    jsonResultData: unknown;
  };
}

const KLEAGUE_GUEST_URL = 'https://portal.kleague.com/user/loginById.do?portalGuest=FOE2iHDb67wBfj85uPpIgQ%3D%3D';
const KLEAGUE_CALENDAR_URL = 'https://portal.kleague.com/main/schedule/calendar.do';
const KLEAGUE_POPUP_RESULT_URL = 'https://portal.kleague.com/common/result/result0051popup.do';
const KLEAGUE_POPUP_CL_URL = 'https://portal.kleague.com/common/result/result0052popup.do';
const SESSION_TTL_MS = 5 * 60_000;
const CALENDAR_TTL_MS = 60_000;
const POPUP_TTL_MS = 15_000;

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

let guestSessionCache: CachedValue<string> | null = null;
const calendarCache = new Map<string, CachedValue<string>>();
const popupCache = new Map<string, CachedValue<string>>();

const TEAM_DIRECTORY = [
  {
    teamCode: 'K01',
    aliasesEn: ['ulsan hd', 'ulsan hyundai', 'ulsan hyundai fc', 'ulsan'],
    aliasesKo: ['울산', '울산hd', '울산 hd'],
  },
  {
    teamCode: 'K35',
    aliasesEn: ['gimcheon sangmu', 'gimcheon sangmu fc', 'sangju sangmu'],
    aliasesKo: ['김천', '김천상무', '김천 상무'],
  },
  {
    teamCode: 'K09',
    aliasesEn: ['fc seoul', 'seoul'],
    aliasesKo: ['서울', 'fc서울', 'fc 서울'],
  },
  {
    teamCode: 'K22',
    aliasesEn: ['gwangju fc', 'gwangju'],
    aliasesKo: ['광주', '광주fc', '광주 fc'],
  },
  {
    teamCode: 'K10',
    aliasesEn: ['jeonbuk hyundai motors', 'jeonbuk motors', 'jeonbuk'],
    aliasesKo: ['전북', '전북현대', '전북 현대'],
  },
  {
    teamCode: 'K03',
    aliasesEn: ['pohang steelers', 'pohang'],
    aliasesKo: ['포항', '포항스틸러스', '포항 스틸러스'],
  },
  {
    teamCode: 'K21',
    aliasesEn: ['gangwon fc', 'gangwon'],
    aliasesKo: ['강원', '강원fc', '강원 fc'],
  },
  {
    teamCode: 'K27',
    aliasesEn: ['daejeon hana citizen', 'daejeon hana', 'daejeon'],
    aliasesKo: ['대전', '대전하나', '대전 하나'],
  },
  {
    teamCode: 'K04',
    aliasesEn: ['jeju sk', 'jeju united', 'jeju'],
    aliasesKo: ['제주', '제주sk', '제주 sk', '제주유나이티드'],
  },
  {
    teamCode: 'K05',
    aliasesEn: ['daegu fc', 'daegu'],
    aliasesKo: ['대구', '대구fc', '대구 fc'],
  },
  {
    teamCode: 'K29',
    aliasesEn: ['incheon united', 'incheon'],
    aliasesKo: ['인천', '인천유나이티드', '인천 유나이티드'],
  },
  {
    teamCode: 'K17',
    aliasesEn: ['suwon fc'],
    aliasesKo: ['수원fc', '수원 fc'],
  },
  {
    teamCode: 'K18',
    aliasesEn: ['fc anyang', 'anyang'],
    aliasesKo: ['안양', 'fc안양', 'fc 안양'],
  },
  {
    teamCode: 'K02',
    aliasesEn: ['busan ipark', 'busan i park', 'busan'],
    aliasesKo: ['부산', '부산아이파크', '부산 아이파크'],
  },
  {
    teamCode: 'K08',
    aliasesEn: ['gyeongnam fc', 'gyeongnam'],
    aliasesKo: ['경남', '경남fc', '경남 fc'],
  },
  {
    teamCode: 'K07',
    aliasesEn: ['jeonnam dragons', 'jeonnam'],
    aliasesKo: ['전남', '전남드래곤즈', '전남 드래곤즈'],
  },
  {
    teamCode: 'K31',
    aliasesEn: ['seoul e land fc', 'seoul e land', 'seoul e-land'],
    aliasesKo: ['서울e', '서울e랜드', '서울e 랜드', '서울 이랜드'],
  },
  {
    teamCode: 'K36',
    aliasesEn: ['gimpo fc', 'gimpo'],
    aliasesKo: ['김포', '김포fc', '김포 fc'],
  },
  {
    teamCode: 'K06',
    aliasesEn: ['seongnam fc', 'seongnam'],
    aliasesKo: ['성남', '성남fc', '성남 fc'],
  },
  {
    teamCode: 'K34',
    aliasesEn: ['chungnam asan', 'asan mugunghwa', 'asan'],
    aliasesKo: ['충남아산', '충남 아산', '아산'],
  },
  {
    teamCode: 'K39',
    aliasesEn: ['cheonan city', 'cheonan'],
    aliasesKo: ['천안', '천안시티', '천안 시티'],
  },
  {
    teamCode: 'K20',
    aliasesEn: ['bucheon fc 1995', 'bucheon fc', 'bucheon'],
    aliasesKo: ['부천', '부천fc', '부천 fc'],
  },
  {
    teamCode: 'K37',
    aliasesEn: ['chungbuk cheongju', 'cheongju fc', 'cheongju'],
    aliasesKo: ['충북청주', '충북 청주', '청주'],
  },
  {
    teamCode: 'K38',
    aliasesEn: ['ansan greeners', 'ansan'],
    aliasesKo: ['안산', '안산그리너스', '안산 그리너스'],
  },
  {
    teamCode: 'K32',
    aliasesEn: ['hwaseong fc', 'hwaseong'],
    aliasesKo: ['화성', '화성fc', '화성 fc'],
  },
] as const;

function cacheGet<T>(cache: Map<string, CachedValue<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet<T>(cache: Map<string, CachedValue<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
}

function cleanText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeEnglish(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bfc\b/g, ' ')
    .replace(/\bhd\b/g, 'hyundai')
    .replace(/\bsangju sangmu\b/g, 'gimcheon sangmu')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKorean(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/fc/g, '')
    .replace(/[^\p{Script=Hangul}\p{L}\p{N}]/gu, '');
}

function normalizeLeagueText(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function supportsKLeaguePortal(leagueName?: string): boolean {
  const normalized = normalizeLeagueText(cleanText(leagueName || ''));
  return normalized.includes('k league')
    || normalized.includes('k리그')
    || normalized.includes('korean cup')
    || normalized.includes('fa cup korea');
}

function resolveTeamDirectoryEntry(teamName: string) {
  const normalized = normalizeEnglish(teamName);
  return TEAM_DIRECTORY.find((entry) => entry.aliasesEn.some((alias) => normalized.includes(alias) || alias.includes(normalized))) || null;
}

function scoreTeamAliasMatch(teamName: string, teamKo: string): number {
  const entry = resolveTeamDirectoryEntry(teamName);
  if (!entry) return 0;
  const normalizedKo = normalizeKorean(teamKo);
  if (!normalizedKo) return 0;
  if (entry.teamCode && normalizedKo === normalizeKorean(entry.teamCode)) return 1;
  if (entry.aliasesKo.some((alias) => normalizedKo.includes(normalizeKorean(alias)) || normalizeKorean(alias).includes(normalizedKo))) {
    return 1;
  }
  return 0;
}

function buildPopupUrlByLeagueId(leagueId: string): string {
  return leagueId === '6' ? KLEAGUE_POPUP_CL_URL : KLEAGUE_POPUP_RESULT_URL;
}

async function fetchWithCookie(url: string, options?: { method?: string; cookie?: string; body?: URLSearchParams }): Promise<Response> {
  return await fetch(url, {
    method: options?.method || 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'text/html,application/xhtml+xml,application/json',
      ...(options?.cookie ? { Cookie: options.cookie } : {}),
      ...(options?.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    redirect: 'manual',
    body: options?.body?.toString(),
  });
}

async function getGuestSessionCookie(): Promise<string> {
  if (guestSessionCache && guestSessionCache.expiresAt > Date.now()) {
    return guestSessionCache.value;
  }

  const response = await fetchWithCookie(KLEAGUE_GUEST_URL);
  const cookie = response.headers.get('set-cookie')?.split(';')[0]?.trim();
  if (!cookie) {
    throw new Error('KLEAGUE_PORTAL_SESSION_UNAVAILABLE');
  }

  guestSessionCache = {
    value: cookie,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  return cookie;
}

export function clearKLeaguePortalCaches(): void {
  guestSessionCache = null;
  calendarCache.clear();
  popupCache.clear();
}

async function fetchCalendarHtml(year: string, month: string): Promise<string> {
  const cacheKey = `${year}-${month}`;
  const cached = cacheGet(calendarCache, cacheKey);
  if (cached) return cached;

  const cookie = await getGuestSessionCookie();
  const response = await fetchWithCookie(KLEAGUE_CALENDAR_URL, {
    method: 'POST',
    cookie,
    body: new URLSearchParams({
      selectYear: year,
      selectMonth: month,
    }),
  });

  if (!response.ok) {
    throw new Error(`KLEAGUE_PORTAL_CALENDAR_${response.status}`);
  }

  const html = await response.text();
  cacheSet(calendarCache, cacheKey, html, CALENDAR_TTL_MS);
  return html;
}

function parseScoreOrKickoff(value: string): { score: { home: number | null; away: number | null }; kickoffOnly: boolean } {
  const cleaned = cleanText(value);
  const scoreMatch = cleaned.match(/^\((\d+):(\d+)\)$/);
  if (scoreMatch) {
    return {
      score: {
        home: Number(scoreMatch[1]),
        away: Number(scoreMatch[2]),
      },
      kickoffOnly: false,
    };
  }

  return {
    score: { home: null, away: null },
    kickoffOnly: true,
  };
}

function parseCalendarEntries(html: string): KLeaguePortalMatchReference[] {
  const entries: KLeaguePortalMatchReference[] = [];
  const regex = /ddrivetip\('([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','[\s\S]*?'\)[\s\S]*?fn_detailPopup\('([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)'\);[\s\S]*?<span class="flL pl5">([^<]+)<\/span>[\s\S]*?<span class="flR pr5">\s*([^<]+?)\s*<\/span>/g;

  for (const match of html.matchAll(regex)) {
    const homeTeamKoTip = cleanText(match[3]);
    const awayTeamKoTip = cleanText(match[4]);
    const matchDate = cleanText(match[5]);
    const kickoffTime = cleanText(match[6]);
    const fieldName = cleanText(match[7]);
    const meetYear = cleanText(match[8]);
    const meetSeq = cleanText(match[9]);
    const meetName = cleanText(match[10]);
    const gameId = cleanText(match[11]);
    const leagueId = cleanText(match[12]);
    const endFlag = cleanText(match[13]);
    const visibleTeams = cleanText(match[14]);
    const scoreOrTime = cleanText(match[15]);

    const [visibleHome = homeTeamKoTip, visibleAway = awayTeamKoTip] = visibleTeams
      ? visibleTeams.split(':').map((part) => cleanText(part))
      : [homeTeamKoTip, awayTeamKoTip];
    const parsed = parseScoreOrKickoff(scoreOrTime);

    entries.push({
      meetYear,
      meetSeq,
      meetName,
      gameId,
      leagueId,
      endFlag,
      matchDate,
      kickoffTime,
      fieldName,
      homeTeamKo: visibleHome || homeTeamKoTip,
      awayTeamKo: visibleAway || awayTeamKoTip,
      score: parsed.score,
    });
  }

  return entries;
}

function scoreCalendarReference(request: KLeaguePortalExtractRequest, ref: KLeaguePortalMatchReference): number {
  const homeScore = scoreTeamAliasMatch(request.homeTeam, ref.homeTeamKo);
  const awayScore = scoreTeamAliasMatch(request.awayTeam, ref.awayTeamKo);
  if (homeScore === 0 || awayScore === 0) return 0;

  let score = (homeScore * 0.5) + (awayScore * 0.5);
  if (request.matchDate && ref.matchDate.replace(/\//g, '-') === request.matchDate) {
    score += 0.2;
  }
  if (
    request.score?.home != null &&
    request.score?.away != null &&
    ref.score.home != null &&
    ref.score.away != null &&
    request.score.home === ref.score.home &&
    request.score.away === ref.score.away
  ) {
    score += 0.08;
  }

  const normalizedLeague = normalizeLeagueText(request.league || '');
  const normalizedMeetName = normalizeLeagueText(ref.meetName);
  if (normalizedLeague && normalizedMeetName.includes(normalizedLeague.replace(/\s+/g, ''))) {
    score += 0.05;
  }

  if (ref.endFlag === '1') score += 0.02;
  return score;
}

function resolveBestReference(request: KLeaguePortalExtractRequest, entries: KLeaguePortalMatchReference[]): KLeaguePortalMatchReference | null {
  let best: KLeaguePortalMatchReference | null = null;
  let bestScore = 0;
  for (const entry of entries) {
    const score = scoreCalendarReference(request, entry);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= 1.1 ? best : null;
}

function extractAssignedJson(html: string, varName: string): string | null {
  const marker = `var ${varName} = `;
  const start = html.indexOf(marker);
  if (start < 0) return null;

  const valueStart = html.indexOf('[', start + marker.length);
  if (valueStart < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = valueStart; i < html.length; i++) {
    const ch = html[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        return html.slice(valueStart, i + 1);
      }
    }
  }
  return null;
}

function parseTimelineMinute(value: string, fallback: number | null): number | null {
  const cleaned = cleanText(value);
  const match = cleaned.match(/^(\d+)(?:\+(\d+))?$/);
  if (match) {
    const base = Number(match[1]);
    const extra = match[2] ? Number(match[2]) : 0;
    return base + extra;
  }
  return fallback;
}

function cleanPlayerName(value: string): string {
  return cleanText(value).replace(/^\d+\s+/, '').trim();
}

function emptyStats(): KLeaguePortalStatsCompact {
  const pair = (): KLeagueTwoSideStat => ({ home: null, away: null });
  return {
    possession: pair(),
    shots: pair(),
    shots_on_target: pair(),
    corners: pair(),
    fouls: pair(),
    yellow_cards: pair(),
    red_cards: pair(),
  };
}

function parsePopupStats(jsonResultData: unknown): {
  stats: KLeaguePortalStatsCompact;
  events: KLeaguePortalEventCompact[];
  minute: number | null;
  competition: string;
  score: { home: number | null; away: number | null };
  homeTeamCode: string;
  awayTeamCode: string;
} {
  const root = Array.isArray(jsonResultData) ? jsonResultData : [];
  const overall = Array.isArray(root[2]) && root[2]?.[0] && typeof root[2][0] === 'object'
    ? root[2][0] as Record<string, unknown>
    : {};
  const gameInfo = Array.isArray(root[3]) && root[3]?.[0] && typeof root[3][0] === 'object'
    ? root[3][0] as Record<string, unknown>
    : {};
  const homeSummary = Array.isArray(root[5]) && root[5]?.[0] && typeof root[5][0] === 'object'
    ? root[5][0] as Record<string, unknown>
    : {};
  const awaySummary = Array.isArray(root[6]) && root[6]?.[0] && typeof root[6][0] === 'object'
    ? root[6][0] as Record<string, unknown>
    : {};
  const timeline = Array.isArray(root[8]) ? root[8] as Array<Record<string, unknown>> : [];
  const teamInfo = Array.isArray(root[9]) && root[9]?.[0] && typeof root[9][0] === 'object'
    ? root[9][0] as Record<string, unknown>
    : {};

  const stats: KLeaguePortalStatsCompact = {
    possession: {
      home: toNumber(homeSummary['Team_Share_Half']),
      away: toNumber(awaySummary['Team_Share_Half']),
    },
    shots: {
      home: toNumber(overall['H_ST_Qty']),
      away: toNumber(overall['A_ST_Qty']),
    },
    shots_on_target: {
      home: toNumber(overall['H_Valid_ST_Qty']),
      away: toNumber(overall['A_Valid_ST_Qty']),
    },
    corners: {
      home: toNumber(overall['H_CK_Qty']),
      away: toNumber(overall['A_CK_Qty']),
    },
    fouls: {
      home: toNumber(overall['H_FO_Qty']),
      away: toNumber(overall['A_FO_Qty']),
    },
    yellow_cards: {
      home: toNumber(overall['H_Warn_Qty']),
      away: toNumber(overall['A_Warn_Qty']),
    },
    red_cards: {
      home: toNumber(overall['H_Exit_Qty']),
      away: toNumber(overall['A_Exit_Qty']),
    },
  };

  const homeTeamCode = cleanText(teamInfo['Home_Team']);
  const awayTeamCode = cleanText(teamInfo['Away_Team']);
  const events: KLeaguePortalEventCompact[] = [];

  for (const item of timeline) {
    const action = cleanText(item['Action_Type']);
    if (!action) continue;
    const rawMinute = cleanText(item['displayTime'] || item['Display_Time']);
    const minute = parseTimelineMinute(rawMinute, toNumber(item['Min_Seq']));
    const teamId = cleanText(item['Team_Id']);
    const side: 'home' | 'away' | 'unknown' = teamId === homeTeamCode ? 'home' : teamId === awayTeamCode ? 'away' : 'unknown';
    const remark1 = cleanPlayerName(cleanText(item['Remark1']));
    const remark2 = cleanText(item['Remark2']);

    if (action === 'G') {
      events.push({
        minute,
        team: side,
        type: 'goal',
        detail: 'Goal',
        player: remark1,
      });
      continue;
    }

    if (action === 'Y') {
      events.push({
        minute,
        team: side,
        type: 'yellow_card',
        detail: 'Yellow Card',
        player: remark1,
      });
      continue;
    }

    if (action === 'R') {
      events.push({
        minute,
        team: side,
        type: 'red_card',
        detail: 'Red Card',
        player: remark1,
      });
      continue;
    }

    if (action === 'C') {
      events.push({
        minute,
        team: side,
        type: 'subst',
        detail: remark2 ? `${remark1} ${remark2}`.trim() : 'Substitution',
        player: remark1,
      });
      continue;
    }
  }

  return {
    stats,
    events,
    minute: toNumber(gameInfo['RunMin']),
    competition: cleanText(gameInfo['Meet_Name']),
    score: {
      home: toNumber(overall['H_Goal_Qty']),
      away: toNumber(overall['A_Goal_Qty']),
    },
    homeTeamCode,
    awayTeamCode,
  };
}

async function fetchPopupHtml(reference: KLeaguePortalMatchReference): Promise<string> {
  const cacheKey = `${reference.meetYear}-${reference.meetSeq}-${reference.gameId}`;
  const cached = cacheGet(popupCache, cacheKey);
  if (cached) return cached;

  const cookie = await getGuestSessionCookie();
  const response = await fetchWithCookie(buildPopupUrlByLeagueId(reference.leagueId), {
    method: 'POST',
    cookie,
    body: new URLSearchParams({
      workingTag: 'L',
      iptMeetYear: reference.meetYear,
      iptMeetSeq: reference.meetSeq,
      iptGameid: reference.gameId,
      iptMeetName: reference.meetName,
      singleIdx: reference.gameId,
    }),
  });

  if (!response.ok) {
    throw new Error(`KLEAGUE_PORTAL_POPUP_${response.status}`);
  }

  const html = await response.text();
  cacheSet(popupCache, cacheKey, html, POPUP_TTL_MS);
  return html;
}

export async function fetchKLeaguePortalMatchData(
  request: KLeaguePortalExtractRequest,
): Promise<KLeaguePortalExtractedMatchData | null> {
  if (!supportsKLeaguePortal(request.league)) return null;
  if (!request.matchDate || !/^\d{4}-\d{2}-\d{2}$/.test(request.matchDate)) return null;

  const [year, month] = request.matchDate.split('-');
  const calendarHtml = await fetchCalendarHtml(year!, String(Number(month)));
  const references = parseCalendarEntries(calendarHtml);
  const reference = resolveBestReference(request, references);
  if (!reference) {
    return null;
  }

  const popupHtml = await fetchPopupHtml(reference);
  const jsonResultRaw = extractAssignedJson(popupHtml, 'jsonResultData');
  if (!jsonResultRaw) {
    throw new Error('KLEAGUE_PORTAL_JSON_RESULT_MISSING');
  }

  const jsonResultData = JSON.parse(jsonResultRaw);
  const parsed = parsePopupStats(jsonResultData);
  const stats = parsed.stats ?? emptyStats();
  const minute = request.minute ?? parsed.minute ?? null;
  const status = cleanText(request.status || '') || (minute != null && minute >= 90 ? 'FT' : '2H');

  return {
    reference,
    urls: {
      calendar: KLEAGUE_CALENDAR_URL,
      popup: buildPopupUrlByLeagueId(reference.leagueId),
    },
    match: {
      homeTeam: request.homeTeam,
      awayTeam: request.awayTeam,
      competition: parsed.competition || reference.meetName,
      status,
      minute,
      score: {
        home: parsed.score.home ?? request.score?.home ?? reference.score.home,
        away: parsed.score.away ?? request.score?.away ?? reference.score.away,
      },
    },
    stats,
    events: parsed.events,
    raw: {
      calendarHtml,
      popupHtml,
      jsonResultData,
    },
  };
}
