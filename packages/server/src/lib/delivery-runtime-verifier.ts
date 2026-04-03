export type DeliveryRuntimeChannelType = 'telegram' | 'web_push';

export interface DeliveryRuntimeReadiness {
  telegram: boolean;
  webPush: boolean;
}

export interface DeliveryRuntimeChannelRow {
  channelType: string;
  channelStatus: string;
}

export interface DeliveryRuntimeSnapshot {
  notificationChannels?: string | null;
  deliveryChannels?: unknown;
}

export interface DeliveryRuntimeSummary {
  expectedChannels: DeliveryRuntimeChannelType[];
  observedChannels: DeliveryRuntimeChannelType[];
  deliveredChannels: DeliveryRuntimeChannelType[];
  pendingChannels: DeliveryRuntimeChannelType[];
  failedChannels: DeliveryRuntimeChannelType[];
  aggregateNotificationChannels: DeliveryRuntimeChannelType[];
  aggregateDeliveryChannels: DeliveryRuntimeChannelType[];
  missingChannels: DeliveryRuntimeChannelType[];
  hasExpectedChannelRows: boolean;
  fullyDelivered: boolean;
}

function isKnownChannel(value: string): value is DeliveryRuntimeChannelType {
  return value === 'telegram' || value === 'web_push';
}

export function normalizeChannelCsv(value: string | null | undefined): DeliveryRuntimeChannelType[] {
  if (!value) return [];
  const normalized = value
    .split(',')
    .map((item) => item.trim())
    .filter(isKnownChannel);
  return [...new Set(normalized)];
}

export function normalizeChannelArray(value: unknown): DeliveryRuntimeChannelType[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => String(item).trim())
    .filter(isKnownChannel);
  return [...new Set(normalized)];
}

export function buildExpectedDeliveryChannels(
  readiness: DeliveryRuntimeReadiness,
): DeliveryRuntimeChannelType[] {
  const channels: DeliveryRuntimeChannelType[] = [];
  if (readiness.telegram) channels.push('telegram');
  if (readiness.webPush) channels.push('web_push');
  return channels;
}

export function summarizeDeliveryRuntimeVerification(input: {
  readiness: DeliveryRuntimeReadiness;
  rows: DeliveryRuntimeChannelRow[];
  snapshot?: DeliveryRuntimeSnapshot | null;
}): DeliveryRuntimeSummary {
  const expectedChannels = buildExpectedDeliveryChannels(input.readiness);
  const observedChannels = [...new Set(
    input.rows
      .map((row) => row.channelType.trim())
      .filter(isKnownChannel),
  )];
  const deliveredChannels = [...new Set(
    input.rows
      .filter((row) => row.channelStatus === 'delivered')
      .map((row) => row.channelType.trim())
      .filter(isKnownChannel),
  )];
  const pendingChannels = [...new Set(
    input.rows
      .filter((row) => row.channelStatus === 'pending')
      .map((row) => row.channelType.trim())
      .filter(isKnownChannel),
  )];
  const failedChannels = [...new Set(
    input.rows
      .filter((row) => row.channelStatus === 'failed')
      .map((row) => row.channelType.trim())
      .filter(isKnownChannel),
  )];
  const aggregateNotificationChannels = normalizeChannelCsv(input.snapshot?.notificationChannels ?? null);
  const aggregateDeliveryChannels = normalizeChannelArray(input.snapshot?.deliveryChannels);
  const missingChannels = expectedChannels.filter((channel) => !observedChannels.includes(channel));
  const hasExpectedChannelRows = missingChannels.length === 0;
  const fullyDelivered = expectedChannels.every((channel) => deliveredChannels.includes(channel));

  return {
    expectedChannels,
    observedChannels,
    deliveredChannels,
    pendingChannels,
    failedChannels,
    aggregateNotificationChannels,
    aggregateDeliveryChannels,
    missingChannels,
    hasExpectedChannelRows,
    fullyDelivered,
  };
}
