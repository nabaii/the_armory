import { formatDay } from "@/lib/time";

/**
 * THE BLOCK CATALOGUE — every reason this system may refuse someone.
 *
 * Build Specification §4.1: "reason — a stable machine code plus a human
 * string. The human string is what the desk displays and what the member reads
 * in the portal, so it must be written by someone who can write."
 *
 * ===========================================================================
 * §4.3 IS A PRODUCT SPECIFICATION, NOT A STYLE NOTE
 *
 *   "Every block returns a specific single-line reason. Never 'not permitted',
 *    never a code, never a stack of conditions.
 *
 *    Blocks that a member could have resolved in advance must have been
 *    surfaced in the portal in advance. Anything a member first learns at the
 *    desk, in front of their guest, is a defect in this system.
 *
 *    An officer may override a block where the override is permitted."
 *
 * Three obligations, and each is a field on every entry below rather than a
 * rule someone has to remember:
 *
 *   `message`      the single line. Second person, addressed to the member —
 *                  which is also the right register for an officer reading it
 *                  aloud to the person standing in front of them.
 *   `foreseeable`  true when a member could have resolved this before
 *                  arriving. The portal is REQUIRED to surface every
 *                  foreseeable block in advance; `foreseeableBlocks()` in
 *                  ./index.ts is what it renders, so the obligation is
 *                  discharged by construction rather than by discipline.
 *   `overridable`  whether a range officer may let this through with a
 *                  recorded reason. See the note on overrides below.
 *
 * ===========================================================================
 * WHAT MAY BE OVERRIDDEN, AND WHY THE LINE FALLS WHERE IT DOES
 *
 * Overridable: commercial and administrative blocks. An exhausted allowance, a
 * lapsed renewal, a booking horizon. These cost the club money or tidiness,
 * and §8.3 is explicit that the club would rather carry the cost than
 * embarrass a member at the desk — "The system never resolves a data conflict
 * by embarrassing a member."
 *
 * Not overridable: anything protecting a person or the club's licence. A
 * missing waiver is the club's legal position if someone is hurt. An expired
 * firearm licence is a criminal matter, not a club rule. A suspension is a
 * safety judgement the founder already made, and an officer who could override
 * it would be overruling that judgement alone, at a desk, under time pressure.
 *
 * The host-presence rule sits with the second group deliberately. §1.1: a
 * person may be on the premises "only while that host is present". It is the
 * membership model itself, not a courtesy, so it clears by the host arriving
 * and by nothing else.
 *
 * ===========================================================================
 * VOICE
 *
 * Brand Guidelines §9, as applied throughout this codebase: assured and
 * hospitable, never a paywall. No exclamation marks, no urgency, no countdown,
 * no apology. State the fact, then state what resolves it. A member reading
 * one of these in the portal on a Tuesday evening should feel informed, not
 * chastised.
 */

export type Block = {
  /** Stable machine code. Safe to switch on, log, and assert in a test. */
  code: ReasonCode;
  /** The single line shown at the desk and in the portal. */
  message: string;
  /** What resolves it. Null only where genuinely nothing does. */
  remedy: string | null;
  /** Whether an officer may let this through with a recorded reason (§4.3). */
  overridable: boolean;
  /** Whether the portal must have surfaced this in advance (§4.3). */
  foreseeable: boolean;
};

export type ReasonCode =
  /* Standing */
  | "NO_MEMBERSHIP"
  | "MEMBERSHIP_PENDING"
  | "MEMBERSHIP_LAPSED"
  | "MEMBERSHIP_SUSPENDED"
  | "MEMBERSHIP_RESIGNED"
  /* Waiver */
  | "WAIVER_MISSING"
  | "WAIVER_SUPERSEDED"
  | "WAIVER_EXPIRED"
  /* Booking */
  | "BOOKING_HORIZON_EXCEEDED"
  | "CONCURRENT_BOOKING_LIMIT"
  | "DISCIPLINE_NOT_IN_TIER"
  | "LANE_UNAVAILABLE"
  /* Hosting */
  | "TIER_CANNOT_HOST"
  | "ALLOWANCE_EXHAUSTED"
  | "GUEST_CONCURRENT_LIMIT"
  /* Guest arrival */
  | "NO_INVITATION"
  | "INVITATION_CANCELLED"
  | "INVITATION_EXPIRED"
  | "INVITATION_INCOMPLETE"
  | "HOST_NOT_CHECKED_IN"
  /* Competency */
  | "QUALIFICATION_MISSING"
  | "QUALIFICATION_EXPIRED"
  /* Property */
  | "TIER_CANNOT_OWN_FIREARM"
  | "LICENCE_MISSING"
  | "LICENCE_UNVERIFIED"
  | "LICENCE_EXPIRED"
  | "LICENCE_REVOKED"
  | "FIREARM_NOT_OWNED"
  | "CALIBRE_OUTSIDE_LICENCE"
  | "FIREARM_UNAVAILABLE"
  | "TIER_CANNOT_STORE_FIREARM"
  | "STORAGE_DISABLED";

