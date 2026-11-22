import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

interface SWExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SWPushMessageData {
  json(): unknown;
  text(): string;
}

interface SWPushEvent extends SWExtendableEvent {
  data: SWPushMessageData | null;
}

interface SWNotificationEvent extends SWExtendableEvent {
  notification: Notification;
}

interface SWWindowClient {
  url: string;
  focus(): Promise<SWWindowClient>;
  postMessage(message: unknown): void;
}

interface SWClients {
  claim(): Promise<void>;
  matchAll(options?: { type?: 'window' | 'worker' | 'sharedworker' | 'all'; includeUncontrolled?: boolean }): Promise<SWWindowClient[]>;
  openWindow(url: string): Promise<SWWindowClient | null>;
}

interface SWScope {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
  registration: ServiceWorkerRegistration;
  clients: SWClients;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install', listener: () => void): void;
  addEventListener(type: 'activate', listener: (event: SWExtendableEvent) => void): void;
  addEventListener(type: 'push', listener: (event: SWPushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: SWNotificationEvent) => void): void;
}

const sw = self as unknown as SWScope;

sw.addEventListener('install', () => {
  void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim());
});

cleanupOutdatedCaches();
// Keep literal `self.__WB_MANIFEST` so workbox-build can inject the precache manifest.
precacheAndRoute((self as unknown as SWScope).__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//],
  }),
);

interface KopiPushPayload {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  tab?: string;
}

sw.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload: KopiPushPayload = {};
  try {
    const parsed = event.data.json();
    if (parsed && typeof parsed === 'object') {
      payload = parsed as KopiPushPayload;
    }
  } catch {
    payload = { title: 'Kopi', body: event.data.text() };
  }

  const title = payload.title || 'Kopi';
  const options: NotificationOptions = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag,
    data: {
      url: payload.url || '/',
      tab: payload.tab || 'home',
    },
  };

  event.waitUntil(sw.registration.showNotification(title, options));
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data || {}) as { url?: string; tab?: string };
  const targetUrl = data.url || '/';

  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({ type: 'kopi:navigate', tab: data.tab || 'home' });
          return client.focus();
        }
      }
      return sw.clients.openWindow(targetUrl);
    }),
  );
});
