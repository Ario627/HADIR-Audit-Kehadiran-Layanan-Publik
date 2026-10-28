const VERSION = 'hadir-v2';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const API = `${VERSION}-api`;
const PRECACHE = ['/', '/manifest.webmanifest'];
const API_PREFIX = '/v1/';
const ASSET_PREFIXES = ['/assets/', '/icons/'];
const PRIVATE_PREFIXES = [
  '/v1/reports/mine',
  '/v1/episodes',
  '/v1/devices',
  '/v1/partner',
  '/v1/admin',
  '/v1/internal',
  '/v1/uploads',
  '/v1/triage',
];
const API_MAX_ENTRIES = 80;
const SHELL_MAX_ENTRIES = 24;

function isPrivate(pathname) {
  return PRIVATE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) {
    return;
  }
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

function cacheable(response) {
  if (!response.ok || response.type === 'opaque') {
    return false;
  }
  const policy = response.headers.get('cache-control') || '';
  return !/no-store|private/i.test(policy);
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      await cache.put(request, response.clone());
      await trimCache(cacheName, API_MAX_ENTRIES);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (cacheable(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function navigateWithShell(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      await cache.put(request, response.clone());
      if (new URL(request.url).pathname === '/') {
        await cache.put('/', response.clone());
      }
      await trimCache(SHELL, SHELL_MAX_ENTRIES);
    }
    return response;
  } catch (error) {
    const exact = await cache.match(request);
    if (exact) {
      return exact;
    }
    const shell = await cache.match('/');
    if (shell) {
      return shell;
    }
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigateWithShell(request));
    return;
  }
  if (url.pathname.startsWith(API_PREFIX)) {
    if (isPrivate(url.pathname)) {
      return;
    }
    event.respondWith(networkFirst(request, API));
    return;
  }
  if (ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(request, ASSETS));
  }
});