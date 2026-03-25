// ============================================================
// Settings Routes — /api/settings
// ============================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdminOrOwner, requireCurrentUser } from '../lib/authz.js';
import * as settingsRepo from '../repos/settings.repo.js';

const SELF_SERVICE_SETTINGS_DEFAULTS = {
  UI_LANGUAGE: 'vi',
  AUTO_APPLY_RECOMMENDED_CONDITION: true,
} satisfies Record<string, unknown>;

function normalizeSelfServiceSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return {
    UI_LANGUAGE: settings['UI_LANGUAGE'] === 'en' ? 'en' : 'vi',
    AUTO_APPLY_RECOMMENDED_CONDITION: settings['AUTO_APPLY_RECOMMENDED_CONDITION'] !== false,
  };
}

function sanitizeSelfServicePatch(settings: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (settings['UI_LANGUAGE'] === 'vi' || settings['UI_LANGUAGE'] === 'en') {
    patch['UI_LANGUAGE'] = settings['UI_LANGUAGE'];
  }
  if (typeof settings['AUTO_APPLY_RECOMMENDED_CONDITION'] === 'boolean') {
    patch['AUTO_APPLY_RECOMMENDED_CONDITION'] = settings['AUTO_APPLY_RECOMMENDED_CONDITION'];
  }
  return patch;
}

export async function settingsRoutes(app: FastifyInstance) {
  const loadCurrentUserSettings = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const current = await settingsRepo.getSettings(user.userId, { fallbackToDefault: false });
    return normalizeSelfServiceSettings({
      ...SELF_SERVICE_SETTINGS_DEFAULTS,
      ...current,
    });
  };

  const saveCurrentUserSettings = async (
    req: FastifyRequest<{ Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const existing = await settingsRepo.getSettings(user.userId, { fallbackToDefault: false });
    const merged = {
      ...existing,
      ...sanitizeSelfServicePatch(req.body ?? {}),
    };
    await settingsRepo.saveSettings(merged, user.userId);
    return normalizeSelfServiceSettings({
      ...SELF_SERVICE_SETTINGS_DEFAULTS,
      ...merged,
    });
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
