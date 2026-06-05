import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  query: mockQuery,
}));

import {
  buildCurrentRuntimeNoSaveDiagnosticsReport,
  formatCurrentRuntimeNoSaveDiagnosticsMarkdown,
} from '../lib/current-runtime-no-save-diagnostics-report.js';

describe('current runtime no-save diagnostics report', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('maps telemetry completeness and shadow candidate diagnostics', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          parse_diagnostics: '1',
          parse_actionable: '0',
          parse_skipped: '1',
          match_analyzed: '1',
          match_analyzed_saved: '0',
          match_analyzed_should_push: '0',
          match_analyzed_save_blocked: '0',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ key: 'no_bet_intentional', count: '1', latest_at: '2026-06-06T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ key: 'not_requested', count: '1', latest_at: '2026-06-06T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ key: 'full_live_data', count: '1', latest_at: '2026-06-06T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ key: 'NO_EDGE', count: '1', latest_at: '2026-06-06T00:00:00.000Z' }] })
      .mockResolvedValueOnce({
        rows: [{
          audit_rows: '2',
          missing_minute: '0',
          missing_score: '0',
          missing_evidence_mode: '0',
          missing_value_percent: '0',
          missing_risk_level: '0',
          missing_shadow_candidate: '0',
          shadow_candidate_present: '2',
          shadow_candidate_resolved: '1',
          shadow_candidate_unresolved: '1',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ key: 'thin_edge', count: '1', latest_at: '2026-06-06T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ key: 'resolved', count: '1', latest_at: '2026-06-06T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ key: 'over_2.5', count: '1', latest_at: '2026-06-06T00:00:00.000Z' }] })
      .mockResolvedValueOnce({
        rows: [{
          llm_decision_diagnostic: 'no_bet_intentional',
          market_resolution_status: 'not_requested',
          policy_blocked: 'false',
          evidence_mode: 'full_live_data',
          count: '1',
          latest_at: '2026-06-06T00:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          saved: 'false',
          should_push: 'false',
          save_integrity_status: 'not_attempted',
          save_provider_coverage_status: 'unknown',
          llm_decision_diagnostic: 'no_bet_intentional',
          count: '1',
          latest_at: '2026-06-06T00:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: '10',
          timestamp: '2026-06-06T00:00:00.000Z',
          action: 'LLM_PARSE_DIAGNOSTIC',
          outcome: 'SKIPPED',
          match_id: '100',
          metadata: {
            matchDisplay: 'Team A vs Team B',
            minute: 65,
            score: '1-1',
            evidenceMode: 'full_live_data',
            llmDecisionDiagnostic: 'no_bet_intentional',
            marketResolutionStatus: 'not_requested',
            policyBlocked: false,
            selection: '',
            betMarket: '',
            confidence: 0,
            valuePercent: 0,
            riskLevel: 'HIGH',
            saveIntegrityStatus: 'not_attempted',
            shadowCandidatePresent: true,
            shadowCandidateSelection: 'Over 2.5 Goals @1.85',
            shadowCandidateBetMarket: 'over_2.5',
            shadowCandidateCanonicalMarket: 'over_2.5',
            shadowCandidateMappedOdd: 1.85,
            shadowCandidateMarketResolutionStatus: 'resolved',
            shadowCandidateConfidence: 6,
            shadowCandidateValuePercent: 5,
            shadowCandidateRiskLevel: 'MEDIUM',
            shadowCandidateReasonCode: 'thin_edge',
            policyWarnings: [],
            warnings: ['NO_EDGE'],
            aiTextSample: '{"should_push":false}',
          },
        }],
      });

    const report = await buildCurrentRuntimeNoSaveDiagnosticsReport({
      lookbackHours: 48,
      maxSamples: 10,
    });

    expect(report.telemetryCompleteness).toEqual(expect.objectContaining({
      auditRows: 2,
      missingMinute: 0,
      missingShadowCandidate: 0,
      shadowCandidatePresent: 2,
      shadowCandidateResolved: 1,
    }));
    expect(report.shadowCandidateReasonCodes[0]).toEqual(expect.objectContaining({ key: 'thin_edge', count: 1 }));
    expect(report.shadowCandidateCanonicalMarkets[0]).toEqual(expect.objectContaining({ key: 'over_2.5', count: 1 }));
    expect(report.recentSamples[0]).toEqual(expect.objectContaining({
      shadowCandidateSelection: 'Over 2.5 Goals @1.85',
      shadowCandidateMarketResolutionStatus: 'resolved',
      shadowCandidateReasonCode: 'thin_edge',
    }));

    const md = formatCurrentRuntimeNoSaveDiagnosticsMarkdown(report);
    expect(md).toContain('## Telemetry Completeness');
    expect(md).toContain('## Shadow Candidate Reason Codes');
    expect(md).toContain('Over 2.5 Goals @1.85 (over_2.5)');
  });
});
