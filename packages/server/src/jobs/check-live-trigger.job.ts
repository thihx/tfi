// ============================================================
// Job: Check Live Matches & Auto-Trigger AI Pipeline
// Detects active watchlist matches that are currently live,
// then triggers server-side AI analysis in batches.
// ============================================================

import { config } from '../config.js';
import { skipIfFootballApiCircuitOpen } from '../lib/football-api-circuit.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import * as matchRepo from '../repos/matches.repo.js';
import * as snapshotsRepo from '../repos/match-snapshots.repo.js';
import * as recommendationsRepo from '../repos/recommendations.repo.js';
import {
  getLatestStatsOnlySignalDeliveriesByMatchIds,
  type LatestStatsOnlySignalDeliveryRow,
} from '../repos/match-alert-deliveries.repo.js';
import { getSettings } from '../repos/settings.repo.js';
import { checkCoarseStalenessServer } from '../lib/server-pipeline-gates.js';
import { reportJobProgress } from './job-progress.js';
import { runPipelineBatch, type PipelineResult } from '../lib/server-pipeline.js';
import { audit } from '../lib/audit.js';

function parseNumSetting(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && raw !== '' && raw !== null && raw !== undefined ? n : fallback;
}

function countPipelineResults(
  results: PipelineResult[],
  predicate: (result: PipelineResult['results'][number]) => boolean,
): number {
  return results.reduce(
    (sum, batch) => sum + batch.results.filter(predicate).length,
    0,
  );
}

function hasObjectKeys(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function hasArrayItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function snapshotHasStatsOrEvents(snapshot: snapshotsRepo.MatchSnapshotRow | null | undefined): boolean {
  if (!snapshot) return false;
  return hasObjectKeys(snapshot.stats) || hasArrayItems(snapshot.events);
}

function snapshotHasUsableOdds(snapshot: snapshotsRepo.MatchSnapshotRow | null | undefined): boolean {
  return hasObjectKeys(snapshot?.odds);
}

function minutesSince(value: string | null | undefined, nowMs = Date.now()): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((nowMs - ms) / 60_000));
}

function shouldOverrideForStatsOnlySignal(input: {
  snapshot: snapshotsRepo.MatchSnapshotRow | null | undefined;
  latestSignal: LatestStatsOnlySignalDeliveryRow | null | undefined;
  cooldownMinutes: number;
}): { shouldOverride: boolean; reason: string; lastSignalAgeMinutes: number | null } {
  if (!snapshotHasStatsOrEvents(input.snapshot)) {
    return { shouldOverride: false, reason: 'no_stats_or_events_snapshot', lastSignalAgeMinutes: null };
  }
  if (snapshotHasUsableOdds(input.snapshot)) {
    return { shouldOverride: false, reason: 'snapshot_has_odds', lastSignalAgeMinutes: null };
  }

  const age = minutesSince(input.latestSignal?.createdAt);
  if (age == null) {
    return { shouldOverride: true, reason: 'stats_only_no_prior_signal', lastSignalAgeMinutes: null };
  }
  const cooldown = Math.max(1, Math.trunc(input.cooldownMinutes));
  if (age >= cooldown) {
    return { shouldOverride: true, reason: 'stats_only_signal_cooldown_elapsed', lastSignalAgeMinutes: age };
  }
  return { shouldOverride: false, reason: 'stats_only_signal_cooldown_active', lastSignalAgeMinutes: age };
}

