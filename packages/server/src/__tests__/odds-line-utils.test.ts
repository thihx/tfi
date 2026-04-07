import { parseBetMarketLineSuffix, sameOddsLine } from '../lib/odds-line-utils.js';

describe('odds-line-utils', () => {
  test('parses line suffix from bet_market keys', () => {
    expect(parseBetMarketLineSuffix('over_', 'over_2.5')).toBe(2.5);
    expect(parseBetMarketLineSuffix('asian_handicap_home_', 'asian_handicap_home_-0.25')).toBe(-0.25);
  });

  test('sameOddsLine tolerates float noise', () => {
    expect(sameOddsLine(2.5, 2.5)).toBe(true);
    expect(sameOddsLine(2.5, 2.5000004)).toBe(true);
    expect(sameOddsLine(2.5, 2.6)).toBe(false);
  });
});