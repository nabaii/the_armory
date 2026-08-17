import { STAFF_GRANTS, type StaffGrant, type StaffRole } from "./enums";

/**
 * SEPARATION OF DUTIES, REFUSED RATHER THAN TRUSTED — Management System §5.
 *
 *   "S3 requires that armoury custody and payment are never in the same hands,
 *    and S4 that a safety veto holder is never measured on commercial outcomes.
 *    Written in a charter, those are promises. Generated into the navigation,
 *    they are facts… And the system refuses the role assignment itself at the
 *    point it is made, rather than allowing a combination the charter forbids
 *    and hoping somebody notices."
 *
 * This module is that refusal, and the navigation that follows from it.
 *
 * ===========================================================================
 * PURE, FOR THE SAME REASON THE CAPABILITY SERVICE IS PURE
 *
 * It reads nothing and queries nothing. Every fact arrives as an argument. The
 * server assembles a hand of grants from Postgres and calls this; a screen
 * calls the identical function to decide what to render; and both get the same
 * answer including the sentence shown to whoever is refused.
 *
 * The distinction from src/domain/capability is worth stating, because the two
 * are easy to confuse. `capability` answers questions about a MEMBER — may this
 * person shoot, host, attend. This answers questions about a MEMBER OF STAFF —
 * may this person see the ledger, may these two authorities be held at once.
 * Different subjects, different vocabularies, and no shared code, so that a
 * change to one cannot quietly loosen the other.
 */

/* ============================================================================
   TIME — a grant that expires

   Management §4.3, the gap the specification left: "a duty manager standing at
   the desk sometimes needs a management action". On a real understaffed
   evening there is no duty manager to hand off to, and the failure is not that
   the club is blocked — it is that somebody is given a PERMANENT grant to solve
   a TEMPORARY problem and nobody ever takes it back.
   ========================================================================= */

/**
 * A grant as it is held, with everything the refusal and the register need.
 *
 * `grantedBy` and `reason` are not audit decoration. §12.1 makes a reason
 * mandatory on role assignment, and the register that makes the founder
 * exception visible (see `crossings`) is assembled from exactly these fields.
 */
export type HeldGrant = {
  readonly grant: StaffGrant;
  readonly grantedByStaffId: string | null;
  readonly reason: string | null;
  /** Null for a standing grant. Set for an acting one. */
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
};

/**
 * The grants a person holds right now.
 *
 * ===========================================================================
 * IT LAPSES BY CLOCK, NOT BY SESSION
 *
 * §15 already requires capability to be "re-evaluated per request, not per
 * session", against the risk that "a departed staff member retains a surface
 * until their session expires". An acting grant makes that requirement sharper
 * rather than adding a new one: a grant issued for one evening must stop being
 * held at the moment it lapses, even mid-session, even mid-screen — otherwise
 * "expires at 06:00" means "expires whenever they next sign in", which for a
 * tablet that is never signed out means never.
 *
 * So `now` is an argument, every caller passes the current instant, and there
 * is no cached hand anywhere in the system.
 */
export function heldGrants(
  rows: readonly HeldGrant[],
  now: Date,
): Set<StaffGrant> {
  const held = new Set<StaffGrant>();

  for (const row of rows) {
    if (row.revokedAt !== null && row.revokedAt <= now) continue;
    if (row.expiresAt !== null && row.expiresAt <= now) continue;
    held.add(row.grant);
  }

  return held;
}

/* ============================================================================
   THE FORBIDDEN SET — S3 and S4

   Two pairs. They are the entire reason this module exists, and they are
   structural rather than advisory: §3 calls S3 "the single most important thing
   this document has to enforce".
   ========================================================================= */

export type Separation = {
  readonly id: "custody-and-payment" | "safety-and-commerce";
  readonly pair: readonly [StaffGrant, StaffGrant];
  /** Read by whoever is refused. One sentence, naming the club's own rule. */
  readonly because: string;
};

export const SEPARATIONS: readonly Separation[] = [
  {
    id: "custody-and-payment",
    pair: ["custody", "ledger"],
    because:
      "Armoury custody and payment are never in the same hands. One person who " +
      "can both move a firearm and settle what it cost is the combination the " +
      "club's governance exists to prevent.",
  },
  {
    id: "safety-and-commerce",
    pair: ["safety_manage", "intelligence_commercial"],
    because:
      "A person who can stop the range is never measured on commercial " +
      "outcomes. Holding the safety veto and the revenue figures at once puts " +
      "the two in tension inside one person, which is how a range stays open " +
      "on an evening it should not.",
  },
];

