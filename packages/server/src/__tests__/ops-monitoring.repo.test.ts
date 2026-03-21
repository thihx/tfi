import { beforeEach, describe, expect, test, vi } from 'vitest';

const query = vi.fn();

vi.mock('../db/pool.js', () => ({
  query,
}));

const { buildOpsChecklist, getOpsMonitoringSnapshot } = await import('../repos/ops-monitoring.repo.js');

describe('ops-monitoring.repo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('buildOpsChecklist returns pass/warn/fail states from thresholds', () => {
    const checklist = buildOpsChecklist({
      activityLast2h: 0,
      jobFailures24h: 2,
      statsSamples: 10,
      statsSuccessRate: 60,
      oddsSamples: 10,
      oddsUsableRate: 40,
      settlementBacklog: 250,
      unresolvedCount: 70,
      notificationAttempts24h: 0,
      notificationFailureRate24h: 0,
    });

    expect(checklist.find((item) => item.id === 'pipeline-activity')?.status).toBe('warn');
    expect(checklist.find((item) => item.id === 'job-failures')?.status).toBe('warn');
    expect(checklist.find((item) => item.id === 'stats-provider-coverage')?.status).toBe('warn');
    expect(checklist.find((item) => item.id === 'odds-provider-coverage')?.status).toBe('fail');
    expect(checklist.find((item) => item.id === 'settlement-backlog')?.status).toBe('fail');
    expect(checklist.find((item) => item.id === 'notification-health')?.status).toBe('warn');
  });

  test('getOpsMonitoringSnapshot maps aggregate query results into snapshot', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          activity_2h: '12',
          analyzed_24h: '20',
          should_push_24h: '8',
          saved_24h: '10',
          notified_24h: '6',
          skipped_24h: '5',
          errors_24h: '1',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { reason: 'stale_state', count: '3' },
          { reason: 'insufficient_stats', count: '2' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { action: 'JOB_FETCH_MATCHES', count: '1' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: '10', successes: '8' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            provider: 'api-football',
            total: '10',
            successes: '8',
            avg_latency_ms: '450',
            possession_hits: '7',
            sot_hits: '6',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: '12', usable: '9' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            provider: 'api-football',
            source: 'live',
            total: '12',
            usable: '9',
            avg_latency_ms: '500',
            one_x2_hits: '9',
            ou_hits: '10',
            ah_hits: '8',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          rec_pending: '5',
          rec_unresolved: '2',
          rec_corrected_7d: '1',
          bet_pending: '4',
          bet_unresolved: '1',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { method: 'rules', count: '7' },
          { method: 'ai', count: '2' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { market: 'corners_over_9.5', count: '2' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          attempts: '10',
          failures: '1',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ count: '6' }],
      });

    const snapshot = await getOpsMonitoringSnapshot();

    expect(snapshot.pipeline.analyzed24h).toBe(20);
    expect(snapshot.pipeline.pushRate24h).toBe(40);
    expect(snapshot.providers.statsSuccessRate).toBe(80);
    expect(snapshot.providers.oddsUsableRate).toBe(75);
    expect(snapshot.settlement.recommendationPending).toBe(5);
    expect(snapshot.notifications.failureRate24h).toBe(10);
    expect(snapshot.cards.find((card) => card.label === 'Push Rate 24h')?.value).toBe('40%');
    expect(snapshot.checklist.some((item) => item.id === 'settlement-backlog')).toBe(true);
  });
});
