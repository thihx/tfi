import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { closePool, query } from '../db/pool.js';
import { getStrategicSourcePolicyAuditSnapshot } from '../config/strategic-source-policy.js';
import {
  diagnoseStrategicContextQuality,
  type StrategicContextAuditDiagnostics,
} from '../lib/strategic-context-quality-audit.js';
import { hasUsableStrategicContext } from '../lib/strategic-context.service.js';
import {
  buildPrematchExpertFeaturesV1,
  getPrematchPriorStrength,
  type PrematchPriorStrength,
} from '../lib/prematch-expert-features.js';

interface Args {
  lookbackHours: number;
  sampleLimit: number;
  outJson?: string;
  outMd?: string;
}

interface SegmentRow {
  refresh_status: string;
  search_quality: string;
  source_mode: string;
  last_error: string;
  rows: number;
  avg_trusted: string;
  avg_quantitative: string;
  avg_sources: string;
  avg_queries: string;
}

interface SampleRow {
  match_id: string;
  home_team: string | null;
  away_team: string | null;
  league_name: string | null;
  context_at: string | null;
  refresh_status: string;
  search_quality: string;
  source_mode: string;
  trusted_source_count: number;
  source_count: number;
  query_count: number;
  quantitative_count: number;
  last_error: string;
  summary: string;
  source_domains: string[];
  sources: Array<{
    domain: string | null;
    url: string | null;
    trust_tier: string | null;
    source_type: string | null;
  }>;
  strategic_context: Record<string, unknown> | null;
}

type SampleWithDiagnostics = SampleRow & {
  diagnostics: StrategicContextAuditDiagnostics;
  recommendationInfluence: StrategicContextRecommendationInfluence;
};

type OutputSample = Omit<SampleWithDiagnostics, 'strategic_context'>;

interface StrategicContextRecommendationInfluence {
  pipelineStrategicContextEligible: boolean;
  promptStrategicContextIncluded: boolean;
  prematchFeaturesBuiltFromStrategicContext: boolean;
  prematchPriorStrength: PrematchPriorStrength;
  prematchConfidenceCap: number | null;
  prematchNoisePenalty: number | null;
  risk: 'none' | 'fixture_only_no_prompt' | 'eligible_but_unverified' | 'decision_relevant';
}

interface GatewayMatchRow {
  home_team: string | null;
  away_team: string | null;
  league_name: string | null;
  grounded_started_count: number;
  grounded_succeeded_count: number;
  grounded_blocked_count: number;
  structured_succeeded_count: number;
  repair_succeeded_count: number;
  latest_reason: string | null;
}

function normalizeKeyPart(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function matchKey(homeTeam: unknown, awayTeam: unknown, leagueName: unknown): string {
  return [
    normalizeKeyPart(homeTeam),
    normalizeKeyPart(awayTeam),
    normalizeKeyPart(leagueName),
  ].join('|');
}

function gatewayInput(row: GatewayMatchRow | undefined) {
  if (!row) return undefined;
  return {
    groundedStartedCount: row.grounded_started_count,
    groundedSucceededCount: row.grounded_succeeded_count,
    groundedBlockedCount: row.grounded_blocked_count,
    structuredSucceededCount: row.structured_succeeded_count,
    repairSucceededCount: row.repair_succeeded_count,
    latestReason: row.latest_reason,
  };
}

function computeRecommendationInfluence(row: SampleRow, diagnostics: StrategicContextAuditDiagnostics): StrategicContextRecommendationInfluence {
  const refreshStatus = String(row.refresh_status || '').trim().toLowerCase();
  const pipelineStrategicContextEligible = !!row.strategic_context
    && refreshStatus === 'good'
    && hasUsableStrategicContext(row.strategic_context as Parameters<typeof hasUsableStrategicContext>[0]);
  const strategicContextForPrompt = pipelineStrategicContextEligible ? row.strategic_context : null;
  const prematchFeatures = buildPrematchExpertFeaturesV1({
    strategicContext: strategicContextForPrompt,
    leagueProfile: null,
    homeTeamProfile: null,
    awayTeamProfile: null,
  });
  const prematchPriorStrength = getPrematchPriorStrength(prematchFeatures);

  let risk: StrategicContextRecommendationInfluence['risk'] = 'none';
  if (!pipelineStrategicContextEligible && diagnostics.decisionUsefulness === 'fixture_only') {
    risk = 'fixture_only_no_prompt';
  } else if (pipelineStrategicContextEligible && diagnostics.decisionUsefulness === 'useful_but_unverified') {
    risk = 'eligible_but_unverified';
  } else if (pipelineStrategicContextEligible && diagnostics.decisionUsefulness === 'decision_relevant') {
    risk = 'decision_relevant';
  }

  return {
    pipelineStrategicContextEligible,
    promptStrategicContextIncluded: pipelineStrategicContextEligible,
    prematchFeaturesBuiltFromStrategicContext: !!prematchFeatures,
    prematchPriorStrength,
    prematchConfidenceCap: prematchFeatures?.trust_and_coverage.prematch_confidence_cap ?? null,
    prematchNoisePenalty: prematchFeatures?.trust_and_coverage.prematch_noise_penalty ?? null,
    risk,
  };
}

function countBy<T extends string>(items: T[]): Record<T, number> {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

function omitRawStrategicContext(row: SampleWithDiagnostics): OutputSample {
  const { strategic_context: _rawStrategicContext, ...safeRow } = row;
  return safeRow;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    lookbackHours: 168,
    sampleLimit: 20,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--lookback-hours' && next) {
      args.lookbackHours = Math.max(1, Number(next) || args.lookbackHours);
      i++;
      continue;
    }
    if (arg === '--sample-limit' && next) {
      args.sampleLimit = Math.max(1, Number(next) || args.sampleLimit);
      i++;
      continue;
    }
    if (arg === '--out-json' && next) {
      args.outJson = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--out-md' && next) {
      args.outMd = resolve(process.cwd(), next);
      i++;
    }
  }

  return args;
}

