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
});
