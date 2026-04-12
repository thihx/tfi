import { buildOddsCanonical } from '../lib/server-pipeline.js';

describe('odds canonical parser', () => {
  test('does not treat corners over/under as goals over/under', () => {
    const result = buildOddsCanonical([{
      bookmakers: [{
        name: 'Replay Mock',
        bets: [
          {
            name: 'Corners Over/Under',
            values: [
              { value: 'Over', odd: '2.10', handicap: '10' },
              { value: 'Under', odd: '2.20', handicap: '10' },
            ],
          },
        ],
      }],
    }]);

    expect(result.canonical.ou).toBeUndefined();
    expect(result.canonical.corners_ou).toEqual({
      line: 10,
      over: 2.1,
      under: 2.2,
    });
  });

  test('does not treat corner handicap as asian handicap', () => {
    const result = buildOddsCanonical([{
      bookmakers: [{
        name: 'Replay Mock',
        bets: [
          {
            name: 'Corner Handicap',
            values: [
              { value: 'Home', odd: '1.95', handicap: '-1.5' },
              { value: 'Away', odd: '1.87', handicap: '+1.5' },
            ],
          },
        ],
      }],
    }]);

    expect(result.canonical.ah).toBeUndefined();
  });

  test('keeps goals over/under separate from corners over/under when both are present', () => {
    const result = buildOddsCanonical([{
      bookmakers: [{
        name: 'Replay Mock',
        bets: [
          {
            name: 'Over/Under',
            values: [
              { value: 'Over', odd: '1.91', handicap: '2.5' },
              { value: 'Under', odd: '1.93', handicap: '2.5' },
            ],
          },
          {
            name: 'Corners Over/Under',
            values: [
              { value: 'Over', odd: '2.10', handicap: '10' },
              { value: 'Under', odd: '2.20', handicap: '10' },
            ],
          },
        ],
      }],
    }]);

    expect(result.canonical.ou).toEqual({
      line: 2.5,
      over: 1.91,
      under: 1.93,
    });
    expect(result.canonical.corners_ou).toEqual({
      line: 10,
      over: 2.1,
      under: 2.2,
    });
  });

  test('picks main plus nearest adjacent goals O/U ladder line', () => {
    const result = buildOddsCanonical([{
      bookmakers: [{
        name: 'Replay Mock',
        bets: [
          {
            name: 'Over/Under',
            values: [
              { value: 'Over', odd: '1.91', handicap: '2.5' },
              { value: 'Under', odd: '1.93', handicap: '2.5' },
              { value: 'Over', odd: '1.85', handicap: '3.0' },
              { value: 'Under', odd: '2.00', handicap: '3.0' },
            ],
          },
        ],
      }],
    }]);

    expect(result.canonical.ou?.line).toBe(2.5);
    expect(result.canonical.ou_adjacent?.line).toBe(3);
  });

  test('picks main plus nearest adjacent Asian handicap line', () => {
    const result = buildOddsCanonical([{
      bookmakers: [{
        name: 'Replay Mock',
        bets: [
          {
            name: 'Asian Handicap',
            values: [
              { value: '1', odd: '1.90', handicap: '-0.75' },
              { value: '2', odd: '1.92', handicap: '+0.75' },
              { value: '1', odd: '1.88', handicap: '-0.25' },
              { value: '2', odd: '1.95', handicap: '+0.25' },
              { value: '1', odd: '1.85', handicap: '-1.0' },
              { value: '2', odd: '1.98', handicap: '+1.0' },
            ],
          },
        ],
      }],
    }]);

    // Main = smallest |handicap| among fully quoted lines (live-style main), not tightest price spread.
    expect(result.canonical.ah?.line).toBe(-0.25);
    // Nearest other rung to −0.25 is −0.75 (distance 0.5) vs −1 (0.75)
    expect(result.canonical.ah_adjacent?.line).toBe(-0.75);
  });

  test('includes up to two extra Asian handicap rungs beyond main and adjacent', () => {
    const result = buildOddsCanonical([{
      bookmakers: [{
        name: 'Replay Mock',
        bets: [
          {
            name: 'Asian Handicap',
            values: [
              { value: '1', odd: '1.88', handicap: '-0.25' },
              { value: '2', odd: '1.95', handicap: '+0.25' },
              { value: '1', odd: '1.90', handicap: '-0.75' },
              { value: '2', odd: '1.92', handicap: '+0.75' },
              { value: '1', odd: '1.85', handicap: '-1' },
              { value: '2', odd: '1.98', handicap: '+1' },
              { value: '1', odd: '1.82', handicap: '-1.25' },
              { value: '2', odd: '2.00', handicap: '+1.25' },
            ],
          },
        ],
      }],
    }]);

    expect(result.canonical.ah?.line).toBe(-0.25);
    expect(result.canonical.ah_adjacent?.line).toBe(-0.75);
    expect(result.canonical.ah_extra?.map((r) => r.line)).toEqual([-1, -1.25]);
  });

  test('goals O/U main follows smallest line above current total when goal hint is set', () => {
    const response = [{
      bookmakers: [{
        name: 'Replay Mock',
        bets: [
          {
            name: 'Over/Under',
            values: [
              { value: 'Over', odd: '1.90', handicap: '3.5' },
              { value: 'Under', odd: '1.90', handicap: '3.5' },
              { value: 'Over', odd: '1.85', handicap: '2.5' },
              { value: 'Under', odd: '1.95', handicap: '2.5' },
            ],
          },
        ],
      }],
    }];

    const withoutHint = buildOddsCanonical(response);
    expect(withoutHint.canonical.ou?.line).toBe(3.5);

    const withHint = buildOddsCanonical(response, { totalGoalsFt: 2 });
    expect(withHint.canonical.ou?.line).toBe(2.5);
    expect(withHint.canonical.ou_adjacent?.line).toBe(3.5);
  });

  test('first half goals O/U maps to ht_ou without polluting FT ou', () => {
    const result = buildOddsCanonical([{
      bookmakers: [{
        name: 'Replay Mock',
        bets: [
          {
            name: 'Over/Under First Half',
            values: [
              { value: 'Over', odd: '2.05', handicap: '1.5' },
              { value: 'Under', odd: '1.75', handicap: '1.5' },
            ],
          },
          {
            name: 'Over/Under',
            values: [
              { value: 'Over', odd: '1.91', handicap: '2.5' },
              { value: 'Under', odd: '1.93', handicap: '2.5' },
            ],
          },
        ],
      }],
    }]);

    expect(result.canonical.ou?.line).toBe(2.5);
    expect(result.canonical.ht_ou).toEqual({
      line: 1.5,
      over: 2.05,
      under: 1.75,
    });
  });
});
