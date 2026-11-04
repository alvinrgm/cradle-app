// Cradle service worker: the app opens with no signal. The page and the shim are network-first (fresh after every
// deploy), everything else (fonts, icons) cache-first. Database calls are never cached.
const CACHE = "cradle-__BUILD__";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "cradle-shim.js", "feedback-pins.js", "manifest.webmanifest", "icon-180.png"]).catch(() => {}))); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.hostname.endsWith("supabase.co") || url.pathname.endsWith("version.json")) return;
  const page = req.mode === "navigate";
  const own = url.origin === location.origin && /\.(js|webmanifest)$/.test(url.pathname);
  if (page || own) {
    const key = page ? "./" : url.pathname.split("/").pop();
    e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(key, c)); } return r; })
      .catch(() => caches.match(key)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); }
    return r;
  })));
});
