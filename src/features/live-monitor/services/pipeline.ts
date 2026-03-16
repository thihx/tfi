// ============================================================
// Pipeline Orchestrator
// Equivalent to the entire n8n workflow "TFI - Live Monitor"
// Chains all services in exact order:
//   Webhook → Set Config → Get Active Matches → Filter Active Only
//   → Has Active Matches? → Prepare Match Data → Build Fixtures Batch
//   → Fetch Live Data → Merge Match Data → Check Should Proceed
//   → Should Proceed? → Fetch Live Odds → Merge Odds to Match
//   → Build AI Prompt → Route AI Provider → [Gemini|Claude]
//   → Parse AI Response → Should Push? → Prepare Recommendation Data
//   → [Format Email → Send Email]
//   + [Format Telegram Message → Send Message]
//   + [Should Save? → Save Recommendation]
// ============================================================

import type { AppConfig } from '@/types';
import type {
  LiveMonitorConfig,
  PipelineContext,
  PipelineMatchResult,
  MergedMatchData,
} from '../types';

import { loadMonitorConfig } from '../config';
import {
  loadAndFilterWatchlist,
  prepareMatchData,
  buildFixtureBatches,
} from './watchlist.service';
import { fetchAllFixtures, fetchFixtureOdds } from './football-api.service';
import { mergeMatchData, mergeOddsToMatch } from './match-merger.service';
import { checkShouldProceed, shouldPush, shouldSave } from './filters.service';
import { routeAndCallAi, parseAiResponse } from './ai-analysis.service';
import { prepareRecommendationData } from './recommendation.service';
import { notifyRecommendation } from './notification.service';
import { saveRecommendation } from './proxy.service';

// ==================== Pipeline Runner ====================

export type PipelineEventCallback = (ctx: PipelineContext) => void;

/**
 * Run the complete live monitor pipeline.
 * This is the 1:1 equivalent of triggering the n8n webhook.
 */
export async function runPipeline(
  appConfig: AppConfig,
  options: {
    triggeredBy: 'manual' | 'scheduled' | 'webhook';
    webhookMatchIds?: string[];
    configOverrides?: Partial<LiveMonitorConfig>;
    onProgress?: PipelineEventCallback;
  } = { triggeredBy: 'manual' },
): Promise<PipelineContext> {
  const executionId = `tfi_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Load config
  const config = loadMonitorConfig(options.configOverrides);

  // If webhook provides manual match IDs, merge them
  if (options.webhookMatchIds?.length) {
    config.MANUAL_PUSH_MATCH_IDS = [
      ...new Set([...config.MANUAL_PUSH_MATCH_IDS, ...options.webhookMatchIds]),
    ];
  }

  const ctx: PipelineContext = {
    config,
    stage: 'idle',
    startedAt: new Date().toISOString(),
    triggeredBy: options.triggeredBy,
    webhookMatchIds: options.webhookMatchIds,
    results: [],
  };

  const emit = (stage: PipelineContext['stage']) => {
    ctx.stage = stage;
    options.onProgress?.(ctx);
  };

  try {
    // ========== Stage 1: Load & Filter Watchlist ==========
    emit('loading-watchlist');
    const activeMatches = await loadAndFilterWatchlist(appConfig, config, options.webhookMatchIds);

    if (activeMatches.length === 0) {
      emit('complete');
      return ctx;
    }

    // Prepare match data
    emit('filtering');
    const prepared = prepareMatchData(activeMatches, config);

    // ========== Stage 2: Fetch Live Fixtures ==========
    emit('fetching-live-data');
    const batches = buildFixtureBatches(prepared);
    const fixtures = await fetchAllFixtures(appConfig, batches);

    // ========== Stage 3: Merge Match Data ==========
    emit('merging-data');
    const mergedMatches = mergeMatchData(prepared, fixtures);

    // ========== Stage 4: Process Each Match ==========
    for (const rawMatchData of mergedMatches) {
      const matchResult: PipelineMatchResult = {
        matchId: rawMatchData.match_id,
        matchDisplay: `${rawMatchData.home_team} vs ${rawMatchData.away_team}`,
        stage: 'checking-proceed',
        proceeded: false,
        notified: false,
        saved: false,
      };

      try {
        // Check should proceed - returns enriched match data
        emit('checking-proceed');
        const matchData = checkShouldProceed(rawMatchData, config);

        if (!matchData.should_proceed && !matchData.force_analyze) {
          matchResult.stage = 'complete';
          ctx.results.push(matchResult);
          continue;
        }

        matchResult.proceeded = true;

        // Fetch live odds for this match
        emit('fetching-odds');
        let mergedWithOdds: MergedMatchData = matchData;
        try {
          const oddsResponse = await fetchFixtureOdds(appConfig, matchData.match_id);
          emit('merging-odds');
          mergedWithOdds = mergeOddsToMatch(matchData, oddsResponse);
        } catch {
          // Odds fetch failed - continue with odds_available = false
          mergedWithOdds = {
            ...matchData,
            odds_available: false,
            odds_canonical: {},
            odds_sanity_warnings: ['ODDS_FETCH_FAILED'],
            odds_suspicious: false,
          };
        }

        // AI Analysis
        emit('building-prompt');
        emit('ai-analysis');
        const aiRawResponse = await routeAndCallAi(appConfig, config, mergedWithOdds);

        // Parse AI response
        emit('parsing-response');
        const parsed = parseAiResponse(aiRawResponse, mergedWithOdds, config);
        matchResult.parsedAi = parsed;

        // Prepare recommendation
        emit('preparing-recommendation');
        const recommendation = prepareRecommendationData(
          mergedWithOdds,
          parsed,
          config,
          executionId,
        );
        matchResult.recommendation = recommendation;

        // Should Push? → Notify
        if (shouldPush(parsed)) {
          emit('notifying');
          const notifyResult = await notifyRecommendation(
            appConfig,
            config,
            mergedWithOdds,
            parsed,
            recommendation,
          );
          matchResult.notified = notifyResult.emailSent || notifyResult.telegramSent;

          if (notifyResult.errors.length > 0) {
            matchResult.error = notifyResult.errors.join('; ');
          }
        }

        // Should Save? → Save
        if (shouldSave(parsed)) {
          emit('saving');
          try {
            await saveRecommendation(appConfig, recommendation);
            matchResult.saved = true;
          } catch (saveErr) {
            matchResult.error = (matchResult.error ? matchResult.error + '; ' : '') +
              `Save error: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`;
          }
        }

        matchResult.stage = 'complete';
      } catch (matchErr) {
        matchResult.stage = 'error';
        matchResult.error = matchErr instanceof Error ? matchErr.message : String(matchErr);
      }

      ctx.results.push(matchResult);
    }

    emit('complete');
  } catch (err) {
    ctx.stage = 'error';
    ctx.error = err instanceof Error ? err.message : String(err);
  }

  return ctx;
}

/**
 * Run pipeline for a single specific match (manual trigger).
 */
export async function runPipelineForMatch(
  appConfig: AppConfig,
  matchId: string,
  configOverrides?: Partial<LiveMonitorConfig>,
): Promise<PipelineContext> {
  return runPipeline(appConfig, {
    triggeredBy: 'manual',
    webhookMatchIds: [matchId],
    configOverrides: {
      ...configOverrides,
      MANUAL_PUSH_MATCH_IDS: [matchId],
    },
  });
}
