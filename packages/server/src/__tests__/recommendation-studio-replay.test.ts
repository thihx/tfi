import { beforeEach, describe, expect, test, vi } from 'vitest';

const repoMocks = vi.hoisted(() => ({
  getRecommendationReleaseById: vi.fn(),
  getRecommendationPromptTemplateById: vi.fn(),
  getRecommendationRuleSetById: vi.fn(),
  completeRecommendationReplayRun: vi.fn(),
  completeRecommendationReplayRunItem: vi.fn(),
  setRecommendationReleaseValidationStatus: vi.fn(),
  failRecommendationReplayRun: vi.fn(),
  failRecommendationReplayRunItem: vi.fn(),
  getRecommendationReplayRunById: vi.fn(),
  listRecommendationReplayRunItems: vi.fn(),
  markRecommendationReplayRunItemRunning: vi.fn(),
  markRecommendationReplayRunStarted: vi.fn(),
  updateRecommendationReplayRunProgress: vi.fn(),
}));

const dbReplayMocks = vi.hoisted(() => ({
  buildSettledReplayScenarios: vi.fn(),
  buildMockResolvedOdds: vi.fn(),
}));

const pipelineReplayMocks = vi.hoisted(() => ({
  runReplayScenario: vi.fn(),
}));

vi.mock('../repos/recommendation-studio.repo.js', () => repoMocks);
vi.mock('../lib/db-replay-scenarios.js', () => dbReplayMocks);
vi.mock('../lib/pipeline-replay.js', () => pipelineReplayMocks);
vi.mock('../repos/matches-history.repo.js', () => ({ getHistoricalMatchesBatch: vi.fn() }));
vi.mock('../repos/match-snapshots.repo.js', () => ({ getSnapshotsByIds: vi.fn() }));
vi.mock('../lib/settle-rules.js', () => ({
  settleByRule: vi.fn(() => ({ result: 'win' })),
}));
vi.mock('../lib/settled-replay-evaluation.js', () => ({
  buildEvaluatedReplayCase: vi.fn(() => ({
    actionable: true,
    goalsUnder: false,
    goalsOver: true,
    directionalWin: true,
    replayOdds: 1.9,
    breakEvenRate: 0.526,
    replayStakePercent: 1,
    replayPnl: 0.9,
    minuteBand: '30-44',
    scoreState: 'one-goal-margin',
    prematchStrength: 'moderate',
    evidenceMode: 'full_live_data',
    marketAvailabilityBucket: 'playable_side_market',
    canonicalMarket: 'over_2.5',
    minute: 38,
  })),
  summarizeSettledReplayVariant: vi.fn(() => ({
    pushRate: 1,
    noBetRate: 0,
    goalsUnderShare: 0,
    accuracy: 1,
    avgOdds: 1.9,
    avgBreakEvenRate: 0.526,
    totalStaked: 1,
    totalPnl: 0.9,
    roi: 0.9,
    byMarketFamily: [],
    byMinuteBand: [],
    byScoreState: [],
    byPrematchStrength: [],
  })),
}));

import { executeRecommendationStudioReplayRun } from '../lib/recommendation-studio-replay.js';

const release = {
  id: 12,
  release_key: 'release-12',
  name: 'Release 12',
  prompt_template_id: 3,
  rule_set_id: 4,
  status: 'candidate',
  activation_scope: 'global',
  replay_validation_status: 'running',
  notes: '',
  is_active: false,
  activated_by: null,
  activated_at: null,
  rollback_of_release_id: null,
  created_by: 'admin-1',
  updated_by: 'admin-1',
  created_at: '2026-04-21T00:00:00.000Z',
  updated_at: '2026-04-21T00:00:00.000Z',
  promptTemplate: {
    id: 3,
    template_key: 'prompt-3',
    name: 'Prompt 3',
    base_prompt_version: 'v10-hybrid-legacy-b',
    status: 'draft',
    notes: '',
    advanced_appendix: '',
    created_by: null,
    updated_by: null,
    created_at: '2026-04-21T00:00:00.000Z',
    updated_at: '2026-04-21T00:00:00.000Z',
    sections: [],
  },
  ruleSet: {
    id: 4,
    rule_set_key: 'rules-4',
    name: 'Rules 4',
    status: 'draft',
    notes: '',
    created_by: null,
    updated_by: null,
    created_at: '2026-04-21T00:00:00.000Z',
    updated_at: '2026-04-21T00:00:00.000Z',
    rules: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  repoMocks.getRecommendationReplayRunById
    .mockResolvedValueOnce({
      id: 91,
      name: 'Replay 91',
      release_id: 12,
      prompt_template_id: 3,
      rule_set_id: 4,
      status: 'queued',
      release_snapshot_json: {},
      created_by: 'admin-1',
      created_at: '2026-04-21T00:00:00.000Z',
    })
    .mockResolvedValueOnce({
      id: 91,
      status: 'running',
    })
    .mockResolvedValueOnce({
      id: 91,
      status: 'canceled',
    });
  repoMocks.getRecommendationReleaseById.mockResolvedValue(release);
  repoMocks.listRecommendationReplayRunItems.mockResolvedValue([
    {
      id: 501,
      source_kind: 'recommendation',
      source_ref: 'recommendation:1001',
      recommendation_id: 1001,
      snapshot_id: null,
      match_id: '1001',
      status: 'queued',
      original_decision_json: {
        originalSelection: 'Over 2.5',
        originalBetMarket: 'Goals O/U',
        originalResult: 'win',
        originalPnl: 0.9,
      },
      replayed_decision_json: {},
      evaluation_json: {},
      output_summary: {},
    },
  ]);
  dbReplayMocks.buildSettledReplayScenarios.mockResolvedValue([
    {
      name: 'scenario-1',
      metadata: {
        recommendationId: 1001,
        originalSelection: 'Over 2.5',
        originalBetMarket: 'Goals O/U',
        originalResult: 'win',
        originalPnl: 0.9,
        minute: 38,
        score: '1-0',
        league: 'Test League',
        homeTeam: 'A',
        awayTeam: 'B',
      },
      settlementContext: {
        regularHomeScore: 2,
        regularAwayScore: 1,
        settlementStats: [],
      },
    },
  ]);
  pipelineReplayMocks.runReplayScenario.mockResolvedValue({
    result: {
      shouldPush: true,
      selection: 'Over 2.5',
      debug: {
        parsed: {
          bet_market: 'Goals O/U',
          mapped_odd: 1.9,
          stake_percent: 1,
        },
      },
    },
  });
});

describe('recommendation studio replay worker', () => {
  test('does not finalize a canceled replay run after item processing', async () => {
    await executeRecommendationStudioReplayRun(91);

    expect(repoMocks.markRecommendationReplayRunStarted).toHaveBeenCalledWith(91);
    expect(repoMocks.completeRecommendationReplayRunItem).toHaveBeenCalledTimes(1);
    expect(repoMocks.completeRecommendationReplayRun).not.toHaveBeenCalled();
    expect(repoMocks.setRecommendationReleaseValidationStatus).toHaveBeenCalledWith(12, 'running');
    expect(repoMocks.setRecommendationReleaseValidationStatus).not.toHaveBeenCalledWith(12, 'validated');
  });
});
