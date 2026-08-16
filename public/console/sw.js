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

/**
 * THE DEPLOY'S OWN ID, READ OFF THIS SCRIPT'S URL.
 *
 * ===========================================================================
 * THIS WAS A HAND-BUMPED CONSTANT, AND IT FAILED EXACTLY AS PREDICTED
 *
 * It read `const VERSION = "v2"`, with a comment asking whoever edited this
 * file to remember to bump it. next.config.ts had already been through three
 * iterations of that mistake and wrote the epitaph for it:
 *
 *   "A constant `v1` inside sw.js, bumped by hand. Fails on the deploy somebody
 *    was in a hurry for, and the symptom is a member on last month's shell
 *    talking to this month's server."
 *
 * The members' worker was fixed to derive its version from the registration
 * URL. This one was not, and it produced precisely that symptom on the desk: a
 * tablet holding the `v2` shell from an earlier deploy, whose cached HTML
 * pointed at hashed CSS and JS filenames the server no longer had. The document
 * rendered, every asset it referenced 404'd, and the officer got the desk's
 * content with none of its layout — text stacked on top of itself.
 *
 * It cannot be discovered by testing a deploy either, because a fresh device
 * has no stale cache to serve. It only appears on the devices that have been
 * running longest, which on this product are the ones bolted to the counter.
 *
 * ===========================================================================
 * THE FALLBACK IS THE OLD CONSTANT, DELIBERATELY
 *
 * `?v=` is supplied by `ConsoleServiceWorker`. If it is ever absent — an
 * unversioned registration, a worker fetched by hand — this lands back on the
 * value it used to hardcode, so an unversioned install shares one cache rather
 * than minting a new one per page load. Unlike the members' worker it does not
 * fall back to "dev": on a shared instrument, a cache name that changes on
 * every open would re-download the shell on every boot, and §2's one-second
 * cold start is measured on a tablet with the network unplugged.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "v2";
const SHELL_CACHE = `armory-console-shell-${VERSION}`;

/**
 * The one document that is the desk.
 *
 * Every navigation inside `/console/` is answered with this entry when the
 * requested URL is not itself cached, which is what makes deep links work with
 * no network: `/console/today` on a cold tablet has never been fetched, so
 * there is nothing keyed under it, and the client router resolves the view from
 * `location` once this shell boots. See `matchShell`.
 */
const APP_SHELL = "/console";

const OFFLINE_PAGE = "/console/offline";

/**
 * Precached on install so a cold start with no network works.
 *
 * §2 gives that start a one-second budget on the actual tablet being bought.
 * Meeting it means the desk's HTML is on disk BEFORE the morning it is needed —
 * a network-first strategy with a cache fallback would spend that second
 * discovering the network is gone.
 *
 * Split into two lists because the two have opposite failure modes, and
 * collapsing them into one `addAll` with a `.catch` — which is what this was —
 * gets the important one exactly wrong.
 *
 * `addAll` is atomic: one 404 rejects the whole batch. With a swallowed
 * rejection the worker then installs with an EMPTY cache, calls `skipWaiting`,
 * activates, and deletes the previous version's caches on the way through. The
 * result is a desk that reports a successful install and has no shell at all,
 * discovered the next morning when the network is down.
 *
 * So: the shell is required and its failure propagates. A failed install leaves
 * the PREVIOUS worker active with its cache intact, which is the right outcome —
 * last week's desk beats no desk. The icon is decorative and must never be able
 * to take the desk down with it.
 */
