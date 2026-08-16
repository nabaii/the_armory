"use client";

import { useEffect } from "react";

/**
 * Registers the CONSOLE service worker. Renders nothing.
 *
 * `/console/sw.js` scopes to `/console/` with no `Service-Worker-Allowed` header,
 * because a worker's default scope is the directory it is served from. That is the
 * whole isolation mechanism: the member worker at scope `/` never sees a console
 * request, so the member caching policy is physically unreachable from the console
 * one. See the header of public/console/sw.js.
 *
 * ===========================================================================
 * WHY THIS IS NOT THE SAME COMPONENT AS `<ServiceWorker />`
 *
 * The member one waits for `load` before registering, so a precache does not
 * compete with the page that is still arriving — it protects a 2.5s LCP target on
 * Nigerian mobile data, for a benefit that cannot be needed until the next visit.
 *
 * The trade is reversed here. §2 gives the desk a one-second cold start with NO
 * NETWORK, which is only achievable if the shell is already on disk before the
 * morning it is needed. On a club tablet that is opened once and left open all day,
 * the visit during which the worker installs may be the last online visit before an
 * outage. So this registers immediately: the bandwidth it competes with is a
 * building's wifi, and the thing it is racing is a power cut.
 *
 * It is also NOT production-gated. The member component skips registration in
 * development because a stale shell served with total confidence is one of the more
 * expensive hours in web development — true, and outweighed here by §8.5, which
 * requires the offline path to be exercised on real hardware. An offline guarantee
 * that only exists in production builds is one nobody tests until launch week.
 */
export function ConsoleServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    /**
     * The deploy's id, in the script URL.
     *
     * A service worker is only replaced when its SCRIPT changes, and
     * `/console/sw.js` is byte-identical across most deploys — so the browser
     * kept the installed worker, which kept serving the shell HTML it had
     * precached, which referenced hashed assets the new deploy no longer
     * served. The desk rendered its own content with none of its layout.
     *
     * `?v=<build>` makes the URL itself change on every deploy, which is the
     * one signal a browser acts on. This is the same mechanism the members'
     * worker has used since `NEXT_PUBLIC_BUILD_ID` was introduced; the desk
     * simply never got it. See the note at the top of `public/console/sw.js`.
     */
    const version = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

    navigator.serviceWorker
      /* The scope is implied by the script's path and stated anyway. A future move
         of this file would otherwise silently widen the scope to `/`, which would
         put the console's cache-first policy in front of the member portal — the one
         outcome the two-worker design exists to make impossible.

         The query string does not affect scope — that is derived from the path —
         so versioning the URL cannot widen it. */
      .register(`/console/sw.js?v=${encodeURIComponent(version)}`, {
        scope: "/console/",
      })
      .catch(() => {
        /**
         * Silent, and the desk still works.
         *
         * A blocked or unsupported worker means no offline shell — the console will
         * need the network to open — and the boot sequence already tells the officer
         * when the device cannot keep information offline (see
         * src/offline/boot.ts). A console error on top of that is noise, and there
         * is nothing an officer standing at a desk could do with it.
         */
      });
  }, []);

  return null;
}
