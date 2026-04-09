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
      strategic_context: null as unknown,
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

// =============================================================
// Pre-match odds format tests (value="Over 2.5", handicap="")
// Based on real API data from match 1530918
// =============================================================

describe('mergeOddsToMatch — pre-match format', () => {
  /** Helper: build an odds response with pre-match format (line embedded in value) */
  function preMatchOddsResponse(bookmakers: Array<{
    name: string;
    bets: Array<{ name: string; values: Array<{ value: string; odd: string; handicap?: string }> }>;
  }>) {
    return {
      ...createOddsResponse({
        response: [{
          fixture: { id: 12345 },
          update: '',
          league: { id: 1, name: 'RPL', country: 'RU', logo: '', flag: '', season: 2025 },
          bookmakers: bookmakers.map((bk, i) => ({
            id: i + 1,
            name: bk.name,
            bets: bk.bets.map((b, j) => ({ id: j + 1, name: b.name, values: b.values })),
          })),
        }],
      }),
      odds_source: 'reference-prematch' as const,
    };
  }

  test('parses 1x2 from pre-match Match Winner (value="Home", no handicap)', () => {
    const odds = preMatchOddsResponse([{
      name: '10Bet',
      bets: [{
        name: 'Match Winner',
        values: [
          { value: 'Home', odd: '1.53' },
          { value: 'Draw', odd: '3.75' },
          { value: 'Away', odd: '5.80' },
        ],
      }],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    expect(result.odds_canonical['1x2']).toEqual({ home: 1.53, draw: 3.75, away: 5.8 });
  });

  test('parses Goals Over/Under from pre-match format (value="Over 2.5", handicap="")', () => {
    const odds = preMatchOddsResponse([{
      name: 'Bet365',
      bets: [{
        name: 'Goals Over/Under',
        values: [
          { value: 'Over 2.5', odd: '1.85', handicap: '' },
          { value: 'Under 2.5', odd: '1.95', handicap: '' },
          { value: 'Over 1.5', odd: '1.25', handicap: '' },
          { value: 'Under 1.5', odd: '3.75', handicap: '' },
          { value: 'Over 3.5', odd: '3.25', handicap: '' },
          { value: 'Under 3.5', odd: '1.33', handicap: '' },
        ],
      }],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    const ou = result.odds_canonical.ou;
    expect(ou).toBeDefined();
    // Should pick line 2.5 (most balanced: |1.85 - 1.95| = 0.10)
    expect(ou?.line).toBe(2.5);
    expect(ou?.over).toBe(1.85);
    expect(ou?.under).toBe(1.95);
  });

  test('parses Asian Handicap from pre-match format (value="Home -1", handicap="")', () => {
    const odds = preMatchOddsResponse([{
      name: 'Bet365',
      bets: [{
        name: 'Asian Handicap',
        values: [
          { value: 'Home -1', odd: '1.95', handicap: '' },
          { value: 'Away +1', odd: '1.85', handicap: '' },
          { value: 'Home -0.5', odd: '1.55', handicap: '' },
          { value: 'Away +0.5', odd: '2.38', handicap: '' },
          { value: 'Home -1.5', odd: '2.50', handicap: '' },
          { value: 'Away +1.5', odd: '1.50', handicap: '' },
          { value: 'Home +0', odd: '1.19', handicap: '' },
          { value: 'Away +0', odd: '4.50', handicap: '' },
        ],
      }],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    const ah = result.odds_canonical.ah;
    expect(ah).toBeDefined();
    // Should pick line -1 (most balanced: |1.95 - 1.85| = 0.10)
    expect(ah?.line).toBe(-1);
    expect(ah?.home).toBe(1.95);
    expect(ah?.away).toBe(1.85);
  });

  test('parses BTTS from pre-match format (value="Yes"/"No")', () => {
    const odds = preMatchOddsResponse([{
      name: 'Bet365',
      bets: [{
        name: 'Both Teams Score',
        values: [
          { value: 'Yes', odd: '1.91' },
          { value: 'No', odd: '1.80' },
        ],
      }],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    expect(result.odds_canonical.btts).toEqual({ yes: 1.91, no: 1.8 });
  });

  test('parses Corners Over Under from pre-match format (value="Over 9.5", handicap="")', () => {
    const odds = preMatchOddsResponse([{
      name: 'Bet365',
      bets: [{
        name: 'Corners Over Under',
        values: [
          { value: 'Over 9.5', odd: '1.73', handicap: '' },
          { value: 'Under 9.5', odd: '2.00', handicap: '' },
          { value: 'Over 10', odd: '2.00', handicap: '' },
          { value: 'Under 10', odd: '1.80', handicap: '' },
        ],
      }],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    const cou = result.odds_canonical.corners_ou;
    expect(cou).toBeDefined();
    // Should pick line 10 (most balanced: |2.00 - 1.80| = 0.20) over 9.5 (|1.73 - 2.00| = 0.27)
    expect(cou?.line).toBe(10);
    expect(cou?.over).toBe(2.0);
    expect(cou?.under).toBe(1.8);
  });

  test('multi-bookmaker: picks best odds across bookmakers', () => {
    const odds = preMatchOddsResponse([
      {
        name: '10Bet',
        bets: [{
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '1.53' },
            { value: 'Draw', odd: '3.75' },
            { value: 'Away', odd: '5.80' },
          ],
        }],
      },
      {
        name: 'Bet365',
        bets: [{
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '1.48' },
            { value: 'Draw', odd: '3.60' },
            { value: 'Away', odd: '5.75' },
          ],
        }],
      },
    ]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    // Should pick max across bookmakers
    expect(result.odds_canonical['1x2']?.home).toBe(1.53);
    expect(result.odds_canonical['1x2']?.draw).toBe(3.75);
    expect(result.odds_canonical['1x2']?.away).toBe(5.8);
  });

  test('handles full pre-match data with all markets from multiple bookmakers', () => {
    const odds = preMatchOddsResponse([
      {
        name: '10Bet',
        bets: [
          { name: 'Match Winner', values: [
            { value: 'Home', odd: '1.53' }, { value: 'Draw', odd: '3.75' }, { value: 'Away', odd: '5.80' },
          ]},
          { name: 'Asian Handicap', values: [
            { value: 'Home -1', odd: '1.95', handicap: '' }, { value: 'Away +1', odd: '1.80', handicap: '' },
          ]},
          { name: 'Goals Over/Under', values: [
            { value: 'Over 2.5', odd: '1.83', handicap: '' }, { value: 'Under 2.5', odd: '1.91', handicap: '' },
          ]},
          { name: 'Both Teams Score', values: [
            { value: 'Yes', odd: '1.83' }, { value: 'No', odd: '1.80' },
          ]},
          { name: 'Corners Over Under', values: [
            { value: 'Over 9.5', odd: '1.75', handicap: '' }, { value: 'Under 9.5', odd: '1.93', handicap: '' },
          ]},
        ],
      },
      {
        name: 'Bet365',
        bets: [
          { name: 'Match Winner', values: [
            { value: 'Home', odd: '1.48' }, { value: 'Draw', odd: '3.60' }, { value: 'Away', odd: '5.75' },
          ]},
          { name: 'Asian Handicap', values: [
            { value: 'Home -1', odd: '1.95', handicap: '' }, { value: 'Away +1', odd: '1.85', handicap: '' },
            { value: 'Home -0.5', odd: '1.55', handicap: '' }, { value: 'Away +0.5', odd: '2.38', handicap: '' },
            { value: 'Home -1.5', odd: '2.50', handicap: '' }, { value: 'Away +1.5', odd: '1.50', handicap: '' },
          ]},
          { name: 'Goals Over/Under', values: [
            { value: 'Over 0.5', odd: '1.05', handicap: '' }, { value: 'Under 0.5', odd: '11.00', handicap: '' },
            { value: 'Over 1.5', odd: '1.25', handicap: '' }, { value: 'Under 1.5', odd: '3.75', handicap: '' },
            { value: 'Over 2.5', odd: '1.85', handicap: '' }, { value: 'Under 2.5', odd: '1.95', handicap: '' },
            { value: 'Over 3.5', odd: '3.25', handicap: '' }, { value: 'Under 3.5', odd: '1.33', handicap: '' },
            { value: 'Over 4.5', odd: '6.00', handicap: '' }, { value: 'Under 4.5', odd: '1.12', handicap: '' },
          ]},
          { name: 'Both Teams Score', values: [
            { value: 'Yes', odd: '1.91' }, { value: 'No', odd: '1.80' },
          ]},
          { name: 'Corners Over Under', values: [
            { value: 'Over 9.5', odd: '1.73', handicap: '' }, { value: 'Under 9.5', odd: '2.00', handicap: '' },
          ]},
        ],
      },
    ]);

    const result = mergeOddsToMatch(createMergedMatchData(), odds);

    expect(result.odds_available).toBe(true);

    // 1x2 — best across bookmakers
    expect(result.odds_canonical['1x2']?.home).toBe(1.53);
    expect(result.odds_canonical['1x2']?.draw).toBe(3.75);
    expect(result.odds_canonical['1x2']?.away).toBe(5.8);

    // OU — should pick line 2.5 (most balanced), best odds across bookmakers
    expect(result.odds_canonical.ou?.line).toBe(2.5);
    expect(result.odds_canonical.ou?.over).toBe(1.85);
    expect(result.odds_canonical.ou?.under).toBe(1.95);

    // AH — should pick line -1 (most balanced: |1.95 - 1.85| = 0.10)
    expect(result.odds_canonical.ah?.line).toBe(-1);
    expect(result.odds_canonical.ah?.home).toBe(1.95);
    expect(result.odds_canonical.ah?.away).toBe(1.85);

    // BTTS — best across bookmakers
    expect(result.odds_canonical.btts?.yes).toBe(1.91);
    expect(result.odds_canonical.btts?.no).toBe(1.8);

    // Corners OU — line 9.5 (|1.75 - 2.00| = 0.25)
    expect(result.odds_canonical.corners_ou?.line).toBe(9.5);
    expect(result.odds_canonical.corners_ou?.over).toBe(1.75);
    expect(result.odds_canonical.corners_ou?.under).toBe(2.0);
  });

  test('AH pre-match: handles fractional lines like -1.25, -0.75', () => {
    const odds = preMatchOddsResponse([{
      name: 'Marathonbet',
      bets: [{
        name: 'Asian Handicap',
        values: [
          { value: 'Home -1.25', odd: '2.21', handicap: '' },
          { value: 'Away +1.25', odd: '1.55', handicap: '' },
          { value: 'Home -0.75', odd: '1.65', handicap: '' },
          { value: 'Away +0.75', odd: '2.04', handicap: '' },
        ],
      }],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    const ah = result.odds_canonical.ah;
    expect(ah).toBeDefined();
    // -0.75: |1.65 - 2.04| = 0.39, -1.25: |2.21 - 1.55| = 0.66
    expect(ah?.line).toBe(-0.75);
    expect(ah?.home).toBe(1.65);
    expect(ah?.away).toBe(2.04);
  });

  test('OU pre-match: handles quarter lines like 1.75, 2.25', () => {
    const odds = preMatchOddsResponse([{
      name: 'Marathonbet',
      bets: [{
        name: 'Goals Over/Under',
        values: [
          { value: 'Over 1.75', odd: '1.28', handicap: '' },
          { value: 'Under 1.75', odd: '3.10', handicap: '' },
          { value: 'Over 2.25', odd: '1.61', handicap: '' },
          { value: 'Under 2.25', odd: '2.14', handicap: '' },
          { value: 'Over 2.75', odd: '2.05', handicap: '' },
          { value: 'Under 2.75', odd: '1.66', handicap: '' },
        ],
      }],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    const ou = result.odds_canonical.ou;
    expect(ou).toBeDefined();
    // 2.75: |2.05 - 1.66| = 0.39, 2.25: |1.61 - 2.14| = 0.53, 1.75: |1.28 - 3.10| = 1.82
    expect(ou?.line).toBe(2.75);
    expect(ou?.over).toBe(2.05);
    expect(ou?.under).toBe(1.66);
  });

  test('AH pre-match: handles positive lines like +0.25, +0.5', () => {
    const odds = preMatchOddsResponse([{
      name: 'Bet365',
      bets: [{
        name: 'Asian Handicap',
        values: [
          { value: 'Home +0.25', odd: '1.38', handicap: '' },
          { value: 'Away -0.25', odd: '3.00', handicap: '' },
          { value: 'Home +0.5', odd: '1.13', handicap: '' },
          { value: 'Away -0.5', odd: '5.90', handicap: '' },
        ],
      }],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    const ah = result.odds_canonical.ah;
    expect(ah).toBeDefined();
    // +0.25: |1.38 - 3.00| = 1.62, +0.5: |1.13 - 5.90| = 4.77
    expect(ah?.line).toBe(0.25);
  });

  test('keeps FT 1x2 separate from first-half 1x2 in pre-match format', () => {
    const odds = preMatchOddsResponse([{
      name: 'Bet365',
      bets: [
        {
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '1.50' }, { value: 'Draw', odd: '3.50' }, { value: 'Away', odd: '5.00' },
          ],
        },
        {
          name: '1st Half Match Winner',
          values: [
            { value: 'Home', odd: '2.50' }, { value: 'Draw', odd: '2.00' }, { value: 'Away', odd: '5.00' },
          ],
        },
      ],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    expect(result.odds_canonical['1x2']?.home).toBe(1.5);
    expect(result.odds_canonical['ht_1x2']?.home).toBe(2.5);
  });

  test('existing live format still works (value="Over", handicap="2.5")', () => {
    // This is the original live format — ensure backward compatibility
    const odds = createOddsResponse();
    const result = mergeOddsToMatch(createMergedMatchData(), odds);

    expect(result.odds_canonical['1x2']?.home).toBe(2.1);
    expect(result.odds_canonical.ou?.line).toBe(2.5);
    expect(result.odds_canonical.ou?.over).toBe(1.85);
    expect(result.odds_canonical.btts?.yes).toBe(1.75);
  });

  test('Corners pre-match: multiple lines from Marathonbet', () => {
    const odds = preMatchOddsResponse([{
      name: 'Marathonbet',
      bets: [{
        name: 'Corners Over Under',
        values: [
          { value: 'Over 7.5', odd: '1.22', handicap: '' },
          { value: 'Under 7.5', odd: '3.50', handicap: '' },
          { value: 'Over 8.5', odd: '1.43', handicap: '' },
          { value: 'Under 8.5', odd: '2.50', handicap: '' },
          { value: 'Over 9.5', odd: '1.76', handicap: '' },
          { value: 'Under 9.5', odd: '1.93', handicap: '' },
          { value: 'Over 10.5', odd: '2.22', handicap: '' },
          { value: 'Under 10.5', odd: '1.54', handicap: '' },
          { value: 'Over 11.5', odd: '2.92', handicap: '' },
          { value: 'Under 11.5', odd: '1.31', handicap: '' },
        ],
      }],
    }]);
    const result = mergeOddsToMatch(createMergedMatchData(), odds);
    const cou = result.odds_canonical.corners_ou;
    expect(cou).toBeDefined();
    // 9.5: |1.76 - 1.93| = 0.17 ← most balanced
    // 10.5: |2.22 - 1.54| = 0.68
    expect(cou?.line).toBe(9.5);
    expect(cou?.over).toBe(1.76);
    expect(cou?.under).toBe(1.93);
  });

  test('pre-match odds do NOT trigger ODDS_SUSPICIOUS even at late game (min 83, score 4-0)', () => {
    // Real scenario: FC Krasnodar 4-0 CSKA Moscow at min 83
    // Pre-match odds look "wrong" vs live state but that's expected
    const matchData = createMergedMatchData({
      match: { id: '12345', home: 'FC Krasnodar', away: 'CSKA Moscow', league: 'RPL', minute: 83, score: '4-0', status: '2H' },
      minute: 83,
      score: '4-0',
    });
    const odds = preMatchOddsResponse([{
      name: '10Bet',
      bets: [
        { name: 'Match Winner', values: [
          { value: 'Home', odd: '1.53' }, { value: 'Draw', odd: '3.75' }, { value: 'Away', odd: '5.80' },
        ]},
        { name: 'Goals Over/Under', values: [
          { value: 'Over 2.5', odd: '1.83', handicap: '' }, { value: 'Under 2.5', odd: '1.91', handicap: '' },
        ]},
      ],
    }]);
    const result = mergeOddsToMatch(matchData, odds);
    // Should NOT be suspicious
    expect(result.odds_suspicious).toBe(false);
    expect(result.odds_source).toBe('reference-prematch');
    // Should have a PRE_MATCH_ODDS warning (informational, not suspicious)
    expect(result.odds_sanity_warnings).toHaveLength(1);
    expect(result.odds_sanity_warnings[0]).toContain('PRE_MATCH_ODDS');
    // Odds should still be available and parsed
    expect(result.odds_available).toBe(true);
    expect(result.odds_canonical['1x2']?.home).toBe(1.53);
    expect(result.odds_canonical.ou?.line).toBe(2.5);
  });

  test('live odds still trigger ODDS_SUSPICIOUS at late game with stale-looking odds', () => {
    // Same scenario but with live odds — should flag as suspicious
    const matchData = createMergedMatchData({
      match: { id: '12345', home: 'FC Krasnodar', away: 'CSKA Moscow', league: 'RPL', minute: 83, score: '4-0', status: '2H' },
      minute: 83,
      score: '4-0',
    });
    // Live odds with Home leading 4-0 but home odds > away odds = suspicious
    // Use valid margin (~105%) so 1X2 survives margin check and hits directional sanity check
    const odds = createOddsResponse({
      response: [{
        fixture: { id: 12345 },
        update: '',
        league: { id: 1, name: 'RPL', country: 'RU', logo: '', flag: '', season: 2025 },
        bookmakers: [{
          id: 1, name: 'Live',
          bets: [{ id: 1, name: 'Match Winner', values: [
            { value: 'Home', odd: '3.00' }, { value: 'Draw', odd: '3.20' }, { value: 'Away', odd: '2.10' },
          ]}],
        }],
      }],
    });
    const result = mergeOddsToMatch(matchData, odds);
    // Should be suspicious — home leading 4-0 but home odds higher than away
    expect(result.odds_suspicious).toBe(true);
    expect(result.odds_sanity_warnings.some(w => w.includes('SANITY_FAIL'))).toBe(true);
  });

  test('removes AH market with implied probability ~75% (margin too low)', () => {
    const matchData = createMergedMatchData({
      match: { id: '12345', home: 'Watford', away: 'Wrexham', league: 'EFL Championship', minute: 57, score: '2-1', status: '2H' },
    });
    const odds = createOddsResponse({
      response: [{
        fixture: { id: 12345 },
        update: '',
        league: { id: 1, name: 'EFL', country: 'EN', logo: '', flag: '', season: 2025 },
        bookmakers: [
          {
            id: 1, name: 'BM1',
            bets: [
              { id: 1, name: 'Match Winner', values: [
                { value: 'Home', odd: '1.90' }, { value: 'Draw', odd: '3.40' }, { value: 'Away', odd: '4.20' },
              ]},
              // AH with extremely wide margin (~67% implied probability)
              { id: 2, name: 'Asian Handicap', values: [
                { value: 'Home', odd: '3.50', handicap: '-1' }, { value: 'Away', odd: '3.00', handicap: '+1' },
              ]},
            ],
          },
        ],
      }],
    });
    const result = mergeOddsToMatch(matchData, odds);

    // 1X2 should survive (1/1.90 + 1/3.40 + 1/4.20 ≈ 1.058 = 105.8% — valid)
    expect(result.odds_canonical['1x2']).toBeDefined();
    // AH should be removed (1/3.50 + 1/3.00 ≈ 0.619 = 61.9% — way below 85%)
    expect(result.odds_canonical['ah']).toBeUndefined();
    // Not broadly suspicious (no SANITY_FAIL, only MARGIN_INVALID)
    expect(result.odds_suspicious).toBe(false);
    // Should have a MARGIN_INVALID warning
    expect(result.odds_sanity_warnings.some(w => w.includes('MARGIN_INVALID'))).toBe(true);
    // Odds still available because 1X2 remains
    expect(result.odds_available).toBe(true);
  });

  test('removes corners OU with implied probability ~75%', () => {
    const matchData = createMergedMatchData({
      match: { id: '12345', home: 'A', away: 'B', league: 'L', minute: 57, score: '2-1', status: '2H' },
    });
    const odds = createOddsResponse({
      response: [{
        fixture: { id: 12345 },
        update: '',
        league: { id: 1, name: 'L', country: 'EN', logo: '', flag: '', season: 2025 },
        bookmakers: [{
          id: 1, name: 'BM1',
          bets: [
            { id: 1, name: 'Match Winner', values: [
              { value: 'Home', odd: '1.80' }, { value: 'Draw', odd: '3.50' }, { value: 'Away', odd: '4.50' },
            ]},
            // Corners OU with terrible margin
            { id: 2, name: 'Total Corners', values: [
              { value: 'Over', odd: '3.20', handicap: '9.5' }, { value: 'Under', odd: '2.80', handicap: '9.5' },
            ]},
          ],
        }],
      }],
    });
    const result = mergeOddsToMatch(matchData, odds);

    // 1X2 valid
    expect(result.odds_canonical['1x2']).toBeDefined();
    // Corners removed (1/3.20 + 1/2.80 ≈ 0.669 = 66.9%)
    expect(result.odds_canonical['corners_ou']).toBeUndefined();
    expect(result.odds_suspicious).toBe(false);
  });

  test('keeps markets with normal margin (100-110%)', () => {
    const matchData = createMergedMatchData({
      match: { id: '12345', home: 'A', away: 'B', league: 'L', minute: 45, score: '1-1', status: '2H' },
    });
    const odds = createOddsResponse({
      response: [{
        fixture: { id: 12345 },
        update: '',
        league: { id: 1, name: 'L', country: 'EN', logo: '', flag: '', season: 2025 },
        bookmakers: [{
          id: 1, name: 'BM1',
          bets: [
            { id: 1, name: 'Match Winner', values: [
              { value: 'Home', odd: '2.50' }, { value: 'Draw', odd: '3.00' }, { value: 'Away', odd: '3.10' },
            ]},
            { id: 2, name: 'Goals Over/Under', values: [
              { value: 'Over', odd: '1.85', handicap: '2.5' }, { value: 'Under', odd: '1.95', handicap: '2.5' },
            ]},
            { id: 3, name: 'Both Teams Score', values: [
              { value: 'Yes', odd: '1.80' }, { value: 'No', odd: '1.90' },
            ]},
          ],
        }],
      }],
    });
    const result = mergeOddsToMatch(matchData, odds);

    // All markets should survive
    expect(result.odds_canonical['1x2']).toBeDefined();
    expect(result.odds_canonical['ou']).toBeDefined();
    expect(result.odds_canonical['btts']).toBeDefined();
    expect(result.odds_suspicious).toBe(false);
    expect(result.odds_sanity_warnings).toHaveLength(0);
  });

  test('sets odds_available=false when all markets fail margin validation', () => {
    const matchData = createMergedMatchData({
      match: { id: '12345', home: 'A', away: 'B', league: 'L', minute: 57, score: '2-1', status: '2H' },
    });
    // All markets have terrible margins
    const odds = createOddsResponse({
      response: [{
        fixture: { id: 12345 },
        update: '',
        league: { id: 1, name: 'L', country: 'EN', logo: '', flag: '', season: 2025 },
        bookmakers: [{
          id: 1, name: 'BM1',
          bets: [
            { id: 1, name: 'Match Winner', values: [
              { value: 'Home', odd: '4.00' }, { value: 'Draw', odd: '5.00' }, { value: 'Away', odd: '6.00' },
            ]},
            { id: 2, name: 'Goals Over/Under', values: [
              { value: 'Over', odd: '4.00', handicap: '2.5' }, { value: 'Under', odd: '4.00', handicap: '2.5' },
            ]},
          ],
        }],
      }],
    });
    const result = mergeOddsToMatch(matchData, odds);

    // All markets removed
    expect(result.odds_canonical['1x2']).toBeUndefined();
    expect(result.odds_canonical['ou']).toBeUndefined();
    // No valid markets → odds_available = false
    expect(result.odds_available).toBe(false);
    // Multiple MARGIN_INVALID warnings
    expect(result.odds_sanity_warnings.filter(w => w.includes('MARGIN_INVALID')).length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Derived Insights from Events
// ============================================================

describe('mergeMatchData — derived insights from events', () => {
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
      strategic_context: null as unknown,
      ...overrides,
    };
  }

  test('derives insights from events with goals, cards, subs', () => {
    const fixture = createFootballApiFixture({
      fixture: {
        id: 12345,
        referee: null,
        timezone: 'UTC',
        date: '2026-03-16T20:00:00+00:00',
        timestamp: 1773955200,
        periods: { first: 1773955200, second: 1773958800 },
        venue: { id: null, name: null, city: null },
        status: { long: 'Second Half', short: '2H', elapsed: 70 },
      },
      goals: { home: 2, away: 1 },
      events: [
        { time: { elapsed: 15, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 1, name: 'Saka' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        { time: { elapsed: 30, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 2, name: 'Palmer' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        { time: { elapsed: 35, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 3, name: 'Rice' }, assist: { id: null, name: null }, type: 'Card', detail: 'Yellow Card', comments: null },
        { time: { elapsed: 50, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 4, name: 'Caicedo' }, assist: { id: null, name: null }, type: 'Card', detail: 'Yellow Card', comments: null },
        { time: { elapsed: 55, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 5, name: 'Havertz' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        { time: { elapsed: 60, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 6, name: 'Nketiah' }, assist: { id: 5, name: 'Havertz' }, type: 'subst', detail: 'Substitution 1', comments: null },
        { time: { elapsed: 65, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 7, name: 'Mudryk' }, assist: { id: 8, name: 'Jackson' }, type: 'subst', detail: 'Substitution 1', comments: null },
      ],
      statistics: [], // No stats available
    });

    const result = mergeMatchData([makePrepared()], [fixture]);
    expect(result).toHaveLength(1);

    const insights = result[0]!.derived_insights!;
    expect(insights).toBeDefined();
    expect(insights.source).toBe('events');
    expect(insights.btts_status).toBe(true);
    expect(insights.home_goals_timeline).toEqual([15, 55]);
    expect(insights.away_goals_timeline).toEqual([30]);
    expect(insights.last_goal_minute).toBe(55);
    expect(insights.total_cards).toBe(2);
    expect(insights.home_cards).toBe(1);
    expect(insights.away_cards).toBe(1);
    expect(insights.home_reds).toBe(0);
    expect(insights.away_reds).toBe(0);
    expect(insights.home_subs).toBe(1);
    expect(insights.away_subs).toBe(1);
    expect(insights.goal_tempo).toBeCloseTo(3 / 70, 3);
    expect(insights.intensity).toBe('medium'); // (3 goals + 2 cards) / 70 ≈ 0.071
  });

  test('backfills yellow and red card stats from events when API stats empty', () => {
    const fixture = createFootballApiFixture({
      events: [
        { time: { elapsed: 20, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 1, name: 'Rice' }, assist: { id: null, name: null }, type: 'Card', detail: 'Yellow Card', comments: null },
        { time: { elapsed: 40, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 2, name: 'Caicedo' }, assist: { id: null, name: null }, type: 'Card', detail: 'Yellow Card', comments: null },
        { time: { elapsed: 60, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 2, name: 'Caicedo' }, assist: { id: null, name: null }, type: 'Card', detail: 'Red Card', comments: null },
      ],
      statistics: [], // Empty — no API stats
    });

    const result = mergeMatchData([makePrepared()], [fixture]);
    const sc = result[0]!.stats_compact;
    // Yellow cards: Arsenal 1, Chelsea 1 (the red is separate)
    expect(sc.yellow_cards).toEqual({ home: '1', away: '1' });
    // Red cards: Chelsea 1
    expect(sc.red_cards).toEqual({ home: '0', away: '1' });
  });

  test('does NOT overwrite API stats with derived card counts', () => {
    // When API stats ARE available, keep them
    const fixture = createFootballApiFixture({
      events: [
        { time: { elapsed: 20, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 1, name: 'Rice' }, assist: { id: null, name: null }, type: 'Card', detail: 'Yellow Card', comments: null },
      ],
      // Default fixture has statistics populated
    });

    const result = mergeMatchData([makePrepared()], [fixture]);
    // Stats should come from API, not events
    expect(result[0]!.stats_compact.yellow_cards).toEqual({ home: null, away: null });
  });

  test('no goals → btts_status false, last_goal_minute null', () => {
    const fixture = createFootballApiFixture({
      goals: { home: 0, away: 0 },
      events: [
        { time: { elapsed: 25, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 1, name: 'Rice' }, assist: { id: null, name: null }, type: 'Card', detail: 'Yellow Card', comments: null },
      ],
      statistics: [],
    });

    const result = mergeMatchData([makePrepared()], [fixture]);
    const insights = result[0]!.derived_insights!;
    expect(insights.btts_status).toBe(false);
    expect(insights.last_goal_minute).toBe(null);
    expect(insights.goal_tempo).toBe(0);
    expect(insights.home_goals_timeline).toEqual([]);
    expect(insights.away_goals_timeline).toEqual([]);
  });

  test('high-intensity match: many cards + goals → intensity high', () => {
    const fixture = createFootballApiFixture({
      fixture: {
        id: 12345,
        referee: null,
        timezone: 'UTC',
        date: '2026-03-16T20:00:00+00:00',
        timestamp: 1773955200,
        periods: { first: 1773955200, second: 1773958800 },
        venue: { id: null, name: null, city: null },
        status: { long: 'Second Half', short: '2H', elapsed: 60 },
      },
      goals: { home: 3, away: 2 },
      events: [
        { time: { elapsed: 5, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 1, name: 'A' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        { time: { elapsed: 10, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 2, name: 'B' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        { time: { elapsed: 15, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 3, name: 'C' }, assist: { id: null, name: null }, type: 'Card', detail: 'Yellow Card', comments: null },
        { time: { elapsed: 20, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 4, name: 'D' }, assist: { id: null, name: null }, type: 'Card', detail: 'Yellow Card', comments: null },
        { time: { elapsed: 25, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 5, name: 'E' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        { time: { elapsed: 30, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 6, name: 'F' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        { time: { elapsed: 35, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 7, name: 'G' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
      ],
      statistics: [],
    });

    const result = mergeMatchData([makePrepared()], [fixture]);
    const insights = result[0]!.derived_insights!;
    // (5 goals + 2 cards) / 60 = 0.1167 > 0.1 → high intensity
    expect(insights.intensity).toBe('high');
    expect(insights.btts_status).toBe(true);
    expect(insights.goal_tempo).toBeCloseTo(5 / 60, 3);
  });

  test('momentum goes to team with more recent events', () => {
    const fixture = createFootballApiFixture({
      fixture: {
        id: 12345,
        referee: null,
        timezone: 'UTC',
        date: '2026-03-16T20:00:00+00:00',
        timestamp: 1773955200,
        periods: { first: 1773955200, second: 1773958800 },
        venue: { id: null, name: null, city: null },
        status: { long: 'Second Half', short: '2H', elapsed: 75 },
      },
      goals: { home: 1, away: 2 },
      events: [
        { time: { elapsed: 10, extra: null }, team: { id: 42, name: 'Arsenal', logo: '' }, player: { id: 1, name: 'A' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        // Chelsea 3 recent events in last 15 min (60-75)
        { time: { elapsed: 62, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 2, name: 'B' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        { time: { elapsed: 68, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 3, name: 'C' }, assist: { id: null, name: null }, type: 'Goal', detail: 'Normal Goal', comments: null },
        { time: { elapsed: 70, extra: null }, team: { id: 49, name: 'Chelsea', logo: '' }, player: { id: 4, name: 'D' }, assist: { id: 5, name: 'E' }, type: 'subst', detail: 'Sub', comments: null },
      ],
      statistics: [],
    });

    const result = mergeMatchData([makePrepared()], [fixture]);
    const insights = result[0]!.derived_insights!;
    expect(insights.momentum).toBe('away');
  });
});
