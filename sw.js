const CACHE = 'icd10-v59';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/zh.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(ASSETS.map(url =>
        fetch(url, { cache: 'no-store' }).then(r => c.put(url, r))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network-first for API calls
  if (url.hostname === 'clinicaltables.nlm.nih.gov') {
    e.respondWith(fetch(e.request).catch(() => new Response('[]')));
    return;
  }

  // Cache-first for app shell
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
