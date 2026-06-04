import { describe, expect, it } from 'vitest';
import { compactJobResultForProgress } from '../job-result-serializer.js';

describe('compactJobResultForProgress', () => {
  it('keeps runtime policy shadow fields needed by Live Signals UI', () => {
    const compacted = compactJobResultForProgress('check-live-trigger', {
      liveCount: 1,
      candidateCount: 1,
      pipelineResults: [{
        totalMatches: 1,
        processed: 1,
        errors: 0,
        results: [{
          matchId: '1504825',
          matchDisplay: 'Home vs Away',
          minute: 67,
          score: '0-2',
          status: '2H',
          success: true,
          decisionKind: 'no_bet',
          shouldPush: false,
          selection: 'BTTS Yes @2.20',
          confidence: 8,
          saved: false,
          notified: false,
          debug: {
            shadowMode: false,
            promptVersion: 'v10-hybrid-legacy-g',
            prematchAvailability: 'full',
            prematchStrength: 'strong',
            runtimePolicyShadow: {
              hasPolicyBlockedSelection: true,
              canonicalMarket: 'btts_yes',
              minuteBand: '60-74',
              scoreState: 'two-plus-margin',
              odds: 2.2,
              confidence: 8,
              valuePercent: 6,
              valueBand: '6-7',
              riskLevel: 'MEDIUM',
              stakePercent: 2,
              watchSignalKey: 'btts_yes_medium_edge_6_7_odds_2_plus',
              watchSignalLabel: 'BTTS Yes MEDIUM edge 6-7 odds>=2.0',
              evidenceMode: 'full_live_data',
              marketResolutionStatus: 'resolved',
              prematchStrength: 'strong',
              marketAvailabilityBucket: 'totals_only',
              policyWarnings: ['POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL'],
              matchedPockets: [{
                id: 'btts_yes_60_74_two_plus',
                label: 'BTTS Yes 60-74 two-plus clean context shadow',
                stakeCapPercent: 1,
                reason: 'Runtime shadow only.',
              }],
              skippedReason: '',
            },
          },
        }],
      }],
    });

    expect(compacted).toMatchObject({
      pipelineResults: [{
        results: [{
          debug: {
            runtimePolicyShadow: {
              canonicalMarket: 'btts_yes',
              valueBand: '6-7',
              riskLevel: 'MEDIUM',
              watchSignalKey: 'btts_yes_medium_edge_6_7_odds_2_plus',
              matchedPockets: [{
                id: 'btts_yes_60_74_two_plus',
                stakeCapPercent: 1,
              }],
            },
          },
        }],
      }],
    });
  });
});