/* ---------------------------------------------------------------------------
   STANDING
   -------------------------------------------------------------------------- */

export const noMembership = (): Block => ({
  code: "NO_MEMBERSHIP",
  message: "You are not a member of the club.",
  remedy: "Members may bring you as their guest, or you can apply to join.",
  overridable: false,
  foreseeable: true,
});

export const membershipPending = (): Block => ({
  code: "MEMBERSHIP_PENDING",
  message: "Your membership is not active yet.",
  remedy: "It activates as soon as your first payment clears.",
  overridable: true,
  foreseeable: true,
});

export const membershipLapsed = (lapsedOn: Date | null): Block => ({
  code: "MEMBERSHIP_LAPSED",
  message: lapsedOn
    ? `Your membership lapsed on ${formatDay(lapsedOn)}.`
    : "Your membership has lapsed.",
  remedy: "Renew in the portal.",
  /* Overridable: a lapsed renewal is a billing matter, and turning a member
     away at the door over one is a worse outcome for the club than the unpaid
     month. The override is recorded and reaches the founder the same day. */
  overridable: true,
  foreseeable: true,
});

export const membershipSuspended = (): Block => ({
  code: "MEMBERSHIP_SUSPENDED",
  message: "Your membership is suspended.",
  remedy: "The founder will be in touch. Nothing to do here.",
  /* Not overridable. A suspension is a decision already taken, usually about
     conduct on a live range. An officer reversing it alone, at a desk, is the
     one override this system must not offer. */
  overridable: false,
  foreseeable: true,
});

export const membershipResigned = (): Block => ({
  code: "MEMBERSHIP_RESIGNED",
  message: "Your membership has ended.",
  remedy: "You are welcome to apply again.",
  overridable: false,
  foreseeable: true,
});

/* ---------------------------------------------------------------------------
   WAIVER

   None of these are overridable. The waiver is the club's legal position if
   someone is injured on a live range, and it takes about twenty seconds to
   sign — so the remedy is always faster than the argument.
   -------------------------------------------------------------------------- */

export const waiverMissing = (): Block => ({
  code: "WAIVER_MISSING",
  message: "You have not signed the range waiver.",
  remedy: "Sign it in the portal, or at the desk when you arrive.",
  overridable: false,
  foreseeable: true,
});

export const waiverSuperseded = (): Block => ({
  code: "WAIVER_SUPERSEDED",
  message: "The range waiver has been updated since you signed it.",
  remedy: "Signing the current version takes a moment at the desk.",
  overridable: false,
  foreseeable: true,
});

export const waiverExpired = (signedAt: Date): Block => ({
  code: "WAIVER_EXPIRED",
  message: `Your waiver, signed on ${formatDay(signedAt)}, is out of date.`,
  remedy: "Signing again takes a moment at the desk.",
  overridable: false,
  foreseeable: true,
});

/* ---------------------------------------------------------------------------
   BOOKING
   -------------------------------------------------------------------------- */

export const bookingHorizonExceeded = (horizonDays: number): Block => ({
  code: "BOOKING_HORIZON_EXCEEDED",
  message: `Your tier books up to ${horizonDays} days ahead.`,
  remedy: "Choose an earlier date, or ask about moving tier.",
  overridable: true,
  foreseeable: true,
});

export const concurrentBookingLimit = (max: number): Block => ({
  code: "CONCURRENT_BOOKING_LIMIT",
  message:
    max === 1
      ? "You already hold a booking."
      : `You already hold ${max} bookings, which is your tier's limit.`,
  remedy: "Cancel or complete one, and this opens up again.",
  overridable: true,
  foreseeable: true,
});

export const disciplineNotInTier = (discipline: string): Block => ({
  code: "DISCIPLINE_NOT_IN_TIER",
  message: `Your tier does not include ${discipline}.`,
  remedy: "Ask about moving tier.",
  /* Overridable: a range officer supervising a first attempt at a new
     discipline is exactly how members discover they want a different tier. */
  overridable: true,
  foreseeable: true,
});

