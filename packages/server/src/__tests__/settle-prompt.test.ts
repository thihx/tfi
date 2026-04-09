import { describe, expect, test } from 'vitest';
import {
  buildSettlePrompt,
  parseAISettleResponse,
  SETTLE_PROMPT_VERSION,
} from '../lib/settle-prompt.js';

const match = {
  matchId: '123',
  homeTeam: 'Team A',
  awayTeam: 'Team B',
  homeScore: 1,
  awayScore: 1,
  finalStatus: 'AET',
  settlementScope: 'regular_time' as const,
  statistics: [],
};

const bets = [
  { id: 1, market: 'cards_over_4.5', selection: 'Cards Over 4.5', odds: 1.9, stakePercent: 1 },
  { id: 2, market: 'unsupported_market', selection: 'Unsupported', odds: 2.1, stakePercent: 1 },
];

describe('settle prompt', () => {
  test('includes version and unresolved policy', () => {
    const prompt = buildSettlePrompt(match, bets);
    expect(prompt).toContain(`SETTLE_PROMPT_VERSION=${SETTLE_PROMPT_VERSION}`);
    expect(prompt).toContain('Settlement scope: regular time only');
    expect(prompt).toContain('Missing data is NOT a push');
    expect(prompt).toContain('"unresolved"');
  });

  test('includes half-time score when ht scores are provided', () => {
    const prompt = buildSettlePrompt({ ...match, htHomeScore: 1, htAwayScore: 0 }, bets);
    expect(prompt).toContain('Half-time (1st half) score: 1-0');
    expect(prompt).toContain('bet_market starts with "ht_"');
  });

  test('parses only exact valid batches', () => {
    const parsed = parseAISettleResponse(JSON.stringify([
      { id: 1, result: 'unresolved', explanation: 'Khong du thong ke' },
      { id: 2, result: 'void', explanation: 'Khong ap dung market' },
    ]), bets);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.result).toBe('unresolved');
    expect(parsed[1]!.result).toBe('void');
  });

  test('rejects duplicate ids', () => {
    const parsed = parseAISettleResponse(JSON.stringify([
      { id: 1, result: 'win', explanation: 'ok' },
      { id: 1, result: 'loss', explanation: 'dup' },
    ]), bets);

    expect(parsed).toHaveLength(0);
  });

  test('rejects missing items', () => {
    const parsed = parseAISettleResponse(JSON.stringify([
      { id: 1, result: 'win', explanation: 'ok' },
    ]), bets);

    expect(parsed).toHaveLength(0);
  });
});
