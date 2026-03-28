import { describe, expect, test } from 'vitest';
import { earlySettleByRule } from '../lib/settle-rules.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function over(line: number, home: number, away: number) {
  return earlySettleByRule({ market: `over_${line}`, selection: `Over ${line}`, homeScore: home, awayScore: away });
}

function under(line: number, home: number, away: number) {
  return earlySettleByRule({ market: `under_${line}`, selection: `Under ${line}`, homeScore: home, awayScore: away });
}

// ─── Over regular lines ───────────────────────────────────────────────────────

describe('earlySettleByRule — Over regular lines', () => {
  test('Over 2.5 at 3 goals → early win', () => {
    const r = over(2.5, 2, 1);
    expect(r?.result).toBe('win');
  });

  test('Over 2.5 at 4 goals → early win', () => {
    const r = over(2.5, 2, 2);
    expect(r?.result).toBe('win');
  });

  test('Over 2.5 at exactly 2 goals → null (still live)', () => {
    expect(over(2.5, 1, 1)).toBeNull();
  });

  test('Over 2.5 at 1 goal → null', () => {
    expect(over(2.5, 1, 0)).toBeNull();
  });

  test('Over 0.5 at 1 goal → early win', () => {
    const r = over(0.5, 1, 0);
    expect(r?.result).toBe('win');
  });

  test('Over 3.5 at 3 goals → null (not yet)', () => {
    expect(over(3.5, 2, 1)).toBeNull();
  });

  test('Over 3.5 at 4 goals → early win', () => {
    expect(over(3.5, 3, 1)?.result).toBe('win');
  });
});

// ─── Under regular lines ─────────────────────────────────────────────────────

describe('earlySettleByRule — Under regular lines', () => {
  test('Under 2.5 at 3 goals → early loss', () => {
    const r = under(2.5, 2, 1);
    expect(r?.result).toBe('loss');
  });

  test('Under 2.5 at 4 goals → early loss', () => {
    expect(under(2.5, 2, 2)?.result).toBe('loss');
  });

  test('Under 2.5 at exactly 2 goals → null (match still live)', () => {
    // 2 goals < 2.5 so Under 2.5 would be a win at FT, but match is live — don't settle
    expect(under(2.5, 1, 1)).toBeNull();
  });

  test('Under 2.5 at 0 goals → null', () => {
    expect(under(2.5, 0, 0)).toBeNull();
  });

  test('Under 1.5 at 2 goals → early loss', () => {
    expect(under(1.5, 1, 1)?.result).toBe('loss');
  });

  test('Under 0.5 at 1 goal → early loss', () => {
    expect(under(0.5, 1, 0)?.result).toBe('loss');
  });
});

// ─── Over quarter lines (X.25 and X.75) ──────────────────────────────────────

describe('earlySettleByRule — Over quarter lines', () => {
  // Over 2.75 = split Over 2.5 + Over 3.0
  test('Over 2.75 at 3 goals → null (only half_win, not definitive)', () => {
    // At 3 goals: Over 2.5=win, Over 3.0=push → half_win
    // More goals could come making it full win — not safe to early settle as half_win
    expect(over(2.75, 2, 1)).toBeNull();
  });

  test('Over 2.75 at 4 goals → early win (both parts won)', () => {
    // At 4 goals: Over 2.5=win, Over 3.0=win → win
    expect(over(2.75, 2, 2)?.result).toBe('win');
  });

  test('Over 2.75 at 2 goals → null', () => {
    expect(over(2.75, 1, 1)).toBeNull();
  });

  // Over 2.25 = split Over 2.0 + Over 2.5
  test('Over 2.25 at 3 goals → early win (both parts won)', () => {
    // At 3 goals: Over 2.0=win, Over 2.5=win → win
    expect(over(2.25, 2, 1)?.result).toBe('win');
  });

  test('Over 2.25 at 2 goals → null (push on lower, loss on upper → half_loss)', () => {
    // At 2 goals: Over 2.0=push, Over 2.5=loss → half_loss — not a win
    expect(over(2.25, 1, 1)).toBeNull();
  });

  test('Over 1.75 at 2 goals → early win', () => {
    // Over 1.75 = split Over 1.5 + Over 2.0
    // At 2: Over 1.5=win, Over 2.0=push → half_win (NOT safe — more goals → full win)
    expect(over(1.75, 1, 1)).toBeNull();
  });

  test('Over 1.75 at 3 goals → early win', () => {
    // Over 1.5=win, Over 2.0=win → win
    expect(over(1.75, 2, 1)?.result).toBe('win');
  });
});

// ─── Under quarter lines ─────────────────────────────────────────────────────

