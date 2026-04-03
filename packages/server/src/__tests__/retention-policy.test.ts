import { describe, expect, test } from 'vitest';
import { resolveHousekeepingRetentionPolicy } from '../lib/retention-policy.js';

describe('resolveHousekeepingRetentionPolicy', () => {
  test('clamps unsafe retention settings to minimum safe floors', () => {
    const policy = resolveHousekeepingRetentionPolicy({
      auditKeepDays: 1,
      matchesHistoryKeepDays: 30,
      matchesHistoryHardDeleteDays: 40,
      providerSamplesKeepDays: 0,
      providerCacheKeepDays: 1,
      matchSnapshotsKeepDays: 0,
      oddsMovementsKeepDays: 1,
      promptShadowKeepDays: 0,
      pipelineRunsKeepDays: 1,
      jobRunHistoryKeepDays: 1,
      recommendationDeliveriesKeepDays: 1,
      recommendationsSlimDays: 30,
      aiPerformanceKeepDays: 30,
    });

    expect(policy.keepDays).toMatchObject({
      audit: 3,
      matchesHistory: 90,
      matchesHistoryHardDelete: 120,
      providerSamples: 1,
      providerCache: 3,
      matchSnapshots: 3,
      oddsMovements: 3,
      promptShadow: 3,
      pipelineRuns: 3,
      jobRunHistory: 3,
      recommendationDeliveries: 7,
      recommendationsSlim: 180,
      aiPerformance: 180,
    });
    expect(policy.warnings.length).toBeGreaterThan(0);
  });

  test('allows recommendation deliveries retention to remain disabled explicitly', () => {
    const policy = resolveHousekeepingRetentionPolicy({
      auditKeepDays: 7,
      matchesHistoryKeepDays: 120,
      matchesHistoryHardDeleteDays: 180,
      providerSamplesKeepDays: 3,
      providerCacheKeepDays: 7,
      matchSnapshotsKeepDays: 7,
      oddsMovementsKeepDays: 7,
      promptShadowKeepDays: 7,
      pipelineRunsKeepDays: 7,
      jobRunHistoryKeepDays: 7,
      recommendationDeliveriesKeepDays: 0,
      recommendationsSlimDays: 365,
      aiPerformanceKeepDays: 365,
    });

    expect(policy.keepDays.recommendationDeliveries).toBe(0);
    expect(policy.protectedTables).toContain('league_profiles');
    expect(policy.rules.find((rule) => rule.key === 'providerCache')?.tableNames).toContain('provider_fixture_cache');
  });
});
