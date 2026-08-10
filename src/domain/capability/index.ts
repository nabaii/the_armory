import type {
  Capability,
  FirearmOwnership,
  FirearmStatus,
  InvitationStatus,
  LicenceStatus,
  MembershipStatus,
} from "@/domain/enums";
import { addDays, lagosDaysBetween } from "@/lib/time";
import * as reason from "./reasons";
import type { Block, ReasonCode } from "./reasons";

export type { Block, ReasonCode } from "./reasons";

/**
 * THE CAPABILITY SERVICE — Build Specification §4.
 *
 *   "One service, called from every surface. No screen makes its own
 *    permission decision, and no permission check is duplicated in the client
 *    and the server — the client calls it to decide what to show, the server
 *    calls it to decide what to allow."
 *
 * ===========================================================================
 * WHY THIS FUNCTION IS PURE, AND WHY THAT IS THE WHOLE DESIGN
 *
 * `evaluate` takes a subject, a capability and a context, and returns a
 * decision. It reads nothing. It queries nothing. It does not know what a
 * database is. Every fact it needs arrives as an argument.
 *
 * That is not stylistic preference — it is what makes §4 and §8 compatible.
 * §4 says one service decides for both sides. §8 says the desk works "fully
 * offline. Not read-only — fully", which means the desk must make real
 * permission decisions with no server reachable. A service that queried would
 * have to exist twice: once against Postgres and once against IndexedDB. Two
 * implementations of a permission rule is exactly the duplication §4 forbids,
 * and the copy that drifts is always the one that says yes when it should have
 * said no.
 *
 * So the shape is: loaders differ, the decision does not. The server assembles
 * a `Subject` from Postgres, the desk assembles the identical `Subject` from
 * the day pack in IndexedDB (§8.1), and both call this same function and get
 * the same answer, byte for byte, including the string shown to the member.
 *
 * ===========================================================================
 * ORDER OF CHECKS
 *
 * Each capability evaluates its conditions in the order §4.2 lists them under
 * "Fails when". Where a member fails two conditions at once only the first is
 * shown, because §4.3 forbids "a stack of conditions" — one line, the most
 * fundamental problem first. Two deliberate departures from the listed order
 * are marked DEPARTURE where they occur, with the reason.
 */

/* ============================================================================
   THE SUBJECT — everything about a person that any capability might need.

   Assembled once per person per screen. Deliberately a single type rather than
   per-capability arguments: the desk's Today screen evaluates several
   capabilities for every expected arrival, and re-deriving the person for each
   would make the one-second cold-start budget (§2) unreachable.
   ========================================================================= */

/** §3.1 tiers, as the evaluator sees it. Rule 4: a matrix, not a label. */
export type TierPermissions = {
  id: string;
  name: string;
  canHost: boolean;
  guestAllowanceAnnual: number;
  guestConcurrentMax: number;
  canOwnFirearm: boolean;
  canStoreFirearm: boolean;
  disciplineAccess: readonly string[];
  bookingHorizonDays: number;
  concurrentBookingsMax: number;
};

export type MembershipSnapshot = {
  id: string;
  status: MembershipStatus;
  tier: TierPermissions;
  /** For the lapse message. Either is acceptable; ended is preferred. */
  endedOn: Date | null;
  renewsOn: Date | null;
};

export type WaiverSignatureSnapshot = {
  waiverVersionId: string;
  signedAt: Date;
};

export type LicenceSnapshot = {
  id: string;
  status: LicenceStatus;
  calibres: readonly string[];
  expiresOn: Date | null;
};

export type QualificationSnapshot = {
  discipline: string;
  level: string;
  expiresAt: Date | null;
};

/**
 * A person, as far as permission is concerned.
 *
 * `membership: null` means a guest — §3.1's "applicant, guest and member are
 * states, not separate tables" expressed in the evaluator. Every capability
 * below handles that case explicitly rather than assuming a membership exists.
 */
export type Subject = {
  personId: string;
  membership: MembershipSnapshot | null;
  /** Most recent signature, whatever version it was against. */
  waiver: WaiverSignatureSnapshot | null;
  licences: readonly LicenceSnapshot[];
  qualifications: readonly QualificationSnapshot[];
};

