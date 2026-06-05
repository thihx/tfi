import { config } from '../config.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { formatOperationalTimestamp } from '../lib/time.js';
import {
  getPendingTelegramMatchAlertDeliveries,
  markMatchAlertChannelDelivered,
  markMatchAlertChannelFailed,
  type PendingTelegramMatchAlertRow,
} from '../repos/match-alert-deliveries.repo.js';
import { reportJobProgress } from './job-progress.js';

const DEFAULT_BATCH_LIMIT = 20;
const DELIVERY_CONCURRENCY = 3;

function safeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function localized(
  language: 'vi' | 'en' | 'both',
  en: string,
  vi: string,
): string {
  if (language === 'en') return en;
  if (language === 'both') return `${en} / ${vi}`;
  return vi;
}

function buildTelegramMatchAlertMessage(row: PendingTelegramMatchAlertRow): string {
  const matchDisplay = asString(row.metadata.matchDisplay) || row.matchId;
  const league = asString(row.metadata.league);
  const score = asString(row.metadata.score);
  const status = asString(row.metadata.status);
  const minute = row.metadata.minute == null ? '' : String(row.metadata.minute);
  const summary = asString(row.triggerSnapshot.summaryVi)
    || asString(row.triggerSnapshot.summaryEn)
    || localized(row.notificationLanguage, 'Alert condition matched.', 'Điều kiện cảnh báo đã thỏa.');
  const action = asString(row.triggerSnapshot.suggestedAction);
  const heading = row.alertKind === 'match_start'
    ? localized(row.notificationLanguage, 'MATCH STARTED', 'TRẬN ĐẤU BẮT ĐẦU')
    : localized(row.notificationLanguage, 'LIVE SIGNAL', 'TÍN HIỆU LIVE');

  const lines = [
    `<b>${safeHtml(heading)}</b>`,
    `<b>${safeHtml(matchDisplay)}</b>`,
  ];
  if (league) lines.push(safeHtml(league));
  const meta = [
    minute ? `${localized(row.notificationLanguage, 'Minute', 'Phút')} ${safeHtml(minute)}'` : '',
    score ? `${localized(row.notificationLanguage, 'Score', 'Tỷ số')} ${safeHtml(score)}` : '',
    status ? safeHtml(status) : '',
  ].filter(Boolean);
  if (meta.length > 0) lines.push(meta.join(' | '));
  lines.push('');
  lines.push(safeHtml(summary));
  if (action) {
    lines.push(`${localized(row.notificationLanguage, 'Suggested action', 'Hành động gợi ý')}: ${safeHtml(action)}`);
  }
  lines.push('');
  lines.push(`<i>${safeHtml(formatOperationalTimestamp())}</i>`);
  return lines.join('\n');
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

export async function deliverMatchAlertTelegramJob(): Promise<{
  pending: number;
  delivered: number;
  failed: number;
}> {
  const jobName = 'deliver-match-alert-telegram';
  await reportJobProgress(jobName, 'load', 'Loading pending match alert Telegram deliveries...', 10);

  if (!config.telegramBotToken) {
    return { pending: 0, delivered: 0, failed: 0 };
  }

  const pendingRows = await getPendingTelegramMatchAlertDeliveries(DEFAULT_BATCH_LIMIT);
  if (pendingRows.length === 0) {
    return { pending: 0, delivered: 0, failed: 0 };
  }

  let delivered = 0;
  let failed = 0;

  await reportJobProgress(jobName, 'send', `Sending ${pendingRows.length} match alert Telegram deliveries...`, 50);
  await runWithConcurrency(pendingRows, DELIVERY_CONCURRENCY, async (row) => {
    try {
      await sendTelegramMessage(row.chatId, buildTelegramMatchAlertMessage(row));
      await markMatchAlertChannelDelivered(row.channelId);
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markMatchAlertChannelFailed(row.channelId, message).catch(() => undefined);
      failed += 1;
      console.error(`[deliver-match-alert-telegram] Failed delivery ${row.deliveryId} for ${row.matchId}:`, message);
    }
  });

  await reportJobProgress(
    jobName,
    'done',
    `Processed ${pendingRows.length} match alert Telegram deliveries: ${delivered} delivered, ${failed} failed`,
    100,
  );

  return { pending: pendingRows.length, delivered, failed };
}
