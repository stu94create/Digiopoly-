// Service worker for The Telly. Scoped to the telly/ folder so it runs
// independently of Digiopoly's root service worker and never touches its cache.
// Bump this version when the app shell changes so clients pick up the new build.
const CACHE = 'the-telly-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-512.png',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Only clear OUR own stale versions. Never delete caches belonging to
      // Digiopoly (or anything else) that share this origin.
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('the-telly-') && k !== CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Let cross-origin requests (the YouTube player, video, images) go straight
  // to the network — they must never be served from our cache.
  if (url.origin !== self.location.origin) return;
  // Only manage assets inside our own folder.
  if (!url.pathname.includes('/telly/')) return;

  // Cache-first with background refresh: the TV interface opens instantly, even
  // offline, and the cache is quietly updated for next launch. If the cache was
  // ever wiped by another worker on this origin, the network response re-fills it.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
