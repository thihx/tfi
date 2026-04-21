import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from './football-api.js';
import { buildSettledReplayScenarios, buildMockResolvedOdds, type SettledReplayScenario } from './db-replay-scenarios.js';
import { runReplayScenario, type ReplayScenario } from './pipeline-replay.js';
import { settleByRule } from './settle-rules.js';
import type { FinalSettlementResult } from './settle-types.js';
import { buildEvaluatedReplayCase, summarizeSettledReplayVariant } from './settled-replay-evaluation.js';
import { getHistoricalMatchesBatch } from '../repos/matches-history.repo.js';
import { getSnapshotsByIds, type MatchSnapshotRow } from '../repos/match-snapshots.repo.js';
import { getRecommendationReleaseById } from '../repos/recommendation-studio.repo.js';
import { getRecommendationPromptTemplateById, getRecommendationRuleSetById } from '../repos/recommendation-studio.repo.js';
import type {
  RecommendationReleaseDetail,
} from './recommendation-studio-types.js';
import {
  completeRecommendationReplayRun,
  completeRecommendationReplayRunItem,
  setRecommendationReleaseValidationStatus,
  failRecommendationReplayRun,
  failRecommendationReplayRunItem,
  getRecommendationReplayRunById,
  listRecommendationReplayRunItems,
  markRecommendationReplayRunItemRunning,
  markRecommendationReplayRunStarted,
  updateRecommendationReplayRunProgress,
} from '../repos/recommendation-studio.repo.js';

const RECOMMENDATION_STUDIO_REPLAY_MAX_CONCURRENCY = 1;
const replayRunQueue: number[] = [];
const replayRunSet = new Set<number>();
let activeReplayRuns = 0;

function compactStatsToApiStatistics(stats: Record<string, unknown>): ApiFixtureStat[] {
  const pairs: Array<[string, string]> = [
    ['possession', 'Ball Possession'],
    ['shots', 'Total Shots'],
    ['shots_on_target', 'Shots on Goal'],
    ['corners', 'Corner Kicks'],
    ['fouls', 'Fouls'],
    ['offsides', 'Offsides'],
    ['yellow_cards', 'Yellow Cards'],
    ['red_cards', 'Red Cards'],
    ['goalkeeper_saves', 'Goalkeeper Saves'],
    ['blocked_shots', 'Blocked Shots'],
    ['total_passes', 'Total passes'],
    ['passes_accurate', 'Passes accurate'],
    ['shots_off_target', 'Shots off Goal'],
    ['shots_inside_box', 'Shots insidebox'],
    ['shots_outside_box', 'Shots outsidebox'],
    ['expected_goals', 'expected_goals'],
    ['goals_prevented', 'goals_prevented'],
    ['passes_percent', 'Passes %'],
  ];
  const homeStats: Array<{ type: string; value: string | number | null }> = [];
  const awayStats: Array<{ type: string; value: string | number | null }> = [];
  for (const [key, apiName] of pairs) {
    const row = stats[key];
    if (!row || typeof row !== 'object') continue;
    const pair = row as { home?: unknown; away?: unknown };
    homeStats.push({ type: apiName, value: (pair.home ?? null) as string | number | null });
    awayStats.push({ type: apiName, value: (pair.away ?? null) as string | number | null });
  }
  return [
    { team: { id: 0, name: 'Home', logo: '' }, statistics: homeStats },
    { team: { id: 1, name: 'Away', logo: '' }, statistics: awayStats },
  ];
}

function stringifyIdList(values: number[]): string[] {
  return values.map((value) => String(value));
}

