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
});