/* ============================================================================
   CONTEXT — a discriminated union, one variant per capability.

   Typed this way so the call site cannot forget a fact. If the desk asks
   GUEST_MAY_ATTEND without supplying whether the host has checked in, the
   build fails — which is the only reliable defence against §4's warning that
   the host-presence rule "is easy to miss".
   ========================================================================= */

export type AllowanceSnapshot = {
  includedQuota: number;
  usedCount: number;
  /** Pre-formatted, e.g. "₦15,000". §12 requires the price be shown. */
  overagePriceLabel: string | null;
};

export type InvitationSnapshot = {
  status: InvitationStatus;
  expiresAt: Date;
};

export type FirearmSnapshot = {
  id: string;
  serialNumber: string;
  calibre: string;
  ownership: FirearmOwnership;
  ownerPersonId: string | null;
  /** Derived from custody_events (§3.4). Never read from anywhere else. */
  status: FirearmStatus;
};

export type WaiverContext = {
  /** The one active version (§3.1). A signature against any other is stale. */
  activeWaiverVersionId: string;
  /**
   * How long a signature stands before it must be renewed, or null for
   * indefinitely. Null until the club's counsel settles it (§14) — and null
   * fails OPEN rather than closed, deliberately: inventing an expiry the club
   * has not agreed would turn members away at the door over a rule nobody set.
   */
  waiverValidityDays: number | null;
};

export type Context =
  | {
      capability: "MAY_BOOK";
      now: Date;
      slotStart: Date;
      discipline: string;
      /** Confirmed bookings this member already holds. */
      heldBookings: number;
    }
  | {
      capability: "MAY_HOST";
      now: Date;
      allowance: AllowanceSnapshot | null;
      /**
       * Whether the member has accepted the overage price. §4.2 fails only
       * when the allowance is exhausted AND overage is declined — an accepted
       * overage is a sale, not a block.
       */
      overageAccepted: boolean;
      /** Guests this host already has on the premises in this session. */
      guestsInSession: number;
    }
  | ({ capability: "MAY_ATTEND"; now: Date } & WaiverContext)
  | ({
      capability: "GUEST_MAY_ATTEND";
      now: Date;
      invitation: InvitationSnapshot | null;
      host: { checkedIn: boolean; name: string | null };
    } & WaiverContext)
  | {
      capability: "MAY_SHOOT_DISCIPLINE";
      now: Date;
      discipline: string;
      /** Whether this discipline demands a club sign-off. Club policy, per discipline. */
      requiresQualification: boolean;
    }
  | { capability: "MAY_USE_OWN_FIREARM"; now: Date; firearm: FirearmSnapshot }
  | {
      capability: "MAY_STORE_FIREARM";
      now: Date;
      /** §13/§14: the workflow sits behind a flag until the decision lands. */
      storageEnabled: boolean;
    };

/* ============================================================================
   THE DECISION
   ========================================================================= */

export type Decision =
  | {
      readonly allowed: true;
      readonly reason: null;
      readonly remedy: null;
      readonly overridable: false;
      readonly overridden?: { by: string; reason: string };
    }
  | {
      readonly allowed: false;
      readonly reason: { code: ReasonCode; message: string };
      readonly remedy: string | null;
      /** §4.3: whether an officer may let this through with a recorded reason. */
      readonly overridable: boolean;
      /** §4.3: whether the portal was obliged to surface this in advance. */
      readonly foreseeable: boolean;
    };

const ALLOW: Decision = {
  allowed: true,
  reason: null,
  remedy: null,
  overridable: false,
};

const deny = (block: Block): Decision => ({
  allowed: false,
  reason: { code: block.code, message: block.message },
  remedy: block.remedy,
  overridable: block.overridable,
  foreseeable: block.foreseeable,
});

/** Lift an optional block into a decision. Null block means allowed. */
const decide = (block: Block | null): Decision => (block ? deny(block) : ALLOW);

/* ============================================================================
   evaluate — §4.1
   ========================================================================= */

