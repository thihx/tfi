import type { NotificationChannelConfig, NotificationChannelType } from '@/types';
import { internalApiUrl } from '@/lib/internal-api';
import { getToken } from './auth';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchNotificationChannels(): Promise<NotificationChannelConfig[]> {
  const res = await fetch(internalApiUrl('/api/me/notification-channels'), {
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `Load notification channels failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error.trim()) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<NotificationChannelConfig[]>;
}

export interface TelegramLinkOfferResponse {
  deepLinkUrl: string;
  expiresAt: string;
}

/** Opens t.me/bot?start=… — user taps Start; server webhook stores chat_id. */
export async function requestTelegramLinkOffer(): Promise<TelegramLinkOfferResponse> {
  const res = await fetch(internalApiUrl('/api/me/notification-channels/telegram/link-offer'), {
    method: 'POST',
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `Link offer failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error.trim()) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<TelegramLinkOfferResponse>;
}

export async function persistNotificationChannel(
  channelType: NotificationChannelType,
  patch: {
    enabled?: boolean;
    address?: string | null;
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<NotificationChannelConfig> {
  const res = await fetch(internalApiUrl(`/api/me/notification-channels/${channelType}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `Save notification channel failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (typeof body.error === 'string' && body.error.trim()) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<NotificationChannelConfig>;
}