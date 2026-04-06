// ============================================================
// Settings Routes — /api/settings
// ============================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdminOrOwner, requireCurrentUser } from '../lib/authz.js';
import * as notificationSettingsRepo from '../repos/notification-settings.repo.js';
import * as settingsRepo from '../repos/settings.repo.js';
import {
  getUserById,
  listUsers,
  updateUserSelfProfile,
  updateUserAdminProfile,
  type UserRole,
  type UserStatus,
} from '../repos/users.repo.js';
import { toAuthUserResponse } from '../lib/request-user.js';
import { mergeAskAiQuickPromptsByLocale } from '../lib/ask-ai-quick-prompts-settings.js';
import {
  extractSelfServiceNotificationPatch,
  mergeNotificationSettings,
  normalizeSelfServiceSettings,
  resolveNotificationSettings,
  sanitizeSelfServicePatch,
  SELF_SERVICE_SETTINGS_DEFAULTS,
} from '../lib/user-personalization-settings.js';

export async function settingsRoutes(app: FastifyInstance) {
  const allowedManagedRoles = new Set<Extract<UserRole, 'admin' | 'member'>>(['admin', 'member']);
  const allowedManagedStatuses = new Set<Extract<UserStatus, 'active' | 'disabled'>>(['active', 'disabled']);

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
    const body = req.body ?? {};
    const patch = sanitizeSelfServicePatch(body);
    if (body['ASK_AI_QUICK_PROMPTS_BY_LOCALE'] !== undefined) {
      patch['ASK_AI_QUICK_PROMPTS_BY_LOCALE'] = mergeAskAiQuickPromptsByLocale(
        existing['ASK_AI_QUICK_PROMPTS_BY_LOCALE'],
        body['ASK_AI_QUICK_PROMPTS_BY_LOCALE'],
      );
    }
    const merged = {
      ...existing,
      ...patch,
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

  app.get('/api/me/profile', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const current = await getUserById(user.userId);
    if (!current) {
      return reply.status(404).send({ error: 'User not found' });
    }
    return toAuthUserResponse(current);
  });

  // PUT /api/settings — compatibility self-service path
  app.put<{ Body: Record<string, unknown> }>('/api/settings', saveCurrentUserSettings);

  // PUT /api/me/settings — design-aligned self-service path
  app.put<{ Body: Record<string, unknown> }>('/api/me/settings', saveCurrentUserSettings);

  app.patch<{ Body: { displayName?: unknown } }>('/api/me/profile', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const rawDisplayName = typeof req.body?.displayName === 'string'
      ? req.body.displayName.trim()
      : '';

    if (!rawDisplayName) {
      return reply.status(400).send({ error: 'Display name is required' });
    }

    if (rawDisplayName.length > 80) {
      return reply.status(400).send({ error: 'Display name must be 80 characters or fewer' });
    }

    const updated = await updateUserSelfProfile(user.userId, { displayName: rawDisplayName });
    if (!updated) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return toAuthUserResponse(updated);
  });

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

  app.get('/api/settings/users', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return listUsers();
  });

  app.patch<{ Params: { userId: string }; Body: { role?: unknown; status?: unknown } }>(
    '/api/settings/users/:userId',
    async (req, reply) => {
      const currentUser = requireAdminOrOwner(req, reply);
      if (!currentUser) return;

      const targetUserId = req.params.userId;
      const target = await getUserById(targetUserId);
      if (!target) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const requestedRole = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : undefined;
      const requestedStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : undefined;
      const nextRole = requestedRole !== undefined && allowedManagedRoles.has(requestedRole as Extract<UserRole, 'admin' | 'member'>)
        ? requestedRole as Extract<UserRole, 'admin' | 'member'>
        : undefined;
      const nextStatus = requestedStatus !== undefined && allowedManagedStatuses.has(requestedStatus as Extract<UserStatus, 'active' | 'disabled'>)
        ? requestedStatus as Extract<UserStatus, 'active' | 'disabled'>
        : undefined;

      if (requestedRole !== undefined && nextRole === undefined) {
        return reply.status(400).send({ error: 'Invalid role' });
      }
      if (requestedStatus !== undefined && nextStatus === undefined) {
        return reply.status(400).send({ error: 'Invalid status' });
      }
      if (nextRole === undefined && nextStatus === undefined) {
        return reply.status(400).send({ error: 'No supported fields to update' });
      }
      if (target.role === 'owner') {
        return reply.status(403).send({ error: 'Owner account cannot be edited here' });
      }
      if (target.id === currentUser.userId) {
        const roleChanging = nextRole !== undefined && nextRole !== target.role;
        const statusChanging = nextStatus !== undefined && nextStatus !== target.status;
        if (roleChanging || statusChanging) {
          return reply.status(400).send({ error: 'You cannot change your own role or status' });
        }
      }

      const updated = await updateUserAdminProfile(target.id, {
        role: nextRole,
        status: nextStatus,
      });
      if (!updated) {
        return reply.status(404).send({ error: 'User not found' });
      }
      return updated;
    },
  );
}
