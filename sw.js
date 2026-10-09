const CACHE_NAME = 'csr-grotte-v67';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll([
      './',
      './index.html',
      './app.js',
      './manifest.json',
      './grotte_sardegna.geojson'
    ]))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Don't intercept CDN / external (Leaflet, OSM tiles, proxies)
  if (url.origin !== self.location.origin) {
    return; // browser default
  }

  // App files: network first, fallback cache
  event.respondWith(
    fetch(event.request).then(res => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
