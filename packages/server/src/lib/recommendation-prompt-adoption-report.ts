import { query } from '../db/pool.js';
import { LIVE_ANALYSIS_PROMPT_VERSION } from './live-analysis-prompt.js';
import { FINAL_SETTLEMENT_RESULTS_SQL } from './settle-types.js';

export interface RecommendationPromptAdoptionOptions {
  lookbackDays: number;
  maxRecentRows: number;
}

export interface RecommendationPromptAdoptionVersionRow {
  promptVersion: string;
  count: number;
  actionable: number;
  withDecisionContext: number;
  settled: number;
  pending: number;
}

export interface RecommendationPromptAdoptionRecentRow {
  id: number;
  timestamp: string;
  matchId: string;
  matchDisplay: string;
  promptVersion: string;
  aiModel: string;
  betMarket: string;
  result: string;
  hasDecisionContext: boolean;
  decisionKind: string;
}

export interface RecommendationPromptAdoptionReport {
  generatedAt: string;
  lookbackDays: number;
  officialPromptVersion: string;
  activity: {
    firstRowAt: string | null;
    latestRowAt: string | null;
    latestRowAgeHours: number | null;
    latestActionableRowAt: string | null;
    latestActionableRowAgeHours: number | null;
    latestOfficialPromptRowAt: string | null;
    latestOfficialPromptRowAgeHours: number | null;
    latestNonOfficialPromptRowAt: string | null;
    latestNonOfficialPromptRowAgeHours: number | null;
  };
  totals: {
    totalRows: number;
    actionableRows: number;
    officialPromptRows: number;
    officialPromptWithDecisionContext: number;
    officialPromptMissingDecisionContext: number;
    nonOfficialPromptRows: number;
    emptyPromptVersionRows: number;
    emptyDecisionContextRows: number;
    officialPromptRate: number;
    officialPromptWithDecisionContextRate: number;
  };
  byPromptVersion: RecommendationPromptAdoptionVersionRow[];
  recent: RecommendationPromptAdoptionRecentRow[];
}

function clampPositiveInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export async function buildRecommendationPromptAdoptionReport(
  options: RecommendationPromptAdoptionOptions,
): Promise<RecommendationPromptAdoptionReport> {
  const lookbackDays = clampPositiveInt(options.lookbackDays, 1, 3650);
  const maxRecentRows = clampPositiveInt(options.maxRecentRows, 1, 500);
  const official = LIVE_ANALYSIS_PROMPT_VERSION;

  const [totalsResult, promptRowsResult, recentRowsResult] = await Promise.all([
    query<{
      total_rows: string;
      actionable_rows: string;
      official_prompt_rows: string;
      official_with_dc: string;
      official_missing_dc: string;
      non_official_prompt_rows: string;
      empty_prompt_rows: string;
      empty_dc_rows: string;
      first_row_at: Date | string | null;
      latest_row_at: Date | string | null;
      latest_row_age_hours: string | null;
      latest_actionable_row_at: Date | string | null;
      latest_actionable_row_age_hours: string | null;
      latest_official_prompt_row_at: Date | string | null;
      latest_official_prompt_row_age_hours: string | null;
      latest_non_official_prompt_row_at: Date | string | null;
      latest_non_official_prompt_row_age_hours: string | null;
    }>(
      `SELECT
         COUNT(*)::text AS total_rows,
         COUNT(*) FILTER (
           WHERE r.bet_type IS DISTINCT FROM 'NO_BET'
             AND r.result IS DISTINCT FROM 'duplicate'
         )::text AS actionable_rows,
         COUNT(*) FILTER (
           WHERE COALESCE(NULLIF(r.prompt_version, ''), '') = $2
         )::text AS official_prompt_rows,
         COUNT(*) FILTER (
           WHERE COALESCE(NULLIF(r.prompt_version, ''), '') = $2
             AND COALESCE(r.decision_context, '{}'::jsonb) <> '{}'::jsonb
         )::text AS official_with_dc,
         COUNT(*) FILTER (
           WHERE COALESCE(NULLIF(r.prompt_version, ''), '') = $2
             AND COALESCE(r.decision_context, '{}'::jsonb) = '{}'::jsonb
         )::text AS official_missing_dc,
         COUNT(*) FILTER (
           WHERE COALESCE(NULLIF(r.prompt_version, ''), '') NOT IN ('', $2)
         )::text AS non_official_prompt_rows,
         COUNT(*) FILTER (
           WHERE COALESCE(NULLIF(r.prompt_version, ''), '') = ''
         )::text AS empty_prompt_rows,
         COUNT(*) FILTER (
           WHERE COALESCE(r.decision_context, '{}'::jsonb) = '{}'::jsonb
         )::text AS empty_dc_rows,
         MIN(r.timestamp) AS first_row_at,
         MAX(r.timestamp) AS latest_row_at,
         EXTRACT(EPOCH FROM (NOW() - MAX(r.timestamp))) / 3600 AS latest_row_age_hours,
         MAX(r.timestamp) FILTER (
           WHERE r.bet_type IS DISTINCT FROM 'NO_BET'
             AND r.result IS DISTINCT FROM 'duplicate'
         ) AS latest_actionable_row_at,
         EXTRACT(EPOCH FROM (NOW() - MAX(r.timestamp) FILTER (
           WHERE r.bet_type IS DISTINCT FROM 'NO_BET'
             AND r.result IS DISTINCT FROM 'duplicate'
         ))) / 3600 AS latest_actionable_row_age_hours,
         MAX(r.timestamp) FILTER (
           WHERE COALESCE(NULLIF(r.prompt_version, ''), '') = $2
         ) AS latest_official_prompt_row_at,
         EXTRACT(EPOCH FROM (NOW() - MAX(r.timestamp) FILTER (
           WHERE COALESCE(NULLIF(r.prompt_version, ''), '') = $2
         ))) / 3600 AS latest_official_prompt_row_age_hours,
         MAX(r.timestamp) FILTER (
           WHERE COALESCE(NULLIF(r.prompt_version, ''), '') NOT IN ('', $2)
         ) AS latest_non_official_prompt_row_at,
         EXTRACT(EPOCH FROM (NOW() - MAX(r.timestamp) FILTER (
           WHERE COALESCE(NULLIF(r.prompt_version, ''), '') NOT IN ('', $2)
         ))) / 3600 AS latest_non_official_prompt_row_age_hours
       FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')`,
      [lookbackDays, official],
    ),
    query<{
      prompt_version: string;
      count: string;
      actionable: string;
      with_decision_context: string;
      settled: string;
      pending: string;
    }>(
      `SELECT
         COALESCE(NULLIF(r.prompt_version, ''), '(empty)') AS prompt_version,
         COUNT(*)::text AS count,
         COUNT(*) FILTER (
           WHERE r.bet_type IS DISTINCT FROM 'NO_BET'
             AND r.result IS DISTINCT FROM 'duplicate'
         )::text AS actionable,
         COUNT(*) FILTER (
           WHERE COALESCE(r.decision_context, '{}'::jsonb) <> '{}'::jsonb
         )::text AS with_decision_context,
         COUNT(*) FILTER (
           WHERE r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL})
         )::text AS settled,
         COUNT(*) FILTER (
           WHERE r.result IS NULL
              OR r.result = ''
              OR r.result NOT IN (${FINAL_SETTLEMENT_RESULTS_SQL})
         )::text AS pending
       FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY 1
       ORDER BY COUNT(*) DESC, 1
       LIMIT 25`,
      [lookbackDays],
    ),
    query<{
      id: number;
      timestamp: string;
      match_id: string;
      home_team: string | null;
      away_team: string | null;
      prompt_version: string | null;
      ai_model: string | null;
      bet_market: string | null;
      result: string | null;
      has_decision_context: boolean;
      decision_kind: string | null;
    }>(
      `SELECT
         r.id,
         r.timestamp,
         r.match_id,
         r.home_team,
         r.away_team,
         r.prompt_version,
         r.ai_model,
         r.bet_market,
         r.result,
         (COALESCE(r.decision_context, '{}'::jsonb) <> '{}'::jsonb) AS has_decision_context,
         r.decision_context->>'decisionKind' AS decision_kind
       FROM recommendations r
       WHERE r.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY r.timestamp DESC, r.id DESC
       LIMIT $2`,
      [lookbackDays, maxRecentRows],
    ),
  ]);

  const totalsRow = totalsResult.rows[0];
  const totalRows = Number(totalsRow?.total_rows ?? 0);
  const officialPromptRows = Number(totalsRow?.official_prompt_rows ?? 0);
  const officialPromptWithDecisionContext = Number(totalsRow?.official_with_dc ?? 0);

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays,
    officialPromptVersion: official,
    activity: {
      firstRowAt: nullableIso(totalsRow?.first_row_at),
      latestRowAt: nullableIso(totalsRow?.latest_row_at),
      latestRowAgeHours: nullableNumber(totalsRow?.latest_row_age_hours),
      latestActionableRowAt: nullableIso(totalsRow?.latest_actionable_row_at),
      latestActionableRowAgeHours: nullableNumber(totalsRow?.latest_actionable_row_age_hours),
      latestOfficialPromptRowAt: nullableIso(totalsRow?.latest_official_prompt_row_at),
      latestOfficialPromptRowAgeHours: nullableNumber(totalsRow?.latest_official_prompt_row_age_hours),
      latestNonOfficialPromptRowAt: nullableIso(totalsRow?.latest_non_official_prompt_row_at),
      latestNonOfficialPromptRowAgeHours: nullableNumber(totalsRow?.latest_non_official_prompt_row_age_hours),
    },
    totals: {
      totalRows,
      actionableRows: Number(totalsRow?.actionable_rows ?? 0),
      officialPromptRows,
      officialPromptWithDecisionContext,
      officialPromptMissingDecisionContext: Number(totalsRow?.official_missing_dc ?? 0),
      nonOfficialPromptRows: Number(totalsRow?.non_official_prompt_rows ?? 0),
      emptyPromptVersionRows: Number(totalsRow?.empty_prompt_rows ?? 0),
      emptyDecisionContextRows: Number(totalsRow?.empty_dc_rows ?? 0),
      officialPromptRate: pct(officialPromptRows, totalRows),
      officialPromptWithDecisionContextRate: pct(officialPromptWithDecisionContext, totalRows),
    },
    byPromptVersion: promptRowsResult.rows.map((row) => ({
      promptVersion: row.prompt_version,
      count: Number(row.count),
      actionable: Number(row.actionable),
      withDecisionContext: Number(row.with_decision_context),
      settled: Number(row.settled),
      pending: Number(row.pending),
    })),
    recent: recentRowsResult.rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      matchId: row.match_id,
      matchDisplay: [row.home_team, row.away_team].filter(Boolean).join(' vs '),
      promptVersion: row.prompt_version && row.prompt_version.trim() ? row.prompt_version : '(empty)',
      aiModel: row.ai_model && row.ai_model.trim() ? row.ai_model : '(empty)',
      betMarket: row.bet_market && row.bet_market.trim() ? row.bet_market : '(empty)',
      result: row.result && row.result.trim() ? row.result : '(empty)',
      hasDecisionContext: row.has_decision_context,
      decisionKind: row.decision_kind && row.decision_kind.trim() ? row.decision_kind : '(empty)',
    })),
  };
}

