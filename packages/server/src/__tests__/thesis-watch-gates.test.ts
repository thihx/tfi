import { describe, expect, it } from 'vitest';
import {
  buildThesisWatchIntentFromLlpBlock,
  isThesisWatchGateSatisfied,
  resolveThesisWatchPromoteMarket,
} from '../lib/thesis-watch-gates.js';
import type { ThesisWatchRow } from '../lib/thesis-watch-types.js';
import type { LinePatienceOddsCanonical } from '../lib/line-patience-policy.js';

describe('thesis-watch-gates', () => {
  it('satisfies ah_wait_ou_over when main OU line is at or below threshold', () => {
    const odds: LinePatienceOddsCanonical = {
      ou: { line: 1.0, over: 1.85, under: 1.95 },
    };
    expect(isThesisWatchGateSatisfied('ah_wait_ou_over', {}, odds)).toBe(true);
  });

  it('satisfies ah_wait_ou_over from adjacent OU when main is high', () => {
    const odds: LinePatienceOddsCanonical = {
      ou: { line: 2.5, over: 2.1, under: 1.7 },
      ou_adjacent: { line: 1.0, over: 1.9, under: 1.9 },
    };
    expect(isThesisWatchGateSatisfied('ah_wait_ou_over', {}, odds)).toBe(true);
  });

  it('satisfies corners_over_line when live line dropped below intended', () => {
    const odds: LinePatienceOddsCanonical = {
      corners_ou: { line: 7.5, over: 1.9, under: 1.9 },
    };
    expect(
      isThesisWatchGateSatisfied('corners_over_line', { intendedMarketLine: 8.5 }, odds),
    ).toBe(true);
  });

  it('satisfies goals_over_line when a conservative over rung is available', () => {
    const odds: LinePatienceOddsCanonical = {
      ou: { line: 2.5, over: 2.0, under: 1.75 },
      ou_adjacent: { line: 1.0, over: 1.85, under: 1.95 },
    };
    expect(
      isThesisWatchGateSatisfied('goals_over_line', { intendedMarketLine: 2.5 }, odds),
    ).toBe(true);
  });

  it('satisfies goals_under_line when a safer under rung is available', () => {
    const odds: LinePatienceOddsCanonical = {
      ou: { line: 1.0, over: 2.0, under: 1.85 },
      ou_adjacent: { line: 0.75, over: 1.8, under: 2.05 },
    };
    expect(
      isThesisWatchGateSatisfied('goals_under_line', { intendedMarketLine: 0.75, goalsUnderMinLine: 1.0 }, odds),
    ).toBe(true);
  });

  it('resolveThesisWatchPromoteMarket lowers corners line to feed main', () => {
    const watch = {
      gate_type: 'corners_over_line' as const,
      gate_payload: { intendedMarketLine: 8.5 },
      selection: 'Over 8.5 Corners',
      bet_market: 'corners_over_8.5',
    };
    const resolved = resolveThesisWatchPromoteMarket(watch as ThesisWatchRow, {
      corners_ou: { line: 7.5, over: 1.9, under: 1.9 },
    });
    expect(resolved.betMarket).toBe('corners_over_7.5');
  });

  it('resolveThesisWatchPromoteMarket raises under line to safer live rung', () => {
    const watch = {
      gate_type: 'goals_under_line' as const,
      gate_payload: { intendedMarketLine: 0.75, goalsUnderMinLine: 1.0 },
      selection: 'Under 0.75 Goals',
      bet_market: 'under_0.75',
    };
    const resolved = resolveThesisWatchPromoteMarket(watch as ThesisWatchRow, {
      ou: { line: 1.0, over: 2.0, under: 1.85 },
      ou_adjacent: { line: 1.25, over: 1.7, under: 2.15 },
    });
    expect(resolved.betMarket).toBe('under_1');
  });

  it('builds intent from LLP defer warnings', () => {
    const intent = buildThesisWatchIntentFromLlpBlock({
      warnings: ['LLP_BLOCK_AH_WAIT_OU_OVER_LINE'],
      selection: 'Home -0.75',
      betMarket: 'asian_handicap_home_-0.75',
      confidence: 8,
      valuePercent: 5,
      stakePercent: 2,
      riskLevel: 'MEDIUM',
      reasoningEn: 'Wait for OU',
      reasoningVi: 'Doi OU',
      oddsCanonical: { ou: { line: 2.5, over: 2.0, under: 1.7 } },
    });
    expect(intent).not.toBeNull();
    expect(intent?.gateType).toBe('ah_wait_ou_over');
    expect(intent?.watchKey).toContain('ah_wait_ou_over');
  });

  it('builds goals over intent from conservative remap warning', () => {
    const intent = buildThesisWatchIntentFromLlpBlock({
      warnings: ['LLP_REMAP_OVER_CONSERVATIVE_LINE'],
      selection: 'Over 1.5 Goals',
      betMarket: 'over_1.5',
      confidence: 7,
      valuePercent: 6,
      stakePercent: 2,
      riskLevel: 'LOW',
      reasoningEn: 'Wait for lower over line',
      reasoningVi: 'Doi line over thap hon',
      oddsCanonical: { ou: { line: 1.5, over: 2.0, under: 1.8 } },
    });
    expect(intent).not.toBeNull();
    expect(intent?.gateType).toBe('goals_over_line');
    expect(intent?.watchKey).toBe('goals_over_line::over_1.5');
  });

  it('builds goals under intent from conservative remap warning', () => {
    const intent = buildThesisWatchIntentFromLlpBlock({
      warnings: ['LLP_REMAP_UNDER_CONSERVATIVE_LINE'],
      selection: 'Under 0.75 Goals',
      betMarket: 'under_0.75',
      confidence: 7,
      valuePercent: 6,
      stakePercent: 2,
      riskLevel: 'LOW',
      reasoningEn: 'Wait for safer under line',
      reasoningVi: 'Doi line under an toan hon',
      oddsCanonical: { ou: { line: 1.0, over: 2.0, under: 1.85 } },
    });
    expect(intent).not.toBeNull();
    expect(intent?.gateType).toBe('goals_under_line');
    expect(intent?.watchKey).toBe('goals_under_line::under_0.75');
  });
});