export function evaluate(subject: Subject, context: Context): Decision {
  switch (context.capability) {
    case "MAY_BOOK":
      return mayBook(subject, context);
    case "MAY_HOST":
      return mayHost(subject, context);
    case "MAY_ATTEND":
      return mayAttend(subject, context);
    case "GUEST_MAY_ATTEND":
      return guestMayAttend(subject, context);
    case "MAY_SHOOT_DISCIPLINE":
      return mayShootDiscipline(subject, context);
    case "MAY_USE_OWN_FIREARM":
      return mayUseOwnFirearm(subject, context);
    case "MAY_STORE_FIREARM":
      return mayStoreFirearm(subject, context);
  }
}

/* ---------------------------------------------------------------------------
   SHARED PREDICATES
   -------------------------------------------------------------------------- */

/**
 * Standing — is this membership live?
 *
 * Every status other than `active` produces its OWN message. Collapsing them
 * into one "membership not active" would be the "never 'not permitted'"
 * failure §4.3 names: a suspended member and a member whose card expired
 * yesterday need completely different sentences and have completely different
 * remedies, and only one of the two can be fixed from a phone in the car park.
 */
function standing(subject: Subject): Block | null {
  const membership = subject.membership;
  if (!membership) return reason.noMembership();

  switch (membership.status) {
    case "active":
      return null;
    case "pending":
      return reason.membershipPending();
    case "lapsed":
      return reason.membershipLapsed(membership.endedOn ?? membership.renewsOn);
    case "suspended":
      return reason.membershipSuspended();
    case "resigned":
      return reason.membershipResigned();
  }
}

/**
 * Waiver — signed, current, and within its validity window.
 *
 * §3.1 keeps exactly one waiver version active, so "signed" is not enough:
 * signing version 3 does not accept version 4. The three failures are
 * distinguished because they feel different to the person — never signed,
 * signed something we have since changed, signed too long ago.
 */
function waiverBlock(
  subject: Subject,
  ctx: WaiverContext,
  now: Date,
): Block | null {
  const signature = subject.waiver;
  if (!signature) return reason.waiverMissing();

  if (signature.waiverVersionId !== ctx.activeWaiverVersionId) {
    return reason.waiverSuperseded();
  }

  if (ctx.waiverValidityDays !== null) {
    const expiresAt = addDays(signature.signedAt, ctx.waiverValidityDays);
    if (now.getTime() >= expiresAt.getTime()) {
      return reason.waiverExpired(signature.signedAt);
    }
  }

  return null;
}

/** Whether a live qualification covers a discipline. */
function qualificationBlock(
  subject: Subject,
  discipline: string,
  now: Date,
): Block | null {
  const held = subject.qualifications.filter(
    (q) => q.discipline === discipline,
  );
  if (held.length === 0) return reason.qualificationMissing(discipline);

  const live = held.filter(
    (q) => q.expiresAt === null || q.expiresAt.getTime() > now.getTime(),
  );
  if (live.length > 0) return null;

  /* All expired. Report the one that lasted longest — that is the assessment
     the member actually remembers holding. */
  const latest = held.reduce((a, b) =>
    (a.expiresAt?.getTime() ?? 0) >= (b.expiresAt?.getTime() ?? 0) ? a : b,
  );
  return reason.qualificationExpired(discipline, latest.expiresAt as Date);
}

/* ---------------------------------------------------------------------------
   MAY_BOOK — evaluated in the portal (§6.2 Book a session).
   -------------------------------------------------------------------------- */

function mayBook(
  subject: Subject,
  ctx: Extract<Context, { capability: "MAY_BOOK" }>,
): Decision {
  const standingBlock = standing(subject);
  if (standingBlock) return deny(standingBlock);

  /* Non-null after `standing` returned null. */
  const tier = (subject.membership as MembershipSnapshot).tier;

  /* Horizon is counted in whole Lagos days, not in elapsed hours. A member
     told they may book "14 days ahead" means the calendar, and an hours-based
     comparison would refuse a 6pm slot booked at 7pm a fortnight earlier for
     reasons no one could explain at the desk. */
  const daysAhead = lagosDaysBetween(ctx.now, ctx.slotStart);
  if (daysAhead > tier.bookingHorizonDays) {
    return deny(reason.bookingHorizonExceeded(tier.bookingHorizonDays));
  }

  if (ctx.heldBookings >= tier.concurrentBookingsMax) {
    return deny(reason.concurrentBookingLimit(tier.concurrentBookingsMax));
  }

  if (!tier.disciplineAccess.includes(ctx.discipline)) {
    return deny(reason.disciplineNotInTier(ctx.discipline));
  }

  return ALLOW;
}

