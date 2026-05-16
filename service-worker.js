const CACHE_NAME = 'arrowverse-tracker-v2';

const APP_SHELL = [
  './',
  './arrowverse.html',
  './arrowverse-app.js',
  './arrowverse-data.js',
  './arrowverse-analytics.js',
  './arrowverse-store.js',
  './config.js',
  './pwa-manifest.json',
  './icons/icon16.png',
  './icons/icon48.png',
  './icons/icon128.png',
  './icons/icon192.png',
  './icons/icon512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        const copy = response.clone();
        if (new URL(request.url).origin === self.location.origin) {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
