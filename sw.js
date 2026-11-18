const CACHE_NAME = 'csr-grotte-v119';
const TILE_CACHE = 'csr-tiles-v119';
const DOC_CACHE = 'csr-docs-v119';
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
  './images/marker-shadow.png',
  './pdf.min.js',
  './pdf.worker.min.js'
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

  if (url.hostname.includes('catastospeleologicoregionale.sardegna.it')) {
    event.respondWith((async () => {
      const cache = await caches.open(DOC_CACHE);
      const matchOpts = { ignoreSearch: true, ignoreVary: true };
      const findCached = async () =>
        (await cache.match(req, matchOpts)) ||
        (await cache.match(url.href, matchOpts)) ||
        (await cache.match(url.origin + url.pathname, matchOpts));

      if (!self.navigator.onLine) {
        const cached = await findCached();
        if (cached) return cached;
        return new Response(
          '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;background:#111;color:#eee"><h3>Documento non in cache</h3><p>Apri questo documento online almeno una volta.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      try {
        const res = await fetch(req, { redirect: 'follow', credentials: 'omit' });
        if (res && (res.ok || res.type === 'opaque')) {
          try { await cache.put(req, res.clone()); } catch (e) {}
          try { await cache.put(url.href, res.clone()); } catch (e) {}
        }
        return res;
      } catch (e) {
        const cached = await findCached();
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    // Cache-first for app shell (works offline)
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
