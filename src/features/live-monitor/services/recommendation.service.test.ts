// ============================================================
// Tests — recommendation.service prepareRecommendationData
// ============================================================

import { describe, test, expect } from 'vitest';
import { prepareRecommendationData } from './recommendation.service';
import type { LiveMonitorConfig, MergedMatchData, ParsedAiResponse } from '../types';

function makeMatchData(overrides: Partial<MergedMatchData> = {}): MergedMatchData {
  return {
    match_id: '12345',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    league: 'Premier League',
    status: '2H',
    minute: 60,
    score: '1-0',
    match: {
      id: '12345',
      home: 'Arsenal',
      away: 'Chelsea',
      league: 'Premier League',
      minute: '60',
      score: '1-0',
      status: '2H',
    },
    stats_compact: {},
    odds_canonical: {},
    custom_conditions: '',
    pre_match_prediction_summary: '',
    mode: 'auto',
    ...overrides,
  } as MergedMatchData;
}

function makeParsed(overrides: Partial<ParsedAiResponse> = {}): ParsedAiResponse {
  return {
    should_bet: true,
    ai_selection: 'Over 2.5',
    bet_market: 'over_2.5',
    confidence: 8,
    value_percent: 15,
    risk_level: 'LOW',
    stake_percent: 3,
    reasoning_en: 'Good match for goals',
    market_chosen_reason: 'Both teams attacking',
    warnings: [],
    usable_odd: 1.85,
    mapped_odd: 1.80,
    should_push: false,
    ai_should_push: false,
    custom_condition_matched: false,
    condition_triggered_suggestion: '',
    selection: 'Over 2.5',
    ...overrides,
  } as ParsedAiResponse;
}

const config: LiveMonitorConfig = {
  AI_MODEL: 'gemini-3.0-flash',
} as LiveMonitorConfig;

describe('prepareRecommendationData', () => {
  test('generates dedup key without minute (matchId_normalizedMarket)', () => {
    const data = prepareRecommendationData(
      makeMatchData({ match_id: '12345' }),
      makeParsed({ ai_selection: 'Over 2.5', bet_market: 'over_2.5' }),
      config,
      'exec1',
    );
    expect(data.unique_key).toBe('12345_over_2.5');
  });

  test('same match + same market at different minutes produce same key', () => {
    const data1 = prepareRecommendationData(
      makeMatchData({ match_id: '12345', minute: 30, match: { id: '12345', home: 'A', away: 'B', league: 'L', minute: '30', score: '0-0', status: '1H' } }),
      makeParsed({ ai_selection: 'Over 2.5', bet_market: 'over_2.5' }),
      config,
      'exec1',
    );
    const data2 = prepareRecommendationData(
      makeMatchData({ match_id: '12345', minute: 60, match: { id: '12345', home: 'A', away: 'B', league: 'L', minute: '60', score: '1-0', status: '2H' } }),
      makeParsed({ ai_selection: 'Over 2.5', bet_market: 'over_2.5' }),
      config,
      'exec2',
    );
    expect(data1.unique_key).toBe(data2.unique_key);
  });

  test('same match + different markets produce different keys', () => {
    const data1 = prepareRecommendationData(
      makeMatchData({ match_id: '12345' }),
      makeParsed({ ai_selection: 'Over 2.5', bet_market: 'over_2.5' }),
      config,
      'exec1',
    );
    const data2 = prepareRecommendationData(
      makeMatchData({ match_id: '12345' }),
      makeParsed({ ai_selection: 'BTTS (Yes)', bet_market: 'btts_yes' }),
      config,
      'exec2',
    );
    expect(data1.unique_key).not.toBe(data2.unique_key);
  });

  test('derives market from selection when bet_market is empty', () => {
    const data = prepareRecommendationData(
      makeMatchData({ match_id: '12345' }),
      makeParsed({ ai_selection: 'Home Win', bet_market: '' }),
      config,
      'exec1',
    );
    expect(data.unique_key).toBe('12345_1x2_home');
  });

  test('derives BTTS from selection text', () => {
    const data = prepareRecommendationData(
      makeMatchData({ match_id: '12345' }),
      makeParsed({ ai_selection: 'BTTS (Yes) @ 1.75', bet_market: '' }),
      config,
      'exec1',
    );
    expect(data.unique_key).toBe('12345_btts_yes');
  });

  test('derives Draw from selection text', () => {
    const data = prepareRecommendationData(
      makeMatchData({ match_id: '12345' }),
      makeParsed({ ai_selection: 'Draw @ 3.20', bet_market: '' }),
      config,
      'exec1',
    );
    expect(data.unique_key).toBe('12345_1x2_draw');
  });

  test('never emits legacy bet_type=none for non-actionable results', () => {
    const data = prepareRecommendationData(
      makeMatchData({ match_id: '12345' }),
      makeParsed({
        ai_selection: '',
        selection: '',
        bet_market: '',
        usable_odd: null,
        mapped_odd: null,
        ai_confidence: 0,
        confidence: 0,
        stake_percent: 0,
      }),
      config,
      'exec1',
    );
    expect(data.bet_type).toBe('NO_BET');
  });
});
