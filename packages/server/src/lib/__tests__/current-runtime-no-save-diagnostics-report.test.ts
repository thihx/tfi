import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/pool.js';
import {
  buildCurrentRuntimeNoSaveDiagnosticsReport,
  formatCurrentRuntimeNoSaveDiagnosticsMarkdown,
} from '../current-runtime-no-save-diagnostics-report.js';

const mockQuery = vi.mocked(query);

describe('current runtime no-save diagnostics report', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('summarizes official-prompt no-save blockers from audit logs', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          parse_diagnostics: '5',
          parse_actionable: '1',
          parse_skipped: '4',
          match_analyzed: '3',
          match_analyzed_saved: '0',
          match_analyzed_should_push: '1',
          match_analyzed_save_blocked: '1',
        }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          { key: 'no_bet_intentional', count: '3', latest_at: '2026-06-03T12:00:00.000Z' },
          { key: 'policy_blocked', count: '1', latest_at: '2026-06-03T11:00:00.000Z' },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          { key: 'missing_selection', count: '3', latest_at: '2026-06-03T12:00:00.000Z' },
          { key: 'resolved', count: '2', latest_at: '2026-06-03T11:00:00.000Z' },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ key: 'full_live_data', count: '8', latest_at: '2026-06-03T12:00:00.000Z' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ key: 'POLICY_WARN_LOW_EDGE', count: '2', latest_at: '2026-06-03T11:00:00.000Z' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          audit_rows: '8',
          missing_minute: '0',
          missing_score: '0',
          missing_evidence_mode: '0',
          missing_value_percent: '0',
          missing_risk_level: '0',
          missing_shadow_candidate: '1',
          shadow_candidate_present: '7',
          shadow_candidate_resolved: '4',
          shadow_candidate_unresolved: '3',
        }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ key: 'thin_edge', count: '4', latest_at: '2026-06-03T11:00:00.000Z' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ key: 'resolved', count: '4', latest_at: '2026-06-03T11:00:00.000Z' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ key: 'over_2.5', count: '4', latest_at: '2026-06-03T11:00:00.000Z' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          llm_decision_diagnostic: 'no_bet_intentional',
          market_resolution_status: 'missing_selection',
          policy_blocked: 'false',
          evidence_mode: 'full_live_data',
          count: '3',
          latest_at: '2026-06-03T12:00:00.000Z',
        }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          saved: 'false',
          should_push: 'false',
          save_integrity_status: 'not_attempted',
          save_provider_coverage_status: 'unknown',
          llm_decision_diagnostic: 'no_bet_intentional',
          count: '3',
          latest_at: '2026-06-03T12:00:00.000Z',
        }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: '101',
          timestamp: '2026-06-03T12:00:00.000Z',
          action: 'LLM_PARSE_DIAGNOSTIC',
          outcome: 'SKIPPED',
          match_id: null,
          metadata: {
            matchId: 'm-1',
            matchDisplay: 'Home vs Away',
            minute: 65,
            score: '1-1',
            status: '2H',
            evidenceMode: 'full_live_data',
            llmDecisionDiagnostic: 'no_bet_intentional',
            marketResolutionStatus: 'missing_selection',
            policyBlocked: false,
            selection: '',
            betMarket: '',
            confidence: 0,
            valuePercent: 0,
            riskLevel: 'HIGH',
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
            policyWarnings: ['POLICY_WARN_LOW_EDGE'],
            warnings: ['NO_BET'],
            aiTextSample: '{"should_push":false}',
          },
        }],
      } as never);

    const report = await buildCurrentRuntimeNoSaveDiagnosticsReport({
      lookbackHours: 336,
      maxSamples: 20,
    });

    expect(mockQuery).toHaveBeenCalledTimes(12);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([336, 'v10-hybrid-legacy-g']);
    expect(mockQuery.mock.calls[11]?.[1]).toEqual([336, 'v10-hybrid-legacy-g', 20]);
    expect(report.totals).toMatchObject({
      parseDiagnostics: 5,
      parseActionable: 1,
      parseSkipped: 4,
      matchAnalyzed: 3,
      matchAnalyzedSaved: 0,
      matchAnalyzedShouldPush: 1,
      matchAnalyzedSaveBlocked: 1,
    });
    expect(report.llmDecisionDiagnostics[0]).toEqual({
      key: 'no_bet_intentional',
      count: 3,
      latestAt: '2026-06-03T12:00:00.000Z',
    });
    expect(report.telemetryCompleteness).toMatchObject({
      auditRows: 8,
      missingShadowCandidate: 1,
      shadowCandidatePresent: 7,
      shadowCandidateResolved: 4,
    });
    expect(report.shadowCandidateReasonCodes[0]).toEqual({
      key: 'thin_edge',
      count: 4,
      latestAt: '2026-06-03T11:00:00.000Z',
    });
    expect(report.recentSamples[0]).toMatchObject({
      id: 101,
      matchId: 'm-1',
      matchDisplay: 'Home vs Away',
      evidenceMode: 'full_live_data',
      llmDecisionDiagnostic: 'no_bet_intentional',
      shadowCandidateSelection: 'Over 2.5 Goals @1.85',
      shadowCandidateMarketResolutionStatus: 'resolved',
      shadowCandidateReasonCode: 'thin_edge',
      policyWarnings: ['POLICY_WARN_LOW_EDGE'],
      warnings: ['NO_BET'],
    });

    const markdown = formatCurrentRuntimeNoSaveDiagnosticsMarkdown(report);
    expect(markdown).toContain('# Current Runtime No-Save Diagnostics');
    expect(markdown).toContain('| no_bet_intentional | 3 | 2026-06-03T12:00:00.000Z |');
    expect(markdown).toContain('## Telemetry Completeness');
    expect(markdown).toContain('| Shadow candidate resolved | 4 |');
    expect(markdown).toContain('Over 2.5 Goals @1.85 (over_2.5)');
    expect(markdown).toContain('| false | false | not_attempted | unknown | no_bet_intentional | 3 |');
  });

  it('handles empty reports', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const report = await buildCurrentRuntimeNoSaveDiagnosticsReport({
      lookbackHours: 24,
      maxSamples: 10,
    });

    expect(report.totals.parseDiagnostics).toBe(0);
    expect(report.llmDecisionDiagnostics).toEqual([]);
    expect(report.recentSamples).toEqual([]);
    expect(formatCurrentRuntimeNoSaveDiagnosticsMarkdown(report)).toContain('| (none) | 0 |  |');
  });
});
