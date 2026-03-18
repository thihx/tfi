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
  AiPromptContext,
} from '../types';
import { auditLog } from '@/lib/audit';

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
import {
  saveRecommendation,
  saveMatchSnapshot,
  saveOddsMovements,
  saveAiPerformance,
  fetchMatchRecommendations,
  fetchMatchSnapshots,
  fetchHistoricalPerformance,
} from './proxy.service';
import { checkStaleness } from './staleness.service';

// ==================== Pipeline Runner ====================

export type PipelineEventCallback = (ctx: PipelineContext) => void;

/** Fire-and-forget: log errors with context so failures are visible and recoverable */
function trackSilent(promise: Promise<unknown> | undefined, label = 'unknown'): void {
  promise?.catch((err: unknown) => {
    console.warn(`[Pipeline] Tracking failure (${label}) — data may be lost:`, err instanceof Error ? err.message : String(err));
  });
}

/**
 * Run the complete live monitor pipeline.
 * This is the 1:1 equivalent of triggering the n8n webhook.
 */
export async function runPipeline(
  appConfig: AppConfig,
  options: {
    triggeredBy: 'manual' | 'scheduled' | 'webhook' | 'ask-ai';
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

  const pipelineStart = Date.now();

  auditLog(appConfig, {
    category: 'PIPELINE',
    action: 'PIPELINE_START',
    actor: options.triggeredBy,
    metadata: { triggeredBy: options.triggeredBy, webhookMatchIds: options.webhookMatchIds ?? null },
  });

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

    // ========== Stage 3.5: Fetch Historical Performance (once, cached) ==========
    // This data is the same for all matches and is cached for 10 minutes,
    // so it costs at most 1 HTTP call per 10-minute window.
    const historicalPerformance = await fetchHistoricalPerformance(appConfig).catch(() => null);

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
          const oddsResponse = await fetchFixtureOdds(appConfig, matchData.match_id, matchData.home_team, matchData.away_team);
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

        // ── Data Tracking: snapshot + odds movements ──
        const currentMinute = typeof mergedWithOdds.minute === 'string'
          ? parseInt(mergedWithOdds.minute, 10) || 0
          : mergedWithOdds.minute;
        const [homeScore, awayScore] = (mergedWithOdds.score ?? '0-0')
          .split('-')
          .map((s) => parseInt(s.trim(), 10) || 0);

        trackSilent(
          saveMatchSnapshot(appConfig, {
            match_id: mergedWithOdds.match_id,
            minute: currentMinute,
            status: mergedWithOdds.status,
            home_score: homeScore,
            away_score: awayScore,
            stats: mergedWithOdds.stats_compact as Record<string, unknown>,
            events: mergedWithOdds.events_compact,
            odds: mergedWithOdds.odds_canonical as Record<string, unknown>,
          }),
          `snapshot:${mergedWithOdds.match_id}@${currentMinute}`,
        );

        if (mergedWithOdds.odds_available && mergedWithOdds.odds_canonical) {
          const movements: Array<{
            match_id: string; match_minute: number; market: string;
            line?: number | null; price_1?: number | null; price_2?: number | null; price_x?: number | null;
          }> = [];
          const oc = mergedWithOdds.odds_canonical;

          if (oc['1x2']) {
            movements.push({
              match_id: mergedWithOdds.match_id, match_minute: currentMinute, market: '1x2',
              price_1: oc['1x2'].home, price_2: oc['1x2'].away, price_x: oc['1x2'].draw,
            });
          }
          if (oc.ou) {
            movements.push({
              match_id: mergedWithOdds.match_id, match_minute: currentMinute, market: 'ou',
              line: oc.ou.line, price_1: oc.ou.over, price_2: oc.ou.under,
            });
          }
          if (oc.ah) {
            movements.push({
              match_id: mergedWithOdds.match_id, match_minute: currentMinute, market: 'ah',
              line: oc.ah.line, price_1: oc.ah.home, price_2: oc.ah.away,
            });
          }
          if (oc.btts) {
            movements.push({
              match_id: mergedWithOdds.match_id, match_minute: currentMinute, market: 'btts',
              price_1: oc.btts.yes, price_2: oc.btts.no,
            });
          }

          trackSilent(saveOddsMovements(appConfig, movements), `odds:${mergedWithOdds.match_id}@${currentMinute}`);
        }

        // ── Staleness check + AI Context ──
        emit('checking-staleness');
        let aiContext: AiPromptContext = { previousRecommendations: [], matchTimeline: [], noHistoricalContext: true };
        try {
          const [prevRecs, snapshots] = await Promise.all([
            fetchMatchRecommendations(appConfig, mergedWithOdds.match_id),
            fetchMatchSnapshots(appConfig, mergedWithOdds.match_id),
          ]);
          aiContext = { previousRecommendations: prevRecs, matchTimeline: snapshots, historicalPerformance };
        } catch (ctxErr) {
          console.warn('[Pipeline] AI context fetch failed — proceeding without history:', ctxErr instanceof Error ? ctxErr.message : String(ctxErr));
        }

        // Check staleness: skip AI if nothing meaningful changed
        const lastRec = aiContext.previousRecommendations[0] ?? null;
        const staleness = checkStaleness(mergedWithOdds, lastRec);
        if (staleness.isStale && !mergedWithOdds.force_analyze) {
          matchResult.stage = 'complete';
          matchResult.skippedStale = true;
          ctx.results.push(matchResult);
          continue;
        }

        // AI Analysis
        emit('fetching-context');
        emit('building-prompt');
        emit('ai-analysis');
        const aiRawResponse = await routeAndCallAi(appConfig, config, mergedWithOdds, aiContext);

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
        // For ask-ai triggers, always send notification (forceNotify)
        const isAskAi = options.triggeredBy === 'ask-ai';
        if (isAskAi || shouldPush(parsed)) {
          emit('notifying');
          const notifyResult = await notifyRecommendation(
            appConfig,
            config,
            mergedWithOdds,
            parsed,
            recommendation,
            { forceNotify: isAskAi },
          );
          matchResult.notified = notifyResult.emailSent || notifyResult.telegramSent;

          if (notifyResult.errors.length > 0) {
            matchResult.error = notifyResult.errors.join('; ');
          }
        }

        // Should Save? → Save
        // For ask-ai triggers, always save if AI produced a selection (recommendation)
        const hasSelection = !!(parsed.ai_selection || parsed.selection);
        if (shouldSave(parsed) || (isAskAi && hasSelection)) {
          emit('saving');
          try {
            const savedRec = await saveRecommendation(appConfig, recommendation);
            matchResult.saved = true;

            // ── Data Tracking: AI performance ──
            trackSilent(
              saveAiPerformance(appConfig, {
                recommendation_id: savedRec.id,
                match_id: mergedWithOdds.match_id,
                ai_model: config.AI_MODEL,
                prompt_version: 'v3-context-aware',
                ai_confidence: parsed.ai_confidence,
                ai_should_push: parsed.ai_should_push,
                predicted_market: parsed.bet_market,
                predicted_selection: parsed.ai_selection,
                predicted_odds: parsed.usable_odd,
                match_minute: currentMinute,
                match_score: mergedWithOdds.score,
                league: mergedWithOdds.league,
              }),
            );
          } catch (saveErr) {
            matchResult.error = (matchResult.error ? matchResult.error + '; ' : '') +
              `Save error: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`;
          }
        }

        matchResult.stage = 'complete';

        auditLog(appConfig, {
          category: 'PIPELINE',
          action: 'MATCH_ANALYZED',
          match_id: matchResult.matchId,
          metadata: { match: matchResult.matchDisplay, proceeded: matchResult.proceeded, notified: matchResult.notified, saved: matchResult.saved },
        });
      } catch (matchErr) {
        const errMsg = matchErr instanceof Error ? matchErr.message : String(matchErr);
        const errStack = matchErr instanceof Error ? matchErr.stack?.split('\n').slice(0, 4).join(' | ') : undefined;
        matchResult.stage = 'error';
        matchResult.error = errMsg;

        auditLog(appConfig, {
          category: 'PIPELINE',
          action: 'MATCH_ANALYZED',
          outcome: 'FAILURE',
          match_id: matchResult.matchId,
          error: errMsg,
          metadata: {
            match: matchResult.matchDisplay,
            failedAtStage: matchResult.stage,
            proceeded: matchResult.proceeded,
            stack: errStack,
          },
        });
      }

      ctx.results.push(matchResult);
    }

    const duration = Date.now() - pipelineStart;
    auditLog(appConfig, {
      category: 'PIPELINE',
      action: 'PIPELINE_COMPLETE',
      actor: options.triggeredBy,
      duration_ms: duration,
      metadata: {
        totalMatches: ctx.results.length,
        proceeded: ctx.results.filter(r => r.proceeded).length,
        notified: ctx.results.filter(r => r.notified).length,
        saved: ctx.results.filter(r => r.saved).length,
        errors: ctx.results.filter(r => r.error).length,
      },
    });

    emit('complete');
  } catch (err) {
    ctx.stage = 'error';
    ctx.error = err instanceof Error ? err.message : String(err);

    auditLog(appConfig, {
      category: 'PIPELINE',
      action: 'PIPELINE_COMPLETE',
      outcome: 'FAILURE',
      actor: options.triggeredBy,
      duration_ms: Date.now() - pipelineStart,
      error: ctx.error,
    });
  }

  return ctx;
}

/**
 * Run pipeline for a single specific match (Ask AI button).
 */
export async function runPipelineForMatch(
  appConfig: AppConfig,
  matchId: string,
  configOverrides?: Partial<LiveMonitorConfig>,
): Promise<PipelineContext> {
  return runPipeline(appConfig, {
    triggeredBy: 'ask-ai',
    webhookMatchIds: [matchId],
    configOverrides: {
      ...configOverrides,
      MANUAL_PUSH_MATCH_IDS: [matchId],
    },
  });
}
