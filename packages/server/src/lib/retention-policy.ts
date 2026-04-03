import type { config as configType } from '../config.js';

export type RetentionClass =
  | 'operational_log'
  | 'support_sample'
  | 'support_cache'
  | 'delivery_trace'
  | 'canonical_history'
  | 'canonical_analytics';

export interface HousekeepingRetentionRule {
  key: keyof HousekeepingKeepDays;
  label: string;
  retentionClass: RetentionClass;
  tableNames: string[];
  strategy: 'delete' | 'soft_delete_hard_delete' | 'slim' | 'aggregate_delete';
  configuredKeepDays: number;
  effectiveKeepDays: number;
  minimumKeepDays: number;
  allowDisable?: boolean;
}

export interface HousekeepingKeepDays {
  audit: number;
  matchesHistory: number;
  matchesHistoryHardDelete: number;
  providerSamples: number;
  providerCache: number;
  matchSnapshots: number;
  oddsMovements: number;
  promptShadow: number;
  pipelineRuns: number;
  jobRunHistory: number;
  recommendationDeliveries: number;
  recommendationsSlim: number;
  aiPerformance: number;
}

export interface HousekeepingRetentionPolicy {
  keepDays: HousekeepingKeepDays;
  warnings: string[];
  rules: HousekeepingRetentionRule[];
  protectedTables: string[];
}

type ConfigShape = Pick<
  typeof configType,
  | 'auditKeepDays'
  | 'matchesHistoryKeepDays'
  | 'matchesHistoryHardDeleteDays'
  | 'providerSamplesKeepDays'
  | 'providerCacheKeepDays'
  | 'matchSnapshotsKeepDays'
  | 'oddsMovementsKeepDays'
  | 'promptShadowKeepDays'
  | 'pipelineRunsKeepDays'
  | 'jobRunHistoryKeepDays'
  | 'recommendationDeliveriesKeepDays'
  | 'recommendationsSlimDays'
  | 'aiPerformanceKeepDays'
>;

const PROTECTED_TABLES = [
  'league_profiles',
  'team_profiles',
  'watchlist',
  'monitored_matches',
  'user_watch_subscriptions',
  'recommendations',
] as const;

function clampKeepDays(
  label: string,
  configuredKeepDays: number,
  minimumKeepDays: number,
  warnings: string[],
  options: { allowDisable?: boolean } = {},
): number {
  if (options.allowDisable && configuredKeepDays <= 0) {
    return 0;
  }
  const effectiveKeepDays = Math.max(configuredKeepDays, minimumKeepDays);
  if (effectiveKeepDays !== configuredKeepDays) {
    warnings.push(`${label} keepDays clamped from ${configuredKeepDays}d to ${effectiveKeepDays}d`);
  }
  return effectiveKeepDays;
}

