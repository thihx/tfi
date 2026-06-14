import { config } from '../config.js';
import { reportJobProgress } from './job-progress.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { formatOperationalTimestamp } from '../lib/time.js';
import { buildTelegramRecommendationMessage, type TelegramNotificationLanguage } from '../lib/telegram-recommendation-message.js';
import { markRecommendationNotified } from '../repos/recommendations.repo.js';
import {
  getPendingCriticalFallbackDeliveries,
  getPendingTelegramDeliveries,
  markDeliveryRowsFailed,
  markDeliveryRowsDelivered,
  markDeliveryRowsSuppressed,
  markRecommendationDeliveriesDelivered,
  type PendingTelegramDeliveryRow,
  type PendingCriticalFallbackDeliveryRow,
} from '../repos/recommendation-deliveries.repo.js';
import { getNativePushDevicesByUserId, deleteNativePushDeviceByToken } from '../repos/native-push-devices.repo.js';
import { sendFcmNotification } from '../lib/native-push.js';
import { sendSmsNotification, sendVoiceNotification } from '../lib/twilio.js';
import { evaluateCriticalFallbackPolicy } from '../lib/critical-fallback-policy.js';

const DEFAULT_BATCH_LIMIT = 20;
const DELIVERY_CONCURRENCY = 3;

function chunkMessage(text: string, maxLen = 3500): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNotificationLanguage(value: unknown): TelegramNotificationLanguage {
  return value === 'en' || value === 'both' || value === 'vi' ? value : 'vi';
}

function buildTelegramDeliveryMessage(row: PendingTelegramDeliveryRow): string {
  const metadata = row.metadata;
  const selection = row.recommendationSelection ?? '';
  const isCondition = row.recommendationBetType === 'CONDITION_ONLY'
    || toStringValue(metadata.delivery_kind) === 'condition_only';
  const matchDisplay = `${row.recommendationHomeTeam ?? 'Unknown'} vs ${row.recommendationAwayTeam ?? 'Unknown'}`;
  const minute = row.recommendationMinute ?? toNumber(metadata.recommendation_minute) ?? '?';
  const score = row.recommendationScore ?? (toStringValue(metadata.recommendation_score) || '?-?');
  const status = row.recommendationStatus ?? (toStringValue(metadata.recommendation_status) || 'LIVE');
  const model = row.recommendationAiModel ?? toStringValue(metadata.recommendation_ai_model);
  const mode = row.recommendationMode ?? toStringValue(metadata.recommendation_mode);
  const conditionText = toStringValue(metadata.custom_condition_text);
  const matchedSummary = toStringValue(metadata.condition_evaluation_summary)
    || toStringValue(metadata.custom_condition_summary_vi)
    || toStringValue(metadata.custom_condition_summary_en)
    || toStringValue(metadata.custom_condition_reason_vi)
    || toStringValue(metadata.custom_condition_reason_en);
  const confidence = row.recommendationConfidence ?? toNumber(metadata.recommendation_confidence) ?? 0;
  const stake = row.recommendationStakePercent ?? toNumber(metadata.recommendation_stake_percent) ?? 0;
  const stakeAmount = row.recommendationStakeAmount ?? toNumber(metadata.stake_amount);
  const bankrollBalance = row.bankrollBalanceBefore ?? toNumber(metadata.bankroll_balance_before);
  const bankrollBalanceAfter = row.bankrollBalanceAfter ?? toNumber(metadata.bankroll_balance_after);
  const bankrollCurrency = row.bankrollCurrency ?? toStringValue(metadata.bankroll_currency);
  const bankrollUnitMultiplier = row.bankrollUnitMultiplier ?? toNumber(metadata.bankroll_unit_multiplier);
  const odds = row.recommendationOdds ?? toNumber(metadata.recommendation_odds);
  const valuePercent = row.recommendationValuePercent ?? toNumber(metadata.recommendation_value_percent);
  const riskLevel = row.recommendationRiskLevel ?? toStringValue(metadata.recommendation_risk_level);
  const warningsRaw = row.recommendationWarnings ?? toStringValue(metadata.recommendation_warnings);
  const warnings = warningsRaw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  const language = normalizeNotificationLanguage(
    row.notificationLanguage
    ?? metadata.notification_language
    ?? metadata.notificationLanguage,
  );
  const now = formatOperationalTimestamp();
  return buildTelegramRecommendationMessage({
    kind: isCondition ? 'condition' : 'recommendation',
    matchDisplay,
    league: row.recommendationLeague,
    minute,
    score,
    status,
    model: model || 'AI',
    mode: mode || 'B',
    selection,
    betMarket: row.recommendationBetMarket,
    odds,
    confidence,
    stakePercent: stake,
    stakeAmount,
    bankrollBalance,
    bankrollBalanceAfter,
    bankrollCurrency,
    bankrollUnitMultiplier,
    riskLevel,
    valuePercent,
    reasoningEn: row.recommendationReasoning || toStringValue(metadata.recommendation_reasoning),
    reasoningVi: row.recommendationReasoningVi || toStringValue(metadata.recommendation_reasoning_vi),
    warnings: warnings.join(', '),
    conditionText,
    conditionSummaryEn: toStringValue(metadata.custom_condition_summary_en) || toStringValue(metadata.custom_condition_reason_en) || matchedSummary,
    conditionSummaryVi: toStringValue(metadata.custom_condition_summary_vi) || toStringValue(metadata.custom_condition_reason_vi) || matchedSummary,
    timestampLabel: now,
    language,
  });
}

