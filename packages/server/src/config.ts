// ============================================================
// Server configuration — loaded from environment
// ============================================================

import 'dotenv/config';

export const config = {
  databaseUrl: process.env['DATABASE_URL'] || 'postgresql://tfi:tfi_password@localhost:5432/tfi',
  port: Number(process.env['PORT'] || 4000),
  corsOrigin: process.env['CORS_ORIGIN'] || 'http://localhost:3000',

  // Football API
  footballApiKey: process.env['FOOTBALL_API_KEY'] || '',
  footballApiBaseUrl: process.env['FOOTBALL_API_BASE_URL'] || 'https://v3.football.api-sports.io',

  // AI (Gemini)
  geminiApiKey: process.env['GEMINI_API_KEY'] || '',
  geminiModel: process.env['GEMINI_MODEL'] || 'gemini-3-pro-preview',
  geminiTimeoutMs: Number(process.env['GEMINI_TIMEOUT_MS'] || 90000),
  geminiStrategicGroundedModel: process.env['GEMINI_STRATEGIC_GROUNDED_MODEL'] || 'gemini-2.5-flash',
  geminiStrategicStructuredModel: process.env['GEMINI_STRATEGIC_STRUCTURED_MODEL'] || 'gemini-2.5-flash',
  geminiStrategicGroundedMaxOutputTokens: Number(process.env['GEMINI_STRATEGIC_GROUNDED_MAX_OUTPUT_TOKENS'] || 4000),
  geminiStrategicStructuredMaxOutputTokens: Number(process.env['GEMINI_STRATEGIC_STRUCTURED_MAX_OUTPUT_TOKENS'] || 2048),
  geminiStrategicGroundedThinkingBudget: process.env['GEMINI_STRATEGIC_GROUNDED_THINKING_BUDGET'] == null
    ? 0
    : Number(process.env['GEMINI_STRATEGIC_GROUNDED_THINKING_BUDGET']),
  geminiStrategicStructuredThinkingBudget: process.env['GEMINI_STRATEGIC_STRUCTURED_THINKING_BUDGET'] == null
    ? 0
    : Number(process.env['GEMINI_STRATEGIC_STRUCTURED_THINKING_BUDGET']),

  // Telegram
  telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'] || '',

  // The Odds API (fallback odds)
  theOddsApiKey: process.env['THE_ODDS_API_KEY'] || '',
  theOddsApiBaseUrl: process.env['THE_ODDS_API_BASE_URL'] || 'https://api.the-odds-api.com/v4',

  // Live Score API (benchmark-only stats provider)
  liveScoreApiKey: process.env['LIVE_SCORE_API_KEY'] || '',
  liveScoreApiSecret: process.env['LIVE_SCORE_API_SECRET'] || '',
  liveScoreApiBaseUrl: process.env['LIVE_SCORE_API_BASE_URL'] || 'https://livescore-api.com/api-client',
  liveScoreBenchmarkEnabled: process.env['LIVE_SCORE_BENCHMARK_ENABLED'] === 'true',
  liveScoreStatsFallbackEnabled: process.env['LIVE_SCORE_STATS_FALLBACK_ENABLED'] === 'true',
  webLiveStatsFallbackEnabled: process.env['WEB_LIVE_STATS_FALLBACK_ENABLED'] === 'true',

  // Redis
  redisUrl: process.env['REDIS_URL'] || '',

  // Timezone
  timezone: process.env['TIMEZONE'] || 'Asia/Seoul',

  // Google OAuth
  googleClientId: process.env['GOOGLE_CLIENT_ID'] || '',
  googleClientSecret: process.env['GOOGLE_CLIENT_SECRET'] || '',
  frontendUrl: process.env['FRONTEND_URL'] || 'http://localhost:3000',
  allowedEmails: (process.env['ALLOWED_EMAILS'] || '').split(',').map((s) => s.trim()).filter(Boolean),

  // JWT (uses Node built-in crypto — no extra package needed)
  jwtSecret: process.env['JWT_SECRET'] || '',
  nodeEnv: process.env['NODE_ENV'] || 'development',
  jwtExpiresInSeconds: Number(process.env['JWT_EXPIRES_IN_SECONDS'] || 604800), // 7 days

  // Job intervals (ms) — 0 = disabled
  jobFetchMatchesMs: Number(process.env['JOB_FETCH_MATCHES_MS'] || 1 * 60_000),         // 1 min
  jobPredictionsMs: Number(process.env['JOB_PREDICTIONS_MS'] || 30 * 60_000),            // 30 min
  jobExpireWatchlistMs: Number(process.env['JOB_EXPIRE_WATCHLIST_MS'] || 5 * 60_000),    // 5 min
  jobCheckLiveMs: Number(process.env['JOB_CHECK_LIVE_MS'] || 1 * 60_000),                // 1 min
  jobAutoSettleMs: Number(process.env['JOB_AUTO_SETTLE_MS'] || 10 * 60_000),              // 10 min
  jobEnrichWatchlistMs: Number(process.env['JOB_ENRICH_WATCHLIST_MS'] || 60 * 60_000),   // 60 min
  jobHousekeepingMs: Number(process.env['JOB_HOUSEKEEPING_MS'] || process.env['JOB_AUDIT_PURGE_MS'] || 24 * 60 * 60_000), // 24h
  jobIntegrationHealthMs: Number(process.env['JOB_INTEGRATION_HEALTH_MS'] || 30 * 60_000), // 30 min
  jobHealthWatchdogMs: Number(process.env['JOB_HEALTH_WATCHDOG_MS'] || 2 * 60_000),      // 2 min — health watchdog
  auditKeepDays: Number(process.env['AUDIT_KEEP_DAYS'] || 30),                          // 30 days
  matchesHistoryKeepDays: Number(process.env['MATCHES_HISTORY_KEEP_DAYS'] || 120),
  providerSamplesKeepDays: Number(process.env['PROVIDER_SAMPLES_KEEP_DAYS'] || 14),
  matchSnapshotsKeepDays: Number(process.env['MATCH_SNAPSHOTS_KEEP_DAYS'] || 14),
  oddsMovementsKeepDays: Number(process.env['ODDS_MOVEMENTS_KEEP_DAYS'] || 30),

  // Live match statuses
  liveStatuses: (process.env['LIVE_STATUSES'] || '1H,2H').split(',').map(s => s.trim()),

  // Auto pipeline
  pipelineEnabled: process.env['PIPELINE_ENABLED'] !== 'false',          // auto-trigger AI for live matches
  pipelineBatchSize: Number(process.env['PIPELINE_BATCH_SIZE'] || 3),    // matches per batch
  pipelineTelegramChatId: process.env['PIPELINE_TELEGRAM_CHAT_ID'] || process.env['TELEGRAM_CHAT_ID'] || '',

  // Pipeline AI thresholds (match frontend LiveMonitorConfig defaults)
  pipelineMinConfidence: Number(process.env['PIPELINE_MIN_CONFIDENCE'] || 5),
  pipelineMinOdds: Number(process.env['PIPELINE_MIN_ODDS'] || 1.5),
  pipelineMinMinute: Number(process.env['PIPELINE_MIN_MINUTE'] || 5),
  pipelineMaxMinute: Number(process.env['PIPELINE_MAX_MINUTE'] || 85),
  pipelineSecondHalfStartMinute: Number(process.env['PIPELINE_SECOND_HALF_START_MINUTE'] || 5),
  pipelineReanalyzeMinMinutes: Number(process.env['PIPELINE_REANALYZE_MIN_MINUTES'] || 10),
  pipelineStalenessOddsDelta: Number(process.env['PIPELINE_STALENESS_ODDS_DELTA'] || 0.1),
  pipelineLatePhaseMinute: Number(process.env['PIPELINE_LATE_PHASE_MINUTE'] || 75),
  pipelineVeryLatePhaseMinute: Number(process.env['PIPELINE_VERY_LATE_PHASE_MINUTE'] || 85),
  pipelineEndgameMinute: Number(process.env['PIPELINE_ENDGAME_MINUTE'] || 88),

  // Provider sampling / observability
  providerSamplingEnabled: process.env['PROVIDER_SAMPLING_ENABLED'] !== 'false',

  // Prompt shadow rollout
  liveAnalysisActivePromptVersion: process.env['LIVE_ANALYSIS_ACTIVE_PROMPT_VERSION'] || '',
  liveAnalysisShadowPromptVersion: process.env['LIVE_ANALYSIS_SHADOW_PROMPT_VERSION'] || '',
  liveAnalysisShadowEnabled: process.env['LIVE_ANALYSIS_SHADOW_ENABLED'] === 'true',
  liveAnalysisShadowSampleRate: Number(process.env['LIVE_ANALYSIS_SHADOW_SAMPLE_RATE'] || 0),
  promptShadowKeepDays: Number(process.env['PROMPT_SHADOW_KEEP_DAYS'] || 14),
} as const;
