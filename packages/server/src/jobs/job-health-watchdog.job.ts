// ============================================================
// Job: Health Watchdog — monitors all scheduled jobs
//
// Runs frequently (every 2 min) to check if critical business
// jobs have executed within their expected interval.
// Sends Telegram alert when a job becomes overdue.
// ============================================================

import { getJobsStatus, getSchedulerUptime } from './scheduler.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { getRedisClient } from '../lib/redis.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { reportJobProgress } from './job-progress.js';

// Jobs considered critical for business operations.
// The watchdog only alerts for these — does NOT alert for itself or utility jobs.
const CRITICAL_JOBS = new Set([
  'fetch-matches',
  'check-live-trigger',
  'auto-settle',
  'expire-watchlist',
  'update-predictions',
  'enrich-watchlist',
]);

// How many multiples of a job's interval must elapse before it's "overdue"
const OVERDUE_FACTOR = 2.5;

// Don't start alerting until scheduler has been up for at least this long (ms).
// This prevents false alarms right after a container restart.
const STARTUP_GRACE_MS = 3 * 60_000; // 3 minutes

// Cooldown between repeated alerts for the same job (ms)
const ALERT_COOLDOWN_MS = 30 * 60_000; // 30 minutes

// Redis keys
const alertStateKey = (jobName: string) => `watchdog:alert:${jobName}`;

interface AlertState {
  lastAlertedAt: string;
  consecutiveOverdue: number;
}

async function getAlertState(jobName: string): Promise<AlertState | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(alertStateKey(jobName));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function setAlertState(jobName: string, state: AlertState): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(alertStateKey(jobName), JSON.stringify(state), 'EX', 24 * 60 * 60);
  } catch {
    // ignore
  }
}

async function clearAlertState(jobName: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(alertStateKey(jobName));
  } catch {
    // ignore
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

export interface WatchdogResult {
  checked: number;
  overdueJobs: string[];
  alerted: number;
  recovered: string[];
}

export async function jobHealthWatchdogJob(): Promise<WatchdogResult> {
  const JOB = 'job-health-watchdog';
  await reportJobProgress(JOB, 'check', 'Checking job health...', 10);

  const uptimeMs = getSchedulerUptime();
  if (uptimeMs < STARTUP_GRACE_MS) {
    return { checked: 0, overdueJobs: [], alerted: 0, recovered: [] };
  }

  const allJobs = await getJobsStatus();
  const now = Date.now();

  const overdueJobs: string[] = [];
  const recovered: string[] = [];
  let alerted = 0;
  let checked = 0;

  for (const job of allJobs) {
    if (!CRITICAL_JOBS.has(job.name) || !job.enabled) continue;
    checked++;

    const overdueThresholdMs = job.intervalMs * OVERDUE_FACTOR;
    const lastRunTs = job.lastRun ? new Date(job.lastRun).getTime() : 0;
    const timeSinceLastRun = lastRunTs > 0 ? now - lastRunTs : Infinity;
    const isOverdue = timeSinceLastRun > overdueThresholdMs;

    const prevAlert = await getAlertState(job.name);

    if (isOverdue) {
      overdueJobs.push(job.name);

      const cooledDown = !prevAlert || (now - new Date(prevAlert.lastAlertedAt).getTime() > ALERT_COOLDOWN_MS);

      if (cooledDown) {
        const chatId = config.pipelineTelegramChatId;
        if (chatId && config.telegramBotToken) {
          const timeAgo = lastRunTs > 0 ? formatDuration(timeSinceLastRun) : 'chưa chạy lần nào';
          const expectedInterval = formatDuration(job.intervalMs);
          const lastErr = job.lastError ? `\n<b>Lỗi cuối:</b> ${escapeHtml(job.lastError.substring(0, 200))}` : '';
          const consecutive = (prevAlert?.consecutiveOverdue ?? 0) + 1;

          const msg = [
            `⚠️ <b>[TFI] Job quá hạn: ${escapeHtml(job.name)}</b>`,
            ``,
            `<b>Interval cấu hình:</b> ${expectedInterval}`,
            `<b>Lần chạy cuối:</b> ${timeAgo} trước`,
            `<b>Quá hạn liên tiếp:</b> ${consecutive} lần`,
            lastErr,
            ``,
            `→ Kiểm tra <b>Settings → Jobs</b> để biết thêm chi tiết.`,
          ].filter(Boolean).join('\n');

          try {
            await sendTelegramMessage(chatId, msg);
            alerted++;
          } catch (err) {
            console.error(`[watchdog] Failed to send alert for ${job.name}:`, err);
          }

          await setAlertState(job.name, {
            lastAlertedAt: new Date().toISOString(),
            consecutiveOverdue: consecutive,
          });

          audit({
            category: 'WATCHDOG',
            action: 'JOB_OVERDUE_ALERT',
            outcome: 'FAILURE',
            actor: 'watchdog',
            metadata: {
              jobName: job.name,
              intervalMs: job.intervalMs,
              timeSinceLastRunMs: timeSinceLastRun === Infinity ? null : timeSinceLastRun,
              lastRun: job.lastRun,
              lastError: job.lastError,
              consecutiveOverdue: (prevAlert?.consecutiveOverdue ?? 0) + 1,
            },
          });
        }
      }
    } else if (prevAlert) {
      // Job recovered — was overdue before, now running normally
      recovered.push(job.name);
      await clearAlertState(job.name);

      const chatId = config.pipelineTelegramChatId;
      if (chatId && config.telegramBotToken) {
        const msg = [
          `✅ <b>[TFI] Job khôi phục: ${escapeHtml(job.name)}</b>`,
          ``,
          `Job đã hoạt động trở lại bình thường.`,
          `<b>Lần chạy cuối:</b> ${job.lastRun}`,
        ].join('\n');

        try {
          await sendTelegramMessage(chatId, msg);
        } catch {
          // ignore
        }
      }

      audit({
        category: 'WATCHDOG',
        action: 'JOB_RECOVERED',
        outcome: 'SUCCESS',
        actor: 'watchdog',
        metadata: { jobName: job.name, lastRun: job.lastRun },
      });
    }
  }

  await reportJobProgress(JOB, 'done', `Checked ${checked} jobs, ${overdueJobs.length} overdue`, 100);

  if (overdueJobs.length > 0) {
    console.warn(`[watchdog] ⚠️ Overdue jobs: ${overdueJobs.join(', ')}`);
  }

  return { checked, overdueJobs, alerted, recovered };
}
