import { internalApiUrl } from '@/lib/internal-api';
import { getToken } from './auth';

export type NativePushPlatform = 'ios' | 'android';
export type NativePushProvider = 'fcm' | 'apns';

export interface NativePushDeviceRegistration {
  deviceId: string;
  platform: NativePushPlatform;
  provider: NativePushProvider;
  token: string;
  appVersion?: string | null;
  deviceName?: string | null;
  timezone?: string | null;
  localNotificationsEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface NativePushDevice extends Required<Omit<NativePushDeviceRegistration, 'appVersion' | 'deviceName' | 'timezone' | 'metadata'>> {
  id: number;
  userId: string;
  appVersion: string | null;
  deviceName: string | null;
  timezone: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface NativePushStatus {
  configured: boolean;
  deviceCount: number;
  localNotificationDeviceCount: number;
  senderImplemented: boolean;
  senderConfigured: boolean;
  devices: NativePushDevice[];
}

export interface LocalMatchStartAlert {
  ruleId: number;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAtUtc: string;
  kickoffLeadMinutes: number;
  fireAtUtc: string;
  source: string;
}

export interface LocalMatchStartAlertSchedule {
  lookaheadHours: number;
  alerts: LocalMatchStartAlert[];
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson<T>(res: Response, message: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`${message}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchNativePushStatus(): Promise<NativePushStatus> {
  const res = await fetch(internalApiUrl('/api/me/native-push/status'), {
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
    cache: 'no-store',
  });
  return readJson<NativePushStatus>(res, 'Load native push status failed');
}

export async function registerNativePushDevice(
  payload: NativePushDeviceRegistration,
): Promise<NativePushDevice> {
  const res = await fetch(internalApiUrl('/api/me/native-push/devices'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return readJson<NativePushDevice>(res, 'Register native push device failed');
}

export async function deleteNativePushDevice(deviceId: string): Promise<{ deleted: boolean }> {
  const res = await fetch(internalApiUrl(`/api/me/native-push/devices/${encodeURIComponent(deviceId)}`), {
    method: 'DELETE',
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  return readJson<{ deleted: boolean }>(res, 'Delete native push device failed');
}

export async function fetchLocalMatchStartAlertSchedule(lookaheadHours = 48): Promise<LocalMatchStartAlertSchedule> {
  const qs = new URLSearchParams({ lookaheadHours: String(Math.max(1, Math.min(168, Math.floor(lookaheadHours)))) });
  const res = await fetch(internalApiUrl(`/api/me/native-push/local-match-start-alerts?${qs}`), {
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
    cache: 'no-store',
  });
  return readJson<LocalMatchStartAlertSchedule>(res, 'Load local match-start alert schedule failed');
}

export async function sendNativePushTest(): Promise<{
  attempted: number;
  delivered: number;
  failed: number;
  errors: string[];
}> {
  const res = await fetch(internalApiUrl('/api/me/native-push/test'), {
    method: 'POST',
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  return readJson(res, 'Send native push test failed');
}
