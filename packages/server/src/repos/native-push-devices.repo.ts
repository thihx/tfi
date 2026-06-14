import { query } from '../db/pool.js';

export type NativePushPlatform = 'ios' | 'android';
export type NativePushProvider = 'fcm' | 'apns';

export interface NativePushDevice {
  id: number;
  userId: string;
  deviceId: string;
  platform: NativePushPlatform;
  provider: NativePushProvider;
  token: string;
  appVersion: string | null;
  deviceName: string | null;
  timezone: string | null;
  localNotificationsEnabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

interface NativePushDeviceRow {
  id: number;
  user_id: string;
  device_id: string;
  platform: NativePushPlatform;
  provider: NativePushProvider;
  token: string;
  app_version: string | null;
  device_name: string | null;
  timezone: string | null;
  local_notifications_enabled: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface NativePushDeviceInput {
  deviceId: string;
  platform: NativePushPlatform;
  provider: NativePushProvider;
  token: string;
  appVersion?: string | null;
  deviceName?: string | null;
  timezone?: string | null;
  localNotificationsEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function mapDevice(row: NativePushDeviceRow): NativePushDevice {
  return {
    id: Number(row.id),
    userId: row.user_id,
    deviceId: row.device_id,
    platform: row.platform,
    provider: row.provider,
    token: row.token,
    appVersion: row.app_version,
    deviceName: row.device_name,
    timezone: row.timezone,
    localNotificationsEnabled: row.local_notifications_enabled,
    metadata: jsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  };
}

export async function upsertNativePushDevice(
  userId: string,
  input: NativePushDeviceInput,
): Promise<NativePushDevice> {
  const result = await query<NativePushDeviceRow>(
    `INSERT INTO native_push_devices (
        user_id,
        device_id,
        platform,
        provider,
        token,
        app_version,
        device_name,
        timezone,
        local_notifications_enabled,
        metadata,
        updated_at,
        last_seen_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      ON CONFLICT (user_id, device_id) DO UPDATE
        SET platform = EXCLUDED.platform,
            provider = EXCLUDED.provider,
            token = EXCLUDED.token,
            app_version = EXCLUDED.app_version,
            device_name = EXCLUDED.device_name,
            timezone = EXCLUDED.timezone,
            local_notifications_enabled = EXCLUDED.local_notifications_enabled,
            metadata = native_push_devices.metadata || EXCLUDED.metadata,
            updated_at = NOW(),
            last_seen_at = NOW()
      RETURNING *`,
    [
      userId,
      input.deviceId,
      input.platform,
      input.provider,
      input.token,
      nullableText(input.appVersion),
      nullableText(input.deviceName),
      nullableText(input.timezone),
      input.localNotificationsEnabled === true,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapDevice(result.rows[0]!);
}

export async function listNativePushDevices(userId: string): Promise<NativePushDevice[]> {
  const result = await query<NativePushDeviceRow>(
    `SELECT *
       FROM native_push_devices
      WHERE user_id = $1
      ORDER BY updated_at DESC, id DESC`,
    [userId],
  );
  return result.rows.map(mapDevice);
}

export async function getNativePushDevicesByUserId(userId: string): Promise<NativePushDevice[]> {
  const result = await query<NativePushDeviceRow>(
    `SELECT *
       FROM native_push_devices
      WHERE user_id = $1
      ORDER BY updated_at DESC, id DESC`,
    [userId],
  );
  return result.rows.map(mapDevice);
}

export async function deleteNativePushDeviceByToken(provider: NativePushProvider, token: string): Promise<void> {
  await query(
    `DELETE FROM native_push_devices
      WHERE provider = $1
        AND token = $2`,
    [provider, token],
  );
}

export async function deleteNativePushDevice(userId: string, deviceId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM native_push_devices
      WHERE user_id = $1
        AND device_id = $2`,
    [userId, deviceId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function countNativePushDevicesByUserId(userId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM native_push_devices
      WHERE user_id = $1`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function purgeStaleNativePushDevices(keepDays: number): Promise<number> {
  if (!Number.isFinite(keepDays) || keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM native_push_devices
      WHERE COALESCE(last_seen_at, updated_at, created_at) < NOW() - INTERVAL '1 day' * $1`,
    [Math.floor(keepDays)],
  );
  return result.rowCount ?? 0;
}
