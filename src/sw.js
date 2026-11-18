// SplitLink service worker: offline support with stale-while-revalidate.
// VERSION is replaced at build time so each deploy gets a fresh cache.
const VERSION = '__VERSION__';
const CACHE = 'splitlink-' + VERSION;
const CORE = ['./', './app/', './terms/', './privacy/', './site.css', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('splitlink-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Navigations are cached per page (query and hash ignored), e.g. /app/?demo → /app/.
function cacheKey(req) {
  const url = new URL(req.url);
  if (req.mode !== 'navigate') return req;
  let p = url.pathname.replace(/index\.html$/, '');
  if (!p.endsWith('/')) p += '/';
  return new Request(url.origin + p);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = cacheKey(req);
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(key, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => { if (res.ok) cache.put(key, res.clone()); return res; })
        .catch(async () => hit || (req.mode === 'navigate' && (await cache.match(new URL('./app/', self.location).href))) || Response.error());
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    }),
  );
});
