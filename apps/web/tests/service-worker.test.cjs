const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test, mock } = require('node:test');
const { runInNewContext } = require('node:vm');

const ORIGIN = 'https://zapier-qwltqdtk3-nilesh-srivastavas-projects.vercel.app';
const CACHE_NAME = 'zapmate-static-v2';
const source = readFileSync(join(__dirname, '../public/sw.js'), 'utf8');

function createWorker() {
  const handlers = {};
  const cache = {
    addAll: mock.fn(async () => {}),
    match: mock.fn(async () => undefined),
  };
  const caches = {
    open: mock.fn(async () => cache),
    match: mock.fn(async () => undefined),
    keys: mock.fn(async () => ['zapmate-v1', CACHE_NAME, 'another-app-cache']),
    delete: mock.fn(async () => true),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name, handler) => {
      handlers[name] = handler;
    },
    skipWaiting: mock.fn(async () => {}),
    clients: { claim: mock.fn(async () => {}) },
  };
  const networkResponse = { status: 200 };
  const fetch = mock.fn(async () => networkResponse);
  runInNewContext(source, { self, caches, fetch, URL });

  const dispatchFetch = (url, overrides = {}) => {
    const event = {
      request: { url, method: 'GET', mode: 'cors', ...overrides },
      respondWith: mock.fn(),
    };
    handlers.fetch(event);
    return event;
  };

  return { handlers, cache, caches, self, fetch, networkResponse, dispatchFetch };
}

test('install caches only public static assets and activates the fix immediately', async () => {
  const { handlers, cache, caches, self } = createWorker();
  const event = { waitUntil: mock.fn() };
  handlers.install(event);
  await event.waitUntil.mock.calls[0].arguments[0];

  assert.equal(caches.open.mock.calls[0].arguments[0], CACHE_NAME);
  assert.deepEqual(Array.from(cache.addAll.mock.calls[0].arguments[0]), [
    '/manifest.json',
    '/icons/icon-192x192.png',
  ]);
  assert.equal(self.skipWaiting.mock.callCount(), 1);
});

test('activation deletes stale ZapMate page caches, preserves other caches, and claims clients', async () => {
  const { handlers, caches, self } = createWorker();
  assert.equal(typeof handlers.activate, 'function');
  const event = { waitUntil: mock.fn() };
  handlers.activate(event);
  await event.waitUntil.mock.calls[0].arguments[0];

  assert.deepEqual(
    caches.delete.mock.calls.map((call) => call.arguments[0]),
    ['zapmate-v1']
  );
  assert.equal(self.clients.claim.mock.callCount(), 1);
});

for (const [name, url, options] of [
  [
    'the reported signup POST',
    'https://zapier-fd68.onrender.com/api/auth/signup',
    { method: 'POST' },
  ],
  ['same-origin auth POSTs', `${ORIGIN}/api/auth/signin`, { method: 'POST' }],
  ['same-origin API reads', `${ORIGIN}/api/auth/me`, {}],
  ['cross-origin reads', 'https://zapier-fd68.onrender.com/api/auth/me', {}],
  ['cross-origin static assets', 'https://other.example.com/manifest.json', {}],
  ['non-GET static requests', `${ORIGIN}/manifest.json`, { method: 'POST' }],
  ['the cached login page', `${ORIGIN}/login`, { mode: 'navigate' }],
  ['private dashboard pages', `${ORIGIN}/dashboard`, { mode: 'navigate' }],
  ['the home page', `${ORIGIN}/`, { mode: 'navigate' }],
  ['Next.js page data', `${ORIGIN}/dashboard?_rsc=123`, {}],
  ['Next.js bundles', `${ORIGIN}/_next/static/chunks/app.js`, {}],
]) {
  test(`leaves ${name} to the browser without intercepting or caching`, () => {
    const { dispatchFetch, caches, fetch } = createWorker();
    const event = dispatchFetch(url, options);
    assert.equal(event.respondWith.mock.callCount(), 0);
    assert.equal(caches.open.mock.callCount(), 0);
    assert.equal(caches.match.mock.callCount(), 0);
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test('serves static assets from the current cache, not stale caches', async () => {
  const { dispatchFetch, cache, caches, fetch } = createWorker();
  const cachedResponse = { status: 200, body: 'cached icon' };
  cache.match.mock.mockImplementation(async () => cachedResponse);
  const event = dispatchFetch(`${ORIGIN}/icons/icon-192x192.png`);
  const response = await event.respondWith.mock.calls[0].arguments[0];

  assert.equal(response, cachedResponse);
  assert.equal(caches.open.mock.calls[0].arguments[0], CACHE_NAME);
  assert.equal(caches.match.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('fetches a public static asset when it is not cached', async () => {
  const { dispatchFetch, fetch, networkResponse } = createWorker();
  const event = dispatchFetch(`${ORIGIN}/manifest.json`);
  const response = await event.respondWith.mock.calls[0].arguments[0];

  assert.equal(response, networkResponse);
  assert.equal(fetch.mock.calls[0].arguments[0], event.request);
});