function buildSnapshotReplayScenario(
  snapshot: MatchSnapshotRow,
  historical: Awaited<ReturnType<typeof getHistoricalMatchesBatch>> extends Map<string, infer T> ? T | null : never,
): SettledReplayScenario {
  const fixture: ApiFixture = {
    fixture: {
      id: Number(snapshot.match_id),
      referee: null,
      timezone: 'UTC',
      date: snapshot.captured_at,
      timestamp: Math.floor(new Date(snapshot.captured_at).getTime() / 1000),
      periods: { first: null, second: null },
      venue: { id: null, name: historical?.venue ?? null, city: null },
      status: { long: snapshot.status, short: snapshot.status, elapsed: snapshot.minute },
    },
    league: {
      id: historical?.league_id ?? 0,
      name: historical?.league_name ?? 'Unknown League',
      country: '',
      logo: '',
      flag: null,
      season: 0,
      round: '',
    },
    teams: {
      home: { id: historical?.home_team_id ?? 0, name: historical?.home_team ?? 'Home', logo: '', winner: null },
      away: { id: historical?.away_team_id ?? 0, name: historical?.away_team ?? 'Away', logo: '', winner: null },
    },
    goals: { home: snapshot.home_score, away: snapshot.away_score },
    score: {},
  };

  const statsSnapshot = (snapshot.stats ?? {}) as Record<string, unknown>;
  const settlementStats = Array.isArray(historical?.settlement_stats) ? historical.settlement_stats : [];
  return {
    name: `snapshot-${snapshot.id}`,
    matchId: snapshot.match_id,
    fixture,
    statistics: compactStatsToApiStatistics(statsSnapshot),
    events: Array.isArray(snapshot.events) ? snapshot.events as ApiFixtureEvent[] : [],
    mockResolvedOdds: buildMockResolvedOdds(snapshot.odds ?? {}),
    metadata: {
      recommendationId: -snapshot.id,
      originalPromptVersion: 'snapshot-replay',
      originalAiModel: 'n/a',
      originalBetMarket: '',
      originalSelection: '',
      originalResult: '',
      originalPnl: 0,
      minute: snapshot.minute,
      score: `${snapshot.home_score}-${snapshot.away_score}`,
      status: snapshot.status,
      league: historical?.league_name ?? 'Unknown League',
      homeTeam: historical?.home_team ?? 'Home',
      awayTeam: historical?.away_team ?? 'Away',
      evidenceMode: 'unknown',
      prematchStrength: 'unknown',
      profileCoverageBand: 'unknown',
      overlayCoverageBand: 'unknown',
      policyImpactBand: 'unknown',
    },
    settlementContext: {
      matchId: snapshot.match_id,
      homeTeam: historical?.home_team ?? 'Home',
      awayTeam: historical?.away_team ?? 'Away',
      finalStatus: historical?.final_status ?? snapshot.status,
      homeScore: historical?.home_score ?? snapshot.home_score,
      awayScore: historical?.away_score ?? snapshot.away_score,
      regularHomeScore: historical?.regular_home_score ?? historical?.home_score ?? snapshot.home_score,
      regularAwayScore: historical?.regular_away_score ?? historical?.away_score ?? snapshot.away_score,
      halftimeHome: historical?.halftime_home ?? null,
      halftimeAway: historical?.halftime_away ?? null,
      settlementStats,
    } as SettledReplayScenario['settlementContext'] & { halftimeHome: number | null; halftimeAway: number | null },
  };
}

export async function buildRecommendationStudioReplayScenarios(filters: {
  recommendationIds?: number[];
  snapshotIds?: number[];
}): Promise<SettledReplayScenario[]> {
  const recommendationIds = filters.recommendationIds ?? [];
  const snapshotIds = filters.snapshotIds ?? [];
  const scenarios: SettledReplayScenario[] = [];
  if (recommendationIds.length > 0) {
    const recScenarios = await buildSettledReplayScenarios({
      recommendationIds,
      limit: recommendationIds.length,
      lookbackDays: 3650,
      marketFamily: 'all',
    });
    scenarios.push(...recScenarios);
  }
  if (snapshotIds.length > 0) {
    const snapshots = await getSnapshotsByIds(snapshotIds);
    const historicalMap = await getHistoricalMatchesBatch(snapshots.map((row) => row.match_id));
    for (const snapshot of snapshots) {
      scenarios.push(buildSnapshotReplayScenario(snapshot, historicalMap.get(snapshot.match_id) ?? null));
    }
  }
  return scenarios;
}

function settleReplayOutput(
  scenario: SettledReplayScenario,
  output: Awaited<ReturnType<typeof runReplayScenario>>,
): { result: FinalSettlementResult | 'unresolved' | null; pnl: number | null } {
  const parsed = (output.result.debug?.parsed ?? {}) as Record<string, unknown>;
  const market = String(parsed.bet_market ?? '');
  const { regularHomeScore, regularAwayScore, settlementStats } = scenario.settlementContext;
  const settled = settleByRule({
    market,
    selection: output.result.selection,
    homeScore: regularHomeScore,
    awayScore: regularAwayScore,
    htHomeScore: (scenario.settlementContext as SettledReplayScenario['settlementContext'] & { halftimeHome?: number | null }).halftimeHome ?? undefined,
    htAwayScore: (scenario.settlementContext as SettledReplayScenario['settlementContext'] & { halftimeAway?: number | null }).halftimeAway ?? undefined,
    statistics: settlementStats as Array<{ type: string; home: string | number | null; away: string | number | null }>,
  });
  if (!settled) return { result: 'unresolved', pnl: null };
  const odds = Number(parsed.mapped_odd ?? 0);
  const stakePercent = Number(parsed.stake_percent ?? 0);
  const stakeUnits = stakePercent > 0 ? stakePercent : 1;
  let pnl = 0;
  switch (settled.result) {
    case 'win':
      pnl = odds > 0 ? (odds - 1) * stakeUnits : 0;
      break;
    case 'half_win':
      pnl = odds > 0 ? ((odds - 1) * stakeUnits) / 2 : 0;
      break;
    case 'half_loss':
      pnl = -stakeUnits / 2;
      break;
    case 'loss':
      pnl = -stakeUnits;
      break;
    case 'push':
    case 'void':
      pnl = 0;
      break;
    default:
      pnl = 0;
  }
  return { result: settled.result, pnl };
}

