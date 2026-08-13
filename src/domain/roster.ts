import type { MembershipStatus } from "./enums";

/**
 * THE ROSTER CAP AND THE WAITLIST — §1.1, §3.1, §5, §12.
 *
 *   §1.1: "Membership is by application and admission, not purchase. The roster
 *          has a hard cap; a waitlist sits behind it."
 *   §5:   "Admission requires roster headroom or an explicit founder override."
 *   §12:  "Roster at cap, application admitted → Blocked, or admitted only with
 *          explicit founder override recorded."
 *
 * ===========================================================================
 * §14 LEAVES THE NUMBER OPEN, SO THIS FILE OWNS THE MECHANISM AND NOT THE VALUE
 *
 * §14 lists "Roster cap and capacity model" as blocking "admission enforcement,
 * waitlist", needed before M3 — and it has not landed. The cap is a founder
 * decision about a building.
 *
 * What is NOT open is what to do with it, and that is all of this file. The
 * capacity model arrives as a `RosterPolicy`; nothing here hard-codes a number,
 * so when the founder settles it the change is configuration rather than code.
 *
 * ===========================================================================
 * THE DEFAULTS FAIL TOWARDS ADMITTING FEWER PEOPLE
 *
 * Two questions the specification does not settle, both of which change the
 * count, and both defaulted to the conservative reading:
 *
 *   1. DOES A PENDING MEMBERSHIP HOLD A SEAT?
 *      §5: "pending → active (on payment)". So an admitted applicant who has
 *      not yet paid is `pending`. If pending did not count, the club could
 *      admit past its cap simply by admitting faster than people pay — and
 *      discover it when they all paid. Counted.
 *
 *   2. DOES A PARTNER MEMBERSHIP HOLD A SEAT?
 *      §3.1 has attached memberships for the Partner case. Whether the cap
 *      counts people or households is genuinely the founder's call. Counted by
 *      default, because a Partner is a person standing on a range, and the cap
 *      is ultimately about how many people the building holds.
 *
 * The asymmetry justifying both defaults: admitting one member too many is
 * irreversible — the club cannot ask them to leave — while admitting one too
 * few is a phone call. When the rule is unclear, the recoverable error is the
 * right one to make.
 */

/** The capacity model. §14's open item, expressed as a parameter. */
export type RosterPolicy = {
  /**
   * The hard cap (§1.1). Null means the founder has not set one — see
   * `rosterStanding`, which refuses to invent a number.
   */
  readonly cap: number | null;
  /** Whether an admitted-but-unpaid membership holds a seat. Default true. */
  readonly countPending: boolean;
  /** Whether an attached Partner membership holds its own seat. Default true. */
  readonly countAttached: boolean;
};

export const DEFAULT_ROSTER_POLICY: RosterPolicy = {
  cap: null,
  countPending: true,
  countAttached: true,
};

/** One membership, as the cap sees it. */
export type RosterMembership = {
  readonly status: MembershipStatus;
  readonly isAttached: boolean;
};

export type RosterStanding = {
  readonly occupied: number;
  readonly cap: number | null;
  /**
   * Seats remaining. Zero when at or over the cap.
   *
   * Null cap yields null headroom rather than Infinity, and the distinction is
   * the point: `applicationTransition` treats `rosterHeadroom <= 0` as at-cap,
   * so a number is an answer and null is "nobody has decided". The caller must
   * handle the second case explicitly rather than being handed a value that
   * silently admits everybody.
   */
  readonly headroom: number | null;
  /** True only when there is a cap and it is reached or passed. */
  readonly atCap: boolean;
  /** Over the cap — which an override can produce, and a report must show. */
  readonly overCap: number;
};

/**
 * Does this membership hold a seat?
 *
 * `lapsed` and `resigned` do not: the whole purpose of a cap with a waitlist
 * behind it is that a seat returns when someone leaves. `suspended` does —
 * a suspension is a sanction, not a departure, and the member is expected back.
 */
