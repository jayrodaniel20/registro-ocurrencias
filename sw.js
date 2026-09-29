const CACHE_VERSION = 'sage-v2.2.2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = './index.html';
const STATIC_ASSETS = [
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './logo-sage.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('sage-') && k !== STATIC_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Siempre consultar la red para navegación y archivos que determinan la versión.
  if (req.mode === 'navigate' || url.pathname.endsWith('/version.json') || url.pathname.endsWith('/manifest.webmanifest') || url.pathname.endsWith('/sw.js')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (req.mode === 'navigate' && fresh.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(OFFLINE_URL, fresh.clone());
        }
        return fresh;
      } catch (e) {
        if (req.mode === 'navigate') return (await caches.match(OFFLINE_URL)) || Response.error();
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // Recursos estáticos: sirve rápido desde caché y revalida en segundo plano.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(async fresh => {
      if (fresh && fresh.ok) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
