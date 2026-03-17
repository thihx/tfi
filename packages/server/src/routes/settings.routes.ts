// ============================================================
// Settings Routes — /api/settings
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as settingsRepo from '../repos/settings.repo.js';

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings — load user settings
  app.get('/api/settings', async () => {
    return settingsRepo.getSettings();
  });

  // PUT /api/settings — save user settings (merge with existing)
  app.put<{ Body: Record<string, unknown> }>('/api/settings', async (req) => {
    const existing = await settingsRepo.getSettings();
    const merged = { ...existing, ...req.body };
    await settingsRepo.saveSettings(merged);
    return merged;
  });
}
