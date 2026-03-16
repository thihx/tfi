// ============================================================
// AI Analysis Service Tests
// (parseAiResponse + extractJsonString logic)
// ============================================================

import { describe, test, expect } from 'vitest';
import { parseAiResponse } from '../services/ai-analysis.service';
import { createMergedMatchData, createConfig } from './fixtures';

const config = createConfig();

describe('parseAiResponse', () => {
  // ==================== JSON extraction ====================

  test('parses JSON from markdown code fence', () => {
    const response = '```json\n{"should_push": true, "selection": "Over 2.5 @1.85", "bet_market": "OU", "confidence": 7, "reasoning_en": "test", "reasoning_vi": "test", "warnings": [], "value_percent": 10, "risk_level": "MEDIUM", "stake_percent": 3, "market_chosen_reason": "good"}\n```';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);

    expect(result.ai_selection).toBe('Over 2.5 @1.85');
    expect(result.ai_confidence).toBe(7);
    expect(result.ai_should_push).toBe(true);
  });

  test('parses JSON from generic code fence', () => {
    const response = '```\n{"should_push": true, "selection": "Home Win @2.10", "bet_market": "1x2", "confidence": 8, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 5, "risk_level": "LOW", "stake_percent": 2, "market_chosen_reason": "r"}\n```';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.ai_selection).toBe('Home Win @2.10');
  });

  test('parses raw JSON object (no fence)', () => {
    const response = 'Here is my analysis: {"should_push": false, "selection": "", "bet_market": "", "confidence": 0, "reasoning_en": "No bet opportunity", "reasoning_vi": "Không có cơ hội", "warnings": [], "value_percent": 0, "risk_level": "HIGH", "stake_percent": 0, "market_chosen_reason": "nothing"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.ai_should_push).toBe(false);
    expect(result.reasoning_en).toBe('No bet opportunity');
  });

  test('returns default result for empty response', () => {
    const data = createMergedMatchData();
    const result = parseAiResponse('', data, config);
    expect(result.should_push).toBe(false);
    expect(result.warnings).toContain('PARSE_ERROR');
  });

  test('returns default result for invalid JSON', () => {
    const data = createMergedMatchData();
    const result = parseAiResponse('This is not JSON at all', data, config);
    expect(result.warnings).toContain('JSON_PARSE_ERROR');
  });

  // ==================== Confidence normalization ====================

  test('normalizes confidence > 10 to 0-10 scale', () => {
    const response = '{"should_push": true, "selection": "Over 2.5", "bet_market": "OU", "confidence": 75, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 5, "risk_level": "MEDIUM", "stake_percent": 2, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.ai_confidence).toBe(8); // 75/10 rounded
  });

  // ==================== Odds extraction ====================

  test('extracts odds from @ notation in selection', () => {
    const response = '{"should_push": true, "selection": "Over 2.5 @1.85", "bet_market": "OU", "confidence": 7, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 10, "risk_level": "MEDIUM", "stake_percent": 3, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.mapped_odd).toBe(1.85);
  });

  test('extracts odds from canonical market (home win)', () => {
    const response = '{"should_push": true, "selection": "Home Win", "bet_market": "1x2", "confidence": 7, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 10, "risk_level": "MEDIUM", "stake_percent": 3, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.mapped_odd).toBe(2.1);
  });

  test('extracts odds for BTTS Yes', () => {
    const response = '{"should_push": true, "selection": "BTTS Yes", "bet_market": "btts", "confidence": 6, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 8, "risk_level": "MEDIUM", "stake_percent": 2, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.mapped_odd).toBe(1.75);
  });

  // ==================== Safety checks ====================

  test('adds NO_SELECTION when should_push=true but no selection', () => {
    const response = '{"should_push": true, "selection": "", "bet_market": "OU", "confidence": 7, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 5, "risk_level": "MEDIUM", "stake_percent": 2, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.ai_warnings).toContain('NO_SELECTION');
    expect(result.system_should_bet).toBe(false);
  });

  test('adds NO_CONFIDENCE when should_push=true but confidence=0', () => {
    const response = '{"should_push": true, "selection": "Over 2.5 @1.85", "bet_market": "OU", "confidence": 0, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 5, "risk_level": "MEDIUM", "stake_percent": 2, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.ai_warnings).toContain('NO_CONFIDENCE');
  });

  test('adds CONFIDENCE_BELOW_MIN when below threshold', () => {
    const response = '{"should_push": true, "selection": "Over 2.5 @1.85", "bet_market": "OU", "confidence": 3, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 5, "risk_level": "MEDIUM", "stake_percent": 2, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, { ...config, MIN_CONFIDENCE: 5 });
    expect(result.ai_warnings).toContain('CONFIDENCE_BELOW_MIN');
  });

  test('adds STATUS_NOT_LIVE for HT match', () => {
    const response = '{"should_push": true, "selection": "Over 2.5 @1.85", "bet_market": "OU", "confidence": 7, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 5, "risk_level": "MEDIUM", "stake_percent": 2, "market_chosen_reason": "r"}';
    const data = createMergedMatchData({ status: 'HT' });
    const result = parseAiResponse(response, data, config);
    expect(result.ai_warnings).toContain('STATUS_NOT_LIVE');
  });

  test('adds MINUTE_TOO_EARLY for minute < 5', () => {
    const response = '{"should_push": false, "selection": "", "bet_market": "", "confidence": 0, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 0, "risk_level": "HIGH", "stake_percent": 0, "market_chosen_reason": "r"}';
    const data = createMergedMatchData({ minute: 3 });
    const result = parseAiResponse(response, data, config);
    expect(result.ai_warnings).toContain('MINUTE_TOO_EARLY');
  });

  test('adds MINUTE_TOO_LATE for minute >= 90', () => {
    const response = '{"should_push": false, "selection": "", "bet_market": "", "confidence": 0, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 0, "risk_level": "HIGH", "stake_percent": 0, "market_chosen_reason": "r"}';
    const data = createMergedMatchData({ minute: 91 });
    const result = parseAiResponse(response, data, config);
    expect(result.ai_warnings).toContain('MINUTE_TOO_LATE');
  });

  test('adds ODDS_NOT_AVAILABLE when odds unavailable', () => {
    const response = '{"should_push": true, "selection": "Over 2.5", "bet_market": "OU", "confidence": 7, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 5, "risk_level": "MEDIUM", "stake_percent": 2, "market_chosen_reason": "r"}';
    const data = createMergedMatchData({ odds_available: false, odds_canonical: {} });
    const result = parseAiResponse(response, data, config);
    expect(result.ai_warnings).toContain('ODDS_NOT_AVAILABLE');
  });

  // ==================== system/final should bet ====================

  test('system_should_bet is true when push=true and no blocking warnings', () => {
    const response = '{"should_push": true, "selection": "Over 2.5 @1.85", "bet_market": "OU", "confidence": 7, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 10, "risk_level": "MEDIUM", "stake_percent": 3, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.system_should_bet).toBe(true);
    expect(result.final_should_bet).toBe(true);
    expect(result.usable_odd).toBe(1.85);
  });

  test('usable_odd is null when below MIN_ODDS', () => {
    const response = '{"should_push": true, "selection": "Draw @1.2", "bet_market": "1x2", "confidence": 7, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 5, "risk_level": "MEDIUM", "stake_percent": 2, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, { ...config, MIN_ODDS: 1.5 });
    expect(result.usable_odd).toBe(null);
  });

  // ==================== Custom condition handling ====================

  test('handles custom condition matched with evaluated status', () => {
    const response = '{"should_push": false, "selection": "", "bet_market": "", "confidence": 3, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 0, "risk_level": "HIGH", "stake_percent": 0, "market_chosen_reason": "", "custom_condition_matched": true, "custom_condition_status": "evaluated", "custom_condition_summary_en": "BTTS condition met", "custom_condition_summary_vi": "Điều kiện BTTS", "custom_condition_reason_en": "Both teams scored", "custom_condition_reason_vi": "Cả hai đội ghi bàn", "condition_triggered_suggestion": "BTTS Yes @1.75", "condition_triggered_reasoning_en": "both teams pressing", "condition_triggered_reasoning_vi": "cả 2 đội pressing", "condition_triggered_confidence": 7, "condition_triggered_stake": 3}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.custom_condition_matched).toBe(true);
    expect(result.custom_condition_status).toBe('evaluated');
    expect(result.condition_triggered_should_push).toBe(true);
    expect(result.condition_triggered_suggestion).toBe('BTTS Yes @1.75');
  });

  test('condition_triggered_should_push is false when confidence below MIN', () => {
    const response = '{"should_push": false, "selection": "", "bet_market": "", "confidence": 0, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 0, "risk_level": "HIGH", "stake_percent": 0, "market_chosen_reason": "", "custom_condition_matched": true, "custom_condition_status": "evaluated", "condition_triggered_suggestion": "Over 2.5", "condition_triggered_confidence": 3, "condition_triggered_stake": 2}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, { ...config, MIN_CONFIDENCE: 5 });
    expect(result.condition_triggered_should_push).toBe(false);
  });

  test('condition_triggered_should_push is false for "no bet" suggestion', () => {
    const response = '{"should_push": false, "selection": "", "bet_market": "", "confidence": 0, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 0, "risk_level": "HIGH", "stake_percent": 0, "market_chosen_reason": "", "custom_condition_matched": true, "custom_condition_status": "evaluated", "condition_triggered_suggestion": "No bet - insufficient data", "condition_triggered_confidence": 7, "condition_triggered_stake": 0}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.condition_triggered_should_push).toBe(false);
  });

  // ==================== Risk level normalization ====================

  test('defaults risk_level to HIGH for unknown values', () => {
    const response = '{"should_push": false, "selection": "", "bet_market": "", "confidence": 0, "reasoning_en": "r", "reasoning_vi": "r", "warnings": [], "value_percent": 0, "risk_level": "EXTREME", "stake_percent": 0, "market_chosen_reason": "r"}';
    const data = createMergedMatchData();
    const result = parseAiResponse(response, data, config);
    expect(result.risk_level).toBe('HIGH');
  });

  // ==================== Anthropic/Gemini response formats ====================

  test('handles non-string response (type object safety)', () => {
    // The function signature takes string but should handle edge case
    const data = createMergedMatchData();
    const result = parseAiResponse(null as unknown as string, data, config);
    expect(result.should_push).toBe(false);
    expect(result.warnings).toContain('PARSE_ERROR');
  });
});
