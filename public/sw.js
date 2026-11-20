const CACHE_NAME = 'bcv-calc-v2';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/css/app.css',
  '/js/app.js',
  '/js/calculator-view.js',
  '/js/change-view.js',
  '/js/clipboard.js',
  '/js/confirm.js',
  '/js/convert.js',
  '/js/expr.js',
  '/js/format.js',
  '/js/panel-view.js',
  '/js/profile-modal.js',
  '/js/profile-store.js',
  '/js/quick-calc.js',
  '/js/rates-api.js',
  '/js/rates-view.js',
  '/js/receipt.js',
  '/js/stale-check.js',
  '/js/storage.js',
  '/js/theme.js',
  '/js/toast.js',
  '/js/windows-store.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve cached API responses from SW: rates-api.js manages localStorage caching & staleness.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first with cache fallback so updates load immediately when online, and app works offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('/index.html');
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
