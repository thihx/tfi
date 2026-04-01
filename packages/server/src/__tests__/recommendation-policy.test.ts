import { describe, expect, test } from 'vitest';
import { applyRecommendationPolicy } from '../lib/recommendation-policy.js';

describe('applyRecommendationPolicy', () => {
  test('blocks 1x2_home before minute 75', () => {
    const result = applyRecommendationPolicy({
      selection: 'Home Win @2.20',
      betMarket: '1x2_home',
      minute: 60,
      score: '1-1',
      odds: 2.2,
      confidence: 6,
      valuePercent: 8,
      stakePercent: 4,
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_1X2_HOME_PRE75');
  });

  test('blocks 1x2_draw always', () => {
    const result = applyRecommendationPolicy({
      selection: 'Draw @3.10',
      betMarket: '1x2_draw',
      minute: 78,
      score: '1-1',
      odds: 3.1,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 2,
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_1X2_DRAW');
  });

  test('blocks over_0.5 at 75 plus', () => {
    const result = applyRecommendationPolicy({
      selection: 'Over 0.5 Goals @1.95',
      betMarket: 'over_0.5',
      minute: 80,
      score: '0-0',
      odds: 1.95,
      confidence: 6,
      valuePercent: 6,
      stakePercent: 3,
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_OVER_0_5_75_PLUS');
  });

  test('blocks under_2.5 before minute 75', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 2.5 Goals @1.88',
      betMarket: 'under_2.5',
      minute: 68,
      score: '1-1',
      odds: 1.88,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 3,
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_UNDER_2_5_PRE75');
  });

  test('caps BTTS No confidence and stake when otherwise valid', () => {
    const result = applyRecommendationPolicy({
      selection: 'BTTS No @1.88',
      betMarket: 'btts_no',
      minute: 52,
      score: '1-0',
      odds: 1.88,
      confidence: 9,
      valuePercent: 6,
      stakePercent: 5,
      statsCompact: {
        shots_on_target: { home: '1', away: '1' },
      },
    });

    expect(result.blocked).toBe(false);
    expect(result.confidence).toBe(6);
    expect(result.stakePercent).toBe(2);
    expect(result.warnings).toContain('POLICY_CAP_BTTS_NO_CONFIDENCE');
    expect(result.warnings).toContain('POLICY_CAP_BTTS_NO_STAKE');
  });

  test('blocks BTTS No in the 60-74 minute trap zone', () => {
    const result = applyRecommendationPolicy({
      selection: 'BTTS No @1.82',
      betMarket: 'btts_no',
      minute: 66,
      score: '1-0',
      odds: 1.82,
      confidence: 6,
      valuePercent: 8,
      stakePercent: 2,
      statsCompact: {
        shots_on_target: { home: '1', away: '1' },
      },
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_BTTS_NO_60_74');
  });

  test('blocks BTTS No when odds drift into the high-price danger zone', () => {
    const result = applyRecommendationPolicy({
      selection: 'BTTS No @1.95',
      betMarket: 'btts_no',
      minute: 52,
      score: '1-0',
      odds: 1.95,
      confidence: 6,
      valuePercent: 8,
      stakePercent: 2,
      statsCompact: {
        shots_on_target: { home: '1', away: '1' },
      },
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_BTTS_NO_HIGH_PRICE');
  });

  test('blocks BTTS No when both teams already have two or more shots on target', () => {
    const result = applyRecommendationPolicy({
      selection: 'BTTS No @1.95',
      betMarket: 'btts_no',
      minute: 55,
      score: '1-0',
      odds: 1.95,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 3,
      statsCompact: {
        shots_on_target: { home: '2', away: '2' },
      },
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_BTTS_NO_BOTH_TEAMS_ON_TARGET');
  });

  test('blocks same-thesis laddering when there are already two prior entries', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 1.5 Goals @1.92',
      betMarket: 'under_1.5',
      minute: 70,
      score: '1-0',
      odds: 1.92,
      confidence: 6,
      valuePercent: 6,
      stakePercent: 3,
      previousRecommendations: [
        { minute: 40, selection: 'Under 3.5 Goals @1.80', bet_market: 'under_3.5', stake_percent: 5, result: 'loss' },
        { minute: 58, selection: 'Under 2.5 Goals @1.86', bet_market: 'under_2.5', stake_percent: 3, result: 'loss' },
      ],
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_SAME_THESIS_COUNT_CAP');
  });

  test('blocks same-thesis exposure when stake cap would be exceeded', () => {
    const result = applyRecommendationPolicy({
      selection: 'Over 2.5 Goals @1.98',
      betMarket: 'over_2.5',
      minute: 63,
      score: '1-1',
      odds: 1.98,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 4,
      previousRecommendations: [
        { minute: 51, selection: 'Over 1.5 Goals @1.74', bet_market: 'over_1.5', stake_percent: 7, result: 'win' },
      ],
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_SAME_THESIS_STAKE_CAP');
  });
});
