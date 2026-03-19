// ============================================================
// Unit tests — auto-settle AI-based settlement
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock all repo/db modules to avoid pool.ts import chain
vi.mock('../repos/recommendations.repo.js', () => ({
  getAllRecommendations: vi.fn(),
  settleRecommendation: vi.fn(),
}));
vi.mock('../repos/bets.repo.js', () => ({
  getUnsettledBets: vi.fn(),
  settleBet: vi.fn(),
}));
vi.mock('../repos/matches-history.repo.js', () => ({
  getHistoricalMatch: vi.fn(),
  archiveFinishedMatches: vi.fn(),
}));
vi.mock('../repos/ai-performance.repo.js', () => ({
  settleAiPerformance: vi.fn(),
}));
vi.mock('../lib/football-api.js', () => ({
  fetchFixturesByIds: vi.fn(),
  fetchFixtureStatistics: vi.fn(),
}));
vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

// Mock callGemini
vi.mock('../lib/gemini.js', () => ({
  callGemini: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: { geminiApiKey: 'test-key', geminiModel: 'test-model' },
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
  describe('Over/Under Goals', () => {
    test('over 2.5 wins when 3 goals', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'Tổng bàn thắng là 3, vượt mức 2.5' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 2, awayScore: 1 }), makeBets());
      expect(results).toHaveLength(1);
      expect(results[0]!.result).toBe('win');
      expect(results[0]!.explanation).toContain('3');
    });

    test('over 2.5 loses when 1 goal', async () => {
      mockAIResponse([{ id: 1, result: 'loss', explanation: 'Tổng bàn thắng là 1, không vượt mức 2.5' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 1, awayScore: 0 }), makeBets());
      expect(results[0]!.result).toBe('loss');
    });

    test('push when total equals line', async () => {
      mockAIResponse([{ id: 1, result: 'push', explanation: 'Tổng bàn thắng bằng đúng line 2.0' }]);
      const bets = makeBets([{ market: 'ou2.0', selection: 'Over 2.0' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 1, awayScore: 1 }), bets);
      expect(results[0]!.result).toBe('push');
    });
  });

  describe('BTTS', () => {
    test('BTTS yes wins when both score', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'Cả hai đội đều ghi bàn (1-2)' }]);
      const bets = makeBets([{ market: 'btts_yes', selection: 'BTTS Yes' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 1, awayScore: 2 }), bets);
      expect(results[0]!.result).toBe('win');
    });

    test('BTTS yes loses when one team blank', async () => {
      mockAIResponse([{ id: 1, result: 'loss', explanation: 'Chỉ đội nhà ghi bàn (2-0)' }]);
      const bets = makeBets([{ market: 'btts_yes', selection: 'BTTS Yes' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 2, awayScore: 0 }), bets);
      expect(results[0]!.result).toBe('loss');
    });
  });

  describe('1X2', () => {
    test('home win', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'Đội nhà thắng 2-0' }]);
      const bets = makeBets([{ market: '1x2_home', selection: 'Home Win' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 2, awayScore: 0 }), bets);
      expect(results[0]!.result).toBe('win');
    });

    test('home pick loses on away win', async () => {
      mockAIResponse([{ id: 1, result: 'loss', explanation: 'Đội khách thắng 0-1' }]);
      const bets = makeBets([{ market: '1x2_home', selection: 'Home Win' }]);
      const results = await settleWithAI(makeMatch({ homeScore: 0, awayScore: 1 }), bets);
      expect(results[0]!.result).toBe('loss');
    });
  });

  describe('Corners (with statistics)', () => {
    test('corners over 9.5 wins when 11 corners', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'Tổng corners là 11, vượt mức 9.5' }]);
      const match = makeMatch({
        statistics: [
          { type: 'Corner Kicks', home: 6, away: 5 },
          { type: 'Yellow Cards', home: 2, away: 3 },
        ],
      });
      const bets = makeBets([{ market: 'corners_over_9.5', selection: 'Corners Over 9.5 @1.9' }]);
      const results = await settleWithAI(match, bets);
      expect(results[0]!.result).toBe('win');
      expect(results[0]!.explanation).toContain('11');
    });

    test('corners over 8.5 loses when only 6 corners (not goals)', async () => {
      mockAIResponse([{ id: 1, result: 'loss', explanation: 'Tổng corners là 6, không vượt mức 8.5' }]);
      const match = makeMatch({
        homeScore: 5, awayScore: 4, // 9 goals but only 6 corners
        statistics: [
          { type: 'Corner Kicks', home: 3, away: 3 },
        ],
      });
      const bets = makeBets([{ market: 'corners_over_8.5', selection: 'Corners Over 8.5' }]);
      const results = await settleWithAI(match, bets);
      expect(results[0]!.result).toBe('loss');
    });
  });

  describe('Multiple bets per match', () => {
    test('settles multiple bets in one AI call', async () => {
      mockAIResponse([
        { id: 1, result: 'win', explanation: 'Tổng bàn thắng là 3, vượt mức 2.5' },
        { id: 2, result: 'loss', explanation: 'Đội khách thắng 1-2, kèo Home Win thua' },
        { id: 3, result: 'win', explanation: 'Cả hai đội đều ghi bàn' },
      ]);
      const bets = makeBets([
        { id: 1, market: 'over_2.5', selection: 'Over 2.5' },
        { id: 2, market: '1x2_home', selection: 'Home Win' },
        { id: 3, market: 'btts_yes', selection: 'BTTS Yes' },
      ]);
      const results = await settleWithAI(makeMatch({ homeScore: 1, awayScore: 2 }), bets);
      expect(results).toHaveLength(3);
      expect(results[0]!.result).toBe('win');
      expect(results[1]!.result).toBe('loss');
      expect(results[2]!.result).toBe('win');
    });
  });

  describe('AI response parsing', () => {
    test('handles AI response with markdown wrapper', async () => {
      mockCallGemini.mockResolvedValueOnce('```json\n[{"id": 1, "result": "win", "explanation": "test"}]\n```');
      const results = await settleWithAI(makeMatch(), makeBets());
      expect(results).toHaveLength(1);
      expect(results[0]!.result).toBe('win');
    });

    test('returns empty array on invalid JSON', async () => {
      mockCallGemini.mockResolvedValueOnce('Sorry, I cannot help with that.');
      const results = await settleWithAI(makeMatch(), makeBets());
      expect(results).toHaveLength(0);
    });

    test('filters out invalid result values', async () => {
      mockCallGemini.mockResolvedValueOnce(JSON.stringify([
        { id: 1, result: 'win', explanation: 'ok' },
        { id: 2, result: 'invalid', explanation: 'bad' },
      ]));
      const bets = makeBets([{ id: 1 }, { id: 2 }]);
      const results = await settleWithAI(makeMatch(), bets);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(1);
    });

    test('filters out IDs not in bet list', async () => {
      mockCallGemini.mockResolvedValueOnce(JSON.stringify([
        { id: 1, result: 'win', explanation: 'ok' },
        { id: 999, result: 'loss', explanation: 'unknown bet' },
      ]));
      const results = await settleWithAI(makeMatch(), makeBets([{ id: 1 }]));
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(1);
    });

    test('truncates long explanations to 500 chars', async () => {
      const longExplanation = 'A'.repeat(600);
      mockAIResponse([{ id: 1, result: 'win', explanation: longExplanation }]);
      const results = await settleWithAI(makeMatch(), makeBets());
      expect(results[0]!.explanation.length).toBeLessThanOrEqual(500);
    });
  });

  describe('prompt includes correct data', () => {
    test('passes match statistics to AI prompt', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'test' }]);
      const match = makeMatch({
        statistics: [
          { type: 'Corner Kicks', home: 7, away: 4 },
          { type: 'Ball Possession', home: '60%', away: '40%' },
        ],
      });
      await settleWithAI(match, makeBets());

      const promptArg = mockCallGemini.mock.calls[0]![0];
      expect(promptArg).toContain('Corner Kicks');
      expect(promptArg).toContain('7');
      expect(promptArg).toContain('Ball Possession');
    });

    test('includes total goals in prompt', async () => {
      mockAIResponse([{ id: 1, result: 'win', explanation: 'test' }]);
      await settleWithAI(makeMatch({ homeScore: 3, awayScore: 2 }), makeBets());

      const promptArg = mockCallGemini.mock.calls[0]![0];
      expect(promptArg).toContain('5'); // total goals
    });

    test('calls Gemini once per settleWithAI invocation', async () => {
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