export function occupiesSeat(
  membership: RosterMembership,
  policy: RosterPolicy,
): boolean {
  if (membership.isAttached && !policy.countAttached) return false;

  switch (membership.status) {
    case "active":
    case "suspended":
      return true;
    case "pending":
      return policy.countPending;
    case "lapsed":
    case "resigned":
      return false;
  }
}

export function rosterStanding(
  memberships: readonly RosterMembership[],
  policy: RosterPolicy,
): RosterStanding {
  const occupied = memberships.filter((m) => occupiesSeat(m, policy)).length;
  const cap = policy.cap;

  if (cap === null) {
    return { occupied, cap: null, headroom: null, atCap: false, overCap: 0 };
  }

  return {
    occupied,
    cap,
    headroom: Math.max(0, cap - occupied),
    atCap: occupied >= cap,
    overCap: Math.max(0, occupied - cap),
  };
}

/**
 * The sentence the founder's dashboard shows (§6.6: "Roster against cap with
 * waitlist depth").
 *
 * Written here rather than in the component for the reason §4.1 gives about
 * block messages: the same fact should reach the founder in the same words
 * wherever they read it.
 */
export function rosterSummary(
  standing: RosterStanding,
  waitlistDepth: number,
): string {
  const waiting =
    waitlistDepth === 0
      ? "nobody waiting"
      : `${waitlistDepth} waiting`;

  if (standing.cap === null) {
    return `${standing.occupied} members, no cap set, ${waiting}.`;
  }

  if (standing.overCap > 0) {
    return `${standing.occupied} members against a cap of ${standing.cap} — ${standing.overCap} over, ${waiting}.`;
  }

  return `${standing.occupied} of ${standing.cap} members, ${standing.headroom} seats free, ${waiting}.`;
}

/* ============================================================================
   THE WAITLIST — §3.1

   "position maintained server-side. Never derived from a client sort. A
    waitlist is a promise about fairness; a position that can be reordered by
    whatever order a list happened to arrive in is not one."
   ========================================================================= */

export type WaitlistEntry = {
  readonly id: string;
  readonly position: number;
  readonly addedAt: Date;
};

/**
 * Renumber a waitlist to 1..n, contiguous, preserving the existing order.
 *
 * Contiguity is not cosmetic. A member told they are "fourth" who watches two
 * people ahead of them join and remains "fourth" has been told something
 * untrue, and the waitlist is the one place §1.1 makes the club's fairness
 * visible. Gaps left by admissions and withdrawals must close.
 *
 * Ties on position are broken by `addedAt`, then by id. Ties should not occur —
 * positions are unique in practice — but a renumber that reordered two entries
 * differently on each run would silently shuffle the queue, so the comparator is
 * made total rather than left to the sort's stability.
 */
export function renumber(
  entries: readonly WaitlistEntry[],
): { id: string; position: number }[] {
  return [...entries]
    .sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      const byTime = a.addedAt.getTime() - b.addedAt.getTime();
      if (byTime !== 0) return byTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((entry, index) => ({ id: entry.id, position: index + 1 }));
}

/** Where a new entry joins: the back. */
export function nextPosition(entries: readonly WaitlistEntry[]): number {
  return entries.length === 0
    ? 1
    : Math.max(...entries.map((entry) => entry.position)) + 1;
}

/**
 * Move one entry to a new position, closing the gap it left and pushing the
 * others along. §6.6 gives the founder a reorder; this is what it means.
 *
 * The target is clamped rather than rejected. A founder dragging someone to
 * "position 40" on a list of twelve means the bottom, and refusing the gesture
 * with an error would be pedantry about an intention that was perfectly clear.
 */
export function moveTo(
  entries: readonly WaitlistEntry[],
  entryId: string,
  target: number,
): { id: string; position: number }[] {
  const ordered = renumber(entries);
  const from = ordered.findIndex((entry) => entry.id === entryId);
  if (from === -1) return ordered;

  const to = Math.max(0, Math.min(ordered.length - 1, target - 1));
  if (to === from) return ordered;

  const moved = [...ordered];
  const [entry] = moved.splice(from, 1);
  moved.splice(to, 0, entry);

  return moved.map((item, index) => ({ id: item.id, position: index + 1 }));
}
