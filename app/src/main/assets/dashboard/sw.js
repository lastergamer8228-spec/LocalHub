/* LocalHub Service Worker — PWA offline shell.
 *
 * Caches the app shell (HTML/CSS/JS) so the dashboard loads instantly offline.
 * API calls (/api/*) and WebSocket are NEVER cached (auth + live data).
 * Uses a network-first strategy for navigation so fresh content wins, falling
 * back to the cache when offline.
 *
 * IMPORTANT — the cache name is a version, not a label.
 * ------------------------------------------------------
 * The name below is the ONLY thing that invalidates a previous shell. The
 * activate handler deletes every cache whose name differs from it, so if you
 * ship a change and leave the name alone, returning users keep being served
 * the previous HTML — which is exactly how the redesign went invisible: the
 * cached index.html had no <link> to the new stylesheets, so the browser never
 * asked for them.
 *
 * RULE: bump CACHE_VERSION whenever any shell file changes.
 */
const CACHE_VERSION = "v2";
const CACHE = "localhub-shell-" + CACHE_VERSION;

const SHELL = [
  "/",
  "/login.html",
  // stylesheets, in load order
  "/style.css",
  "/theme-pro.css",
  "/tokens.css",
  "/components.css",
  "/motion.css",
  "/animations.css",
  // scripts
  "/animations.js",
  "/app.js",
  "/nav.js",
  "/components.js",
  "/motion.js",
  // PWA
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One missing 404 in addAll rejects the whole install, so seed the cache
      // without letting a single optional asset block the shell.
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Allows the page to request an immediate update instead of waiting for the
   browser's own check (which can lag by a day). Call from the app after a
   server restart or a version change:
       navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" }) */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache API, WebSocket, or cross-origin requests.
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws" ||
      url.origin !== self.location.origin) {
    return;
  }
  // Non-GET (uploads, form posts) must hit the network untouched.
  if (event.request.method !== "GET") return;

  // Network-first for navigation + shell; fall back to cache when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Only cache a real, successful, same-origin response.
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((c) => c || caches.match("/")))
  );
});
