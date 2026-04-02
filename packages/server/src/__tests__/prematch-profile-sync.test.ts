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
      { goalsFor: 2, goalsAgainst: 0, isHome: true, matchDate: '2026-03-01', cornersFor: 7, cornersAgainst: 3, cards: 2, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 1, goalsAgainst: 0, isHome: true, matchDate: '2026-03-02', cornersFor: 6, cornersAgainst: 2, cards: 1, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 1, isHome: true, matchDate: '2026-03-03', cornersFor: 5, cornersAgainst: 4, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 1, goalsAgainst: 1, isHome: true, matchDate: '2026-03-04', cornersFor: 6, cornersAgainst: 3, cards: 2, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 0, goalsAgainst: 1, isHome: false, matchDate: '2026-03-05', cornersFor: 4, cornersAgainst: 6, cards: 3, scoredFirst: false, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 1, isHome: false, matchDate: '2026-03-06', cornersFor: 5, cornersAgainst: 5, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 3, goalsAgainst: 1, isHome: false, matchDate: '2026-03-07', cornersFor: 6, cornersAgainst: 4, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 1, goalsAgainst: 0, isHome: false, matchDate: '2026-03-08', cornersFor: 5, cornersAgainst: 4, cards: 1, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 2, isHome: false, matchDate: '2026-03-09', cornersFor: 5, cornersAgainst: 5, cards: 2, scoredFirst: false, hadGoalAfter75: true },
      { goalsFor: 1, goalsAgainst: 0, isHome: false, matchDate: '2026-03-10', cornersFor: 4, cornersAgainst: 5, cards: 1, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 1, isHome: true, matchDate: '2026-03-11', cornersFor: 7, cornersAgainst: 3, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 3, goalsAgainst: 1, isHome: true, matchDate: '2026-03-12', cornersFor: 8, cornersAgainst: 4, cards: 2, scoredFirst: true, hadGoalAfter75: false },
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
      { goalsFor: 2, goalsAgainst: 0, isHome: true, matchDate: '2026-03-01', cornersFor: 7, cornersAgainst: 3, cards: 2, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 1, goalsAgainst: 0, isHome: true, matchDate: '2026-03-02', cornersFor: 6, cornersAgainst: 2, cards: 1, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 2, goalsAgainst: 1, isHome: true, matchDate: '2026-03-03', cornersFor: 5, cornersAgainst: 4, cards: 2, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 1, goalsAgainst: 1, isHome: true, matchDate: '2026-03-04', cornersFor: 6, cornersAgainst: 3, cards: 2, scoredFirst: null, hadGoalAfter75: null },
      { goalsFor: 0, goalsAgainst: 1, isHome: false, matchDate: '2026-03-05', cornersFor: 4, cornersAgainst: 6, cards: 3, scoredFirst: null, hadGoalAfter75: null },
      { goalsFor: 2, goalsAgainst: 1, isHome: false, matchDate: '2026-03-06', cornersFor: 5, cornersAgainst: 5, cards: 2, scoredFirst: null, hadGoalAfter75: null },
      { goalsFor: 3, goalsAgainst: 1, isHome: false, matchDate: '2026-03-07', cornersFor: 6, cornersAgainst: 4, cards: 2, scoredFirst: null, hadGoalAfter75: null },
      { goalsFor: 1, goalsAgainst: 0, isHome: false, matchDate: '2026-03-08', cornersFor: 5, cornersAgainst: 4, cards: 1, scoredFirst: null, hadGoalAfter75: null },
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

  test('aggregates team candidates across approved competitions into one team profile target', () => {
    const candidates = __testables__.buildTeamCandidateAggregates(
      [
        { league_id: 2, team_id: 88, team_name: 'Rangers', source: 'directory' },
        { league_id: 203, team_id: 88, team_name: 'Rangers', source: 'matches' },
        { league_id: 203, team_id: 91, team_name: 'Braga', source: 'matches' },
      ],
      new Map([
        [2, false],
        [203, true],
      ]),
      new Map([
        [2, __testables__.INTERNATIONAL_PROFILE_POLICY],
        [203, __testables__.DOMESTIC_PROFILE_POLICY],
      ]),
    );

    expect(candidates).toEqual([
      {
        teamId: '88',
        names: ['rangers'],
        targetLeagueIds: [2, 203],
        topLeagueOnly: false,
        profilePolicy: __testables__.INTERNATIONAL_PROFILE_POLICY,
        expandRelatedHistory: false,
      },
      {
        teamId: '91',
        names: ['braga'],
        targetLeagueIds: [203],
        topLeagueOnly: true,
        profilePolicy: __testables__.DOMESTIC_PROFILE_POLICY,
        expandRelatedHistory: true,
      },
    ]);
  });

  test('builds team history samples across competitions for the same club', () => {
    const rows = [
      {
        match_id: '1',
        league_id: 2,
        league_name: 'UEFA Champions League',
        home_team_id: 88,
        home_team: 'Rangers',
        away_team_id: 99,
        away_team: 'Benfica',
        final_status: 'FT',
        home_score: 1,
        away_score: 1,
        settlement_stats: [],
        settlement_event_summary: {
          first_scoring_side: 'home',
          has_goal_after_75: false,
          goal_event_count: 2,
          source: 'api-football-events',
        },
        date: '2026-02-01',
      },
      {
        match_id: '2',
        league_id: 179,
        league_name: 'Scottish Premiership',
        home_team_id: 88,
        home_team: 'Rangers',
        away_team_id: 101,
        away_team: 'Hearts',
        final_status: 'FT',
        home_score: 2,
        away_score: 0,
        settlement_stats: [],
        settlement_event_summary: {
          first_scoring_side: 'home',
          has_goal_after_75: true,
          goal_event_count: 2,
          source: 'api-football-events',
        },
        date: '2026-02-08',
      },
      {
        match_id: '3',
        league_id: 179,
        league_name: 'Scottish Premiership',
        home_team_id: 102,
        home_team: 'Celtic',
        away_team_id: 88,
        away_team: 'Rangers',
        final_status: 'FT',
        home_score: 1,
        away_score: 2,
        settlement_stats: [],
        settlement_event_summary: {
          first_scoring_side: 'away',
          has_goal_after_75: false,
          goal_event_count: 3,
          source: 'api-football-events',
        },
        date: '2026-02-15',
      },
    ];

    const samples = __testables__.buildTeamPerspectiveSamplesByCandidate(
      rows,
      [
        {
          teamId: '88',
          names: ['rangers'],
          targetLeagueIds: [2],
          topLeagueOnly: false,
          profilePolicy: __testables__.INTERNATIONAL_PROFILE_POLICY,
          expandRelatedHistory: false,
        },
      ],
    );

    expect(samples.get('88')).toHaveLength(3);
    expect(samples.get('88')?.filter((sample) => sample.isHome)).toHaveLength(2);
    expect(samples.get('88')?.filter((sample) => !sample.isHome)).toHaveLength(1);
  });

  test('allows international team profile derivation with lower match floor and longer lookback', () => {
    const rows = [
      { goalsFor: 2, goalsAgainst: 0, isHome: true, matchDate: '2025-11-01', cornersFor: 7, cornersAgainst: 3, cards: 2, scoredFirst: true, hadGoalAfter75: false },
      { goalsFor: 1, goalsAgainst: 1, isHome: false, matchDate: '2025-11-15', cornersFor: 5, cornersAgainst: 4, cards: 1, scoredFirst: false, hadGoalAfter75: false },
      { goalsFor: 3, goalsAgainst: 1, isHome: true, matchDate: '2026-03-20', cornersFor: 6, cornersAgainst: 4, cards: 1, scoredFirst: true, hadGoalAfter75: true },
      { goalsFor: 1, goalsAgainst: 0, isHome: false, matchDate: '2026-03-28', cornersFor: 4, cornersAgainst: 5, cards: 2, scoredFirst: true, hadGoalAfter75: false },
    ];

    expect(deriveTeamProfileFromHistory(rows)).toBeNull();

    const profile = deriveTeamProfileFromHistory(rows, __testables__.INTERNATIONAL_PROFILE_POLICY);
    expect(profile).not.toBeNull();
    expect(profile?.data_reliability_tier).toBe('low');
  });

  test('resolves international competitions to the wider profile policy', () => {
    expect(__testables__.resolveLeagueProfilePolicy({
      leagueName: 'World Cup - Qualification Europe',
      country: 'World',
      type: 'Cup',
      topLeague: false,
    })).toEqual(__testables__.INTERNATIONAL_PROFILE_POLICY);

    expect(__testables__.resolveLeagueProfilePolicy({
      leagueName: 'Premier League',
      country: 'England',
      type: 'League',
      topLeague: true,
    })).toEqual(__testables__.DOMESTIC_PROFILE_POLICY);
  });

  test('allows international league profile derivation with smaller sample floor', () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({
      match_id: String(index + 1),
      league_id: 5,
      league_name: 'UEFA Nations League',
      home_team_id: 100 + index,
      home_team: `Home ${index}`,
      away_team_id: 200 + index,
      away_team: `Away ${index}`,
      final_status: 'FT',
      home_score: index % 2 === 0 ? 2 : 1,
      away_score: 1,
      settlement_stats: [
        { type: 'Corner Kicks', home: 5, away: 4 },
        { type: 'Yellow Cards', home: 2, away: 2 },
      ],
      settlement_event_summary: {
        first_scoring_side: index % 2 === 0 ? 'home' : 'away',
        has_goal_after_75: index % 2 === 0,
        goal_event_count: 2,
        source: 'api-football-events',
      },
      date: '2026-03-28',
    }));

    expect(deriveLeagueProfileFromHistory(rows)).toBeNull();
    expect(deriveLeagueProfileFromHistory(rows, __testables__.INTERNATIONAL_PROFILE_POLICY)).not.toBeNull();
  });

  test('skips heavy history backfill when recent rows with team ids are already present', () => {
    expect(__testables__.hasFreshEnoughHistoryCoverage({
      league_id: 32,
      recent_rows: 108,
      recent_rows_with_team_ids: 108,
      latest_date: new Date().toISOString().slice(0, 10),
    }, __testables__.INTERNATIONAL_PROFILE_POLICY)).toBe(true);

    expect(__testables__.hasFreshEnoughHistoryCoverage({
      league_id: 32,
      recent_rows: 108,
      recent_rows_with_team_ids: 3,
      latest_date: new Date().toISOString().slice(0, 10),
    }, __testables__.INTERNATIONAL_PROFILE_POLICY)).toBe(true);

    expect(__testables__.hasFreshEnoughHistoryCoverage({
      league_id: 5,
      recent_rows: 4,
      recent_rows_with_team_ids: 0,
      latest_date: new Date().toISOString().slice(0, 10),
    }, __testables__.INTERNATIONAL_PROFILE_POLICY)).toBe(true);
  });

  test('skips stale international season backfill outside the lookback window', () => {
    expect(__testables__.shouldSkipInternationalSeasonBackfill(
      2023,
      '2025-04-02',
      __testables__.INTERNATIONAL_PROFILE_POLICY,
    )).toBe(true);

    expect(__testables__.shouldSkipInternationalSeasonBackfill(
      2026,
      '2025-04-02',
      __testables__.INTERNATIONAL_PROFILE_POLICY,
    )).toBe(false);

    expect(__testables__.shouldSkipInternationalSeasonBackfill(
      2023,
      '2025-04-02',
      __testables__.DOMESTIC_PROFILE_POLICY,
    )).toBe(false);
  });
});
