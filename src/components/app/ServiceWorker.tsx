"use client";

import { useEffect } from "react";

/**
 * Registers the service worker. Renders nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY IT WAITS FOR `load`
 *
 * Registration competes for bandwidth with the page that is still arriving.
 * On the mid-range Android and the mobile data this site is measured against,
 * kicking off a precache during the initial load is a direct hit to the 2.5s
 * LCP target — for a benefit (offline support) that cannot possibly be needed
 * until the next visit. So it waits until the page has finished loading and
 * the network is idle.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS PRODUCTION-ONLY
 *
 * A service worker in development serves the last build's assets back to you
 * with total confidence, and the resulting "my change did nothing" is one of
 * the more expensive hours in web development. `next dev` has no use for it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BUILD ID IS IN THE URL
 *
 * Members Portal §13.5 requires "a version check on every application open, and
 * a forced update path for breaking changes. A member should never be told to
 * clear their browser cache."
 *
 * Registering `/sw.js?v=<build>` is that check, performed by the browser rather
 * than by code of ours: a changed script URL is a different registration, so
 * every application open compares it, and the worker reads the same value to
 * name its caches. The alternative it replaces was a constant inside sw.js that
 * somebody had to remember to bump — which fails silently, on the one deploy
 * that was in a hurry, and strands members on an old shell against a changed
 * server.
 *
 * `NEXT_PUBLIC_BUILD_ID` is set by the deploy; the fallback keeps registration
 * working where it is not, at the cost of sharing one cache generation.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      /* Failure is silent by design. A blocked or unsupported service worker
         means no offline support and no install prompt; it does not mean the
         website is broken, and a console error on every load of a private
         members' site is noise the founder does not need. */
      const version = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(version)}`)
        .catch(() => undefined);
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