const CRITICAL_PRECACHE = [APP_SHELL, OFFLINE_PAGE];
const OPTIONAL_PRECACHE = ["/icons/icon-192.png"];

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
    (async () => {
      const cache = await caches.open(SHELL_CACHE);

      /* Individually, and failures ignored. One missing icon is cosmetic. */
      await Promise.allSettled(OPTIONAL_PRECACHE.map((url) => cache.add(url)));

      /**
       * Fetched with `cache: "reload"` rather than through `cache.addAll`.
       *
       * `addAll` fetches through the HTTP cache, and the shell is a static
       * document the browser is entitled to hold. On the update that is meant
       * to REPLACE a stale shell that is the one request that must not be
       * served from a stale copy — the worker would dutifully re-store the
       * exact HTML it was installed to get rid of, and the desk would come back
       * still pointing at assets the deploy no longer has.
       *
       * Failure still propagates, which is what `addAll` was chosen for:
       * `Promise.all` rejects on the first bad response, install fails, and
       * this worker does not replace one that already holds a working shell.
       * See CRITICAL_PRECACHE.
       */
      await Promise.all(
        CRITICAL_PRECACHE.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) {
            throw new Error(`console precache ${url} → ${response.status}`);
          }
          await cache.put(url, response);
        }),
      );

      /* Take over immediately. A desk tablet that is mid-shift should not be
         running last week's shell because nobody closed the tab — these
         devices are opened in the morning and left open all day. */
      await self.skipWaiting();
    })(),
  );
});

/**
 * Delete superseded versions of this worker's caches.
 *
 * Safe to do here and nowhere earlier: `activate` only fires after `install`
 * resolved, and install now only resolves once the new shell is actually on
 * disk. The old cache is therefore never dropped in exchange for nothing.
 */
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

/**
 * Whether a response may be written to the shell cache.
 *
 * `ok` excludes error pages. `basic` excludes opaque cross-origin responses,
 * which cannot be inspected and so cannot be judged safe to store.
 *
 * `redirected` is the one that is easy to omit and expensive here. `fetch`
 * follows redirects transparently, so an unauthenticated or revoked tablet
 * asking for `/console` gets a 200 containing the SIGN-IN page, with `ok` true
 * and `type` basic. Under a cache-first strategy that document is then pinned as
 * the desk shell and served ahead of the network on every launch afterwards —
 * a tablet that can never reach the desk again, fixed only by clearing storage.
 * Network-first would have washed it out on the next successful load; cache-first
 * has no such second chance, which is the cost of the inversion §2 asks for.
 */
const isStorable = (response) =>
  response.ok && response.type === "basic" && !response.redirected;

/**
 * The cached document for a navigation, falling back to the app shell.
 *
 * `ignoreSearch` because `/console?lane=3` and `/console` are the same document —
 * the Cache API keys on the full URL including the query, so without this a
 * single query parameter turns a warm cache into a cold one.
 */
