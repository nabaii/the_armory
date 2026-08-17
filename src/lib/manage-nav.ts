import type { StaffGrant, StaffRole } from "@/domain/enums";
import {
  MANAGEMENT_SURFACES,
  surfacesFor,
  type ManagementSurface,
} from "@/domain/grants";
import { routes } from "@/lib/site";

/**
 * THE MANAGEMENT NAVIGATION — Management System §5.
 *
 *   "Navigation is the org chart… The navigation is generated from the
 *    capability service — the same authority that decides whether a member may
 *    host decides which surfaces a staff member sees."
 *
 * ===========================================================================
 * SIX SURFACES WILL NOT FIT A PHONE TAB BAR, AND DO NOT HAVE TO — §5.2
 *
 * A front of house sees two, a range officer two, a duty manager four. Only the
 * founder sees six, and the founder is the person most likely to be on a
 * desktop. So the density problem solves itself, and no surface has to be
 * hidden behind an overflow menu for anybody but the one person who asked for
 * all of them.
 *
 * ===========================================================================
 * WHY THIS IS NOT `portalNav`, AND MUST NOT BECOME IT
 *
 * The members app has a fixed five slots holding fixed concepts, and
 * `app-nav.ts` explains at length why that constancy matters: a tab that
 * vanishes and reappears teaches a member the application is unreliable.
 *
 * The opposite is true here. This bar is DIFFERENT PER PERSON by design — it is
 * the mechanism by which S3 stops being a promise, and an armourer not seeing
 * LEDGER is the feature rather than an inconsistency. What must stay constant is
 * one person's own bar between one screen and the next, which it does: the
 * order below is fixed, and membership changes only when somebody's grants do.
 */

export type ManageNavItem = {
  readonly surface: ManagementSurface;
  readonly href: string;
  /** One word where possible. Read at 11px, in a hurry, on a phone. */
  readonly label: string;
  /** The full phrase, where there is no width limit. */
  readonly a11yLabel: string;
  /** The question this surface answers. Rendered on the desktop rail. */
  readonly answers: string;
};

/**
 * Every surface, in a fixed order, with what each one holds.
 *
 * The order is §5's table and is not negotiable per role — see the header. THE
 * DAY is first because it is the landing surface for every role, and
 * INTELLIGENCE is last because it is the only one nobody needs during an
 * evening at the club.
 */
const ITEMS: Readonly<Record<ManagementSurface, Omit<ManageNavItem, "surface">>> = {
  day: {
    href: routes.manage,
    label: "Today",
    a11yLabel: "The day",
    answers: "What is happening, and what needs me",
  },
  diary: {
    href: routes.manageDiary,
    label: "Diary",
    a11yLabel: "The programme and the booking book",
    answers: "What members read, and what staff write",
  },
  people: {
    href: routes.managePeople,
    label: "People",
    a11yLabel: "Members, applications and compliance",
    answers: "Who the club has, and who is joining",
  },
  safety: {
    href: routes.manageSafety,
    label: "Safety",
    a11yLabel: "Incidents, near-misses and expiries",
    answers: "What went wrong, and what is about to",
  },
  ledger: {
    href: routes.manageLedger,
    label: "Ledger",
    a11yLabel: "Charges, payments and takings",
    answers: "What the club is owed, and what it took",
  },
  intelligence: {
    href: routes.manageIntelligence,
    label: "Figures",
    a11yLabel: "Key figures and management reporting",
    answers: "Whether the business is working",
  },
};

/** The bar this person sees. Generated, never written down a second time. */
export function manageNavFor(input: {
  readonly role: StaffRole;
  readonly grants: ReadonlySet<StaffGrant>;
}): ManageNavItem[] {
  return surfacesFor(input).map((surface) => ({
    surface,
    ...ITEMS[surface],
  }));
}

/**
 * Which surface a path belongs to.
 *
 * Longest-match, exactly as `activePortalHref` resolves the members app and for
 * the same reason: every management route begins with /manage, so a prefix test
 * on THE DAY's own href would light it on every screen in the application.
 *
 * Returns null on a path no surface owns, and a bar with nothing lit is the
 * honest answer there rather than lighting the nearest one.
 */
export function activeManageSurface(pathname: string): ManagementSurface | null {
  if (pathname === routes.manage) return "day";

  let best: ManagementSurface | null = null;
  let bestLength = -1;

  for (const surface of MANAGEMENT_SURFACES) {
    if (surface === "day") continue;
    const href = ITEMS[surface].href;
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && href.length > bestLength) {
      best = surface;
      bestLength = href.length;
    }
  }

  return best;
}
