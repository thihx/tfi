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

  // Telegram
  telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'] || '',

  // Redis
  redisUrl: process.env['REDIS_URL'] || '',

  // Timezone
  timezone: process.env['TIMEZONE'] || 'Asia/Seoul',

  // Job intervals (ms) — 0 = disabled
  jobFetchMatchesMs: Number(process.env['JOB_FETCH_MATCHES_MS'] || 1 * 60_000),         // 1 min
  jobPredictionsMs: Number(process.env['JOB_PREDICTIONS_MS'] || 30 * 60_000),            // 30 min
  jobExpireWatchlistMs: Number(process.env['JOB_EXPIRE_WATCHLIST_MS'] || 5 * 60_000),    // 5 min
  jobCheckLiveMs: Number(process.env['JOB_CHECK_LIVE_MS'] || 5 * 60_000),                // 5 min
  jobAutoSettleMs: Number(process.env['JOB_AUTO_SETTLE_MS'] || 10 * 60_000),              // 10 min

  // Live match statuses
  liveStatuses: (process.env['LIVE_STATUSES'] || '1H,2H').split(','),
} as const;
