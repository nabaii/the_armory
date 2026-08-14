/**
 * Site configuration — names, routes, navigation, and the content that is
 * still outstanding from the client (spec §8).
 *
 * ---------------------------------------------------------------------------
 * THE `PENDING` CONVENTION
 *
 * Spec §9 makes it an acceptance criterion that "every claim on the site is
 * true on the day it goes live". Placeholder content is how that criterion
 * gets broken quietly: an invented phone number or a rounded-off price looks
 * finished, survives review, and ships.
 *
 * So unresolved content is never given a plausible-looking default. It is
 * marked `PENDING`, renders as a visible gap, and fails the pre-launch check
 * in `src/lib/content-gate.ts`. A missing value must look missing.
 * ---------------------------------------------------------------------------
 */

/** Sentinel for content the client owes us. Never replace with a guess. */
export const PENDING = null;

/** A value that is either real or explicitly outstanding. */
export type Pending<T> = T | typeof PENDING;

/* ---------------------------------------------------------------------------
   IDENTITY
   Brand Guidelines §2: the descriptor is part of the logo, not a tagline.
   "The Armory Shooting Sports Club" on first mention, in all formal contexts,
   and in EVERY metadata field — page titles, search descriptions, social
   profiles, business listings. "The Armory" in body copy after first mention.
   -------------------------------------------------------------------------- */

export const site = {
  /** Formal name. Metadata, first mention, every first-contact surface. */
  legalName: "The Armory Shooting Sports Club",
  /** Short form. Body copy only, after first mention. */
  shortName: "The Armory",
  /** Never rendered without the wordmark above it. */
  descriptor: "Shooting Sports Club",

  /** Borrowed credential, not a governance frame (Brief — Settled Ground). */
  location: "Abuja National Stadium, FCT",

  /**
   * Canonical origin. Required for absolute OG/canonical URLs.
   * PENDING: domain not yet confirmed by the founder.
   */
  origin: PENDING as Pending<string>,
} as const;

/* ---------------------------------------------------------------------------
   ROUTES — spec §2. Flat and shallow: "depth is the enemy of a two-minute
   credibility scroll."
   -------------------------------------------------------------------------- */

export const routes = {
  home: "/",
  membership: "/membership",
  firstVisit: "/first-visit",
  ranges: "/ranges",
  theClub: "/the-club",
  groups: "/groups",
  sport: "/sport",
  leagues: "/leagues",
  enquire: "/enquire",
  privacy: "/legal/privacy",
  terms: "/legal/terms",
  /**
   * Split out from Terms deliberately. Spec §9 requires refund and deposit
   * terms to appear BEFORE payment is taken, which needs a page we can link
   * to from inside the booking flow without dumping the full terms on it.
   */
  refunds: "/legal/refunds",

  /* -------------------------------------------------------------------------
     CONFIRMATION ROUTES

     Flow A step 3 requires "immediate on-screen confirmation stating what
     happens next and within what timeframe" — the Brief: "'We will email you
     back' loses half of them in the gap."

     Distinct routes rather than in-place state, for three reasons: the
     confirmation survives a refresh, it can be linked from an email, and it
     completes POST-redirect-GET so that refreshing never resubmits an
     application. All are noindex — a confirmation page is meaningless to a
     stranger arriving from search.
     ---------------------------------------------------------------------- */
  membershipReceived: "/membership/received",
  bookingConfirmed: "/first-visit/confirmed",
  groupEnquiryReceived: "/groups/received",
  waitlistJoined: "/leagues/joined",

  /* -------------------------------------------------------------------------
     PHASE 2 — MEMBER AREA

     Kept in their own route group so portal code never enters the marketing
     bundle. All noindex: these are private surfaces, and a members' club does
     not publish the shape of its member area.
     ---------------------------------------------------------------------- */
  signIn: "/sign-in",
  signInCheck: "/sign-in/check",
  signInVerify: "/sign-in/verify",
  /** The member home. Spec §1 calls Phase 2 "member accounts and portal". */
  portal: "/portal",
  /** §6.2 "Book a session" and "Invite a guest", which are one intention. */
  portalBook: "/portal/book",
  /** §6.2 "My shooting" — history, personal best, trend. Standings are Phase 2. */
  portalShooting: "/portal/shooting",
  /** §6.2 "My documents" — waiver, licence, owned firearm registrations. */
  portalDocuments: "/portal/documents",
  /** §6.2 "Account" — charges, payments, balance, renewal, tier privileges. */
  portalAccount: "/portal/account",
  leagueNew: "/portal/leagues/new",
  leagueJoin: "/portal/leagues/join",
  /** A specific league. Private — the repository scopes reads by membership. */
  league: (id: string) => `/portal/leagues/${id}`,
} as const;

