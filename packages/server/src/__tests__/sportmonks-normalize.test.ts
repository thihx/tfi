import { describe, expect, it } from 'vitest';
import {
  getSportmonksCurrentScore,
  normalizeSportmonksFixture,
  sportmonksEventsToApiFixtureEvents,
  sportmonksStatisticsToApiFixtureStats,
  summarizeSportmonksCoverage,
} from '../lib/sportmonks-normalize.js';

describe('sportmonks-normalize', () => {
  it('normalizes fixture includes and summarizes coverage', () => {
    const fixture = normalizeSportmonksFixture({
      id: 19146701,
      name: 'Celtic vs Kilmarnock',
      league_id: 501,
      season_id: 23690,
      state_id: 3,
      starting_at: '2024-08-04 15:30:00',
      starting_at_timestamp: 1722785400,
      result_info: '1-0',
      length: 90,
      has_odds: true,
      has_premium_odds: false,
      participants: { data: [{ id: 1 }, { id: 2 }] },
      scores: [{ id: 10 }],
      events: { data: [{ id: 20 }] },
      statistics: { data: [{ id: 30 }] },
      periods: [{ id: 40 }],
      inplayOdds: { data: [{ id: 50 }] },
      league: { id: 501 },
      state: { id: 3 },
    });

    expect(fixture).toMatchObject({
      provider: 'sportmonks',
      providerFixtureId: '19146701',
      name: 'Celtic vs Kilmarnock',
      leagueId: '501',
      seasonId: '23690',
      stateId: '3',
      startingAtTimestamp: 1722785400,
      hasOdds: true,
      hasPremiumOdds: false,
      rawIncludes: { league: true, state: true },
    });
    expect(fixture.participants).toHaveLength(2);
    expect(fixture.statistics).toHaveLength(1);

    expect(summarizeSportmonksCoverage(fixture)).toEqual({
      has_fixture: true,
      has_participants: true,
      has_scores: true,
      has_events: true,
      has_statistics: true,
      has_periods: true,
      has_inplay_odds: true,
      provider_has_odds_flag: true,
      provider_has_premium_odds_flag: false,
      participant_count: 2,
      score_count: 1,
      event_count: 1,
      statistic_count: 1,
      period_count: 1,
      inplay_odds_count: 1,
    });
  });

  it('treats missing includes as empty coverage, not internal failure', () => {
    const fixture = normalizeSportmonksFixture({
      id: 'abc',
      has_odds: false,
    });

    expect(summarizeSportmonksCoverage(fixture)).toMatchObject({
      has_fixture: true,
      has_participants: false,
      has_scores: false,
      has_events: false,
      has_statistics: false,
      has_inplay_odds: false,
      provider_has_odds_flag: false,
    });
  });

  it('normalizes string booleans, invalid numerics, odds aliases, and null coverage safely', () => {
    const fixture = normalizeSportmonksFixture({
      id: 0,
      name: '  ',
      league_id: null,
      starting_at_timestamp: 'not-a-number',
      length: '',
      has_odds: 'true' as unknown as boolean,
      has_premium_odds: 'unknown' as unknown as boolean,
      odds: { data: [{ id: 1 }] },
      participants: { data: 'bad-shape' },
      scores: null,
      league: null,
      state: undefined,
    });

    expect(fixture).toMatchObject({
      providerFixtureId: '0',
      name: '',
      leagueId: null,
      startingAtTimestamp: null,
      lengthMinutes: null,
      hasOdds: true,
      hasPremiumOdds: null,
      participants: [],
      scores: [],
      inplayOdds: [{ id: 1 }],
      rawIncludes: { league: false, state: false },
    });
    expect(summarizeSportmonksCoverage(null)).toMatchObject({
      has_fixture: false,
      participant_count: 0,
      inplay_odds_count: 0,
    });
  });

  it('converts Sportmonks statistics and events into API-Football compatible shapes', () => {
    const fixture = normalizeSportmonksFixture({
      id: 1,
      participants: [
        { id: 10, name: 'Home FC', image_path: 'home.png', meta: { location: 'home' } },
        { id: 20, name: 'Away FC', image_path: 'away.png', meta: { location: 'away' } },
      ],
      scores: [
        { description: 'CURRENT', score: { participant: 'home', goals: 2 } },
        { description: 'CURRENT', score: { participant: 'away', goals: 1 } },
      ],
      statistics: [
        { participant_id: 10, type: { name: 'Ball Possession' }, data: { value: '62%' } },
        { participant_id: 20, type: { name: 'Ball Possession' }, data: { value: '38%' } },
        { participant_id: 10, type: { name: 'Shots on target' }, data: { value: 5 } },
        { participant_id: 20, type: { name: 'Shots on target' }, data: { value: 2 } },
      ],
      events: [
        {
          participant_id: 10,
          type_id: 14,
          minute: 12,
          extra_minute: null,
          player_id: 100,
          player_name: 'Scorer',
          related_player_id: 101,
          related_player_name: 'Assist',
          addition: '1st Goal',
        },
        {
          participant_id: 20,
          type_id: 18,
          minute: 60,
          player_name: 'Off',
          related_player_name: 'On',
        },
      ],
    });

    expect(getSportmonksCurrentScore(fixture)).toEqual({ home: 2, away: 1 });

    const stats = sportmonksStatisticsToApiFixtureStats(fixture);
    expect(stats).toHaveLength(2);
    expect(stats[0]).toMatchObject({
      team: { id: 10, name: 'Home FC', logo: 'home.png' },
      statistics: [
        { type: 'Ball Possession', value: '62%' },
        { type: 'Shots on Goal', value: 5 },
      ],
    });

    const events = sportmonksEventsToApiFixtureEvents(fixture);
    expect(events).toEqual([
      expect.objectContaining({
        time: { elapsed: 12, extra: null },
        team: { id: 10, name: 'Home FC', logo: 'home.png' },
        type: 'Goal',
        detail: '1st Goal',
        player: { id: 100, name: 'Scorer' },
        assist: { id: 101, name: 'Assist' },
      }),
      expect.objectContaining({
        time: { elapsed: 60, extra: null },
        team: { id: 20, name: 'Away FC', logo: 'away.png' },
        type: 'subst',
        detail: 'Substitution',
        player: { id: null, name: 'Off' },
        assist: { id: null, name: 'On' },
      }),
    ]);
  });

  it('keeps partially-known stats/events without dropping provider evidence', () => {
    const fixture = normalizeSportmonksFixture({
      id: 2,
      participants: [
        { id: '10', name: 'Home FC', image_path: null, meta: { location: 'home' } },
        { id: '20', name: 'Away FC', meta: { location: 'away' } },
        { id: '30', name: 'Neutral FC', meta: { location: 'neutral' } },
      ],
      scores: [
        { description: 'HT', score: { participant: 'home', goals: 1 } },
        { description: 'CURRENT', score: { participant: 'home', goals: '2%' } },
        { description: 'CURRENT', score: { participant: 'away', goals: 'bad' } },
        'bad-score-row',
      ],
      statistics: [
        'bad-stat-row',
        { participant_id: 10, type: { code: 'xG' }, value: '1.24' },
        { participant_id: 20, name: 'Pass accuracy', data: { value: '' } },
        { participant_id: 999, type: { name: 'Corners' }, data: { value: 9 } },
        { participant_id: 10, type: null, data: { value: 1 } },
      ],
      events: [
        'bad-event-row',
        { participant_id: 10, type_id: 19, minute: 45, extra_minute: '2', addition: 'Yellow Card', info: 'Booked' },
        { participant_id: 20, type: { name: 'VAR' }, minute: null, info: 'Goal cancelled' },
        { participant_id: 999, type_id: 77, minute: 88 },
      ],
    });

    expect(getSportmonksCurrentScore(fixture)).toEqual({ home: 2, away: null });

    const stats = sportmonksStatisticsToApiFixtureStats(fixture);
    expect(stats[0]?.statistics).toContainEqual({ type: 'expected_goals', value: '1.24' });
    expect(stats[1]?.statistics).toContainEqual({ type: 'Passes %', value: null });

    const events = sportmonksEventsToApiFixtureEvents(fixture);
    expect(events).toEqual([
      expect.objectContaining({
        time: { elapsed: 45, extra: 2 },
        team: { id: 10, name: 'Home FC', logo: '' },
        type: 'Card',
        detail: 'Yellow Card',
        comments: 'Booked',
      }),
      expect.objectContaining({
        time: { elapsed: 0, extra: null },
        team: { id: 20, name: 'Away FC', logo: '' },
        type: 'VAR',
        detail: 'Goal cancelled',
      }),
      expect.objectContaining({
        team: { id: 999, name: '', logo: '' },
        type: '77',
        detail: '',
      }),
    ]);
  });
});
