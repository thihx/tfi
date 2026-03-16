// ============================================================
// AI Prompt Context Tests — Phase 3
// Tests for context-aware prompt generation
// ============================================================

import { describe, test, expect } from 'vitest';
import { buildAiPrompt } from '../services/ai-prompt.service';
import { createMergedMatchData } from './fixtures';
import type { AiPromptContext } from '../types';

describe('buildAiPrompt — context sections', () => {
  test('includes PREVIOUS RECOMMENDATIONS section when context has recommendations', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [
        {
          minute: 55,
          selection: 'Over 2.5 @1.90',
          bet_market: 'over_2.5',
          confidence: 7,
          odds: 1.90,
          reasoning: 'Both teams pressing high, 6 shots on target combined.',
          result: '',
          timestamp: '2026-03-17T10:00:00Z',
        },
      ],
      matchTimeline: [],
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('PREVIOUS RECOMMENDATIONS FOR THIS MATCH (1)');
    expect(prompt).toContain('[Min 55]');
    expect(prompt).toContain('Over 2.5 @1.90');
    expect(prompt).toContain('Conf: 7/10');
    expect(prompt).toContain('Odds: 1.9');
    expect(prompt).toContain('Both teams pressing high');
    expect(prompt).toContain('Do NOT repeat the exact same selection');
  });

  test('includes multiple previous recommendations', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [
        {
          minute: 55,
          selection: 'Over 2.5 @1.90',
          bet_market: 'over_2.5',
          confidence: 7,
          odds: 1.90,
          reasoning: 'Pressing high',
          result: '',
          timestamp: '2026-03-17T10:00:00Z',
        },
        {
          minute: 40,
          selection: 'BTTS Yes @1.75',
          bet_market: 'btts_yes',
          confidence: 6,
          odds: 1.75,
          reasoning: 'Both teams create chances',
          result: 'win',
          timestamp: '2026-03-17T09:45:00Z',
        },
      ],
      matchTimeline: [],
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('PREVIOUS RECOMMENDATIONS FOR THIS MATCH (2)');
    expect(prompt).toContain('[Min 55]');
    expect(prompt).toContain('[Min 40]');
    expect(prompt).toContain('Result: win');
  });

  test('includes MATCH PROGRESSION TIMELINE section when context has snapshots', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [
        {
          minute: 15,
          score: '0-0',
          possession: '55-45',
          shots: '3-1',
          shots_on_target: '1-0',
          corners: '2-1',
          status: '1H',
        },
        {
          minute: 30,
          score: '1-0',
          possession: '60-40',
          shots: '6-3',
          shots_on_target: '3-1',
          corners: '4-2',
          status: '1H',
        },
        {
          minute: 60,
          score: '1-0',
          possession: '55-45',
          shots: '8-5',
          shots_on_target: '4-2',
          corners: '5-3',
          status: '2H',
        },
      ],
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('MATCH PROGRESSION TIMELINE (3 snapshots)');
    expect(prompt).toContain('Min 15: 0-0');
    expect(prompt).toContain('Min 30: 1-0');
    expect(prompt).toContain('Min 60: 1-0');
    expect(prompt).toContain('Poss: 55-45');
    expect(prompt).toContain('Shots: 6-3');
    expect(prompt).toContain('momentum shifts');
  });

  test('includes ANALYSIS CONTINUITY RULES when previous recommendations exist', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [
        {
          minute: 55,
          selection: 'Over 2.5 @1.90',
          bet_market: 'over_2.5',
          confidence: 7,
          odds: 1.90,
          reasoning: 'Pressing high',
          result: '',
          timestamp: '2026-03-17T10:00:00Z',
        },
      ],
      matchTimeline: [],
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('ANALYSIS CONTINUITY RULES (CRITICAL)');
    expect(prompt).toContain('REFERENCE: Acknowledge your previous recommendation');
    expect(prompt).toContain('NO DUPLICATE');
    expect(prompt).toContain('CHAIN OF THOUGHT');
  });

  test('does NOT include context sections when context is undefined', () => {
    const data = createMergedMatchData();

    const prompt = buildAiPrompt(data);

    expect(prompt).not.toContain('PREVIOUS RECOMMENDATIONS');
    expect(prompt).not.toContain('MATCH PROGRESSION TIMELINE');
    expect(prompt).not.toContain('ANALYSIS CONTINUITY RULES');
  });

  test('does NOT include context sections when context is empty', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).not.toContain('PREVIOUS RECOMMENDATIONS');
    expect(prompt).not.toContain('MATCH PROGRESSION TIMELINE');
    expect(prompt).not.toContain('ANALYSIS CONTINUITY RULES');
  });

  test('truncates long reasoning in previous recommendation', () => {
    const data = createMergedMatchData();
    const longReasoning = 'A'.repeat(300);
    const context: AiPromptContext = {
      previousRecommendations: [
        {
          minute: 55,
          selection: 'Over 2.5 @1.90',
          bet_market: 'over_2.5',
          confidence: 7,
          odds: 1.90,
          reasoning: longReasoning,
          result: '',
          timestamp: '2026-03-17T10:00:00Z',
        },
      ],
      matchTimeline: [],
    };

    const prompt = buildAiPrompt(data, context);

    // Reasoning should be truncated to 150 chars
    expect(prompt).toContain('A'.repeat(150));
    expect(prompt).not.toContain('A'.repeat(200));
  });

  test('handles null odds and minute in previous recommendation', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [
        {
          minute: null,
          selection: '',
          bet_market: '',
          confidence: null,
          odds: null,
          reasoning: '',
          result: '',
          timestamp: '',
        },
      ],
      matchTimeline: [],
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('[Min ?]');
    expect(prompt).toContain('Conf: 0/10');
    expect(prompt).toContain('Odds: N/A');
  });

  test('still includes standard sections alongside context', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [
        {
          minute: 55,
          selection: 'Over 2.5 @1.90',
          bet_market: 'over_2.5',
          confidence: 7,
          odds: 1.90,
          reasoning: 'Pressing',
          result: '',
          timestamp: '',
        },
      ],
      matchTimeline: [
        {
          minute: 30,
          score: '1-0',
          possession: '60-40',
          shots: '5-2',
          shots_on_target: '3-1',
          corners: '3-2',
          status: '1H',
        },
      ],
    };

    const prompt = buildAiPrompt(data, context);

    // Standard sections still present
    expect(prompt).toContain('DEFINITIONS & THRESHOLDS');
    expect(prompt).toContain('MATCH CONTEXT');
    expect(prompt).toContain('LIVE STATS');
    expect(prompt).toContain('LIVE ODDS SNAPSHOT');
    expect(prompt).toContain('RECENT EVENTS');
    expect(prompt).toContain('LIVE DATA INTERPRETATION FRAMEWORK');
    expect(prompt).toContain('GLOBAL RULES');
    // New context sections present
    expect(prompt).toContain('PREVIOUS RECOMMENDATIONS');
    expect(prompt).toContain('MATCH PROGRESSION TIMELINE');
    expect(prompt).toContain('ANALYSIS CONTINUITY RULES');
  });
});
