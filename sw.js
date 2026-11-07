// 학교 캘린더 서비스워커: 앱 화면은 저장해 두고(오프라인에서도 열림), 학교 자료는 항상 새로 받아요.
const CACHE = 'school-calendar-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'config.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 네트워크 우선, 안 되면 저장해 둔 것
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request.url.split('?')[0], copy)); }
    return r;
  }).catch(() => caches.match(e.request.url.split('?')[0]).then(m => m || caches.match('index.html'))));
});
