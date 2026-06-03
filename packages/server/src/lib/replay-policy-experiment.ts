import type { EvaluatedReplayCase } from './settled-replay-evaluation.js';

export type ReplayPolicyExperimentId =
  | 'btts_yes_60_74_two_plus'
  | 'late_under_45_two_plus'
  | 'over_15_60_74_one_goal';

export interface ReplayPolicyExperimentConfig {
  id: ReplayPolicyExperimentId;
  label: string;
  stakeCapPercent: number;
}

export interface ReplayPolicyExperimentSelection {
  experimentId: ReplayPolicyExperimentId;
  scenarioName: string;
  recommendationId: number;
  minute: number | null;
  score: string;
  canonicalMarket: string;
  originalBetMarket: string;
  replaySelection: string;
  originalResult: string;
  odds: number;
  stakePercent: number;
  pnlPercent: number;
  replayQualityAttribution: string;
  llmDecisionDiagnostic: string;
  warnings: string[];
  reason: string;
}

export interface ReplayPolicyExperimentResult {
  id: ReplayPolicyExperimentId;
  label: string;
  stakeCapPercent: number;
  selectedCount: number;
  winCount: number;
  lossCount: number;
  pushLikeCount: number;
  totalStakedPercent: number;
  totalPnlPercent: number;
  roiOnStaked: number;
  originalWinsRescued: number;
  originalLossesReintroduced: number;
  selections: ReplayPolicyExperimentSelection[];
}

export interface ReplayPolicyExperimentReport {
  generatedAt: string;
  totalCases: number;
  trustedCounterfactualCandidates: number;
  skippedPolicyBlockedSelections: Array<{
    scenarioName: string;
    recommendationId: number;
    minute: number | null;
    score: string;
    canonicalMarket: string;
    originalBetMarket: string;
    replaySelection: string;
    originalResult: string;
    odds: number | null;
    replayQualityAttribution: string;
    llmDecisionDiagnostic: string;
    warnings: string[];
    reason: string;
  }>;
  experiments: ReplayPolicyExperimentResult[];
  combined: Omit<ReplayPolicyExperimentResult, 'id' | 'label' | 'stakeCapPercent'>;
}

