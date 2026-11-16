const CACHE_NAME = 'csr-grotte-v86';
const TILE_CACHE = 'csr-tiles-v86';
const DOC_CACHE = 'csr-docs-v86';
const APP_ASSETS = [
  './',
  './index.html',
  './app.js',
  './sw.js',
  './manifest.json',
  './grotte_sardegna.geojson',
  './leaflet.js',
  './leaflet.css',
  './icon-192.png',
  './icon-512.png',
  './images/marker-icon.png',
  './images/marker-icon-2x.png',
  './images/marker-shadow.png'
];

const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'tile.opentopomap.org',
  'a.tile.opentopomap.org',
  'b.tile.opentopomap.org',
  'c.tile.opentopomap.org',
  'server.arcgisonline.com'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      Promise.all(APP_ASSETS.map(u => c.add(u).catch(err => console.warn('cache skip', u, err))))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== TILE_CACHE && k !== DOC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isTile(url) {
  return TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Map tiles: cache-first, then network and store
  if (isTile(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(req).then(cached => {
          const net = fetch(req).then(res => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
          return cached || net;
        })
      )
    );
    return;
  }


  // CSR PDF / schede: cache for offline
  if (url.hostname.includes('catastospeleologicoregionale.sardegna.it')) {
    event.respondWith((async () => {
      const cache = await caches.open(DOC_CACHE);
      const cached = await cache.match(req) || await cache.match(url.href);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone());
          cache.put(url.href, res.clone());
        }
        return res;
      } catch (e) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Same origin: cache-first for app shell, network update in background
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const net = fetch(req).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
  }
});
