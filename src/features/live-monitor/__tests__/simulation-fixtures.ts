// ============================================================
// Extended Simulation Fixtures for Comprehensive Pipeline Tests
// Provides realistic Football API data for all edge cases.
// ============================================================

import type {
  FootballApiFixture,
  FootballApiOddsResponse,
  WatchlistMatch,
} from '../types';
import { createFootballApiFixture, createOddsResponse, createWatchlistMatch } from './fixtures';

// ==================== Football API Fixture Scenarios ====================

/** A1. Normal 2H live match — typical happy path */
export function fixtureNormal2H(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: 'Michael Oliver',
      timezone: 'UTC',
      date: '2026-03-19T18:00:00+00:00',
      timestamp: Date.now(),
      periods: { first: 0, second: 0 },
      venue: { id: 1, name: 'Emirates Stadium', city: 'London' },
      status: { long: 'Second Half', short: '2H', elapsed: 65 },
    },
    goals: { home: 1, away: 0 },
  });
}

/** A1. Normal 1H live match */
export function fixtureNormal1H(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: 'Anthony Taylor',
      timezone: 'UTC',
      date: '2026-03-19T18:00:00+00:00',
      timestamp: Date.now(),
      periods: { first: 0, second: 0 },
      venue: { id: 1, name: 'Emirates Stadium', city: 'London' },
      status: { long: 'First Half', short: '1H', elapsed: 25 },
    },
    goals: { home: 0, away: 0 },
  });
}

/** A2. Half-time status */
export function fixtureHalfTime(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Half Time', short: 'HT', elapsed: 45 },
    },
    goals: { home: 1, away: 1 },
  });
}

/** A2. Full-time status */
export function fixtureFullTime(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Match Finished', short: 'FT', elapsed: 90 },
    },
    goals: { home: 2, away: 1 },
  });
}

/** A2. Not Started status */
export function fixtureNotStarted(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Not Started', short: 'NS', elapsed: 0 },
    },
    goals: { home: 0, away: 0 },
  });
}

/** A2. Abandoned match */
export function fixtureAbandoned(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Match Abandoned', short: 'ABD', elapsed: 55 },
    },
    goals: { home: 0, away: 0 },
  });
}

/** A3. No stats at all (empty statistics array) */
export function fixtureNoStats(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Second Half', short: '2H', elapsed: 55 },
    },
    statistics: [],
    goals: { home: 0, away: 1 },
  });
}

/** A3. Partial stats (only possession) */
export function fixturePartialStats(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Second Half', short: '2H', elapsed: 60 },
    },
    statistics: [
      {
        team: { id: 42, name: 'Arsenal', logo: '' },
        statistics: [
          { type: 'Ball Possession', value: '55%' },
        ],
      },
      {
        team: { id: 49, name: 'Chelsea', logo: '' },
        statistics: [
          { type: 'Ball Possession', value: '45%' },
        ],
      },
    ],
    goals: { home: 1, away: 0 },
  });
}

/** A3. Very early game (minute 3) — too early for analysis */
export function fixtureEarlyGame(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'First Half', short: '1H', elapsed: 3 },
    },
    statistics: [],
    goals: { home: 0, away: 0 },
    events: [],
  });
}

/** A5. Match with red card in events */
export function fixtureWithRedCard(matchId = 12345): FootballApiFixture {
  const fx = createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: 'Mike Dean',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Second Half', short: '2H', elapsed: 70 },
    },
    goals: { home: 1, away: 1 },
  });
  fx.events = [
    {
      time: { elapsed: 23, extra: null },
      team: { id: 42, name: 'Arsenal', logo: '' },
      player: { id: 1, name: 'Saka' },
      assist: { id: 2, name: 'Odegaard' },
      type: 'Goal',
      detail: 'Normal Goal',
      comments: null,
    },
    {
      time: { elapsed: 55, extra: null },
      team: { id: 49, name: 'Chelsea', logo: '' },
      player: { id: 3, name: 'Palmer' },
      assist: { id: 4, name: 'Nkunku' },
      type: 'Goal',
      detail: 'Normal Goal',
      comments: null,
    },
    {
      time: { elapsed: 62, extra: null },
      team: { id: 49, name: 'Chelsea', logo: '' },
      player: { id: 5, name: 'Mudryk' },
      assist: { id: null, name: null },
      type: 'Card',
      detail: 'Red Card',
      comments: null,
    },
  ];
  return fx;
}

