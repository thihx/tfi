// ============================================================
// Unit tests - auto-settle AI fallback settlement
// ============================================================

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../repos/recommendations.repo.js', () => ({
  getAllRecommendations: vi.fn(),
  settleRecommendation: vi.fn(),
  markRecommendationUnresolved: vi.fn(),
}));
vi.mock('../repos/bets.repo.js', () => ({
  getUnsettledBets: vi.fn(),
  settleBet: vi.fn(),
  markBetUnresolved: vi.fn(),
}));
vi.mock('../repos/matches-history.repo.js', () => ({
  getHistoricalMatch: vi.fn(),
  archiveFinishedMatches: vi.fn(),
}));
vi.mock('../repos/ai-performance.repo.js', () => ({
  settleAiPerformance: vi.fn(),
  markAiPerformanceSettlementState: vi.fn(),
}));
vi.mock('../lib/football-api.js', () => ({
  fetchFixturesByIds: vi.fn(),
  fetchFixtureStatistics: vi.fn(),
}));
vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));
vi.mock('../lib/gemini.js', () => ({
  callGemini: vi.fn(),
}));
vi.mock('../config.js', () => ({
  config: { geminiApiKey: 'test-key', geminiModel: 'test-model' },
}));
vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
  auditSuccess: vi.fn(),
  auditFailure: vi.fn(),
  auditSkipped: vi.fn(),
  auditWrap: vi.fn(),
}));

import { settleWithAI, type AISettleResult } from '../jobs/auto-settle.job.js';
import { callGemini } from '../lib/gemini.js';

const mockCallGemini = vi.mocked(callGemini);

function makeMatch(overrides: Partial<Parameters<typeof settleWithAI>[0]> = {}) {
  return {
    matchId: '123',
    homeTeam: 'Team A',
    awayTeam: 'Team B',
    homeScore: 2,
    awayScore: 1,
    finalStatus: 'FT',
    settlementScope: 'regular_time' as const,
    ...overrides,
  };
}

function makeBets(bets: Array<Partial<Parameters<typeof settleWithAI>[1][0]>> = [{}]) {
  return bets.map((b, i) => ({
    id: i + 1,
    market: 'over_2.5',
    selection: 'Over 2.5 Goals @1.85',
    odds: 1.85,
    stakePercent: 1,
    ...b,
  }));
}

