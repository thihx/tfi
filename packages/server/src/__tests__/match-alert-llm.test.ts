import { describe, expect, it } from 'vitest';
import {
  buildMatchAlertLlmPrompt,
  parseMatchAlertLlmDecision,
  type MatchAlertLlmInput,
} from '../lib/match-alert-llm.js';
import type { MatchAlertRule } from '../repos/match-alert-rules.repo.js';
import type { MatchAlertContext, MatchAlertEvaluationResult } from '../lib/match-alert-rule-engine.js';

const context: MatchAlertContext = {
  matchId: '1001',
  status: '2H',
  minute: 62,
  kickoffAtUtc: '2026-06-05T11:00:00.000Z',
  homeTeam: 'Home FC',
  awayTeam: 'Away FC',
  leagueName: 'Premier League',
  score: {
    home: 1,
    away: 1,
    total: 2,
    state: 'draw',
    leadingSide: null,
    losingSide: null,
  },
  stats: { shots_on_target: { home: 5, away: 4 }, corners: { home: 6, away: 4 } },
  events: { last_goal: { side: 'away', minute: 62, type: 'equalizer' } },
  derived: { corners_total: 10 },
};

const evaluation: MatchAlertEvaluationResult = {
  matched: true,
  supported: true,
  triggerKey: 'equalizer_after_60:1001:62',
  summaryEn: 'Equalizer after 60 matched.',
  summaryVi: 'Equalizer after 60 matched.',
  severity: 'medium',
  suggestedAction: 'review_live_market',
  facts: { minute: 62 },
};

const rule: MatchAlertRule = {
  id: 7,
  userId: 'user-1',
  matchId: '1001',
  alertKind: 'condition_signal',
  enabled: true,
  source: 'preset:equalizer_after_60',
  sourceRef: {},
  ruleJson: { id: 'equalizer_after_60', all: [{ field: 'events.last_goal.type', op: '=', value: 'equalizer' }] },
  compiledStatus: 'compiled',
  cooldownMinutes: 10,
  oncePerMatch: false,
  channelPolicy: {},
  metadata: {},
  createdAt: '2026-06-05T11:00:00.000Z',
  updatedAt: '2026-06-05T11:00:00.000Z',
};

describe('match alert LLM adjudicator', () => {
  it('builds a non-recommendation prompt for fast alert classification', () => {
    const prompt = buildMatchAlertLlmPrompt({ rule, context, evaluation } satisfies MatchAlertLlmInput);
    expect(prompt).toContain('low-latency live football alert classifier');
    expect(prompt).toContain('Do not recommend a bet, market, odds, stake, or bankroll action');
    expect(prompt).toContain('"should_push":true');
    expect(prompt).toContain('"matchId":"1001"');
  });

  it('parses strict JSON decisions from Gemini', () => {
    const parsed = parseMatchAlertLlmDecision(JSON.stringify({
      should_push: true,
      confidence: 84,
      summary_vi: 'Tin hieu dang theo doi.',
      reason_vi: 'The tran vua dao chieu sau ban go hoa.',
      suggested_action: 'ask_ai',
    }), evaluation, 'gemini-2.5-flash-lite');
    expect(parsed).toEqual(expect.objectContaining({
      shouldPush: true,
      confidence: 84,
      summaryVi: 'Tin hieu dang theo doi.',
      reasonVi: 'The tran vua dao chieu sau ban go hoa.',
      suggestedAction: 'ask_ai',
      model: 'gemini-2.5-flash-lite',
    }));
  });

  it('falls back to deterministic summary for sparse but valid JSON', () => {
    const parsed = parseMatchAlertLlmDecision('```json\n{"should_push":false,"confidence":12}\n```', evaluation);
    expect(parsed.shouldPush).toBe(false);
    expect(parsed.summaryVi).toBe(evaluation.summaryVi);
    expect(parsed.reasonVi).toBe(evaluation.summaryVi);
  });
});