export async function checkLiveTriggerJob(): Promise<{
  liveCount: number;
  candidateCount?: number;
  pipelineResults?: PipelineResult[];
  failedBatches?: number;
  failedBatchMatches?: number;
  skipped?: boolean;
  skipReason?: string;
  openUntil?: string;
  apiFootballCircuitOpen?: boolean;
  apiFootballCircuitOpenUntil?: string;
}> {
  const JOB = 'check-live-trigger';

  const circuitSkip = await skipIfFootballApiCircuitOpen();
  if (circuitSkip) {
    await reportJobProgress(
      JOB,
      'degraded',
      `API-Football circuit open until ${circuitSkip.openUntil}; continuing from DB/provider fallback inputs...`,
      5,
    );
  }

  // 1. Get active watchlist match IDs
  await reportJobProgress(JOB, 'load', 'Loading active watchlist...', 15);
  const activeWatchlist = await watchlistRepo.getAutoPipelineOperationalWatchlist();
  if (activeWatchlist.length === 0) {
    return { liveCount: 0 };
  }
  const activeMatchIds = activeWatchlist.map((w) => w.match_id);

  // 2. Get matches and find live ones
  await reportJobProgress(JOB, 'check', `Checking ${activeMatchIds.length} match statuses...`, 45);
  const matches = await matchRepo.getMatchesByIds(activeMatchIds);
  const matchMap = new Map(matches.map((match) => [match.match_id, match] as const));
  const watchlistMap = new Map(activeWatchlist.map((row) => [row.match_id, row] as const));
  const statusMap = new Map(matches.map((m) => [m.match_id, m.status]));

  const liveMatchIds = activeMatchIds.filter((id) => {
    const status = statusMap.get(id);
    return status && config.liveStatuses.includes(status);
  });

  if (liveMatchIds.length === 0) {
    return { liveCount: 0 };
  }

  // 3. Increment check count for live watchlist entries — single batch query
  await reportJobProgress(JOB, 'increment', `Updating ${liveMatchIds.length} live matches...`, 60);
  await watchlistRepo.incrementChecksForMatches(liveMatchIds);

  console.log(`[checkLiveTriggerJob] ${liveMatchIds.length} live matches detected`);

  // 4. Auto-trigger AI pipeline (if enabled)
  if (!config.pipelineEnabled) {
    console.log('[checkLiveTriggerJob] Pipeline disabled, skipping AI analysis');
    return { liveCount: liveMatchIds.length };
  }

  await reportJobProgress(JOB, 'candidate', `Filtering ${liveMatchIds.length} live matches for significant changes...`, 68);

  const [latestSnapshots, latestRecommendations, latestStatsOnlySignalsResult, rawSettings] = await Promise.all([
    snapshotsRepo.getLatestSnapshotsForMatches(liveMatchIds),
    recommendationsRepo.getLatestRecommendationsForMatches(liveMatchIds),
    getLatestStatsOnlySignalDeliveriesByMatchIds(liveMatchIds)
      .then((rows) => ({ rows, failed: false }))
      .catch(() => ({ rows: new Map<string, LatestStatsOnlySignalDeliveryRow>(), failed: true })),
    getSettings().catch(() => ({} as Record<string, unknown>)),
  ]);
  const latestStatsOnlySignals = latestStatsOnlySignalsResult.rows;
  const reanalyzeMinMinutes = parseNumSetting(
    rawSettings['REANALYZE_MIN_MINUTES'],
    config.pipelineReanalyzeMinMinutes,
  );
  const statsOnlySignalRecheckMinutes = parseNumSetting(
    rawSettings['STATS_ONLY_SIGNAL_RECHECK_MINUTES'],
    config.statsOnlySignalRecheckMinutes,
  );

  const stalenessDiagnostics: Array<Record<string, unknown>> = [];
  const candidateMatchIds = liveMatchIds.filter((matchId) => {
    const match = matchMap.get(matchId);
    const watchlistEntry = watchlistMap.get(matchId);
    if (!match || !watchlistEntry) return false;
    const previousSnapshot = latestSnapshots.get(matchId) ?? null;
    const previousRecommendation = latestRecommendations.get(matchId) ?? null;

    const score = `${match.home_score ?? 0}-${match.away_score ?? 0}`;
    const staleness = checkCoarseStalenessServer({
      minute: match.current_minute ?? 0,
      status: match.status,
      score,
      previousRecommendation: previousRecommendation
        ? {
            minute: previousRecommendation.minute,
            odds: previousRecommendation.odds,
            bet_market: previousRecommendation.bet_market,
            selection: previousRecommendation.selection,
            score: previousRecommendation.score,
            status: previousRecommendation.status,
          }
        : null,
      previousSnapshot: previousSnapshot
        ? {
            minute: previousSnapshot.minute,
            home_score: previousSnapshot.home_score,
            away_score: previousSnapshot.away_score,
            status: previousSnapshot.status,
            odds: previousSnapshot.odds,
          }
        : null,
      settings: { reanalyzeMinMinutes },
      forceAnalyze: false,
    });
    const statsOnlyOverride = latestStatsOnlySignalsResult.failed && staleness.isStale
      ? { shouldOverride: false, reason: 'stats_only_signal_lookup_failed', lastSignalAgeMinutes: null }
      : staleness.isStale
      ? shouldOverrideForStatsOnlySignal({
          snapshot: previousSnapshot,
          latestSignal: latestStatsOnlySignals.get(matchId) ?? null,
          cooldownMinutes: statsOnlySignalRecheckMinutes,
        })
      : { shouldOverride: false, reason: 'not_stale', lastSignalAgeMinutes: null };
    const selected = !staleness.isStale || statsOnlyOverride.shouldOverride;
    stalenessDiagnostics.push({
      matchId,
      status: match.status,
      minute: match.current_minute ?? null,
      score,
      selected,
      stalenessReason: staleness.reason,
      stalenessBaseline: staleness.baseline,
      statsOnlyOverride: statsOnlyOverride.shouldOverride,
      statsOnlyOverrideReason: statsOnlyOverride.reason,
      statsOnlySignalAgeMinutes: statsOnlyOverride.lastSignalAgeMinutes,
      snapshotHasStatsOrEvents: snapshotHasStatsOrEvents(previousSnapshot),
      snapshotHasOdds: snapshotHasUsableOdds(previousSnapshot),
    });
    return selected;
  });

  if (candidateMatchIds.length === 0) {
    await reportJobProgress(JOB, 'complete', 'Done: no candidate matches needed re-analysis', 100);
    audit({
      category: 'PIPELINE',
      action: 'PIPELINE_COMPLETE',
      outcome: 'SUCCESS',
      actor: 'auto-pipeline',
      metadata: {
        liveCount: liveMatchIds.length,
        candidateCount: 0,
        liveMatchIds,
        candidateMatchIds: [],
        skippedMatchIds: liveMatchIds,
        stalenessDiagnostics,
        statsOnlyOverrideCandidates: 0,
        batches: 0,
        totalProcessed: 0,
        totalProviderReady: 0,
        totalLlmEligible: 0,
        totalPreLlmSkipped: 0,
        totalSkippedProceed: 0,
        totalSkippedStaleness: 0,
        totalLlmEligibilityBlocked: 0,
        totalModelNoBet: 0,
        totalPolicyBlocked: 0,
        totalSaveBlocked: 0,
        totalShouldPush: 0,
        totalSavedRecommendations: 0,
        totalPushedNotifications: 0,
        totalErrors: 0,
      },
    });
    return {
      liveCount: liveMatchIds.length,
      candidateCount: 0,
      pipelineResults: [],
      apiFootballCircuitOpen: Boolean(circuitSkip),
      apiFootballCircuitOpenUntil: circuitSkip?.openUntil,
    };
  }

  await reportJobProgress(JOB, 'pipeline', `Running AI pipeline for ${candidateMatchIds.length} candidate matches...`, 70);

  // Split into batches (default: 3 matches per batch)
  const batchSize = Math.max(1, Math.trunc(Number(config.pipelineBatchSize) || 1));
  const batches: string[][] = [];
  for (let i = 0; i < candidateMatchIds.length; i += batchSize) {
    batches.push(candidateMatchIds.slice(i, i + batchSize));
  }

  console.log(`[checkLiveTriggerJob] Processing ${batches.length} batches (${batchSize} matches each) from ${candidateMatchIds.length} candidates`);

  const pipelineResults: PipelineResult[] = [];
  let failedBatches = 0;
  let failedBatchMatches = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const progress = 70 + Math.round(((i + 1) / batches.length) * 25);
    await reportJobProgress(JOB, 'pipeline', `Batch ${i + 1}/${batches.length}: ${batch.join(', ')}`, progress);

    try {
      const batchResult = await runPipelineBatch(batch);
      pipelineResults.push(batchResult);

      console.log(`[checkLiveTriggerJob] Batch ${i + 1}/${batches.length} complete: ${batchResult.processed} processed, ${batchResult.errors} errors`);
    } catch (err) {
      failedBatches++;
      failedBatchMatches += batch.length;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[checkLiveTriggerJob] Batch ${i + 1} failed:`, errMsg);
      audit({
        category: 'PIPELINE',
        action: 'PIPELINE_BATCH_ERROR',
        outcome: 'FAILURE',
        actor: 'auto-pipeline',
        error: errMsg,
        metadata: { batchIndex: i, matchIds: batch },
      });
    }

    // Delay between batches to avoid API rate limits
    if (i < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Summary:
  // - totalSavedRecommendations = recommendation rows persisted to DB.
  // - totalPushedNotifications = user-facing notifications actually emitted.
  // This keeps operational reporting aligned with the split semantics in the
  // core pipeline: save and notify are related, but not the same outcome.
  const totalProcessed = pipelineResults.reduce((sum, r) => sum + r.processed, 0);
  const totalPipelineErrors = pipelineResults.reduce((sum, r) => sum + r.errors, 0);
  const totalErrors = totalPipelineErrors + failedBatchMatches;
  const totalSavedRecommendations = pipelineResults.reduce(
    (sum, r) => sum + r.results.filter((m) => m.saved).length, 0,
  );
  const totalPushedNotifications = pipelineResults.reduce(
    (sum, r) => sum + r.results.filter((m) => m.notified).length, 0,
  );
  const totalProviderReady = countPipelineResults(
    pipelineResults,
    (result) => result.debug?.statsAvailable === true && result.debug?.oddsAvailable === true,
  );
  const totalPreLlmSkipped = countPipelineResults(
    pipelineResults,
    (result) => result.debug?.skippedAt === 'proceed'
      || result.debug?.skippedAt === 'staleness'
      || result.debug?.skippedAt === 'llm_eligibility',
  );
  const totalSkippedProceed = countPipelineResults(
    pipelineResults,
    (result) => result.debug?.skippedAt === 'proceed',
  );
  const totalSkippedStaleness = countPipelineResults(
    pipelineResults,
    (result) => result.debug?.skippedAt === 'staleness',
  );
  const totalLlmEligibilityBlocked = countPipelineResults(
    pipelineResults,
    (result) => result.debug?.skippedAt === 'llm_eligibility',
  );
  const totalLlmEligible = countPipelineResults(
    pipelineResults,
    (result) => result.success === true && result.debug?.skippedAt == null,
  );
  const totalModelNoBet = countPipelineResults(
    pipelineResults,
    (result) => result.debug?.llmDecisionDiagnostic === 'no_bet_intentional',
  );
  const totalPolicyBlocked = countPipelineResults(
    pipelineResults,
    (result) => result.debug?.llmDecisionDiagnostic === 'policy_blocked',
  );
  const totalSaveBlocked = countPipelineResults(
    pipelineResults,
    (result) => result.debug?.saveIntegrityStatus === 'blocked',
  );
  const totalShouldPush = countPipelineResults(
    pipelineResults,
    (result) => result.shouldPush === true,
  );

  await reportJobProgress(
    JOB,
    'complete',
    `Done: ${totalProcessed} analyzed, ${totalSavedRecommendations} saved, ${totalPushedNotifications} notified, ${totalErrors} errors`,
    100,
  );

  const pipelineOutcome = totalErrors > 0 ? 'PARTIAL' : 'SUCCESS';
  audit({
    category: 'PIPELINE',
    action: 'PIPELINE_COMPLETE',
    outcome: pipelineOutcome,
    actor: 'auto-pipeline',
    metadata: {
      liveCount: liveMatchIds.length,
      candidateCount: candidateMatchIds.length,
      liveMatchIds,
      candidateMatchIds,
      skippedMatchIds: liveMatchIds.filter((id) => !candidateMatchIds.includes(id)),
      stalenessDiagnostics,
      statsOnlyOverrideCandidates: stalenessDiagnostics.filter((row) => row.statsOnlyOverride === true).length,
      batches: batches.length,
      failedBatches,
      failedBatchMatches,
      totalProcessed,
      totalProviderReady,
      totalLlmEligible,
      totalPreLlmSkipped,
      totalSkippedProceed,
      totalSkippedStaleness,
      totalLlmEligibilityBlocked,
      totalModelNoBet,
      totalPolicyBlocked,
      totalSaveBlocked,
      totalShouldPush,
      totalSavedRecommendations,
      totalPushedNotifications,
      totalErrors,
    },
  });

  return {
    liveCount: liveMatchIds.length,
    candidateCount: candidateMatchIds.length,
    pipelineResults,
    failedBatches,
    failedBatchMatches,
    apiFootballCircuitOpen: Boolean(circuitSkip),
    apiFootballCircuitOpenUntil: circuitSkip?.openUntil,
  };
}
