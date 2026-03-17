// ============================================================
// Job: Check Live Matches & Auto-Trigger AI Pipeline
// Detects active watchlist matches that are currently live,
// then triggers server-side AI analysis in batches.
// ============================================================

import { config } from '../config.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import * as matchRepo from '../repos/matches.repo.js';
import { reportJobProgress } from './job-progress.js';
import { runPipelineBatch, type PipelineResult } from '../lib/server-pipeline.js';
import { audit } from '../lib/audit.js';

export async function checkLiveTriggerJob(): Promise<{ liveCount: number; pipelineResults?: PipelineResult[] }> {
  const JOB = 'check-live-trigger';

  // 1. Get active watchlist match IDs
  await reportJobProgress(JOB, 'load', 'Loading active watchlist...', 15);
  const activeWatchlist = await watchlistRepo.getActiveWatchlist();
  if (activeWatchlist.length === 0) {
    return { liveCount: 0 };
  }
  const activeMatchIds = activeWatchlist.map((w) => w.match_id);

  // 2. Get matches and find live ones
  await reportJobProgress(JOB, 'check', `Checking ${activeMatchIds.length} match statuses...`, 45);
  const matches = await matchRepo.getMatchesByIds(activeMatchIds);
  const statusMap = new Map(matches.map((m) => [m.match_id, m.status]));

  const liveMatchIds = activeMatchIds.filter((id) => {
    const status = statusMap.get(id);
    return status && config.liveStatuses.includes(status);
  });

  if (liveMatchIds.length === 0) {
    return { liveCount: 0 };
  }

  // 3. Increment check count for live watchlist entries
  await reportJobProgress(JOB, 'increment', `Updating ${liveMatchIds.length} live matches...`, 60);
  for (const id of liveMatchIds) {
    await watchlistRepo.incrementChecks(id);
  }

  console.log(`[checkLiveTriggerJob] ${liveMatchIds.length} live matches detected`);

  // 4. Auto-trigger AI pipeline (if enabled)
  if (!config.pipelineEnabled) {
    console.log('[checkLiveTriggerJob] Pipeline disabled, skipping AI analysis');
    return { liveCount: liveMatchIds.length };
  }

  await reportJobProgress(JOB, 'pipeline', `Running AI pipeline for ${liveMatchIds.length} live matches...`, 70);

  // Split into batches (default: 3 matches per batch)
  const batchSize = config.pipelineBatchSize;
  const batches: string[][] = [];
  for (let i = 0; i < liveMatchIds.length; i += batchSize) {
    batches.push(liveMatchIds.slice(i, i + batchSize));
  }

  console.log(`[checkLiveTriggerJob] Processing ${batches.length} batches (${batchSize} matches each)`);

  const pipelineResults: PipelineResult[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const progress = 70 + Math.round(((i + 1) / batches.length) * 25);
    await reportJobProgress(JOB, 'pipeline', `Batch ${i + 1}/${batches.length}: ${batch.join(', ')}`, progress);

    try {
      const batchResult = await runPipelineBatch(batch);
      pipelineResults.push(batchResult);

      console.log(`[checkLiveTriggerJob] Batch ${i + 1}/${batches.length} complete: ${batchResult.processed} processed, ${batchResult.errors} errors`);
    } catch (err) {
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
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Summary
  const totalProcessed = pipelineResults.reduce((sum, r) => sum + r.processed, 0);
  const totalErrors = pipelineResults.reduce((sum, r) => sum + r.errors, 0);
  const totalPushed = pipelineResults.reduce(
    (sum, r) => sum + r.results.filter((m) => m.shouldPush).length, 0,
  );

  await reportJobProgress(JOB, 'complete', `Done: ${totalProcessed} analyzed, ${totalPushed} recommended, ${totalErrors} errors`, 100);

  audit({
    category: 'PIPELINE',
    action: 'PIPELINE_COMPLETE',
    outcome: totalErrors > 0 ? 'PARTIAL' : 'SUCCESS',
    actor: 'auto-pipeline',
    metadata: {
      liveCount: liveMatchIds.length,
      batches: batches.length,
      totalProcessed,
      totalPushed,
      totalErrors,
    },
  });

  return { liveCount: liveMatchIds.length, pipelineResults };
}
