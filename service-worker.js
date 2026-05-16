const CACHE_NAME = 'arrowverse-tracker-v3';

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

function isAppRequest(url) {
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.origin === self.location.origin
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Ignore extension URLs, analytics, CDNs, etc. — only cache this origin.
  if (!isAppRequest(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }).catch(() => caches.match('./arrowverse.html'))
  );
});
