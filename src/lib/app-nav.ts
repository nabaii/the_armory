/**
 * THE APP SHELL'S NAVIGATION.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `primaryNav`
 *
 * `primaryNav` in site.ts is a MARKETING nav: five pages that argue the case
 * for joining, ordered by how a stranger reads them. It is correct for a
 * header on a laptop, where someone is evaluating the club.
 *
 * A bottom bar is not read, it is reached for. It is the same five slots on
 * every screen, hit with a thumb, by someone who already knows where they are
 * going. Those are different jobs, so this is a different list — putting the
 * marketing nav in a tab bar is how a website ends up with a tab bar rather
 * than becoming an app.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TWO SETS SHARE THEIR SHAPE
 *
 * Guest and member sets occupy the same five slots in the same order, and each
 * slot holds the same CONCEPT in both:
 *
 *   slot 1   home            home
 *   slot 2   book a visit    book a lane        "get on the range"
 *   slot 3   the ranges      the ranges
 *   slot 4   the club        leagues            "what goes on here"
 *   slot 5   apply           account            "me"
 *
 * That is deliberate and it is load-bearing. The signed-in state resolves on
 * the client (see BottomNav), so the bar renders guest-first and swaps. Because
 * the shape is fixed, the swap changes two labels and two destinations and
 * moves nothing — no reflow, no tab sliding out from under a thumb already on
 * its way down. A set with a different number of items could not do that.
 */

import { routes } from "@/lib/site";

export type AppNavItem = {
  href: string;
  /** Kept to one word where possible. A tab label is read at 11px, in a hurry. */
  label: string;
  /** Full phrase for assistive technology, where there is no width limit. */
  a11yLabel?: string;
  /** Chooses the glyph in AppNavIcon. */
  icon: AppNavIconName;
  /**
   * Slot 5 is the one action the club actually wants from a signed-out
   * visitor. It is rendered as an accent rather than a peer — the same
   * "equal tap target, unequal voice" rule the CTA pair follows.
   */
  accent?: boolean;
};

export type AppNavIconName =
  | "reticle"
  | "slots"
  | "bays"
  | "canopy"
  | "ladder"
  | "chip"
  | "card";

/**
 * Signed out. Ends on Apply, which is the conversion the whole site is for.
 *
 * "The First Visit" is titled "Visit" here. The full title survives in the
 * accessible name and on the page itself; a tab bar has roughly 64px per slot
 * and a wrapped tab label is worse than an abbreviated one.
 */
export const guestNav: readonly AppNavItem[] = [
  { href: routes.home, label: "Home", icon: "reticle" },
  {
    href: routes.firstVisit,
    label: "Visit",
    a11yLabel: "The First Visit",
    icon: "slots",
  },
  { href: routes.ranges, label: "Ranges", a11yLabel: "The Ranges", icon: "bays" },
  { href: routes.theClub, label: "Club", a11yLabel: "The Club", icon: "canopy" },
  {
    href: routes.membership,
    label: "Apply",
    a11yLabel: "Apply for membership",
    icon: "chip",
    accent: true,
  },
];

/**
 * Signed in. The marketing argument is over, so the slots that were selling
 * the club now do the member's work: booking and the ladder.
 *
 * Slot 5 loses its accent. A member does not need the club shouting its
 * primary CTA at them on every screen, and Account is a destination rather
 * than a call to action.
 */
export const memberNav: readonly AppNavItem[] = [
  { href: routes.home, label: "Home", icon: "reticle" },
  {
    href: routes.firstVisit,
    label: "Book",
    a11yLabel: "Book a lane",
    icon: "slots",
  },
  { href: routes.ranges, label: "Ranges", a11yLabel: "The Ranges", icon: "bays" },
  { href: routes.leagues, label: "Leagues", icon: "ladder" },
  { href: routes.portal, label: "Account", a11yLabel: "My account", icon: "card" },
];

/**
 * Active-tab test.
 *
 * Home matches exactly; everything else matches its subtree, so
 * /portal/leagues/new keeps the Account tab lit rather than lighting nothing.
 * This mirrors `isActive` in Nav.tsx — the two navs must never disagree about
 * which page you are on.
 */