/* ---------------------------------------------------------------------------
   NAVIGATION — spec §2. Five items maximum in the primary nav.

   Sport, Groups and Leagues sit in the footer and as homepage modules.
   The institutional page is unlisted: it is sent after a meeting and is
   deliberately NOT linked from navigation.
   -------------------------------------------------------------------------- */

export type NavItem = {
  href: string;
  label: string;
  /**
   * Access register (Brand Guidelines §4) — encodes who a page is for, so
   * the tiering is felt rather than announced.
   *   open   → Soffit Blue. First visit, bar, groups.
   *   member → VIP Teal. Membership, the club, VIP deck.
   *   neutral→ Chalk / Terrazzo. Lets photography carry the page.
   */
  register: "open" | "member" | "neutral";
};

export const primaryNav: readonly NavItem[] = [
  { href: routes.membership, label: "Membership", register: "member" },
  { href: routes.firstVisit, label: "The First Visit", register: "open" },
  { href: routes.ranges, label: "The Ranges", register: "neutral" },
  { href: routes.theClub, label: "The Club", register: "member" },
  { href: routes.enquire, label: "Enquire", register: "neutral" },
] as const;

export const footerNav = {
  club: [
    { href: routes.membership, label: "Membership" },
    { href: routes.theClub, label: "The Club" },
    { href: routes.sport, label: "Sport & Competition" },
    { href: routes.leagues, label: "Leagues" },
  ],
  visit: [
    { href: routes.firstVisit, label: "The First Visit" },
    { href: routes.ranges, label: "The Ranges" },
    { href: routes.groups, label: "Groups & Events" },
    { href: routes.enquire, label: "Enquire" },
  ],
  legal: [
    { href: routes.privacy, label: "Privacy" },
    { href: routes.terms, label: "Terms" },
    { href: routes.refunds, label: "Refund & Deposit Policy" },
  ],
} as const;

/* ---------------------------------------------------------------------------
   CALLS TO ACTION

   Brief: the headline sells the club, the second line rescues the hesitant.
   Both CTAs get an equal tap target; only the voice differs. Shrinking the
   secondary CTA is how a site accidentally sells only to people who already
   feel entitled to be there.
   -------------------------------------------------------------------------- */

export const cta = {
  /**
   * `label` is the persuading form and belongs anywhere with room — heroes,
   * in-page CTAs, the mobile panel.
   *
   * `shortLabel` exists for the sticky header only. Measured: the full phrase
   * rendered a 233px button, 88px tall, inside an 80px header bar — it wrapped
   * to two lines and overflowed vertically. Beside a lockup that already names
   * the club, "Apply" is unambiguous.
   */
  primary: {
    href: routes.membership,
    label: "Apply for membership",
    shortLabel: "Apply",
  },
  secondary: {
    href: routes.firstVisit,
    label: "Book a first visit",
    shortLabel: "First visit",
  },
} as const;

/* ---------------------------------------------------------------------------
   OPERATIONAL CONTACT — all PENDING (spec §8, owner: Founder)

   No invented numbers. Flow C is "a named contact and a direct telephone
   number, no form" — that audience is won in person and a wrong number is
   worse than a visible gap.
   -------------------------------------------------------------------------- */

export const contact = {
  /** Public general enquiries line. */
  phone: PENDING as Pending<string>,
  email: PENDING as Pending<string>,

  /** Owns the membership pipeline. Flow A steps 5-6 fail without this. */
  membershipOwner: PENDING as Pending<{ name: string; email: string }>,

  /** Institutional & professional training. Named person, direct number. */
  institutional: PENDING as Pending<{ name: string; phone: string }>,

  /** Displayed on /first-visit so a booking outage degrades to a phone call. */
  bookingsPhone: PENDING as Pending<string>,

  /** Opening hours. Founder-editable in the CMS once wired. */
  hours: PENDING as Pending<string>,
} as const;
