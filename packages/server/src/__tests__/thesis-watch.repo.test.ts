import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import {
  expireDueThesisWatches,
  markThesisWatchPromoted,
  purgeOldThesisWatches,
  upsertPendingThesisWatch,
} from '../repos/thesis-watch.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('thesis-watch repository', () => {
  it('persists the initial snapshot when creating a pending watch', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          match_id: 'fixture-1',
          watch_key: 'goals_over_line::over_2.5',
          status: 'pending',
          gate_type: 'goals_over_line',
          gate_payload: { intendedMarketLine: 2.5 },
          selection: 'Over 2.5 Goals',
          bet_market: 'over_2.5',
          confidence: 8,
          value_percent: 6,
          stake_percent: 2,
          risk_level: 'MEDIUM',
          reasoning_en: 'Wait for lower line.',
          reasoning_vi: '',
          source: 'llp_defer',
          last_block_reason: 'LLP_BLOCK_OVER_AGGRESSIVE_LINE',
          initial_snapshot: { minute: 55, score: '1-0' },
          promote_snapshot: {},
          promote_reason: {},
          promoted_recommendation_id: null,
          created_at: '2026-05-25T10:00:00.000Z',
          updated_at: '2026-05-25T10:00:00.000Z',
          expires_at: '2026-05-25T10:30:00.000Z',
          promoted_at: null,
        }],
      } as never);

    const expiresAt = new Date('2026-05-25T10:30:00.000Z');
    const row = await upsertPendingThesisWatch('fixture-1', {
      watchKey: 'goals_over_line::over_2.5',
      gateType: 'goals_over_line',
      gatePayload: { intendedMarketLine: 2.5 },
      selection: 'Over 2.5 Goals',
      betMarket: 'over_2.5',
      confidence: 8,
      valuePercent: 6,
      stakePercent: 2,
      riskLevel: 'MEDIUM',
      reasoningEn: 'Wait for lower line.',
      reasoningVi: '',
      lastBlockReason: 'LLP_BLOCK_OVER_AGGRESSIVE_LINE',
      initialSnapshot: { minute: 55, score: '1-0' },
    }, expiresAt);

    expect(row.initial_snapshot).toEqual({ minute: 55, score: '1-0' });
    expect(String(vi.mocked(query).mock.calls[1]?.[0])).toContain('initial_snapshot');
    expect(vi.mocked(query).mock.calls[1]?.[1]).toContain(JSON.stringify({ minute: 55, score: '1-0' }));
  });

  it('stores promotion snapshot, reason, and linked recommendation id', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1 } as never);

    await markThesisWatchPromoted(7, {
      recommendationId: 42,
      promoteSnapshot: {
        minute: 62,
        score: '1-0',
        selection: 'Over 1 Goals',
        betMarket: 'over_1',
      },
      promoteReason: {
        watchKey: 'goals_over_line::over_2.5',
        gateType: 'goals_over_line',
        originalSelection: 'Over 2.5 Goals',
        promotedSelection: 'Over 1 Goals',
      },
    });

    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    const params = vi.mocked(query).mock.calls[0]?.[1] as unknown[];

    expect(sql).toContain("status = 'promoted'");
    expect(sql).toContain('promoted_recommendation_id = $2');
    expect(sql).toContain('promote_snapshot = $3::jsonb');
    expect(sql).toContain('promote_reason = $4::jsonb');
    expect(params[0]).toBe(7);
    expect(params[1]).toBe(42);
    expect(JSON.parse(String(params[2]))).toMatchObject({
      minute: 62,
      selection: 'Over 1 Goals',
    });
    expect(JSON.parse(String(params[3]))).toMatchObject({
      watchKey: 'goals_over_line::over_2.5',
      promotedSelection: 'Over 1 Goals',
    });
  });

  it('expires due pending thesis watches', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 3 } as never);

    const expired = await expireDueThesisWatches();

    expect(expired).toBe(3);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('expires_at <= NOW()');
  });

  it('purges old inactive thesis watches after retention', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 4 } as never);

    const deleted = await purgeOldThesisWatches(30);

    expect(deleted).toBe(4);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    const params = vi.mocked(query).mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain("status IN ('expired', 'cancelled', 'promoted')");
    expect(sql).toContain("INTERVAL '1 day' * $1");
    expect(params[0]).toBe(30);
  });
});
