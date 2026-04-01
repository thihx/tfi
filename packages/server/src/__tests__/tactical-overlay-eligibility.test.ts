import { describe, expect, test } from 'vitest';
import { classifyTacticalOverlayCompetition } from '../lib/tactical-overlay-eligibility.js';

describe('classifyTacticalOverlayCompetition', () => {
  test('treats top domestic leagues as eligible core', () => {
    const result = classifyTacticalOverlayCompetition({
      leagueName: 'Premier League',
      country: 'England',
      type: 'League',
      topLeague: true,
    });

    expect(result.eligible).toBe(true);
    expect(result.policy).toBe('eligible_core');
    expect(result.reason).toBe('top_domestic_league');
  });

  test('treats continental club competitions as eligible core', () => {
    const result = classifyTacticalOverlayCompetition({
      leagueName: 'UEFA Champions League',
      country: 'World',
      type: 'Cup',
      topLeague: false,
    });

    expect(result.eligible).toBe(true);
    expect(result.entityType).toBe('club');
    expect(result.reason).toBe('continental_club_competition');
  });

  test('treats major international tournaments as eligible core', () => {
    const result = classifyTacticalOverlayCompetition({
      leagueName: 'FIFA World Cup',
      country: 'World',
      type: 'International',
      topLeague: false,
    });

    expect(result.eligible).toBe(true);
    expect(result.entityType).toBe('national_team');
    expect(result.reason).toBe('international_tournament');
  });

  test('treats qualifiers as eligible extended', () => {
    const result = classifyTacticalOverlayCompetition({
      leagueName: 'FIFA World Cup - Qualification Asia',
      country: 'World',
      type: 'International',
      topLeague: false,
    });

    expect(result.eligible).toBe(true);
    expect(result.policy).toBe('eligible_extended');
    expect(result.reason).toBe('international_qualifier');
  });

  test('rejects friendly contexts', () => {
    const result = classifyTacticalOverlayCompetition({
      leagueName: 'International Friendlies',
      country: 'World',
      type: 'International',
      topLeague: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('friendly_context');
  });
});

