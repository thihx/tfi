import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/pool.js';
import {
  buildCurrentRuntimeBlockedSelectionReview,
  formatCurrentRuntimeBlockedSelectionReviewMarkdown,
} from '../current-runtime-blocked-selection-review.js';

const mockQuery = vi.mocked(query);

describe('current runtime blocked-selection review', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('settles blocked official-prompt selections as counterfactual audit rows', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 101,
          timestamp: '2026-06-03T10:00:00.000Z',
          audit_match_id: 'm-1',
          metadata: {
            promptVersion: 'v10-hybrid-legacy-g',
            matchId: 'm-1',
            matchDisplay: 'Home vs Away',
            selection: 'Under 1.5 Goals @1.8',
            betMarket: '',
            minute: 70,
            status: '2H',
            score: '1-0',
            evidenceMode: 'full_live_data',
            confidence: 7,
            saved: false,
            shouldPush: false,
            policyBlocked: true,
            policyWarnings: ['POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL'],
          },
          history_match_id: 'm-1',
          final_status: 'FT',
          home_score: 1,
          away_score: 0,
          regular_home_score: null,
          regular_away_score: null,
          halftime_home: 1,
          halftime_away: 0,
          settlement_stats: null,
        },
        {
          id: 102,
          timestamp: '2026-06-03T10:01:00.000Z',
          audit_match_id: 'm-1',
          metadata: {
            promptVersion: 'v10-hybrid-legacy-g',
            matchId: 'm-1',
            matchDisplay: 'Home vs Away',
            selection: 'Over 1.5 Goals @1.9',
            minute: 72,
            evidenceMode: 'full_live_data',
            confidence: 6,
            saved: false,
            shouldPush: false,
            policyBlocked: true,
            llmDecisionDiagnostic: 'policy_blocked',
            marketResolutionStatus: 'resolved',
            saveIntegrityStatus: 'not_attempted',
            policyWarnings: ['OVER_1_5_BLOCKED_LATE_MIDGAME'],
          },
          history_match_id: 'm-1',
          final_status: 'FT',
          home_score: 1,
          away_score: 0,
          regular_home_score: null,
          regular_away_score: null,
          halftime_home: 1,
          halftime_away: 0,
          settlement_stats: null,
        },
      ],
    } as never);

    const report = await buildCurrentRuntimeBlockedSelectionReview({
      lookbackHours: 336,
      maxRows: 100,
      stakePercent: 1,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([336, 'v10-hybrid-legacy-g', 100]);
    expect(report.totalSelections).toBe(2);
    expect(report.uniqueMatches).toBe(1);
    expect(report.settledRows).toBe(2);
    expect(report.wins).toBe(1);
    expect(report.losses).toBe(1);
    expect(report.totalStakedPercent).toBe(2);
    expect(report.totalPnlPercent).toBe(-0.2);
    expect(report.roiOnStaked).toBe(-0.1);
    expect(report.metadataCompleteness).toMatchObject({
      missingLlmDecisionDiagnostic: 1,
      missingMarketResolutionStatus: 1,
      missingSaveIntegrityStatus: 1,
      missingEvidenceMode: 0,
    });
    expect(report.rows[0]).toMatchObject({
      canonicalMarket: 'under_1.5',
      odds: 1.8,
      result: 'win',
      pnlPercent: 0.8,
      metadataGaps: [
        'missing_llm_decision_diagnostic',
        'missing_market_resolution_status',
        'missing_save_integrity_status',
      ],
    });
    expect(report.rows[1]).toMatchObject({
      canonicalMarket: 'over_1.5',
      odds: 1.9,
      result: 'loss',
      pnlPercent: -1,
    });

    const markdown = formatCurrentRuntimeBlockedSelectionReviewMarkdown(report);
    expect(markdown).toContain('# Current Runtime Blocked Selection Review');
    expect(markdown).toContain('| under_1.5 | 1 | 1 | 1 | 0 | 0 | 1 | 0.8 | 0.8 |');
    expect(markdown).toContain('| OVER_1_5_BLOCKED_LATE_MIDGAME | 1 | 1 | 0 | 1 | 0 | 1 | -1 | -1 |');
  });

  it('handles an empty blocked-selection cohort', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const report = await buildCurrentRuntimeBlockedSelectionReview({
      lookbackHours: 24,
      maxRows: 10,
      stakePercent: 1,
    });

    expect(report.totalSelections).toBe(0);
    expect(report.rows).toEqual([]);
    expect(formatCurrentRuntimeBlockedSelectionReviewMarkdown(report)).toContain('| (none) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |');
  });
});