function mockAIResponse(results: AISettleResult[]) {
  mockCallGemini.mockResolvedValueOnce(JSON.stringify(results));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settleWithAI', () => {
  describe('basic unsupported market fallback', () => {
    test('returns win for over 2.5 when AI says win', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'Tong ban thang la 3, vuot muc 2.5' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 2, awayScore: 1 }), makeBets());
      expect(results).toHaveLength(1);
      expect(results[0]!.result).toBe('win');
      expect(results[0]!.explanation).toContain('3');
    });

    test('returns loss for over 2.5 when AI says loss', async () => {
      mockAIResponse([{ id: 1, result: 'loss', explanation: 'Tong ban thang la 1, khong vuot muc 2.5' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 1, awayScore: 0 }), makeBets());
      expect(results[0]!.result).toBe('loss');
    });

    test('supports push when AI returns push', async () => {
      mockAIResponse([{ id: 1, result: 'push', explanation: 'Tong ban thang bang dung line 2.0' }]);
      const bets = makeBets([{ market: 'ou2.0', selection: 'Over 2.0' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 1, awayScore: 1 }), bets);
      expect(results[0]!.result).toBe('push');
    });

    test('supports unresolved when AI says official evidence is missing', async () => {
      mockAIResponse([{ id: 1, result: 'unresolved', explanation: 'Khong du thong ke chinh thuc' }]);
      const bets = makeBets([{ market: 'cards_over_4.5', selection: 'Cards Over 4.5' }]);
      const results = await settleWithAI(makeMatch(), bets);
      expect(results).toHaveLength(1);
      expect(results[0]!.result).toBe('unresolved');
    });
  });

  describe('multiple bets', () => {
    test('parses a full batch only when all items are present', async () => {
      mockAIResponse([
        { id: 1, result: 'win', explanation: 'a' },
        { id: 2, result: 'loss', explanation: 'b' },
        { id: 3, result: 'win', explanation: 'c' },
      ]);
      const bets = makeBets([
        { id: 1, market: 'over_2.5', selection: 'Over 2.5' },
        { id: 2, market: '1x2_home', selection: 'Home Win' },
        { id: 3, market: 'btts_yes', selection: 'BTTS Yes' },
      ]);
      const results = await settleWithAI(makeMatch({ homeScore: 1, awayScore: 2 }), bets);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.result)).toEqual(['win', 'loss', 'win']);
    });
  });

  describe('strict parser', () => {
    test('accepts markdown-wrapped JSON', async () => {
      mockCallGemini.mockResolvedValueOnce('```json\n[{"id":1,"result":"win","explanation":"test"}]\n```');
      const results = await settleWithAI(makeMatch(), makeBets());
      expect(results).toHaveLength(1);
      expect(results[0]!.result).toBe('win');
    });

    test('returns empty array on invalid JSON', async () => {
      mockCallGemini.mockResolvedValueOnce('Sorry, I cannot help with that.');
      const results = await settleWithAI(makeMatch(), makeBets());
      expect(results).toHaveLength(0);
    });

    test('rejects invalid result values', async () => {
      mockCallGemini.mockResolvedValueOnce(JSON.stringify([
        { id: 1, result: 'win', explanation: 'ok' },
        { id: 2, result: 'invalid', explanation: 'bad' },
      ]));
      const results = await settleWithAI(makeMatch(), makeBets([{ id: 1 }, { id: 2 }]));
      expect(results).toHaveLength(0);
    });

    test('rejects foreign IDs', async () => {
      mockCallGemini.mockResolvedValueOnce(JSON.stringify([
        { id: 1, result: 'win', explanation: 'ok' },
        { id: 999, result: 'loss', explanation: 'unknown bet' },
      ]));
      const results = await settleWithAI(makeMatch(), makeBets([{ id: 1 }]));
      expect(results).toHaveLength(0);
    });

    test('rejects duplicate IDs', async () => {
      mockCallGemini.mockResolvedValueOnce(JSON.stringify([
        { id: 1, result: 'win', explanation: 'ok' },
        { id: 1, result: 'loss', explanation: 'duplicate' },
      ]));
      const results = await settleWithAI(makeMatch(), makeBets([{ id: 1 }, { id: 2 }]));
      expect(results).toHaveLength(0);
    });

    test('rejects missing items', async () => {
      mockCallGemini.mockResolvedValueOnce(JSON.stringify([
        { id: 1, result: 'win', explanation: 'ok' },
      ]));
      const results = await settleWithAI(makeMatch(), makeBets([{ id: 1 }, { id: 2 }]));
      expect(results).toHaveLength(0);
    });

    test('truncates long explanations to 500 chars', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'A'.repeat(600) }]);
      const results = await settleWithAI(makeMatch(), makeBets());
      expect(results[0]!.explanation.length).toBeLessThanOrEqual(500);
    });
  });

  describe('prompt content', () => {
    test('passes statistics into the AI prompt', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'test' }]);
      const match = makeMatch({
        statistics: [
          { type: 'Corner Kicks', home: 7, away: 4 },
          { type: 'Ball Possession', home: '60%', away: '40%' },
        ],
      });

      await settleWithAI(match, makeBets([{ market: 'unsupported_market', selection: 'Unsupported' }]));

      const promptArg = mockCallGemini.mock.calls[0]![0];
      expect(promptArg).toContain('Corner Kicks');
      expect(promptArg).toContain('Ball Possession');
      expect(promptArg).toContain('Only use official evidence');
    });

    test('declares regular-time scope and unresolved policy for AET matches', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'test' }]);
      await settleWithAI(
        makeMatch({ homeScore: 1, awayScore: 1, finalStatus: 'AET' }),
        makeBets([{ market: 'unsupported_market', selection: 'Unsupported' }]),
      );

      const promptArg = mockCallGemini.mock.calls[0]![0];
      expect(promptArg).toContain('Official final status: AET');
      expect(promptArg).toContain('Settlement scope: regular time only');
      expect(promptArg).toContain('Missing data is NOT a push');
      expect(promptArg).toContain('"unresolved"');
    });

    test('calls Gemini once per invocation', async () => {
      mockAIResponse([
        { id: 1, result: 'win', explanation: 'a' },
        { id: 2, result: 'loss', explanation: 'b' },
      ]);
      const bets = makeBets([{ id: 1 }, { id: 2 }]);
      await settleWithAI(makeMatch(), bets);
      expect(mockCallGemini).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    test('throws when Gemini API fails', async () => {
      mockCallGemini.mockRejectedValueOnce(new Error('API 500'));
      await expect(settleWithAI(makeMatch(), makeBets())).rejects.toThrow('API 500');
    });
  });
});
