// ============================================================
// AI Prompt Context Tests — Phase 3
// Tests for context-aware prompt generation
// ============================================================

import { describe, test, expect } from 'vitest';
import { buildAiPrompt } from '../services/ai-prompt.service';
import { createMergedMatchData } from './fixtures';
import type { AiPromptContext, HistoricalPerformanceSummary } from '../types';

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
          fouls: '4-3',
          yellow_cards: '0-1',
          red_cards: '0-0',
          goalkeeper_saves: '1-0',
          status: '1H',
        },
        {
          minute: 30,
          score: '1-0',
          possession: '60-40',
          shots: '6-3',
          shots_on_target: '3-1',
          corners: '4-2',
          fouls: '6-5',
          yellow_cards: '1-1',
          red_cards: '0-0',
          goalkeeper_saves: '2-1',
          status: '1H',
        },
        {
          minute: 60,
          score: '1-0',
          possession: '55-45',
          shots: '8-5',
          shots_on_target: '4-2',
          corners: '5-3',
          fouls: '8-7',
          yellow_cards: '1-2',
          red_cards: '0-0',
          goalkeeper_saves: '3-2',
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
          fouls: '5-4',
          yellow_cards: '1-0',
          red_cards: '0-0',
          goalkeeper_saves: '2-1',
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

// ============================================================
// Historical Performance Feedback Loop Tests
// ============================================================

function createHistoricalPerformance(
  overrides?: Partial<HistoricalPerformanceSummary>,
): HistoricalPerformanceSummary {
  return {
    overall: { settled: 50, correct: 30, accuracy: 60 },
    byMarket: [
      { market: 'over_2.5', settled: 20, correct: 14, accuracy: 70 },
      { market: '1x2_home', settled: 15, correct: 6, accuracy: 40 },
      { market: 'btts_yes', settled: 10, correct: 7, accuracy: 70 },
    ],
    byConfidenceBand: [
      { band: '8-10 (high)', settled: 15, correct: 11, accuracy: 73.33 },
      { band: '6-7 (medium)', settled: 25, correct: 14, accuracy: 56 },
      { band: '1-5 (low)', settled: 10, correct: 5, accuracy: 50 },
    ],
    byMinuteBand: [
      { band: '0-29 (early)', settled: 10, correct: 7, accuracy: 70 },
      { band: '30-59 (mid)', settled: 20, correct: 13, accuracy: 65 },
      { band: '60-74 (late)', settled: 12, correct: 6, accuracy: 50 },
      { band: '75+ (endgame)', settled: 8, correct: 3, accuracy: 37.5 },
    ],
    byOddsRange: [
      { range: '1.50-1.69', settled: 15, correct: 10, accuracy: 66.67 },
      { range: '2.50+', settled: 10, correct: 3, accuracy: 30 },
    ],
    byLeague: [
      { league: 'Premier League', settled: 15, correct: 10, accuracy: 66.67 },
      { league: 'La Liga', settled: 8, correct: 2, accuracy: 25 },
    ],
    ...overrides,
  };
}

describe('buildAiPrompt — historical performance feedback loop', () => {
  test('includes HISTORICAL TRACK RECORD section when data is sufficient', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: createHistoricalPerformance(),
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('YOUR HISTORICAL TRACK RECORD (SELF-LEARNING DATA)');
    expect(prompt).toContain('Overall: 60% accuracy (30/50 settled)');
  });

  test('includes market breakdown with WEAK tags for low accuracy', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: createHistoricalPerformance(),
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('By Market:');
    expect(prompt).toContain('over_2.5: 70%');
    expect(prompt).toContain('(strong)');
    expect(prompt).toContain('1x2_home: 40%');
    expect(prompt).toContain('(WEAK — be cautious)');
  });

  test('includes confidence band breakdown', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: createHistoricalPerformance(),
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('By Confidence Level:');
    expect(prompt).toContain('Conf 8-10 (high): 73.33%');
    expect(prompt).toContain('Conf 6-7 (medium): 56%');
  });

  test('includes minute band breakdown with WEAK tag for endgame', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: createHistoricalPerformance(),
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('By Match Phase:');
    expect(prompt).toContain('Min 0-29 (early): 70%');
    expect(prompt).toContain('Min 75+ (endgame): 37.5%');
    expect(prompt).toContain('(WEAK — reduce aggression)');
  });

  test('includes league breakdown with POOR and RELIABLE tags', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: createHistoricalPerformance(),
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('By League (top leagues):');
    expect(prompt).toContain('Premier League: 66.67%');
    expect(prompt).toContain('(RELIABLE)');
    expect(prompt).toContain('La Liga: 25%');
    expect(prompt).toContain('(POOR — extra caution)');
  });

  test('includes self-learning action instructions', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: createHistoricalPerformance(),
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('USE THIS DATA TO:');
    expect(prompt).toContain('Reduce confidence in markets/phases where you historically perform poorly');
    expect(prompt).toContain('Avoid markets tagged WEAK');
  });

  test('does NOT include section when data has fewer than 5 settled', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: createHistoricalPerformance({
        overall: { settled: 3, correct: 2, accuracy: 66.67 },
      }),
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).not.toContain('HISTORICAL TRACK RECORD');
  });

  test('does NOT include section when historicalPerformance is null', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: null,
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).not.toContain('HISTORICAL TRACK RECORD');
  });

  test('does NOT include section when historicalPerformance is undefined', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).not.toContain('HISTORICAL TRACK RECORD');
  });

  test('handles empty byMarket/byLeague arrays gracefully', () => {
    const data = createMergedMatchData();
    const context: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: createHistoricalPerformance({
        byMarket: [],
        byLeague: [],
        byConfidenceBand: [],
        byMinuteBand: [],
        byOddsRange: [],
      }),
    };

    const prompt = buildAiPrompt(data, context);

    expect(prompt).toContain('HISTORICAL TRACK RECORD');
    expect(prompt).toContain('Overall: 60%');
    expect(prompt).not.toContain('By Market:');
    expect(prompt).not.toContain('By League');
  });

  test('prompt cache key includes historical performance fingerprint', () => {
    const data = createMergedMatchData();
    const contextWithPerf: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: createHistoricalPerformance(),
    };
    const contextWithoutPerf: AiPromptContext = {
      previousRecommendations: [],
      matchTimeline: [],
    };

    // Both should produce valid prompts but with different content
    const promptWith = buildAiPrompt(data, contextWithPerf);
    const promptWithout = buildAiPrompt(data, contextWithoutPerf);

    expect(promptWith).toContain('HISTORICAL TRACK RECORD');
    expect(promptWithout).not.toContain('HISTORICAL TRACK RECORD');
  });

  test('coexists with other context sections', () => {
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
      matchTimeline: [
        {
          minute: 30,
          score: '1-0',
          possession: '60-40',
          shots: '5-2',
          shots_on_target: '3-1',
          corners: '3-2',
          fouls: '5-4',
          yellow_cards: '1-0',
          red_cards: '0-0',
          goalkeeper_saves: '2-1',
          status: '1H',
        },
      ],
      historicalPerformance: createHistoricalPerformance(),
    };

    const prompt = buildAiPrompt(data, context);

    // All sections present together
    expect(prompt).toContain('PREVIOUS RECOMMENDATIONS FOR THIS MATCH');
    expect(prompt).toContain('MATCH PROGRESSION TIMELINE');
    expect(prompt).toContain('ANALYSIS CONTINUITY RULES');
    expect(prompt).toContain('YOUR HISTORICAL TRACK RECORD');
    expect(prompt).toContain('LIVE DATA INTERPRETATION FRAMEWORK');
  });
});
