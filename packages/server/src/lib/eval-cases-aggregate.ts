import type { EvaluatedReplayCase } from './settled-replay-evaluation.js';
import type { EvalCasesFilePayload } from './replay-vs-original-analysis.js';

export interface EvalCasesAggregateInput {
  runId: string;
  payload: EvalCasesFilePayload;
}

export interface EvalCasesAggregatePayload extends EvalCasesFilePayload {
  totalScenarios: number;
  sourceRuns: Array<{
    runId: string;
    count: number;
  }>;
  duplicateScenarioNames: string[];
}

function caseKey(row: EvaluatedReplayCase): string {
  return row.scenarioName || `recommendation:${row.recommendationId}`;
}

function uniquePromptVersions(payloads: EvalCasesFilePayload[]): string[] {
  const seen = new Set<string>();
  for (const payload of payloads) {
    for (const version of payload.promptVersions ?? []) seen.add(version);
    for (const variant of payload.variants) seen.add(variant.promptVersion);
  }
  return [...seen];
}

export function aggregateEvalCasesPayloads(inputs: EvalCasesAggregateInput[]): EvalCasesAggregatePayload {
  const byPromptVersion = new Map<string, EvaluatedReplayCase[]>();
  const seenByPromptVersion = new Map<string, Set<string>>();
  const duplicateScenarioNames = new Set<string>();
  const sourceRuns: EvalCasesAggregatePayload['sourceRuns'] = [];

  for (const input of inputs) {
    let sourceCount = 0;
    for (const variant of input.payload.variants) {
      const rows = byPromptVersion.get(variant.promptVersion) ?? [];
      const seen = seenByPromptVersion.get(variant.promptVersion) ?? new Set<string>();
      for (const row of variant.cases) {
        const key = caseKey(row);
        if (seen.has(key)) {
          duplicateScenarioNames.add(key);
          continue;
        }
        seen.add(key);
        rows.push(row);
        sourceCount++;
      }
      byPromptVersion.set(variant.promptVersion, rows);
      seenByPromptVersion.set(variant.promptVersion, seen);
    }
    sourceRuns.push({ runId: input.runId, count: sourceCount });
  }

  const variants = [...byPromptVersion.entries()].map(([promptVersion, cases]) => ({ promptVersion, cases }));
  return {
    generatedAt: new Date().toISOString(),
    totalScenarios: variants[0]?.cases.length ?? 0,
    applySettledReplayPolicy: inputs.every((input) => input.payload.applySettledReplayPolicy !== false),
    promptVersions: uniquePromptVersions(inputs.map((input) => input.payload)),
    sourceRuns,
    duplicateScenarioNames: [...duplicateScenarioNames].sort(),
    variants,
  };
}