/** A5. Match with multiple goals — high-scoring game */
export function fixtureHighScoring(matchId = 12345): FootballApiFixture {
  const fx = createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Second Half', short: '2H', elapsed: 72 },
    },
    goals: { home: 3, away: 2 },
  });
  fx.events = [
    { time: { elapsed: 12, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 1, name: 'Saka' }, assist: { id: 0, name: '' }, type: 'Goal', detail: 'Normal Goal', comments: null },
    { time: { elapsed: 25, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 2, name: 'Palmer' }, assist: { id: 0, name: '' }, type: 'Goal', detail: 'Normal Goal', comments: null },
    { time: { elapsed: 38, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 3, name: 'Havertz' }, assist: { id: 0, name: '' }, type: 'Goal', detail: 'Normal Goal', comments: null },
    { time: { elapsed: 60, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 4, name: 'Jackson' }, assist: { id: 0, name: '' }, type: 'Goal', detail: 'Normal Goal', comments: null },
    { time: { elapsed: 68, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 5, name: 'Martinelli' }, assist: { id: 0, name: '' }, type: 'Goal', detail: 'Normal Goal', comments: null },
  ];
  return fx;
}

/** Late game fixture (minute 82) */
export function fixtureLateGame(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Second Half', short: '2H', elapsed: 82 },
    },
    goals: { home: 1, away: 0 },
  });
}

/** Very late game fixture (minute 88+) */
export function fixtureEndgame(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Second Half', short: '2H', elapsed: 89 },
    },
    goals: { home: 0, away: 0 },
  });
}

/** 2H minute 48 — below 2H threshold of 50 */
export function fixture2HEarly(matchId = 12345): FootballApiFixture {
  return createFootballApiFixture({
    fixture: {
      id: matchId,
      referee: '',
      timezone: 'UTC',
      date: '',
      timestamp: 0,
      periods: { first: 0, second: 0 },
      venue: { id: 0, name: '', city: '' },
      status: { long: 'Second Half', short: '2H', elapsed: 48 },
    },
    goals: { home: 1, away: 0 },
  });
}

// ==================== AI Response Templates ====================

/** AI says push with strong recommendation */
export function aiResponsePush(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    should_push: true,
    selection: 'Over 2.5 @1.85',
    bet_market: 'over_2.5',
    market_chosen_reason: 'High shot count, both teams attacking aggressively',
    confidence: 8,
    reasoning_en: 'Both teams pressing high with 13 total shots. Score 1-0 with clear attacking intent.',
    reasoning_vi: 'Cả hai đội pressing cao với 13 cú sút. Tỷ số 1-0 với ý đồ tấn công rõ ràng.',
    warnings: [],
    value_percent: 15,
    risk_level: 'MEDIUM',
    stake_percent: 4,
    custom_condition_matched: false,
    custom_condition_status: 'none',
    custom_condition_summary_en: 'No custom condition specified.',
    custom_condition_summary_vi: 'Không có điều kiện tùy chỉnh.',
    custom_condition_reason_en: 'N/A',
    custom_condition_reason_vi: 'N/A',
    condition_triggered_suggestion: '',
    condition_triggered_reasoning_en: 'Condition not triggered.',
    condition_triggered_reasoning_vi: 'Điều kiện không được kích hoạt.',
    condition_triggered_confidence: 0,
    condition_triggered_stake: 0,
    ...overrides,
  });
}

