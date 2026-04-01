import { describe, expect, test } from 'vitest';
import { selectTacticalOverlayRefreshCandidates } from '../lib/team-tactical-overlay.service.js';

function candidate(overrides: Record<string, unknown>) {
  return {
    team_id: '1',
    team_name: 'Test Team',
    team_logo: '',
    league_id: 1,
    league_name: 'Test League',
    league_country: 'England',
    league_type: 'League',
    league_season: 2026,
    top_league: false,
    notes_en: '',
    notes_vi: '',
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    profile: {
      version: 2,
      source_mode: 'hybrid',
      window: {
        lookback_days: 180,
        sample_matches: 20,
        sample_home_matches: 10,
        sample_away_matches: 10,
        event_summary_matches: 12,
        event_coverage: 0.6,
        top_league_only: true,
        computed_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      },
      quantitative_core: {
        set_piece_threat: 'medium',
        home_strength: 'normal',
        form_consistency: 'inconsistent',
        avg_goals_scored: null,
        avg_goals_conceded: null,
        clean_sheet_rate: null,
        btts_rate: null,
        over_2_5_rate: null,
        avg_corners_for: null,
        avg_corners_against: null,
        avg_cards: null,
        first_goal_rate: null,
        late_goal_rate: null,
        data_reliability_tier: 'medium',
      },
      tactical_overlay: {
        attack_style: 'mixed',
        defensive_line: 'medium',
        pressing_intensity: 'medium',
        squad_depth: 'medium',
        source_mode: 'default_neutral',
        source_confidence: null,
        source_urls: [],
        source_season: null,
        updated_at: null,
      },
    },
    ...overrides,
  };
}

describe('selectTacticalOverlayRefreshCandidates', () => {
  test('prefers an eligible context over an ineligible friendly context for the same team', () => {
    const selected = selectTacticalOverlayRefreshCandidates([
      candidate({
        team_id: '42',
        league_id: 100,
        league_name: 'International Friendlies',
        league_country: 'World',
        league_type: 'International',
      }),
      candidate({
        team_id: '42',
        league_id: 200,
        league_name: 'FIFA World Cup',
        league_country: 'World',
        league_type: 'International',
      }),
    ] as never, { maxPerRun: 10, staleDays: 30 }, new Date('2026-04-01T00:00:00.000Z'));

    expect(selected).toHaveLength(1);
    expect(selected[0]?.league_name).toBe('FIFA World Cup');
  });
});

