// ============================================================
// Push Subscriptions Repository
// ============================================================

import { query } from '../db/pool.js';

export interface PushSubscriptionRow {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
}

export async function upsertSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
  userAgent?: string,
): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent`,
    [userId, endpoint, p256dh, auth, userAgent ?? null],
  );
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

export async function deleteSubscriptionForUser(userId: string, endpoint: string): Promise<void> {
  await query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
    [endpoint, userId],
  );
}

export async function getAllSubscriptions(): Promise<PushSubscriptionRow[]> {
  const r = await query<PushSubscriptionRow>('SELECT * FROM push_subscriptions ORDER BY created_at');
  return r.rows;
}

export async function getSubscriptionsByUserId(userId: string): Promise<PushSubscriptionRow[]> {
  const r = await query<PushSubscriptionRow>(
    'SELECT * FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
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

export async function countSubscriptionsByUserId(userId: string): Promise<number> {
  const r = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM push_subscriptions WHERE user_id = $1',
    [userId],
  );
  return parseInt(r.rows[0]?.count ?? '0', 10);
}
