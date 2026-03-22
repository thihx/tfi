// ============================================================
// Web Push Service — subscribe/unsubscribe/check
// ============================================================

import { getToken } from './auth';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)
  ?? (import.meta.env.MODE === 'production' ? '' : 'http://localhost:4000');

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Check if Web Push is supported in this browser. */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Current browser notification permission state. */
export function getNotificationPermission(): NotificationPermission {
  return Notification.permission;
}

/** Request notification permission. Returns 'granted' | 'denied' | 'default'. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission();
}

/** Fetch the server VAPID public key. Returns null if not configured. */
async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/push/vapid-public-key`, {
      headers: { Accept: 'application/json', ...authHeaders() },
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json() as { vapidPublicKey?: string };
    return data.vapidPublicKey ?? null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

/** Get the existing push subscription for this browser, or null. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Subscribe this browser to push notifications. Returns the subscription or throws. */
export async function subscribePush(): Promise<PushSubscription> {
  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) throw new Error('Web Push is not configured on the server.');

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  // Send subscription to server
  const subJson = subscription.toJSON();
  const res = await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: subJson.keys,
    }),
  });
  if (!res.ok) {
    await subscription.unsubscribe();
    throw new Error(`Failed to register subscription with server: ${res.status}`);
  }

  return subscription;
}

/** Unsubscribe this browser from push notifications. */
export async function unsubscribePush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  // Remove from server
  await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined); // best-effort
}