export type Refusal = {
  readonly separation: Separation;
  readonly message: string;
};

/**
 * Whether a hand of grants breaks one of the club's separations.
 *
 * ===========================================================================
 * EVALUATED ON THE RESULTING SET, NEVER ON THE CHANGE
 *
 * This is the whole correctness argument, and it is the one §15 predicts will
 * be got wrong: "A person is granted both armoury custody and ledger access,
 * and nobody notices until an audit."
 *
 * A check written against the grant being ADDED catches the obvious case — one
 * person, one screen, two boxes ticked — and misses the case that actually
 * happens. Somebody is made armourer in August. In March a different manager,
 * who was not there in August and is looking at a screen that shows a person
 * with no ledger access, gives them the ledger. Each action was individually
 * reasonable. There is no moment at which anybody could have noticed, and the
 * combination sits there until an audit finds it.
 *
 * So callers must pass the hand the person would hold AFTER the change,
 * including any self-grant, and this looks at the whole of it.
 */
export function refuseCombination(
  grants: ReadonlySet<StaffGrant>,
): Refusal | null {
  for (const separation of SEPARATIONS) {
    const [first, second] = separation.pair;
    if (grants.has(first) && grants.has(second)) {
      return {
        separation,
        message:
          `These two authorities may not be held by the same person. ${separation.because}`,
      };
    }
  }

  return null;
}

/**
 * Which separations a hand is currently crossing.
 *
 * `refuseCombination` returns the first, because a person being refused needs
 * one sentence and not a stack of them — the same rule §4.3 sets for a member
 * at the desk. This returns all of them, for the register: a report that named
 * only the first crossing would understate the position it exists to disclose.
 */
export function crossings(
  grants: ReadonlySet<StaffGrant>,
): readonly Separation[] {
  return SEPARATIONS.filter((separation) =>
    separation.pair.every((grant) => grants.has(grant)),
  );
}

/* ============================================================================
   ROLES ARE BUNDLES

   Management §5.2's table, made real. Illustrative in the specification and
   "the founder's to settle" — so these are a DRAFT TO RATIFY rather than a
   configuration, and the club's answer replaces them by editing this list.
   ========================================================================= */

export const ROLE_BUNDLES: Readonly<Record<StaffRole, readonly StaffGrant[]>> = {
  front_of_house: ["desk", "people_read"],
  range_officer: ["desk", "safety_report"],
  armourer: ["desk", "custody", "safety_report"],
  duty_manager: [
    "desk",
    "programme",
    "people_read",
    "people_write",
    "safety_report",
    "safety_manage",
  ],
  finance: ["ledger", "intelligence_commercial"],
  safety_officer: ["safety_report", "safety_manage", "intelligence_operational"],
  /**
   * Read-only predates the management system and is kept because it is held by
   * real accounts. It sees the roster and nothing else — deliberately not
   * widened here, because "read only" meaning "reads everything" is how a
   * dormant account becomes the one that leaks.
   */
  read_only: ["people_read"],
  /**
   * THE FOUNDER, AND THE ONE COMBINATION THIS BUNDLE CANNOT CONTAIN
   *
   * Every grant except `ledger`. Not an oversight, and not a slight — it is the
   * founder exception, made expensive rather than invisible.
   *
   * The founder holds all six surfaces, which by construction crosses S3. There
   * is one founder and the club has to run, so refusing outright is not an
   * option; and an exemption that simply waives the rule would leave the club's
   * most important separation as a comment in a charter.
   *
   * The resolution has two halves, and this bundle is the second:
   *
   *   READ IS EXEMPT.   `surfacesFor` and `panelsFor` give the founder every
   *                     surface and every panel regardless of grants.
   *                     Visibility is not the separation S3 protects — hands on
   *                     the record are. A founder refused a screen asks somebody
   *                     to read it to them, which produces the information
   *                     without producing the record that it was looked at.
   *
   *   WRITE IS NOT.     The bundle drops ONE SIDE OF EACH SEPARATION, so the
   *                     founder's standing hand is clean. Crossing is possible,
   *                     deliberate and dated: they issue themselves an acting
   *                     grant with a reason and it lapses by clock.
   *
   * =========================================================================
   * WHICH SIDE OF EACH SEPARATION THE FOUNDER KEEPS
   *
   * Not arbitrary, and both choices go the same way — the founder keeps the
   * authority the business cannot run without and gives up the one a specialist
   * should hold anyway.
   *
   *   drops `custody`        The founder needs the ledger constantly and the
   *                          armoury register rarely; a club with an armourer
   *                          has somebody whose job this is. It is also the
   *                          more heavily regulated record, and a firearm
   *                          custody chain the owner cannot personally alter is
   *                          the answer an inspector wants to hear.
   *
   *   drops `safety_manage`  This is S4 read forwards rather than backwards.
   *                          The founder is the one person definitely measured
   *                          on commercial outcomes, so the founder is the one
   *                          person who should not hold the safety veto. They
   *                          keep `safety_report` — anybody may report — and
   *                          they still SEE every incident and near-miss, which
   *                          §9.2 requires.
   *
   * A club too small to have either post issues the founder an acting grant on
   * the evening it matters. That is the mechanism working, not a workaround.
   */
  founder: STAFF_GRANTS.filter(
    (grant) => grant !== "custody" && grant !== "safety_manage",
  ),
};

