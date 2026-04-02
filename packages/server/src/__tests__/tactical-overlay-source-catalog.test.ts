import { describe, expect, test } from 'vitest';
import { getTacticalOverlaySourceCatalog } from '../lib/tactical-overlay-source-catalog.js';

describe('getTacticalOverlaySourceCatalog', () => {
  test('returns competition-specific preferred domains for top domestic leagues', () => {
    const result = getTacticalOverlaySourceCatalog({
      leagueName: 'Premier League',
      country: 'England',
      type: 'League',
      topLeague: true,
    });

    expect(result.classification.reason).toBe('top_domestic_league');
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

  test('returns tournament-aware preferred domains for continental club competitions', () => {
    const result = getTacticalOverlaySourceCatalog({
      leagueName: 'UEFA Champions League',
      country: 'World',
      type: 'Cup',
      topLeague: false,
    });

    expect(result.classification.reason).toBe('continental_club_competition');
    expect(result.preferredDomains).toEqual(expect.arrayContaining([
      'uefa.com',
      'fbref.com',
      'transfermarkt.com',
    ]));
    expect(result.researchFocus).toEqual(expect.arrayContaining([
      'matchup-specific tactical style',
      'rotation around continental fixtures',
    ]));
  });
});
