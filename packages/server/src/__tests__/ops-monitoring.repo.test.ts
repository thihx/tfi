import { beforeEach, describe, expect, test, vi } from 'vitest';

const query = vi.fn();

vi.mock('../db/pool.js', () => ({
  query,
}));

vi.mock('../config.js', () => ({
  config: {
    liveStatuses: ['1H', '2H'],
    pipelineEnabled: true,
    providerSamplingEnabled: true,
    fcmProjectId: 'firebase-project',
    fcmClientEmail: 'firebase@example.com',
    fcmPrivateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
    fcmServiceAccountJson: '',
    criticalFallbackSmsEstimatedUnitCostUsd: 0.05,
    criticalFallbackVoiceCallEstimatedUnitCostUsd: 0.25,
  },
}));

const {
  buildOpsChecklist,
  getOpsMonitoringSnapshot,
  shouldExpectProviderSamples,
} = await import('../repos/ops-monitoring.repo.js');

describe('ops-monitoring.repo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function checklistInput(
    overrides: Partial<Parameters<typeof buildOpsChecklist>[0]> = {},
  ): Parameters<typeof buildOpsChecklist>[0] {
    return {
      pipelineEnabled: true,
      activityLast2h: 0,
      analyzed24h: 0,
      activeWatchCount: 0,
      liveWatchCount: 0,
      providerSamplingEnabled: true,
      jobFailures24h: 0,
      activeJobFailures24h: 0,
      recoveredJobFailures24h: 0,
      statsSamples: 0,
      statsSuccessRate: 0,
      oddsSamples: 0,
      oddsUsableRate: 0,
      oddsTradableRate: 0,
      settlementBacklog: 0,
      unresolvedCount: 0,
      notificationAttempts24h: 0,
      notificationFailureRate24h: 0,
      notificationStalePending: 0,
      notificationExpected24h: false,
      prematchTotalRows: 0,
      prematchHighNoiseRows: 0,
      prematchHighNoiseRate: 0,
      funnelLiveDetected24h: 0,
      funnelSaved24h: 0,
      llmBlocked24h: 0,
      llmCompleted24h: 0,
      aiGatewayMode: 'observe',
      aiGatewayBlocked24h: 0,
      aiGatewayFailed24h: 0,
      aiGatewayOpenBreakers: 0,
      aiGatewayOpenIncidents: 0,
      ...overrides,
    };
  }

  test('shouldExpectProviderSamples ignores stale analyzed rows without live or recent workload', () => {
    expect(shouldExpectProviderSamples({
      pipelineEnabled: true,
      liveWatchCount: 0,
      activityLast2h: 0,
    })).toBe(false);

    expect(shouldExpectProviderSamples({
      pipelineEnabled: true,
      liveWatchCount: 0,
      activityLast2h: 1,
    })).toBe(true);

    expect(shouldExpectProviderSamples({
      pipelineEnabled: true,
      liveWatchCount: 1,
      activityLast2h: 0,
    })).toBe(true);
  });

  test('buildOpsChecklist keeps provider gaps idle when only stale analyzed rows exist', () => {
    const checklist = buildOpsChecklist(checklistInput({
      analyzed24h: 6,
      statsSamples: 0,
      oddsSamples: 0,
    }));

    const stats = checklist.find((item) => item.id === 'stats-provider-coverage');
    const odds = checklist.find((item) => item.id === 'odds-provider-coverage');

    expect(stats?.status).toBe('unknown');
    expect(stats?.label).toBe('Stats provider coverage is idle');
    expect(stats?.detail).toContain('No current provider workload observed');
    expect(stats?.detail).not.toContain('Current provider workload expected');
    expect(odds?.status).toBe('unknown');
    expect(odds?.label).toBe('Odds provider coverage is idle');
  });

  test('buildOpsChecklist reports recovered job failure context', () => {
    const checklist = buildOpsChecklist(checklistInput({
      jobFailures24h: 1,
      activeJobFailures24h: 0,
      recoveredJobFailures24h: 1,
    }));

    const item = checklist.find((entry) => entry.id === 'job-failures');
    expect(item?.status).toBe('warn');
    expect(item?.label).toBe('Critical jobs recovered after limited failures');
    expect(item?.detail).toContain('0 currently failing job(s), 1 recovered affected job(s)');
  });

  test('buildOpsChecklist surfaces real operational quality issues', () => {
    const checklist = buildOpsChecklist(checklistInput({
      prematchTotalRows: 6,
      prematchHighNoiseRows: 6,
      prematchHighNoiseRate: 100,
      funnelLiveDetected24h: 100,
      funnelSaved24h: 0,
      llmBlocked24h: 16,
      llmCompleted24h: 6,
      aiGatewayMode: 'observe',
      aiGatewayBlocked24h: 0,
      aiGatewayFailed24h: 1,
      aiGatewayOpenBreakers: 3,
      aiGatewayOpenIncidents: 5,
    }));

    expect(checklist.find((item) => item.id === 'prematch-high-noise')?.status).toBe('fail');
    expect(checklist.find((item) => item.id === 'prematch-high-noise')?.detail).toContain('6/6');
    expect(checklist.find((item) => item.id === 'actionable-funnel')?.status).toBe('warn');
    expect(checklist.find((item) => item.id === 'llm-block-pressure')?.status).toBe('warn');
    expect(checklist.find((item) => item.id === 'ai-gateway-health')?.status).toBe('warn');
    expect(checklist[0]?.id).toBe('prematch-high-noise');
  });

  test('buildOpsChecklist warns instead of failing when high-noise rows are duplicate-heavy', () => {
    const checklist = buildOpsChecklist(checklistInput({
      prematchTotalRows: 22,
      prematchHighNoiseRows: 13,
      prematchHighNoiseRate: 59.1,
      prematchDistinctMatches: 4,
      prematchHighNoiseDistinctMatches: 2,
      prematchHighNoiseDistinctRate: 50,
    }));

    const item = checklist.find((entry) => entry.id === 'prematch-high-noise');
    expect(item?.status).toBe('warn');
    expect(item?.label).toBe('Prematch noise is elevated');
    expect(item?.detail).toContain('2/4 distinct match(es) (50%)');
  });

  test('buildOpsChecklist treats no-push no-action funnel as informational', () => {
    const checklist = buildOpsChecklist(checklistInput({
      funnelLiveDetected24h: 193,
      funnelShouldPush24h: 0,
      funnelSaved24h: 0,
      funnelModelNoBet24h: 14,
      funnelPolicyBlocked24h: 4,
      funnelSaveBlocked24h: 0,
    }));

    const item = checklist.find((entry) => entry.id === 'actionable-funnel');
    expect(item?.status).toBe('unknown');
    expect(item?.label).toBe('Actionable funnel produced no model/system push');
    expect(item?.detail).toContain('model/system push count is 0');
  });

  test('buildOpsChecklist fails when actionable saves are blocked after push', () => {
    const checklist = buildOpsChecklist(checklistInput({
      funnelLiveDetected24h: 12,
      funnelShouldPush24h: 3,
      funnelSaved24h: 0,
      funnelSaveBlocked24h: 2,
    }));

    const item = checklist.find((entry) => entry.id === 'actionable-funnel');
    expect(item?.status).toBe('fail');
    expect(item?.label).toBe('Actionable funnel save is blocked');
    expect(item?.detail).toContain('2 save-blocked row(s)');
  });

  test('buildOpsChecklist returns pass/warn/fail states from thresholds', () => {
    const checklist = buildOpsChecklist({
      pipelineEnabled: true,
      activityLast2h: 0,
      analyzed24h: 0,
      activeWatchCount: 0,
      liveWatchCount: 0,
      providerSamplingEnabled: true,
      jobFailures24h: 2,
      activeJobFailures24h: 0,
      recoveredJobFailures24h: 1,
      statsSamples: 10,
      statsSuccessRate: 60,
      oddsSamples: 10,
      oddsUsableRate: 40,
      oddsTradableRate: 40,
      settlementBacklog: 250,
      unresolvedCount: 70,
      notificationAttempts24h: 0,
      notificationFailureRate24h: 0,
      notificationStalePending: 0,
      notificationExpected24h: false,
      prematchTotalRows: 0,
      prematchHighNoiseRows: 0,
      prematchHighNoiseRate: 0,
      funnelLiveDetected24h: 0,
      funnelSaved24h: 0,
      llmBlocked24h: 0,
      llmCompleted24h: 0,
      aiGatewayMode: 'observe',
      aiGatewayBlocked24h: 0,
      aiGatewayFailed24h: 0,
      aiGatewayOpenBreakers: 0,
      aiGatewayOpenIncidents: 0,
    });

    expect(checklist.find((item) => item.id === 'pipeline-activity')?.status).toBe('unknown');
    expect(checklist.find((item) => item.id === 'job-failures')?.status).toBe('warn');
    expect(checklist.find((item) => item.id === 'stats-provider-coverage')?.status).toBe('warn');
    expect(checklist.find((item) => item.id === 'odds-provider-coverage')?.status).toBe('fail');
    expect(checklist.find((item) => item.id === 'settlement-backlog')?.status).toBe('fail');
    expect(checklist.find((item) => item.id === 'notification-health')?.status).toBe('unknown');
    expect(checklist.find((item) => item.id === 'notification-health')?.detail).toContain('queue has no stale pending rows');
  });

  test('buildOpsChecklist fails provider sampling gaps when live workload exists', () => {
    const checklist = buildOpsChecklist({
      pipelineEnabled: true,
      activityLast2h: 0,
      analyzed24h: 0,
      activeWatchCount: 3,
      liveWatchCount: 2,
      providerSamplingEnabled: true,
      jobFailures24h: 0,
      activeJobFailures24h: 0,
      recoveredJobFailures24h: 0,
      statsSamples: 0,
      statsSuccessRate: 0,
      oddsSamples: 0,
      oddsUsableRate: 0,
      oddsTradableRate: 0,
      settlementBacklog: 0,
      unresolvedCount: 0,
      notificationAttempts24h: 0,
      notificationFailureRate24h: 0,
      notificationStalePending: 0,
      notificationExpected24h: true,
      prematchTotalRows: 0,
      prematchHighNoiseRows: 0,
      prematchHighNoiseRate: 0,
      funnelLiveDetected24h: 0,
      funnelSaved24h: 0,
      llmBlocked24h: 0,
      llmCompleted24h: 0,
      aiGatewayMode: 'observe',
      aiGatewayBlocked24h: 0,
      aiGatewayFailed24h: 0,
      aiGatewayOpenBreakers: 0,
      aiGatewayOpenIncidents: 0,
    });

    expect(checklist.find((item) => item.id === 'pipeline-activity')?.status).toBe('fail');
    expect(checklist.find((item) => item.id === 'stats-provider-coverage')?.status).toBe('fail');
    expect(checklist.find((item) => item.id === 'odds-provider-coverage')?.status).toBe('fail');
    expect(checklist.find((item) => item.id === 'notification-health')?.status).toBe('warn');
    expect(checklist.find((item) => item.id === 'stats-provider-coverage')?.label).toBe('Stats provider samples are missing');
  });

  test('buildOpsChecklist warns when Telegram queue has stale pending rows', () => {
    const checklist = buildOpsChecklist({
      pipelineEnabled: true,
      activityLast2h: 1,
      analyzed24h: 1,
      activeWatchCount: 1,
      liveWatchCount: 1,
      providerSamplingEnabled: true,
      jobFailures24h: 0,
      activeJobFailures24h: 0,
      recoveredJobFailures24h: 0,
      statsSamples: 10,
      statsSuccessRate: 90,
      oddsSamples: 10,
      oddsUsableRate: 90,
      oddsTradableRate: 90,
      settlementBacklog: 0,
      unresolvedCount: 0,
      notificationAttempts24h: 0,
      notificationFailureRate24h: 0,
      notificationStalePending: 2,
      notificationExpected24h: false,
      prematchTotalRows: 0,
      prematchHighNoiseRows: 0,
      prematchHighNoiseRate: 0,
      funnelLiveDetected24h: 0,
      funnelSaved24h: 0,
      llmBlocked24h: 0,
      llmCompleted24h: 0,
      aiGatewayMode: 'observe',
      aiGatewayBlocked24h: 0,
      aiGatewayFailed24h: 0,
      aiGatewayOpenBreakers: 0,
      aiGatewayOpenIncidents: 0,
    });

    const item = checklist.find((entry) => entry.id === 'notification-health');
    expect(item?.status).toBe('warn');
    expect(item?.detail).toContain('pending Telegram delivery row(s) older than 15m');
  });

  test('buildOpsChecklist flags odds samples that are usable but not canonical tradable', () => {
    const checklist = buildOpsChecklist({
      pipelineEnabled: true,
      activityLast2h: 1,
      analyzed24h: 3,
      activeWatchCount: 1,
      liveWatchCount: 1,
      providerSamplingEnabled: true,
      jobFailures24h: 0,
      activeJobFailures24h: 0,
      recoveredJobFailures24h: 0,
      statsSamples: 10,
      statsSuccessRate: 90,
      oddsSamples: 10,
      oddsUsableRate: 90,
      oddsTradableRate: 40,
      settlementBacklog: 0,
      unresolvedCount: 0,
      notificationAttempts24h: 0,
      notificationFailureRate24h: 0,
      notificationStalePending: 0,
      notificationExpected24h: false,
      prematchTotalRows: 0,
      prematchHighNoiseRows: 0,
      prematchHighNoiseRate: 0,
      funnelLiveDetected24h: 0,
      funnelSaved24h: 0,
      llmBlocked24h: 0,
      llmCompleted24h: 0,
      aiGatewayMode: 'observe',
      aiGatewayBlocked24h: 0,
      aiGatewayFailed24h: 0,
      aiGatewayOpenBreakers: 0,
      aiGatewayOpenIncidents: 0,
    });

    const item = checklist.find((entry) => entry.id === 'odds-provider-coverage');
    expect(item?.status).toBe('fail');
    expect(item?.detail).toContain('90% usable, 40% canonical tradable');
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
      .mockResolvedValueOnce({
        rows: [
          {
            job_name: 'fetch-matches',
            total_runs: '4',
            failure_runs: '1',
            last_status: 'failure',
            last_started_at: '2026-03-21T09:58:00.000Z',
            last_completed_at: '2026-03-21T09:59:00.000Z',
            last_error: 'quota exceeded',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          active_watch_count: '3',
          live_watch_count: '1',
        }],
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
      .mockResolvedValueOnce({ rows: [{ total: '12', usable: '9', tradable: '9' }] })
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
            canonical_one_x2_hits: '7',
            canonical_ou_hits: '9',
            canonical_ah_hits: '6',
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
          stale_pending: '0',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ count: '6' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            channel_type: 'native_push',
            attempts_24h: '5',
            delivered_24h: '4',
            failures_24h: '1',
            suppressed_24h: '0',
            pending: '0',
            stale_pending: '0',
            invalid_token_failures_24h: '1',
          },
          {
            channel_type: 'sms',
            attempts_24h: '2',
            delivered_24h: '2',
            failures_24h: '0',
            suppressed_24h: '0',
            pending: '0',
            stale_pending: '0',
            invalid_token_failures_24h: '0',
          },
          {
            channel_type: 'voice_call',
            attempts_24h: '1',
            delivered_24h: '1',
            failures_24h: '0',
            suppressed_24h: '0',
            pending: '0',
            stale_pending: '0',
            invalid_token_failures_24h: '0',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            platform: 'android',
            provider: 'fcm',
            devices: '3',
            local_notifications_enabled: '2',
          },
          {
            platform: 'ios',
            provider: 'fcm',
            devices: '1',
            local_notifications_enabled: '1',
          },
        ],
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
            prompt_version: 'v10-hybrid-legacy-g',
            total: '4',
            successes: '4',
            avg_latency_ms: '19000',
            avg_prompt_tokens: '3500',
          },
          {
            execution_role: 'shadow',
            prompt_version: 'v10-hybrid-legacy-g',
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
          distinct_match_rows: '4',
          high_noise_distinct_matches: '1',
          avg_noise_penalty: '34.5',
          structured_eligible_rows: '5',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            match_id: 'm2',
            match_display: 'West Ham vs Spurs',
            noise_penalty: '64',
            row_count: '3',
            high_noise_rows: '2',
            avg_noise_penalty: '58.5',
            prematch_strength: 'weak',
            prematch_availability: 'minimal',
            prompt_data_level: 'basic-only',
            analyzed_at: '2026-03-21T09:55:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          total_rows: '8',
          blocked_rows: '3',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { reason: 'eligible', count: '5' },
          { reason: 'prediction_or_profile_coverage_too_thin', count: '2' },
          { reason: 'prematch_features_missing', count: '1' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          total_rows: '6',
          success_rows: '2',
          skipped_rows: '3',
          failed_rows: '1',
          structured_eligible_rows: '4',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { reason: 'eligible', count: '4' },
          { reason: 'low_evidence_without_watch_condition', count: '1' },
          { reason: 'prompt_only_failed', count: '1' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          live_detected: '9',
          candidate: '7',
          processed: '6',
          provider_ready: '5',
          llm_eligible: '4',
          pre_llm_skipped: '2',
          skipped_proceed: '1',
          skipped_staleness: '1',
          llm_eligibility_blocked: '1',
          model_no_bet: '2',
          policy_blocked: '1',
          save_blocked: '1',
          should_push: '2',
          saved: '1',
          notified: '1',
          errors: '1',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          blocked: '5',
          started: '12',
          completed: '11',
          failed: '1',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { reason: 'auto_llm_cooldown_active', count: '3' },
          { reason: 'degraded_evidence_without_watch_condition', count: '2' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { diagnostic: 'no_bet_intentional', count: '7' },
          { diagnostic: 'policy_blocked', count: '4' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          blocked: '2',
          observed: '3',
          succeeded: '9',
          failed: '1',
          estimated_cost: '0.1234',
          open_breakers: '1',
          open_incidents: '1',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { reason: 'budget_daily_limit', count: '2' },
          { reason: 'provider_backoff', count: '1' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { scope: 'provider:api-football', count: '1' },
        ],
      });

    const snapshot = await getOpsMonitoringSnapshot();

    expect(snapshot.pipeline.analyzed24h).toBe(20);
    expect(snapshot.workload.activeWatchCount).toBe(3);
    expect(snapshot.workload.liveWatchCount).toBe(1);
    expect(snapshot.providers.samplingEnabled).toBe(true);
    expect(snapshot.pipeline.failingJobs24h[0]?.jobName).toBe('fetch-matches');
    expect(snapshot.pipeline.failingJobs24h[0]?.lastError).toBe('quota exceeded');
    expect(snapshot.pipeline.notifyEligibleRate24h).toBe(40);
    expect(snapshot.providers.statsSuccessRate).toBe(80);
    expect(snapshot.providers.oddsUsableRate).toBe(75);
    expect(snapshot.providers.oddsTradableRate).toBe(75);
    expect(snapshot.providers.oddsByProvider[0]).toEqual(expect.objectContaining({
      oneX2Rate: 75,
      overUnderRate: 83.3,
      asianHandicapRate: 66.7,
      canonicalOneX2Rate: 58.3,
      canonicalOverUnderRate: 75,
      canonicalAsianHandicapRate: 50,
    }));
    expect(snapshot.settlement.recommendationPending).toBe(5);
    expect(snapshot.notifications.failureRate24h).toBe(10);
    expect(snapshot.notifications.stalePending).toBe(0);
    expect(snapshot.notifications.fcmConfigured).toBe(true);
    expect(snapshot.notifications.nativeDevicesByPlatform[0]).toEqual({
      platform: 'android',
      provider: 'fcm',
      devices: 3,
      localNotificationsEnabled: 2,
    });
    expect(snapshot.notifications.channelBreakdown.find((row) => row.channelType === 'native_push')).toEqual({
      channelType: 'native_push',
      attempts24h: 5,
      delivered24h: 4,
      failures24h: 1,
      suppressed24h: 0,
      pending: 0,
      stalePending: 0,
      invalidTokenFailures24h: 1,
      failureRate24h: 20,
    });
    expect(snapshot.notifications.criticalFallbackCostEstimateUsd24h).toBe(0.35);
    expect(snapshot.promptShadow.shouldPushAgreementRate24h).toBe(100);
    expect(snapshot.promptShadow.marketAgreementRate24h).toBe(75);
    expect(snapshot.promptQuality.sameThesisClusters).toBe(1);
    expect(snapshot.promptQuality.cornersRows).toBe(1);
    expect(snapshot.promptQuality.lateHighLineRows).toBe(2);
    expect(snapshot.promptQuality.prematch.highNoiseRate).toBe(16.7);
    expect(snapshot.promptQuality.prematch.distinctMatchRows).toBe(4);
    expect(snapshot.promptQuality.prematch.highNoiseDistinctMatches).toBe(1);
    expect(snapshot.promptQuality.prematch.highNoiseDistinctRate).toBe(25);
    expect(snapshot.aiGateway.blocked24h).toBe(2);
    expect(snapshot.aiGateway.estimatedCost24h).toBe(0.1234);
    expect(snapshot.aiGateway.openBreakers).toBe(1);
    expect(snapshot.aiGateway.topReasons[0]).toEqual({ reason: 'budget_daily_limit', count: 2 });
    expect(snapshot.aiGateway.breakerScopes[0]).toEqual({ scope: 'provider:api-football', count: 1 });

    const workloadSql = vi.mocked(query).mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes('active_watch_count')) ?? '';
    expect(workloadSql).toContain('FROM monitored_matches mm');
    expect(workloadSql).toContain('user_watch_subscriptions');
    expect(workloadSql).not.toContain('FROM watchlist w');
    expect(snapshot.promptQuality.prematch.avgNoisePenalty).toBe(34.5);
    expect(snapshot.promptQuality.prematch.structuredAskAiEligibleRows).toBe(5);
    expect(snapshot.promptQuality.prematch.structuredAskAiEligibleRate).toBe(62.5);
    expect(snapshot.promptQuality.prematch.structuredAskAiBlockedRows).toBe(3);
    expect(snapshot.promptQuality.prematch.structuredAskAiReasonBreakdown[0]?.reason).toBe('eligible');
    expect(snapshot.promptQuality.prematch.topHighNoiseMatches[0]?.matchDisplay).toBe('West Ham vs Spurs');
    expect(snapshot.promptQuality.prematch.topHighNoiseMatches[0]?.rowCount).toBe(3);
    expect(snapshot.promptQuality.prematch.topHighNoiseMatches[0]?.highNoiseRows).toBe(2);
    expect(snapshot.promptOnly.totalRows).toBe(6);
    expect(snapshot.promptOnly.structuredEligibleRate).toBe(66.7);
    expect(snapshot.promptOnly.reasonBreakdown[1]?.reason).toBe('low_evidence_without_watch_condition');
    expect(snapshot.llm.blocked24h).toBe(5);
    expect(snapshot.llm.failureRate24h).toBe(8.3);
    expect(snapshot.decisionFunnel.stages.find((stage) => stage.id === 'live_detected')?.count).toBe(9);
    expect(snapshot.decisionFunnel.stages.find((stage) => stage.id === 'saved')?.rateFromStart).toBe(11.1);
    expect(snapshot.decisionFunnel.silentBreakdown).toContainEqual({ reason: 'model_no_bet', count: 2 });
    expect(snapshot.decisionFunnel.silentBreakdown).toContainEqual({ reason: 'save_blocked_provider_coverage', count: 1 });
    expect(snapshot.llm.topBlockReasons[0]?.reason).toBe('auto_llm_cooldown_active');
    expect(snapshot.llm.diagnosticBreakdown[0]?.diagnostic).toBe('no_bet_intentional');
    expect(snapshot.cards.find((card) => card.label === 'Notify-Eligible Rate 24h')?.value).toBe('40%');
    expect(snapshot.cards.find((card) => card.label === 'Prematch High Noise 24h')?.value).toBe('25%');
    expect(snapshot.cards.find((card) => card.label === 'Prematch High Noise 24h')?.detail).toBe('1/4 matches; 2/12 rows');
    expect(snapshot.cards.find((card) => card.label === 'Prematch Structured Eligible')?.value).toBe('62.5%');
    expect(snapshot.cards.find((card) => card.label === 'LLM Blocked 24h')?.value).toBe('5');
    expect(snapshot.cards.find((card) => card.label === 'Actionable Funnel 24h')?.value).toBe('50%');
    expect(snapshot.cards.find((card) => card.label === 'Actionable Funnel 24h')?.detail).toBe('1/2 model/system pushes saved');
    expect(snapshot.cards.find((card) => card.label === 'Prompt Agree 24h')?.value).toBe('100%');
    expect(snapshot.cards.find((card) => card.label === 'Stacking Rate 24h')?.value).toBe('66.7%');
    expect(snapshot.cards.find((card) => card.label === 'Critical Fallback Cost 24h')?.value).toBe('$0.3500');
    expect(snapshot.checklist.some((item) => item.id === 'settlement-backlog')).toBe(true);
  });
});
