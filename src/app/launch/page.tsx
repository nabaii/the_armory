import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMember } from "@/server/auth/session";
import { routes } from "@/lib/site";

/**
 * /launch — THE INSTALLED APP'S FRONT DOOR.
 *
 * ============================================================================
 * THE BUG THIS FIXES
 *
 * The manifest's `start_url` was `/`, so a member who installed the app and
 * tapped its icon was shown the marketing hero — "Built to international
 * competition standard", "Apply for membership" — which is the club arguing its
 * case to a stranger. The member reading it is M-003. They have applied, been
 * admitted, and are holding an app they installed on purpose.
 *
 * The bottom bar was correct throughout: it showed BOOK · LEAGUES · ACCOUNT,
 * the member set, because `BottomNav` resolves the session on the client. So the
 * app knew who they were and still opened on the sales pitch, and the only way
 * through was to notice ACCOUNT and tap it.
 *
 * ============================================================================
 * WHY A ROUTE RATHER THAN POINTING `start_url` AT /portal
 *
 * `start_url` is one static string and the right destination depends on who is
 * holding the phone. Aiming it at `/portal` would send every signed-out
 * installer — a prospect who added the site to their home screen — straight to
 * a sign-in form, which is a worse first screen than the hero is a second one.
 *
 * So the decision is made once, here, at launch, by the only party that can
 * make it: the server, with the session cookie in hand. A member gets Today. A
 * visitor gets the argument. Nothing about how either of them BROWSES the site
 * changes — `/` is still the club's homepage for everybody, which is why this is
 * a new route rather than a redirect bolted onto the existing one.
 *
 * ============================================================================
 * IT IS NOT LINKED FROM ANYWHERE, AND THAT IS THE POINT
 *
 * This is a machine door. The manifest opens it; no human should ever see the
 * URL, and nothing in the site links to it. `robots` keeps it out of the index
 * for the same reason — a crawler landing here would be redirected to the
 * homepage and would report the homepage under two URLs.
 *
 * ============================================================================
 * THE SERVICE WORKER ALREADY DOES THE RIGHT THING — DO NOT "FIX" IT
 *
 * This route's answer depends on a cookie, so caching it would pin whichever
 * answer the first launch got and serve a member the visitor's homepage forever.
 * It is safe anyway, and deliberately NOT added to the worker's `NEVER_CACHE`:
 *
 *   · `networkFirst` only stores a response that is `ok` and `basic`. A redirect
 *     is neither — the comment there names this exact case — so the response
 *     cannot be cached however often it is fetched.
 *   · Leaving it OUT of `NEVER_CACHE` is what keeps an offline launch working.
 *     Never-cached paths return early and bypass the worker entirely, so a cold
 *     launch with no network would land on the browser's own error page.
 *     Through `networkFirst` it falls back to `/offline`, which is a page this
 *     club wrote.
 *
 * Adding `/launch` to `NEVER_CACHE` would therefore fix nothing and break the
 * offline launch. It is the obvious-looking change and it is wrong.
 */

export const metadata: Metadata = {
  title: "Opening",
  robots: { index: false, follow: false },
};

/* Reads a cookie, so it can never be static. Declared rather than inferred. */
export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  const member = await getMember();

  /* `getMember` returns null for a signed-out visitor AND when the database is
     unreachable. Both land on the homepage, which is the safe direction: the
     marketing site is static and needs nothing, whereas sending someone to a
     portal that cannot load its own data would be a broken first screen. */
  redirect(member ? routes.portal : routes.home);
}
