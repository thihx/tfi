import { describe, expect, it } from 'vitest';
import { evaluateRuntimePolicyShadowReadinessGates } from '../runtime-policy-shadow-readiness-gates.js';
import type { RuntimePolicyShadowReport } from '../runtime-policy-shadow-report.js';
import type { RuntimePolicyShadowSettlementReport } from '../runtime-policy-shadow-settlement-report.js';

const segmentA = {
  leagueId: '39',
  leagueName: 'Premier League',
  leagueSegmentKey: 'league:39',
  homeTeamId: '1',
  homeTeamName: 'A',
  homeTeamSegmentKey: 'team:1',
  awayTeamId: '2',
  awayTeamName: 'B',
  awayTeamSegmentKey: 'team:2',
  teamSegmentKeys: ['team:1', 'team:2'],
  matchSegmentKey: 'match:m-1',
};

const segmentB = {
  leagueId: '140',
  leagueName: 'La Liga',
  leagueSegmentKey: 'league:140',
  homeTeamId: '3',
  homeTeamName: 'C',
  homeTeamSegmentKey: 'team:3',
  awayTeamId: '4',
  awayTeamName: 'D',
  awayTeamSegmentKey: 'team:4',
  teamSegmentKeys: ['team:3', 'team:4'],
  matchSegmentKey: 'match:m-2',
};

function matchedReport(partial: Partial<RuntimePolicyShadowReport> = {}): RuntimePolicyShadowReport {
  return {
    generatedAt: '2026-06-09T00:00:00.000Z',
    lookbackDays: 30,
    maxRows: 1000,
    totalEvents: 3,
    totalPocketMatches: 3,
    uniqueMatches: 3,
    byPocket: [],
    byCanonicalMarket: [],
    byMinuteBand: [],
    byScoreState: [],
    byConfidenceBand: [],
    byValueBand: [],
    byRiskLevel: [],
    byWatchSignal: [],
    byMarketResolutionStatus: [],
    byMarketAvailabilityBucket: [],
    byLeagueSegment: [],
    byTeamSegment: [],
    recent: [
      {
        id: 1,
        timestamp: '2026-06-09T00:00:00.000Z',
        matchId: 'm-1',
        matchDisplay: 'A vs B',
        ...segmentA,
        pocketIds: ['medium_risk_thin_edge_shadow_v1'],
        canonicalMarket: 'over_2.5',
        minute: 62,
        minuteBand: '60-74',
        score: '1-1',
        scoreState: 'level',
        odds: 1.9,
        confidence: 7,
        valuePercent: 6,
        valueBand: '6-7',
        riskLevel: 'MEDIUM',
        stakePercent: 1,
        watchSignalKey: 'none',
        watchSignalLabel: 'none',
        evidenceMode: 'full_live_data',
        marketResolutionStatus: 'resolved',
        prematchStrength: 'moderate',
        marketAvailabilityBucket: 'totals_only',
        policyWarnings: ['POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL'],
      },
      {
        id: 2,
        timestamp: '2026-06-09T00:01:00.000Z',
        matchId: 'm-2',
        matchDisplay: 'C vs D',
        ...segmentB,
        pocketIds: ['medium_risk_thin_edge_shadow_v1'],
        canonicalMarket: 'over_2.5',
        minute: 65,
        minuteBand: '60-74',
        score: '0-0',
        scoreState: '0-0',
        odds: 1.85,
        confidence: 7,
        valuePercent: 6,
        valueBand: '6-7',
        riskLevel: 'MEDIUM',
        stakePercent: 1,
        watchSignalKey: 'none',
        watchSignalLabel: 'none',
        evidenceMode: 'full_live_data',
        marketResolutionStatus: 'resolved',
        prematchStrength: 'strong',
        marketAvailabilityBucket: 'totals_only',
        policyWarnings: ['POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL'],
      },
    ],
    ...partial,
  };
}

function settlementReport(partial: Partial<RuntimePolicyShadowSettlementReport> = {}): RuntimePolicyShadowSettlementReport {
  return {
    generatedAt: '2026-06-09T00:00:00.000Z',
    lookbackDays: 30,
    maxRows: 1000,
    totalEvents: 2,
    totalPocketRows: 2,
    settledRows: 2,
    unresolvedRows: 0,
    wins: 2,
    losses: 0,
    pushLike: 0,
    totalStakedPercent: 2,
    totalPnlPercent: 1.7,
    roiOnStaked: 0.85,
    byPocket: [],
    byCanonicalMarket: [],
    byLeagueSegment: [],
    byTeamSegment: [],
    rows: [
      {
        auditLogId: 1,
        timestamp: '2026-06-09T00:00:00.000Z',
        matchId: 'm-1',
        matchDisplay: 'A vs B',
        ...segmentA,
        pocketId: 'medium_risk_thin_edge_shadow_v1',
        canonicalMarket: 'over_2.5',
        selection: 'Over 2.5 @1.90',
        betMarket: 'over_2.5',
        minute: 62,
        minuteBand: '60-74',
        score: '1-1',
        odds: 1.9,
        stakePercent: 1,
        status: 'settled_rules',
        result: 'win',
        pnlPercent: 0.9,
        explanation: 'resolved',
      },
      {
        auditLogId: 2,
        timestamp: '2026-06-09T00:01:00.000Z',
        matchId: 'm-2',
        matchDisplay: 'C vs D',
        ...segmentB,
        pocketId: 'medium_risk_thin_edge_shadow_v1',
        canonicalMarket: 'over_2.5',
        selection: 'Over 2.5 @1.85',
        betMarket: 'over_2.5',
        minute: 65,
        minuteBand: '60-74',
        score: '0-0',
        odds: 1.85,
        stakePercent: 1,
        status: 'settled_rules',
        result: 'win',
        pnlPercent: 0.85,
        explanation: 'resolved',
      },
    ],
    ...partial,
  };
}

