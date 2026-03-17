// ============================================================
// Recommendation Service Tests
// ============================================================

import { describe, test, expect } from 'vitest';
import { prepareRecommendationData } from '../services/recommendation.service';
import { createMergedMatchData, createParsedAiResponse, createConfig } from './fixtures';

describe('prepareRecommendationData', () => {
  const config = createConfig();

  test('maps all core fields correctly', () => {
    const matchData = createMergedMatchData();
    const parsed = createParsedAiResponse();
    const result = prepareRecommendationData(matchData, parsed, config, 'exec_001');

    expect(result.match_id).toBe('12345');
    expect(result.match_display).toBe('Arsenal vs Chelsea');
    expect(result.league).toBe('Premier League');
    expect(result.home_team).toBe('Arsenal');
    expect(result.away_team).toBe('Chelsea');
    expect(result.minute).toBe(65);
    expect(result.score).toBe('1-0');
    expect(result.status).toBe('2H');
    expect(result.execution_id).toBe('exec_001');
  });

  test('maps AI fields from parsed response', () => {
    const matchData = createMergedMatchData();
    const parsed = createParsedAiResponse({
      selection: 'Over 2.5 @1.85',
      bet_market: 'Over/Under',
      confidence: 7,
      ai_confidence: 7,
      usable_odd: 1.85,
      value_percent: 12,
      risk_level: 'MEDIUM',
      stake_percent: 3,
      reasoning_en: 'Arsenal pressing high',
    });
    const result = prepareRecommendationData(matchData, parsed, config, 'exec_001');

    expect(result.selection).toBe('Over 2.5 @1.85');
    expect(result.bet_market).toBe('Over/Under');
    expect(result.bet_type).toBe('Over/Under');
    expect(result.odds).toBe(1.85);
    expect(result.confidence).toBe(7);
    expect(result.value_percent).toBe(12);
    expect(result.risk_level).toBe('MEDIUM');
    expect(result.stake_percent).toBe(3);
    expect(result.reasoning).toBe('Arsenal pressing high');
  });

  test('generates unique_key from match_id + normalized market (no minute)', () => {
    const matchData = createMergedMatchData();
    const parsed = createParsedAiResponse({ bet_market: 'Over/Under' });
    const result = prepareRecommendationData(matchData, parsed, config, 'exec_001');
    expect(result.unique_key).toBe('12345_over/under');
  });

  test('includes notification channels when should push', () => {
    const matchData = createMergedMatchData();
    const parsed = createParsedAiResponse({ ai_should_push: true, should_push: true });
    const result = prepareRecommendationData(matchData, parsed, config, 'exec_001');
    expect(result.notification_channels).toContain('email');
    expect(result.notification_channels).toContain('telegram');
    expect(result.notified).toBe('pending');
  });

  test('skips notification when not pushing', () => {
    const matchData = createMergedMatchData();
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      should_push: false,
      custom_condition_matched: false,
      condition_triggered_should_push: false,
    });
    const result = prepareRecommendationData(matchData, parsed, config, 'exec_001');
    expect(result.notification_channels).toBe('');
    expect(result.notified).toBe('skipped');
  });

  test('includes stats_snapshot as JSON string', () => {
    const matchData = createMergedMatchData();
    const result = prepareRecommendationData(matchData, createParsedAiResponse(), config, 'exec_001');
    const statsSnapshot = JSON.parse(result.stats_snapshot);
    expect(statsSnapshot.possession).toBeDefined();
  });

  test('includes odds_snapshot as JSON string', () => {
    const matchData = createMergedMatchData();
    const result = prepareRecommendationData(matchData, createParsedAiResponse(), config, 'exec_001');
    const oddsSnapshot = JSON.parse(result.odds_snapshot);
    expect(oddsSnapshot['1x2']).toBeDefined();
  });

  test('includes AI model from config', () => {
    const result = prepareRecommendationData(
      createMergedMatchData(),
      createParsedAiResponse(),
      createConfig({ AI_MODEL: 'claude-sonnet-4-20250514' }),
      'exec_001',
    );
    expect(result.ai_model).toBe('claude-sonnet-4-20250514');
  });

  test('builds key_factors from market_chosen_reason + warnings', () => {
    const parsed = createParsedAiResponse({
      market_chosen_reason: 'attacking momentum',
      warnings: ['ODDS_INVALID', 'STATUS_NOT_LIVE'],
    });
    const result = prepareRecommendationData(createMergedMatchData(), parsed, config, 'exec_001');
    expect(result.key_factors).toContain('attacking momentum');
    expect(result.key_factors).toContain('ODDS_INVALID');
    expect(result.key_factors).toContain('STATUS_NOT_LIVE');
  });

  test('initializes result/pnl fields as empty', () => {
    const result = prepareRecommendationData(
      createMergedMatchData(),
      createParsedAiResponse(),
      config,
      'exec_001',
    );
    expect(result.result).toBe('');
    expect(result.actual_outcome).toBe('');
    expect(result.pnl).toBe(null);
    expect(result.settled_at).toBe('');
  });

  test('handles custom condition notification channels', () => {
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      should_push: false,
      custom_condition_matched: true,
    });
    const result = prepareRecommendationData(createMergedMatchData(), parsed, config, 'exec_001');
    expect(result.notification_channels).toContain('email');
    expect(result.notified).toBe('pending');
  });
});
