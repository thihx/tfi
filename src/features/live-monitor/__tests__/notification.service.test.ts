// ============================================================
// Notification Service Tests (exported test helpers)
// ============================================================

import { describe, test, expect } from 'vitest';
import { _buildEmailHtml, _buildTelegramMessages, _determineSection } from '../services/notification.service';
import { createMergedMatchData, createParsedAiResponse, createConfig } from './fixtures';
import type { RecommendationData } from '../types';

function createRecommendation(overrides?: Partial<RecommendationData>): RecommendationData {
  return {
    unique_key: '12345_OU_65',
    match_id: '12345',
    timestamp: '2026-03-16T20:30:00Z',
    match_display: 'Arsenal vs Chelsea',
    league: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    minute: 65,
    score: '1-0',
    status: '2H',
    bet_type: 'Over/Under',
    selection: 'Over 2.5 @1.85',
    bet_market: 'Over/Under',
    odds: 1.85,
    confidence: 7,
    value_percent: 12,
    risk_level: 'MEDIUM',
    stake_percent: 3,
    reasoning: 'Arsenal pressing high',
    key_factors: 'attacking momentum',
    warnings: '',
    custom_condition_matched: false,
    custom_condition_raw: '',
    condition_triggered_suggestion: '',
    pre_match_prediction_summary: '',
    stats_snapshot: '{}',
    odds_snapshot: '{}',
    ai_model: 'gemini-3-pro-preview',
    mode: 'B',
    notified: 'pending',
    notification_channels: 'email,telegram',
    execution_id: 'exec_001',
    result: '',
    actual_outcome: '',
    pnl: null,
    settled_at: '',
    ...overrides,
  };
}

describe('_determineSection', () => {
  test('returns ai_recommendation when ai_should_push + should_push', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({ ai_should_push: true, should_push: true }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    expect(_determineSection(ctx)).toBe('ai_recommendation');
  });

  test('returns condition_triggered when custom_condition + trigger push', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({
        ai_should_push: false,
        should_push: false,
        custom_condition_matched: true,
        condition_triggered_should_push: true,
      }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    expect(_determineSection(ctx)).toBe('condition_triggered');
  });

  test('returns no_actionable when custom_condition matched but no trigger push', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({
        ai_should_push: false,
        should_push: false,
        custom_condition_matched: true,
        condition_triggered_should_push: false,
      }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    expect(_determineSection(ctx)).toBe('no_actionable');
  });

  test('returns no_actionable when nothing triggers', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({
        ai_should_push: false,
        should_push: false,
        custom_condition_matched: false,
        condition_triggered_should_push: false,
      }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    expect(_determineSection(ctx)).toBe('no_actionable');
  });
});

describe('_buildEmailHtml', () => {
  test('produces HTML with match display', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({ ai_should_push: true, should_push: true }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    const html = _buildEmailHtml(ctx);
    expect(html).toContain('Arsenal vs Chelsea');
    expect(html).toContain('Premier League');
    expect(html).toContain('AI RECOMMENDATION');
  });

  test('includes investment details for ai_recommendation section', () => {
    const ctx = {
      recommendation: createRecommendation({ selection: 'Over 2.5 @1.85', bet_market: 'Over/Under' }),
      parsed: createParsedAiResponse({ ai_should_push: true, should_push: true }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    const html = _buildEmailHtml(ctx);
    expect(html).toContain('Over 2.5 @1.85');
    expect(html).toContain('Over/Under');
    expect(html).toContain('Investment Idea');
  });

  test('includes stats table when stats available', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({ ai_should_push: true, should_push: true }),
      matchData: createMergedMatchData({ stats_available: true }),
      config: createConfig(),
    };
    const html = _buildEmailHtml(ctx);
    expect(html).toContain('Live Stats');
  });

  test('includes events when present', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({ ai_should_push: true, should_push: true }),
      matchData: createMergedMatchData({
        events_compact: [
          { minute: 23, extra: null, team: 'Arsenal', type: 'Goal', detail: 'Normal Goal', player: 'Saka' },
          { minute: 45, extra: 2, team: 'Chelsea', type: 'Card', detail: 'Yellow Card', player: 'Palmer' },
        ],
      }),
      config: createConfig(),
    };
    const html = _buildEmailHtml(ctx);
    expect(html).toContain('Events');
    expect(html).toContain('Saka');
    expect(html).toContain('45+2');
  });

  test('shows custom condition section when matched', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({
        ai_should_push: false,
        should_push: false,
        custom_condition_matched: true,
        custom_condition_status: 'evaluated',
        custom_condition_summary_en: 'BTTS check passed',
        condition_triggered_should_push: true,
      }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    const html = _buildEmailHtml(ctx);
    expect(html).toContain('CONDITION TRIGGERED');
    expect(html).toContain('Custom Condition');
    expect(html).toContain('BTTS check passed');
  });

  test('escapes HTML special characters', () => {
    const ctx = {
      recommendation: createRecommendation({ match_display: '<script>alert("xss")</script>' }),
      parsed: createParsedAiResponse({ ai_should_push: true, should_push: true }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    const html = _buildEmailHtml(ctx);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('includes warnings section when present', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({ warnings: ['ODDS_INVALID', 'MINUTE_TOO_LATE'] }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    const html = _buildEmailHtml(ctx);
    expect(html).toContain('Odds could not be validated');
    expect(html).toContain('MINUTE_TOO_LATE');
  });
});

describe('_buildTelegramMessages', () => {
  test('produces message with match header', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({ ai_should_push: true, should_push: true }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    const msgs = _buildTelegramMessages(ctx);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    const full = msgs.join('');
    expect(full).toContain('Arsenal vs Chelsea');
    expect(full).toContain('AI RECOMMENDATION');
  });

  test('chunks messages at 3500 chars', () => {
    const longReasoning = 'A'.repeat(4000);
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({
        ai_should_push: true,
        should_push: true,
        reasoning_en: longReasoning,
      }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    const msgs = _buildTelegramMessages(ctx);
    expect(msgs.length).toBeGreaterThan(1);
    for (const msg of msgs) {
      expect(msg.length).toBeLessThanOrEqual(3600); // some tolerance for splitting
    }
  });

  test('includes investment details for ai_recommendation', () => {
    const ctx = {
      recommendation: createRecommendation({ selection: 'Over 2.5 @1.85', bet_market: 'Over/Under' }),
      parsed: createParsedAiResponse({ ai_should_push: true, should_push: true }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    const msgs = _buildTelegramMessages(ctx);
    const full = msgs.join('');
    expect(full).toContain('Over 2.5 @1.85');
    expect(full).toContain('Investment Idea');
  });

  test('shows condition triggered section', () => {
    const ctx = {
      recommendation: createRecommendation(),
      parsed: createParsedAiResponse({
        ai_should_push: false,
        should_push: false,
        custom_condition_matched: true,
        condition_triggered_should_push: true,
        custom_condition_summary_en: 'Corner check passed',
      }),
      matchData: createMergedMatchData(),
      config: createConfig(),
    };
    const msgs = _buildTelegramMessages(ctx);
    const full = msgs.join('');
    expect(full).toContain('CONDITION TRIGGERED');
    expect(full).toContain('Corner check passed');
  });
});
