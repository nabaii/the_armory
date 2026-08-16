import type { Metadata, Viewport } from "next";

/**
 * THE CONSOLE — §6.4 desk, §6.5 lane.
 *
 * A separate route group from `(site)` on purpose, and the separation is
 * load-bearing rather than tidy:
 *
 *   · `(site)/layout.tsx` mounts `<ServiceWorker />`, which registers `/sw.js` at
 *     scope `/`. The console must not inherit that. It registers its own worker at
 *     `/console/sw.js`, whose scope is `/console/` and whose caching policy is the
 *     opposite of the member one — cache-first on the shell, because §2 gives the
 *     desk a one-second cold start with no network. See the header of
 *     public/console/sw.js for why that is two workers and not one branching on
 *     device type.
 *
 *   · The site chrome is meaningless here. A desk tablet is not browsing a
 *     members' club website; it is a single-purpose instrument that opens in the
 *     morning and stays open. Site navigation on it would be a tab-order hazard
 *     in front of somebody holding a firearm.
 *
 * ===========================================================================
 * WHY THERE IS NO SERVER-RENDERED CONTENT BELOW THIS POINT
 *
 * §8: "The desk and lane surfaces work fully offline. Not read-only — fully."
 *
 * That rules out per-route server rendering for this surface. A Next.js client
 * navigation fetches an RSC payload for the route it is moving to; with no network
 * that fetch fails, and the framework falls back to a hard navigation, which the
 * service worker answers with the app shell. The result on a range floor is a desk
 * that appears to work until the officer taps something.
 *
 * So the console is ONE cached document that renders itself from IndexedDB and
 * switches views in the client. It asks the server for data (§8.1's day pack) and
 * never for markup. That is why the shell can be precached as a single entry and
 * why `matchShell` in the worker answers every in-scope navigation with it.
 */

export const metadata: Metadata = {
  title: "Desk",
  /* Never indexed, never followed. §3.1 restricts this surface to registered
     devices; a search engine is not one, and a crawler finding it would be a
     crawler queueing 401s against the club's sync endpoints. */
  robots: { index: false, follow: false },

  /**
   * THE DESK'S OWN MANIFEST, AND WHY THIS LINE IS LOAD-BEARING.
   *
   * Without it the root layout's `<link rel="manifest">` is what this page
   * advertises, and that manifest describes the MEMBERS app: `start_url: "/"`,
   * the club's full name, the Chalk icon. Add to Home Screen from here then
   * installs the members app, and the officer who did it lands in the members
   * portal every time they tap the icon — which is exactly how this was
   * reported. See the header on the route this points at.
   */
  manifest: "/console/manifest.webmanifest",

  /**
   * iOS reads none of the manifest for the home-screen label or the icon; it
   * reads these. The root layout sets them for the members app, and metadata
   * merges down the tree, so without an override here the desk inherits the
   * label "The Armory" and the Chalk touch icon — two identical icons on one
   * home screen, one of which cannot check anybody in.
   */
  appleWebApp: {
    capable: true,
    title: "Desk",
    /* The desk's status bar sits on Charred Timber. */
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [{ url: "/icons/desk-apple-touch-icon.png", sizes: "180x180" }],
    icon: [{ url: "/icons/desk-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  /* No zoom on a shared instrument. A pinch during a check-in leaves the next
     officer with a misaligned screen and no obvious way back. */
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#262523",
  viewportFit: "cover",
};

export default function ConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-col bg-[--color-chalk] text-[--color-reticle-black]">
      {children}
    </div>
  );
}
