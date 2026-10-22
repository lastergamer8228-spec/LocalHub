/* LocalHub Service Worker — PWA offline shell.
 *
 * Caches the app shell (HTML/CSS/JS) so the dashboard loads instantly offline.
 * API calls (/api/*) and WebSocket are NEVER cached (auth + live data).
 * Uses a network-first strategy for navigation so fresh content wins, falling
 * back to the cache when offline.
 */
const CACHE = "localhub-shell-v1";
const SHELL = [
  "/",
  "/style.css",
  "/animations.css",
  "/animations.js",
  "/app.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache API, WebSocket, or cross-origin requests.
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws" ||
      url.origin !== self.location.origin) {
    return;
  }
  // Network-first for navigation + shell; fall back to cache.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((c) => c || caches.match("/")))
  );
});
