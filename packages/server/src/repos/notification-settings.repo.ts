import { query } from '../db/pool.js';

export interface UserNotificationSettings {
  webPushEnabled: boolean;
  telegramEnabled: boolean;
  notificationLanguage: 'vi' | 'en' | 'both';
  minimumConfidence: number | null;
  minimumOdds: number | null;
  quietHours: Record<string, unknown>;
  channelPolicy: Record<string, unknown>;
}

interface UserNotificationSettingsRow {
  user_id: string;
  web_push_enabled: boolean;
  telegram_enabled: boolean;
  notification_language: string;
  minimum_confidence: number | null;
  minimum_odds: string | number | null;
  quiet_hours: Record<string, unknown> | null;
  channel_policy: Record<string, unknown> | null;
  updated_at: string;
}

export const DEFAULT_NOTIFICATION_SETTINGS: UserNotificationSettings = {
  webPushEnabled: false,
  telegramEnabled: false,
  notificationLanguage: 'vi',
  minimumConfidence: null,
  minimumOdds: null,
  quietHours: {},
  channelPolicy: {},
};

function normalizeLanguage(value: unknown): UserNotificationSettings['notificationLanguage'] {
  return value === 'en' || value === 'both' || value === 'vi' ? value : 'vi';
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapRow(row: UserNotificationSettingsRow): UserNotificationSettings {
  return {
    webPushEnabled: row.web_push_enabled,
    telegramEnabled: row.telegram_enabled,
    notificationLanguage: normalizeLanguage(row.notification_language),
    minimumConfidence: normalizeNumber(row.minimum_confidence),
    minimumOdds: normalizeNumber(row.minimum_odds),
    quietHours: normalizeJsonObject(row.quiet_hours),
    channelPolicy: normalizeJsonObject(row.channel_policy),
  };
}

export async function getNotificationSettings(userId: string): Promise<UserNotificationSettings | null> {
  const result = await query<UserNotificationSettingsRow>(
    `SELECT user_id, web_push_enabled, telegram_enabled, notification_language,
            minimum_confidence, minimum_odds, quiet_hours, channel_policy, updated_at
     FROM user_notification_settings
     WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function saveNotificationSettings(
  userId: string,
  settings: UserNotificationSettings,
): Promise<UserNotificationSettings> {
  const result = await query<UserNotificationSettingsRow>(
    `INSERT INTO user_notification_settings (
        user_id,
        web_push_enabled,
        telegram_enabled,
        notification_language,
        minimum_confidence,
        minimum_odds,
        quiet_hours,
        channel_policy,
        updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET web_push_enabled = EXCLUDED.web_push_enabled,
           telegram_enabled = EXCLUDED.telegram_enabled,
           notification_language = EXCLUDED.notification_language,
           minimum_confidence = EXCLUDED.minimum_confidence,
           minimum_odds = EXCLUDED.minimum_odds,
           quiet_hours = EXCLUDED.quiet_hours,
           channel_policy = EXCLUDED.channel_policy,
           updated_at = NOW()
     RETURNING user_id, web_push_enabled, telegram_enabled, notification_language,
               minimum_confidence, minimum_odds, quiet_hours, channel_policy, updated_at`,
    [
      userId,
      settings.webPushEnabled,
      settings.telegramEnabled,
      settings.notificationLanguage,
      settings.minimumConfidence,
      settings.minimumOdds,
      JSON.stringify(settings.quietHours),
      JSON.stringify(settings.channelPolicy),
    ],
  );
  return mapRow(result.rows[0]!);
}