/* ============================================================================
   NAVIGATION IS THE ORG CHART — §5

   "The management application has six surfaces. No individual sees all six
    unless the founder does. The navigation is generated from the capability
    service — the same authority that decides whether a member may host decides
    which surfaces a staff member sees."
   ========================================================================= */

export const MANAGEMENT_SURFACES = [
  "day",
  "diary",
  "people",
  "safety",
  "ledger",
  "intelligence",
] as const;
export type ManagementSurface = (typeof MANAGEMENT_SURFACES)[number];

/**
 * Which grants admit a surface. Any one of them is enough.
 *
 * Stated as data rather than as a condition per screen, for the reason §5 gives
 * about inline checks: a permission evaluated in an administrative screen is
 * not a shortcut, it is a hole in the club's governance. A layout consults this
 * and a screen never asks.
 */
const SURFACE_GRANTS: Readonly<Record<ManagementSurface, readonly StaffGrant[]>> = {
  /* THE DAY is the landing surface for every role, so it admits anybody who
     holds any management authority at all — §6. What it RENDERS is composed
     from the same hand; see `panelsFor`. */
  day: STAFF_GRANTS,
  diary: ["programme"],
  people: ["people_read", "people_write"],
  safety: ["safety_report", "safety_manage"],
  ledger: ["ledger"],
  intelligence: ["intelligence_operational", "intelligence_commercial"],
};

/**
 * The surfaces this person sees.
 *
 * ===========================================================================
 * THE FOUNDER SEES ALL SIX, AND THAT IS NOT A HOLE
 *
 * S3 separates hands on the record, not eyes on it. A founder who cannot open
 * the ledger cannot run the club, and a founder who is refused a screen will
 * ask somebody to read it to them — which is worse, because it produces the
 * information without producing the record that it was looked at.
 *
 * The separation is enforced where it bites: `refuseCombination` still applies
 * to the founder's grants in full, so seeing LEDGER and being able to WRITE to
 * it remain different things.
 */
export function surfacesFor(input: {
  readonly role: StaffRole;
  readonly grants: ReadonlySet<StaffGrant>;
}): ManagementSurface[] {
  if (input.role === "founder") return [...MANAGEMENT_SURFACES];

  return MANAGEMENT_SURFACES.filter((surface) =>
    SURFACE_GRANTS[surface].some((grant) => input.grants.has(grant)),
  );
}

/** Whether a person may reach one surface. The layout guard's whole question. */
export function admitsSurface(
  input: { readonly role: StaffRole; readonly grants: ReadonlySet<StaffGrant> },
  surface: ManagementSurface,
): boolean {
  return surfacesFor(input).includes(surface);
}

/* ============================================================================
   THE DAY IS PANELS — §6.1

   "A separate Dashboard surface was proposed and rejected… the dashboard is THE
    DAY, composed from the viewer's role out of a shared set of panels."
   ========================================================================= */

/**
 * Every panel THE DAY can render, and the grant each one requires.
 *
 * ===========================================================================
 * THE PANEL IS THE UNIT, AND THE COMPOSITION IS DATA
 *
 * §6.1 composes a dashboard per role, which read as five dashboards to build,
 * test and keep honest — and a sixth the moment the founder invents a role in
 * November. Inverting it costs nothing and removes the combinatorial problem:
 * each panel declares what it needs, a role is whatever panels its hand admits,
 * and the composition test is one assertion rather than five fixtures.
 *
 * This is the shape `portalNav` already uses, where a tab declares the paths it
 * `owns` rather than having them inferred from the shape of its URL — stated,
 * and therefore testable.
 */