/* ---------------------------------------------------------------------------
   MAY_HOST — §4.2 evaluates this twice: at booking, and AGAIN at check-in.

   Twice because the facts change in between. An allowance is consumed by
   another booking; a guest already on the premises fills the concurrent slot.
   A single check at booking time would authorise a guest the club can no
   longer host by the time they arrive — which is the discovery at the desk
   §4.3 exists to prevent.
   -------------------------------------------------------------------------- */

function mayHost(
  subject: Subject,
  ctx: Extract<Context, { capability: "MAY_HOST" }>,
): Decision {
  /* DEPARTURE from the §4.2 order: standing is checked before the tier's
     hosting flag. A lapsed member is not "unable to host" — they are lapsed,
     and telling them about their tier would send them to the wrong remedy. */
  const standingBlock = standing(subject);
  if (standingBlock) return deny(standingBlock);

  const tier = (subject.membership as MembershipSnapshot).tier;

  if (!tier.canHost) return deny(reason.tierCannotHost());

  /* §4.2: fails when the allowance is "exhausted AND overage declined". An
     accepted overage is a sale — the club would much rather have the guest. */
  const allowance = ctx.allowance;
  if (allowance && allowance.usedCount >= allowance.includedQuota) {
    if (!ctx.overageAccepted) {
      return deny(
        reason.allowanceExhausted(
          allowance.includedQuota,
          allowance.overagePriceLabel,
        ),
      );
    }
  }

  if (ctx.guestsInSession >= tier.guestConcurrentMax) {
    return deny(reason.guestConcurrentLimit(tier.guestConcurrentMax));
  }

  return ALLOW;
}

/* ---------------------------------------------------------------------------
   MAY_ATTEND — the member at the desk.
   -------------------------------------------------------------------------- */

function mayAttend(
  subject: Subject,
  ctx: Extract<Context, { capability: "MAY_ATTEND" }>,
): Decision {
  const standingBlock = standing(subject);
  if (standingBlock) return deny(standingBlock);

  return decide(waiverBlock(subject, ctx, ctx.now));
}

/* ---------------------------------------------------------------------------
   GUEST_MAY_ATTEND — the capability §4 singles out.
   -------------------------------------------------------------------------- */

function guestMayAttend(
  subject: Subject,
  ctx: Extract<Context, { capability: "GUEST_MAY_ATTEND" }>,
): Decision {
  const invitation = ctx.invitation;
  if (!invitation) return deny(reason.noInvitation());

  switch (invitation.status) {
    case "cancelled":
      return deny(reason.invitationCancelled());
    case "expired":
      return deny(reason.invitationExpired());
    case "issued":
    case "opened":
      /* Issued or opened but not completed: the guest has not finished the
         two-minute form (§6.3), so the club has no emergency contact and no
         date of birth for someone about to stand on a live range. */
      return deny(reason.invitationIncomplete());
    case "completed":
    case "attended":
      break;
  }

  /* An expiry that has passed in wall-clock time but whose status has not yet
     been swept. The status column is maintained by a job; the clock is not,
     and the clock is what is true. */
  if (invitation.expiresAt.getTime() <= ctx.now.getTime()) {
    return deny(reason.invitationExpired());
  }

  const waiver = waiverBlock(subject, ctx, ctx.now);
  if (waiver) return deny(waiver);

  /* ---------------------------------------------------------------------
     THE HOST-PRESENCE RULE. §4:

       "The host-presence rule in GUEST_MAY_ATTEND is easy to miss and is not
        optional. A guest who arrives before their host waits. The check must
        re-evaluate when the host checks in, so the desk row clears by itself
        rather than requiring the officer to retry."

     It is last on purpose. It is the only condition here that resolves by
     itself, so a guest who fails it has nothing to do and nothing to fix —
     any other outstanding problem should be surfaced first, while they are
     standing at the desk with time to deal with it.
     --------------------------------------------------------------------- */
  if (!ctx.host.checkedIn) {
    return deny(reason.hostNotCheckedIn(ctx.host.name));
  }

  return ALLOW;
}