export const DEFAULT_REPLAY_POLICY_EXPERIMENTS: ReplayPolicyExperimentConfig[] = [
  {
    id: 'btts_yes_60_74_two_plus',
    label: 'BTTS Yes 60-74 two-plus clean context, price >= 2.05',
    stakeCapPercent: 1,
  },
  {
    id: 'late_under_45_two_plus',
    label: 'Late Under 4.5 75+ two-plus margin, price >= 2.00',
    stakeCapPercent: 1,
  },
  {
    id: 'over_15_60_74_one_goal',
    label: 'Over 1.5 60-74 one-goal margin, price >= 1.50',
    stakeCapPercent: 1,
  },
];

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function parseOdds(row: EvaluatedReplayCase): number | null {
  if (row.replayOdds != null && Number.isFinite(row.replayOdds) && row.replayOdds > 1) {
    return row.replayOdds;
  }
  const match = String(row.replaySelection || '').match(/@\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const odds = Number(match[1]);
  return Number.isFinite(odds) && odds > 1 ? odds : null;
}

function sameMarket(row: EvaluatedReplayCase): boolean {
  return String(row.canonicalMarket || '').trim().toLowerCase()
    === String(row.originalBetMarket || '').trim().toLowerCase();
}

function hasTrustedPolicyBlockedSelection(row: EvaluatedReplayCase): boolean {
  return !row.actionable
    && row.marketResolutionStatus === 'resolved'
    && !!String(row.replaySelection || '').trim()
    && sameMarket(row)
    && (
      row.llmDecisionDiagnostic === 'policy_blocked'
      || row.replayQualityAttribution === 'model_policy_mismatch'
      || row.replayQualityAttribution === 'hard_policy_gate'
    )
    && parseOdds(row) != null;
}

function resultBucket(result: string): 'win' | 'loss' | 'push_like' | 'unknown' {
  const normalized = String(result || '').trim().toLowerCase();
  if (normalized === 'win' || normalized === 'half_win') return 'win';
  if (normalized === 'loss' || normalized === 'half_loss') return 'loss';
  if (normalized === 'push' || normalized === 'void') return 'push_like';
  return 'unknown';
}

function pnlForResult(result: string, odds: number, stakePercent: number): number {
  switch (String(result || '').trim().toLowerCase()) {
    case 'win':
      return stakePercent * (odds - 1);
    case 'loss':
      return -stakePercent;
    case 'half_win':
      return (stakePercent * (odds - 1)) / 2;
    case 'half_loss':
      return -stakePercent / 2;
    case 'push':
    case 'void':
    default:
      return 0;
  }
}

function experimentReason(id: ReplayPolicyExperimentId): string {
  switch (id) {
    case 'btts_yes_60_74_two_plus':
      return 'Replay-only BTTS Yes clean-context pocket: 60-74, two-plus margin, strong prematch/profile context, totals-only market availability, resolved policy-blocked model selection, price >= 2.05.';
    case 'late_under_45_two_plus':
      return 'Replay-only late Under 4.5 pocket: 75+, two-plus margin, resolved policy-blocked model selection, price >= 2.00.';
    case 'over_15_60_74_one_goal':
      return 'Replay-only Over 1.5 pocket: 60-74, one-goal margin, resolved policy-blocked model selection, price >= 1.50.';
  }
}

function matchesExperiment(row: EvaluatedReplayCase, id: ReplayPolicyExperimentId, odds: number): boolean {
  if (!hasTrustedPolicyBlockedSelection(row)) return false;
  switch (id) {
    case 'btts_yes_60_74_two_plus':
      return row.canonicalMarket === 'btts_yes'
        && row.minuteBand === '60-74'
        && row.scoreState === 'two-plus-margin'
        && row.prematchStrength === 'strong'
        && row.evidenceMode === 'full_live_data'
        && row.marketAvailabilityBucket === 'totals_only'
        && odds >= 2.05;
    case 'late_under_45_two_plus':
      return row.canonicalMarket === 'under_4.5'
        && row.minuteBand === '75+'
        && row.scoreState === 'two-plus-margin'
        && row.evidenceMode === 'full_live_data'
        && odds >= 2.0;
    case 'over_15_60_74_one_goal':
      return row.canonicalMarket === 'over_1.5'
        && row.minuteBand === '60-74'
        && row.scoreState === 'one-goal-margin'
        && row.evidenceMode === 'full_live_data'
        && odds >= 1.5;
  }
}

function skipReasonForTrustedSelection(row: EvaluatedReplayCase): string {
  const odds = parseOdds(row);
  const oddsText = odds == null ? 'unknown' : String(odds);

  if (row.canonicalMarket === 'btts_yes') {
    if (odds == null || odds < 2.05) {
      return `BTTS Yes excluded: strict clean-context pocket requires odds >= 2.05; actual odds=${oddsText}.`;
    }
    return `BTTS Yes excluded: strict clean-context pocket requires minuteBand=60-74, scoreState=two-plus-margin, evidenceMode=full_live_data, prematchStrength=strong, marketAvailabilityBucket=totals_only; actual minuteBand=${row.minuteBand || 'unknown'}, scoreState=${row.scoreState || 'unknown'}, evidenceMode=${row.evidenceMode || 'unknown'}, prematchStrength=${row.prematchStrength || 'unknown'}, marketAvailabilityBucket=${row.marketAvailabilityBucket || 'unknown'}.`;
  }

  if (row.canonicalMarket === 'under_4.5') {
    return `Late Under 4.5 excluded: strict pocket requires minuteBand=75+, scoreState=two-plus-margin, evidenceMode=full_live_data, odds >= 2.00; actual minuteBand=${row.minuteBand || 'unknown'}, scoreState=${row.scoreState || 'unknown'}, evidenceMode=${row.evidenceMode || 'unknown'}, odds=${oddsText}.`;
  }

  if (String(row.canonicalMarket || '').startsWith('under_')) {
    return `Goals Under excluded: strict late-under pocket only covers under_4.5 at 75+, two-plus margin, full_live_data, odds >= 2.00; actual market=${row.canonicalMarket || 'unknown'}, minuteBand=${row.minuteBand || 'unknown'}, scoreState=${row.scoreState || 'unknown'}, odds=${oddsText}.`;
  }

  if (row.canonicalMarket === 'over_1.5') {
    return `Over 1.5 excluded: strict pocket requires minuteBand=60-74, scoreState=one-goal-margin, evidenceMode=full_live_data, odds >= 1.50; actual minuteBand=${row.minuteBand || 'unknown'}, scoreState=${row.scoreState || 'unknown'}, evidenceMode=${row.evidenceMode || 'unknown'}, odds=${oddsText}.`;
  }

  if (String(row.canonicalMarket || '').startsWith('over_')) {
    return `Goals Over excluded: strict over pocket only covers over_1.5 at 60-74, one-goal margin, full_live_data, odds >= 1.50; actual market=${row.canonicalMarket || 'unknown'}, minuteBand=${row.minuteBand || 'unknown'}, scoreState=${row.scoreState || 'unknown'}, odds=${oddsText}.`;
  }

  return 'Trusted policy-blocked selection did not match any configured replay-only experiment pocket.';
}

function selectionFor(
  row: EvaluatedReplayCase,
  experiment: ReplayPolicyExperimentConfig,
  odds: number,
): ReplayPolicyExperimentSelection {
  const stakePercent = Math.max(0, experiment.stakeCapPercent);
  return {
    experimentId: experiment.id,
    scenarioName: row.scenarioName,
    recommendationId: row.recommendationId,
    minute: row.minute,
    score: row.score,
    canonicalMarket: row.canonicalMarket,
    originalBetMarket: row.originalBetMarket,
    replaySelection: row.replaySelection,
    originalResult: row.originalResult,
    odds,
    stakePercent,
    pnlPercent: round(pnlForResult(row.originalResult, odds, stakePercent)),
    replayQualityAttribution: row.replayQualityAttribution,
    llmDecisionDiagnostic: row.llmDecisionDiagnostic,
    warnings: row.replayWarnings,
    reason: experimentReason(experiment.id),
  };
}

function summarizeExperiment(
  experiment: ReplayPolicyExperimentConfig,
  selections: ReplayPolicyExperimentSelection[],
): ReplayPolicyExperimentResult {
  const totalStakedPercent = round(selections.reduce((sum, row) => sum + row.stakePercent, 0));
  const totalPnlPercent = round(selections.reduce((sum, row) => sum + row.pnlPercent, 0));
  return {
    id: experiment.id,
    label: experiment.label,
    stakeCapPercent: experiment.stakeCapPercent,
    selectedCount: selections.length,
    winCount: selections.filter((row) => resultBucket(row.originalResult) === 'win').length,
    lossCount: selections.filter((row) => resultBucket(row.originalResult) === 'loss').length,
    pushLikeCount: selections.filter((row) => resultBucket(row.originalResult) === 'push_like').length,
    totalStakedPercent,
    totalPnlPercent,
    roiOnStaked: totalStakedPercent > 0 ? round(totalPnlPercent / totalStakedPercent) : 0,
    originalWinsRescued: selections.filter((row) => resultBucket(row.originalResult) === 'win').length,
    originalLossesReintroduced: selections.filter((row) => resultBucket(row.originalResult) === 'loss').length,
    selections,
  };
}

export function buildReplayPolicyExperimentReport(
  cases: EvaluatedReplayCase[],
  experiments: ReplayPolicyExperimentConfig[] = DEFAULT_REPLAY_POLICY_EXPERIMENTS,
): ReplayPolicyExperimentReport {
  const trusted = cases.filter(hasTrustedPolicyBlockedSelection);
  const usedScenarioNames = new Set<string>();
  const results = experiments.map((experiment) => {
    const selections = trusted
      .map((row) => ({ row, odds: parseOdds(row) }))
      .filter((entry): entry is { row: EvaluatedReplayCase; odds: number } => entry.odds != null)
      .filter(({ row, odds }) => matchesExperiment(row, experiment.id, odds))
      .map(({ row, odds }) => {
        usedScenarioNames.add(row.scenarioName);
        return selectionFor(row, experiment, odds);
      });
    return summarizeExperiment(experiment, selections);
  });

  const combinedSelections = results.flatMap((result) => result.selections);
  const combinedExperiment: ReplayPolicyExperimentConfig = {
    id: 'btts_yes_60_74_two_plus',
    label: 'combined',
    stakeCapPercent: 0,
  };
  const { id: _id, label: _label, stakeCapPercent: _stakeCapPercent, ...combined } = summarizeExperiment(
    combinedExperiment,
    combinedSelections,
  );

  return {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    trustedCounterfactualCandidates: trusted.length,
    skippedPolicyBlockedSelections: trusted
      .filter((row) => !usedScenarioNames.has(row.scenarioName))
      .map((row) => ({
        scenarioName: row.scenarioName,
        recommendationId: row.recommendationId,
        minute: row.minute,
        score: row.score,
        canonicalMarket: row.canonicalMarket,
        originalBetMarket: row.originalBetMarket,
        replaySelection: row.replaySelection,
        originalResult: row.originalResult,
        odds: parseOdds(row),
        replayQualityAttribution: row.replayQualityAttribution,
        llmDecisionDiagnostic: row.llmDecisionDiagnostic,
        warnings: row.replayWarnings,
        reason: skipReasonForTrustedSelection(row),
      })),
    experiments: results,
    combined,
  };
}
