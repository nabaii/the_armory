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
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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
