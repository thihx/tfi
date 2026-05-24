import 'dotenv/config';
import { config } from '../config.js';
import { query, closePool } from '../db/pool.js';
import { closeRedis, getRedisClient } from '../lib/redis.js';
import { enrichWatchlistJob, setForceEnrich } from '../jobs/enrich-watchlist.job.js';
import { checkLiveTriggerJob } from '../jobs/check-live-trigger.job.js';
import { runManualAnalysisForMatch } from '../lib/server-pipeline.js';

type Row = Record<string, unknown>;

function asBool(value: unknown): boolean {
  return value === true || value === 'true';
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await query<T>(sql, params);
  return result.rows[0] ?? null;
}

async function readiness() {
  await query('SELECT 1');
  let redis = 'ok';
  try {
    await getRedisClient().ping();
  } catch (error) {
    redis = `fail:${error instanceof Error ? error.message : String(error)}`;
  }
  return {
    db: 'ok',
    redis,
    geminiConfigured: Boolean(config.geminiApiKey),
    footballConfigured: Boolean(config.footballApiKey),
    pipelineEnabled: config.pipelineEnabled,
    liveStatuses: config.liveStatuses,
  };
}

async function getSubscription(userId: string, matchId: string) {
  return one<{
    custom_condition_text: string | null;
    auto_apply_recommended_condition: boolean | null;
    notify_enabled: boolean | null;
  }>(
    `SELECT custom_condition_text, auto_apply_recommended_condition, notify_enabled
       FROM user_watch_subscriptions
      WHERE user_id = $1 AND match_id = $2
      LIMIT 1`,
    [userId, matchId],
  );
}

async function getOperational(matchId: string) {
  return one<{
    recommended_custom_condition: string | null;
    custom_conditions: string | null;
  }>(
    `SELECT metadata->>'recommended_custom_condition' AS recommended_custom_condition,
            metadata->>'custom_conditions' AS custom_conditions
       FROM monitored_matches
      WHERE match_id = $1
      LIMIT 1`,
    [matchId],
  );
}

async function autoConditionCheck() {
  const candidate = await one<{
    user_id: string;
    match_id: string;
    home_team: string;
    away_team: string;
    status: string;
  }>(
    `SELECT s.user_id, s.match_id, m.home_team, m.away_team, m.status
       FROM user_watch_subscriptions s
       JOIN matches m ON m.match_id::text = s.match_id
      WHERE m.status = 'NS'
        AND COALESCE(s.auto_apply_recommended_condition, TRUE) = TRUE
        AND NULLIF(BTRIM(COALESCE(s.custom_condition_text, '')), '') IS NULL
      ORDER BY m.kickoff_at_utc NULLS LAST, s.created_at DESC
      LIMIT 1`,
  );
  if (!candidate) {
    return { status: 'skipped', reason: 'No NS watchlist match with blank condition and auto-apply enabled.' };
  }

  const before = {
    subscription: await getSubscription(candidate.user_id, candidate.match_id),
    operational: await getOperational(candidate.match_id),
  };
  setForceEnrich();
  const jobResult = await enrichWatchlistJob();
  const after = {
    subscription: await getSubscription(candidate.user_id, candidate.match_id),
    operational: await getOperational(candidate.match_id),
  };

  const recommended = asText(after.operational?.recommended_custom_condition);
  const operationalApplied = asText(after.operational?.custom_conditions);
  const subscriptionApplied = asText(after.subscription?.custom_condition_text);
  return {
    status: recommended && operationalApplied && subscriptionApplied && operationalApplied === subscriptionApplied
      ? 'passed'
      : 'failed',
    candidate,
    jobResult,
    before,
    after,
    assertions: {
      recommendedGenerated: Boolean(recommended),
      operationalApplied: Boolean(operationalApplied),
      subscriptionApplied: Boolean(subscriptionApplied),
      operationalMatchesSubscription: operationalApplied === subscriptionApplied,
    },
  };
}

async function restoreTrigger(candidate: {
  user_id: string;
  match_id: string;
  custom_condition_text: string | null;
  auto_apply_recommended_condition: boolean | null;
  notify_enabled: boolean | null;
}) {
  await query(
    `UPDATE user_watch_subscriptions
        SET custom_condition_text = $3,
            auto_apply_recommended_condition = $4,
            notify_enabled = $5,
            updated_at = NOW()
      WHERE user_id = $1 AND match_id = $2`,
    [
      candidate.user_id,
      candidate.match_id,
      candidate.custom_condition_text ?? '',
      candidate.auto_apply_recommended_condition ?? true,
      candidate.notify_enabled ?? true,
    ],
  );
}

