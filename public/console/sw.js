/* ============================================================================
   CONSOLE SERVICE WORKER — the desk and the lane.

   Scope: `/console/`. That is not configured anywhere; it is the directory
   this file is served from, and a service worker's default scope is its own
   path. Registering it needs no `Service-Worker-Allowed` header, and the
   browser guarantees the isolation described below rather than this file
   asking politely for it.

   ============================================================================
   WHY THIS IS A SECOND WORKER AND NOT A BRANCH INSIDE /sw.js

   `/sw.js` is the member's app shell, and its policy is deliberate:

     "every authenticated or personal surface is network-only … If the member
      is offline, those routes fail, and failing is correct … a phone is
      shared, lent, sold and stolen, and a cached portal page survives
      sign-out because clearing a cookie does not clear the Cache API."

   That is right, and it must not change. It is also the exact opposite of
   what Build Specification §8 demands here:

     "The desk and lane surfaces work fully offline. Not read-only — fully."
     §2: "Cold start with no network must reach a usable desk screen in under
     one second."

   Both are true because they are different DEVICES, not different routes.
   §3.1: "Desk and lane surfaces load only on a registered, unrevoked device."
   A club tablet in a locked building is not a member's phone on a bus.

   The obvious implementation — one worker that checks which kind of device it
   is on — was rejected. It makes the isolation a conditional, and a
   conditional is one careless edit away from caching a member's portal page
   onto their handset. Two workers on two scopes means the member policy is
   physically unreachable from here: this file cannot cache `/portal` because
   this file never sees a request for `/portal`.

   ============================================================================
   WHAT THIS WORKER CACHES — AND WHAT IT MUST NEVER CACHE

   It caches the APPLICATION SHELL. HTML, JavaScript, CSS, icons. §2:
   "Full application shell and asset caching."

   It does NOT cache data. Not the day pack, not a roster, not an arrival
   list, not one API response. Those live in IndexedDB (§2: "Local store —
   IndexedDB"), written by application code that knows about device
   registration and can be wiped on revocation.

   That split is the whole security argument, and it is worth being explicit
   about why it is not merely tidy:

     · The Cache API is keyed by URL and survives sign-out, exactly as /sw.js
       warns. Data in it cannot be selectively expired by anything that
       understands what the data means.
     · §10 requires that a revoked tablet has "its cached day pack rendered
       unusable on next launch". Wiping an IndexedDB store is one call.
       Guaranteeing that no personal record is left in an opaque HTTP cache is
       not, because you have to know every URL that ever returned one.

   So: shell in the Cache API, data in IndexedDB. Anything under /api/ or
   /sync/ is network-only here, forever.
   ========================================================================= */

/* Bump on any change to this file or to PRECACHE. */
const VERSION = "v1";
const SHELL_CACHE = `armory-console-shell-${VERSION}`;

/**
 * The shell, precached on install so a cold start with no network works.
 *
 * §2 gives that start a one-second budget on the actual tablet being bought.
 * Meeting it means the desk's HTML and its JavaScript are on disk BEFORE the
 * morning it is needed — a network-first strategy with a cache fallback would
 * spend that second discovering the network is gone.
 */
const PRECACHE = ["/console", "/console/offline", "/icons/icon-192.png"];

/**
 * Never cached, on any device, ever.
 *
 * Data endpoints. See the header: the day pack belongs in IndexedDB where
 * revocation can reach it, not in an HTTP cache keyed by URL.
 */
const NEVER_CACHE = ["/api/", "/sync/"];

const isNeverCached = (pathname) =>
  NEVER_CACHE.some((p) => pathname === p || pathname.startsWith(p));

/* Content-hashed by the build, so a given URL's bytes never change. */
const isImmutable = (pathname) =>
  pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      /* Take over immediately. A desk tablet that is mid-shift should not be
         running last week's shell because nobody closed the tab — these
         devices are opened in the morning and left open all day. */
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            /* Only this worker's own caches. The member shell's caches are on
               the same origin and are none of this worker's business. */
            .filter((k) => k.startsWith("armory-console-") && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  /* Writes go through the outbox (§8.4), which is application code holding a
     durable queue in IndexedDB. A service worker must never replay a POST:
     it cannot know whether the write is idempotent, and it would be
     replaying it without the attribution §7 requires. */
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url.pathname)) return;

  if (isImmutable(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(shellFirst(request, event));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Cache-first for the shell, with a background refresh.
 *
 * The opposite of the member worker's network-first, and the reason is §2's
 * one-second cold start. On a range floor the network is frequently present
 * but useless — a captive portal, a saturated uplink, a 4G cell that accepts
 * the connection and then stalls. Network-first waits for that to time out
 * before it falls back, and the officer watches a blank screen with a shooter
 * in front of them.
 *
 * Serving the cached shell immediately and revalidating behind it means the
 * desk is usable in the time it takes to read from disk, and picks up a new
 * deploy on the next launch — which §2 accepts: "Updates reach club tablets
 * on next open."
 */
async function shellFirst(request, event) {
  const cached = await caches.match(request);

  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    /* Do not await the refresh — that is the whole point. `waitUntil` keeps
       the worker alive until the write lands, so a browser that kills an idle
       worker cannot truncate the cache update halfway. */
    event.waitUntil(refresh);
    return cached;
  }

  const response = await refresh;
  if (response) return response;

  const offline = await caches.match("/console/offline");
  if (offline) return offline;

  return new Response("The console is offline and has no cached shell.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/* ============================================================================
   REVOCATION — §10

   "A lost or stolen tablet can be revoked server-side, and its cached day
    pack rendered unusable on next launch."

   The data half of that is application code wiping IndexedDB (see
   src/offline/device.ts). This is the shell half: the page asks the worker to
   drop its caches and unregister, so a revoked tablet cannot even start the
   console offline to see what it last held.
   ========================================================================= */

self.addEventListener("message", (event) => {
  if (event.data?.type !== "ARMORY_REVOKE") return;

  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("armory-console-"))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.registration.unregister())
      .catch(() => undefined),
  );
});
