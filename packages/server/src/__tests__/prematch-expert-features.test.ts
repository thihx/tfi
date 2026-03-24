import { describe, expect, test } from 'vitest';

import {
  buildPrematchExpertFeaturesV1,
  getPrematchPriorStrength,
} from '../lib/prematch-expert-features.js';

describe('buildPrematchExpertFeaturesV1', () => {
  test('derives quantitative prematch signals from league and team profiles without relying on narrative text', () => {
    const features = buildPrematchExpertFeaturesV1({
      leagueProfile: {
        league_id: 39,
        profile: {
          tempo_tier: 'high',
          goal_tendency: 'high',
          home_advantage_tier: 'high',
          corners_tendency: 'high',
          cards_tendency: 'balanced',
          volatility_tier: 'medium',
          data_reliability_tier: 'high',
          avg_goals: 3.05,
          over_2_5_rate: 0.63,
          btts_rate: 0.58,
          late_goal_rate_75_plus: 0.31,
          avg_corners: 10.3,
          avg_cards: 3.9,
        },
        notes_en: '',
        notes_vi: '',
      },
      homeTeamProfile: {
        team_id: '1',
        profile: {
          attack_style: 'direct',
          defensive_line: 'high',
          pressing_intensity: 'high',
          set_piece_threat: 'high',
          home_strength: 'strong',
          form_consistency: 'consistent',
          squad_depth: 'deep',
          avg_goals_scored: 2.0,
          avg_goals_conceded: 0.9,
          clean_sheet_rate: 0.42,
          btts_rate: 0.52,
          over_2_5_rate: 0.61,
          avg_corners_for: 6.4,
          avg_corners_against: 4.2,
          avg_cards: 2.0,
          first_goal_rate: 0.67,
          late_goal_rate: 0.38,
          data_reliability_tier: 'high',
        },
      },
      awayTeamProfile: {
        team_id: '2',
        profile: {
          attack_style: 'counter',
          defensive_line: 'low',
          pressing_intensity: 'medium',
          set_piece_threat: 'medium',
          home_strength: 'normal',
          form_consistency: 'inconsistent',
          squad_depth: 'medium',
          avg_goals_scored: 1.0,
          avg_goals_conceded: 1.7,
          clean_sheet_rate: 0.16,
          btts_rate: 0.62,
          over_2_5_rate: 0.55,
          avg_corners_for: 4.1,
          avg_corners_against: 6.0,
          avg_cards: 2.9,
          first_goal_rate: 0.34,
          late_goal_rate: 0.33,
          data_reliability_tier: 'medium',
        },
      },
      topLeague: true,
    });

    expect(features).not.toBeNull();
    expect(features?.meta.availability).toBe('full');
    expect(features?.meta.top_league).toBe(true);
    expect(features?.market_priors.one_x2_bias_score).not.toBeNull();
    expect(features?.market_priors.totals_bias_score).not.toBeNull();
    expect(features?.goal_environment.projected_goal_environment_score).not.toBeNull();
    expect(features?.squad_situation.net_squad_stability_score).not.toBeNull();
    expect(features?.optional_team_profile?.home_style_matchup_score).not.toBeNull();
    expect(features?.trust_and_coverage.team_profile_fields_present).toBe(36);
    expect(getPrematchPriorStrength(features ?? null)).toBe('strong');
  });

  test('classifies sparse prematch input as weak prior with elevated noise', () => {
    const features = buildPrematchExpertFeaturesV1({
      leagueProfile: {
        league_id: 39,
        profile: {
          tempo_tier: 'balanced',
          goal_tendency: 'balanced',
          home_advantage_tier: 'normal',
          corners_tendency: 'balanced',
          cards_tendency: 'balanced',
          volatility_tier: 'medium',
          data_reliability_tier: 'high',
          avg_goals: 2.8,
          over_2_5_rate: 0.56,
          btts_rate: 0.54,
          late_goal_rate_75_plus: 0.27,
          avg_corners: 9.4,
          avg_cards: 4.1,
        },
      },
    });

    expect(features).not.toBeNull();
    expect(features?.meta.availability).toBe('minimal');
    expect(features?.trust_and_coverage.prematch_noise_penalty).toBe(60);
    expect(getPrematchPriorStrength(features ?? null)).toBe('weak');
  });
});