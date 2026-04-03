import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import {
  evaluateRecommendationDeliveryConditions,
  getEligibleTelegramDeliveryTargets,
  getEligibleDeliveryUserIds,
  getPendingTelegramDeliveries,
  getRecommendationDeliveriesByUserId,
  markRecommendationDeliveriesDelivered,
  stageRecommendationDeliveries,
  updateRecommendationDeliveryFlags,
} from '../repos/recommendation-deliveries.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recommendation deliveries repository', () => {
  test('stageRecommendationDeliveries stages active watch subscribers for a recommendation', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 2 }),
    };

    const count = await stageRecommendationDeliveries(db, {
      id: 11,
      match_id: 'match-1',
      timestamp: '2026-03-24T12:30:00.000Z',
      selection: 'Over 2.5 Goals',
      bet_market: 'over_2.5',
      odds: 1.91,
      confidence: 7,
      risk_level: 'MEDIUM',
    });

    expect(count).toBe(2);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_recommendation_deliveries'),
      [11, 'match-1', '2026-03-24T12:30:00.000Z', 'Over 2.5 Goals', 'over_2.5', 1.91, 7, 'MEDIUM'],
    );
  });

  test('getRecommendationDeliveriesByUserId normalizes rows and respects filters', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            user_id: 'user-1',
            recommendation_id: 3,
            match_id: 'match-1',
            matched_condition: true,
            eligibility_status: 'eligible',
            delivery_status: 'pending',
            delivery_channels: null,
            delivered_at: null,
            hidden: false,
            dismissed: false,
            metadata: null,
            created_at: '2026-03-24T12:30:00.000Z',
            recommendation_timestamp: '2026-03-24T12:30:00.000Z',
            recommendation_selection: 'Over 2.5 Goals',
            recommendation_bet_market: 'over_2.5',
            recommendation_odds: 1.91,
            recommendation_confidence: 7,
            recommendation_risk_level: 'MEDIUM',
            recommendation_reasoning: 'test',
            recommendation_reasoning_vi: 'test',
            recommendation_home_team: 'A',
            recommendation_away_team: 'B',
            recommendation_league: 'League',
            recommendation_result: null,
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);

    const result = await getRecommendationDeliveriesByUserId('user-1', {
      limit: 10,
      offset: 5,
      matchId: 'match-1',
      eligibilityStatus: 'eligible',
      deliveryStatus: 'pending',
    });

    expect(result.total).toBe(1);
    expect(result.rows[0]?.delivery_channels).toEqual([]);
    expect(result.rows[0]?.metadata).toEqual({});
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE d.user_id = $1 AND d.hidden = FALSE AND d.match_id = $2 AND d.eligibility_status = $3 AND d.delivery_status = $4'),
      ['user-1', 'match-1', 'eligible', 'pending', 10, 5],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM user_recommendation_deliveries d'),
      ['user-1', 'match-1', 'eligible', 'pending'],
    );
  });

  test('getRecommendationDeliveriesByUserId supports review filter through recommendation settlement state', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

    await getRecommendationDeliveriesByUserId('user-1', {
      result: 'review',
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("COALESCE(r.settlement_status, NULLIF(d.metadata->>'recommendation_settlement_status', ''), 'pending') = 'unresolved' AND r.result IN ('win', 'loss', 'push', 'void', 'half_win', 'half_loss')"),
      ['user-1', 50, 0],
    );
  });

  test('getRecommendationDeliveriesByUserId supports correct filter through grouped results', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

    await getRecommendationDeliveriesByUserId('user-1', {
      result: 'correct',
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("r.result IN ('win', 'half_win')"),
      ['user-1', 50, 0],
    );
  });

  test('getEligibleDeliveryUserIds returns eligible user ids only', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
    } as never);

    const result = await getEligibleDeliveryUserIds(99);

    expect([...result]).toEqual(['user-1', 'user-2']);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("delivery_status = 'pending'"),
      [99],
    );
  });

  test('getEligibleTelegramDeliveryTargets returns enabled pending telegram recipients only', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { user_id: 'user-1', chat_id: '1001' },
        { user_id: 'user-2', chat_id: '1002' },
      ],
    } as never);

    const result = await getEligibleTelegramDeliveryTargets(99);

    expect(result).toEqual([
      { userId: 'user-1', chatId: '1001' },
      { userId: 'user-2', chatId: '1002' },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("d.delivery_status = 'pending'"),
      [99],
    );
  });

  test('getPendingTelegramDeliveries joins notification settings using text-compatible user id', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{
        delivery_id: 10,
        user_id: 'user-1',
        chat_id: '1001',
        notification_language: 'vi',
        recommendation_id: 3,
        match_id: 'match-1',
        metadata: {},
        created_at: '2026-03-24T12:30:00.000Z',
        recommendation_timestamp: '2026-03-24T12:30:00.000Z',
        recommendation_minute: 59,
        recommendation_score: '0-0',
        recommendation_bet_type: 'totals',
        recommendation_selection: 'Under 2.5 Goals',
        recommendation_bet_market: 'under_2.5',
        recommendation_odds: 1.91,
        recommendation_confidence: 7,
        recommendation_value_percent: 12,
        recommendation_risk_level: 'MEDIUM',
        recommendation_stake_percent: 3,
        recommendation_reasoning: 'test',
        recommendation_reasoning_vi: 'kiem tra',
        recommendation_warnings: null,
        recommendation_home_team: 'A',
        recommendation_away_team: 'B',
        recommendation_league: 'League',
        recommendation_status: 'pending',
        recommendation_ai_model: 'gemini',
        recommendation_mode: 'B',
      }],
    } as never);

    const rows = await getPendingTelegramDeliveries(5);

    expect(rows).toHaveLength(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ON ns.user_id = d.user_id::text'),
      [5],
    );
  });

  test('evaluateRecommendationDeliveryConditions promotes supported matched rows to eligible', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [{ id: 71, metadata: { custom_condition_text: '(Minute >= 60) AND (NOT Home leading)' } }],
      } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never);

    const updated = await evaluateRecommendationDeliveryConditions({ query: vi.mocked(query) }, {
      id: 99,
      minute: 65,
      score: '1-1',
      stats_snapshot: {},
    });

    expect(updated).toBe(1);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("eligibility_status = $4"),
      [71, 99, true, 'eligible', 'pending', 'Condition matched: Minute >= 60 AND NOT Home leading'],
    );
  });

  test('evaluateRecommendationDeliveryConditions suppresses supported unmatched rows', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [{ id: 72, metadata: { custom_condition_text: '(Minute >= 70) AND (Total goals <= 1)' } }],
      } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never);

    const updated = await evaluateRecommendationDeliveryConditions({ query: vi.mocked(query) }, {
      id: 99,
      minute: 65,
      score: '1-1',
      stats_snapshot: {},
    });

    expect(updated).toBe(1);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("delivery_status = $5"),
      [72, 99, false, 'condition_not_matched', 'suppressed', 'Condition not matched: Minute >= 70'],
    );
  });

  test('evaluateRecommendationDeliveryConditions skips unsupported clauses', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: 73, metadata: { custom_condition_text: 'If score is 0-0 at 60, bet Under 1.5' } }],
    } as never);

    const updated = await evaluateRecommendationDeliveryConditions({ query: vi.mocked(query) }, {
      id: 99,
      minute: 65,
      score: '0-0',
      stats_snapshot: {},
    });

    expect(updated).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('markRecommendationDeliveriesDelivered appends channel and updates only pending eligible rows', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 2 } as never);

    const updated = await markRecommendationDeliveriesDelivered(99, ['user-1', 'user-2'], 'web_push');

    expect(updated).toBe(2);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("delivery_status = 'delivered'"),
      [99, ['user-1', 'user-2'], 'web_push'],
    );
    expect(String(vi.mocked(query).mock.calls[0]?.[0])).toContain("AND delivery_status = 'pending'");
  });

  test('updateRecommendationDeliveryFlags returns false when nothing is requested', async () => {
    const updated = await updateRecommendationDeliveryFlags('user-1', 55, {});

    expect(updated).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  test('updateRecommendationDeliveryFlags updates user owned delivery row', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1 } as never);

    const updated = await updateRecommendationDeliveryFlags('user-1', 55, {
      hidden: true,
      dismissed: true,
    });

    expect(updated).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET hidden = $3, dismissed = $4'),
      ['user-1', 55, true, true],
    );
  });
});