function buildReplayDecisionJson(
  output: Awaited<ReturnType<typeof runReplayScenario>>,
): Record<string, unknown> {
  const parsed = (output.result.debug?.parsed ?? {}) as Record<string, unknown>;
  return {
    shouldPush: output.result.shouldPush,
    selection: output.result.selection,
    betMarket: parsed.bet_market ?? '',
    odds: parsed.mapped_odd ?? null,
    confidence: parsed.confidence ?? null,
    stakePercent: parsed.stake_percent ?? null,
    riskLevel: parsed.risk_level ?? null,
    aiText: parsed.aiText ?? null,
  };
}

function buildReplayEvaluationJson(input: {
  item: { original_decision_json: Record<string, unknown> };
  replayDecisionJson: Record<string, unknown>;
  settlementResult: FinalSettlementResult | 'unresolved' | null;
  replayPnl: number | null;
}): Record<string, unknown> {
  const originalSelection = String(input.item.original_decision_json.originalSelection ?? '');
  const replaySelection = String(input.replayDecisionJson.selection ?? '');
  const originalBetMarket = String(input.item.original_decision_json.originalBetMarket ?? '');
  const replayBetMarket = String(input.replayDecisionJson.betMarket ?? '');
  const originalPnl = Number(input.item.original_decision_json.originalPnl ?? 0);
  const replayPnl = input.replayPnl ?? null;
  return {
    originalSelection,
    replaySelection,
    originalBetMarket,
    replayBetMarket,
    decisionChanged: originalSelection !== replaySelection || originalBetMarket !== replayBetMarket,
    originalResult: input.item.original_decision_json.originalResult ?? null,
    replaySettlementResult: input.settlementResult,
    originalPnl,
    replayPnl,
    pnlDelta: replayPnl == null ? null : replayPnl - originalPnl,
  };
}