async function readCohort(args: Args) {
  const commonParams = [args.lookbackHours];
  const summary = await query(
    `WITH norm AS (
       SELECT
         COALESCE(
           NULLIF(mm.metadata->>'strategic_context_at', '')::timestamptz,
           NULLIF(mm.metadata->'strategic_context'->>'searched_at', '')::timestamptz,
           NULLIF(mm.metadata->'strategic_context'->'_meta'->>'last_attempt_at', '')::timestamptz
         ) AS context_at,
         COALESCE(mm.metadata->'strategic_context'->'_meta'->>'refresh_status', 'missing') AS refresh_status,
         COALESCE(mm.metadata->'strategic_context'->'source_meta'->>'search_quality', 'missing') AS search_quality,
         CASE
           WHEN mm.metadata->'strategic_context'->'source_meta' ? 'provider_fallback' THEN 'provider_fallback'
           ELSE 'grounded'
         END AS source_mode,
         COALESCE((mm.metadata->'strategic_context'->'source_meta'->>'trusted_source_count')::int, 0) AS trusted_source_count,
         (
           SELECT COUNT(*)::int
           FROM jsonb_each(COALESCE(mm.metadata->'strategic_context'->'quantitative', '{}'::jsonb)) q
           WHERE q.value <> 'null'::jsonb
         ) AS quantitative_count
       FROM monitored_matches mm
       WHERE mm.metadata ? 'strategic_context'
     ), scoped AS (
       SELECT *
       FROM norm
       WHERE context_at IS NULL
          OR context_at >= NOW() - ($1::int * INTERVAL '1 hour')
     )
     SELECT
       (SELECT COUNT(*)::int FROM scoped) AS total,
       (SELECT jsonb_object_agg(refresh_status, rows) FROM (
          SELECT refresh_status, COUNT(*)::int rows FROM scoped GROUP BY refresh_status
        ) s) AS by_status,
       (SELECT jsonb_object_agg(search_quality, rows) FROM (
          SELECT search_quality, COUNT(*)::int rows FROM scoped GROUP BY search_quality
        ) q) AS by_quality,
       (SELECT jsonb_object_agg(source_mode, rows) FROM (
          SELECT source_mode, COUNT(*)::int rows FROM scoped GROUP BY source_mode
        ) m) AS by_source_mode,
       ROUND(AVG(trusted_source_count)::numeric, 2) AS avg_trusted,
       ROUND(AVG(quantitative_count)::numeric, 2) AS avg_quantitative
     FROM scoped`,
    commonParams,
  );

  const segments = await query<SegmentRow>(
    `WITH norm AS (
       SELECT
         COALESCE(
           NULLIF(mm.metadata->>'strategic_context_at', '')::timestamptz,
           NULLIF(mm.metadata->'strategic_context'->>'searched_at', '')::timestamptz,
           NULLIF(mm.metadata->'strategic_context'->'_meta'->>'last_attempt_at', '')::timestamptz
         ) AS context_at,
         COALESCE(mm.metadata->'strategic_context'->'_meta'->>'refresh_status', 'missing') AS refresh_status,
         COALESCE(mm.metadata->'strategic_context'->'source_meta'->>'search_quality', 'missing') AS search_quality,
         CASE
           WHEN mm.metadata->'strategic_context'->'source_meta' ? 'provider_fallback' THEN 'provider_fallback'
           ELSE 'grounded'
         END AS source_mode,
         COALESCE(mm.metadata->'strategic_context'->'_meta'->>'last_error', '') AS last_error,
         COALESCE((mm.metadata->'strategic_context'->'source_meta'->>'trusted_source_count')::int, 0) AS trusted_source_count,
         COALESCE(jsonb_array_length(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'sources', '[]'::jsonb)), 0) AS source_count,
         COALESCE(jsonb_array_length(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'web_search_queries', '[]'::jsonb)), 0) AS query_count,
         (
           SELECT COUNT(*)::int
           FROM jsonb_each(COALESCE(mm.metadata->'strategic_context'->'quantitative', '{}'::jsonb)) q
           WHERE q.value <> 'null'::jsonb
         ) AS quantitative_count
       FROM monitored_matches mm
       WHERE mm.metadata ? 'strategic_context'
     )
     SELECT
       refresh_status,
       search_quality,
       source_mode,
       last_error,
       COUNT(*)::int AS rows,
       ROUND(AVG(trusted_source_count)::numeric, 2)::text AS avg_trusted,
       ROUND(AVG(quantitative_count)::numeric, 2)::text AS avg_quantitative,
       ROUND(AVG(source_count)::numeric, 2)::text AS avg_sources,
       ROUND(AVG(query_count)::numeric, 2)::text AS avg_queries
     FROM norm
     WHERE context_at IS NULL
        OR context_at >= NOW() - ($1::int * INTERVAL '1 hour')
     GROUP BY refresh_status, search_quality, source_mode, last_error
     ORDER BY rows DESC, refresh_status, search_quality, source_mode`,
    commonParams,
  );

  const samples = await query<SampleRow>(
    `WITH norm AS (
       SELECT
         mm.match_id,
         m.home_team,
         m.away_team,
         m.league_name,
         COALESCE(
           NULLIF(mm.metadata->>'strategic_context_at', '')::timestamptz,
           NULLIF(mm.metadata->'strategic_context'->>'searched_at', '')::timestamptz,
           NULLIF(mm.metadata->'strategic_context'->'_meta'->>'last_attempt_at', '')::timestamptz
         )::text AS context_at,
         COALESCE(mm.metadata->'strategic_context'->'_meta'->>'refresh_status', 'missing') AS refresh_status,
         COALESCE(mm.metadata->'strategic_context'->'source_meta'->>'search_quality', 'missing') AS search_quality,
         CASE
           WHEN mm.metadata->'strategic_context'->'source_meta' ? 'provider_fallback' THEN 'provider_fallback'
           ELSE 'grounded'
         END AS source_mode,
         COALESCE((mm.metadata->'strategic_context'->'source_meta'->>'trusted_source_count')::int, 0) AS trusted_source_count,
         COALESCE(jsonb_array_length(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'sources', '[]'::jsonb)), 0) AS source_count,
         COALESCE(jsonb_array_length(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'web_search_queries', '[]'::jsonb)), 0) AS query_count,
         (
           SELECT COUNT(*)::int
           FROM jsonb_each(COALESCE(mm.metadata->'strategic_context'->'quantitative', '{}'::jsonb)) q
           WHERE q.value <> 'null'::jsonb
         ) AS quantitative_count,
         COALESCE(mm.metadata->'strategic_context'->'_meta'->>'last_error', '') AS last_error,
         LEFT(COALESCE(mm.metadata->'strategic_context'->>'summary', ''), 260) AS summary,
         mm.metadata->'strategic_context' AS strategic_context,
         COALESCE((
           SELECT ARRAY_AGG(DISTINCT source->>'domain')
           FROM jsonb_array_elements(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'sources', '[]'::jsonb)) source
           WHERE COALESCE(source->>'domain', '') <> ''
         ), ARRAY[]::text[]) AS source_domains,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'domain', source->>'domain',
             'url', source->>'url',
             'trust_tier', source->>'trust_tier',
             'source_type', source->>'source_type'
           ))
           FROM jsonb_array_elements(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'sources', '[]'::jsonb)) source
         ), '[]'::jsonb) AS sources
       FROM monitored_matches mm
       LEFT JOIN matches m ON m.match_id::text = mm.match_id
       WHERE mm.metadata ? 'strategic_context'
     )
     SELECT *
     FROM norm
     WHERE (context_at IS NULL OR context_at::timestamptz >= NOW() - ($1::int * INTERVAL '1 hour'))
       AND (
         refresh_status <> 'good'
         OR search_quality IN ('low', 'unknown', 'missing')
         OR trusted_source_count < 2
         OR quantitative_count < 4
       )
     ORDER BY
       CASE source_mode WHEN 'provider_fallback' THEN 0 ELSE 1 END,
       quantitative_count ASC,
       trusted_source_count ASC,
       context_at DESC NULLS LAST
     LIMIT $2`,
    [args.lookbackHours, args.sampleLimit],
  );

  const allSamples = await query<SampleRow>(
    `WITH norm AS (
       SELECT
         mm.match_id,
         m.home_team,
         m.away_team,
         m.league_name,
         COALESCE(
           NULLIF(mm.metadata->>'strategic_context_at', '')::timestamptz,
           NULLIF(mm.metadata->'strategic_context'->>'searched_at', '')::timestamptz,
           NULLIF(mm.metadata->'strategic_context'->'_meta'->>'last_attempt_at', '')::timestamptz
         )::text AS context_at,
         COALESCE(mm.metadata->'strategic_context'->'_meta'->>'refresh_status', 'missing') AS refresh_status,
         COALESCE(mm.metadata->'strategic_context'->'source_meta'->>'search_quality', 'missing') AS search_quality,
         CASE
           WHEN mm.metadata->'strategic_context'->'source_meta' ? 'provider_fallback' THEN 'provider_fallback'
           ELSE 'grounded'
         END AS source_mode,
         COALESCE((mm.metadata->'strategic_context'->'source_meta'->>'trusted_source_count')::int, 0) AS trusted_source_count,
         COALESCE(jsonb_array_length(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'sources', '[]'::jsonb)), 0) AS source_count,
         COALESCE(jsonb_array_length(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'web_search_queries', '[]'::jsonb)), 0) AS query_count,
         (
           SELECT COUNT(*)::int
           FROM jsonb_each(COALESCE(mm.metadata->'strategic_context'->'quantitative', '{}'::jsonb)) q
           WHERE q.value <> 'null'::jsonb
         ) AS quantitative_count,
         COALESCE(mm.metadata->'strategic_context'->'_meta'->>'last_error', '') AS last_error,
         LEFT(COALESCE(mm.metadata->'strategic_context'->>'summary', ''), 260) AS summary,
         mm.metadata->'strategic_context' AS strategic_context,
         COALESCE((
           SELECT ARRAY_AGG(DISTINCT source->>'domain')
           FROM jsonb_array_elements(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'sources', '[]'::jsonb)) source
           WHERE COALESCE(source->>'domain', '') <> ''
         ), ARRAY[]::text[]) AS source_domains,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'domain', source->>'domain',
             'url', source->>'url',
             'trust_tier', source->>'trust_tier',
             'source_type', source->>'source_type'
           ))
           FROM jsonb_array_elements(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'sources', '[]'::jsonb)) source
         ), '[]'::jsonb) AS sources
       FROM monitored_matches mm
       LEFT JOIN matches m ON m.match_id::text = mm.match_id
       WHERE mm.metadata ? 'strategic_context'
     )
     SELECT *
     FROM norm
     WHERE context_at IS NULL OR context_at::timestamptz >= NOW() - ($1::int * INTERVAL '1 hour')
     ORDER BY quantitative_count DESC, trusted_source_count DESC, context_at DESC NULLS LAST
     LIMIT $2`,
    [args.lookbackHours, Math.max(args.sampleLimit, 50)],
  );

  const domains = await query<{ domain: string; trust_tier: string; source_type: string; rows: number }>(
    `WITH sources AS (
       SELECT
         source->>'domain' AS domain,
         COALESCE(source->>'trust_tier', 'unknown') AS trust_tier,
         COALESCE(source->>'source_type', 'unknown') AS source_type
       FROM monitored_matches mm
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(mm.metadata->'strategic_context'->'source_meta'->'sources', '[]'::jsonb)) source
       WHERE mm.metadata ? 'strategic_context'
     )
     SELECT domain, trust_tier, source_type, COUNT(*)::int AS rows
     FROM sources
     WHERE COALESCE(domain, '') <> ''
     GROUP BY domain, trust_tier, source_type
     ORDER BY rows DESC, domain
     LIMIT 40`,
  );

  const gateway = await query(
    `SELECT operation, status, decision, reason, COUNT(*)::int AS rows,
            ROUND(AVG(estimated_input_tokens)::numeric, 0) AS avg_input_tokens,
            ROUND(AVG(estimated_output_tokens)::numeric, 0) AS avg_output_tokens,
            ROUND(SUM(estimated_cost_usd)::numeric, 6) AS estimated_cost_usd
       FROM ai_gateway_logs
      WHERE feature_key = 'tfi.strategic_context'
        AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')
      GROUP BY operation, status, decision, reason
      ORDER BY rows DESC, operation, status
      LIMIT 50`,
    commonParams,
  ).catch(() => ({ rows: [] }));

  const gatewayByMatch = await query<GatewayMatchRow>(
    `SELECT
        metadata->>'homeTeam' AS home_team,
        metadata->>'awayTeam' AS away_team,
        metadata->>'league' AS league_name,
        COUNT(*) FILTER (
          WHERE operation = 'tfi.strategic_context.grounded_research'
            AND status = 'started'
        )::int AS grounded_started_count,
        COUNT(*) FILTER (
          WHERE operation = 'tfi.strategic_context.grounded_research'
            AND status = 'succeeded'
        )::int AS grounded_succeeded_count,
        COUNT(*) FILTER (
          WHERE operation = 'tfi.strategic_context.grounded_research'
            AND status = 'blocked'
        )::int AS grounded_blocked_count,
        COUNT(*) FILTER (
          WHERE operation = 'tfi.strategic_context.structured_context'
            AND status = 'succeeded'
        )::int AS structured_succeeded_count,
        COUNT(*) FILTER (
          WHERE operation = 'tfi.strategic_context.json_repair'
            AND status = 'succeeded'
        )::int AS repair_succeeded_count,
        (ARRAY_AGG(reason ORDER BY created_at DESC))[1] AS latest_reason
       FROM ai_gateway_logs
      WHERE feature_key = 'tfi.strategic_context'
        AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')
        AND COALESCE(metadata->>'homeTeam', '') <> ''
        AND COALESCE(metadata->>'awayTeam', '') <> ''
        AND COALESCE(metadata->>'league', '') <> ''
      GROUP BY metadata->>'homeTeam', metadata->>'awayTeam', metadata->>'league'`,
    commonParams,
  ).catch(() => ({ rows: [] as GatewayMatchRow[] }));

  const gatewayByMatchKey = new Map(
    gatewayByMatch.rows.map((row) => [matchKey(row.home_team, row.away_team, row.league_name), row] as const),
  );

  const buildDiagnosedSample = (row: SampleRow): SampleWithDiagnostics => {
    const diagnostics = diagnoseStrategicContextQuality({
      refreshStatus: row.refresh_status,
      searchQuality: row.search_quality,
      sourceMode: row.source_mode,
      trustedSourceCount: row.trusted_source_count,
      sourceCount: row.source_count,
      queryCount: row.query_count,
      quantitativeCount: row.quantitative_count,
      lastError: row.last_error,
      summary: row.summary,
      sources: row.sources,
      gateway: gatewayInput(gatewayByMatchKey.get(matchKey(row.home_team, row.away_team, row.league_name))),
    });
    return {
      ...row,
      diagnostics,
      recommendationInfluence: computeRecommendationInfluence(row, diagnostics),
    };
  };

  const lowQualitySamples: SampleWithDiagnostics[] = samples.rows.map(buildDiagnosedSample);
  const allDiagnosedSamples: SampleWithDiagnostics[] = allSamples.rows.map(buildDiagnosedSample);
  const traceabilityRiskSamples = allDiagnosedSamples
    .filter((row) => row.diagnostics.claimTraceability !== 'source_url_only'
      || row.diagnostics.quantitativeIntegrity === 'values_without_attribution')
    .slice(0, args.sampleLimit);

  return {
    generatedAt: new Date().toISOString(),
    lookbackHours: args.lookbackHours,
    summary: summary.rows[0] ?? {},
    segments: segments.rows,
    lowQualitySamples: lowQualitySamples.map(omitRawStrategicContext),
    diagnosticsSummary: {
      byRootCause: countBy(allDiagnosedSamples.map((row) => row.diagnostics.rootCause)),
      byDecisionUsefulness: countBy(allDiagnosedSamples.map((row) => row.diagnostics.decisionUsefulness)),
      byClaimTraceability: countBy(allDiagnosedSamples.map((row) => row.diagnostics.claimTraceability)),
      byQuantitativeIntegrity: countBy(allDiagnosedSamples.map((row) => row.diagnostics.quantitativeIntegrity)),
      byRecommendationInfluenceRisk: countBy(allDiagnosedSamples.map((row) => row.recommendationInfluence.risk)),
      promptIncludedCount: allDiagnosedSamples.filter((row) => row.recommendationInfluence.promptStrategicContextIncluded).length,
      prematchFeatureBuiltCount: allDiagnosedSamples.filter((row) => row.recommendationInfluence.prematchFeaturesBuiltFromStrategicContext).length,
    },
    traceabilityRiskSamples: traceabilityRiskSamples.map(omitRawStrategicContext),
    topSourceDomains: domains.rows,
    aiGateway: gateway.rows,
    sourcePolicy: getStrategicSourcePolicyAuditSnapshot(),
  };
}

