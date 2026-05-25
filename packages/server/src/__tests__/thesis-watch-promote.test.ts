import { describe, expect, it } from 'vitest';
import { applyLinePatiencePolicy, DEFAULT_LINE_PATIENCE_CONFIG } from '../lib/line-patience-policy.js';
import {
  isThesisWatchGateSatisfied,
  resolveThesisWatchPromoteMarket,
} from '../lib/thesis-watch-gates.js';
import type { ThesisWatchRow } from '../lib/thesis-watch-types.js';

const exceptional = {
  confidence: 9,
  valuePercent: 8,
  evidenceMode: 'full_live_data',
};

function cornersWatch(overrides: Partial<ThesisWatchRow> = {}): ThesisWatchRow {
  return {
    id: 1,
    match_id: 'm1',
    watch_key: 'corners_over_line::corners_over_8.5',
    status: 'pending',
    gate_type: 'corners_over_line',
    gate_payload: { intendedMarketLine: 8.5 },
    selection: 'Over 8.5 Corners',
    bet_market: 'corners_over_8.5',
    confidence: 8,
    value_percent: 5,
    stake_percent: 2,
    risk_level: 'MEDIUM',
    reasoning_en: 'Wait for lower corners line',
    reasoning_vi: '',
    source: 'llp_defer',
    last_block_reason: 'LLP_BLOCK_CORNERS_OVER_AGGRESSIVE_LINE',
    initial_snapshot: {},
    promote_snapshot: {},
    promote_reason: {},
    promoted_recommendation_id: null,
    created_at: '',
    updated_at: '',
    expires_at: '',
    promoted_at: null,
    ...overrides,
  };
}

describe('thesis-watch promote resolution', () => {
  it('remaps corners thesis to live main line when feed dropped below intended', () => {
    const odds = {
      corners_ou: { line: 7.5, over: 1.9, under: 1.9 },
    };
    const watch = cornersWatch();

    expect(isThesisWatchGateSatisfied(watch.gate_type, watch.gate_payload, odds)).toBe(true);

    const resolved = resolveThesisWatchPromoteMarket(watch, odds);
    expect(resolved.betMarket).toBe('corners_over_7.5');
    expect(resolved.selection).toContain('7.5');

    const llp = applyLinePatiencePolicy({
      selection: resolved.selection,
      betMarket: resolved.betMarket,
      minute: 50,
      score: '1-0',
      ...exceptional,
      oddsCanonical: odds,
      enabled: true,
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(llp.blocked).toBe(false);
  });

  it('would re-block corners promote without remap (regression)', () => {
    const odds = {
      corners_ou: { line: 7.5, over: 1.9, under: 1.9 },
    };
    const watch = cornersWatch();

    const llp = applyLinePatiencePolicy({
      selection: watch.selection,
      betMarket: watch.bet_market,
      minute: 50,
      score: '1-0',
      confidence: 8,
      valuePercent: 5,
      evidenceMode: 'full_live_data',
      oddsCanonical: odds,
      enabled: true,
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(llp.blocked).toBe(true);
    expect(llp.warnings).toContain('LLP_BLOCK_CORNERS_OVER_AGGRESSIVE_LINE');
  });

  it('remaps goals over thesis to conservative OU rung before LLP', () => {
    const odds = {
      ou: { line: 2.5, over: 2.0, under: 1.75 },
      ou_adjacent: { line: 1.0, over: 1.85, under: 1.95 },
    };
    const watch: ThesisWatchRow = {
      ...cornersWatch(),
      watch_key: 'goals_over_line::over_2.5',
      gate_type: 'goals_over_line',
      gate_payload: { intendedMarketLine: 2.5 },
      selection: 'Over 2.5 Goals',
      bet_market: 'over_2.5',
      last_block_reason: 'LLP_BLOCK_OVER_AGGRESSIVE_LINE',
    };

    expect(isThesisWatchGateSatisfied(watch.gate_type, watch.gate_payload, odds)).toBe(true);

    const resolved = resolveThesisWatchPromoteMarket(watch, odds);
    expect(resolved.betMarket).toBe('over_1');

    const llp = applyLinePatiencePolicy({
      selection: resolved.selection,
      betMarket: resolved.betMarket,
      minute: 55,
      score: '1-0',
      ...exceptional,
      oddsCanonical: odds,
      enabled: true,
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(llp.blocked).toBe(false);
    expect(llp.remapped).toBe(false);
  });

  it('leaves AH thesis selection unchanged', () => {
    const odds = {
      ou: { line: 1.0, over: 1.85, under: 1.95 },
    };
    const watch: ThesisWatchRow = {
      ...cornersWatch(),
      gate_type: 'ah_wait_ou_over',
      gate_payload: {},
      selection: 'Asian Handicap Home -0.75',
      bet_market: 'asian_handicap_home_-0.75',
      last_block_reason: 'LLP_BLOCK_AH_WAIT_OU_OVER_LINE',
    };

    const resolved = resolveThesisWatchPromoteMarket(watch, odds);
    expect(resolved.betMarket).toBe('asian_handicap_home_-0.75');

    const llp = applyLinePatiencePolicy({
      selection: resolved.selection,
      betMarket: resolved.betMarket,
      minute: 55,
      score: '0-0',
      ...exceptional,
      oddsCanonical: odds,
      enabled: true,
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(llp.blocked).toBe(false);
  });
});
