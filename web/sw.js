const CACHE = "rasan-v1";
const ASSETS = ["/", "/index.html", "/style.css", "/app.js", "/i18n.js", "/crypto.js", "/manifest.json"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); return res;
  }).catch(() => caches.match("/index.html"))));
});