export function isAppNavActive(pathname: string, href: string): boolean {
  if (href === routes.home) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ============================================================================
   THE MEMBERS APP — Members Portal Design Specification §5
   ========================================================================= */

/**
 * Four tabs and one red action.
 *
 *   TODAY    What am I doing        /portal
 *   DIARY    What could I do        /portal/book
 *   COMPETE  How am I doing         /portal/shooting
 *   ME       Who am I to the club   /portal/account
 *   BOOK     —                      /portal/book/new
 *
 * ===========================================================================
 * THE SAME FIVE SLOTS AS THE PUBLIC SHELL, AND THAT IS THE TRANSITION
 *
 * §4: "this should read as the same building, a different room — not as a
 * different product". The guest and member sets already share their shape for
 * the reason set out above; this set shares it too, and slot 5 keeps the accent
 * it carries when signed out. APPLY becomes BOOK: the same position, the same
 * red, the same promise that the club's one most valuable action is under the
 * thumb on every screen.
 *
 * ===========================================================================
 * WHY THE RED ACTION IS NOT INSIDE DIARY
 *
 * §5.1: it "means the highest-value action never requires the member first to
 * find the right day. The booking flow opens on date selection; Diary opens on
 * the club's week. Different intents, both served."
 *
 * And when there is nothing bookable it does not disappear. §5.1 again: "a tab
 * that vanishes and reappears teaches a member that the application is
 * unreliable; a tab that explains itself teaches them that the club is not yet
 * open for bookings, which is true." The destination renders the same honest
 * sentence the calendar renders. This list is therefore constant — there is no
 * conditional in it, and there must not be one.
 *
 * ===========================================================================
 * HOSTING HAS NO TAB, DELIBERATELY, AND IT IS ON A REVIEW DATE
 *
 * §5.2. A tab bar should reflect frequency and hosting happens six to twelve
 * times a year; a tab empty on most visits trains a member to ignore that
 * region of the screen. Hosting appears in four other places instead (§10),
 * and the decision is reviewed at ninety days against the hosting rate the
 * owner dashboard already produces.
 */
export const portalNav: readonly PortalNavItem[] = [
  {
    href: routes.portal,
    label: "Today",
    a11yLabel: "Today at the club",
    icon: "reticle",
    /* Empty. /portal is the prefix of every route in the application, so Today
       owns nothing beneath itself — see `activePortalHref`. */
    owns: [],
  },
  {
    href: routes.portalBook,
    label: "Diary",
    a11yLabel: "The club's week",
    icon: "canopy",
    owns: [routes.portalBook],
  },
  {
    href: routes.portalShooting,
    label: "Compete",
    a11yLabel: "Your shooting and competitions",
    icon: "ladder",
    /* §5: "COMPETE — /shooting, /leagues/*". Leagues are not a subtree of
       shooting and never will be; they are a second territory of one tab. */
    owns: [routes.portalShooting, "/portal/leagues"],
  },
  {
    href: routes.portalAccount,
    label: "Me",
    a11yLabel: "Your membership",
    icon: "card",
    owns: [routes.portalAccount],
  },
  {
    href: routes.portalBookNew,
    label: "Book",
    a11yLabel: "Book a session",
    icon: "slots",
    accent: true,
    owns: [routes.portalBookNew],
  },
];

/**
 * A members-app tab, which additionally declares what it OWNS.
 *
 * The public bar has no such field because its five destinations are five
 * unrelated top-level paths and a subtree test settles every case. Inside the
 * portal they are nested, and nesting is what `owns` exists to describe: which
 * paths this tab should be lit for, stated rather than inferred from the shape
 * of its own URL.
 */
export type PortalNavItem = AppNavItem & {
  readonly owns: readonly string[];
};

/** Whether this path is inside the members app rather than the public site. */
export const isPortalRoute = (pathname: string): boolean =>
  pathname === routes.portal || pathname.startsWith(`${routes.portal}/`);

/**
 * Which portal tab is lit.
 *
 * ===========================================================================
 * TWO RULES, AND THE FIRST ONE IS WHY THIS FUNCTION EXISTS AT ALL
 *
 * 1. A TAB OWNS PATHS, NOT ITS OWN PREFIX. `isAppNavActive` cannot answer this
 *    question, because every route in the application begins with /portal: a
 *    subtree match on Today's href would light Today on every screen in the
 *    members app. So Today owns nothing beneath itself and matches exactly,
 *    and Compete owns two unrelated territories (/portal/shooting and
 *    /portal/leagues) that no prefix rule could have joined.
 *
 * 2. THE MOST SPECIFIC OWNER WINS. /portal/book/new is inside /portal/book, so
 *    Diary and Book would both claim the booking flow. Longest match resolves
 *    it in favour of Book, which is also how a member reads it — they are in
 *    the flow, not browsing the week.
 *
 * Returns null on a portal route no tab owns — /portal/password, say. A bar
 * with nothing lit is honest there: the member is somewhere the four tabs do
 * not describe, and lighting the nearest one would be a small lie about where
 * they are.
 */
export function activePortalHref(pathname: string): string | null {
  let bestHref: string | null = null;
  let bestLength = -1;

  for (const item of portalNav) {
    /* Every tab matches its own href exactly, whatever it owns beneath. */
    if (pathname === item.href && item.href.length > bestLength) {
      bestHref = item.href;
      bestLength = item.href.length;
    }

    for (const owned of item.owns) {
      const matches = pathname === owned || pathname.startsWith(`${owned}/`);
      if (matches && owned.length > bestLength) {
        bestHref = item.href;
        bestLength = owned.length;
      }
    }
  }

  return bestHref;
}
