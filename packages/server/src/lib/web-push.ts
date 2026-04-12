// ============================================================
// Web Push — VAPID setup and notification sender
// ============================================================

import webpush from 'web-push';
import { config } from '../config.js';

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    throw new Error('VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars.');
  }
  webpush.setVapidDetails(
    config.vapidContactEmail ? `mailto:${config.vapidContactEmail}` : 'mailto:noreply@tfi.local',
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );
  initialized = true;
}

export function isWebPushConfigured(): boolean {
  return Boolean(config.vapidPublicKey && config.vapidPrivateKey);
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  /** Absolute or site-root path (e.g. /icons/....svg); shown as notification icon where supported */
  icon?: string;
}

export type SendResult =
  | { ok: true }
  | { ok: false; gone: boolean; error: string };

export async function sendWebPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<SendResult> {
  try {
    ensureInitialized();
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
      { TTL: 60 * 60, urgency: 'high' }, // 1 hour TTL, high urgency = deliver immediately
    );
    console.log(`[web-push] Notification sent OK to ${subscription.endpoint.slice(0, 60)}...`);
    return { ok: true };
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    const gone = statusCode === 410 || statusCode === 404;
    const message = err instanceof Error ? err.message : String(err);
    if (!gone) {
      console.error(`[web-push] sendNotification failed (status=${statusCode ?? 'unknown'}): ${message}`);
    }
    return { ok: false, gone, error: message };
  }
}