async function conditionTriggerCheck() {
  const candidate = await one<{
    user_id: string;
    match_id: string;
    home_team: string;
    away_team: string;
    status: string;
    current_minute: number | null;
    custom_condition_text: string | null;
    auto_apply_recommended_condition: boolean | null;
    notify_enabled: boolean | null;
  }>(
    `SELECT s.user_id, s.match_id, m.home_team, m.away_team, m.status, m.current_minute,
            s.custom_condition_text, s.auto_apply_recommended_condition, s.notify_enabled
       FROM user_watch_subscriptions s
       JOIN matches m ON m.match_id::text = s.match_id
      WHERE m.status = ANY($1)
      ORDER BY m.current_minute DESC NULLS LAST, s.created_at DESC
      LIMIT 1`,
    [config.liveStatuses],
  );
  if (!candidate) {
    return { status: 'skipped', reason: `No watched live match found for ${config.liveStatuses.join(', ')}` };
  }

  const testCondition = '(Total goals >= 0)';
  await query(
    `UPDATE user_watch_subscriptions
        SET custom_condition_text = $3,
            auto_apply_recommended_condition = FALSE,
            notify_enabled = TRUE,
            updated_at = NOW()
      WHERE user_id = $1 AND match_id = $2`,
    [candidate.user_id, candidate.match_id, testCondition],
  );

  try {
    const jobResult = await checkLiveTriggerJob();
    const manual = await runManualAnalysisForMatch(candidate.match_id, {
      forceAnalyze: true,
      advisoryOnly: true,
    });
    const parsed = manual.debug?.parsed;
    const matched = asBool(parsed?.custom_condition_matched);
    return {
      status: matched ? 'passed' : 'failed',
      candidate: { ...candidate, testCondition },
      checkLiveTriggerJob: {
        liveCount: jobResult.liveCount,
        candidateCount: jobResult.candidateCount ?? null,
        processed: jobResult.pipelineResults?.reduce((sum, batch) => sum + batch.processed, 0) ?? 0,
        errors: jobResult.pipelineResults?.reduce((sum, batch) => sum + batch.errors, 0) ?? 0,
        resultForMatch: jobResult.pipelineResults
          ?.flatMap((batch) => batch.results)
          .find((item) => item.matchId === candidate.match_id) ?? null,
      },
      manualForcedAnalysis: {
        decisionKind: manual.decisionKind,
        shouldPush: manual.shouldPush,
        saved: manual.saved,
        notified: manual.notified,
        selection: manual.selection,
        confidence: manual.confidence,
        customConditionMatched: matched,
        conditionTriggeredShouldPush: asBool(parsed?.condition_triggered_should_push),
        customConditionStatus: parsed?.custom_condition_status ?? null,
        conditionSummary: parsed?.custom_condition_summary_en || parsed?.custom_condition_summary_vi || '',
        promptVersion: manual.debug?.promptVersion ?? null,
        evidenceMode: manual.debug?.evidenceMode ?? null,
      },
      assertions: {
        monitoredByCheckLive: (jobResult.liveCount ?? 0) > 0,
        includedInCheckLiveResult: Boolean(jobResult.pipelineResults
          ?.flatMap((batch) => batch.results)
          .some((item) => item.matchId === candidate.match_id)),
        manualRealPipelineConditionMatched: matched,
      },
    };
  } finally {
    await restoreTrigger(candidate);
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const ready = await readiness();
  if (!ready.geminiConfigured || !ready.footballConfigured) {
    return {
      startedAt,
      readiness: ready,
      status: 'blocked',
      reason: 'GEMINI_API_KEY and FOOTBALL_API_KEY are required.',
    };
  }
  const autoCondition = await autoConditionCheck();
  const conditionTrigger = await conditionTriggerCheck();
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    readiness: ready,
    autoCondition,
    conditionTrigger,
  };
}

main().then((result) => {
  console.log(JSON.stringify(result, null, 2));
  return Promise.allSettled([closePool(), closeRedis()]);
});