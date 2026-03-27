import { internalApiUrl } from '@/lib/internal-api';
import { getToken } from './auth';

export interface NotificationSettings {
  webPushEnabled: boolean;
  telegramEnabled: boolean;
  notificationLanguage: 'vi' | 'en' | 'both';
  minimumConfidence: number | null;
  minimumOdds: number | null;
  quietHours: Record<string, unknown>;
  channelPolicy: Record<string, unknown>;
}

export interface NotificationSettingsPatch {
  webPushEnabled?: boolean;
  telegramEnabled?: boolean;
  notificationLanguage?: 'vi' | 'en' | 'both';
  minimumConfidence?: number | null;
  minimumOdds?: number | null;
  quietHours?: Record<string, unknown>;
  channelPolicy?: Record<string, unknown>;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
  const res = await fetch(internalApiUrl('/api/me/notification-settings'), {
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Load notification settings failed: ${res.status}`);
  return res.json() as Promise<NotificationSettings>;
}

export async function persistNotificationSettings(
  patch: NotificationSettingsPatch,
): Promise<NotificationSettings> {
  const res = await fetch(internalApiUrl('/api/me/notification-settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Save notification settings failed: ${res.status}`);
  return res.json() as Promise<NotificationSettings>;
}