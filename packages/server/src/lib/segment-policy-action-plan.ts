import type { HotspotReportPayload, SegmentHotspotRow } from './replay-segment-hotspots.js';
import {
  classifyReplayMarketFamily,
  type EvaluatedReplayCase,
} from './settled-replay-evaluation.js';

export interface SegmentPolicyActionPlanOptions {
  minSettledDirectional?: number;
  minReplayActionable?: number;
  blockAccuracyAtOrBelow?: number;
  blockRoiAtOrBelow?: number;
  capAccuracyAtOrBelow?: number;
  capRoiAtOrBelow?: number;
  defaultStakeCapPercent?: number;
  maxRows?: number;
}

export interface SegmentPolicyActionCandidate {
  segmentKey: string;
  minuteBand: string;
  marketFamily: string;
  canonicalMarketTop: string;
  replayActionable: number;
  settledDirectional: number;
  replayAccuracy: number;
  replayRoi: number;
  totalReplayStaked: number;
  originalDirectionalLossCount: number;
  reason: string;
}

export interface SegmentPolicyStakeCapCandidate extends SegmentPolicyActionCandidate {
  suggestedMaxStakePercent: number;
}

export interface SegmentPolicyActionPlan {
  generatedAt: string;
  promptVersion: string;
  totalCases: number;
  thresholds: Required<SegmentPolicyActionPlanOptions>;
  qualityBlockers: SegmentPolicyQualityBlockers;
  blocklistCandidates: SegmentPolicyActionCandidate[];
  stakeCapCandidates: SegmentPolicyStakeCapCandidate[];
  reviewCandidates: SegmentPolicyActionCandidate[];
  suggestedBlocklistJson: { segmentKeys: string[] };
  suggestedStakeCapJson: { caps: Record<string, number> };
}

export interface CountRow {
  key: string;
  count: number;
}

export interface ReplayMarketMismatchExample {
  scenarioName: string;
  minute: number | null;
  score: string;
  canonicalMarket: string;
  replaySelection: string;
  originalBetMarket: string;
  marketResolutionStatus: string;
  llmDecisionDiagnostic: string;
  warnings: string[];
  reason: string;
}

export interface OpportunityRecallExample extends ReplayMarketMismatchExample {
  originalResult: string;
  evidenceMode: string;
  scoreState: string;
  minuteBand: string;
  replayQualityAttribution: string;
  providerCoverageStatus: string;
  replayContextStatus: string;
}

export interface OpportunityRecallSummary {
  originalWinCount: number;
  originalWinMissedCount: number;
  originalWinMissRate: number;
  candidateRescueCount: number;
  byReplayQualityAttribution: CountRow[];
  byLlmDecisionDiagnostic: CountRow[];
  byMarketFamily: CountRow[];
  preservedNoBetReasons: CountRow[];
  candidateRescueExamples: OpportunityRecallExample[];
  preservedNoBetExamples: OpportunityRecallExample[];
}

export interface ProviderCoverageGroup {
  groupKey: string;
  canonicalMarket: string;
  originalBetMarket: string;
  marketFamily: string;
  minuteBand: string;
  count: number;
  examples: ReplayMarketMismatchExample[];
}

export interface SegmentPolicyQualityBlockers {
  totalCases: number;
  pushCount: number;
  noBetCount: number;
  actionableCount: number;
  byReplayQualityAttribution: CountRow[];
  byProviderCoverageStatus: CountRow[];
  byReplayContextStatus: CountRow[];
  byDecisionKind: CountRow[];
  byLlmDecisionDiagnostic: CountRow[];
  byMarketResolutionStatus: CountRow[];
  topWarnings: CountRow[];
  topHardPolicyWarnings: CountRow[];
  providerCoverageGroups: ProviderCoverageGroup[];
  unresolvedMarketExamples: ReplayMarketMismatchExample[];
  policyWarningExamples: ReplayMarketMismatchExample[];
  opportunityRecall: OpportunityRecallSummary;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function countRows(values: string[], maxRows = 12): CountRow[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value || '(empty)');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, maxRows);
}

function exampleFromCase(row: EvaluatedReplayCase, reason: string): ReplayMarketMismatchExample {
  return {
    scenarioName: row.scenarioName,
    minute: row.minute,
    score: row.score,
    canonicalMarket: row.canonicalMarket,
    replaySelection: row.replaySelection,
    originalBetMarket: row.originalBetMarket,
    marketResolutionStatus: row.marketResolutionStatus,
    llmDecisionDiagnostic: row.llmDecisionDiagnostic,
    warnings: row.replayWarnings,
    reason,
  };
}

