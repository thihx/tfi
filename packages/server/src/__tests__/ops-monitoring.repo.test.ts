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
          notify_eligible_24h: '8',
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
      })
      .mockResolvedValueOnce({
        rows: [{ runs: '4', shadow_rows: '4', shadow_successes: '4' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          compared: '4',
          same_should_push: '4',
          same_market: '3',
          active_avg_latency_ms: '19000',
          shadow_avg_latency_ms: '16000',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { diff_type: 'market_mismatch', count: '1' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            execution_role: 'active',
            prompt_version: 'v4-evidence-hardened',
            total: '4',
            successes: '4',
            avg_latency_ms: '19000',
            avg_prompt_tokens: '3500',
          },
          {
            execution_role: 'shadow',
            prompt_version: 'v5-compact-a',
            total: '4',
            successes: '4',
            avg_latency_ms: '16000',
            avg_prompt_tokens: '2000',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            match_id: 'm1',
            home_team: 'Atletico San Luis',
            away_team: 'Leon',
            minute: 82,
            score: '1-0',
            selection: 'Over 2.5 Goals @2.67',
            bet_market: 'over_2.5',
            stake_percent: 4,
            result: 'win',
            pnl: '6.7',
            odds: '2.67',
            confidence: '6',
          },
          {
            match_id: 'm1',
            home_team: 'Atletico San Luis',
            away_team: 'Leon',
            minute: 68,
            score: '1-0',
            selection: 'Over 2.75 Goals @1.92',
            bet_market: 'over_2.75',
            stake_percent: 5,
            result: 'push',
            pnl: '0',
            odds: '1.92',
            confidence: '7',
          },
          {
            match_id: 'm2',
            home_team: 'Sevilla',
            away_team: 'Valencia',
            minute: 61,
            score: '0-1',
            selection: 'Corners Under 10.5 @1.88',
            bet_market: 'corners_under_10.5',
            stake_percent: 3,
            result: '',
            pnl: '0',
            odds: '1.88',
            confidence: '5',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          total_rows: '12',
          strong_rows: '4',
          moderate_rows: '3',
          weak_rows: '3',
          none_rows: '2',
          full_rows: '4',
          partial_rows: '3',
          minimal_rows: '3',
          no_prematch_rows: '2',
          high_noise_rows: '2',
          avg_noise_penalty: '34.5',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            match_id: 'm2',
            match_display: 'West Ham vs Spurs',
            noise_penalty: '64',
            prematch_strength: 'weak',
            prematch_availability: 'minimal',
            prompt_data_level: 'basic-only',
            analyzed_at: '2026-03-21T09:55:00.000Z',
          },
        ],
      });

    const snapshot = await getOpsMonitoringSnapshot();

    expect(snapshot.pipeline.analyzed24h).toBe(20);
    expect(snapshot.pipeline.notifyEligibleRate24h).toBe(40);
    expect(snapshot.providers.statsSuccessRate).toBe(80);
    expect(snapshot.providers.oddsUsableRate).toBe(75);
    expect(snapshot.settlement.recommendationPending).toBe(5);
    expect(snapshot.notifications.failureRate24h).toBe(10);
    expect(snapshot.promptShadow.shouldPushAgreementRate24h).toBe(100);
    expect(snapshot.promptShadow.marketAgreementRate24h).toBe(75);
    expect(snapshot.promptQuality.sameThesisClusters).toBe(1);
    expect(snapshot.promptQuality.cornersRows).toBe(1);
    expect(snapshot.promptQuality.lateHighLineRows).toBe(2);
    expect(snapshot.promptQuality.prematch.highNoiseRate).toBe(16.7);
    expect(snapshot.promptQuality.prematch.avgNoisePenalty).toBe(34.5);
    expect(snapshot.promptQuality.prematch.topHighNoiseMatches[0]?.matchDisplay).toBe('West Ham vs Spurs');
    expect(snapshot.cards.find((card) => card.label === 'Notify-Eligible Rate 24h')?.value).toBe('40%');
    expect(snapshot.cards.find((card) => card.label === 'Prematch High Noise 24h')?.value).toBe('16.7%');
    expect(snapshot.cards.find((card) => card.label === 'Prompt Agree 24h')?.value).toBe('100%');
    expect(snapshot.cards.find((card) => card.label === 'Stacking Rate 24h')?.value).toBe('66.7%');
    expect(snapshot.checklist.some((item) => item.id === 'settlement-backlog')).toBe(true);
  });
});
