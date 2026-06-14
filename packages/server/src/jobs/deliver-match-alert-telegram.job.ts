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

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isStatsOnlySignal(row: PendingTelegramMatchAlertRow): boolean {
  const facts = jsonObject(row.triggerSnapshot.facts);
  return row.triggerKey.startsWith('stats_only:')
    || row.metadata.noActionableOdds === true
    || row.metadata.signalContractVersion === 'odds-first-stats-only-live-signal-v1'
    || facts.noActionableOdds === true;
}

function isNoSaveMatchInsight(row: PendingTelegramMatchAlertRow): boolean {
  const facts = jsonObject(row.triggerSnapshot.facts);
  return isStatsOnlySignal(row)
    || row.triggerKey.startsWith('insight:')
    || row.metadata.notificationKind === 'match_insight'
    || row.metadata.noActionableBet === true
    || facts.noActionableBet === true
    || row.metadata.signalContractVersion === 'no-save-live-insight-v1';
}

function insightDisclosure(row: PendingTelegramMatchAlertRow, statsOnlySignal: boolean): string {
  if (statsOnlySignal) {
    return localized(row.notificationLanguage, 'No live odds available - stats-only insight.', 'Khong co live odds - chi la nhan dinh tu stats.');
  }
  const insightType = asString(row.metadata.insightType);
  if (insightType === 'policy_blocked') {
    return localized(row.notificationLanguage, 'No actionable bet - policy guard blocked the candidate.', 'Khong co keo actionable - policy guard da chan candidate.');
  }
  if (insightType === 'degraded_evidence') {
    return localized(row.notificationLanguage, 'No actionable bet - limited live evidence.', 'Khong co keo actionable - bang chung live con han che.');
  }
  return localized(row.notificationLanguage, 'No actionable bet - match insight only.', 'Khong co keo actionable - chi la nhan dinh tran dau.');
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
  const statsOnlySignal = isStatsOnlySignal(row);
  const noSaveInsight = isNoSaveMatchInsight(row);
  const baseHeading = row.alertKind === 'match_start'
    ? localized(row.notificationLanguage, 'MATCH STARTED', 'TRẬN ĐẤU BẮT ĐẦU')
    : localized(row.notificationLanguage, 'LIVE SIGNAL', 'TÍN HIỆU LIVE');

  const heading = row.alertKind !== 'match_start' && noSaveInsight
    ? localized(row.notificationLanguage, 'MATCH INSIGHT', 'NHAN DINH TRAN DAU')
    : baseHeading;

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
  if (noSaveInsight) {
    lines.push(safeHtml(insightDisclosure(row, statsOnlySignal)));
    lines.push('');
  }
  lines.push(safeHtml(summary));
  if (action) {
    lines.push(`${localized(row.notificationLanguage, 'Suggested action', 'Hành động gợi ý')}: ${safeHtml(action)}`);
  }
  lines.push('');
  lines.push(`<i>${safeHtml(formatOperationalTimestamp())}</i>`);
  return lines.join('\n');
}

function buildTelegramMatchStartBatchMessage(rows: PendingTelegramMatchAlertRow[]): string {
  const first = rows[0]!;
  const heading = localized(first.notificationLanguage, 'MATCHES STARTED', 'Cac tran dau bat dau');
  const kickoffAtUtc = asString(first.metadata.kickoffAtUtc);
  const lines = [
    `<b>${safeHtml(heading)}</b>`,
  ];
  if (kickoffAtUtc) {
    lines.push(safeHtml(formatOperationalTimestamp(new Date(kickoffAtUtc))));
  }
  lines.push('');

  for (const row of rows) {
    const matchDisplay = asString(row.metadata.matchDisplay) || row.matchId;
    const league = asString(row.metadata.league);
    const score = asString(row.metadata.score);
    const status = asString(row.metadata.status);
    const minute = row.metadata.minute == null ? '' : String(row.metadata.minute);
    const meta = [
      minute ? `${localized(row.notificationLanguage, 'Minute', 'Phut')} ${safeHtml(minute)}'` : '',
      score ? `${localized(row.notificationLanguage, 'Score', 'Ty so')} ${safeHtml(score)}` : '',
      status ? safeHtml(status) : '',
    ].filter(Boolean);
    const suffix = meta.length > 0 ? ` (${meta.join(' | ')})` : '';
    lines.push(`- <b>${safeHtml(matchDisplay)}</b>${suffix}`);
    if (league) lines.push(`  ${safeHtml(league)}`);
  }

  lines.push('');
  lines.push(`<i>${safeHtml(formatOperationalTimestamp())}</i>`);
  return lines.join('\n');
}

function getBatchKey(row: PendingTelegramMatchAlertRow): string {
  if (row.alertKind !== 'match_start') {
    return `single:${row.channelId}`;
  }
  const kickoffAtUtc = asString(row.metadata.kickoffAtUtc);
  if (!kickoffAtUtc) {
    return `single:${row.channelId}`;
  }
  return [
    'match_start',
    row.userId,
    row.chatId,
    row.notificationLanguage,
    kickoffAtUtc,
  ].join('|');
}

function groupTelegramMatchAlertRows(rows: PendingTelegramMatchAlertRow[]): PendingTelegramMatchAlertRow[][] {
  const groups = new Map<string, PendingTelegramMatchAlertRow[]>();
  for (const row of rows) {
    const key = getBatchKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups.values());
}

function buildTelegramMessageForRows(rows: PendingTelegramMatchAlertRow[]): string {
  return rows.length > 1 && rows.every((row) => row.alertKind === 'match_start')
    ? buildTelegramMatchStartBatchMessage(rows)
    : buildTelegramMatchAlertMessage(rows[0]!);
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
  const deliveryGroups = groupTelegramMatchAlertRows(pendingRows);

  await reportJobProgress(jobName, 'send', `Sending ${pendingRows.length} match alert Telegram deliveries...`, 50);
  await runWithConcurrency(deliveryGroups, DELIVERY_CONCURRENCY, async (group) => {
    const first = group[0]!;
    try {
      await sendTelegramMessage(first.chatId, buildTelegramMessageForRows(group));
      await Promise.all(group.map((row) => markMatchAlertChannelDelivered(row.channelId)));
      delivered += group.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await Promise.all(group.map((row) => markMatchAlertChannelFailed(row.channelId, message).catch(() => undefined)));
      failed += group.length;
      console.error(`[deliver-match-alert-telegram] Failed delivery ${first.deliveryId} for ${first.matchId}:`, message);
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
