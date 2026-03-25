import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireCurrentUser } from '../lib/authz.js';
import * as notificationSettingsRepo from '../repos/notification-settings.repo.js';
import * as settingsRepo from '../repos/settings.repo.js';

interface NotificationSettingsBody {
  webPushEnabled?: boolean;
  telegramEnabled?: boolean;
  notificationLanguage?: 'vi' | 'en' | 'both';
  minimumConfidence?: number | null;
  minimumOdds?: number | null;
  quietHours?: Record<string, unknown>;
  channelPolicy?: Record<string, unknown>;
}

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

async function resolveNotificationSettings(userId: string): Promise<notificationSettingsRepo.UserNotificationSettings> {
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

function mergeNotificationSettings(
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

export async function notificationSettingsRoutes(app: FastifyInstance) {
  const loadCurrentUserNotificationSettings = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return resolveNotificationSettings(user.userId);
  };

  const saveCurrentUserNotificationSettings = async (
    req: FastifyRequest<{ Body: NotificationSettingsBody }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const existing = await resolveNotificationSettings(user.userId);
    const merged = mergeNotificationSettings(existing, req.body ?? {});
    return notificationSettingsRepo.saveNotificationSettings(user.userId, merged);
  };

  app.get('/api/notification-settings', loadCurrentUserNotificationSettings);
  app.get('/api/me/notification-settings', loadCurrentUserNotificationSettings);

  app.put<{ Body: NotificationSettingsBody }>('/api/notification-settings', saveCurrentUserNotificationSettings);
  app.put<{ Body: NotificationSettingsBody }>('/api/me/notification-settings', saveCurrentUserNotificationSettings);
}