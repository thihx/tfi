// ============================================================
// Unit tests — generateCondition (evaluable condition generation)
// ============================================================

import { describe, test, expect } from 'vitest';
import { generateCondition } from '../jobs/enrich-watchlist.job.js';
import type { StrategicContext } from '../lib/strategic-context.service.js';

function makeCtx(overrides: Partial<StrategicContext> = {}): StrategicContext {
  return {
    home_motivation: '',
    away_motivation: '',
    league_positions: '',
    fixture_congestion: '',
    rotation_risk: '',
    key_absences: '',
    h2h_narrative: '',
    summary: '',
    searched_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Every atom in condition must match the evaluable format */
function assertEvaluableFormat(condition: string) {
  // Must start with '(' — the main guard in enrich-watchlist.job.ts
  expect(condition.startsWith('(')).toBe(true);
  // Must NOT contain freetext advice words
  const forbidden = ['favor', 'consider', 'backing', 'offers', 'value', 'expect', 'recommend'];
  for (const word of forbidden) {
    expect(condition.toLowerCase()).not.toContain(word);
  }
  // Every atom should match the allowed set
  const atoms = condition.split(/\s+AND\s+/).map((a) => a.trim());
  const validAtomRe = /^\((?:Minute [><=!]+\s*\d+|Total goals [><=!]+\s*\d+|Draw|Home leading|Away leading|NOT (?:Home|Away) leading)\)$/;
  for (const atom of atoms) {
    // Atom may be compound with OR — split further
    const subAtoms = atom.split(/\s+OR\s+/).map((s) => s.trim());
    for (const sub of subAtoms) {
      expect(sub).toMatch(validAtomRe);
    }
  }
}

describe('generateCondition', () => {
  // ── Format validation ──

  test('output condition always starts with ( and contains only evaluable atoms', () => {
    const ctx = makeCtx({
      home_motivation: 'Fighting for title race, must win',
      away_motivation: 'Battling relegation, desperate for points',
    });
    const result = generateCondition(ctx, 'Arsenal', 'Chelsea');
    expect(result).not.toBeNull();
    assertEvaluableFormat(result!.condition);
  });

  test('narrative advice goes only in reason fields, NOT in condition', () => {
    const ctx = makeCtx({
      home_motivation: 'Nothing to play for, comfortable mid-table',
      away_motivation: 'Must win for promotion',
    });
    const result = generateCondition(ctx, 'TeamA', 'TeamB');
    expect(result).not.toBeNull();
    // condition: pure evaluable
    assertEvaluableFormat(result!.condition);
    // reason: contains advice text
    expect(result!.reason.length).toBeGreaterThan(10);
    expect(result!.reason_vi.length).toBeGreaterThan(10);
  });

  // ── Pattern: Both urgent ──

  test('both teams in high-stakes → (Minute >= 45) AND (Total goals <= 0)', () => {
    const ctx = makeCtx({
      home_motivation: 'Title race, must win to stay top',
      away_motivation: 'Battling relegation, fighting for survival',
    });
    const result = generateCondition(ctx, 'Arsenal', 'Everton');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(Minute >= 45)');
    expect(result!.condition).toContain('(Total goals <= 0)');
  });

  // ── Pattern: One relaxed, one motivated ──

  test('home relaxed, away motivated → (NOT Away leading)', () => {
    const ctx = makeCtx({
      home_motivation: 'Nothing to play for, safe in mid-table',
      away_motivation: 'Crucial match for title push',
    });
    const result = generateCondition(ctx, 'TeamH', 'TeamA');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(NOT Away leading)');
    expect(result!.reason).toContain('TeamH');
  });

  test('away relaxed, home motivated → (NOT Home leading)', () => {
    const ctx = makeCtx({
      home_motivation: 'Must win for promotion',
      away_motivation: 'Already qualified, no motivation',
    });
    const result = generateCondition(ctx, 'TeamH', 'TeamA');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(NOT Home leading)');
  });

  // ── Pattern: Large league position gap ──

  test('large position gap → alert if favourite not leading by 60', () => {
    const ctx = makeCtx({
      league_positions: '2nd vs 18th in the table',
    });
    const result = generateCondition(ctx, 'TopTeam', 'BottomTeam');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(Minute >= 60)');
    expect(result!.condition).toMatch(/NOT (Home|Away) leading/);
  });

  test('small position gap → no condition from league_positions', () => {
    const ctx = makeCtx({
      league_positions: '5th vs 7th in the table',
    });
    // Only summary fallback should trigger
    const result = generateCondition(ctx, 'A', 'B');
    expect(result).toBeNull(); // gap=2, no summary → null
  });

  // ── Pattern: Rotation risk ──

  test('home rotation → (Total goals <= 1) at minute 60', () => {
    const ctx = makeCtx({
      rotation_risk: 'Arsenal expected to rotate several key players for Saturday match',
    });
    const result = generateCondition(ctx, 'Arsenal', 'Chelsea');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(Total goals <= 1)');
    expect(result!.reason).toContain('Arsenal');
  });

  test('no rotation signal → no rotation atom', () => {
    const ctx = makeCtx({
      rotation_risk: 'No significant rotation expected',
    });
    const result = generateCondition(ctx, 'A', 'B');
    // Should be null or only have fallback atoms
    if (result) {
      expect(result.reason).not.toContain('rotate');
    }
  });

  // ── Pattern: Key absences ──

  test('key striker absent → (Total goals <= 1)', () => {
    const ctx = makeCtx({
      key_absences: 'Arsenal missing their top scorer and main striker for this fixture',
    });
    const result = generateCondition(ctx, 'Arsenal', 'Chelsea');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(Total goals <= 1)');
  });

  // ── Pattern: European congestion ──

  test('Champions League in 2 days → early goals expected', () => {
    const ctx = makeCtx({
      fixture_congestion: 'Champions League match in 2 days',
    });
    const result = generateCondition(ctx, 'A', 'B');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(Minute <= 30)');
    expect(result!.condition).toContain('(Total goals >= 1)');
  });

  // ── Pattern: H2H dominant ──

  test('H2H dominant: home won last 4 → alert if not leading by 60', () => {
    const ctx = makeCtx({
      h2h_narrative: 'Arsenal won last 4 meetings against Chelsea comprehensively',
    });
    const result = generateCondition(ctx, 'Arsenal', 'Chelsea');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(Minute >= 60)');
    expect(result!.reason).toContain('Arsenal');
  });

  // ── Pattern: High-scoring H2H ──

  test('high-scoring H2H → alert if low goals at 60', () => {
    const ctx = makeCtx({
      h2h_narrative: 'These teams have a high-scoring history with avg 3.5 goals per game',
    });
    const result = generateCondition(ctx, 'A', 'B');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(Total goals <= 1)');
    expect(result!.condition).toContain('(Minute >= 60)');
  });

  // ── Fallback ──

  test('no patterns matched but has summary → fallback to halftime goalless', () => {
    const ctx = makeCtx({
      summary: 'Both teams in decent form, competitive match expected.',
    });
    const result = generateCondition(ctx, 'A', 'B');
    expect(result).not.toBeNull();
    expect(result!.condition).toBe('(Minute >= 45) AND (Total goals <= 0)');
    expect(result!.reason).toContain('strategic context');
  });

  test('no patterns and no summary → returns null', () => {
    const ctx = makeCtx();
    const result = generateCondition(ctx, 'A', 'B');
    expect(result).toBeNull();
  });

  // ── Combined patterns ──

  test('multiple patterns produce combined AND condition', () => {
    const ctx = makeCtx({
      home_motivation: 'Title race, must win',
      away_motivation: 'Relegation battle, fighting for survival',
      fixture_congestion: 'Champions League game in 2 days',
      h2h_narrative: 'High-scoring encounters with avg 4.2 goals per game',
    });
    const result = generateCondition(ctx, 'Arsenal', 'Chelsea');
    expect(result).not.toBeNull();
    // Should have multiple atoms combined
    const andParts = result!.condition.split(' AND ');
    expect(andParts.length).toBeGreaterThanOrEqual(2);
    // All parts must be evaluable
    assertEvaluableFormat(result!.condition);
  });

  // ── Guard: old narrative format detection ──

  test('condition starting with "(" is evaluable (kept)', () => {
    const cond = '(Minute >= 45) AND (Total goals <= 0)';
    expect(cond.startsWith('(')).toBe(true);
  });

  test('narrative text does NOT start with "(" (should be overwritten)', () => {
    const oldNarrative = 'Strategic context: Tokyo Verdy excellent home momentum...';
    expect(oldNarrative.startsWith('(')).toBe(false);
  });

  // ── European competition: league position comparison SKIPPED ──

  test('European competition: position gap IGNORED when league = "UEFA Europa Conference League"', () => {
    const ctx = makeCtx({
      league_positions: 'AEK Larnaca: 3rd in Cypriot First Division, Crystal Palace: 13th in Premier League',
      competition_type: 'european',
    });
    const result = generateCondition(ctx, 'AEK Larnaca', 'Crystal Palace', 'UEFA Europa Conference League');
    // Should NOT produce a position-gap condition
    if (result) {
      expect(result.reason).not.toMatch(/gap of \d+ places/);
      expect(result.reason).not.toContain('thứ');
    }
  });

  test('European competition: position gap IGNORED via league name detection', () => {
    const ctx = makeCtx({
      league_positions: 'Inter: 1st in Serie A, Barcelona: 2nd in La Liga',
      // competition_type not set — rely on league name
    });
    const result = generateCondition(ctx, 'Inter', 'Barcelona', 'UEFA Champions League');
    if (result) {
      expect(result.reason).not.toMatch(/gap of \d+ places/);
    }
  });

  test('domestic league: position gap IS used normally', () => {
    const ctx = makeCtx({
      league_positions: '2nd vs 18th in the table',
      competition_type: 'domestic_league',
    });
    const result = generateCondition(ctx, 'TopTeam', 'BottomTeam', 'Premier League');
    expect(result).not.toBeNull();
    expect(result!.condition).toContain('(Minute >= 60)');
    expect(result!.reason).toMatch(/gap of \d+ places/);
  });
});