describe('earlySettleByRule — Under quarter lines', () => {
  // Under 2.75 = split Under 2.5 + Under 3.0
  test('Under 2.75 at 3 goals → null (half_loss, not definitive)', () => {
    // At 3 goals: Under 2.5=loss, Under 3.0=push → half_loss
    // More goals would make it full loss (worse) — we exclude half_loss from early settle
    // because at FT it could be half_loss or loss: the FINAL result is not yet certain
    expect(under(2.75, 2, 1)).toBeNull();
  });

  test('Under 2.75 at 4 goals → early loss (both parts lost)', () => {
    // At 4 goals: Under 2.5=loss, Under 3.0=loss → loss
    expect(under(2.75, 2, 2)?.result).toBe('loss');
  });

  test('Under 2.75 at 2 goals → null', () => {
    expect(under(2.75, 1, 1)).toBeNull();
  });

  // Under 2.25 = split Under 2.0 + Under 2.5
  test('Under 2.25 at 3 goals → early loss', () => {
    // At 3 goals: Under 2.0=loss, Under 2.5=loss → loss
    expect(under(2.25, 2, 1)?.result).toBe('loss');
  });

  test('Under 2.25 at 2 goals → null', () => {
    // At 2 goals: Under 2.0=push, Under 2.5=win → half_win → not a loss
    expect(under(2.25, 1, 1)).toBeNull();
  });

  // Under 1.75 = split Under 1.5 + Under 2.0
  test('Under 1.75 at 2 goals → null (half_loss not safe)', () => {
    // At 2 goals: Under 1.5=loss, Under 2.0=push → half_loss
    expect(under(1.75, 1, 1)).toBeNull();
  });

  test('Under 1.75 at 3 goals → early loss', () => {
    expect(under(1.75, 2, 1)?.result).toBe('loss');
  });
});

// ─── BTTS Yes ─────────────────────────────────────────────────────────────────

describe('earlySettleByRule — BTTS Yes', () => {
  test('BTTS Yes when 1-1 → early win', () => {
    const r = earlySettleByRule({ market: 'btts_yes', selection: 'BTTS Yes', homeScore: 1, awayScore: 1 });
    expect(r?.result).toBe('win');
  });

  test('BTTS Yes when 2-1 → early win', () => {
    const r = earlySettleByRule({ market: 'btts_yes', selection: 'BTTS Yes', homeScore: 2, awayScore: 1 });
    expect(r?.result).toBe('win');
  });

  test('BTTS Yes when 1-0 → null (away not scored yet)', () => {
    const r = earlySettleByRule({ market: 'btts_yes', selection: 'BTTS Yes', homeScore: 1, awayScore: 0 });
    expect(r).toBeNull();
  });

  test('BTTS Yes when 0-0 → null', () => {
    expect(earlySettleByRule({ market: 'btts_yes', selection: 'BTTS Yes', homeScore: 0, awayScore: 0 })).toBeNull();
  });
});

// ─── Markets that should never early-settle ───────────────────────────────────

describe('earlySettleByRule — markets that must NOT early-settle', () => {
  test('BTTS No → null (cannot determine mid-match)', () => {
    expect(earlySettleByRule({ market: 'btts_no', selection: 'BTTS No', homeScore: 0, awayScore: 0 })).toBeNull();
  });

  test('1x2 home → null', () => {
    expect(earlySettleByRule({ market: '1x2_home', selection: 'Home', homeScore: 3, awayScore: 0 })).toBeNull();
  });

  test('Asian Handicap → null', () => {
    expect(earlySettleByRule({ market: 'asian_handicap_home_-0.5', selection: 'Home -0.5', homeScore: 3, awayScore: 0 })).toBeNull();
  });

  test('Corners Over → null (market supported by settleByRule but no stats given)', () => {
    expect(earlySettleByRule({ market: 'corners_over_8.5', selection: 'Corners Over 8.5', homeScore: 3, awayScore: 0 })).toBeNull();
  });

  test('Cards market → null', () => {
    expect(earlySettleByRule({ market: 'cards_over_4.5', selection: 'Cards Over 4.5', homeScore: 3, awayScore: 2 })).toBeNull();
  });
});

// ─── Boundary cases ───────────────────────────────────────────────────────────

describe('earlySettleByRule — boundary / push cases', () => {
  test('Over 2.0 at exactly 2 goals → null (push, could become win)', () => {
    // Whole line push: 2 == 2.0, result = push. More goals → win. Not safe.
    expect(over(2.0, 1, 1)).toBeNull();
  });

  test('Under 2.0 at exactly 2 goals → null (push, could become loss)', () => {
    // Push: 2 == 2.0. More goals → loss. Not safe to call push mid-match.
    expect(under(2.0, 1, 1)).toBeNull();
  });

  test('Over 2.0 at 3 goals → early win', () => {
    expect(over(2.0, 2, 1)?.result).toBe('win');
  });

  test('Under 2.0 at 3 goals → early loss', () => {
    expect(under(2.0, 2, 1)?.result).toBe('loss');
  });
});