export const laneUnavailable = (discipline: string): Block => ({
  code: "LANE_UNAVAILABLE",
  message: `No ${discipline} lane is open at that time.`,
  remedy: "Another time on the same day may suit.",
  overridable: false,
  foreseeable: false,
});

/* ---------------------------------------------------------------------------
   HOSTING — the acquisition funnel. §3.2 rates its correctness alongside the
   firearm register, and these three messages are where a member meets it.
   -------------------------------------------------------------------------- */

export const tierCannotHost = (): Block => ({
  code: "TIER_CANNOT_HOST",
  message: "Your tier does not include bringing guests.",
  remedy: "Ask about moving tier.",
  overridable: false,
  foreseeable: true,
});

/**
 * §12: "Allowance exhausted mid-booking → Overage offered in the portal with
 * the price shown. Never discovered at the desk."
 *
 * So this block is not really a refusal — it is a price. The message says so,
 * and the caller supplies the figure because a block that says "you have run
 * out" without saying what the next one costs is precisely the discovery at
 * the desk §12 forbids.
 */
export const allowanceExhausted = (
  includedQuota: number,
  overagePrice: string | null,
): Block => ({
  code: "ALLOWANCE_EXHAUSTED",
  message: `You have used all ${includedQuota} guest visits included this year.`,
  remedy: overagePrice
    ? `Further guests are ${overagePrice} each, charged to your account.`
    : "Further guests can be arranged with the club.",
  /* Overridable, and §8.3 requires it: when the desk is offline it authorises
     the visit and reconciles the overage afterwards. "The visit stands — the
     guest is already on the premises." */
  overridable: true,
  foreseeable: true,
});

export const guestConcurrentLimit = (max: number): Block => ({
  code: "GUEST_CONCURRENT_LIMIT",
  message: `Your tier allows ${max} ${max === 1 ? "guest" : "guests"} at a time.`,
  remedy: "A second visit on another day is straightforward.",
  overridable: true,
  foreseeable: true,
});

/* ---------------------------------------------------------------------------
   GUEST ARRIVAL

   These are read by, or read out to, someone who has never been here before
   and is already slightly nervous (§6.3). The register is warmer than
   anywhere else in the catalogue, and none of them imply the guest did
   anything wrong — because in every case they did not.
   -------------------------------------------------------------------------- */

export const noInvitation = (): Block => ({
  code: "NO_INVITATION",
  message: "We do not have an invitation for you today.",
  remedy: "Your host can send one from the portal in a moment.",
  overridable: false,
  foreseeable: false,
});

export const invitationCancelled = (): Block => ({
  code: "INVITATION_CANCELLED",
  message: "This invitation was cancelled.",
  remedy: "Your host can issue another.",
  overridable: false,
  foreseeable: false,
});

export const invitationExpired = (): Block => ({
  code: "INVITATION_EXPIRED",
  message: "This invitation has expired.",
  remedy: "Your host can issue another.",
  overridable: false,
  foreseeable: false,
});

export const invitationIncomplete = (): Block => ({
  code: "INVITATION_INCOMPLETE",
  message: "Your visitor details are not complete yet.",
  remedy: "The link your host sent takes about two minutes to finish.",
  overridable: false,
  foreseeable: false,
});

/**
 * THE RULE §4 SINGLES OUT.
 *
 *   "The host-presence rule in GUEST_MAY_ATTEND is easy to miss and is not
 *    optional. A guest who arrives before their host waits. The check must
 *    re-evaluate when the host checks in, so the desk row clears by itself
 *    rather than requiring the officer to retry."
 *
 * The self-clearing half of that is the desk's obligation, not this
 * function's — but the remedy line is written to make the wait feel handled
 * rather than stuck, because someone is standing in a foyer reading it.
 */
export const hostNotCheckedIn = (hostName: string | null): Block => ({
  code: "HOST_NOT_CHECKED_IN",
  message: hostName
    ? `${hostName} has not arrived yet.`
    : "Your host has not arrived yet.",
  remedy: "You will be checked in as soon as they are.",
  /* Not overridable. §1.1: a guest may be on the premises "only while that
     host is present". This is the membership model, not a queue. */
  overridable: false,
  foreseeable: false,
});

/* ---------------------------------------------------------------------------
   COMPETENCY — the club's own assessment, distinct from a state licence.
   -------------------------------------------------------------------------- */

export const qualificationMissing = (discipline: string): Block => ({
  code: "QUALIFICATION_MISSING",
  message: `You are not yet signed off for ${discipline}.`,
  remedy: "A range officer can assess you on the day.",
  /* Overridable: the override IS the assessment — an officer supervising a
     shooter is the normal path to being signed off. */
  overridable: true,
  foreseeable: true,
});

