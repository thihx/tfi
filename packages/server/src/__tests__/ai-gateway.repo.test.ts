import { beforeEach, describe, expect, test, vi } from 'vitest';

const query = vi.fn();

vi.mock('../db/pool.js', () => ({
  query,
}));

const {
  closeAiGatewayBreaker,
  listAiGatewayIncidents,
} = await import('../repos/ai-gateway.repo.js');

describe('ai-gateway.repo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('listAiGatewayIncidents hides stale open incidents whose breaker is already closed', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await listAiGatewayIncidents(8);

    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain("WHERE NOT (i.status = 'open'");
    expect(sql).toContain("b.status = 'closed'");
    expect(query.mock.calls[0]?.[1]).toEqual([8]);
  });

  test('closeAiGatewayBreaker resolves open incidents tied to the breaker', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 42,
        created_at: '2026-06-14T00:00:00.000Z',
        updated_at: '2026-06-14T00:01:00.000Z',
        opened_at: '2026-06-14T00:00:00.000Z',
        closed_at: '2026-06-14T00:01:00.000Z',
        status: 'closed',
        scope_type: 'feature',
        scope_key: 'tfi.strategic_context',
        reason: 'loop_detected',
        severity: 'critical',
        opened_by: 'ai_gateway',
        metadata: {},
      }],
    });

    const row = await closeAiGatewayBreaker(42, 'admin@example.com', 'verified recovered');

    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('resolved_incidents AS');
    expect(sql).toContain("UPDATE ai_gateway_incidents");
    expect(sql).toContain("resolvedWithBreakerClose");
    expect(query.mock.calls[0]?.[1]).toEqual([42, 'admin@example.com', 'verified recovered']);
    expect(row?.status).toBe('closed');
  });
});
