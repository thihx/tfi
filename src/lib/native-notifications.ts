import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { FirebaseMessaging, Importance, Visibility } from '@capacitor-firebase/messaging';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  deleteNativePushDevice,
  fetchLocalMatchStartAlertSchedule,
  registerNativePushDevice,
  type LocalMatchStartAlert,
  type NativePushPlatform,
} from '@/lib/services/native-push';

const CRITICAL_CHANNEL_ID = 'critical_alerts';
const SCHEDULED_IDS_STORAGE_KEY = 'tfi_native_local_match_start_notification_ids';

function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

function toNativePlatform(value: string): NativePushPlatform | null {
  return value === 'ios' || value === 'android' ? value : null;
}

function stableNotificationId(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function readStoredScheduledIds(): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCHEDULED_IDS_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => Number.isInteger(value))
      : [];
  } catch {
    return [];
  }
}

function writeStoredScheduledIds(ids: number[]): void {
  localStorage.setItem(SCHEDULED_IDS_STORAGE_KEY, JSON.stringify(Array.from(new Set(ids))));
}

function dispatchOpenMatch(matchId: unknown, matchDisplay: unknown): void {
  if (typeof matchId !== 'string' || !matchId.trim()) return;
  window.dispatchEvent(new CustomEvent('tfi:nativeNotificationOpen', {
    detail: {
      matchId,
      matchDisplay: typeof matchDisplay === 'string' ? matchDisplay : '',
      tab: 'matches',
    },
  }));
}

