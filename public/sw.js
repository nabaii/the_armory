/* ============================================================================
   SERVICE WORKER

   Two jobs, in this order of importance:

   1. INSTALLABILITY. Chrome will not offer "Install app" on Android without a
      service worker that handles `fetch`. The manifest and icons are necessary
      and not sufficient. Since installing on a member's phone is the entire
      point of this exercise, this file is load-bearing even if it cached
      nothing at all.

   2. A USABLE OFFLINE STATE. Range floors and basements are where members will
      actually open this. The dinosaur page is a bad answer for a club they pay
      to belong to.

   ============================================================================
   WHAT IS DELIBERATELY NOT CACHED — read before adding anything here

   `(member)/layout.tsx` sets `dynamic = "force-dynamic"` and says why: "a
   cached portal page is one member's data served to another". That warning is
   about the server cache. A service worker is a SECOND cache, it lives on the
   device, and it is the more dangerous of the two — a phone is shared, lent,
   sold and stolen, and a cached portal page survives sign-out because clearing
   a cookie does not clear the Cache API.

   So every authenticated or personal surface is network-only here. Not
   network-first — network-ONLY, with no fallback entry ever written. If the
   member is offline, those routes fail, and failing is correct: the honest
   outcome for "show me my membership status" with no network is an error, not
   a copy of what it said last Tuesday.

   The same applies to `/screen`, for a different reason. It is a live
   tournament display on a wall; stale scores shown confidently are worse than
   a blank screen, because nobody watching it knows to doubt it.

   Anything added to NEVER_CACHE must stay a prefix match on pathname, and
   anything added to the site that carries personal data must be added here.
   ========================================================================= */

/* Bump on any change to this file or to PRECACHE. Old caches are deleted on
   activate, so the version is what makes a deploy take effect rather than
   leaving members on last month's shell. */
const VERSION = "v1";
const SHELL_CACHE = `armory-shell-${VERSION}`;
const PAGE_CACHE = `armory-pages-${VERSION}`;

/**
 * Cache names this worker owns, and nothing else.
 *
 * The Cache API is scoped to the ORIGIN, not to the service worker. So
 * `caches.keys()` here also returns the console worker's caches
 * (`armory-console-shell-*`), and on a club tablet both workers are registered
 * at once — this one for `/`, the console's for `/console/`.
 *
 * That makes the cleanup below dangerous if it is written as "delete everything
 * that is not mine". It was, and the consequence was specific: bumping VERSION
 * in this file wiped the desk's precached shell, so the next cold start with no
 * network reached the 503 instead of the Today screen — §2 and §8 broken by a
 * deploy to the member site, on a device the member site never runs on.
 *
 * Scoping deletion to this worker's own prefixes is the fix. The console worker
 * already does the same in the other direction. Two workers sharing one origin
 * only stay isolated if BOTH of them clean up narrowly.
 */
const OWNED_PREFIXES = ["armory-shell-", "armory-pages-"];

const isOwnCache = (name) => OWNED_PREFIXES.some((p) => name.startsWith(p));

/* The minimum needed to render something honest with no network. Kept small on
   purpose: this is downloaded on Nigerian mobile data, and a fat precache is
   paid for by every member on install. */
const PRECACHE = ["/offline", "/icons/icon-192.png"];

/**
 * Personal, authenticated, or live. Never written to any cache.
 *
 * `/console` is the desk and lane surface, and it is here for a different
 * reason from the rest. It has its OWN service worker at /console/sw.js, whose
 * scope is more specific than this one's and therefore wins for every request
 * under it — so in normal operation this worker never sees a console request
 * at all.
 *
 * It is listed anyway, for the window before that worker installs, and for a
 * member's phone that follows a console link and is refused by the server. On
 * a personal handset the console must behave like every other authenticated
 * surface: network-only, nothing written to disk. The two workers agree about
 * the member's phone precisely because neither of them is allowed to decide
 * that question alone.
 */
const NEVER_CACHE = ["/portal", "/sign-in", "/api/", "/screen", "/console"];

const isNeverCached = (pathname) =>
  NEVER_CACHE.some((p) => pathname === p || pathname.startsWith(p));

/* Content-hashed by the build, so a given URL's bytes never change. This is
   the one place cache-first is safe without a staleness story. `/_next/data`
   and RSC payloads are NOT here: those are keyed by build id, and serving a
   stale one against a fresh HTML document is how an app starts throwing
   hydration errors after a deploy. */
const isImmutable = (pathname) =>
  pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      /* One missing precache entry must not leave the worker permanently
         uninstalled — that would take installability down with it. */
      .catch(() => undefined)
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
            /* Own caches only, and only superseded ones. See OWNED_PREFIXES. */
            .filter((k) => isOwnCache(k) && k !== SHELL_CACHE && k !== PAGE_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  /* POST is every form on this site — applications, bookings, sign-in. A
     service worker must never replay or cache one. */
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url.pathname)) return;

  if (isImmutable(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Full page loads. Client-side navigations are RSC fetches and fall through
     to the network untouched; when one fails offline, Next falls back to a
     hard navigation, which arrives here and gets the offline page. */
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
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

async function networkFirst(request) {
  try {
    const response = await fetch(request);

    /* Only cache a clean, complete, public document. `response.ok` excludes
       redirects to sign-in and every error page; `basic` excludes opaque
       cross-origin responses, which cannot be inspected and so cannot be
       judged safe to store. */
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const offline = await caches.match("/offline");
    if (offline) return offline;

    return new Response("Offline", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
