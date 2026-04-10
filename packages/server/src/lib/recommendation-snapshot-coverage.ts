/**
 * Step 0 — DB snapshot coverage for data-driven replay planning.
 * Aligns cohort definitions with db-replay-scenarios loadSettledReplaySourceRows.
 */
import { query } from '../db/pool.js';

export interface RecommendationSnapshotCoverageReport {
  generatedAt: string;
  lookbackDays: number;
  settledResults: readonly string[];
  totals: {
    inWindow: number;
    actionableNotDup: number;
    settledActionable: number;
    exportEligible: number;
    settledActionableMissingHistory: number;
  };
  snapshotQuality: {
    amongSettledActionable: {
      total: number;
      emptyOddsSnapshot: number;
      emptyStatsSnapshot: number;
      emptyDecisionContext: number;
      replayReady: number;
    };
    amongExportEligible: {
      total: number;
      emptyDecisionContext: number;
    };
  };
  slim: {
    inWindowSlimTrue: number;
    inWindowSlimFalse: number;
  };
  topPromptVersions: Array<{
    promptVersion: string;
    count: number;
    emptyOdds: number;
    emptyStats: number;
    emptyDecisionContext: number;
  }>;
  topAiModels: Array<{
    aiModel: string;
    count: number;
    emptyOdds: number;
    emptyStats: number;
  }>;
  hints: {
    exportEligibleMatchesReplayLoader: string;
    emptyDecisionContextAmongExportEligiblePct: number;
    replayReadyAmongSettledActionablePct: number;
  };
}

const SETTLED_RESULTS = ['win', 'loss', 'push', 'half_win', 'half_loss', 'void'] as const;

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
}