describe('evaluateRuntimePolicyShadowReadinessGates', () => {
  it('passes a narrow candidate only when hard no-promote checks are clean', () => {
    const result = evaluateRuntimePolicyShadowReadinessGates(
      {
        candidates: [{
          id: 'medium',
          source: 'matched_pocket',
          key: 'medium_risk_thin_edge_shadow_v1',
          expectedEvidenceModes: ['full_live_data'],
          minTelemetryEvents: 2,
          minUniqueMatches: 2,
          minSettlementRows: 2,
          minSettledRows: 2,
          minSettledRate: 1,
          maxLosses: 0,
          minTotalPnlPercent: 1,
          minRoiOnStaked: 0.5,
          maxTopMatchShare: 0.5,
          maxTopLeagueShare: 0.5,
          maxTopTeamShare: 0.25,
          maxTopMarketShare: 1,
          maxMarketUnresolvedRate: 0,
          maxEvidenceContaminationRate: 0,
        }],
      },
      {
        matchedReport: matchedReport(),
        matchedSettlement: settlementReport(),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.candidates[0]).toEqual(expect.objectContaining({
      status: 'ready_for_human_review',
      hardNoPromoteReasons: [],
      metrics: expect.objectContaining({
        topLeagueShare: 0.5,
        topTeamShare: 0.25,
      }),
    }));
  });

  it('fails when sample, settlement, concentration, market resolution, or evidence purity are unsafe', () => {
    const unsafeReport = matchedReport({
      recent: [
        {
          ...matchedReport().recent[0]!,
          matchId: 'm-1',
          evidenceMode: 'odds_events_only_degraded',
          marketResolutionStatus: 'unresolved',
        },
      ],
    });
    const unsafeSettlement = settlementReport({
      rows: [
        {
          ...settlementReport().rows[0]!,
          matchId: 'm-1',
          status: 'unresolved_by_rules',
          result: null,
          pnlPercent: null,
        },
      ],
    });

    const result = evaluateRuntimePolicyShadowReadinessGates(
      {
        candidates: [{
          id: 'medium',
          source: 'matched_pocket',
          key: 'medium_risk_thin_edge_shadow_v1',
          expectedEvidenceModes: ['full_live_data'],
          minTelemetryEvents: 2,
          minUniqueMatches: 2,
          minSettlementRows: 2,
          minSettledRows: 2,
          minSettledRate: 0.8,
          maxUnresolvedRows: 0,
          minTotalPnlPercent: 1,
          minRoiOnStaked: 0.5,
          maxTopMatchShare: 0.5,
          maxTopLeagueShare: 0.5,
          maxTopTeamShare: 0.4,
          maxTopMarketShare: 0.6,
          maxMarketUnresolvedRate: 0,
          maxEvidenceContaminationRate: 0,
        }],
      },
      {
        matchedReport: unsafeReport,
        matchedSettlement: unsafeSettlement,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.candidates[0]?.status).toBe('observe_only');
    expect(result.candidates[0]?.hardNoPromoteReasons).toEqual([
      'telemetryEvents 1 < minTelemetryEvents 2',
      'uniqueMatches 1 < minUniqueMatches 2',
      'settlementRows 1 < minSettlementRows 2',
      'settledRows 0 < minSettledRows 2',
      'settledRate 0 < minSettledRate 0.8',
      'unresolvedRows 1 > maxUnresolvedRows 0',
      'totalPnlPercent 0 < minTotalPnlPercent 1',
      'roiOnStaked 0 < minRoiOnStaked 0.5',
      'topMatchShare 1 > maxTopMatchShare 0.5',
      'topLeagueShare 1 > maxTopLeagueShare 0.5',
      'topTeamShare 0.5 > maxTopTeamShare 0.4',
      'topMarketShare 1 > maxTopMarketShare 0.6',
      'marketUnresolvedRate 1 > maxMarketUnresolvedRate 0',
      'evidenceContaminationRate 1 > maxEvidenceContaminationRate 0',
    ]);
  });
});