export const DAY_PANELS = [
  { id: "arrivals", grant: "desk", title: "Expected arrivals" },
  { id: "guest-links", grant: "people_read", title: "Guest links outstanding" },
  { id: "walk-ups", grant: "desk", title: "Awaiting a decision" },
  { id: "coverage", grant: "safety_report", title: "Lanes and coverage" },
  { id: "expiries-today", grant: "safety_report", title: "Expiries among today's arrivals" },
  { id: "open-safety", grant: "safety_manage", title: "Open safety items" },
  { id: "operating-level", grant: "programme", title: "Operating level" },
  { id: "applications", grant: "people_write", title: "Applications waiting" },
  { id: "takings", grant: "ledger", title: "Yesterday's takings" },
  { id: "unreconciled", grant: "ledger", title: "Unreconciled payments" },
  { id: "business-strip", grant: "intelligence_commercial", title: "The business, this month" },
  { id: "gate-register", grant: "grants", title: "The register" },
] as const satisfies readonly {
  id: string;
  grant: StaffGrant;
  title: string;
}[];

export type DayPanel = (typeof DAY_PANELS)[number];

/**
 * The panels this hand admits, in declaration order.
 *
 * Order is fixed rather than per-role, so a duty manager who also covers front
 * of house does not find the screen rearranged when their grants change. §6.3
 * of the Members Portal makes the same argument about a member's Today, and it
 * holds harder here: this is a screen somebody reads at speed, several times a
 * day, looking for the thing that is different.
 *
 * ===========================================================================
 * THE FOUNDER SEES EVERY PANEL, BY THE SAME RULE AS EVERY SURFACE
 *
 * Read is exempt. This matters concretely rather than as symmetry: §9.2 requires
 * near-miss reports to be "visible to the safety holder AND THE FOUNDER", and
 * the founder's bundle deliberately does not hold `safety_manage` — so a
 * composition that consulted grants alone would enforce S4 by hiding from the
 * founder the exact reports §9 says they must see.
 *
 * Seeing an open safety item and being able to close one are different acts.
 * This function answers the first; the grant answers the second.
 */
export function panelsFor(input: {
  readonly role: StaffRole;
  readonly grants: ReadonlySet<StaffGrant>;
}): DayPanel[] {
  if (input.role === "founder") return [...DAY_PANELS];
  return DAY_PANELS.filter((panel) => input.grants.has(panel.grant));
}

/* ============================================================================
   ISSUING A GRANT
   ========================================================================= */

export class GrantError extends Error {}

export type GrantRequest = {
  /** The hand this person already holds, from `heldGrants`. */
  readonly current: ReadonlySet<StaffGrant>;
  readonly adding: readonly StaffGrant[];
  readonly reason: string;
  /** Null for a standing grant; an instant for an acting one. */
  readonly expiresAt: Date | null;
  readonly now: Date;
};

export type GrantDecision =
  | { readonly ok: true; readonly resulting: ReadonlySet<StaffGrant> }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * Decide whether a grant may be issued.
 *
 * Throws on a malformed request and REFUSES on a forbidden one, which is the
 * same division `applyOverride` makes in the capability service: a missing
 * reason is a programming error the caller must fix, while a separation being
 * crossed is a real answer that a screen has to render to a person.
 */
export function decideGrant(request: GrantRequest): GrantDecision {
  if (request.adding.length === 0) {
    throw new GrantError("A grant request has to grant something.");
  }

  /* §12.1 lists role assignment among the actions that must always carry a
     reason. Twelve characters is not a quality bar; it stops a reflex tap, and
     it is the same floor `applyOverride` sets for the same reason — somebody
     reads this in a register months later with nobody left to ask. */
  if (request.reason.trim().length < 12) {
    throw new GrantError(
      "A grant needs a reason a founder can read next quarter and understand " +
        "without asking anyone.",
    );
  }

  if (request.expiresAt !== null && request.expiresAt <= request.now) {
    throw new GrantError(
      "An acting grant that has already lapsed grants nothing. Choose a time in " +
        "the future, or issue it as a standing grant.",
    );
  }

  const resulting = new Set(request.current);
  for (const grant of request.adding) resulting.add(grant);

  const refusal = refuseCombination(resulting);
  if (refusal) return { ok: false, refusal };

  return { ok: true, resulting };
}

/**
 * The grants a role's bundle would add to a hand, as a request.
 *
 * A convenience for the assignment screen, and deliberately NOT a shortcut past
 * `decideGrant`: assigning a role is assigning its grants, and a bundle that
 * crossed a separation must be refused exactly as a hand-picked pair would be.
 * There is no path in this module by which naming a role avoids the check.
 */
export function grantsForRole(role: StaffRole): readonly StaffGrant[] {
  return ROLE_BUNDLES[role];
}
