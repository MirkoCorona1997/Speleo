const CACHE_NAME = 'csr-grotte-v87';
const TILE_CACHE = 'csr-tiles-v87';
const DOC_CACHE = 'csr-docs-v87';
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
  'tile.opentopomap.org',
  'server.arcgisonline.com'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      Promise.all(APP_ASSETS.map(u => c.add(u).catch(() => null)))
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

  // CSR documents: network first when online, always update cache; cache when offline
  if (url.hostname.includes('catastospeleologicoregionale.sardegna.it')) {
    event.respondWith((async () => {
      const cache = await caches.open(DOC_CACHE);
      try {
        const res = await fetch(req, { redirect: 'follow' });
        // Cache real pages/PDFs (not tiny challenge pages if we can tell)
        if (res && (res.ok || res.type === 'opaque')) {
          try { await cache.put(req, res.clone()); } catch (e) {}
          try { await cache.put(url.href, res.clone()); } catch (e) {}
        }
        return res;
      } catch (e) {
        const cached = await cache.match(req) || await cache.match(url.href) || await cache.match(url.origin + url.pathname);
        if (cached) return cached;
        return new Response('Documento non disponibile offline. Aprilo una volta con connessione.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const net = fetch(req).then(res => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
  }
});
