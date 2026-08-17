import type { MetadataRoute } from "next";
import { routes, site } from "@/lib/site";

/* ============================================================================
   WEB APP MANIFEST — what turns the site into something installable.

   Served at /manifest.webmanifest and linked automatically by Next. This is
   the file the "Add to Home Screen" prompt reads on Android, and it is what
   decides whether the result opens in a browser tab with an address bar or as
   a standalone app.

   ----------------------------------------------------------------------------
   name VERSUS short_name, AND BRAND GUIDELINES §2

   §2 is strict: the full name with descriptor belongs "in every metadata
   field... The descriptor is how a stranger understands what this is."

   `name` obeys that literally — it is what the install prompt shows, which is
   the moment a stranger decides whether this is a sport or a weapons business,
   and it has the room.

   `short_name` cannot. It is the label under the home screen icon and Android
   truncates it at around twelve characters; the full name would render as
   "The Armory S…", which communicates less than the short form does. §2 itself
   permits "The Armory" once the full name has been seen, and by the time an
   icon is on someone's home screen it has been seen — they installed it from
   a page whose title carried it.
   ========================================================================= */

const description =
  "A private, membership-led shooting sports club at the Abuja National " +
  "Stadium. Book a lane, follow the leagues, and manage your membership.";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.legalName,
    short_name: site.shortName,
    description,

    /* Scope covers the whole site so an in-app link to a legal page or a
       booking confirmation stays inside the app rather than kicking the member
       out to a browser mid-flow. */
    id: "/",
    /**
     * NOT `/`, AND THE DIFFERENCE IS WHAT THE ICON IS FOR.
     *
     * This was `/`, so tapping the installed icon opened the marketing hero —
     * the club arguing its case — at a member who had already joined and
     * installed the app on purpose. Their only way through was to notice
     * ACCOUNT in the bottom bar.
     *
     * `/launch` decides on the server, with the session cookie in hand: a
     * member gets Today, a visitor gets the homepage. The full argument, and
     * the reason this cannot just point at `/portal`, is in that route.
     *
     * `id` deliberately stays `/`. It is what identifies the installed app, so
     * changing it would make this look like a different app to a browser that
     * has already installed the old one — a second icon rather than an updated
     * one.
     */
    start_url: "/launch",
    scope: "/",

    display: "standalone",
    /* Deferred to "portrait" rather than locked with `orientation: portrait`.
       A hard lock is the wrong call for the leagues tables, which are wide,
       and for anyone using a phone mounted on a stand at the range. */
    orientation: "portrait-primary",

    /* Both Chalk. `background_color` paints the splash screen while the app
       boots and `theme_color` tints the OS chrome — matching them to the page
       ground is what stops the launch flashing a colour the palette does not
       own. It also matches the header's own glass tint, so the transition from
       splash to first paint has no seam. */
    background_color: "#F6F5F2",
    theme_color: "#F6F5F2",

    lang: "en-NG",
    dir: "ltr",
    categories: ["sports", "lifestyle"],

    /* `any` and `maskable` are separate entries rather than one icon declaring
       both purposes. A maskable icon has its artwork inset to survive being
       cropped to a circle; used unmasked it reads as a small mark floating in
       too much space. Declaring both lets each platform pick the one drawn for
       it. See scripts/icons.ts. */
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],

    /* Long-press the home screen icon. Three destinations, chosen as the three
       reasons someone opens this app rather than the three biggest pages:
       booking is the transaction, leagues is the habit, the portal is the
       account. Marketing pages are deliberately absent — a shortcut menu is
       for members, not for persuasion. */
    shortcuts: [
      {
        name: "Book a lane",
        short_name: "Book",
        description: "Reserve a lane and a session time.",
        url: routes.firstVisit,
      },
      {
        name: "Leagues",
        short_name: "Leagues",
        description: "Standings, fixtures and results.",
        url: routes.leagues,
      },
      {
        name: "My account",
        short_name: "Account",
        description: "Membership status and league membership.",
        url: routes.portal,
      },
    ],
  };
}
