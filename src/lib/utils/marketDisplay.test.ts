import { describe, expect, test } from 'vitest';

import { formatCanonicalMarketLabel, formatSelectionWithMarketContext } from './marketDisplay';

describe('marketDisplay', () => {
  test('formats first-half market labels clearly', () => {
    expect(formatCanonicalMarketLabel('ht_1x2_home')).toBe('H1 European 1X2');
    expect(formatCanonicalMarketLabel('ht_asian_handicap_home_-0.25')).toBe('H1 Asian Handicap');
    expect(formatCanonicalMarketLabel('ht_under_1.5')).toBe('H1 Goals O/U');
  });

  test('formats selection with market context', () => {
    expect(formatSelectionWithMarketContext({
      selection: 'Home -0.25',
      betMarket: 'asian_handicap_home_-0.25',
      odds: 1.95,
    })).toBe('FT Asian Handicap · Home -0.25 @1.95');
  });
});
