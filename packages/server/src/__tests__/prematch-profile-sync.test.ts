import { describe, expect, test } from 'vitest';

import {
  __testables__,
  buildSettlementEventSummaryFromEvents,
  deriveLeagueProfileFromHistory,
  deriveTeamProfileFromHistory,
} from '../lib/prematch-profile-sync.js';

describe('prematch profile sync helpers', () => {
  test('derives league profile from settled match history', () => {
    const rows = Array.from({ length: 24 }, (_, index) => ({
      match_id: String(index + 1),
      league_id: 39,
      league_name: 'Premier League',
      home_team: `Home ${index}`,
      away_team: `Away ${index}`,
      final_status: 'FT',
      home_score: index % 3 === 0 ? 3 : 2,
      away_score: index % 4 === 0 ? 2 : 1,
      settlement_stats: [
        { type: 'Corner Kicks', home: 6, away: 5 },
        { type: 'Yellow Cards', home: 2, away: 2 },
      ],
      settlement_event_summary: {
        first_scoring_side: index % 2 === 0 ? 'home' : 'away',
        has_goal_after_75: index % 3 === 0,
        goal_event_count: 3,
        source: 'api-football-events',
      },
      date: '2026-03-01',
    }));

    const profile = deriveLeagueProfileFromHistory(rows);

    expect(profile).not.toBeNull();
    expect(profile?.avg_goals).toBeGreaterThan(2.5);
    expect(profile?.over_2_5_rate).toBeGreaterThan(0.6);
    expect(profile?.avg_corners).toBe(11);
    expect(profile?.cards_tendency).toBe('balanced');
    expect(profile?.data_reliability_tier).toBe('low');
    expect(profile?.late_goal_rate_75_plus).toBeCloseTo(0.333, 3);
  });

  test('derives team profile from team-centric match history with neutral tactical defaults', () => {
    const rows = [
      { goalsFor: 2, goalsAgainst: 0, isHome: true, cornersFor: 7, cornersAgainst: 3, cards: 2, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 1, goalsAgainst: 0, isHome: true, cornersFor: 6, cornersAgainst: 2, cards: 1, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 1, isHome: true, cornersFor: 5, cornersAgainst: 4, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 1, goalsAgainst: 1, isHome: true, cornersFor: 6, cornersAgainst: 3, cards: 2, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 0, goalsAgainst: 1, isHome: false, cornersFor: 4, cornersAgainst: 6, cards: 3, scoredFirst: false, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 1, isHome: false, cornersFor: 5, cornersAgainst: 5, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 3, goalsAgainst: 1, isHome: false, cornersFor: 6, cornersAgainst: 4, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 1, goalsAgainst: 0, isHome: false, cornersFor: 5, cornersAgainst: 4, cards: 1, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 2, isHome: false, cornersFor: 5, cornersAgainst: 5, cards: 2, scoredFirst: false, hadGoalAfter75: true },
      { goalsFor: 1, goalsAgainst: 0, isHome: false, cornersFor: 4, cornersAgainst: 5, cards: 1, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 1, isHome: true, cornersFor: 7, cornersAgainst: 3, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 3, goalsAgainst: 1, isHome: true, cornersFor: 8, cornersAgainst: 4, cards: 2, scoredFirst: true, hadGoalAfter75: false },
    ];

    const profile = deriveTeamProfileFromHistory(rows);

    expect(profile).not.toBeNull();
    expect(profile?.attack_style).toBe('mixed');
    expect(profile?.home_strength).toBe('strong');
    expect(profile?.set_piece_threat).toBe('medium');
    expect(profile?.avg_goals_scored).toBeGreaterThan(1.5);
    expect(profile?.clean_sheet_rate).toBeGreaterThan(0.3);
    expect(profile?.first_goal_rate).toBeCloseTo(0.833, 3);
    expect(profile?.late_goal_rate).toBeCloseTo(0.417, 3);
    expect(profile?.data_reliability_tier).toBe('medium');
  });

  test('keeps event-derived rates null when timeline coverage is too sparse', () => {
    const rows = [
      { goalsFor: 2, goalsAgainst: 0, isHome: true, cornersFor: 7, cornersAgainst: 3, cards: 2, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 1, goalsAgainst: 0, isHome: true, cornersFor: 6, cornersAgainst: 2, cards: 1, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 1, isHome: true, cornersFor: 5, cornersAgainst: 4, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 1, goalsAgainst: 1, isHome: true, cornersFor: 6, cornersAgainst: 3, cards: 2, scoredFirst: null, hadGoalAfter75: null },
      { goalsFor: 0, goalsAgainst: 1, isHome: false, cornersFor: 4, cornersAgainst: 6, cards: 3, scoredFirst: null, hadGoalAfter75: null },
      { goalsFor: 2, goalsAgainst: 1, isHome: false, cornersFor: 5, cornersAgainst: 5, cards: 2, scoredFirst: null, hadGoalAfter75: null },
      { goalsFor: 3, goalsAgainst: 1, isHome: false, cornersFor: 6, cornersAgainst: 4, cards: 2, scoredFirst: null, hadGoalAfter75: null },
      { goalsFor: 1, goalsAgainst: 0, isHome: false, cornersFor: 5, cornersAgainst: 4, cards: 1, scoredFirst: null, hadGoalAfter75: null },
    ];

    const profile = deriveTeamProfileFromHistory(rows);

    expect(profile?.first_goal_rate).toBeNull();
    expect(profile?.late_goal_rate).toBeNull();
  });

  test('builds compact settlement event summary from goal timeline', () => {
    const summary = buildSettlementEventSummaryFromEvents(
      {
        home_team: 'Team A',
        away_team: 'Team B',
        home_score: 2,
        away_score: 1,
      },
      [
        { time: { elapsed: 12 }, team: { name: 'Team A' }, type: 'Goal', detail: 'Normal Goal' },
        { time: { elapsed: 81 }, team: { name: 'Team B' }, type: 'Goal', detail: 'Normal Goal' },
        { time: { elapsed: 90 }, team: { name: 'Team A' }, type: 'Goal', detail: 'Penalty' },
      ],
    );

    expect(summary).toEqual({
      first_scoring_side: 'home',
      has_goal_after_75: true,
      goal_event_count: 3,
      source: 'api-football-events',
    });
  });

  test('derives goalless settlement summary without requiring timeline goals', () => {
    const summary = buildSettlementEventSummaryFromEvents(
      {
        home_team: 'Team A',
        away_team: 'Team B',
        home_score: 0,
        away_score: 0,
      },
      [],
    );

    expect(summary).toEqual({
      first_scoring_side: null,
      has_goal_after_75: false,
      goal_event_count: 0,
      source: 'api-football-events',
    });
  });

  test('selects current and previous season for historical backfill', () => {
    expect(__testables__.buildBackfillSeasons(2026)).toEqual([2026, 2025]);
    expect(__testables__.buildBackfillSeasons(null)).toEqual([]);
  });

  test('builds archive rows only for finished fixtures within the lookback window', () => {
    const rows = __testables__.buildHistoricalBackfillArchiveRows(
      [
        {
          fixture: {
            id: 1001,
            date: '2026-03-21T12:00:00+00:00',
            venue: { name: 'A' },
            status: { short: 'FT' },
          },
          league: { id: 98, name: 'J1 League' },
          teams: { home: { name: 'Machida Zelvia' }, away: { name: 'FC Tokyo' } },
          goals: { home: 2, away: 1 },
          score: { fulltime: { home: 2, away: 1 } },
        },
        {
          fixture: {
            id: 1002,
            date: '2025-08-01T12:00:00+00:00',
            venue: { name: 'B' },
            status: { short: 'FT' },
          },
          league: { id: 98, name: 'J1 League' },
          teams: { home: { name: 'Old Home' }, away: { name: 'Old Away' } },
          goals: { home: 0, away: 0 },
          score: { fulltime: { home: 0, away: 0 } },
        },
        {
          fixture: {
            id: 1003,
            date: '2026-03-22T12:00:00+00:00',
            venue: { name: 'C' },
            status: { short: 'NS' },
          },
          league: { id: 98, name: 'J1 League' },
          teams: { home: { name: 'Future Home' }, away: { name: 'Future Away' } },
          goals: { home: null, away: null },
          score: { fulltime: { home: null, away: null } },
        },
      ],
      '2025-10-01',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      match_id: '1001',
      league_id: 98,
      league_name: 'J1 League',
      home_team: 'Machida Zelvia',
      away_team: 'FC Tokyo',
      final_status: 'FT',
    });
  });
});
