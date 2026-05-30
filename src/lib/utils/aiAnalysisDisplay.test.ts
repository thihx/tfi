import { describe, expect, it } from 'vitest';
import {
  filterUserFacingWarnings,
  isTechnicalWarning,
  pickAnalysisReasoning,
} from './aiAnalysisDisplay';

describe('aiAnalysisDisplay', () => {
  it('treats uppercase pipeline codes as technical', () => {
    expect(isTechnicalWarning('MARKET_UNRESOLVED')).toBe(true);
    expect(isTechnicalWarning('POLICY_BLOCK_BTTS_NO_60_74')).toBe(true);
    expect(isTechnicalWarning('ADVISORY_ONLY')).toBe(true);
  });

  it('keeps LLM warnings with readable prose', () => {
    expect(isTechnicalWarning('HIGH_ODDS_RISK: Historical win rate at odds >=2.50 is only 29.8%.')).toBe(false);
    expect(isTechnicalWarning('Condition-triggered bet not saved because live odds are unavailable.')).toBe(false);
  });

  it('filters technical warnings for display', () => {
    expect(filterUserFacingWarnings([
      'MARKET_UNRESOLVED',
      'HIGH_ODDS_RISK: edge too thin',
      'EDGE_OK',
    ])).toEqual(['HIGH_ODDS_RISK: edge too thin']);
  });

  it('picks reasoning by UI language with fallback', () => {
    expect(pickAnalysisReasoning('Tieng Viet', 'English', 'vi')).toBe('Tieng Viet');
    expect(pickAnalysisReasoning('', 'English', 'vi')).toBe('English');
    expect(pickAnalysisReasoning('Tieng Viet', 'English', 'en')).toBe('English');
  });
});