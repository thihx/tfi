/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// Take over immediately when a new SW version is installed
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Precache all assets injected by VitePWA at build time
precacheAndRoute(self.__WB_MANIFEST);

// ── Push notification handler ──────────────────────────────

const DEFAULT_NOTIFICATION_DURATION_MS = 10_000; // 10 seconds

self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; tag?: string; url?: string; icon?: string; duration?: number } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }

  const title = payload.title ?? 'TFI';
  const tag = payload.tag ?? 'tfi-notification';
  const durationMs = payload.duration ?? DEFAULT_NOTIFICATION_DURATION_MS;

  const options: NotificationOptions & { renotify?: boolean } = {
    body: payload.body ?? '',
    icon: payload.icon?.trim() || '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag,
    renotify: true,
    data: { url: payload.url ?? '/' },
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(async () => {
            const notes = await self.registration.getNotifications({ tag });
            notes.forEach((n) => n.close());
            resolve();
          }, durationMs);
        }),
    ),
  );
});

// ── Notification click handler ─────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Extract matchId from tag (format: "tfi-rec-{matchId}")
  const tag: string = event.notification.tag ?? '';
  const matchId = tag.startsWith('tfi-rec-') ? tag.slice('tfi-rec-'.length) : '';
  // matchDisplay is the first line of the notification body
  const matchDisplay = event.notification.body?.split('\n')[0] ?? '';

  const msg = matchId
    ? { type: 'tfi:openMatchDetail', matchId, matchDisplay, tab: 'matches' as const }
    : { type: 'tfi:navigate', tab: 'recommendations' };

  const targetUrl = matchId
    ? `/?tab=matches&match=${encodeURIComponent(matchId)}&matchDisplay=${encodeURIComponent(matchDisplay)}`
    : '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (!client.url.startsWith(self.location.origin) || !('focus' in client)) continue;
          const wc = client as WindowClient;
          if (wc.focused) {
            // App is in foreground — postMessage is reliable
            wc.postMessage(msg);
            return wc.focus();
          }
          // App is in background: call focus() synchronously within user gesture context
          // (await would break the gesture chain and prevent OS window focus on Windows),
          // then navigate so App.tsx reads ?match= params on the 'focus' event
          return wc.focus().then((focused) => {
            if (focused) focused.navigate(targetUrl).catch(() => undefined);
            return focused;
          });
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
