import { config } from '../config.js';
import { reportJobProgress } from './job-progress.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { formatOperationalTimestamp } from '../lib/time.js';
import { markRecommendationNotified } from '../repos/recommendations.repo.js';
import {
  getPendingTelegramDeliveries,
  markDeliveryRowsDelivered,
  markRecommendationDeliveriesDelivered,
  type PendingTelegramDeliveryRow,
} from '../repos/recommendation-deliveries.repo.js';

const DEFAULT_BATCH_LIMIT = 20;
const DELIVERY_CONCURRENCY = 3;

function safeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

function buildTelegramDeliveryMessage(row: PendingTelegramDeliveryRow): string {
  const metadata = row.metadata;
  const selection = row.recommendationSelection ?? '';
  const isCondition = row.recommendationBetType === 'CONDITION_ONLY'
    || toStringValue(metadata.delivery_kind) === 'condition_only';
  const label = isCondition ? 'CONDITION TRIGGERED' : 'AI RECOMMENDATION';
  const prefix = isCondition ? 'ALERT' : 'PICK';
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
  const odds = row.recommendationOdds ?? toNumber(metadata.recommendation_odds);
  const valuePercent = row.recommendationValuePercent ?? toNumber(metadata.recommendation_value_percent);
  const riskLevel = row.recommendationRiskLevel ?? toStringValue(metadata.recommendation_risk_level);
  const reasoning = row.recommendationReasoningVi
    || row.recommendationReasoning
    || toStringValue(metadata.recommendation_reasoning_vi)
    || toStringValue(metadata.recommendation_reasoning);
  const warningsRaw = row.recommendationWarnings ?? toStringValue(metadata.recommendation_warnings);
  const warnings = warningsRaw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

  let text = `<b>${prefix} ${label}</b>\n`;
  text += `<b>${safeHtml(matchDisplay)}</b>\n`;
  if (row.recommendationLeague) text += `${safeHtml(row.recommendationLeague)}\n`;
  text += `Minute ${safeHtml(String(minute))}' | Score ${safeHtml(score)} | ${safeHtml(status)}\n`;
  if (model || mode) {
    text += `AI ${safeHtml(model || 'AI')} | Mode: ${safeHtml(mode || 'B')}\n`;
  }
  if (isCondition && conditionText) {
    text += `\n<b>Condition:</b> ${safeHtml(conditionText)}\n`;
  }
  if (selection) {
    const selectionWithOdds = odds != null && !selection.includes('@')
      ? `${selection} @${odds}`
      : selection;
    text += `\n<b>${safeHtml(selectionWithOdds)}</b>\n`;
  }
  if (selection && !/^no bet\b/i.test(selection)) {
    const tail = [
      `Confidence: ${confidence}/10`,
      `Stake: ${stake}%`,
      !isCondition && riskLevel ? `Risk: ${safeHtml(riskLevel)}` : null,
      !isCondition && valuePercent != null ? `Value: ${valuePercent}%` : null,
    ].filter(Boolean).join(' | ');
    if (tail) text += `${tail}\n`;
  }
  if (isCondition && matchedSummary) {
    text += `Matched: ${safeHtml(matchedSummary)}\n`;
  }
  if (reasoning) {
    text += `\n${safeHtml(reasoning)}\n`;
  }
  if (warnings.length > 0) {
    text += `\nWarnings: ${safeHtml(warnings.join(' | '))}\n`;
  }
  const now = formatOperationalTimestamp();
  text += `\n<i>Async Delivery | ${safeHtml(now)}</i>`;
  return text;
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
}> {
  const jobName = 'deliver-telegram-notifications';
  await reportJobProgress(jobName, 'load', 'Loading pending Telegram deliveries...', 10);

  if (!config.telegramBotToken) {
    return { pending: 0, delivered: 0, failed: 0 };
  }

  const pendingRows = await getPendingTelegramDeliveries(DEFAULT_BATCH_LIMIT);
  if (pendingRows.length === 0) {
    return { pending: 0, delivered: 0, failed: 0 };
  }

  let delivered = 0;
  let failed = 0;

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
      console.error(
        `[deliver-telegram-notifications] Failed delivery ${row.deliveryId} for ${row.matchId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  await reportJobProgress(
    jobName,
    'done',
    `Processed ${pendingRows.length} pending Telegram deliveries: ${delivered} delivered, ${failed} failed`,
    100,
  );

  return {
    pending: pendingRows.length,
    delivered,
    failed,
  };
}
