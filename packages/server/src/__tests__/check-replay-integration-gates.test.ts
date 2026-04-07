import { describe, expect, test } from 'vitest';
import { evaluateReplayGates, type ReplayGateConfig } from '../scripts/check-replay-integration-gates.js';

describe('evaluateReplayGates', () => {
  const baseSummary = {
    variants: [
      {
        promptVersion: 'v8-market-balance-followup-h',
        totalScenarios: 20,
        pushRate: 0.75,
        goalsUnderShare: 0.5,
        roi: 0.1,
        accuracy: 0.6,
      },
    ],
  };

  test('passes when all metrics inside gates', () => {
    const config: ReplayGateConfig = {
      summaryPath: 'x.json',
      promptVersion: 'v8-market-balance-followup-h',
      minScenarios: 20,
      pushRate: { min: 0.7, max: 0.8 },
      goalsUnderShareMax: 0.55,
      roiMin: 0,
      accuracyMin: 0.52,
    };
    const r = evaluateReplayGates(config, baseSummary, { summary: { underFallbackDetected: 0 } });
    expect(r.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  test('fails on low push rate', () => {
    const summary = {
      variants: [
        {
          ...baseSummary.variants[0],
          pushRate: 0.55,
        },
      ],
    };
    const config: ReplayGateConfig = {
      summaryPath: 'x.json',
      promptVersion: 'v8-market-balance-followup-h',
      pushRate: { min: 0.7, max: 0.8 },
    };
    const r = evaluateReplayGates(config, summary, null);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes('pushRate'))).toBe(true);
  });

  test('fails per-market family accuracy when settled sample enough', () => {
    const summary = {
      variants: [
        {
          promptVersion: 'v8-market-balance-followup-h',
          totalScenarios: 40,
          pushRate: 0.75,
          goalsUnderShare: 0.4,
          roi: 0,
          accuracy: 0.72,
          byMarketFamily: [
            { family: 'goals_under', pushCount: 10, settledDirectionalCount: 10, accuracy: 0.4 },
            { family: 'goals_over', pushCount: 5, settledDirectionalCount: 5, accuracy: 0.8 },
          ],
        },
      ],
    };
    const config: ReplayGateConfig = {
      summaryPath: 'x.json',
      promptVersion: 'v8-market-balance-followup-h',
      marketFamiliesAccuracy: {
        minSettledDirectionalPerFamily: 5,
        minAccuracy: 0.5,
        failOnInsufficientSample: true,
      },
    };
    const r = evaluateReplayGates(config, summary, null);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes('goals_under') && f.includes('0.4000'))).toBe(true);
  });

  test('skips market family with zero pushes', () => {
    const summary = {
      variants: [
        {
          promptVersion: 'v8-market-balance-followup-h',
          totalScenarios: 20,
          pushRate: 0.75,
          goalsUnderShare: 0.5,
          roi: 0,
          accuracy: 0.72,
          byMarketFamily: [
            { family: '1x2', pushCount: 0, settledDirectionalCount: 0, accuracy: 0 },
            { family: 'goals_over', pushCount: 15, settledDirectionalCount: 15, accuracy: 0.73 },
          ],
        },
      ],
    };
    const config: ReplayGateConfig = {
      summaryPath: 'x.json',
      promptVersion: 'v8-market-balance-followup-h',
      marketFamiliesAccuracy: {
        minSettledDirectionalPerFamily: 5,
        minAccuracy: 0.5,
        failOnInsufficientSample: true,
      },
    };
    const r = evaluateReplayGates(config, summary, null);
    expect(r.ok).toBe(true);
  });

  test('fails on high goalsUnderShare', () => {
    const summary = {
      variants: [
        {
          ...baseSummary.variants[0],
          goalsUnderShare: 0.8,
        },
      ],
    };
    const config: ReplayGateConfig = {
      summaryPath: 'x.json',
      promptVersion: 'v8-market-balance-followup-h',
      goalsUnderShareMax: 0.55,
    };
    const r = evaluateReplayGates(config, summary, null);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes('goalsUnderShare'))).toBe(true);
  });
});
