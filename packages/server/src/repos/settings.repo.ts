// ============================================================
// User Settings Repository
// ============================================================

import { query } from '../db/pool.js';

export interface UserSettingsRow {
  user_id: string;
  settings: Record<string, unknown>;
  updated_at: string;
}

export async function getSettings(userId = 'default'): Promise<Record<string, unknown>> {
  const r = await query<UserSettingsRow>(
    'SELECT settings FROM user_settings WHERE user_id = $1',
    [userId],
  );
  return (r.rows[0]?.settings as Record<string, unknown>) ?? {};
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
