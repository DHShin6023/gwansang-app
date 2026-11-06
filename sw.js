const CACHE = 'gwansang-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './saju.js',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('openrouter.ai') ||
      e.request.url.includes('fonts.googleapis')) return;

  // HTML·JS·CSS는 네트워크 우선 → 항상 최신 코드 반영 (HTML과 JS 버전 불일치 방지)
  if (e.request.mode === 'navigate' || e.request.url.match(/\.(js|css|html)(\?.*)?$/)) {
    // cache:'no-cache' — 브라우저 HTTP 캐시(Pages max-age=600)를 건너뛰고 서버에 재확인
    const fresh = e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request, { cache: 'no-cache' });
    e.respondWith(
      fresh.then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 나머지는 캐시 우선
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
