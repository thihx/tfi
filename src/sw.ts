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

self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; tag?: string; url?: string } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }

  const title = payload.title ?? 'TFI';
  const options: NotificationOptions & { renotify?: boolean; requireInteraction?: boolean } = {
    body: payload.body ?? '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag ?? 'tfi-notification',
    renotify: true,
    requireInteraction: true,
    data: { url: payload.url ?? '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click handler ─────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawUrl: string = (event.notification.data as { url?: string })?.url ?? '/';
  // Append ?tab= hint so the app can navigate to the right tab on open/focus
  const targetUrl = rawUrl.includes('?') ? rawUrl : `${rawUrl}?tab=recommendations`;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it and post a navigate message
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.postMessage({ type: 'tfi:navigate', tab: 'recommendations' });
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
