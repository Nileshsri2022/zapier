const CACHE_NAME = 'zapmate-v1';
const urlsToCache = [
    '/',
    '/dashboard',
    '/login',
    '/manifest.json',
    '/icons/icon-192x192.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => response || fetch(event.request))
    );
});
