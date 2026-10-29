// Rasan service worker — network-first for app shell, never cache API/socket.
// (UX audit: cache-first for everything caused stale assets + unbounded cache growth)
const CACHE = "rasan-v2";
const PRECACHE = [
  "/", "/index.html", "/style.css", "/app.js", "/i18n.js", "/crypto.js",
  "/identity.js", "/session.js", "/ui-identity.js", "/vendor/qrcode.min.js", "/manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;                      // let cross-origin pass through
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return; // never cache dynamic data
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});