/** AI says no push — no clear value */
export function aiResponseNoPush(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    should_push: false,
    selection: '',
    bet_market: '',
    market_chosen_reason: 'No clear value detected in available markets',
    confidence: 3,
    reasoning_en: 'Match is balanced with no clear edge. Stats evenly distributed.',
    reasoning_vi: 'Trận đấu cân bằng, không có lợi thế rõ ràng.',
    warnings: [],
    value_percent: 0,
    risk_level: 'HIGH',
    stake_percent: 0,
    custom_condition_matched: false,
    custom_condition_status: 'none',
    custom_condition_summary_en: 'No custom condition specified.',
    custom_condition_summary_vi: 'Không có điều kiện tùy chỉnh.',
    custom_condition_reason_en: 'N/A',
    custom_condition_reason_vi: 'N/A',
    condition_triggered_suggestion: '',
    condition_triggered_reasoning_en: 'Condition not triggered.',
    condition_triggered_reasoning_vi: 'Điều kiện không được kích hoạt.',
    condition_triggered_confidence: 0,
    condition_triggered_stake: 0,
    ...overrides,
  });
}

/** AI response with "No Bet" selection */
export function aiResponseNoBet(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    should_push: false,
    selection: 'No Bet',
    bet_market: '',
    market_chosen_reason: 'Insufficient data for confident recommendation',
    confidence: 2,
    reasoning_en: 'Cannot recommend a bet with current data quality.',
    reasoning_vi: 'Không thể đề xuất cược với chất lượng dữ liệu hiện tại.',
    warnings: ['LOW_CONFIDENCE'],
    value_percent: 0,
    risk_level: 'HIGH',
    stake_percent: 0,
    custom_condition_matched: false,
    custom_condition_status: 'none',
    custom_condition_summary_en: '',
    custom_condition_summary_vi: '',
    custom_condition_reason_en: 'N/A',
    custom_condition_reason_vi: 'N/A',
    condition_triggered_suggestion: '',
    condition_triggered_reasoning_en: '',
    condition_triggered_reasoning_vi: '',
    condition_triggered_confidence: 0,
    condition_triggered_stake: 0,
    ...overrides,
  });
}

/** AI response with custom condition matched + condition-triggered suggestion */
export function aiResponseConditionTriggered(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    should_push: false,
    selection: '',
    bet_market: '',
    market_chosen_reason: 'No strong AI bet recommendation',
    confidence: 4,
    reasoning_en: 'No strong signal from AI analysis alone.',
    reasoning_vi: 'Không có tín hiệu mạnh từ phân tích AI.',
    warnings: [],
    value_percent: 0,
    risk_level: 'MEDIUM',
    stake_percent: 0,
    custom_condition_matched: true,
    custom_condition_status: 'evaluated',
    custom_condition_summary_en: 'Condition met: Minute >= 65 AND Total goals <= 1',
    custom_condition_summary_vi: 'Điều kiện đạt: Phút >= 65 VÀ Tổng bàn thắng <= 1',
    custom_condition_reason_en: 'Current minute 67 >= 65 and total goals 1 <= 1',
    custom_condition_reason_vi: 'Phút hiện tại 67 >= 65 và tổng bàn thắng 1 <= 1',
    condition_triggered_suggestion: 'Under 2.5 Goals @2.00',
    condition_triggered_reasoning_en: 'Low scoring game at minute 67, defense solid on both sides.',
    condition_triggered_reasoning_vi: 'Trận đấu ít bàn thắng ở phút 67, phòng ngự vững cả hai bên.',
    condition_triggered_confidence: 7,
    condition_triggered_stake: 3,
    ...overrides,
  });
}

