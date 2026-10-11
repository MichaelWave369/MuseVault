/* Offline app shell. No telemetry and no background uploads. */
const CACHE = 'musevault-shell-v1';
const SCOPE = self.registration.scope;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([SCOPE, SCOPE + 'index.html', SCOPE + 'favicon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('musevault-shell-') && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE).then(cache => cache.put(SCOPE, copy));
      }
      return response;
    }).catch(async () => (await caches.match(SCOPE)) || Response.error()));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      void caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'PRECACHE' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.slice(0, 40).filter(url => typeof url === 'string' && url.startsWith(SCOPE));
  event.waitUntil(caches.open(CACHE).then(cache =>
    Promise.all(urls.map(url => cache.add(url).catch(() => {})))
  ));
});