export function formatRecommendationPromptAdoptionMarkdown(
  report: RecommendationPromptAdoptionReport,
): string {
  const lines: string[] = [
    '# Recommendation Prompt Adoption Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Lookback days: ${report.lookbackDays}`,
    `- Official prompt version: ${report.officialPromptVersion}`,
    `- First row at: ${report.activity.firstRowAt ?? '(none)'}`,
    `- Latest row at: ${report.activity.latestRowAt ?? '(none)'}`,
    `- Latest row age hours: ${report.activity.latestRowAgeHours ?? '(none)'}`,
    `- Latest official prompt row at: ${report.activity.latestOfficialPromptRowAt ?? '(none)'}`,
    `- Latest official prompt row age hours: ${report.activity.latestOfficialPromptRowAgeHours ?? '(none)'}`,
    `- Latest non-official prompt row at: ${report.activity.latestNonOfficialPromptRowAt ?? '(none)'}`,
    `- Latest non-official prompt row age hours: ${report.activity.latestNonOfficialPromptRowAgeHours ?? '(none)'}`,
    `- Total rows: ${report.totals.totalRows}`,
    `- Actionable rows: ${report.totals.actionableRows}`,
    `- Official prompt rows: ${report.totals.officialPromptRows}`,
    `- Official prompt with decision context: ${report.totals.officialPromptWithDecisionContext}`,
    `- Non-official prompt rows: ${report.totals.nonOfficialPromptRows}`,
    `- Empty prompt-version rows: ${report.totals.emptyPromptVersionRows}`,
    `- Official prompt rate: ${report.totals.officialPromptRate}%`,
    '',
    '## By Prompt Version',
    '',
    '| Prompt version | Count | Actionable | With decision context | Settled | Pending |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  if (report.byPromptVersion.length === 0) {
    lines.push('| (none) | 0 | 0 | 0 | 0 | 0 |');
  } else {
    for (const row of report.byPromptVersion) {
      lines.push(`| ${row.promptVersion} | ${row.count} | ${row.actionable} | ${row.withDecisionContext} | ${row.settled} | ${row.pending} |`);
    }
  }
  lines.push('', '## Recent Rows', '', '| ID | Timestamp | Match | Prompt | Model | Market | Result | Has DC | Decision kind |', '| ---: | --- | --- | --- | --- | --- | --- | --- | --- |');
  if (report.recent.length === 0) {
    lines.push('|  |  | (none) |  |  |  |  |  |  |');
  } else {
    for (const row of report.recent.slice(0, 50)) {
      lines.push(`| ${row.id} | ${row.timestamp} | ${row.matchDisplay || row.matchId} | ${row.promptVersion} | ${row.aiModel} | ${row.betMarket} | ${row.result} | ${row.hasDecisionContext ? 'yes' : 'no'} | ${row.decisionKind} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