/* ---------------------------------------------------------------------------
   MAY_SHOOT_DISCIPLINE — checked at the desk and again at the lane.
   -------------------------------------------------------------------------- */

function mayShootDiscipline(
  subject: Subject,
  ctx: Extract<Context, { capability: "MAY_SHOOT_DISCIPLINE" }>,
): Decision {
  /* A guest has no tier, so there is no tier access to test. §6.5: "Guests are
     scored identically to members" — they shoot what their host booked, under
     supervision, and their permission to be here was settled by
     GUEST_MAY_ATTEND. Applying a tier rule to someone who has no tier would
     block every guest from every discipline. */
  const membership = subject.membership;
  if (membership) {
    if (!membership.tier.disciplineAccess.includes(ctx.discipline)) {
      return deny(reason.disciplineNotInTier(ctx.discipline));
    }
  }

  if (ctx.requiresQualification) {
    const block = qualificationBlock(subject, ctx.discipline, ctx.now);
    if (block) return deny(block);
  }

  return ALLOW;
}

/* ---------------------------------------------------------------------------
   MAY_USE_OWN_FIREARM — checked at the desk and again at the lane (§6.5 Pair).
   -------------------------------------------------------------------------- */

function mayUseOwnFirearm(
  subject: Subject,
  ctx: Extract<Context, { capability: "MAY_USE_OWN_FIREARM" }>,
): Decision {
  const firearm = ctx.firearm;

  if (firearm.status === "decommissioned") {
    return deny(reason.firearmUnavailable(firearm.serialNumber, "decommissioned"));
  }

  /* A club firearm is not governed by this capability. Whether this shooter
     may use it is a question of discipline and competency, which
     MAY_SHOOT_DISCIPLINE already answers — so returning "allowed" here is
     correct rather than permissive, and it lets the Pair screen call one
     capability for every firearm on the rack instead of branching first. */
  if (firearm.ownership === "club") return ALLOW;

  /* §12: "Guest shoots a member-owned firearm → Blocked at pairing."
     Checked before tier and licence because it is true of the FIREARM rather
     than of the person, and because the commonest cause is two similar serials
     on one bench — a case where telling someone about their licence would send
     them looking for a problem they do not have. */
  if (firearm.ownerPersonId !== subject.personId) {
    return deny(reason.firearmNotOwned(firearm.serialNumber));
  }

  const membership = subject.membership;
  if (!membership) return deny(reason.noMembership());
  if (!membership.tier.canOwnFirearm) {
    return deny(reason.tierCannotOwnFirearm());
  }

  return decide(licenceBlock(subject, firearm.calibre, ctx.now));
}

/**
 * Licence cover for a calibre.
 *
 * §3.1: "Capability activates only on verified." A licence the club has been
 * sent but has not checked grants nothing — the whole point of the verified
 * state is that someone at the club looked at the document.
 *
 * The order of failure reporting is chosen so the member hears the most
 * actionable thing: missing beats unverified beats expired beats calibre.
 */
