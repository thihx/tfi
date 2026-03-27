import * as notificationSettingsRepo from '../repos/notification-settings.repo.js';
import * as settingsRepo from '../repos/settings.repo.js';

export interface NotificationSettingsBody {
  webPushEnabled?: boolean;
  telegramEnabled?: boolean;
  notificationLanguage?: 'vi' | 'en' | 'both';
  minimumConfidence?: number | null;
  minimumOdds?: number | null;
  quietHours?: Record<string, unknown>;
  channelPolicy?: Record<string, unknown>;
}

export const SELF_SERVICE_SETTINGS_DEFAULTS = {
  UI_LANGUAGE: 'vi',
  AUTO_APPLY_RECOMMENDED_CONDITION: true,
  USER_TIMEZONE: null,
  USER_TIMEZONE_CONFIRMED: false,
  TELEGRAM_ENABLED: false,
  WEB_PUSH_ENABLED: false,
  NOTIFICATION_LANGUAGE: 'vi',
} satisfies Record<string, unknown>;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseLegacyBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

function parseLegacyNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function resolveNotificationSettings(
  userId: string,
): Promise<notificationSettingsRepo.UserNotificationSettings> {
  const existing = await notificationSettingsRepo.getNotificationSettings(userId);
  if (existing) return existing;

  const legacy = await settingsRepo.getSettings(userId, { fallbackToDefault: false });
  const fallback = notificationSettingsRepo.DEFAULT_NOTIFICATION_SETTINGS;

  const bootstrapped = {
    webPushEnabled: parseLegacyBoolean(legacy['WEB_PUSH_ENABLED'], fallback.webPushEnabled),
    telegramEnabled: parseLegacyBoolean(legacy['TELEGRAM_ENABLED'], fallback.telegramEnabled),
    notificationLanguage:
      legacy['NOTIFICATION_LANGUAGE'] === 'en'
      || legacy['NOTIFICATION_LANGUAGE'] === 'both'
      || legacy['NOTIFICATION_LANGUAGE'] === 'vi'
        ? legacy['NOTIFICATION_LANGUAGE']
        : fallback.notificationLanguage,
    minimumConfidence: parseLegacyNumber(legacy['MIN_CONFIDENCE']),
    minimumOdds: parseLegacyNumber(legacy['MIN_ODDS']),
    quietHours: fallback.quietHours,
    channelPolicy: fallback.channelPolicy,
  };

  return notificationSettingsRepo.saveNotificationSettings(userId, bootstrapped);
}

export function mergeNotificationSettings(
  existing: notificationSettingsRepo.UserNotificationSettings,
  patch: NotificationSettingsBody,
): notificationSettingsRepo.UserNotificationSettings {
  return {
    webPushEnabled: typeof patch.webPushEnabled === 'boolean' ? patch.webPushEnabled : existing.webPushEnabled,
    telegramEnabled: typeof patch.telegramEnabled === 'boolean' ? patch.telegramEnabled : existing.telegramEnabled,
    notificationLanguage:
      patch.notificationLanguage === 'vi' || patch.notificationLanguage === 'en' || patch.notificationLanguage === 'both'
        ? patch.notificationLanguage
        : existing.notificationLanguage,
    minimumConfidence: patch.minimumConfidence === undefined ? existing.minimumConfidence : patch.minimumConfidence,
    minimumOdds: patch.minimumOdds === undefined ? existing.minimumOdds : patch.minimumOdds,
    quietHours: isObjectRecord(patch.quietHours) ? patch.quietHours : existing.quietHours,
    channelPolicy: isObjectRecord(patch.channelPolicy) ? patch.channelPolicy : existing.channelPolicy,
  };
}

export function normalizeSelfServiceSettings(
  settings: Record<string, unknown>,
  notificationSettings?: notificationSettingsRepo.UserNotificationSettings | null,
): Record<string, unknown> {
  const userTimeZone = isValidTimeZone(settings['USER_TIMEZONE']) ? settings['USER_TIMEZONE'] : null;
  return {
    UI_LANGUAGE: settings['UI_LANGUAGE'] === 'en' ? 'en' : 'vi',
    AUTO_APPLY_RECOMMENDED_CONDITION: settings['AUTO_APPLY_RECOMMENDED_CONDITION'] !== false,
    USER_TIMEZONE: userTimeZone,
    USER_TIMEZONE_CONFIRMED: userTimeZone ? settings['USER_TIMEZONE_CONFIRMED'] === true : false,
    TELEGRAM_ENABLED: notificationSettings?.telegramEnabled === true,
    WEB_PUSH_ENABLED: notificationSettings?.webPushEnabled === true,
    NOTIFICATION_LANGUAGE: notificationSettings?.notificationLanguage ?? 'vi',
  };
}

export function sanitizeSelfServicePatch(settings: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (settings['UI_LANGUAGE'] === 'vi' || settings['UI_LANGUAGE'] === 'en') {
    patch['UI_LANGUAGE'] = settings['UI_LANGUAGE'];
  }
  if (typeof settings['AUTO_APPLY_RECOMMENDED_CONDITION'] === 'boolean') {
    patch['AUTO_APPLY_RECOMMENDED_CONDITION'] = settings['AUTO_APPLY_RECOMMENDED_CONDITION'];
  }
  if (settings['USER_TIMEZONE'] === null) {
    patch['USER_TIMEZONE'] = null;
    patch['USER_TIMEZONE_CONFIRMED'] = false;
  } else if (isValidTimeZone(settings['USER_TIMEZONE'])) {
    patch['USER_TIMEZONE'] = settings['USER_TIMEZONE'];
  }
  if (typeof settings['USER_TIMEZONE_CONFIRMED'] === 'boolean') {
    patch['USER_TIMEZONE_CONFIRMED'] = settings['USER_TIMEZONE_CONFIRMED'];
  }
  return patch;
}

export function extractSelfServiceNotificationPatch(settings: Record<string, unknown>): NotificationSettingsBody {
  const patch: NotificationSettingsBody = {};
  if (typeof settings['TELEGRAM_ENABLED'] === 'boolean') {
    patch.telegramEnabled = settings['TELEGRAM_ENABLED'];
  }
  if (typeof settings['WEB_PUSH_ENABLED'] === 'boolean') {
    patch.webPushEnabled = settings['WEB_PUSH_ENABLED'];
  }
  if (
    settings['NOTIFICATION_LANGUAGE'] === 'vi'
    || settings['NOTIFICATION_LANGUAGE'] === 'en'
    || settings['NOTIFICATION_LANGUAGE'] === 'both'
  ) {
    patch.notificationLanguage = settings['NOTIFICATION_LANGUAGE'];
  }
  return patch;
}