function buildCriticalFallbackText(row: PendingCriticalFallbackDeliveryRow): string {
  const metadata = row.metadata;
  const matchDisplay = `${row.recommendationHomeTeam ?? 'Unknown'} vs ${row.recommendationAwayTeam ?? 'Unknown'}`;
  const selection = (row.recommendationSelection ?? toStringValue(metadata.recommendation_selection)) || 'Alert';
  const odds = row.recommendationOdds ?? toNumber(metadata.recommendation_odds);
  const confidence = row.recommendationConfidence ?? toNumber(metadata.recommendation_confidence);
  const minute = row.recommendationMinute ?? toNumber(metadata.recommendation_minute);
  const score = row.recommendationScore ?? toStringValue(metadata.recommendation_score);
  const details = [
    minute == null ? '' : `${minute}'`,
    score,
    odds == null ? '' : `odds ${odds}`,
    confidence == null ? '' : `conf ${confidence}/10`,
  ].filter(Boolean).join(' | ');
  return ['TFI CRITICAL ALERT', matchDisplay, selection, details].filter(Boolean).join('\n');
}

async function deliverNativeRecommendationRows(limit = 20): Promise<{ pending: number; delivered: number; failed: number }> {
  const rows = await getPendingCriticalFallbackDeliveries('native_push', limit);
  if (rows.length === 0) return { pending: 0, delivered: 0, failed: 0 };

  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    const devices = (await getNativePushDevicesByUserId(row.userId)).filter((device) => device.provider === 'fcm');
    if (devices.length === 0) {
      await markDeliveryRowsFailed([row.deliveryId], 'native_push', 'No FCM native push device registered').catch(() => undefined);
      failed += 1;
      continue;
    }

    const body = buildCriticalFallbackText(row);
    let deliveredToAny = false;
    let lastError = '';
    for (const device of devices) {
      const result = await sendFcmNotification(device.token, {
        title: 'TFI CRITICAL ALERT',
        body,
        data: {
          channelType: 'native_push',
          matchId: row.matchId,
          deliveryId: row.deliveryId,
          recommendationId: row.recommendationId,
          tab: 'matches',
          url: `/?tab=matches&match=${encodeURIComponent(row.matchId)}`,
        },
      });
      if (result.ok) {
        deliveredToAny = true;
      } else {
        lastError = result.error;
        if (result.gone) {
          await deleteNativePushDeviceByToken(device.provider, device.token).catch(() => undefined);
        }
      }
    }

    if (deliveredToAny) {
      await markDeliveryRowsDelivered([row.deliveryId], 'native_push').catch(() => undefined);
      if (row.recommendationId != null) {
        await markRecommendationNotified(row.recommendationId, 'native_push').catch(() => undefined);
      }
      delivered += 1;
    } else {
      await markDeliveryRowsFailed([row.deliveryId], 'native_push', lastError || 'Native push delivery failed').catch(() => undefined);
      failed += 1;
    }
  }
  return { pending: rows.length, delivered, failed };
}

