// ============================================================
// Job: Health Watchdog
//
// Runs every 2 min. Monitors critical business jobs to ensure
// they execute on schedule. Sends Telegram alert when a job
// becomes overdue and notifies again when it recovers.
// ============================================================

import { getJobsStatus, getSchedulerUptime } from './scheduler.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { getRedisClient } from '../lib/redis.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { reportJobProgress } from './job-progress.js';
import { loadOperationalTelegramSettings } from '../lib/telegram-runtime.js';

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
// (only applies when the job is NOT currently running)
const OVERDUE_FACTOR = 2.5;

// How many multiples of a job's interval before a RUNNING job is considered stuck
const STUCK_FACTOR = 10;

// Don't start alerting until scheduler has been up for at least this long (ms).
// This prevents false alarms right after a container restart.
const STARTUP_GRACE_MS = 3 * 60_000; // 3 minutes

// Cooldown between repeated alerts for the same job (ms)
const ALERT_COOLDOWN_MS = 30 * 60_000; // 30 minutes

// Redis keys
const alertStateKey = (jobName: string) => `watchdog:alert:${jobName}`;

/**
 * In-memory cooldown fallback — prevents alert spam when Redis is unavailable
 * and the Redis-backed AlertState cannot be read/written.
 * Keyed by job name, value is the timestamp of the last alert sent.
 */
const inMemoryCooldown = new Map<string, number>();

/** Exported for testing only — resets in-memory state between test runs. */
export function _resetCooldownForTesting(): void {
  inMemoryCooldown.clear();
}

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

export async function healthWatchdogJob(): Promise<WatchdogResult> {
  const JOB = 'health-watchdog';
  await reportJobProgress(JOB, 'check', 'Checking job health...', 10);

  const uptimeMs = getSchedulerUptime();
  if (uptimeMs < STARTUP_GRACE_MS) {
    return { checked: 0, overdueJobs: [], alerted: 0, recovered: [] };
  }

  const allJobs = await getJobsStatus();
  const now = Date.now();
  const telegram = await loadOperationalTelegramSettings().catch(() => ({ chatId: '', enabled: false }));

  const overdueJobs: string[] = [];
  const recovered: string[] = [];
  let alerted = 0;
  let checked = 0;

  for (const job of allJobs) {
    if (!CRITICAL_JOBS.has(job.name) || !job.enabled) continue;
    checked++;

    const overdueThresholdMs = job.intervalMs * OVERDUE_FACTOR;
    const stuckThresholdMs = job.intervalMs * STUCK_FACTOR;
    const lastRunTs = job.lastRun ? new Date(job.lastRun).getTime() : 0;
    const timeSinceLastRun = lastRunTs > 0 ? now - lastRunTs : Infinity;
    // Only "overdue" if NOT currently running — a running job is just slow, not missed
    let isOverdue = !job.running && timeSinceLastRun > overdueThresholdMs;
    const isStuck = job.running && timeSinceLastRun > stuckThresholdMs;

    // If the job has an adaptive skip key, check whether it is intentionally sleeping.
    // A job sleeping due to adaptive polling is NOT overdue — it is working as designed.
    if (isOverdue && job.skipKey) {
      try {
        const redis = getRedisClient();
        const nextRunAt = await redis.get(job.skipKey);
        if (nextRunAt && now < Number(nextRunAt)) {
          isOverdue = false; // intentional sleep — suppress alert
        }
      } catch {
        // Redis unavailable — cannot confirm skip, leave isOverdue as-is
      }
    }

    const prevAlert = await getAlertState(job.name);

    if (isOverdue || isStuck) {
      overdueJobs.push(job.name);

      // Cooldown: prefer Redis-backed state; fall back to in-memory map so we
      // never spam even when Redis is down.
      const redisLastAlerted = prevAlert ? new Date(prevAlert.lastAlertedAt).getTime() : 0;
      const memLastAlerted = inMemoryCooldown.get(job.name) ?? 0;
      const lastAlertedAt = Math.max(redisLastAlerted, memLastAlerted);
      const cooledDown = lastAlertedAt === 0 || (now - lastAlertedAt > ALERT_COOLDOWN_MS);

      if (cooledDown) {
        if (telegram.enabled && telegram.chatId && config.telegramBotToken) {
          const timeAgo = lastRunTs > 0 ? formatDuration(timeSinceLastRun) : 'never run';
          const expectedInterval = formatDuration(job.intervalMs);
          const lastErr = job.lastError ? `\n<b>Last error:</b> ${escapeHtml(job.lastError.substring(0, 200))}` : '';
          const consecutive = (prevAlert?.consecutiveOverdue ?? 0) + 1;
          const statusLabel = isStuck ? 'Job stuck (running too long)' : 'Job overdue';
          const statusEmoji = isStuck ? '🔄' : '⚠️';

          const msg = [
            `${statusEmoji} <b>[TFI] ${escapeHtml(statusLabel)}: ${escapeHtml(job.name)}</b>`,
            ``,
            `<b>Configured interval:</b> ${expectedInterval}`,
            `<b>Last completed:</b> ${timeAgo} ago`,
            isStuck ? `<b>Status:</b> Currently running (possible hang)` : `<b>Consecutive overdue:</b> ${consecutive}x`,
            lastErr,
            ``,
            `→ Check <b>Settings → Jobs</b> for details.`,
          ].filter(Boolean).join('\n');

          try {
            await sendTelegramMessage(telegram.chatId, msg);
            alerted++;
          } catch (err) {
            console.error(`[watchdog] Failed to send alert for ${job.name}:`, err);
          }

          // Update both Redis state and in-memory fallback
          inMemoryCooldown.set(job.name, now);
          await setAlertState(job.name, {
            lastAlertedAt: new Date().toISOString(),
            consecutiveOverdue: consecutive,
          });

          audit({
            category: 'WATCHDOG',
            action: isStuck ? 'JOB_STUCK_ALERT' : 'JOB_OVERDUE_ALERT',
            outcome: 'FAILURE',
            actor: 'watchdog',
            metadata: {
              jobName: job.name,
              intervalMs: job.intervalMs,
              timeSinceLastRunMs: timeSinceLastRun === Infinity ? null : timeSinceLastRun,
              lastRun: job.lastRun,
              lastError: job.lastError,
              running: job.running,
              consecutiveOverdue: (prevAlert?.consecutiveOverdue ?? 0) + 1,
            },
          });
        }
      }
    } else if (prevAlert || inMemoryCooldown.has(job.name)) {
      // Job recovered — was overdue before, now running normally
      recovered.push(job.name);
      inMemoryCooldown.delete(job.name);
      await clearAlertState(job.name);

      if (telegram.enabled && telegram.chatId && config.telegramBotToken) {
        const msg = [
          `✅ <b>[TFI] Job khôi phục: ${escapeHtml(job.name)}</b>`,
          ``,
          `Job đã hoạt động trở lại bình thường.`,
          `<b>Lần chạy cuối:</b> ${job.lastRun}`,
        ].join('\n');

        try {
          await sendTelegramMessage(telegram.chatId, msg);
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