function buildMarkdown(report: Awaited<ReturnType<typeof readCohort>>): string {
  const lines: string[] = [
    '# Strategic Context Quality Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Lookback hours: ${report.lookbackHours}`,
    '',
    '## Summary',
    '',
    '```json',
    JSON.stringify(report.summary, null, 2),
    '```',
    '',
    '## Segments',
    '',
    '| Status | Quality | Source mode | Last error | Rows | Avg trusted | Avg quantitative | Avg sources | Avg queries |',
    '|---|---|---|---|---:|---:|---:|---:|---:|',
  ];

  for (const row of report.segments) {
    lines.push(`| ${row.refresh_status} | ${row.search_quality} | ${row.source_mode} | ${row.last_error || '-'} | ${row.rows} | ${row.avg_trusted} | ${row.avg_quantitative} | ${row.avg_sources} | ${row.avg_queries} |`);
  }

  lines.push('', '## Low Quality Samples', '');
  for (const row of report.lowQualitySamples) {
    lines.push(`### ${row.home_team ?? '?'} vs ${row.away_team ?? '?'} (${row.match_id})`);
    lines.push(`- league: ${row.league_name ?? ''}`);
    lines.push(`- status/quality/source: ${row.refresh_status} / ${row.search_quality} / ${row.source_mode}`);
    lines.push(`- root cause: ${row.diagnostics.rootCause}`);
    lines.push(`- decision usefulness: ${row.diagnostics.decisionUsefulness}`);
    lines.push(`- traceability/integrity: ${row.diagnostics.claimTraceability} / ${row.diagnostics.quantitativeIntegrity}`);
    lines.push(`- reason codes: ${row.diagnostics.reasonCodes.join(', ') || '-'}`);
    lines.push(`- trusted/source/query/quantitative counts: ${row.trusted_source_count} / ${row.source_count} / ${row.query_count} / ${row.quantitative_count}`);
    lines.push(`- concrete/generic source URLs: ${row.diagnostics.concreteSourceUrlCount} / ${row.diagnostics.genericSourceUrlCount}`);
    lines.push(`- gateway grounded started/succeeded/blocked: ${row.diagnostics.gatewayCorrelation.groundedStartedCount} / ${row.diagnostics.gatewayCorrelation.groundedSucceededCount} / ${row.diagnostics.gatewayCorrelation.groundedBlockedCount}`);
    lines.push(`- gateway structured/repair succeeded: ${row.diagnostics.gatewayCorrelation.structuredSucceededCount} / ${row.diagnostics.gatewayCorrelation.repairSucceededCount}`);
    lines.push(`- recommendation influence: prompt=${row.recommendationInfluence.promptStrategicContextIncluded}, features=${row.recommendationInfluence.prematchFeaturesBuiltFromStrategicContext}, strength=${row.recommendationInfluence.prematchPriorStrength}, cap=${row.recommendationInfluence.prematchConfidenceCap ?? '-'}, noise=${row.recommendationInfluence.prematchNoisePenalty ?? '-'}, risk=${row.recommendationInfluence.risk}`);
    lines.push(`- last_error: ${row.last_error || '-'}`);
    lines.push(`- domains: ${row.source_domains.join(', ') || '-'}`);
    lines.push(`- summary: ${row.summary}`);
    lines.push('');
  }

  lines.push('', '## Traceability Risk Samples', '');
  for (const row of report.traceabilityRiskSamples) {
    lines.push(`### ${row.home_team ?? '?'} vs ${row.away_team ?? '?'} (${row.match_id})`);
    lines.push(`- league: ${row.league_name ?? ''}`);
    lines.push(`- status/quality/source: ${row.refresh_status} / ${row.search_quality} / ${row.source_mode}`);
    lines.push(`- root cause: ${row.diagnostics.rootCause}`);
    lines.push(`- decision usefulness: ${row.diagnostics.decisionUsefulness}`);
    lines.push(`- traceability/integrity: ${row.diagnostics.claimTraceability} / ${row.diagnostics.quantitativeIntegrity}`);
    lines.push(`- trusted/source/query/quantitative counts: ${row.trusted_source_count} / ${row.source_count} / ${row.query_count} / ${row.quantitative_count}`);
    lines.push(`- concrete/generic source URLs: ${row.diagnostics.concreteSourceUrlCount} / ${row.diagnostics.genericSourceUrlCount}`);
    lines.push(`- gateway grounded started/succeeded/blocked: ${row.diagnostics.gatewayCorrelation.groundedStartedCount} / ${row.diagnostics.gatewayCorrelation.groundedSucceededCount} / ${row.diagnostics.gatewayCorrelation.groundedBlockedCount}`);
    lines.push(`- gateway structured/repair succeeded: ${row.diagnostics.gatewayCorrelation.structuredSucceededCount} / ${row.diagnostics.gatewayCorrelation.repairSucceededCount}`);
    lines.push(`- recommendation influence: prompt=${row.recommendationInfluence.promptStrategicContextIncluded}, features=${row.recommendationInfluence.prematchFeaturesBuiltFromStrategicContext}, strength=${row.recommendationInfluence.prematchPriorStrength}, cap=${row.recommendationInfluence.prematchConfidenceCap ?? '-'}, noise=${row.recommendationInfluence.prematchNoisePenalty ?? '-'}, risk=${row.recommendationInfluence.risk}`);
    lines.push(`- reason codes: ${row.diagnostics.reasonCodes.join(', ') || '-'}`);
    lines.push(`- domains: ${row.source_domains.join(', ') || '-'}`);
    lines.push(`- summary: ${row.summary}`);
    lines.push('');
  }

  lines.push('## Top Source Domains', '');
  lines.push('| Domain | Trust tier | Source type | Rows |');
  lines.push('|---|---|---|---:|');
  for (const row of report.topSourceDomains) {
    lines.push(`| ${row.domain} | ${row.trust_tier} | ${row.source_type} | ${row.rows} |`);
  }

  lines.push('', '## AI Gateway', '');
  lines.push('```json');
  lines.push(JSON.stringify(report.aiGateway, null, 2));
  lines.push('```');

  lines.push('', '## Diagnostics Summary', '');
  lines.push('```json');
  lines.push(JSON.stringify(report.diagnosticsSummary, null, 2));
  lines.push('```');

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await readCohort(args);

  if (args.outJson) {
    mkdirSync(dirname(args.outJson), { recursive: true });
    writeFileSync(args.outJson, JSON.stringify(report, null, 2), 'utf8');
  }
  if (args.outMd) {
    mkdirSync(dirname(args.outMd), { recursive: true });
    writeFileSync(args.outMd, buildMarkdown(report), 'utf8');
  }

  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    lookbackHours: report.lookbackHours,
    summary: report.summary,
    segmentCount: report.segments.length,
    sampleCount: report.lowQualitySamples.length,
    outJson: args.outJson ?? null,
    outMd: args.outMd ?? null,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
