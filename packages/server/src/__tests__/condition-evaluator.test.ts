import { describe, expect, test } from 'vitest';
import {
  buildConditionPreviewContext,
  conditionPreviewDataSource,
  evaluateCustomConditionText,
} from '../lib/condition-evaluator.js';

describe('condition evaluator', () => {
  const baseContext = {
    minute: 65,
    homeGoals: 1,
    awayGoals: 1,
    stats: {
      possession: { home: '55%', away: '45%' },
      shots: { home: '12', away: '8' },
      shots_on_target: { home: '5', away: '3' },
      corners: { home: '6', away: '4' },
    },
  };

  test('matches strategic machine grammar conditions', () => {
    expect(evaluateCustomConditionText('(Minute >= 60) AND (NOT Home leading)', baseContext)).toEqual({
      supported: true,
      matched: true,
      summary: 'Condition matched: Minute >= 60 AND NOT Home leading',
    });
  });

  test('matches snake_case stat conditions', () => {
    expect(evaluateCustomConditionText('shots_on_target_home >= 4 AND possession_home > 50', baseContext)).toEqual({
      supported: true,
      matched: true,
      summary: 'Condition matched: shots_on_target_home >= 4 AND possession_home > 50',
    });
  });

  test('reports unsupported operators cleanly', () => {
    expect(evaluateCustomConditionText('(Minute >= 60) OR (Draw)', baseContext)).toEqual({
      supported: false,
      matched: false,
      summary: 'Unsupported OR operator',
    });
  });
});

describe('condition preview context builder', () => {
  const match = {
    current_minute: 44,
    home_score: 0,
    away_score: 1,
  };

  const snapshot = {
    minute: 65,
    home_score: 1,
    away_score: 1,
    stats: { possession: { home: '55%', away: '45%' } },
  };

  test('prefers snapshot over match', () => {
    const ctx = buildConditionPreviewContext(match, snapshot);
    expect(ctx.minute).toBe(65);
    expect(ctx.homeGoals).toBe(1);
    expect(ctx.awayGoals).toBe(1);
    expect(ctx.stats.possession?.home).toBe('55%');
    expect(conditionPreviewDataSource(snapshot, match)).toBe('latest_snapshot');
  });

  test('falls back to match when no snapshot', () => {
    const ctx = buildConditionPreviewContext(match, null);
    expect(ctx.minute).toBe(44);
    expect(ctx.homeGoals).toBe(0);
    expect(ctx.awayGoals).toBe(1);
    expect(conditionPreviewDataSource(null, match)).toBe('match_fixture');
  });

  test('empty when neither', () => {
    const ctx = buildConditionPreviewContext(undefined, null);
    expect(ctx).toEqual({ minute: null, homeGoals: 0, awayGoals: 0, stats: {} });
    expect(conditionPreviewDataSource(null, null)).toBe('empty');
  });
});
