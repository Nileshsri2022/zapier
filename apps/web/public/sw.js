const CACHE_NAME = 'zapmate-static-v2';
// Never cache HTML, Next.js page data, or authenticated/API responses. The old
// cache-first pages could keep clients on an outdated deployment indefinitely.
const STATIC_ASSETS = ['/manifest.json', '/icons/icon-192x192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('zapmate-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Let the browser handle POSTs, cross-origin traffic (including the Render
  // API), and page loads directly. A service worker cannot fix a CORS failure.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    request.mode === 'navigate' ||
    !STATIC_ASSETS.includes(url.pathname)
  ) {
    return;
  }

  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(request))
      .then((response) => response || fetch(request))
  );
});
