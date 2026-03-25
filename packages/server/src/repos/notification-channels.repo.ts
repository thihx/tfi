import { query } from '../db/pool.js';

export type NotificationChannelType = 'telegram' | 'zalo' | 'web_push' | 'email';
export type NotificationChannelStatus = 'draft' | 'pending' | 'verified' | 'disabled';

export interface UserNotificationChannelConfig {
  channelType: NotificationChannelType;
  enabled: boolean;
  status: NotificationChannelStatus;
  address: string | null;
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface UserNotificationChannelConfigRow {
  user_id: string;
  channel_type: NotificationChannelType;
  enabled: boolean;
  status: NotificationChannelStatus;
  address: string | null;
  config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface UserChannelAddress {
  userId: string;
  address: string;
}

export interface NotificationChannelConfigPatch {
  enabled?: boolean;
  address?: string | null;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export const SUPPORTED_NOTIFICATION_CHANNELS: NotificationChannelType[] = [
  'telegram',
  'zalo',
  'web_push',
  'email',
];

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function defaultMetadata(channelType: NotificationChannelType): Record<string, unknown> {
  switch (channelType) {
    case 'telegram':
      return { setupState: 'ready_for_chat_id', senderImplemented: true };
    case 'zalo':
      return { setupState: 'reserved', senderImplemented: false };
    case 'web_push':
      return { setupState: 'requires_browser_subscription', senderImplemented: true };
    case 'email':
      return { setupState: 'reserved', senderImplemented: false };
  }
}

function defaultChannelConfig(channelType: NotificationChannelType): UserNotificationChannelConfig {
  return {
    channelType,
    enabled: false,
    status: 'draft',
    address: null,
    config: {},
    metadata: defaultMetadata(channelType),
  };
}

function mapRow(row: UserNotificationChannelConfigRow): UserNotificationChannelConfig {
  return {
    channelType: row.channel_type,
    enabled: row.enabled,
    status: row.status,
    address: row.address,
    config: normalizeJsonObject(row.config),
    metadata: {
      ...defaultMetadata(row.channel_type),
      ...normalizeJsonObject(row.metadata),
    },
  };
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function deriveStatus(enabled: boolean, address: string | null, currentStatus?: NotificationChannelStatus): NotificationChannelStatus {
  if (!enabled) return 'disabled';
  if (!address) return 'draft';
  if (currentStatus === 'verified') return 'verified';
  return 'pending';
}

export async function getNotificationChannelConfigs(userId: string): Promise<UserNotificationChannelConfig[]> {
  const result = await query<UserNotificationChannelConfigRow>(
    `SELECT user_id, channel_type, enabled, status, address, config, metadata
       FROM user_notification_channel_configs
      WHERE user_id = $1`,
    [userId],
  );

  const mapped = new Map(result.rows.map((row) => {
    const config = mapRow(row);
    return [config.channelType, config] as const;
  }));

  return SUPPORTED_NOTIFICATION_CHANNELS.map((channelType) => mapped.get(channelType) ?? defaultChannelConfig(channelType));
}

export async function saveNotificationChannelConfig(
  userId: string,
  channelType: NotificationChannelType,
  patch: NotificationChannelConfigPatch,
): Promise<UserNotificationChannelConfig> {
  const existingList = await getNotificationChannelConfigs(userId);
  const existing = existingList.find((row) => row.channelType === channelType) ?? defaultChannelConfig(channelType);

  const nextEnabled = typeof patch.enabled === 'boolean' ? patch.enabled : existing.enabled;
  const nextAddress = patch.address === undefined ? existing.address : normalizeAddress(patch.address);
  const nextConfig = patch.config ? { ...existing.config, ...patch.config } : existing.config;
  const nextMetadata = patch.metadata ? { ...existing.metadata, ...patch.metadata } : existing.metadata;
  const nextStatus = deriveStatus(nextEnabled, nextAddress, existing.status);

  const result = await query<UserNotificationChannelConfigRow>(
    `INSERT INTO user_notification_channel_configs (
        user_id,
        channel_type,
        enabled,
        status,
        address,
        config,
        metadata,
        updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id, channel_type) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           status = EXCLUDED.status,
           address = EXCLUDED.address,
           config = EXCLUDED.config,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()
     RETURNING user_id, channel_type, enabled, status, address, config, metadata`,
    [
      userId,
      channelType,
      nextEnabled,
      nextStatus,
      nextAddress,
      JSON.stringify(nextConfig),
      JSON.stringify(nextMetadata),
    ],
  );

  return mapRow(result.rows[0]!);
}

export async function getNotificationChannelAddressesByUserIds(
  userIds: string[],
  channelType: NotificationChannelType,
): Promise<UserChannelAddress[]> {
  if (userIds.length === 0) return [];

  const result = await query<{ user_id: string; address: string }>(
    `SELECT user_id, BTRIM(address) AS address
       FROM user_notification_channel_configs
      WHERE user_id = ANY($1::uuid[])
        AND channel_type = $2
        AND enabled = TRUE
        AND status <> 'disabled'
        AND address IS NOT NULL
        AND BTRIM(address) <> ''`,
    [userIds, channelType],
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    address: row.address,
  }));
}