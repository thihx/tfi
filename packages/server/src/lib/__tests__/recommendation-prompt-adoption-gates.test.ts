import { describe, expect, test } from 'vitest';
import { evaluateRecommendationPromptAdoptionGates } from '../recommendation-prompt-adoption-gates.js';
import type { RecommendationPromptAdoptionReport } from '../recommendation-prompt-adoption-report.js';

function adoptionReport(partial?: Partial<RecommendationPromptAdoptionReport>): RecommendationPromptAdoptionReport {
  return {
    generatedAt: '2026-06-03T00:00:00.000Z',
    lookbackDays: 14,
    officialPromptVersion: 'v10-hybrid-legacy-g',
    activity: {
      firstRowAt: '2026-06-02T00:00:00.000Z',
      latestRowAt: '2026-06-03T00:00:00.000Z',
      latestRowAgeHours: 1,
      latestActionableRowAt: '2026-06-03T00:00:00.000Z',
      latestActionableRowAgeHours: 1,
      latestOfficialPromptRowAt: '2026-06-03T00:00:00.000Z',
      latestOfficialPromptRowAgeHours: 1,
      latestNonOfficialPromptRowAt: '2026-06-02T00:00:00.000Z',
      latestNonOfficialPromptRowAgeHours: 25,
    },
    totals: {
      totalRows: 20,
      actionableRows: 18,
      officialPromptRows: 16,
      officialPromptWithDecisionContext: 15,
      officialPromptMissingDecisionContext: 1,
      nonOfficialPromptRows: 3,
      emptyPromptVersionRows: 1,
      emptyDecisionContextRows: 2,
      officialPromptRate: 80,
      officialPromptWithDecisionContextRate: 75,
    },
    byPromptVersion: [
      {
        promptVersion: 'v10-hybrid-legacy-g',
        count: 16,
        actionable: 15,
        withDecisionContext: 15,
        settled: 4,
        pending: 12,
      },
      {
        promptVersion: 'retired-prompt',
        count: 3,
        actionable: 3,
        withDecisionContext: 2,
        settled: 3,
        pending: 0,
      },
    ],
    recent: [],
    ...partial,
  };
}

describe('evaluateRecommendationPromptAdoptionGates', () => {
  test('passes when recent recommendation rows show official prompt adoption', () => {
    const result = evaluateRecommendationPromptAdoptionGates(
      {
        adoptionPath: 'prompt-adoption.json',
        officialPromptVersion: 'v10-hybrid-legacy-g',
        minTotalRows: 10,
        minActionableRows: 10,
        minOfficialPromptRows: 10,
        minOfficialPromptRate: 0.5,
        minOfficialPromptWithDecisionContext: 10,
        minOfficialPromptWithDecisionContextRate: 0.5,
        maxNonOfficialPromptRate: 0.25,
        maxEmptyPromptVersionRate: 0.1,
        maxEmptyDecisionContextRate: 0.15,
        maxLatestRowAgeHours: 24,
        maxLatestOfficialPromptRowAgeHours: 24,
      },
      adoptionReport(),
    );

    expect(result.ok).toBe(true);
    expect(result.metrics.officialPromptRate).toBe(0.8);
    expect(result.metrics.officialPromptWithDecisionContextRate).toBe(0.75);
    expect(result.failures).toEqual([]);
  });

  test('fails when recent saved rows are all retired prompt versions', () => {
    const result = evaluateRecommendationPromptAdoptionGates(
      {
        adoptionPath: 'prompt-adoption.json',
        officialPromptVersion: 'v10-hybrid-legacy-g',
        minTotalRows: 1,
        minActionableRows: 1,
        minOfficialPromptRows: 1,
        minOfficialPromptRate: 0.01,
        minOfficialPromptWithDecisionContext: 1,
        minOfficialPromptWithDecisionContextRate: 0.01,
        maxNonOfficialPromptRate: 0.99,
        maxLatestRowAgeHours: 72,
        maxLatestOfficialPromptRowAgeHours: 72,
      },
      adoptionReport({
        activity: {
          firstRowAt: '2026-05-21T13:43:35.010Z',
          latestRowAt: '2026-05-25T02:59:20.806Z',
          latestRowAgeHours: 225.5,
          latestActionableRowAt: '2026-05-25T02:59:20.806Z',
          latestActionableRowAgeHours: 225.5,
          latestOfficialPromptRowAt: null,
          latestOfficialPromptRowAgeHours: null,
          latestNonOfficialPromptRowAt: '2026-05-25T02:59:20.806Z',
          latestNonOfficialPromptRowAgeHours: 225.5,
        },
        totals: {
          totalRows: 15,
          actionableRows: 15,
          officialPromptRows: 0,
          officialPromptWithDecisionContext: 0,
          officialPromptMissingDecisionContext: 0,
          nonOfficialPromptRows: 15,
          emptyPromptVersionRows: 0,
          emptyDecisionContextRows: 0,
          officialPromptRate: 0,
          officialPromptWithDecisionContextRate: 0,
        },
        byPromptVersion: [
          {
            promptVersion: 'retired-prompt',
            count: 15,
            actionable: 15,
            withDecisionContext: 15,
            settled: 15,
            pending: 0,
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'officialPromptRows 0 < minOfficialPromptRows 1',
      'officialPromptRate 0.0000 < minOfficialPromptRate 0.01',
      'officialPromptWithDecisionContext 0 < minOfficialPromptWithDecisionContext 1',
      'officialPromptWithDecisionContextRate 0.0000 < minOfficialPromptWithDecisionContextRate 0.01',
      'nonOfficialPromptRate 1.0000 > maxNonOfficialPromptRate 0.99',
      'latestRowAgeHours 225.50 > maxLatestRowAgeHours 72',
      'latestOfficialPromptRowAgeHours (missing) > maxLatestOfficialPromptRowAgeHours 72',
    ]);
  });
});
