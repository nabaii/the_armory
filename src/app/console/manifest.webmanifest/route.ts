import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/**
 * THE DESK'S OWN MANIFEST — /console/manifest.webmanifest
 *
 * ============================================================================
 * THE BUG THIS FIXES, BECAUSE IT IS NOT OBVIOUS FROM THE SYMPTOM
 *
 * There is one origin and two products on it. `app/manifest.ts` describes the
 * members app and declares `id`, `start_url` and `scope` as `/`. Next injects a
 * `<link rel="manifest">` into every route from the root layout, so `/console`
 * was advertising the members app's manifest — the console never had one.
 *
 * The consequence was reported as "I registered this device, added the console
 * to my home screen, and I am in the members portal". That is exactly what the
 * markup asked for: Add to Home Screen read the linked manifest, installed the
 * app it described, and launched `start_url: "/"`. The officer never reaches
 * the desk, and nothing on screen explains why.
 *
 * A second manifest is the whole fix. It has to be a route handler rather than
 * a second `manifest.ts`, because that file convention is root-only.
 *
 * ============================================================================
 * SCOPE IS THE PART THAT MATTERS MOST
 *
 * `scope: "/console"` is not cosmetic. The console layout already goes to some
 * length to keep the desk out of the site's service worker — it registers its
 * own at `/console/sw.js` precisely so the desk's caching policy is its own.
 * The manifest scope was never separated to match, which left the desk inside
 * the members app's PWA scope: one installed app, two products, and a
 * navigation between them that the OS treats as staying in the same app.
 *
 * Now the two are disjoint. A tap on a members link from inside the desk
 * leaves the desk, which is correct — they are different applications with
 * different auth, and pretending otherwise is what produced the original
 * confusion.
 *
 * ============================================================================
 * NO SHORTCUTS, AND THAT IS DELIBERATE
 *
 * The members manifest carries three, because a member opens their app for one
 * of three reasons. An officer opens the desk for exactly one reason — the desk
 * — and a long-press menu offering to jump somewhere else on a shared
 * instrument mid-shift is a way to lose a check-in, not a convenience.
 */
export const dynamic = "force-static";

export function GET(): Response {
  const manifest: MetadataRoute.Manifest = {
    /* Named for what it is on a counter. The members app takes the club's full
       legal name (Guidelines §2); this is an internal instrument and calling it
       "The Armory Shooting Sports Club" a second time is how an officer ends up
       with two identical-looking apps. */
    name: `${site.shortName} Desk`,
    short_name: "Desk",
    description:
      "The range desk. Check-ins, waivers and the day's arrivals, on a " +
      "registered device.",

    id: "/console",
    start_url: "/console",
    scope: "/console",

    display: "standalone",
    /* Locked, unlike the members app. This is a fixed instrument on a counter
       and a rotation mid-check-in leaves the next officer with a layout they
       did not choose. The members app deliberately stays unlocked for the
       leagues tables; the desk has the opposite requirement. */
    orientation: "portrait",

    /* Charred Timber, matching the `themeColor` the console layout already
       sets. Splash and OS chrome are the same value for the reason the members
       manifest gives: a launch that flashes a colour the palette does not own
       is a seam between splash and first paint. */
    background_color: "#262523",
    theme_color: "#262523",

    lang: "en-NG",
    dir: "ltr",

    icons: [
      { src: "/icons/desk-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/desk-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/desk-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return Response.json(manifest, {
    headers: {
      "content-type": "application/manifest+json",
      /* The desk is an offline-first instrument and this file changes about
         never. Long cache, revalidated on deploy by the build id in the URL of
         everything it points at. */
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
