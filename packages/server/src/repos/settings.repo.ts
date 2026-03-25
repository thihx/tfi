// ============================================================
// User Settings Repository
// ============================================================

import { query } from '../db/pool.js';

export interface UserSettingsRow {
  user_id: string;
  settings: Record<string, unknown>;
  updated_at: string;
}

interface GetSettingsOptions {
  fallbackToDefault?: boolean;
}

export async function getSettings(
  userId = 'default',
  options: GetSettingsOptions = {},
): Promise<Record<string, unknown>> {
  const fallbackToDefault = options.fallbackToDefault ?? userId !== 'default';

  const primary = await query<UserSettingsRow>(
    'SELECT settings FROM user_settings WHERE user_id = $1',
    [userId],
  );
  if (primary.rows[0]?.settings) {
    return primary.rows[0].settings as Record<string, unknown>;
  }

  if (!fallbackToDefault) return {};

  const fallback = await query<UserSettingsRow>(
    'SELECT settings FROM user_settings WHERE user_id = $1',
    ['default'],
  );
  return (fallback.rows[0]?.settings as Record<string, unknown>) ?? {};
}

export async function saveSettings(
  settings: Record<string, unknown>,
  userId = 'default',
): Promise<UserSettingsRow> {
  const r = await query<UserSettingsRow>(
    `INSERT INTO user_settings (user_id, settings, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET settings = $2, updated_at = NOW()
     RETURNING *`,
    [userId, JSON.stringify(settings)],
  );
  return r.rows[0]!;
}
