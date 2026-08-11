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
