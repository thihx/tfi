import { describe, expect, test } from 'vitest';

import {
  buildProfileMetricSemantics,
  buildProfileMetricSemanticsSection,
} from '../lib/profile-metric-semantics.js';

describe('profile metric semantics', () => {
  test('builds explicit semantic definitions for league and team profile metrics', () => {
    const blocks = buildProfileMetricSemantics(
      {
        profile: {
          version: 2,
          source_mode: 'auto_derived',
          window: {
            lookback_days: 180,
            sample_matches: 74,
            event_summary_matches: 60,
            event_coverage: 0.811,
            top_league_only: true,
            computed_at: '2026-04-01T00:00:00Z',
            updated_at: '2026-04-01T00:00:00Z',
          },
          core: {
            tempo_tier: 'high',
            goal_tendency: 'balanced',
            home_advantage_tier: 'balanced',
            corners_tendency: 'balanced',
            cards_tendency: 'low',
            volatility_tier: 'high',
            data_reliability_tier: 'high',
          },
          quantitative: {
            avg_goals: 2.8,
            over_2_5_rate: 0.57,
            btts_rate: 0.52,
            late_goal_rate_75_plus: 0.36,
            avg_corners: 9.4,
            avg_cards: 4.1,
          },
        },
      },
      {
        profile: {
          version: 2,
          source_mode: 'hybrid',
          window: {
            lookback_days: 180,
            sample_matches: 22,
            sample_home_matches: 11,
            sample_away_matches: 11,
            event_summary_matches: 17,
            event_coverage: 0.773,
            top_league_only: true,
            computed_at: '2026-04-01T00:00:00Z',
            updated_at: '2026-04-01T00:00:00Z',
          },
          quantitative_core: {
            set_piece_threat: 'medium',
            home_strength: 'strong',
            form_consistency: 'consistent',
            avg_goals_scored: 1.64,
            avg_goals_conceded: 0.91,
            clean_sheet_rate: 0.36,
            btts_rate: 0.45,
            over_2_5_rate: 0.5,
            avg_corners_for: 5.7,
            avg_corners_against: 4.1,
            avg_cards: 2,
            first_goal_rate: 0.59,
            late_goal_rate: 0.34,
            data_reliability_tier: 'high',
          },
          tactical_overlay: {
            attack_style: 'mixed',
            defensive_line: 'medium',
            pressing_intensity: 'medium',
            squad_depth: 'medium',
            source_mode: 'default_neutral',
            source_confidence: null,
            updated_at: null,
          },
        },
      },
      null,
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.window.sample_matches).toBe(74);
    expect(blocks[1]?.window.event_coverage).toBe(0.773);
    expect(blocks[1]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          raw_key: 'btts_rate',
          semantic_name: 'team_match_btts_rate',
          value: 45,
          definition: 'Share of this team\'s sampled matches in which both teams scored.',
          caveat: 'This is a match-environment metric, not a standalone attacking-strength metric.',
        }),
        expect.objectContaining({
          raw_key: 'attack_style',
          caveat: 'Neutral default tactical overlay. Do not treat this as hard evidence.',
        }),
      ]),
    );
  });

  test('renders a structured semantics section for prompt injection', () => {
    const section = buildProfileMetricSemanticsSection(
      null,
      {
        profile: {
          version: 2,
          source_mode: 'hybrid',
          window: {
            lookback_days: 180,
            sample_matches: 22,
            sample_home_matches: 11,
            sample_away_matches: 11,
            event_summary_matches: 17,
            event_coverage: 0.773,
            top_league_only: true,
            computed_at: '2026-04-01T00:00:00Z',
            updated_at: '2026-04-01T00:00:00Z',
          },
          quantitative_core: {
            set_piece_threat: 'medium',
            home_strength: 'strong',
            form_consistency: 'consistent',
            avg_goals_scored: 1.64,
            avg_goals_conceded: 0.91,
            clean_sheet_rate: 0.36,
            btts_rate: 0.45,
            over_2_5_rate: 0.5,
            avg_corners_for: 5.7,
            avg_corners_against: 4.1,
            avg_cards: 2,
            first_goal_rate: 0.59,
            late_goal_rate: 0.34,
            data_reliability_tier: 'high',
          },
          tactical_overlay: {
            attack_style: 'mixed',
            defensive_line: 'medium',
            pressing_intensity: 'medium',
            squad_depth: 'medium',
            source_mode: 'default_neutral',
            source_confidence: null,
            updated_at: null,
          },
        },
      },
      null,
      false,
    );

    expect(section).toContain('PROFILE METRIC SEMANTICS');
    expect(section).toContain('"semantic_name": "team_match_btts_rate"');
    expect(section).toContain('"definition": "Share of this team\'s sampled matches in which both teams scored."');
    expect(section).toContain('Team BTTS / Over / late-goal rates are team-involvement environment metrics');
  });
});
