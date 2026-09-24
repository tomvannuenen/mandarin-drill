// Offline support. VERSION is stamped by tools/build.py whenever app files change.
const VERSION = '8c67af3ca88f';
const SHELL_CACHE = `shell-${VERSION}`;
const AUDIO_CACHE = 'audio-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'lib/tones.js',
  'lib/srs.js',
  'lib/cards.js',
  'lib/session.js',
  'lib/store.js',
  'vendor/ts-fsrs.js',
  'manifest.webmanifest',
  'phrases.json',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request, { cache: 'no-store' });
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/phrases.json')) event.respondWith(networkFirst(event.request));
  else if (url.pathname.includes('/audio/')) event.respondWith(cacheFirst(event.request, AUDIO_CACHE));
  else event.respondWith(cacheFirst(event.request, SHELL_CACHE));
});

// The app sends every audio URL after load; fetch the ones not cached yet, a few at a time.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-audio') return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(AUDIO_CACHE);
      const missing = [];
      for (const u of event.data.urls) if (!(await cache.match(u))) missing.push(u);
      for (let i = 0; i < missing.length; i += 6) {
        await Promise.all(missing.slice(i, i + 6).map((u) => cache.add(u).catch(() => {})));
      }
    })()
  );
});