async function matchShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const exact = await cache.match(request, { ignoreSearch: true });
  if (exact) return exact;
  return cache.match(APP_SHELL);
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);

  /* Scoped to this worker's cache rather than `caches.match`, which searches
     every cache on the origin — including the member shell's. Reading another
     worker's cache is how two isolated policies quietly become one. */
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isStorable(response)) {
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
  const cached = await matchShell(request);

  const refresh = fetch(request)
    .then(async (response) => {
      if (isStorable(response)) {
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

  const cache = await caches.open(SHELL_CACHE);
  const offline = await cache.match(OFFLINE_PAGE);
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

/* ============================================================================
   BACKGROUND SYNC — §2, §8.4

   §2 asks for "background sync where supported". §8.4 says the queue is
   "replayed on reconnection", and without this that is only true while the desk
   is open: an officer who closes the tab at nine with records queued has no
   delivery until somebody reopens it in the morning.

   ============================================================================
   THIS HANDLER NEVER WRITES TO INDEXEDDB. THAT IS THE WHOLE DESIGN.

   The obvious implementation drains the outbox properly — read items, POST
   them, mark them done, apply backoff, quarantine what will not go. All of that
   logic exists, in TypeScript, in src/offline/outbox/. None of it is reachable
   from here: this file is served from public/ and is not bundled, so it cannot
   import a module.

   Which leaves three options, and two of them are bad:

     · Reimplement the policy here. That puts a second copy of the rules that
       decide whether a custody event is retried, parked or lost into an
       unbundled, untested file — the duplication policy.ts was extracted to
       avoid, in the one place where being wrong destroys the only copy of a
       record.

     · Wake a client and ask it to drain. Pointless: if a client were open, the
       app would already be draining on its own timer. The case this exists for
       is precisely the one where there is no client.

     · Deliver, and record nothing.

   The third is what this does, and it is safe for the reason §7 gives:

     "A queued write delivered twice must produce one row, not two."

   Because the push endpoint is idempotent on the record's own id, DELIVERING a
   record without remembering that it was delivered is harmless. The item stays
   `pending` on disk; the app re-sends it on next open and the server answers
   `duplicate`. Nothing is lost, nothing is doubled, and this handler holds no
   authority over the queue's state at all — it cannot corrupt what it cannot
   write.

   The outbox header calls this out as the reason the queue "can be crude about
   at-least-once delivery". This is the crudeness being spent well.

   Retry and backoff come from the platform: rejecting the promise below tells
   the browser the sync failed and it schedules another attempt. That is one
   fewer thing implemented twice.
   ========================================================================= */

/** The tag the page registers. One tag; the work is always "send what is queued". */
const SYNC_TAG = "armory-outbox";

self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(deliverQueued());
});

/**
 * Open a database ONLY if it already exists.
 *
 * `indexedDB.open` creates an empty database when the name is unknown, and a
 * database this worker invented would be one §10's wipe list does not name —
 * see the header of src/offline/db.ts, which is otherwise the only place in
 * this codebase allowed to open one. Checking first means that cannot happen
 * here, so the invariant holds across the bundled/unbundled boundary.
 *
 * `indexedDB.databases()` is available wherever Background Sync is, so this
 * costs nothing in practice.
 */
async function openExisting(name) {
  if (!indexedDB.databases) return null;

  const present = await indexedDB.databases();
  if (!present.some((entry) => entry.name === name)) return null;

  return new Promise((resolve) => {
    /* No version: opens at whatever the app created, and never upgrades. An
       upgrade from here would run the app's migration logic, which does not
       exist in this file. */
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function readAll(db, storeName) {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => resolve([]);
    } catch {
      /* Store missing — a database from a different version of the app. */
      resolve([]);
    }
  });
}

function readKey(db, storeName, key) {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function deliverQueued() {
  const deviceDb = await openExisting("armory-device");
  if (!deviceDb) return;

  const token = await readKey(deviceDb, "records", "token");
  deviceDb.close();

  /* No credential means this tablet is not enrolled, or has been wiped (§10).
     Either way there is nothing to send and nothing to complain about. */
  if (typeof token !== "string" || token.length === 0) return;

  const outboxDb = await openExisting("armory-outbox");
  if (!outboxDb) return;

  const items = await readAll(outboxDb, "items");
  outboxDb.close();

  /* Same ordering rule as the app: ids are UUIDv7, so lexicographic order is
     creation order, and a record that references another is sent after it. See
     the note on strict order in src/offline/outbox/outbox.ts. */
  const queue = items
    .filter((item) => item.state === "pending" || item.state === "inflight")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (queue.length === 0) return;

  for (const item of queue) {
    const response = await fetch("/sync/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        id: item.id,
        operation: item.operation,
        payload: item.payload,
        deviceId: item.deviceId,
        actorStaffId: item.actorStaffId ?? null,
        clientRecordedAt: item.createdAt,
      }),
    });

    if (response.ok) continue;

    /**
     * Anything other than success stops the run, and the distinction between
     * kinds of failure is deliberately NOT made here.
     *
     * policy.ts turns four failure kinds into four different fates, and acting
     * on that difference means writing state. So this handler does the one thing
     * that needs no state: it stops, and leaves the item exactly as it found it.
     *
     * A 4xx — a record the server will never accept — would otherwise be retried
     * by the browser indefinitely. That is tolerable because it is bounded by the
     * platform's own sync backoff and by the app, which will quarantine the item
     * properly the next time the desk is opened and surface it to an officer
     * (§8.2). A queue stuck in the background is visible the moment somebody
     * looks; a record deleted in the background is not.
     */
    throw new Error(`Background delivery stopped at ${response.status}.`);
  }
}