export async function executeRecommendationStudioReplayRun(
  runId: number,
): Promise<void> {
  const run = await getRecommendationReplayRunById(runId);
  if (!run) throw new Error(`Replay run ${runId} not found`);
  if (run.status === 'canceled') return;
  const release = run.release_id
    ? (
      Object.keys(run.release_snapshot_json ?? {}).length > 0
        ? run.release_snapshot_json as unknown as RecommendationReleaseDetail
        : await getRecommendationReleaseById(run.release_id)
    )
    : await (async () => {
      const [promptTemplate, ruleSet] = await Promise.all([
        getRecommendationPromptTemplateById(run.prompt_template_id),
        getRecommendationRuleSetById(run.rule_set_id),
      ]);
      if (!promptTemplate || !ruleSet) return null;
      return {
        id: 0,
        release_key: 'transient-replay',
        name: run.name,
        prompt_template_id: promptTemplate.id,
        rule_set_id: ruleSet.id,
        status: 'candidate',
        activation_scope: 'global',
        replay_validation_status: 'not_validated',
        notes: '',
        is_active: false,
        activated_by: null,
        activated_at: null,
        rollback_of_release_id: null,
        created_by: run.created_by,
        updated_by: run.created_by,
        created_at: run.created_at,
        updated_at: run.created_at,
        promptTemplate,
        ruleSet,
      } satisfies RecommendationReleaseDetail;
    })();
  if (!release) {
    throw new Error('Replay run release is missing');
  }
  const items = await listRecommendationReplayRunItems(runId);
  await markRecommendationReplayRunStarted(runId);
  if (run.release_id) {
    await setRecommendationReleaseValidationStatus(run.release_id, 'running');
  }
  const recommendationIds = items
    .filter((item) => item.source_kind === 'recommendation' && item.recommendation_id != null)
    .map((item) => Number(item.recommendation_id));
  const snapshotIds = items
    .filter((item) => item.source_kind === 'snapshot' && item.snapshot_id != null)
    .map((item) => Number(item.snapshot_id));
  const scenarios = await buildRecommendationStudioReplayScenarios({
    recommendationIds,
    snapshotIds,
  });
  const scenarioMap = new Map<string, SettledReplayScenario>();
  for (const scenario of scenarios) {
    if (scenario.metadata.recommendationId > 0) {
      scenarioMap.set(`recommendation:${scenario.metadata.recommendationId}`, scenario);
    } else {
      scenarioMap.set(`snapshot:${Math.abs(scenario.metadata.recommendationId)}`, scenario);
    }
  }
  const evaluatedCases = [];
  let failedItems = 0;
  let completed = 0;
  for (const item of items) {
    try {
      const latestRun = await getRecommendationReplayRunById(runId);
      if (!latestRun || latestRun.status === 'canceled') {
        return;
      }
      await markRecommendationReplayRunItemRunning(item.id);
      const scenario = scenarioMap.get(item.source_ref);
      if (!scenario) {
        throw new Error(`Replay scenario not found for ${item.source_ref}`);
      }
      const output = await runReplayScenario(scenario as ReplayScenario, {
        llmMode: 'real',
        oddsMode: 'mock',
        shadowMode: false,
        advisoryOnly: false,
        recommendationStudioOverride: { release },
      });
      const { result, pnl } = settleReplayOutput(scenario, output);
      const parsed = (output.result.debug?.parsed ?? {}) as Record<string, unknown>;
      const evaluated = buildEvaluatedReplayCase(
        release.promptTemplate.base_prompt_version,
        scenario,
        output,
        result,
        Number(parsed.mapped_odd ?? 0) || null,
        Number(parsed.stake_percent ?? 0) || null,
        pnl,
        'unknown',
      );
      evaluatedCases.push(evaluated);
      const replayedDecisionJson = buildReplayDecisionJson(output);
      const evaluationJson = buildReplayEvaluationJson({
        item,
        replayDecisionJson: replayedDecisionJson,
        settlementResult: result,
        replayPnl: pnl,
      });
      await completeRecommendationReplayRunItem(item.id, {
        replayedDecisionJson,
        evaluationJson,
        outputSummary: {
          scenarioName: scenario.name,
          shouldPush: output.result.shouldPush,
          selection: output.result.selection,
          betMarket: parsed.bet_market ?? '',
          settlementResult: result,
          replayPnl: pnl,
          evaluation: evaluationJson,
        },
      });
    } catch (err) {
      await failRecommendationReplayRunItem(item.id, err instanceof Error ? err.message : String(err));
      failedItems += 1;
    }
    completed += 1;
    await updateRecommendationReplayRunProgress(runId, completed);
  }
  const summary = summarizeSettledReplayVariant(release.promptTemplate.base_prompt_version, evaluatedCases);
  const latestRun = await getRecommendationReplayRunById(runId);
  if (!latestRun || latestRun.status === 'canceled') {
    return;
  }
  await completeRecommendationReplayRun(runId, {
    summary,
    periods: {
      h1: evaluatedCases.filter((row) => row.canonicalMarket.startsWith('ht_')).length,
      ft: evaluatedCases.filter((row) => !row.canonicalMarket.startsWith('ht_')).length,
    },
  }, { failedItems });
  if (run.release_id) {
    await setRecommendationReleaseValidationStatus(run.release_id, failedItems === 0 ? 'validated' : 'failed');
  }
}

export function scheduleRecommendationStudioReplayRun(runId: number): void {
  if (replayRunSet.has(runId)) return;
  replayRunSet.add(runId);
  replayRunQueue.push(runId);
  void drainRecommendationStudioReplayQueue();
}

async function drainRecommendationStudioReplayQueue(): Promise<void> {
  if (activeReplayRuns >= RECOMMENDATION_STUDIO_REPLAY_MAX_CONCURRENCY) return;
  const nextRunId = replayRunQueue.shift();
  if (!nextRunId) return;
  replayRunSet.delete(nextRunId);
  activeReplayRuns += 1;
  try {
    await executeRecommendationStudioReplayRun(nextRunId);
  } catch (err) {
    await failRecommendationReplayRun(nextRunId, err instanceof Error ? err.message : String(err));
  } finally {
    activeReplayRuns = Math.max(0, activeReplayRuns - 1);
    if (replayRunQueue.length > 0) {
      void drainRecommendationStudioReplayQueue();
    }
  }
}

export function buildRecommendationStudioReplayItems(input: {
  recommendationIds?: number[];
  snapshotIds?: number[];
}): Array<{
  source_kind: 'recommendation' | 'snapshot';
  source_ref: string;
  recommendation_id?: number | null;
  snapshot_id?: number | null;
  match_id?: string | null;
}> {
  return [
    ...stringifyIdList(input.recommendationIds ?? []).map((value) => ({
      source_kind: 'recommendation' as const,
      source_ref: `recommendation:${value}`,
      recommendation_id: Number(value),
    })),
    ...stringifyIdList(input.snapshotIds ?? []).map((value) => ({
      source_kind: 'snapshot' as const,
      source_ref: `snapshot:${value}`,
      snapshot_id: Number(value),
    })),
  ];
}