/** AI response: condition matched but suggestion is "No bet" */
export function aiResponseConditionMatchedNoBet(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    should_push: false,
    selection: '',
    bet_market: '',
    market_chosen_reason: 'No clear opportunity despite condition being met',
    confidence: 3,
    reasoning_en: 'Condition is met but no betting value found.',
    reasoning_vi: 'Điều kiện đã đạt nhưng không tìm thấy giá trị cược.',
    warnings: [],
    value_percent: 0,
    risk_level: 'HIGH',
    stake_percent: 0,
    custom_condition_matched: true,
    custom_condition_status: 'evaluated',
    custom_condition_summary_en: 'Condition met: possession > 60%',
    custom_condition_summary_vi: 'Điều kiện đạt: kiểm soát bóng > 60%',
    custom_condition_reason_en: 'Home possession 62% > 60%',
    custom_condition_reason_vi: 'Đội nhà kiểm soát bóng 62% > 60%',
    condition_triggered_suggestion: 'No bet - insufficient value',
    condition_triggered_reasoning_en: 'Despite condition met, odds do not offer value.',
    condition_triggered_reasoning_vi: 'Mặc dù điều kiện đạt, tỷ lệ cược không đủ giá trị.',
    condition_triggered_confidence: 3,
    condition_triggered_stake: 0,
    ...overrides,
  });
}

/** AI response: both AI push AND condition triggered */
export function aiResponseBothPushAndCondition(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    should_push: true,
    selection: 'Over 2.5 @1.85',
    bet_market: 'over_2.5',
    market_chosen_reason: 'High shot count + condition aligned',
    confidence: 8,
    reasoning_en: 'Strong attacking stats with condition confirming trend.',
    reasoning_vi: 'Chỉ số tấn công mạnh, điều kiện xác nhận xu hướng.',
    warnings: [],
    value_percent: 18,
    risk_level: 'MEDIUM',
    stake_percent: 4,
    custom_condition_matched: true,
    custom_condition_status: 'evaluated',
    custom_condition_summary_en: 'Condition met: shots > 10',
    custom_condition_summary_vi: 'Điều kiện đạt: số cú sút > 10',
    custom_condition_reason_en: 'Total shots 13 > 10',
    custom_condition_reason_vi: 'Tổng số cú sút 13 > 10',
    condition_triggered_suggestion: 'Over 2.5 Goals @1.85',
    condition_triggered_reasoning_en: 'With 13 shots at minute 65, over 2.5 looks likely.',
    condition_triggered_reasoning_vi: 'Với 13 cú sút ở phút 65, Over 2.5 có khả năng cao.',
    condition_triggered_confidence: 7,
    condition_triggered_stake: 3,
    ...overrides,
  });
}

/** AI response wrapped in markdown code fence */
export function aiResponseMarkdownWrapped(): string {
  return '```json\n' + aiResponsePush() + '\n```';
}

/** AI response with confidence > 10 (needs normalization) */
export function aiResponseHighConfidence(): string {
  return aiResponsePush({ confidence: 75 });
}

/** AI response with low confidence (below MIN_CONFIDENCE) */
export function aiResponseLowConfidence(): string {
  return aiResponsePush({ confidence: 3, should_push: true });
}

// ==================== Odds Scenarios ====================

/** No odds returned */
export function oddsResponseEmpty(): FootballApiOddsResponse {
  return { response: [] };
}

/** Normal odds */
export function oddsResponseNormal(): FootballApiOddsResponse {
  return createOddsResponse();
}

// ==================== Watchlist Helpers ====================

/** Create a watchlist match with kickoff ~1 hour ago in Korea timezone */
export function watchlistMatchLive(matchId = '12345', overrides?: Partial<WatchlistMatch>): WatchlistMatch {
  const now = new Date(Date.now() - 60 * 60_000); // 1 hour ago
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
  return createWatchlistMatch({
    match_id: matchId,
    date: dateFmt.format(now),
    kickoff: timeFmt.format(now),
    ...overrides,
  });
}

/** Create a watchlist match with custom conditions */
export function watchlistMatchWithConditions(
  matchId = '12345',
  conditions = '(Minute >= 65) AND (Total goals <= 1)',
): WatchlistMatch {
  return watchlistMatchLive(matchId, { custom_conditions: conditions });
}
