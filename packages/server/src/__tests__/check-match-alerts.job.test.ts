import { describe, expect, it } from 'vitest';
import { shouldAdjudicateMatchAlertWithLlm } from '../jobs/check-match-alerts.job.js';
import type { MatchAlertEvaluationResult } from '../lib/match-alert-rule-engine.js';

function evaluation(severity: MatchAlertEvaluationResult['severity']): MatchAlertEvaluationResult {
  return {
    matched: true,
    supported: true,
    triggerKey: `signal:100:${severity}`,
    summaryEn: 'Signal matched.',
    summaryVi: 'Signal matched.',
    severity,
    suggestedAction: 'review_live_market',
    facts: {},
  };
}

describe('check match alerts job', () => {
  it('skips LLM adjudication for high-severity deterministic condition alerts', () => {
    expect(shouldAdjudicateMatchAlertWithLlm(
      { alertKind: 'condition_signal' },
      evaluation('high'),
      true,
    )).toBe(false);
  });

  it('allows LLM adjudication for medium condition alerts when enabled', () => {
    expect(shouldAdjudicateMatchAlertWithLlm(
      { alertKind: 'condition_signal', source: 'favorite_team' },
      evaluation('medium'),
      true,
    )).toBe(true);
  });

  it('does not adjudicate explicit manual or preset condition alerts', () => {
    expect(shouldAdjudicateMatchAlertWithLlm(
      { alertKind: 'condition_signal', source: 'manual:free_text' },
      evaluation('medium'),
      true,
    )).toBe(false);
    expect(shouldAdjudicateMatchAlertWithLlm(
      { alertKind: 'condition_signal', source: 'preset:red_card' },
      evaluation('medium'),
      true,
    )).toBe(false);
  });

  it('does not adjudicate kickoff alerts or disabled LLM config', () => {
    expect(shouldAdjudicateMatchAlertWithLlm(
      { alertKind: 'match_start' },
      evaluation('medium'),
      true,
    )).toBe(false);
    expect(shouldAdjudicateMatchAlertWithLlm(
      { alertKind: 'condition_signal' },
      evaluation('medium'),
      false,
    )).toBe(false);
  });
});
