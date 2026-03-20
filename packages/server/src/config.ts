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

  // Telegram
  telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'] || '',

  // The Odds API (fallback odds)
  theOddsApiKey: process.env['THE_ODDS_API_KEY'] || '',
  theOddsApiBaseUrl: process.env['THE_ODDS_API_BASE_URL'] || 'https://api.the-odds-api.com/v4',

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
  jwtSecret: process.env['JWT_SECRET'] || 'tfi-dev-secret-change-me',
  jwtExpiresInSeconds: Number(process.env['JWT_EXPIRES_IN_SECONDS'] || 604800), // 7 days

  // Job intervals (ms) — 0 = disabled
  jobFetchMatchesMs: Number(process.env['JOB_FETCH_MATCHES_MS'] || 1 * 60_000),         // 1 min
  jobPredictionsMs: Number(process.env['JOB_PREDICTIONS_MS'] || 30 * 60_000),            // 30 min
  jobExpireWatchlistMs: Number(process.env['JOB_EXPIRE_WATCHLIST_MS'] || 5 * 60_000),    // 5 min
  jobCheckLiveMs: Number(process.env['JOB_CHECK_LIVE_MS'] || 5 * 60_000),                // 5 min
  jobAutoSettleMs: Number(process.env['JOB_AUTO_SETTLE_MS'] || 10 * 60_000),              // 10 min
  jobEnrichWatchlistMs: Number(process.env['JOB_ENRICH_WATCHLIST_MS'] || 60 * 60_000),   // 60 min
  jobAuditPurgeMs: Number(process.env['JOB_AUDIT_PURGE_MS'] || 24 * 60 * 60_000),      // 24h
  jobIntegrationHealthMs: Number(process.env['JOB_INTEGRATION_HEALTH_MS'] || 30 * 60_000), // 30 min
  jobHealthWatchdogMs: Number(process.env['JOB_HEALTH_WATCHDOG_MS'] || 2 * 60_000),      // 2 min — giám sát job nghiệp vụ
  auditKeepDays: Number(process.env['AUDIT_KEEP_DAYS'] || 30),                          // 30 days

  // Live match statuses
  liveStatuses: (process.env['LIVE_STATUSES'] || '1H,2H').split(',').map(s => s.trim()),

  // Auto pipeline
  pipelineEnabled: process.env['PIPELINE_ENABLED'] !== 'false',          // auto-trigger AI for live matches
  pipelineBatchSize: Number(process.env['PIPELINE_BATCH_SIZE'] || 3),    // matches per batch
  pipelineTelegramChatId: process.env['PIPELINE_TELEGRAM_CHAT_ID'] || process.env['TELEGRAM_CHAT_ID'] || '',

  // Pipeline AI thresholds (match frontend LiveMonitorConfig defaults)
  pipelineMinConfidence: Number(process.env['PIPELINE_MIN_CONFIDENCE'] || 5),
  pipelineMinOdds: Number(process.env['PIPELINE_MIN_ODDS'] || 1.5),
  pipelineLatePhaseMinute: Number(process.env['PIPELINE_LATE_PHASE_MINUTE'] || 75),
  pipelineVeryLatePhaseMinute: Number(process.env['PIPELINE_VERY_LATE_PHASE_MINUTE'] || 85),
  pipelineEndgameMinute: Number(process.env['PIPELINE_ENDGAME_MINUTE'] || 88),
} as const;
