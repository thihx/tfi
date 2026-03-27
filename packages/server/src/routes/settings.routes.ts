// ============================================================
// Settings Routes — /api/settings
// ============================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdminOrOwner, requireCurrentUser } from '../lib/authz.js';
import * as notificationSettingsRepo from '../repos/notification-settings.repo.js';
import * as settingsRepo from '../repos/settings.repo.js';
import {
  extractSelfServiceNotificationPatch,
  mergeNotificationSettings,
  normalizeSelfServiceSettings,
  resolveNotificationSettings,
  sanitizeSelfServicePatch,
  SELF_SERVICE_SETTINGS_DEFAULTS,
} from '../lib/user-personalization-settings.js';

export async function settingsRoutes(app: FastifyInstance) {
  const loadCurrentUserSettings = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const current = await settingsRepo.getSettings(user.userId, { fallbackToDefault: false });
    const notificationSettings = await resolveNotificationSettings(user.userId);
    return normalizeSelfServiceSettings({
      ...SELF_SERVICE_SETTINGS_DEFAULTS,
      ...current,
    }, notificationSettings);
  };

  const saveCurrentUserSettings = async (
    req: FastifyRequest<{ Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const existing = await settingsRepo.getSettings(user.userId, { fallbackToDefault: false });
    const existingNotificationSettings = await resolveNotificationSettings(user.userId);
    const merged = {
      ...existing,
      ...sanitizeSelfServicePatch(req.body ?? {}),
    };
    const notificationPatch = extractSelfServiceNotificationPatch(req.body ?? {});
    await settingsRepo.saveSettings(merged, user.userId);
    const savedNotificationSettings = Object.keys(notificationPatch).length > 0
      ? await notificationSettingsRepo.saveNotificationSettings(
        user.userId,
        mergeNotificationSettings(existingNotificationSettings, notificationPatch),
      )
      : existingNotificationSettings;
    return normalizeSelfServiceSettings({
      ...SELF_SERVICE_SETTINGS_DEFAULTS,
      ...merged,
    }, savedNotificationSettings);
  };

  // GET /api/settings — compatibility self-service path
  app.get('/api/settings', loadCurrentUserSettings);

  // GET /api/me/settings — design-aligned self-service path
  app.get('/api/me/settings', loadCurrentUserSettings);

  // PUT /api/settings — compatibility self-service path
  app.put<{ Body: Record<string, unknown> }>('/api/settings', saveCurrentUserSettings);

  // PUT /api/me/settings — design-aligned self-service path
  app.put<{ Body: Record<string, unknown> }>('/api/me/settings', saveCurrentUserSettings);

  app.get('/api/settings/system', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return settingsRepo.getSettings('default', { fallbackToDefault: false });
  });

  app.put<{ Body: Record<string, unknown> }>('/api/settings/system', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    const existing = await settingsRepo.getSettings('default', { fallbackToDefault: false });
    const merged = { ...existing, ...req.body };
    await settingsRepo.saveSettings(merged, 'default');
    return merged;
  });
}
