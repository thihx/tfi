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

  test('v8b blocks 1x2_home before minute 55', () => {
    const result = applyRecommendationPolicy({
      selection: 'Home Win @1.82',
      betMarket: '1x2_home',
      minute: 54,
      score: '1-1',
      odds: 1.82,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-b',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_1X2_HOME_PRE55_V8B');
  });

  test('v8b allows 1x2_home from minute 55 onward', () => {
    const result = applyRecommendationPolicy({
      selection: 'Home Win @1.82',
      betMarket: '1x2_home',
      minute: 55,
      score: '1-1',
      odds: 1.82,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-b',
    });

    expect(result.blocked).toBe(false);
    expect(result.warnings).not.toContain('POLICY_BLOCK_1X2_HOME_PRE55_V8B');
  });

  test('v8f keeps 1x2_home open from minute 35 onward', () => {
    const result = applyRecommendationPolicy({
      selection: 'Home Win @2.05',
      betMarket: '1x2_home',
      minute: 36,
      score: '0-0',
      odds: 2.05,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-f',
    });

    expect(result.blocked).toBe(false);
    expect(result.warnings).not.toContain('POLICY_BLOCK_1X2_HOME_PRE35_V8D');
  });

  test('v8f still blocks 1x2_home before minute 35', () => {
    const result = applyRecommendationPolicy({
      selection: 'Home Win @2.05',
      betMarket: '1x2_home',
      minute: 34,
      score: '0-0',
      odds: 2.05,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-f',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_1X2_HOME_PRE35_V8D');
  });

  test('v8f still blocks goals under in 45-59 two-plus-margin states', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 4.25 Goals @1.88',
      betMarket: 'under_4.25',
      minute: 52,
      score: '3-1',
      odds: 1.88,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-f',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_MARGIN_V8D');
  });

  test('v8f blocks 30-44 0-0 goals under lines above 1.5', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 2.25 Goals @1.90',
      betMarket: 'under_2.25',
      minute: 39,
      score: '0-0',
      odds: 1.9,
      confidence: 6,
      valuePercent: 6,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-f',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_UNDER_30_44_0_0_OVER_1_5_V8F');
  });

  test('v8f allows 30-44 0-0 under 1.25 to remain eligible', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 1.25 Goals @1.92',
      betMarket: 'under_1.25',
      minute: 38,
      score: '0-0',
      odds: 1.92,
      confidence: 6,
      valuePercent: 6,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-f',
    });

    expect(result.blocked).toBe(false);
    expect(result.warnings).not.toContain('POLICY_BLOCK_GOALS_UNDER_30_44_0_0_OVER_1_5_V8F');
  });

  test('v8f blocks very high goals-under lines in 30-44 level states after 2+ goals', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 5.25 Goals @2.00',
      betMarket: 'under_5.25',
      minute: 31,
      score: '1-1',
      odds: 2,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 4,
      promptVersion: 'v8-market-balance-followup-f',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_UNDER_30_44_LEVEL_HIGH_LINE_V8F');
  });

  test('v8f blocks corners over 12.5+ before minute 60', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Over 12.5 @1.90',
      betMarket: 'corners_over_12.5',
      minute: 42,
      score: '0-0',
      odds: 1.9,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-f',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_OVER_HIGH_LINE_PRE60_V8F');
  });

  test('v8g blocks early one-goal-margin high-line goals under', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 3 Goals @2.00',
      betMarket: 'under_3',
      minute: 24,
      score: '1-0',
      odds: 2,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-g',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_UNDER_EARLY_ONE_GOAL_HIGH_LINE_V8G');
  });

  test('v8g still allows early one-goal-margin lower goals-under lines', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 2.25 Goals @1.90',
      betMarket: 'under_2.25',
      minute: 24,
      score: '1-0',
      odds: 1.9,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-g',
    });

    expect(result.blocked).toBe(false);
  });

  test.each(['v8-market-balance-followup-h', 'v8-market-balance-followup-j'] as const)(
    '%s blocks 45-59 zero-zero low-line goals under',
    (promptVersion) => {
      const result = applyRecommendationPolicy({
        selection: 'Under 1.75 Goals @1.85',
        betMarket: 'under_1.75',
        minute: 45,
        score: '0-0',
        odds: 1.85,
        confidence: 6,
        valuePercent: 7,
        stakePercent: 3,
        promptVersion,
      });

      expect(result.blocked).toBe(true);
      expect(result.warnings).toContain('POLICY_BLOCK_GOALS_UNDER_45_59_0_0_LOW_LINE_V8H');
    },
  );

  test('v8h blocks 45-59 zero-zero low-line goals over', () => {
    const result = applyRecommendationPolicy({
      selection: 'Over 1 Goals @1.78',
      betMarket: 'over_1',
      minute: 55,
      score: '0-0',
      odds: 1.78,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-h',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_OVER_45_59_0_0_LOW_LINE_V8H');
  });

  test('v8h blocks 45-59 one-goal high-line corners over', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Over 10 @2.10',
      betMarket: 'corners_over_10',
      minute: 45,
      score: '1-0',
      odds: 2.1,
      confidence: 6,
      valuePercent: 9,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-h',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_OVER_45_59_ONE_GOAL_HIGH_LINE_V8H');
  });

  test('v8h still allows 45-59 zero-zero higher-line goals over', () => {
    const result = applyRecommendationPolicy({
      selection: 'Over 1.25 Goals @1.90',
      betMarket: 'over_1.25',
      minute: 55,
      score: '0-0',
      odds: 1.9,
      confidence: 6,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-h',
    });

    expect(result.blocked).toBe(false);
  });

  test('v8j blocks corners in 30-44 hot zone when edge/confidence below props bar', () => {
    const lowEdge = applyRecommendationPolicy({
      selection: 'Corners Over 10 @2.00',
      betMarket: 'corners_over_10',
      minute: 40,
      score: '0-0',
      odds: 2,
      confidence: 8,
      valuePercent: 6,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-j',
    });
    expect(lowEdge.blocked).toBe(true);
    expect(lowEdge.warnings).toContain('POLICY_BLOCK_PROPS_HOT_ZONE_LOW_EDGE_V8J');

    const lowConf = applyRecommendationPolicy({
      selection: 'Corners Over 10 @2.00',
      betMarket: 'corners_over_10',
      minute: 40,
      score: '0-0',
      odds: 2,
      confidence: 7,
      valuePercent: 9,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-j',
    });
    expect(lowConf.blocked).toBe(true);
    expect(lowConf.warnings).toContain('POLICY_BLOCK_PROPS_HOT_ZONE_LOW_CONFIDENCE_V8J');
  });

  test('v8j allows corners in 30-44 hot zone when edge and confidence clear bar', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Over 9.5 @2.00',
      betMarket: 'corners_over_9.5',
      minute: 32,
      score: '0-0',
      odds: 2,
      confidence: 8,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v8-market-balance-followup-j',
    });
    expect(result.blocked).toBe(false);
  });

  test('v8j requires higher btts_no edge in 37-44 than in 30-36', () => {
    const early = applyRecommendationPolicy({
      selection: 'BTTS No @1.75',
      betMarket: 'btts_no',
      minute: 33,
      score: '0-0',
      odds: 1.75,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 2,
      promptVersion: 'v8-market-balance-followup-j',
    });
    expect(early.blocked).toBe(false);

    const late = applyRecommendationPolicy({
      selection: 'BTTS No @1.75',
      betMarket: 'btts_no',
      minute: 40,
      score: '0-0',
      odds: 1.75,
      confidence: 6,
      valuePercent: 7,
      stakePercent: 2,
      promptVersion: 'v8-market-balance-followup-j',
    });
    expect(late.blocked).toBe(true);
    expect(late.warnings).toContain('POLICY_BLOCK_BTTS_NO_LOW_EDGE_V8J');
  });

  test('v10c blocks early high-line corners overs before minute 30', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Over 11.5 @1.78',
      betMarket: 'corners_over_11.5',
      minute: 20,
      score: '0-0',
      odds: 1.78,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-c',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_OVER_HIGH_LINE_PRE30_V10C');
  });

  test('v10c blocks early high-line corners unders before minute 30', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Under 9 @2.10',
      betMarket: 'corners_under_9',
      minute: 20,
      score: '0-0',
      odds: 2.1,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-c',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_UNDER_EARLY_HIGH_LINE_V10C');
  });

  test('v10c blocks BTTS No before minute 60', () => {
    const result = applyRecommendationPolicy({
      selection: 'BTTS No @1.78',
      betMarket: 'btts_no',
      minute: 41,
      score: '0-0',
      odds: 1.78,
      confidence: 6,
      valuePercent: 8,
      stakePercent: 2,
      promptVersion: 'v10-hybrid-legacy-c',
      statsCompact: {
        shots_on_target: { home: '1', away: '1' },
      },
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_BTTS_NO_PRE60_V10C');
  });

  test('v10c blocks midgame BTTS Yes without dual threat from both teams', () => {
    const result = applyRecommendationPolicy({
      selection: 'BTTS Yes @1.55',
      betMarket: 'btts_yes',
      minute: 53,
      score: '1-0',
      odds: 1.55,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-c',
      statsCompact: {
        shots_on_target: { home: '3', away: '1' },
      },
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_BTTS_YES_MIDGAME_LOW_DUAL_THREAT_V10C');
  });

  test('v10d blocks 45-59 one-goal corners unders on fragile 6.5 lines', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Under 6.5 @1.98',
      betMarket: 'corners_under_6.5',
      minute: 45,
      score: '0-1',
      odds: 1.98,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-d',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_UNDER_45_59_ONE_GOAL_LOW_LINE_V10D');
  });

  test('v10d blocks 45-59 one-goal extreme corners overs at 13.5+', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Over 13.5 @2.05',
      betMarket: 'corners_over_13.5',
      minute: 57,
      score: '1-2',
      odds: 2.05,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-d',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_OVER_45_59_ONE_GOAL_EXTREME_LINE_V10D');
  });

  test('v10d blocks early one-goal goals-over when runway is too long', () => {
    const result = applyRecommendationPolicy({
      selection: 'Over 3.25 @2.00',
      betMarket: 'over_3.25',
      minute: 21,
      score: '0-1',
      odds: 2,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-d',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_OVER_ONE_GOAL_EARLY_LONG_RUNWAY_V10D');
  });

  test('v10d blocks pre45 one-goal high-scoring goals-over when runway is still too long', () => {
    const result = applyRecommendationPolicy({
      selection: 'Over 4.75 @1.85',
      betMarket: 'over_4.75',
      minute: 39,
      score: '1-2',
      odds: 1.85,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-d',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_OVER_ONE_GOAL_MID_LONG_RUNWAY_V10D');
  });

  test('v10d blocks 45-59 two-plus-margin goals-under with only one-goal cushion', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 3 @2.08',
      betMarket: 'under_3',
      minute: 50,
      score: '2-0',
      odds: 2.08,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-d',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_LOW_CUSHION_V10D');
  });

  test('v10e blocks 45-59 one-goal corners unders on fragile 6.5 lines', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Under 6.5 @1.98',
      betMarket: 'corners_under_6.5',
      minute: 45,
      score: '0-1',
      odds: 1.98,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-e',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_UNDER_45_59_ONE_GOAL_LOW_LINE_V10E');
  });

  test('v10e blocks 45-59 one-goal extreme corners overs at 13.5+', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Over 13.5 @2.05',
      betMarket: 'corners_over_13.5',
      minute: 57,
      score: '1-2',
      odds: 2.05,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-e',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_OVER_45_59_ONE_GOAL_EXTREME_LINE_V10E');
  });

  test('v10f blocks 45-59 low-line corners under when goals are already on the board in chase states', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Under 6.5 @1.85',
      betMarket: 'corners_under_6.5',
      minute: 45,
      score: '1-2',
      odds: 1.85,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-f',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_UNDER_45_59_LOW_LINE_CHASE_V10F');
  });

  test('v10f blocks 45-59 two-plus-margin same-thesis goals-under rollover to a looser line', () => {
    const result = applyRecommendationPolicy({
      selection: 'Under 3 Goals @2.08',
      betMarket: 'under_3',
      minute: 50,
      score: '2-0',
      odds: 2.08,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-f',
      previousRecommendations: [
        { minute: 38, selection: 'Under 2.25 Goals @1.95', bet_market: 'under_2.25', stake_percent: 4, result: 'pending' },
      ],
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_UNDER_45_59_TWO_PLUS_SAME_THESIS_ROLLOVER_V10F');
  });

  test('v10g blocks 30-44 low-line corners under when goals are already on the board', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Under 8 @2.20',
      betMarket: 'corners_under_8',
      minute: 42,
      score: '1-1',
      odds: 2.2,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-g',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_UNDER_30_44_GOALS_ON_BOARD_LOW_LINE_V10G');
  });

  test('v10g blocks 30-44 weak-prematch low-line corners under even without goals on board', () => {
    const result = applyRecommendationPolicy({
      selection: 'Corners Under 8 @2.02',
      betMarket: 'corners_under_8',
      minute: 34,
      score: '0-0',
      odds: 2.02,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-g',
      prematchStrength: 'weak',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_CORNERS_UNDER_30_44_WEAK_PREMATCH_V10G');
  });

  test('v10g blocks 30-44 one-goal BTTS Yes without clear dual threat', () => {
    const result = applyRecommendationPolicy({
      selection: 'BTTS Yes @1.50',
      betMarket: 'btts_yes',
      minute: 36,
      score: '1-0',
      odds: 1.5,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-g',
      statsCompact: {
        shots_on_target: { home: '1', away: '1' },
      },
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_BTTS_YES_30_44_ONE_GOAL_LOW_DUAL_THREAT_V10G');
  });

  test('v10g blocks 30-44 one-goal extreme-runway goals overs at 4.5+', () => {
    const result = applyRecommendationPolicy({
      selection: 'Over 4.75 @1.93',
      betMarket: 'over_4.75',
      minute: 39,
      score: '1-0',
      odds: 1.93,
      confidence: 7,
      valuePercent: 8,
      stakePercent: 3,
      promptVersion: 'v10-hybrid-legacy-g',
    });

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('POLICY_BLOCK_GOALS_OVER_30_44_ONE_GOAL_EXTREME_RUNWAY_V10G');
  });
});