function notificationData(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function localNotificationId(alert: LocalMatchStartAlert): number {
  return stableNotificationId(`match-start:${alert.ruleId}:${alert.matchId}`);
}

async function showForegroundRemoteNotification(notification: {
  title?: string;
  body?: string;
  data?: unknown;
}): Promise<void> {
  const title = notification.title?.trim() || 'TFI alert';
  const body = notification.body?.trim() || 'Open TFI for details.';
  const data = notificationData(notification.data);
  await LocalNotifications.schedule({
    notifications: [{
      id: stableNotificationId(`remote:${title}:${body}:${Date.now()}`),
      title,
      body,
      largeBody: body,
      schedule: { at: new Date(Date.now() + 250), allowWhileIdle: true },
      channelId: CRITICAL_CHANNEL_ID,
      autoCancel: true,
      interruptionLevel: 'timeSensitive',
      extra: data,
    }],
  }).catch(() => undefined);
}

async function ensureAndroidChannels(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  await FirebaseMessaging.createChannel({
    id: CRITICAL_CHANNEL_ID,
    name: 'Critical alerts',
    description: 'Live match and critical recommendation alerts',
    importance: Importance.High,
    visibility: Visibility.Public,
    vibration: true,
  }).catch(() => undefined);
  await LocalNotifications.createChannel({
    id: CRITICAL_CHANNEL_ID,
    name: 'Critical alerts',
    description: 'Kick-off and live match alerts',
    importance: 4,
    visibility: 1,
    vibration: true,
  }).catch(() => undefined);
}

async function ensureNotificationPermissions(): Promise<boolean> {
  const pushPermission = await FirebaseMessaging.checkPermissions().catch(() => ({ receive: 'denied' as const }));
  const pushGranted = pushPermission.receive === 'granted'
    || (await FirebaseMessaging.requestPermissions().catch(() => ({ receive: 'denied' as const }))).receive === 'granted';

  const localPermission = await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' as const }));
  const localGranted = localPermission.display === 'granted'
    || (await LocalNotifications.requestPermissions().catch(() => ({ display: 'denied' as const }))).display === 'granted';

  return pushGranted && localGranted;
}

async function registerCurrentDevice(localNotificationsEnabled: boolean): Promise<string | null> {
  const platform = toNativePlatform(Capacitor.getPlatform());
  if (!platform) return null;

  const [id, info, appInfo, tokenResult] = await Promise.all([
    Device.getId(),
    Device.getInfo(),
    CapacitorApp.getInfo(),
    FirebaseMessaging.getToken(),
  ]);

  if (!tokenResult.token) return null;

  await registerNativePushDevice({
    deviceId: id.identifier,
    platform,
    provider: 'fcm',
    token: tokenResult.token,
    appVersion: appInfo.version,
    deviceName: info.model ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localNotificationsEnabled,
    metadata: {
      capacitor: true,
      operatingSystem: info.operatingSystem,
      osVersion: info.osVersion,
      manufacturer: info.manufacturer,
    },
  });

  return id.identifier;
}

export async function syncNativeLocalMatchStartAlarms(lookaheadHours = 48): Promise<number> {
  if (!isNativePlatform()) return 0;

  const permission = await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' as const }));
  if (permission.display !== 'granted') return 0;

  const schedule = await fetchLocalMatchStartAlertSchedule(lookaheadHours);
  const now = Date.now();
  const upcoming = schedule.alerts.filter((alert) => Date.parse(alert.fireAtUtc) > now);
  const nextIds = upcoming.map(localNotificationId);
  const previousIds = readStoredScheduledIds();
  const staleIds = previousIds.filter((id) => !nextIds.includes(id));
  if (staleIds.length > 0) {
    await LocalNotifications.cancel({ notifications: staleIds.map((id) => ({ id })) }).catch(() => undefined);
  }

  if (upcoming.length > 0) {
    await LocalNotifications.schedule({
      notifications: upcoming.map((alert) => {
        const matchDisplay = `${alert.homeTeam} vs ${alert.awayTeam}`;
        return {
          id: localNotificationId(alert),
          title: 'Kick-off alert',
          body: `${matchDisplay} starts soon`,
          largeBody: `${matchDisplay}\n${alert.league}`,
          schedule: { at: new Date(alert.fireAtUtc), allowWhileIdle: true },
          channelId: CRITICAL_CHANNEL_ID,
          autoCancel: true,
          interruptionLevel: 'timeSensitive',
          extra: {
            matchId: alert.matchId,
            matchDisplay,
            ruleId: alert.ruleId,
            type: 'match_start',
          },
        };
      }),
    });
  }

  writeStoredScheduledIds(nextIds);
  return nextIds.length;
}

export async function initializeNativeNotificationBridge(): Promise<() => void> {
  if (!isNativePlatform()) return () => undefined;

  await ensureAndroidChannels();
  const permissionsGranted = await ensureNotificationPermissions();
  const deviceId = await registerCurrentDevice(permissionsGranted);
  if (permissionsGranted) {
    await syncNativeLocalMatchStartAlarms();
  }

  const listeners: PluginListenerHandle[] = [];
  listeners.push(await FirebaseMessaging.addListener('tokenReceived', (event) => {
    void registerCurrentDevice(permissionsGranted && Boolean(event.token));
  }));
  listeners.push(await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
    const data = notificationData(event.notification.data);
    dispatchOpenMatch(data.matchId, data.matchDisplay);
  }));
  listeners.push(await FirebaseMessaging.addListener('notificationReceived', (event) => {
    void showForegroundRemoteNotification(event.notification);
  }));
  listeners.push(await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const data = notificationData(event.notification.extra);
    dispatchOpenMatch(data.matchId, data.matchDisplay);
  }));
  listeners.push(await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void syncNativeLocalMatchStartAlarms();
  }));
  const syncOnAlertChange = () => {
    void syncNativeLocalMatchStartAlarms();
  };
  window.addEventListener('tfi:matchAlertScheduleChanged', syncOnAlertChange);

  return () => {
    listeners.forEach((listener) => {
      void listener.remove();
    });
    window.removeEventListener('tfi:matchAlertScheduleChanged', syncOnAlertChange);
    if (deviceId) {
      void deleteNativePushDevice(deviceId);
    }
  };
}
