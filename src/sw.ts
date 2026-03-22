/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope;

// Precache all assets injected by VitePWA at build time
precacheAndRoute(self.__WB_MANIFEST);

// ── Runtime caching — GAS proxy ────────────────────────────
registerRoute(
  ({ url }) => url.hostname === 'script.google.com',
  new NetworkFirst({
    cacheName: 'gas-proxy-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 }),
    ],
  }),
);

// ── Push notification handler ──────────────────────────────

const DEFAULT_NOTIFICATION_DURATION_MS = 10_000; // 10 seconds

self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; tag?: string; url?: string; duration?: number } = {};
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
    icon: '/pwa-192x192.png',
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
    ? { type: 'tfi:openMatchDetail', matchId, matchDisplay }
    : { type: 'tfi:navigate', tab: 'recommendations' };

  // Open URL without ?tab= — we keep the user on their current page
  const targetUrl = matchId ? `/?match=${matchId}&matchDisplay=${encodeURIComponent(matchDisplay)}` : '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it and send message to open modal
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.postMessage(msg);
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
