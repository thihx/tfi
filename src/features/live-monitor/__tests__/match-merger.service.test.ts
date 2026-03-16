// ============================================================
// Match Merger Service Tests
// ============================================================

import { describe, test, expect } from 'vitest';
import { mergeMatchData, mergeOddsToMatch } from '../services/match-merger.service';
import { createFootballApiFixture, createMergedMatchData, createOddsResponse, createConfig } from './fixtures';

describe('mergeMatchData', () => {
  const config = createConfig();

  function makePrepared(overrides?: Record<string, unknown>) {
    return {
      config,
      match_id: '12345',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      league: 'Premier League',
      mode: 'B',
      custom_conditions: '',
      priority: 3,
      prediction: '',
      force_analyze: false,
      is_manual_push: false,
      recommended_custom_condition: '',
      recommended_condition_reason: '',
      recommended_condition_reason_vi: '',
      ...overrides,
    };
  }

  test('merges fixture data into prepared match', () => {
    const prepared = [makePrepared()];
    const fixtures = [createFootballApiFixture()];
    const result = mergeMatchData(prepared, fixtures);

    expect(result).toHaveLength(1);
    expect(result[0]!.match_id).toBe('12345');
    expect(result[0]!.match.status).toBe('2H');
    expect(result[0]!.match.minute).toBe(65);
    expect(result[0]!.match.score).toBe('1-0');
    expect(result[0]!.home_team).toBe('Arsenal');
    expect(result[0]!.away_team).toBe('Chelsea');
    expect(result[0]!.league).toBe('Premier League');
  });

  test('maps stats from fixture statistics', () => {
    const prepared = [makePrepared()];
    const fixtures = [createFootballApiFixture()];
    const result = mergeMatchData(prepared, fixtures);

    expect(result[0]!.stats.possession).toBe('55%-45%');
    expect(result[0]!.stats.shots).toBe('8-5');
    expect(result[0]!.stats.corners).toBe('5-3');
    expect(result[0]!.stats_compact.possession?.home).toBe('55%');
    expect(result[0]!.stats_compact.possession?.away).toBe('45%');
  });

  test('maps events from fixture', () => {
    const prepared = [makePrepared()];
    const fixtures = [createFootballApiFixture()];
    const result = mergeMatchData(prepared, fixtures);

    expect(result[0]!.events_compact).toHaveLength(1);
    expect(result[0]!.events_compact[0]!.type).toBe('goal');
    expect(result[0]!.events_compact[0]!.player).toBe('Saka');
    expect(result[0]!.events_compact[0]!.minute).toBe(23);
  });

  test('calculates current_total_goals from fixture goals', () => {
    const prepared = [makePrepared()];
    const fixtures = [createFootballApiFixture({ goals: { home: 2, away: 1 } })];
    const result = mergeMatchData(prepared, fixtures);
    expect(result[0]!.current_total_goals).toBe(3);
  });

  test('skips matches without matching fixture', () => {
    const prepared = [makePrepared({ match_id: '99999' })];
    const fixtures = [createFootballApiFixture()]; // fixture id = 12345
    const result = mergeMatchData(prepared, fixtures);
    expect(result).toHaveLength(0);
  });

  test('handles empty fixtures array', () => {
    const prepared = [makePrepared()];
    const result = mergeMatchData(prepared, []);
    expect(result).toHaveLength(0);
  });

  test('handles empty statistics in fixture', () => {
    const prepared = [makePrepared()];
    const fixtures = [createFootballApiFixture({ statistics: [] })];
    const result = mergeMatchData(prepared, fixtures);

    expect(result[0]!.stats.possession).toBe('-');
    expect(result[0]!.stats_compact.possession?.home).toBe(null);
  });

  test('handles FT status with default minute 90', () => {
    const prepared = [makePrepared()];
    const fx = createFootballApiFixture();
    fx.fixture.status = { long: 'Match Finished', short: 'FT', elapsed: null };
    const result = mergeMatchData(prepared, [fx]);
    expect(result[0]!.minute).toBe(90);
    expect(result[0]!.status).toBe('FT');
  });

  test('preserves original prepared fields (mode, custom_conditions, force_analyze)', () => {
    const prepared = [makePrepared({
      mode: 'S',
      custom_conditions: 'btts check',
      force_analyze: true,
      priority: 1,
    })];
    const fixtures = [createFootballApiFixture()];
    const result = mergeMatchData(prepared, fixtures);

    expect(result[0]!.mode).toBe('S');
    expect(result[0]!.custom_conditions).toBe('btts check');
    expect(result[0]!.force_analyze).toBe(true);
  });

  test('merges multiple matches correctly', () => {
    const prepared = [
      makePrepared({ match_id: '12345' }),
      makePrepared({ match_id: '67890', home_team: 'Man City', away_team: 'Liverpool' }),
    ];
    const fixture2 = createFootballApiFixture();
    fixture2.fixture.id = 67890;
    fixture2.teams.home.name = 'Man City';
    fixture2.teams.away.name = 'Liverpool';

    const fixtures = [createFootballApiFixture(), fixture2];
    const result = mergeMatchData(prepared, fixtures);

    expect(result).toHaveLength(2);
    expect(result[0]!.match_id).toBe('12345');
    expect(result[1]!.match_id).toBe('67890');
  });
});