function licenceBlock(
  subject: Subject,
  calibre: string,
  now: Date,
): Block | null {
  const licences = subject.licences;
  if (licences.length === 0) return reason.licenceMissing();

  const verified = licences.filter((l) => l.status === "verified");

  if (verified.length === 0) {
    /* Report against the most promising one, so someone with a revoked
       licence and a fresh application in review hears about the application. */
    const priority: LicenceStatus[] = ["pending_review", "expired", "revoked"];
    const best =
      priority
        .map((status) => licences.find((l) => l.status === status))
        .find(Boolean) ?? licences[0];

    if (best.status === "pending_review") return reason.licenceUnverified();
    if (best.status === "revoked") return reason.licenceRevoked();
    return best.expiresOn
      ? reason.licenceExpired(best.expiresOn)
      : reason.licenceMissing();
  }

  /* Verified, but the clock may have overtaken the status column. §5 has
     licences moving to `expired` "by date"; a sweep job sets the column and
     the date is what is true in between. */
  const unexpired = verified.filter(
    (l) => l.expiresOn === null || l.expiresOn.getTime() > now.getTime(),
  );

  if (unexpired.length === 0) {
    const latest = verified.reduce((a, b) =>
      (a.expiresOn?.getTime() ?? 0) >= (b.expiresOn?.getTime() ?? 0) ? a : b,
    );
    return reason.licenceExpired(latest.expiresOn as Date);
  }

  const covering = unexpired.some((l) => l.calibres.includes(calibre));
  return covering ? null : reason.calibreOutsideLicence(calibre);
}

/* ---------------------------------------------------------------------------
   MAY_STORE_FIREARM — §13: tables built, workflow behind a flag.
   -------------------------------------------------------------------------- */

function mayStoreFirearm(
  subject: Subject,
  ctx: Extract<Context, { capability: "MAY_STORE_FIREARM" }>,
): Decision {
  /* DEPARTURE from the §4.2 order: the feature flag is tested before the tier.
     Telling a member their tier excludes a service the club has not decided it
     can lawfully offer (§14) would be a false statement about their tier, and
     they would ask to upgrade for something that does not exist. */
  if (!ctx.storageEnabled) return deny(reason.storageDisabled());

  const standingBlock = standing(subject);
  if (standingBlock) return deny(standingBlock);

  const tier = (subject.membership as MembershipSnapshot).tier;
  if (!tier.canStoreFirearm) return deny(reason.tierCannotStoreFirearm());

  return ALLOW;
}

/* ============================================================================
   §4.3 — OVERRIDES
   ========================================================================= */

export class OverrideError extends Error {}

/**
 * Apply an officer's override to a block.
 *
 *   "An officer may override a block where the override is permitted. The
 *    override records who, why, and on which device, and appears on the
 *    founder's dashboard the same day."
 *
 * Two refusals here, both deliberate:
 *
 *   · Overriding a block that is not overridable throws. The list of what may
 *     be waived is in reasons.ts with its reasoning, and it is not a matter of
 *     which screen is calling.
 *   · An empty or perfunctory reason throws. §3.6 makes override_reason
 *     mandatory, and a mandatory field that accepts "ok" is not mandatory.
 *     Twelve characters is not a quality bar, but it does stop a reflex tap.
 *
 * The caller is still responsible for writing the audit row — this function
 * returns the decision, `recordOverride` in the audit module persists it.
 */
export function applyOverride(
  decision: Decision,
  override: { staffUserId: string; reason: string },
): Decision {
  if (decision.allowed) return decision;

  if (!decision.overridable) {
    throw new OverrideError(
      `${decision.reason.code} may not be overridden. ` +
        "This block protects a person or the club's licence; see the note in " +
        "src/domain/capability/reasons.ts.",
    );
  }

  const trimmed = override.reason.trim();
  if (trimmed.length < 12) {
    throw new OverrideError(
      "An override needs a reason a founder can read tomorrow morning and " +
        "understand without asking anyone.",
    );
  }

  return {
    allowed: true,
    reason: null,
    remedy: null,
    overridable: false,
    overridden: { by: override.staffUserId, reason: trimmed },
  };
}

/* ============================================================================
   §4.3 — "Blocks that a member could have resolved in advance must have been
   surfaced in the portal in advance."

   This is the function that discharges that obligation. The portal Home screen
   renders it; the desk shows the same list on Person detail. Because every
   block carries `foreseeable`, adding a new block automatically joins this
   list or automatically does not — nobody has to remember to update a screen.
   ========================================================================= */

export type Foreseen = {
  block: Block;
  /** Which capability it will stop. For grouping in the portal. */
  capability: Capability;
};

/**
 * Everything that will stop this person, that they could deal with now.
 *
 * Live conditions — a host who has not arrived, a lane under maintenance —
 * are excluded by construction: they are marked `foreseeable: false` because
 * there is nothing to surface in advance and a portal that warned about them
 * would be crying wolf.
 */
