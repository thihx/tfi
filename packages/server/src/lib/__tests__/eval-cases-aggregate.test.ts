import { describe, expect, it } from 'vitest';
import { aggregateEvalCasesPayloads } from '../eval-cases-aggregate.js';
import type { EvalCasesFilePayload } from '../replay-vs-original-analysis.js';
import type { EvaluatedReplayCase } from '../settled-replay-evaluation.js';

function row(scenarioName: string, recommendationId: number): EvaluatedReplayCase {
  return {
    promptVersion: 'v-test',
    scenarioName,
    recommendationId,
    minute: 60,
    score: '1-0',
    scoreState: 'one-goal-margin',
    minuteBand: '60-74',
    prematchStrength: 'strong',
    evidenceMode: 'full_live_data',
    marketAvailabilityBucket: 'playable',
    shouldPush: false,
    actionable: false,
    canonicalMarket: 'unknown',
    goalsUnder: false,
    goalsOver: false,
    settlementResult: null,
    directionalWin: null,
    replaySelection: '',
    replayOdds: null,
    replayStakePercent: 0,
    breakEvenRate: null,
    replayPnl: null,
    originalBetMarket: 'under_2.5',
    originalResult: 'win',
    decisionKind: 'no_bet',
    llmDecisionDiagnostic: 'no_bet_intentional',
    marketResolutionStatus: 'not_requested',
    providerCoverageStatus: 'ok',
    replayContextStatus: 'ok',
    replayQualityAttribution: 'model_no_bet',
    replayWarnings: [],
  };
}

function payload(cases: EvaluatedReplayCase[]): EvalCasesFilePayload {
  return {
    generatedAt: '2026-06-03T00:00:00.000Z',
    applySettledReplayPolicy: true,
    promptVersions: ['v-test'],
    variants: [{ promptVersion: 'v-test', cases }],
  };
}

describe('aggregateEvalCasesPayloads', () => {
  it('preserves source order and deduplicates overlapping scenario names', () => {
    const report = aggregateEvalCasesPayloads([
      { runId: 'run-a', payload: payload([row('case-1', 1), row('case-2', 2)]) },
      { runId: 'run-b', payload: payload([row('case-2', 2), row('case-3', 3)]) },
    ]);

    expect(report.totalScenarios).toBe(3);
    expect(report.sourceRuns).toEqual([
      { runId: 'run-a', count: 2 },
      { runId: 'run-b', count: 1 },
    ]);
    expect(report.duplicateScenarioNames).toEqual(['case-2']);
    expect(report.variants[0]?.cases.map((item) => item.scenarioName)).toEqual(['case-1', 'case-2', 'case-3']);
  });
});
