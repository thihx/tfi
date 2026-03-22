import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    liveScoreApiKey: 'live-score-key',
    liveScoreApiSecret: 'live-score-secret',
    liveScoreApiBaseUrl: 'https://livescore-api.example.com/api-client',
  },
}));

const {
  clearLiveScoreCaches,
  findMatchingLiveScoreMatch,
  fetchLiveScoreBenchmarkTrace,
} = await import('../lib/live-score-api.js');

const fixture = {
  fixture: {
    id: 123,
    status: { short: '2H', elapsed: 67 },
    timestamp: 1700000000,
  },
  league: {
    id: 1,
    name: 'Premier League',
    country: 'Kazakhstan',
    logo: '',
    flag: null,
    season: 2026,
    round: 'Round 1',
  },
  teams: {
    home: { id: 10, name: 'FC Astana', logo: 'home.png', winner: null },
    away: { id: 20, name: 'Tobol Kostanay', logo: 'away.png', winner: null },
  },
  goals: { home: 1, away: 0 },
  score: {},
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  clearLiveScoreCaches();
});

describe('live-score-api matching', () => {
  test('findMatchingLiveScoreMatch picks the closest team+league match', () => {
    const match = findMatchingLiveScoreMatch(fixture, [
      {
        id: 1,
        fixture_id: 111,
        status: 'IN PLAY',
        time: '67',
        scheduled: '14:00',
        competition: { id: 9, name: 'Cup Final' },
        home: { id: 99, name: 'FC Astana' },
        away: { id: 98, name: 'Tobol Kostanay' },
        scores: { score: '0 - 0' },
      },
      {
        id: 2,
        fixture_id: 222,
        status: 'IN PLAY',
        time: '67',
        scheduled: '14:00',
        competition: { id: 10, name: 'Premier League' },
        home: { id: 10, name: 'FC Astana' },
        away: { id: 20, name: 'Tobol Kostanay' },
        scores: { score: '1 - 0' },
      },
    ]);

    expect(match?.id).toBe(2);
  });

  test('matches Asian league teams when provider uses a legacy alias and kickoff aligns', () => {
    const asianFixture = {
      fixture: {
        id: 1506922,
        status: { short: '2H', elapsed: 68 },
        timestamp: 1774155600,
      },
      league: {
        id: 292,
        name: 'K League 1',
        country: 'South-Korea',
        logo: '',
        flag: null,
        season: 2026,
        round: 'Regular Season - 5',
      },
      teams: {
        home: { id: 2767, name: 'Ulsan Hyundai FC', logo: '', winner: null },
        away: { id: 2768, name: 'Gimcheon Sangmu FC', logo: '', winner: null },
      },
      goals: { home: 0, away: 0 },
      score: {},
    } as const;

    const match = findMatchingLiveScoreMatch(asianFixture, [
      {
        id: 696764,
        fixture_id: 1840708,
        status: 'IN PLAY',
        time: '64',
        scheduled: '05:00',
        competition: { id: 66, name: 'K-League 1' },
        country: { id: 70, name: 'Republic of Korea' },
        home: { id: 2311, name: 'FC Seoul' },
        away: { id: 478, name: 'Gwangju FC' },
        scores: { score: '3 - 0' },
      },
      {
        id: 696765,
        fixture_id: 1840709,
        status: 'IN PLAY',
        time: '67',
        scheduled: '05:01',
        competition: { id: 66, name: 'K-League 1' },
        country: { id: 70, name: 'Republic of Korea' },
        home: { id: 1335, name: 'Ulsan Hyundai' },
        away: { id: 484, name: 'Sangju Sangmu' },
        scores: { score: '0 - 0' },
      },
    ]);

    expect(match?.id).toBe(696765);
  });
});

describe('live-score-api benchmark trace', () => {
  test('normalizes stats and events into comparable compact coverage', async () => {
    const trace = await fetchLiveScoreBenchmarkTrace(fixture, {
      fetchLiveMatches: async () => ([
        {
          id: 695741,
          fixture_id: 1840649,
          status: 'IN PLAY',
          time: 'HT',
          scheduled: '14:00',
          competition: { id: 183, name: 'Premier League' },
          home: { id: 148, name: 'FC Astana' },
          away: { id: 2159, name: 'Tobol Kostanay' },
          scores: { score: '1 - 0' },
          urls: {
            statistics: 'https://example.com/stats',
            events: 'https://example.com/events',
          },
        },
      ]),
      fetchMatchStats: async () => ({
        possesion: '54:46',
        corners: '4:1',
        shots_on_target: '3:1',
        attempts_on_goal: '8:5',
        yellow_cards: '2:0',
        red_cards: '0:0',
        fauls: '6:7',
      }),
      fetchMatchEvents: async () => ([
        {
          id: '1',
          match_id: '695741',
          player: 'I. Basic',
          time: '24',
          event: 'GOAL',
          sort: '0',
          home_away: 'h',
          info: 'S. Basmanov',
        },
        {
          id: '2',
          match_id: '695741',
          player: 'D. Karaman',
          time: '31',
          event: 'YELLOW_CARD',
          sort: '1',
          home_away: 'h',
          info: null,
        },
      ]),
    });

    expect(trace.matched).toBe(true);
    expect(trace.providerMatchId).toBe('695741');
    expect(trace.statsCompact.possession).toEqual({ home: '54', away: '46' });
    expect(trace.statsCompact.shots).toEqual({ home: '8', away: '5' });
    expect(trace.statsCompact.shots_on_target).toEqual({ home: '3', away: '1' });
    expect(trace.statsCompact.corners).toEqual({ home: '4', away: '1' });
    expect(trace.coverageFlags).toMatchObject({
      matched: true,
      has_possession: true,
      has_shots: true,
      has_shots_on_target: true,
      has_corners: true,
      event_count: 2,
    });
    expect(trace.normalizedStats).toHaveLength(2);
    expect(trace.normalizedEvents).toHaveLength(2);
    expect(trace.error).toBeNull();
  });

  test('returns a no-match trace when the provider has no live candidate', async () => {
    const trace = await fetchLiveScoreBenchmarkTrace(fixture, {
      fetchLiveMatches: async () => ([]),
    });

    expect(trace.matched).toBe(false);
    expect(trace.error).toBe('NO_LIVE_SCORE_MATCH');
    expect(trace.coverageFlags).toMatchObject({
      matched: false,
      candidate_count: 0,
    });
  });
});
