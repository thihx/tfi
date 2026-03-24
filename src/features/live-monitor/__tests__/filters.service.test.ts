// ============================================================
// Filters Service Tests
// ============================================================

import { describe, test, expect } from 'vitest';
import { checkShouldProceed, shouldPush, shouldSave } from '../services/filters.service';
import { createMergedMatchData, createConfig, createParsedAiResponse } from './fixtures';

describe('checkShouldProceed', () => {
  const config = createConfig();

  test('allows a live 2H match within minute window', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 65, score: '1-0', status: '2H' },
      stats: { possession: '55% - 45%', shots: '8-5', shots_on_target: '4-2', corners: '5-3', fouls: '10-12' },
    });
    const result = checkShouldProceed(data, config);

    expect(result.should_proceed).toBe(true);
    expect(result.proceed_reason).toBe('LIVE_IN_WINDOW');
    expect(result.stats_available).toBe(true);
  });

  test('rejects non-live status (HT)', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 45, score: '1-0', status: 'HT' },
    });
    const result = checkShouldProceed(data, config);
    expect(result.should_proceed).toBe(false);
    expect(result.proceed_reason).toContain('not live');
  });

  test('rejects non-live status (FT)', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 90, score: '2-1', status: 'FT' },
    });
    const result = checkShouldProceed(data, config);
    expect(result.should_proceed).toBe(false);
  });

  test('rejects match below MIN_MINUTE', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 3, score: '0-0', status: '1H' },
    });
    const result = checkShouldProceed(data, config);
    expect(result.should_proceed).toBe(false);
    expect(result.proceed_reason).toContain('below minimum');
  });

  test('rejects match above MAX_MINUTE', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 88, score: '1-1', status: '2H' },
    });
    const result = checkShouldProceed(data, config);
    expect(result.should_proceed).toBe(false);
    expect(result.proceed_reason).toContain('beyond maximum');
  });

  test('applies 2H second-half threshold (minute 45 + SECOND_HALF_START_MINUTE)', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 47, score: '0-0', status: '2H' },
    });
    const result = checkShouldProceed(data, { ...config, SECOND_HALF_START_MINUTE: 5 });
    expect(result.should_proceed).toBe(false);
    expect(result.proceed_reason).toContain('below minimum');
  });

  test('allows 2H after second-half threshold', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 52, score: '0-0', status: '2H' },
    });
    const result = checkShouldProceed(data, { ...config, SECOND_HALF_START_MINUTE: 5 });
    expect(result.should_proceed).toBe(true);
  });

  test('force_analyze bypasses all filters', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 2, score: '0-0', status: 'HT' },
      force_analyze: true,
    });
    const result = checkShouldProceed(data, config);
    expect(result.should_proceed).toBe(true);
    expect(result.proceed_reason).toBe('FORCE_ANALYZE');
    expect(result.skipped_filters.length).toBeGreaterThan(0);
  });

  test('rejects early game with poor stats', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 10, score: '0-0', status: '1H' },
      stats: { possession: '-', shots: '-', shots_on_target: '-', corners: '-', fouls: '-' },
    });
    const result = checkShouldProceed(data, config);
    expect(result.should_proceed).toBe(false);
    expect(result.proceed_reason).toContain('poor stats');
  });

  test('calculates stats_quality correctly for GOOD stats', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 60, score: '1-0', status: '2H' },
      stats: { possession: '55-45', shots: '8-5', shots_on_target: '4-2', corners: '5-3', fouls: '10-12' },
    });
    const result = checkShouldProceed(data, config);
    expect(result.stats_meta.stats_quality).toBe('GOOD');
    expect(result.stats_available).toBe(true);
  });

  test('calculates stats_quality correctly for VERY_POOR stats', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 60, score: '0-0', status: '2H' },
      stats: { possession: '-', shots: 'NA', shots_on_target: '-', corners: '-', fouls: '' },
    });
    const result = checkShouldProceed(data, config);
    expect(result.stats_meta.stats_quality).toBe('VERY_POOR');
    expect(result.stats_available).toBe(false);
  });

  test('returns enriched match data with original fields preserved', () => {
    const data = createMergedMatchData({
      match: { id: '1', home: 'A', away: 'B', league: 'L', minute: 65, score: '2-1', status: '2H' },
    });
    const result = checkShouldProceed(data, config);
    expect(result.match_id).toBe('12345');
    expect(result.home_team).toBe('Arsenal');
    expect(result.stats_compact).toBeDefined();
  });
});

describe('shouldPush', () => {
  test('returns true when ai_should_push is true', () => {
    const parsed = createParsedAiResponse({ ai_should_push: true });
    expect(shouldPush(parsed)).toBe(true);
  });

  test('returns false when custom_condition_matched + evaluated but no triggered push', () => {
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
    });
    expect(shouldPush(parsed)).toBe(false);
  });

  test('returns true when condition_triggered_should_push', () => {
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      condition_triggered_should_push: true,
    });
    expect(shouldPush(parsed)).toBe(true);
  });

  test('returns false when nothing triggers', () => {
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      custom_condition_matched: false,
      condition_triggered_should_push: false,
    });
    expect(shouldPush(parsed)).toBe(false);
  });

  test('returns false when custom_condition_matched but status is none', () => {
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      custom_condition_matched: true,
      custom_condition_status: 'none',
    });
    expect(shouldPush(parsed)).toBe(false);
  });
});

describe('shouldSave', () => {
  test('returns true when ai_should_push is true', () => {
    const parsed = createParsedAiResponse({ ai_should_push: true, final_should_bet: true });
    expect(shouldSave(parsed)).toBe(true);
  });

  test('returns false when ai_should_push is false and no conditions', () => {
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      final_should_bet: false,
      custom_condition_matched: false,
      condition_triggered_should_push: false,
    });
    expect(shouldSave(parsed)).toBe(false);
  });

  test('returns false when custom_condition_matched + evaluated but no triggered push (No Bet not saved)', () => {
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      final_should_bet: false,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
    });
    expect(shouldSave(parsed)).toBe(false);
  });

  test('returns false when condition_triggered_should_push but AI final bet is false', () => {
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      final_should_bet: false,
      condition_triggered_should_push: true,
    });
    expect(shouldSave(parsed)).toBe(false);
  });

  test('returns false when custom_condition_matched but status is none', () => {
    const parsed = createParsedAiResponse({
      ai_should_push: false,
      final_should_bet: false,
      custom_condition_matched: true,
      custom_condition_status: 'none',
    });
    expect(shouldSave(parsed)).toBe(false);
  });

  test('shouldSave is narrower than shouldPush for condition-only triggers', () => {
    const aiPush = createParsedAiResponse({ ai_should_push: true, final_should_bet: true, condition_triggered_should_push: false });
    expect(shouldSave(aiPush)).toBe(true);
    expect(shouldPush(aiPush)).toBe(true);

    const conditionOnly = createParsedAiResponse({ ai_should_push: false, final_should_bet: false, condition_triggered_should_push: true });
    expect(shouldSave(conditionOnly)).toBe(false);
    expect(shouldPush(conditionOnly)).toBe(true);

    const noBet = createParsedAiResponse({ ai_should_push: false, final_should_bet: false, condition_triggered_should_push: false });
    expect(shouldSave(noBet)).toBe(false);
    expect(shouldPush(noBet)).toBe(false);
  });
});