function opportunityExampleFromCase(row: EvaluatedReplayCase, reason: string): OpportunityRecallExample {
  return {
    ...exampleFromCase(row, reason),
    originalResult: row.originalResult,
    evidenceMode: row.evidenceMode,
    scoreState: row.scoreState,
    minuteBand: row.minuteBand,
    replayQualityAttribution: row.replayQualityAttribution,
    providerCoverageStatus: row.providerCoverageStatus,
    replayContextStatus: row.replayContextStatus,
  };
}

function isOriginalWin(row: EvaluatedReplayCase): boolean {
  const result = String(row.originalResult || '').trim().toLowerCase();
  return result === 'win' || result === 'half_win';
}

function totalGoalsFromScore(score: string): number | null {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return null;
  const home = Number(match[1] ?? 0);
  const away = Number(match[2] ?? 0);
  return Number.isFinite(home) && Number.isFinite(away) ? home + away : null;
}

function breakEvenFromReplay(row: EvaluatedReplayCase): number | null {
  if (row.breakEvenRate != null && Number.isFinite(row.breakEvenRate)) return row.breakEvenRate;
  if (row.replayOdds != null && Number.isFinite(row.replayOdds) && row.replayOdds > 0) return 1 / row.replayOdds;
  const match = String(row.replaySelection || '').match(/@\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const odds = Number(match[1]);
  return Number.isFinite(odds) && odds > 0 ? 1 / odds : null;
}

function classifyPreservedNoBetReason(row: EvaluatedReplayCase): string {
  if (row.replayQualityAttribution === 'provider_coverage') return 'provider_unavailable_or_historical_stale_line';
  if (row.replayQualityAttribution === 'replay_context_gap') return 'replay_context_gap';
  if (row.replayQualityAttribution === 'pre_llm_blocked') return 'pre_llm_firewall_or_low_evidence';
  if (row.replayQualityAttribution === 'model_no_bet') return 'model_intentional_no_bet';
  if (row.replayQualityAttribution === 'model_policy_mismatch') return 'model_proposed_policy_blocked_market';
  if (row.replayQualityAttribution === 'hard_policy_gate') return 'hard_policy_gate';
  return row.replayQualityAttribution || 'unknown';
}

function isLateUnder45TwoPlusMarginRescueCandidate(row: EvaluatedReplayCase): boolean {
  const totalGoals = totalGoalsFromScore(row.score);
  const breakEvenRate = breakEvenFromReplay(row);
  return !row.actionable
    && row.canonicalMarket === 'under_4.5'
    && row.minuteBand === '75+'
    && row.scoreState === 'two-plus-margin'
    && row.evidenceMode === 'full_live_data'
    && totalGoals === 4
    && breakEvenRate != null
    && breakEvenRate < 0.55
    && (
      row.replayWarnings.includes('POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL')
      || row.llmDecisionDiagnostic === 'policy_blocked'
      || row.replayQualityAttribution === 'model_policy_mismatch'
      || row.replayQualityAttribution === 'hard_policy_gate'
    );
}

function buildOpportunityRecall(cases: EvaluatedReplayCase[] = []): OpportunityRecallSummary {
  const originalWins = cases.filter(isOriginalWin);
  const missedWins = originalWins.filter((row) => !row.actionable);
  const candidateRows = missedWins.filter(isLateUnder45TwoPlusMarginRescueCandidate);
  const preservedRows = missedWins.filter((row) => !isLateUnder45TwoPlusMarginRescueCandidate(row));

  return {
    originalWinCount: originalWins.length,
    originalWinMissedCount: missedWins.length,
    originalWinMissRate: originalWins.length > 0 ? round(missedWins.length / originalWins.length) : 0,
    candidateRescueCount: candidateRows.length,
    byReplayQualityAttribution: countRows(missedWins.map((row) => row.replayQualityAttribution || 'unknown')),
    byLlmDecisionDiagnostic: countRows(missedWins.map((row) => row.llmDecisionDiagnostic || 'unknown')),
    byMarketFamily: countRows(missedWins.map((row) => classifyReplayMarketFamily(row.canonicalMarket || row.originalBetMarket || ''))),
    preservedNoBetReasons: countRows(preservedRows.map(classifyPreservedNoBetReason)),
    candidateRescueExamples: candidateRows
      .map((row) => opportunityExampleFromCase(
        row,
        'Narrow policy-rescue candidate: late full-live under_4.5, two-plus margin, exactly 4 current goals, break-even below the late-game threshold.',
      ))
      .slice(0, 12),
    preservedNoBetExamples: preservedRows
      .map((row) => opportunityExampleFromCase(
        row,
        'Original result won, but replay evidence does not meet a safe automatic rescue pattern; preserve conservative no-bet unless a larger cohort proves otherwise.',
      ))
      .slice(0, 12),
  };
}

function buildProviderCoverageGroups(rows: ReplayMarketMismatchExample[]): ProviderCoverageGroup[] {
  const groups = new Map<string, ProviderCoverageGroup>();
  for (const row of rows) {
    const marketFamily = classifyReplayMarketFamily(row.canonicalMarket || row.originalBetMarket || '');
    const minuteBand = row.minute == null
      ? 'unknown'
      : row.minute < 30
        ? '00-29'
        : row.minute < 45
          ? '30-44'
          : row.minute < 60
            ? '45-59'
            : row.minute < 75
              ? '60-74'
              : '75+';
    const key = `${row.canonicalMarket || 'unknown'}::${minuteBand}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.examples.length < 3) existing.examples.push(row);
      continue;
    }
    groups.set(key, {
      groupKey: key,
      canonicalMarket: row.canonicalMarket || 'unknown',
      originalBetMarket: row.originalBetMarket || 'unknown',
      marketFamily,
      minuteBand,
      count: 1,
      examples: [row],
    });
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.marketFamily.localeCompare(b.marketFamily) || a.canonicalMarket.localeCompare(b.canonicalMarket))
    .slice(0, 20);
}

function buildQualityBlockers(cases: EvaluatedReplayCase[] = []): SegmentPolicyQualityBlockers {
  const unresolved = cases
    .filter((row) => (row.providerCoverageStatus || '') === 'provider_line_unavailable_or_stale'
      || row.marketResolutionStatus === 'odds_unavailable')
    .map((row) => exampleFromCase(
      row,
      'Recorded provider snapshot did not contain the requested line; treat as provider unavailable or historical stale-line coverage, not model-quality failure.',
    ))
    .slice(0, 12);
  const policyBlocked = cases
    .filter((row) => (row.replayQualityAttribution || '') === 'hard_policy_gate'
      || (row.replayQualityAttribution || '') === 'model_policy_mismatch'
      || row.llmDecisionDiagnostic === 'policy_blocked')
    .map((row) => exampleFromCase(
      row,
      row.replayQualityAttribution === 'model_policy_mismatch'
        ? 'Replay resolved the market price, but the model still proposed a bet in a policy zone already exposed by runtime preflight context.'
        : 'Replay resolved the market price, but hard post-parse policy gates blocked the recommendation.',
    ))
    .slice(0, 12);
  const hardPolicyWarnings = cases.flatMap((row) => row.replayWarnings)
    .filter((warning) => !warning.startsWith('MEMORY_') && warning !== 'ODDS_INVALID');

  return {
    totalCases: cases.length,
    pushCount: cases.filter((row) => row.shouldPush).length,
    noBetCount: cases.filter((row) => !row.shouldPush).length,
    actionableCount: cases.filter((row) => row.actionable).length,
    byReplayQualityAttribution: countRows(cases.map((row) => row.replayQualityAttribution || 'unknown')),
    byProviderCoverageStatus: countRows(cases.map((row) => row.providerCoverageStatus || 'unknown')),
    byReplayContextStatus: countRows(cases.map((row) => row.replayContextStatus || 'unknown')),
    byDecisionKind: countRows(cases.map((row) => row.decisionKind)),
    byLlmDecisionDiagnostic: countRows(cases.map((row) => row.llmDecisionDiagnostic)),
    byMarketResolutionStatus: countRows(cases.map((row) => row.marketResolutionStatus)),
    topWarnings: countRows(cases.flatMap((row) => row.replayWarnings), 20),
    topHardPolicyWarnings: countRows(hardPolicyWarnings, 20),
    providerCoverageGroups: buildProviderCoverageGroups(unresolved),
    unresolvedMarketExamples: unresolved,
    policyWarningExamples: policyBlocked,
    opportunityRecall: buildOpportunityRecall(cases),
  };
}

function candidateFromRow(row: SegmentHotspotRow, reason: string): SegmentPolicyActionCandidate {
  return {
    segmentKey: row.segmentKey,
    minuteBand: row.minuteBand,
    marketFamily: row.marketFamily,
    canonicalMarketTop: row.canonicalMarketTop,
    replayActionable: row.replayActionable,
    settledDirectional: row.settledDirectional,
    replayAccuracy: round(row.replayAccuracy),
    replayRoi: round(row.replayRoi),
    totalReplayStaked: round(row.totalReplayStaked),
    originalDirectionalLossCount: row.originalDirectionalLossCount,
    reason,
  };
}

function eligible(row: SegmentHotspotRow, thresholds: Required<SegmentPolicyActionPlanOptions>): boolean {
  return row.replayActionable >= thresholds.minReplayActionable
    && row.settledDirectional >= thresholds.minSettledDirectional;
}

function sortByRisk<T extends SegmentPolicyActionCandidate>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.replayAccuracy !== b.replayAccuracy) return a.replayAccuracy - b.replayAccuracy;
    if (a.replayRoi !== b.replayRoi) return a.replayRoi - b.replayRoi;
    return b.replayActionable - a.replayActionable;
  });
}

function resolveThresholds(options?: SegmentPolicyActionPlanOptions): Required<SegmentPolicyActionPlanOptions> {
  return {
    minSettledDirectional: options?.minSettledDirectional ?? 5,
    minReplayActionable: options?.minReplayActionable ?? 3,
    blockAccuracyAtOrBelow: options?.blockAccuracyAtOrBelow ?? 0.35,
    blockRoiAtOrBelow: options?.blockRoiAtOrBelow ?? -0.25,
    capAccuracyAtOrBelow: options?.capAccuracyAtOrBelow ?? 0.5,
    capRoiAtOrBelow: options?.capRoiAtOrBelow ?? 0,
    defaultStakeCapPercent: options?.defaultStakeCapPercent ?? 1.5,
    maxRows: options?.maxRows ?? 12,
  };
}

export function buildSegmentPolicyActionPlan(
  report: HotspotReportPayload,
  options?: SegmentPolicyActionPlanOptions,
  evaluatedCases?: EvaluatedReplayCase[],
): SegmentPolicyActionPlan {
  const thresholds = resolveThresholds(options);
  const blocklist: SegmentPolicyActionCandidate[] = [];
  const stakeCaps: SegmentPolicyStakeCapCandidate[] = [];
  const reviews: SegmentPolicyActionCandidate[] = [];
  const blockedKeys = new Set<string>();

  for (const row of report.bySegment) {
    if (!eligible(row, thresholds)) continue;

    const blockReasons: string[] = [];
    if (row.replayAccuracy <= thresholds.blockAccuracyAtOrBelow) blockReasons.push(`accuracy <= ${thresholds.blockAccuracyAtOrBelow}`);
    if (row.replayRoi <= thresholds.blockRoiAtOrBelow) blockReasons.push(`ROI <= ${thresholds.blockRoiAtOrBelow}`);
    if (blockReasons.length > 0) {
      blockedKeys.add(row.segmentKey);
      blocklist.push(candidateFromRow(row, blockReasons.join('; ')));
      continue;
    }

    const capReasons: string[] = [];
    if (row.replayAccuracy <= thresholds.capAccuracyAtOrBelow) capReasons.push(`accuracy <= ${thresholds.capAccuracyAtOrBelow}`);
    if (row.replayRoi <= thresholds.capRoiAtOrBelow) capReasons.push(`ROI <= ${thresholds.capRoiAtOrBelow}`);
    if (capReasons.length > 0) {
      stakeCaps.push({
        ...candidateFromRow(row, capReasons.join('; ')),
        suggestedMaxStakePercent: thresholds.defaultStakeCapPercent,
      });
      continue;
    }

    if (row.originalDirectionalLossCount >= thresholds.minSettledDirectional && row.replayActionable > 0) {
      reviews.push(candidateFromRow(row, 'production-loss segment remains replay-actionable; inspect prompt and provider evidence'));
    }
  }

  const blocklistCandidates = sortByRisk(blocklist).slice(0, thresholds.maxRows);
  const stakeCapCandidates = sortByRisk(stakeCaps)
    .filter((row) => !blockedKeys.has(row.segmentKey))
    .slice(0, thresholds.maxRows);
  const reviewCandidates = sortByRisk(reviews)
    .filter((row) => !blockedKeys.has(row.segmentKey))
    .slice(0, thresholds.maxRows);

  return {
    generatedAt: new Date().toISOString(),
    promptVersion: report.promptVersion,
    totalCases: report.totalCases,
    thresholds,
    qualityBlockers: buildQualityBlockers(evaluatedCases),
    blocklistCandidates,
    stakeCapCandidates,
    reviewCandidates,
    suggestedBlocklistJson: {
      segmentKeys: blocklistCandidates.map((row) => row.segmentKey).sort(),
    },
    suggestedStakeCapJson: {
      caps: Object.fromEntries(
        stakeCapCandidates
          .map((row) => [row.segmentKey, row.suggestedMaxStakePercent] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  };
}
