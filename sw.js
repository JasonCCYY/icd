// App 本體：有網路時每次都向伺服器確認最新版（沒變動只回 304），離線才用快取。
// zh.json / 圖示：快取優先。若 zh.json 內容有更新，才需要改這個版本號。
const CACHE = 'icd10-v200';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'edu.html'];
const STATIC = ['zh.json', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled([...SHELL, ...STATIC].map(url =>
        fetch(url, { cache: 'reload' }).then(r => { if (r.ok) return c.put(url, r); })
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
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Always network-first for API calls
  if (url.hostname === 'clinicaltables.nlm.nih.gov') {
    e.respondWith(fetch(req).catch(() => new Response('[]')));
    return;
  }

  // Apps Script、Google 簡報等其他網域不經手
  if (url.origin !== self.location.origin) return;

  const isStatic = STATIC.some(f => url.pathname.endsWith('/' + f));
  if (isStatic) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return r;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(new Request(req.url, { cache: 'no-cache' }))
      .then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return r;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