export const qualificationExpired = (
  discipline: string,
  expiredOn: Date,
): Block => ({
  code: "QUALIFICATION_EXPIRED",
  message: `Your ${discipline} sign-off lapsed on ${formatDay(expiredOn)}.`,
  remedy: "A range officer can reassess you on the day.",
  overridable: true,
  foreseeable: true,
});

/* ---------------------------------------------------------------------------
   PROPERTY

   §12: "Member licence expired yesterday → Own-firearm use blocked.
   Club-equipment shooting still permitted."
                                                                  ↑
   That second sentence is why every remedy here points at club equipment. The
   member's day is not over; one option in it has closed. None of these are
   overridable — a firearm licence is the state's permission, not the club's,
   and an officer has no standing to waive it.
   -------------------------------------------------------------------------- */

export const tierCannotOwnFirearm = (): Block => ({
  code: "TIER_CANNOT_OWN_FIREARM",
  message: "Your tier does not include shooting your own firearm.",
  remedy: "Club firearms are available to you. Ask about moving tier.",
  overridable: false,
  foreseeable: true,
});

export const licenceMissing = (): Block => ({
  code: "LICENCE_MISSING",
  message: "We do not hold a firearm licence for you.",
  remedy: "Upload it in the portal. Club firearms are available meanwhile.",
  overridable: false,
  foreseeable: true,
});

export const licenceUnverified = (): Block => ({
  code: "LICENCE_UNVERIFIED",
  message: "Your firearm licence is still being checked.",
  remedy: "We will confirm within a few days. Club firearms are available meanwhile.",
  overridable: false,
  foreseeable: true,
});

export const licenceExpired = (expiredOn: Date): Block => ({
  code: "LICENCE_EXPIRED",
  message: `Your firearm licence expired on ${formatDay(expiredOn)}.`,
  remedy: "Club firearms are available to you today.",
  overridable: false,
  foreseeable: true,
});

export const licenceRevoked = (): Block => ({
  code: "LICENCE_REVOKED",
  message: "Your firearm licence is recorded as revoked.",
  remedy: "Club firearms are available to you today.",
  overridable: false,
  foreseeable: true,
});

/**
 * §12: "Guest shoots a member-owned firearm → Blocked at pairing."
 *
 * The commonest way this fires is not a guest at all — it is two members whose
 * firearms are side by side on the same bench and whose serials differ by one
 * digit. The message names the fact rather than accusing anyone.
 */
export const firearmNotOwned = (serialNumber: string): Block => ({
  code: "FIREARM_NOT_OWNED",
  message: `Firearm ${serialNumber} is not registered to you.`,
  remedy: "Its owner may shoot it, or use a club firearm.",
  /* Overridable, but loudly: §12 requires that an override here "appears as a
     same-day dashboard exception". There are legitimate cases — a coach
     handing over on the line — and the club would rather see them recorded
     than see officers work around the system. */
  overridable: true,
  foreseeable: false,
});

export const calibreOutsideLicence = (calibre: string): Block => ({
  code: "CALIBRE_OUTSIDE_LICENCE",
  message: `Your licence does not cover ${calibre}.`,
  remedy: "Club firearms in a covered calibre are available to you.",
  overridable: false,
  foreseeable: true,
});

export const firearmUnavailable = (
  serialNumber: string,
  status: string,
): Block => ({
  code: "FIREARM_UNAVAILABLE",
  message: `Firearm ${serialNumber} is not on the rack — it is ${status}.`,
  remedy: "The armoury log shows where it is.",
  overridable: false,
  foreseeable: false,
});

export const tierCannotStoreFirearm = (): Block => ({
  code: "TIER_CANNOT_STORE_FIREARM",
  message: "Your tier does not include storing a firearm at the club.",
  remedy: "Ask about moving tier.",
  overridable: false,
  foreseeable: true,
});

/**
 * §14 lists the on-premises storage decision as outstanding, and §13 puts the
 * workflow behind a flag until it lands. Failing closed with an honest message
 * is the correct behaviour of an unbuilt feature — not a screen that accepts a
 * firearm the club has not yet decided it can lawfully hold.
 */
export const storageDisabled = (): Block => ({
  code: "STORAGE_DISABLED",
  message: "On-site firearm storage is not open yet.",
  remedy: "The club will write to members when it is.",
  overridable: false,
  foreseeable: false,
});
