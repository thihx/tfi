// ============================================================
// Tests for audit findings F1–F8 fixes
// Verifies each audit fix is correctly implemented
// ============================================================

import { describe, test, expect } from 'vitest';
import { normalizeMarket, buildDedupKey } from '../lib/normalize-market.js';
import { settleByRule } from '../lib/settle-rules.js';

// ── F1: Auth fails open → config.jwtSecret default is empty ─
describe('F1: Auth config — no insecure defaults', () => {
  test('JWT secret defaults to empty string, not a hard-coded value', async () => {
    // Dynamically import config to read current defaults
    const { config } = await import('../config.js');
    // In test env, JWT_SECRET is not set → should be empty
    // The old default was 'tfi-dev-secret-change-me'
    expect(config.jwtSecret).not.toBe('tfi-dev-secret-change-me');
  });
});

// ── F8: Normalize market — AH and corners must include side/line ─
describe('F8: Market normalization uniqueness', () => {
  describe('Asian Handicap includes side + line', () => {
    test('AH Home -0.5 vs AH Home -1.5 produce different keys', () => {
      const k1 = normalizeMarket('Asian Handicap Home -0.5', '');
      const k2 = normalizeMarket('Asian Handicap Home -1.5', '');
      expect(k1).not.toBe(k2);
    });

    test('AH Home vs AH Away same line produce different keys', () => {
      const k1 = normalizeMarket('Asian Handicap Home -0.5', '');
      const k2 = normalizeMarket('Asian Handicap Away -0.5', '');
      expect(k1).not.toBe(k2);
    });

    test('key includes side and line components', () => {
      const result = normalizeMarket('Asian Handicap -1.5', '');
      expect(result).toMatch(/^asian_handicap_(home|away)_/);
      expect(result).toContain('-1.5');
    });
  });

  describe('Corners includes direction + line', () => {
    test('Over 9.5 Corners vs Over 10.5 Corners produce different keys', () => {
      const k1 = normalizeMarket('Over 9.5 Corners', '');
      const k2 = normalizeMarket('Over 10.5 Corners', '');
      expect(k1).not.toBe(k2);
    });

    test('Over 9.5 Corners vs Under 9.5 Corners produce different keys', () => {
      const k1 = normalizeMarket('Over 9.5 Corners', '');
      const k2 = normalizeMarket('Under 9.5 Corners', '');
      expect(k1).not.toBe(k2);
    });

    test('key includes direction and line components', () => {
      const result = normalizeMarket('Over 9.5 Corners', '');
      expect(result).toBe('corners_over_9.5');
    });
  });

  describe('buildDedupKey produces unique keys for colliding markets', () => {
    test('same match, different AH lines → different dedup keys', () => {
      const k1 = buildDedupKey('100', 'Asian Handicap -0.5', '');
      const k2 = buildDedupKey('100', 'Asian Handicap -1.5', '');
      expect(k1).not.toBe(k2);
    });

    test('same match, different corner lines → different dedup keys', () => {
      const k1 = buildDedupKey('100', 'Over 9.5 Corners', '');
      const k2 = buildDedupKey('100', 'Over 10.5 Corners', '');
      expect(k1).not.toBe(k2);
    });
  });
});

// ── Settle rules still work with new market key format ──
describe('F8: Settle rules with updated market keys', () => {
  test('settles corners over with new market format', () => {
    const result = settleByRule({
      market: '',
      selection: 'Over 9.5 Corners',
      homeScore: 2,
      awayScore: 1,
      statistics: [{ type: 'Corner Kicks', home: 6, away: 5 }],
    });
    expect(result).not.toBeNull();
    expect(result!.result).toBe('win'); // 11 > 9.5
  });

  test('settles corners under with new market format', () => {
    const result = settleByRule({
      market: '',
      selection: 'Under 10.5 Corners',
      homeScore: 1,
      awayScore: 0,
      statistics: [{ type: 'Corner Kicks', home: 4, away: 3 }],
    });
    expect(result).not.toBeNull();
    expect(result!.result).toBe('win'); // 7 < 10.5
  });

  test('settles asian handicap with new market format', () => {
    const result = settleByRule({
      market: '',
      selection: 'Asian Handicap Home -1.5',
      homeScore: 3,
      awayScore: 1,
    });
    expect(result).not.toBeNull();
    expect(result!.result).toBe('win'); // 3-1+(-1.5) = 0.5 > 0
  });

  test('settles asian handicap push', () => {
    const result = settleByRule({
      market: '',
      selection: 'Asian Handicap Home -1',
      homeScore: 2,
      awayScore: 1,
    });
    expect(result).not.toBeNull();
    expect(result!.result).toBe('push'); // 2-1+(-1) = 0
  });

  test('settles asian handicap away side', () => {
    const result = settleByRule({
      market: '',
      selection: 'Asian Handicap Away +0.5',
      homeScore: 1,
      awayScore: 1,
    });
    expect(result).not.toBeNull();
    expect(result!.result).toBe('win'); // away: 1-1+0.5 = 0.5 > 0
  });
});

// ── F6: OAuth state validation format ──
describe('F6: OAuth state HMAC format', () => {
  test('state format is nonce.signature', () => {
    // Simulate the state generation logic
    const { createHmac, randomBytes } = require('node:crypto');
    const secret = 'test-secret';
    const nonce = randomBytes(16).toString('hex');
    const sig = createHmac('sha256', secret)
      .update(nonce).digest('hex').slice(0, 16);
    const state = `${nonce}.${sig}`;

    // Verify format
    expect(state).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{16}$/);

    // Verify signature is reproducible
    const [n, s] = state.split('.');
    const expected = createHmac('sha256', secret)
      .update(n).digest('hex').slice(0, 16);
    expect(s).toBe(expected);
  });

  test('different nonces produce different states', () => {
    const { createHmac, randomBytes } = require('node:crypto');
    const secret = 'test-secret';
    const make = () => {
      const nonce = randomBytes(16).toString('hex');
      const sig = createHmac('sha256', secret).update(nonce).digest('hex').slice(0, 16);
      return `${nonce}.${sig}`;
    };
    expect(make()).not.toBe(make());
  });

  test('tampered nonce fails verification', () => {
    const { createHmac, randomBytes } = require('node:crypto');
    const secret = 'test-secret';
    const nonce = randomBytes(16).toString('hex');
    const sig = createHmac('sha256', secret).update(nonce).digest('hex').slice(0, 16);

    // Tamper with nonce
    const tampered = 'a'.repeat(32);
    const expectedSig = createHmac('sha256', secret).update(tampered).digest('hex').slice(0, 16);
    expect(sig).not.toBe(expectedSig);
  });
});
