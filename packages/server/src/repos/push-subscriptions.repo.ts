// ============================================================
// Push Subscriptions Repository
// ============================================================

import { query } from '../db/pool.js';

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
}

export async function upsertSubscription(
  endpoint: string,
  p256dh: string,
  auth: string,
  userAgent?: string,
): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET p256dh = $2, auth = $3, user_agent = $4`,
    [endpoint, p256dh, auth, userAgent ?? null],
  );
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

export async function getAllSubscriptions(): Promise<PushSubscriptionRow[]> {
  const r = await query<PushSubscriptionRow>('SELECT * FROM push_subscriptions ORDER BY created_at');
  return r.rows;
}

export async function updateLastUsed(endpoint: string): Promise<void> {
  await query(
    'UPDATE push_subscriptions SET last_used_at = NOW() WHERE endpoint = $1',
    [endpoint],
  );
}

export async function countSubscriptions(): Promise<number> {
  const r = await query<{ count: string }>('SELECT COUNT(*) as count FROM push_subscriptions');
  return parseInt(r.rows[0]?.count ?? '0', 10);
}