export function resolveHousekeepingRetentionPolicy(config: ConfigShape): HousekeepingRetentionPolicy {
  const warnings: string[] = [];

  const keepDays: HousekeepingKeepDays = {
    audit: clampKeepDays('audit_logs', config.auditKeepDays, 3, warnings),
    matchesHistory: clampKeepDays('matches_history', config.matchesHistoryKeepDays, 90, warnings),
    matchesHistoryHardDelete: 0,
    providerSamples: clampKeepDays('provider samples', config.providerSamplesKeepDays, 1, warnings),
    providerCache: clampKeepDays('provider cache', config.providerCacheKeepDays, 3, warnings),
    matchSnapshots: clampKeepDays('match_snapshots', config.matchSnapshotsKeepDays, 3, warnings),
    oddsMovements: clampKeepDays('odds_movements', config.oddsMovementsKeepDays, 3, warnings),
    promptShadow: clampKeepDays('prompt_shadow_runs', config.promptShadowKeepDays, 3, warnings),
    pipelineRuns: clampKeepDays('pipeline_runs', config.pipelineRunsKeepDays, 3, warnings),
    jobRunHistory: clampKeepDays('job_run_history', config.jobRunHistoryKeepDays, 3, warnings),
    recommendationDeliveries: clampKeepDays(
      'user_recommendation_deliveries',
      config.recommendationDeliveriesKeepDays,
      7,
      warnings,
      { allowDisable: true },
    ),
    recommendationsSlim: clampKeepDays('recommendations slim', config.recommendationsSlimDays, 180, warnings),
    aiPerformance: clampKeepDays('ai_performance', config.aiPerformanceKeepDays, 180, warnings),
  };

  const minimumHardDelete = Math.max(keepDays.matchesHistory + 30, 120);
  keepDays.matchesHistoryHardDelete = clampKeepDays(
    'matches_history hard delete',
    config.matchesHistoryHardDeleteDays,
    minimumHardDelete,
    warnings,
  );

  const rules: HousekeepingRetentionRule[] = [
    {
      key: 'audit',
      label: 'Audit Logs',
      retentionClass: 'operational_log',
      tableNames: ['audit_logs'],
      strategy: 'delete',
      configuredKeepDays: config.auditKeepDays,
      effectiveKeepDays: keepDays.audit,
      minimumKeepDays: 3,
    },
    {
      key: 'jobRunHistory',
      label: 'Job Run History',
      retentionClass: 'operational_log',
      tableNames: ['job_run_history'],
      strategy: 'delete',
      configuredKeepDays: config.jobRunHistoryKeepDays,
      effectiveKeepDays: keepDays.jobRunHistory,
      minimumKeepDays: 3,
    },
    {
      key: 'pipelineRuns',
      label: 'Pipeline Runs',
      retentionClass: 'operational_log',
      tableNames: ['pipeline_runs'],
      strategy: 'delete',
      configuredKeepDays: config.pipelineRunsKeepDays,
      effectiveKeepDays: keepDays.pipelineRuns,
      minimumKeepDays: 3,
    },
    {
      key: 'promptShadow',
      label: 'Prompt Shadow Runs',
      retentionClass: 'operational_log',
      tableNames: ['prompt_shadow_runs'],
      strategy: 'delete',
      configuredKeepDays: config.promptShadowKeepDays,
      effectiveKeepDays: keepDays.promptShadow,
      minimumKeepDays: 3,
    },
    {
      key: 'matchSnapshots',
      label: 'Match Snapshots',
      retentionClass: 'operational_log',
      tableNames: ['match_snapshots'],
      strategy: 'delete',
      configuredKeepDays: config.matchSnapshotsKeepDays,
      effectiveKeepDays: keepDays.matchSnapshots,
      minimumKeepDays: 3,
    },
    {
      key: 'oddsMovements',
      label: 'Odds Movements',
      retentionClass: 'operational_log',
      tableNames: ['odds_movements'],
      strategy: 'delete',
      configuredKeepDays: config.oddsMovementsKeepDays,
      effectiveKeepDays: keepDays.oddsMovements,
      minimumKeepDays: 3,
    },
    {
      key: 'providerSamples',
      label: 'Provider Samples',
      retentionClass: 'support_sample',
      tableNames: ['provider_stats_samples', 'provider_odds_samples'],
      strategy: 'delete',
      configuredKeepDays: config.providerSamplesKeepDays,
      effectiveKeepDays: keepDays.providerSamples,
      minimumKeepDays: 1,
    },
    {
      key: 'providerCache',
      label: 'Provider Cache',
      retentionClass: 'support_cache',
      tableNames: [
        'provider_odds_cache',
        'provider_fixture_cache',
        'provider_fixture_stats_cache',
        'provider_fixture_events_cache',
        'provider_fixture_lineups_cache',
        'provider_fixture_prediction_cache',
        'provider_league_standings_cache',
      ],
      strategy: 'delete',
      configuredKeepDays: config.providerCacheKeepDays,
      effectiveKeepDays: keepDays.providerCache,
      minimumKeepDays: 3,
    },
    {
      key: 'recommendationDeliveries',
      label: 'Recommendation Deliveries',
      retentionClass: 'delivery_trace',
      tableNames: ['user_recommendation_deliveries'],
      strategy: 'delete',
      configuredKeepDays: config.recommendationDeliveriesKeepDays,
      effectiveKeepDays: keepDays.recommendationDeliveries,
      minimumKeepDays: 7,
      allowDisable: true,
    },
    {
      key: 'matchesHistory',
      label: 'Matches History',
      retentionClass: 'canonical_history',
      tableNames: ['matches_history'],
      strategy: 'soft_delete_hard_delete',
      configuredKeepDays: config.matchesHistoryKeepDays,
      effectiveKeepDays: keepDays.matchesHistory,
      minimumKeepDays: 90,
    },
    {
      key: 'recommendationsSlim',
      label: 'Recommendations Slimming',
      retentionClass: 'canonical_analytics',
      tableNames: ['recommendations'],
      strategy: 'slim',
      configuredKeepDays: config.recommendationsSlimDays,
      effectiveKeepDays: keepDays.recommendationsSlim,
      minimumKeepDays: 180,
    },
    {
      key: 'aiPerformance',
      label: 'AI Performance Detail',
      retentionClass: 'canonical_analytics',
      tableNames: ['ai_performance'],
      strategy: 'aggregate_delete',
      configuredKeepDays: config.aiPerformanceKeepDays,
      effectiveKeepDays: keepDays.aiPerformance,
      minimumKeepDays: 180,
    },
  ];

  return {
    keepDays,
    warnings,
    rules,
    protectedTables: [...PROTECTED_TABLES],
  };
}