describe('mergeOddsToMatch', () => {
  test('merges odds from bookmaker response', () => {
    const matchData = createMergedMatchData({ odds_available: false });
    const oddsResponse = createOddsResponse();
    const result = mergeOddsToMatch(matchData, oddsResponse);

    expect(result.odds_available).toBe(true);
    expect(result.odds_canonical).toBeDefined();
    expect(result.odds_canonical['1x2']).toBeDefined();
  });

  test('sets 1x2 odds from Match Winner market', () => {
    const matchData = createMergedMatchData();
    const oddsResponse = createOddsResponse();
    const result = mergeOddsToMatch(matchData, oddsResponse);

    const m1x2 = result.odds_canonical['1x2'];
    expect(m1x2?.home).toBe(2.1);
    expect(m1x2?.draw).toBe(3.4);
    expect(m1x2?.away).toBe(3.8);
  });

  test('sets OU odds from Over/Under 2.5 market', () => {
    const matchData = createMergedMatchData();
    const oddsResponse = createOddsResponse();
    const result = mergeOddsToMatch(matchData, oddsResponse);

    const ou = result.odds_canonical.ou;
    expect(ou?.over).toBe(1.85);
    expect(ou?.under).toBe(2.0);
  });

  test('sets BTTS odds from Both Teams Score market', () => {
    const matchData = createMergedMatchData();
    const oddsResponse = createOddsResponse();
    const result = mergeOddsToMatch(matchData, oddsResponse);

    const btts = result.odds_canonical.btts;
    expect(btts?.yes).toBe(1.75);
    expect(btts?.no).toBe(2.1);
  });

  test('handles empty odds response', () => {
    const matchData = createMergedMatchData();
    const oddsResponse = createOddsResponse({ response: [] });
    const result = mergeOddsToMatch(matchData, oddsResponse);

    expect(result.odds_available).toBe(false);
    expect(result.odds_canonical).toEqual({});
  });

  test('handles response with empty bookmakers', () => {
    const matchData = createMergedMatchData();
    const oddsResponse = createOddsResponse({
      response: [{ fixture: { id: 12345 }, update: '', league: { id: 39, name: 'PL', country: 'EN', logo: '', flag: '', season: 2025 }, bookmakers: [] }],
    });
    const result = mergeOddsToMatch(matchData, oddsResponse);
    expect(result.odds_available).toBe(false);
  });

  test('preserves original match data fields', () => {
    const matchData = createMergedMatchData({ match_id: '12345', home_team: 'Arsenal' });
    const oddsResponse = createOddsResponse();
    const result = mergeOddsToMatch(matchData, oddsResponse);

    expect(result.match_id).toBe('12345');
    expect(result.home_team).toBe('Arsenal');
    expect(result.stats_compact).toBeDefined();
  });
});