export async function buildRecommendationSnapshotCoverageReport(
  lookbackDays: number,
): Promise<RecommendationSnapshotCoverageReport> {
  const lb = Math.max(1, Math.min(3650, lookbackDays));
  const settledIn = SETTLED_RESULTS.map((s) => `'${s}'`).join(',');

  const [inWindow, actionable, settledAct, exportElig, missingHist] = await Promise.all([
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')`,
      [lb],
    ),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
         AND r.bet_type IS DISTINCT FROM 'NO_BET'
         AND r.result IS DISTINCT FROM 'duplicate'`,
      [lb],
    ),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
         AND r.bet_type IS DISTINCT FROM 'NO_BET'
         AND r.result IS DISTINCT FROM 'duplicate'
         AND r.result IN (${settledIn})`,
      [lb],
    ),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM recommendations r
       INNER JOIN matches_history mh ON mh.match_id = r.match_id
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
         AND r.bet_type IS DISTINCT FROM 'NO_BET'
         AND r.result IS DISTINCT FROM 'duplicate'
         AND r.result IN (${settledIn})
         AND COALESCE(r.odds_snapshot, '{}'::jsonb) <> '{}'::jsonb
         AND COALESCE(r.stats_snapshot, '{}'::jsonb) <> '{}'::jsonb`,
      [lb],
    ),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
         AND r.bet_type IS DISTINCT FROM 'NO_BET'
         AND r.result IS DISTINCT FROM 'duplicate'
         AND r.result IN (${settledIn})
         AND NOT EXISTS (SELECT 1 FROM matches_history mh WHERE mh.match_id = r.match_id)`,
      [lb],
    ),
  ]);

  const [qualExport, qualSettled] = await Promise.all([
    query<{
      total: string;
      empty_odds: string;
      empty_stats: string;
      empty_dc: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE COALESCE(r.odds_snapshot, '{}'::jsonb) = '{}'::jsonb)::text AS empty_odds,
         COUNT(*) FILTER (WHERE COALESCE(r.stats_snapshot, '{}'::jsonb) = '{}'::jsonb)::text AS empty_stats,
         COUNT(*) FILTER (WHERE COALESCE(r.decision_context, '{}'::jsonb) = '{}'::jsonb)::text AS empty_dc
       FROM recommendations r
       INNER JOIN matches_history mh ON mh.match_id = r.match_id
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
         AND r.bet_type IS DISTINCT FROM 'NO_BET'
         AND r.result IS DISTINCT FROM 'duplicate'
         AND r.result IN (${settledIn})
         AND COALESCE(r.odds_snapshot, '{}'::jsonb) <> '{}'::jsonb
         AND COALESCE(r.stats_snapshot, '{}'::jsonb) <> '{}'::jsonb`,
      [lb],
    ),
    query<{
      total: string;
      empty_odds: string;
      empty_stats: string;
      empty_dc: string;
      replay_ready: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE COALESCE(r.odds_snapshot, '{}'::jsonb) = '{}'::jsonb)::text AS empty_odds,
         COUNT(*) FILTER (WHERE COALESCE(r.stats_snapshot, '{}'::jsonb) = '{}'::jsonb)::text AS empty_stats,
         COUNT(*) FILTER (WHERE COALESCE(r.decision_context, '{}'::jsonb) = '{}'::jsonb)::text AS empty_dc,
         COUNT(*) FILTER (
           WHERE COALESCE(r.odds_snapshot, '{}'::jsonb) <> '{}'::jsonb
             AND COALESCE(r.stats_snapshot, '{}'::jsonb) <> '{}'::jsonb
         )::text AS replay_ready
       FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
         AND r.bet_type IS DISTINCT FROM 'NO_BET'
         AND r.result IS DISTINCT FROM 'duplicate'
         AND r.result IN (${settledIn})`,
      [lb],
    ),
  ]);

  const [slimRows, pvRows, modelRows] = await Promise.all([
    query<{ slim: boolean; c: string }>(
      `SELECT COALESCE(r.is_slim, false) AS slim, COUNT(*)::text AS c
       FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY COALESCE(r.is_slim, false)`,
      [lb],
    ),
    query<{
      pv: string;
      n: string;
      empty_odds: string;
      empty_stats: string;
      empty_dc: string;
    }>(
      `SELECT
         COALESCE(NULLIF(r.prompt_version, ''), '(empty)') AS pv,
         COUNT(*)::text AS n,
         COUNT(*) FILTER (WHERE COALESCE(r.odds_snapshot, '{}'::jsonb) = '{}'::jsonb)::text AS empty_odds,
         COUNT(*) FILTER (WHERE COALESCE(r.stats_snapshot, '{}'::jsonb) = '{}'::jsonb)::text AS empty_stats,
         COUNT(*) FILTER (WHERE COALESCE(r.decision_context, '{}'::jsonb) = '{}'::jsonb)::text AS empty_dc
       FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY 1
       ORDER BY COUNT(*) DESC
       LIMIT 25`,
      [lb],
    ),
    query<{
      model: string;
      n: string;
      empty_odds: string;
      empty_stats: string;
    }>(
      `SELECT
         COALESCE(NULLIF(r.ai_model, ''), '(empty)') AS model,
         COUNT(*)::text AS n,
         COUNT(*) FILTER (WHERE COALESCE(r.odds_snapshot, '{}'::jsonb) = '{}'::jsonb)::text AS empty_odds,
         COUNT(*) FILTER (WHERE COALESCE(r.stats_snapshot, '{}'::jsonb) = '{}'::jsonb)::text AS empty_stats
       FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY 1
       ORDER BY COUNT(*) DESC
       LIMIT 25`,
      [lb],
    ),
  ]);

  let slimTrue = 0;
  let slimFalse = 0;
  for (const row of slimRows.rows) {
    if (row.slim) slimTrue = Number(row.c);
    else slimFalse = Number(row.c);
  }

  const qe = qualExport.rows[0];
  const qs = qualSettled.rows[0];
  const amongExportTotal = Number(qe?.total ?? 0);
  const amongExportEmptyDc = Number(qe?.empty_dc ?? 0);
  const amongSettledTotal = Number(qs?.total ?? 0);
  const amongSettledReplayReady = Number(qs?.replay_ready ?? 0);

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays: lb,
    settledResults: [...SETTLED_RESULTS],
    totals: {
      inWindow: Number(inWindow.rows[0]?.c ?? 0),
      actionableNotDup: Number(actionable.rows[0]?.c ?? 0),
      settledActionable: Number(settledAct.rows[0]?.c ?? 0),
      exportEligible: Number(exportElig.rows[0]?.c ?? 0),
      settledActionableMissingHistory: Number(missingHist.rows[0]?.c ?? 0),
    },
    snapshotQuality: {
      amongSettledActionable: {
        total: amongSettledTotal,
        emptyOddsSnapshot: Number(qs?.empty_odds ?? 0),
        emptyStatsSnapshot: Number(qs?.empty_stats ?? 0),
        emptyDecisionContext: Number(qs?.empty_dc ?? 0),
        replayReady: amongSettledReplayReady,
      },
      amongExportEligible: {
        total: amongExportTotal,
        emptyDecisionContext: amongExportEmptyDc,
      },
    },
    slim: { inWindowSlimTrue: slimTrue, inWindowSlimFalse: slimFalse },
    topPromptVersions: pvRows.rows.map((row) => ({
      promptVersion: row.pv,
      count: Number(row.n),
      emptyOdds: Number(row.empty_odds),
      emptyStats: Number(row.empty_stats),
      emptyDecisionContext: Number(row.empty_dc),
    })),
    topAiModels: modelRows.rows.map((row) => ({
      aiModel: row.model,
      count: Number(row.n),
      emptyOdds: Number(row.empty_odds),
      emptyStats: Number(row.empty_stats),
    })),
    hints: {
      exportEligibleMatchesReplayLoader:
        'Same filters as buildSettledReplayScenarios (non-empty odds+stats, matches_history, settled actionable).',
      emptyDecisionContextAmongExportEligiblePct: pct(amongExportEmptyDc, amongExportTotal),
      replayReadyAmongSettledActionablePct: pct(amongSettledReplayReady, amongSettledTotal),
    },
  };
}
