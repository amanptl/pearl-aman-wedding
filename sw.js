/* Service worker: offline itinerary. Owner: utilities agent.
 *
 * INTEGRATOR: when you add/remove/rename a file under src/ (js or css) or add a page, update SHELL below
 * (tests/unit/sw.test.mjs fails if src/**\/*.js|css and SHELL drift apart). Bump VERSION on any release
 * whose cached files must be refreshed; old caches are deleted on activate.
 */
const VERSION = "v12";
const SHELL_CACHE = `pa-shell-${VERSION}`;
const RUNTIME_CACHE = `pa-runtime-${VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "content/content.json",
  "assets/icons/icon-192.png",
  "assets/icons/favicon.svg",
  "assets/icons/apple-touch-icon.png",
  "assets/img/og.jpg",
  "src/main.js",
  "src/lib/calendar.js",
  "src/lib/crypto.js",
  "src/lib/dom.js",
  "src/lib/film.js",
  "src/lib/guest.js",
  "src/lib/guestfiles.js",
  "src/lib/icons.js",
  "src/lib/maps.js",
  "src/lib/pwa.js",
  "src/lib/store.js",
  "src/lib/time.js",
  "src/lib/ui.js",
  "src/pages/_lookup.js",
  "src/pages/faq.js",
  "src/pages/home.js",
  "src/pages/registry.js",
  "src/pages/rsvp.js",
  "src/pages/schedule.js",
  "src/pages/story.js",
  "src/pages/travel.js",
  "src/styles/site.css",
  "src/styles/fonts.css", "src/styles/tokens.css",
  "src/styles/base.css",
  "src/styles/pages/faq.css",
  "src/styles/pages/home.css",
  "src/styles/pages/lookup.css",
  "src/styles/pages/registry.css",
  "src/styles/pages/rsvp.css",
  "src/styles/pages/schedule.css",
  "src/styles/pages/story.css",
  "src/styles/pages/travel.css",
];

const NEVER = [/^script\.google\.com$/, /(^|\.)googleusercontent\.com$/, /(^|\.)github\.com$/, /(^|\.)githubusercontent\.com$/];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Tolerate a missing optional file (e.g. icons not generated yet) but not a failed index.
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith("pa-") && k !== SHELL_CACHE && k !== RUNTIME_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

const cacheable = (res) => res && (res.ok || res.type === "opaque");

const NETWORK_WAIT_MS = 4000;

/**
 * Network first, but on a very slow connection ("lie-fi") fall back to the cached copy after NETWORK_WAIT_MS instead of
 * leaving the guest staring at a blank page. The slow request keeps running and refreshes the cache for next time.
 */
async function networkFirst(req, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  const lookup = async () => (await cache.match(req, { ignoreSearch: true })) || (fallbackKey && (await caches.match(fallbackKey)));
  const net = fetch(req).then((res) => {
    if (cacheable(res) && res.status !== 206) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  const cached = await lookup();
  if (!cached) return net;
  net.catch(() => {}); // a late failure after the cached copy was served is not an error
  const slow = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_WAIT_MS));
  try { return await Promise.race([net, slow]); } catch (err) { return cached; }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (cacheable(res) && res.status !== 206) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (hit) { refresh.catch(() => {}); return hit; }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (NEVER.some((re) => re.test(url.hostname))) return; // Apps Script, GitHub API: never cached
  if (url.origin === location.origin && /\/edit(\/|$)/.test(url.pathname)) return; // the editor
  if (url.origin === location.origin && url.searchParams.get("edit") === "1") return;

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }
  if (url.origin !== location.origin) return;

  const scopePath = new URL("./", self.registration.scope).pathname;
  const rel = url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : url.pathname;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, SHELL_CACHE, new Request("index.html")).catch(() => caches.match("index.html")));
    return;
  }
  if (rel.startsWith("content/") && rel.endsWith(".json")) { event.respondWith(networkFirst(req, SHELL_CACHE)); return; }
  if (rel.startsWith("assets/")) { event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE)); return; }
  if (rel.startsWith("src/") || rel === "manifest.webmanifest") { event.respondWith(networkFirst(req, SHELL_CACHE)); return; }
});
