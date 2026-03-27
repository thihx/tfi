import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireCurrentUser } from '../lib/authz.js';
import * as notificationSettingsRepo from '../repos/notification-settings.repo.js';
import {
  mergeNotificationSettings,
  resolveNotificationSettings,
  type NotificationSettingsBody,
} from '../lib/user-personalization-settings.js';

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