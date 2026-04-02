import { describe, expect, test } from 'vitest';
import { getTacticalOverlaySourceCatalog } from './tacticalOverlaySourceCatalog';

describe('getTacticalOverlaySourceCatalog', () => {
  test('returns preferred domains for premier league context', () => {
    const result = getTacticalOverlaySourceCatalog('Premier League');

    expect(result.preferredDomains).toEqual(expect.arrayContaining([
      'premierleague.com',
      'bbc.com',
      'fbref.com',
    ]));
    expect(result.researchFocus).toEqual(expect.arrayContaining([
      'pressing shape',
      'rotation risk',
    ]));
  });

  test('returns continental competition hints for champions league context', () => {
    const result = getTacticalOverlaySourceCatalog('UEFA Champions League');

    expect(result.preferredDomains).toEqual(expect.arrayContaining([
      'uefa.com',
      'fbref.com',
      'transfermarkt.com',
    ]));
    expect(result.researchFocus).toEqual(expect.arrayContaining([
      'continental matchup tactical style',
      'rotation around European fixtures',
    ]));
  });
});
