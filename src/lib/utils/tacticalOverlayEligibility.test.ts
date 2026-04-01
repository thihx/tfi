import { describe, expect, test } from 'vitest';
import { isOverlayEligibleLeague } from './tacticalOverlayEligibility';

describe('isOverlayEligibleLeague', () => {
  test('accepts top domestic leagues', () => {
    expect(isOverlayEligibleLeague({
      league_name: 'Premier League',
      country: 'England',
      type: 'League',
      top_league: true,
    } as never)).toBe(true);
  });

  test('accepts continental club competitions', () => {
    expect(isOverlayEligibleLeague({
      league_name: 'UEFA Champions League',
      country: 'World',
      type: 'Cup',
      top_league: false,
    } as never)).toBe(true);
  });

  test('accepts major international tournaments', () => {
    expect(isOverlayEligibleLeague({
      league_name: 'FIFA World Cup',
      country: 'World',
      type: 'International',
      top_league: false,
    } as never)).toBe(true);
  });

  test('rejects friendlies', () => {
    expect(isOverlayEligibleLeague({
      league_name: 'International Friendlies',
      country: 'World',
      type: 'International',
      top_league: false,
    } as never)).toBe(false);
  });
});

