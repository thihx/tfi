// ============================================================
// Job: Integration Health Check
//
// Runs on schedule, probes all external services, and sends
// Telegram alerts when a service status changes:
//   HEALTHY → DOWN/DEGRADED  → alert immediately
//   DOWN/DEGRADED → HEALTHY  → alert (recovery)
//   Repeated DOWN            → cooldown 4h to prevent spam
// ============================================================

import { checkAllIntegrations, type IntegrationStatus, type IntegrationProbeResult } from '../lib/integration-health.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { getRedisClient } from '../lib/redis.js';
import { config } from '../config.js';
import { loadOperationalTelegramSettings } from '../lib/telegram-runtime.js';
import { formatOperationalDateTime } from '../lib/time.js';
import { reportJobProgress } from './job-progress.js';

const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours between repeat alerts for same service
const STATE_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

interface PersistedServiceState {
  status: IntegrationStatus;
  updatedAt: string;
  alertedAt?: string; // ISO — last time we sent an alert for this service
}

function redisKey(serviceId: string): string {
  // Key prefix 'tfi:' added by ioredis keyPrefix option
  return `integration:health:${serviceId}`;
}

async function loadState(serviceId: string): Promise<PersistedServiceState | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(redisKey(serviceId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveState(serviceId: string, state: PersistedServiceState): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(redisKey(serviceId), JSON.stringify(state), 'EX', STATE_TTL_SEC);
  } catch {
    // ignore — state loss means next run just re-alerts, which is acceptable
  }
}

/** Escape special HTML chars so error messages don't break Telegram HTML parse mode */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildTelegramMessage(probe: IntegrationProbeResult, previousStatus: IntegrationStatus | null): string {
  const now = formatOperationalDateTime(new Date());
  const safeMessage = probe.message ? escapeHtml(probe.message) : '';

  if (probe.status === 'HEALTHY') {
    const prev = previousStatus ? ` (trước: ${previousStatus})` : '';
    return [
      `✅ <b>[TFI] Khôi phục: ${escapeHtml(probe.label)}</b>`,
      ``,
      `Dịch vụ đã hoạt động trở lại${prev}.`,
      safeMessage ? `ℹ️ ${safeMessage}` : '',
      `⏱ Latency: ${probe.latencyMs}ms`,
      `🕐 ${now}`,
    ].filter(Boolean).join('\n');
  }

  const icon = probe.status === 'DOWN' ? '🔴' : '🟡';
  const level = probe.status === 'DOWN' ? 'DOWN — Ngừng hoạt động' : 'DEGRADED — Suy giảm hiệu suất';

  return [
    `${icon} <b>[TFI] ${escapeHtml(probe.label)}: ${level}</b>`,
    ``,
    `<b>Mô tả:</b> ${escapeHtml(probe.description)}`,
    safeMessage ? `<b>Lỗi:</b> ${safeMessage}` : '',
    `<b>Latency:</b> ${probe.latencyMs > 0 ? `${probe.latencyMs}ms` : 'N/A'}`,
    `🕐 ${now}`,
    ``,
    `→ Kiểm tra Settings &gt; Integration Health để biết thêm chi tiết.`,
  ].filter(Boolean).join('\n');
}

/** Returns true if message was actually sent */
async function notifyTelegram(probe: IntegrationProbeResult, previousStatus: IntegrationStatus | null): Promise<boolean> {
  const telegram = await loadOperationalTelegramSettings();
  if (!telegram.enabled || !telegram.chatId || !config.telegramBotToken) return false;

  const text = buildTelegramMessage(probe, previousStatus);
  try {
    await sendTelegramMessage(telegram.chatId, text);
    console.log(`[integration-health] Telegram sent for ${probe.id}: ${probe.status}`);
    return true;
  } catch (err) {
    console.error(`[integration-health] Telegram failed for ${probe.id}:`, err);
    return false;
  }
}

// ── Main job function ─────────────────────────────────────────

export async function integrationHealthJob(): Promise<{
  overall: IntegrationStatus;
  checked: number;
  alerted: number;
  transitioned: string[];
}> {
  await reportJobProgress('integration-health', 'probing', 'Probing all services...', 10);

  const snapshot = await checkAllIntegrations();

  await reportJobProgress('integration-health', 'evaluating', 'Evaluating status changes...', 60);

  const transitioned: string[] = [];
  let alerted = 0;

  // Load all previous states in parallel
  const activeProbes = snapshot.services.filter((s) => s.status !== 'NOT_CONFIGURED');
  const prevStates = await Promise.all(activeProbes.map((p) => loadState(p.id)));

  const savePromises: Promise<void>[] = [];

  for (let i = 0; i < activeProbes.length; i++) {
    const probe = activeProbes[i]!;
    const prev = prevStates[i];
    const prevStatus = prev?.status ?? null;

    const statusChanged = prevStatus !== probe.status;
    const isAlert = probe.status === 'DOWN' || probe.status === 'DEGRADED';
    const isRecovery = probe.status === 'HEALTHY' && (prevStatus === 'DOWN' || prevStatus === 'DEGRADED');

    const now = Date.now();
    const lastAlerted = prev?.alertedAt ? new Date(prev.alertedAt).getTime() : 0;
    const cooledDown = now - lastAlerted > COOLDOWN_MS;

    let shouldAlert = false;
    if (isRecovery) {
      shouldAlert = true;
    } else if (isAlert && (statusChanged || cooledDown)) {
      shouldAlert = true;
    }

    if (statusChanged) {
      transitioned.push(`${probe.id}: ${prevStatus ?? 'unknown'} → ${probe.status}`);
      console.log(`[integration-health] ${probe.label}: ${prevStatus ?? '?'} → ${probe.status}`);
    }

    let actuallyAlerted = false;
    if (shouldAlert) {
      actuallyAlerted = await notifyTelegram(probe, prevStatus);
      if (actuallyAlerted) alerted++;
    }

    savePromises.push(saveState(probe.id, {
      status: probe.status,
      updatedAt: probe.checkedAt,
      alertedAt: actuallyAlerted ? new Date().toISOString() : prev?.alertedAt,
    }));
  }

  // Persist all states in parallel
  await Promise.all(savePromises);

  await reportJobProgress('integration-health', 'done', `Done. Overall: ${snapshot.overall}`, 100);

  console.log(`[integration-health] overall=${snapshot.overall} | transitioned=${transitioned.length} | alerted=${alerted} | ${snapshot.durationMs}ms`);

  return {
    overall: snapshot.overall,
    checked: snapshot.services.filter((s) => s.status !== 'NOT_CONFIGURED').length,
    alerted,
    transitioned,
  };
}
