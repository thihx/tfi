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
  if (!res.ok) throw new Error(`Load notification channels failed: ${res.status}`);
  return res.json() as Promise<NotificationChannelConfig[]>;
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
  if (!res.ok) throw new Error(`Save notification channel failed: ${res.status}`);
  return res.json() as Promise<NotificationChannelConfig>;
}