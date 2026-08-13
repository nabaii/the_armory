import { ConsoleApp } from "@/components/console/ConsoleApp";
import { ConsoleServiceWorker } from "@/components/console/ConsoleServiceWorker";

/**
 * /console — the desk.
 *
 * The single document the console service worker precaches and answers every
 * in-scope navigation with. There is deliberately nothing to render on the server:
 * §8 requires this surface to work "fully offline. Not read-only — fully", and a
 * server-rendered route is markup the tablet has to ask for. Everything below the
 * shell is read from IndexedDB by the client. The reasoning is in
 * src/app/console/layout.tsx.
 */

/**
 * Rendered once at build time and served from the cache thereafter.
 *
 * The opposite of the sync endpoints, which are `force-dynamic` because they carry
 * data. This document carries none — no roster, no arrivals, no names — which is
 * what makes it safe to store in a URL-keyed HTTP cache at all. That split is the
 * whole security argument of the two-worker design: shell in the Cache API, data in
 * IndexedDB where §10's revocation can reach it.
 */
export const dynamic = "force-static";

export default function ConsolePage() {
  return (
    <>
      <ConsoleServiceWorker />
      <ConsoleApp />
    </>
  );
}