async function deliverTwilioRecommendationRows(
  channel: 'sms' | 'voice_call',
  limit = 20,
): Promise<{ pending: number; delivered: number; failed: number }> {
  const rows = await getPendingCriticalFallbackDeliveries(channel, limit);
  if (rows.length === 0) return { pending: 0, delivered: 0, failed: 0 };

  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    const policy = await evaluateCriticalFallbackPolicy(channel, row.userId, row.address);
    if (!policy.allowed) {
      await markDeliveryRowsSuppressed([row.deliveryId], channel, policy.reason || 'Critical fallback policy blocked delivery').catch(() => undefined);
      failed += 1;
      continue;
    }

    if (!row.address) {
      await markDeliveryRowsFailed([row.deliveryId], channel, 'No destination address').catch(() => undefined);
      failed += 1;
      continue;
    }
    const message = buildCriticalFallbackText(row);
    const result = channel === 'sms'
      ? await sendSmsNotification(row.address, message)
      : await sendVoiceNotification(row.address, message);
    if (result.ok) {
      await markDeliveryRowsDelivered([row.deliveryId], channel).catch(() => undefined);
      if (row.recommendationId != null) {
        await markRecommendationNotified(row.recommendationId, channel).catch(() => undefined);
      }
      delivered += 1;
    } else {
      await markDeliveryRowsFailed([row.deliveryId], channel, result.error).catch(() => undefined);
      failed += 1;
    }
  }
  return { pending: rows.length, delivered, failed };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    await Promise.all(chunk.map((item) => worker(item)));
  }
}

export async function deliverTelegramNotificationsJob(): Promise<{
  pending: number;
  delivered: number;
  failed: number;
  nativePushDelivered: number;
  nativePushFailed: number;
  smsDelivered: number;
  smsFailed: number;
  voiceCallDelivered: number;
  voiceCallFailed: number;
}> {
  const jobName = 'deliver-telegram-notifications';
  await reportJobProgress(jobName, 'load', 'Loading pending Telegram deliveries...', 10);

  const pendingRows = config.telegramBotToken
    ? await getPendingTelegramDeliveries(DEFAULT_BATCH_LIMIT)
    : [];

  let delivered = 0;
  let failed = 0;

  if (pendingRows.length > 0) {
    await reportJobProgress(jobName, 'send', `Sending ${pendingRows.length} Telegram deliveries...`, 45);
    await runWithConcurrency(pendingRows, DELIVERY_CONCURRENCY, async (row) => {
      try {
        const message = buildTelegramDeliveryMessage(row);
        for (const chunk of chunkMessage(message)) {
          await sendTelegramMessage(row.chatId, chunk);
        }

        if (row.recommendationId != null) {
          await markRecommendationDeliveriesDelivered(row.recommendationId, [row.userId], 'telegram').catch(() => undefined);
          await markRecommendationNotified(row.recommendationId, 'telegram').catch(() => undefined);
        } else {
          await markDeliveryRowsDelivered([row.deliveryId], 'telegram').catch(() => undefined);
        }

        delivered += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await markDeliveryRowsFailed([row.deliveryId], 'telegram', message).catch(() => undefined);
        console.error(
          `[deliver-telegram-notifications] Failed delivery ${row.deliveryId} for ${row.matchId}:`,
          message,
        );
      }
    });
  }

  const [nativePush, sms, voiceCall] = await Promise.all([
    deliverNativeRecommendationRows(DEFAULT_BATCH_LIMIT),
    deliverTwilioRecommendationRows('sms', DEFAULT_BATCH_LIMIT),
    deliverTwilioRecommendationRows('voice_call', DEFAULT_BATCH_LIMIT),
  ]);

  await reportJobProgress(
    jobName,
    'done',
    `Processed ${pendingRows.length} Telegram deliveries and critical fallback channels`,
    100,
  );

  return {
    pending: pendingRows.length,
    delivered,
    failed,
    nativePushDelivered: nativePush.delivered,
    nativePushFailed: nativePush.failed,
    smsDelivered: sms.delivered,
    smsFailed: sms.failed,
    voiceCallDelivered: voiceCall.delivered,
    voiceCallFailed: voiceCall.failed,
  };
}


