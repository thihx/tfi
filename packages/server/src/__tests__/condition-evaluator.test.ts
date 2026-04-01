import { describe, expect, test } from 'vitest';
import { evaluateCustomConditionText } from '../lib/condition-evaluator.js';

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