export function foreseeableBlocks(
  subject: Subject,
  ctx: WaiverContext & {
    now: Date;
    allowance: AllowanceSnapshot | null;
    /** The member's own registered firearms, if any. */
    ownFirearms?: readonly FirearmSnapshot[];
    /** Disciplines the member intends to shoot, if a booking is in hand. */
    disciplines?: readonly string[];
    requiresQualification?: (discipline: string) => boolean;
  },
): Foreseen[] {
  const found: Foreseen[] = [];
  const push = (capability: Capability, block: Block | null) => {
    if (block?.foreseeable) found.push({ block, capability });
  };

  push("MAY_ATTEND", standing(subject));
  push("MAY_ATTEND", waiverBlock(subject, ctx, ctx.now));

  if (subject.membership?.tier.canHost && ctx.allowance) {
    const decision = mayHost(subject, {
      capability: "MAY_HOST",
      now: ctx.now,
      allowance: ctx.allowance,
      overageAccepted: false,
      guestsInSession: 0,
    });
    if (!decision.allowed && decision.foreseeable) {
      found.push({
        capability: "MAY_HOST",
        block: {
          code: decision.reason.code,
          message: decision.reason.message,
          remedy: decision.remedy,
          overridable: decision.overridable,
          foreseeable: true,
        },
      });
    }
  }

  for (const discipline of ctx.disciplines ?? []) {
    if (subject.membership && !subject.membership.tier.disciplineAccess.includes(discipline)) {
      push("MAY_SHOOT_DISCIPLINE", reason.disciplineNotInTier(discipline));
    }
    if (ctx.requiresQualification?.(discipline)) {
      push("MAY_SHOOT_DISCIPLINE", qualificationBlock(subject, discipline, ctx.now));
    }
  }

  for (const firearm of ctx.ownFirearms ?? []) {
    if (firearm.ownerPersonId !== subject.personId) continue;
    push("MAY_USE_OWN_FIREARM", licenceBlock(subject, firearm.calibre, ctx.now));
  }

  /* Deduplicate by code. One expired licence covering three firearms is one
     problem, and a portal that said so three times would read as broken. */
  const seen = new Set<ReasonCode>();
  return found.filter((f) =>
    seen.has(f.block.code) ? false : (seen.add(f.block.code), true),
  );
}

/* ============================================================================
   EXPIRIES — §6.2 Home: "anything expiring within 60 days".
   §12: "Warnings were sent at 60, 30 and 7 days."
   ========================================================================= */

/** The notice ladder. A member should never be surprised by an expiry. */
export const EXPIRY_WARNING_DAYS = [60, 30, 7] as const;

export type Expiry = {
  kind: "licence" | "qualification" | "membership";
  label: string;
  expiresOn: Date;
  daysRemaining: number;
  /** True on the day the ladder says to write to them. */
  isWarningDay: boolean;
};

export function expiries(
  subject: Subject,
  now: Date,
  withinDays = 60,
): Expiry[] {
  const out: Expiry[] = [];

  const consider = (kind: Expiry["kind"], label: string, when: Date | null) => {
    if (!when) return;
    const daysRemaining = lagosDaysBetween(now, when);
    if (daysRemaining < 0 || daysRemaining > withinDays) return;
    out.push({
      kind,
      label,
      expiresOn: when,
      daysRemaining,
      isWarningDay: (EXPIRY_WARNING_DAYS as readonly number[]).includes(
        daysRemaining,
      ),
    });
  };

  for (const licence of subject.licences) {
    if (licence.status === "verified") {
      consider("licence", "Firearm licence", licence.expiresOn);
    }
  }
  for (const qualification of subject.qualifications) {
    consider(
      "qualification",
      `${qualification.discipline} sign-off`,
      qualification.expiresAt,
    );
  }
  if (subject.membership?.status === "active") {
    consider("membership", "Membership renewal", subject.membership.renewsOn);
  }

  return out.sort((a, b) => a.daysRemaining - b.daysRemaining);
}
