import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  query: mockQuery,
}));

import {
  buildLiveOutputOperatorReport,
  classifyLiveOutputAuditBucket,
} from '../lib/live-output-operator-report.js';

describe('live output operator report', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('classifies audit buckets into stable operator groups', () => {
    expect(classifyLiveOutputAuditBucket('stats_only_weak_trigger')).toBe('evidence');
    expect(classifyLiveOutputAuditBucket('model_no_bet')).toBe('model');
    expect(classifyLiveOutputAuditBucket('policy_blocked')).toBe('policy');
    expect(classifyLiveOutputAuditBucket('save_integrity_blocked')).toBe('save');
    expect(classifyLiveOutputAuditBucket('delivery_failed')).toBe('delivery');
    expect(classifyLiveOutputAuditBucket('recommendation_saved')).toBe('success');
    expect(classifyLiveOutputAuditBucket('provider_quota_or_circuit_open')).toBe('provider');
  });

  test('builds reason grouping and recent drilldown from pipeline analyzed audits', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          match_analyzed: '4',
          money_recommendations: '1',
          stats_only_signals: '1',
          watch_insights: '0',
          shadow_candidates: '1',
          no_actions: '2',
          llm_called: '2',
          llm_skipped: '2',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { output_kind: 'no_action', count: '2', latest_at: '2026-06-09T00:20:00.000Z' },
          { output_kind: 'money_recommendation', count: '1', latest_at: '2026-06-09T00:10:00.000Z' },
          { output_kind: 'stats_only_signal', count: '1', latest_at: '2026-06-09T00:15:00.000Z' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            audit_bucket: 'stats_only_weak_trigger',
            output_kind: 'no_action',
            evidence_mode: 'stats_only',
            count: '2',
            latest_at: '2026-06-09T00:20:00.000Z',
          },
          {
            audit_bucket: 'policy_blocked',
            output_kind: 'shadow_candidate',
            evidence_mode: 'full_live_data',
            count: '1',
            latest_at: '2026-06-09T00:12:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: '99',
          timestamp: '2026-06-09T00:20:00.000Z',
          match_id: 'm-100',
          metadata: {
            matchId: 'm-100',
            matchDisplay: 'Arsenal vs Chelsea',
            minute: 58,
            status: '2H',
            score: '0-0',
            evidenceMode: 'stats_only',
            outputKind: 'no_action',
            auditBucket: 'stats_only_weak_trigger',
            outputDecision: {
              route: 'no_action_path',
              llmCalled: false,
              candidatePresent: false,
              savedRecommendation: false,
              settlementEligible: false,
              roiEligible: false,
              noActionReason: 'stats_only_weak_trigger',
            },
          },
        }],
      });

    const report = await buildLiveOutputOperatorReport({ lookbackHours: 24, maxSamples: 10 });

    expect(report.totals).toEqual({
      matchAnalyzed: 4,
      moneyRecommendations: 1,
      statsOnlySignals: 1,
      watchInsights: 0,
      shadowCandidates: 1,
      noActions: 2,
      llmCalled: 2,
      llmSkipped: 2,
    });
    expect(report.reasonGroupBreakdown).toEqual([
      { group: 'evidence', count: 2, latestAt: '2026-06-09T00:20:00.000Z' },
      { group: 'policy', count: 1, latestAt: '2026-06-09T00:12:00.000Z' },
    ]);
    expect(report.reasonBuckets[0]).toEqual(expect.objectContaining({
      key: 'stats_only_weak_trigger',
      group: 'evidence',
      outputKind: 'no_action',
      evidenceMode: 'stats_only',
    }));
    expect(report.recentDrilldown[0]).toEqual(expect.objectContaining({
      matchId: 'm-100',
      matchDisplay: 'Arsenal vs Chelsea',
      minute: '58',
      evidenceMode: 'stats_only',
      auditBucket: 'stats_only_weak_trigger',
      route: 'no_action_path',
      llmCalled: false,
      savedRecommendation: false,
      settlementEligible: false,
      roiEligible: false,
      noActionReason: 'stats_only_weak_trigger',
    }));
  });
});
