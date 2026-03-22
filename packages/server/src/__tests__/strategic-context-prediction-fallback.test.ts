import { describe, expect, test } from 'vitest';
import { mergeStrategicContextWithPredictionFallback } from '../lib/strategic-context-prediction-fallback.js';

describe('strategic-context-prediction-fallback', () => {
  test('creates a usable fallback shell when grounded context is completely missing', () => {
    const merged = mergeStrategicContextWithPredictionFallback(
      null,
      {
        homeTeam: 'NEC Nijmegen',
        awayTeam: 'Heerenveen',
        prediction: {
          predictions: {
            advice: 'Winner : NEC Nijmegen',
            winner: { name: 'NEC Nijmegen' },
          },
          team_form: {
            home: 'WWDLW',
            away: 'LDWLL',
          },
          h2h_summary: {
            total: 5,
            home_wins: 2,
            away_wins: 2,
            draws: 1,
          },
        },
      },
    );

    expect(merged.summary).toContain('Pre-match model leans NEC Nijmegen.');
    expect(merged.h2h_narrative).toContain('Last 5 H2H');
    expect(merged.quantitative.home_last5_points).toBe(10);
    expect(merged.quantitative.away_last5_points).toBe(4);
    expect(merged.source_meta.prediction_fallback_used).toBe(true);
  });

  test('fills missing summary, h2h, and last5 points from deterministic prediction packet', () => {
    const merged = mergeStrategicContextWithPredictionFallback(
      {
        home_motivation: 'No data found',
        away_motivation: 'No data found',
        league_positions: 'No data found',
        fixture_congestion: 'No data found',
        rotation_risk: 'No data found',
        key_absences: 'No data found',
        h2h_narrative: 'No data found',
        summary: 'No data found',
        home_motivation_vi: 'Khong tim thay du lieu',
        away_motivation_vi: 'Khong tim thay du lieu',
        league_positions_vi: 'Khong tim thay du lieu',
        fixture_congestion_vi: 'Khong tim thay du lieu',
        rotation_risk_vi: 'Khong tim thay du lieu',
        key_absences_vi: 'Khong tim thay du lieu',
        h2h_narrative_vi: 'Khong tim thay du lieu',
        summary_vi: 'Khong tim thay du lieu',
        searched_at: new Date().toISOString(),
        version: 2,
        competition_type: 'domestic_league',
        ai_condition: '',
        ai_condition_blueprint: null,
        ai_condition_reason: '',
        ai_condition_reason_vi: '',
        qualitative: {
          en: {
            home_motivation: 'No data found',
            away_motivation: 'No data found',
            league_positions: 'No data found',
            fixture_congestion: 'No data found',
            rotation_risk: 'No data found',
            key_absences: 'No data found',
            h2h_narrative: 'No data found',
            summary: 'No data found',
          },
          vi: {
            home_motivation: 'Khong tim thay du lieu',
            away_motivation: 'Khong tim thay du lieu',
            league_positions: 'Khong tim thay du lieu',
            fixture_congestion: 'Khong tim thay du lieu',
            rotation_risk: 'Khong tim thay du lieu',
            key_absences: 'Khong tim thay du lieu',
            h2h_narrative: 'Khong tim thay du lieu',
            summary: 'Khong tim thay du lieu',
          },
        },
        quantitative: {
          home_last5_points: null,
          away_last5_points: null,
          home_last5_goals_for: null,
          away_last5_goals_for: null,
          home_last5_goals_against: null,
          away_last5_goals_against: null,
          home_home_goals_avg: null,
          away_away_goals_avg: null,
          home_over_2_5_rate_last10: null,
          away_over_2_5_rate_last10: null,
          home_btts_rate_last10: null,
          away_btts_rate_last10: null,
          home_clean_sheet_rate_last10: null,
          away_clean_sheet_rate_last10: null,
          home_failed_to_score_rate_last10: null,
          away_failed_to_score_rate_last10: null,
        },
        source_meta: {
          search_quality: 'low',
          web_search_queries: [],
          sources: [],
          trusted_source_count: 1,
          rejected_source_count: 0,
          rejected_domains: [],
        },
      },
      {
        homeTeam: 'Barcelona',
        awayTeam: 'Rayo Vallecano',
        prediction: {
          predictions: {
            advice: 'Winner : Barcelona',
            winner: { name: 'Barcelona' },
          },
          team_form: {
            home: 'WWDWW',
            away: 'WLDLD',
          },
          h2h_summary: {
            total: 5,
            home_wins: 3,
            away_wins: 0,
            draws: 2,
          },
        },
      },
    );

    expect(merged.summary).toContain('Pre-match model leans Barcelona.');
    expect(merged.h2h_narrative).toContain('Last 5 H2H');
    expect(merged.quantitative.home_last5_points).toBe(13);
    expect(merged.quantitative.away_last5_points).toBe(5);
  });
});
