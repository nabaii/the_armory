import {
  OPERATING_LEVELS,
  type DegradationCause,
  type OperatingLevel,
  type StaffGrant,
} from "./enums";

/**
 * THE DEGRADATION LADDER, AS A SWITCH — Management System §6.2.
 *
 *   "Make the degradation ladder a switch. One control, four positions, held by
 *    the duty manager and above. Moving it does the work rather than describing
 *    it: guest bookings cap, affected slots close, affected members are notified
 *    on WhatsApp, the desk console's day pack updates, and the change is logged
 *    with who set it, when, and why. A reason is required."
 *
 * ===========================================================================
 * A REASON IS NOT AN AUDIT FIELD HERE. IT IS THE PRODUCT
 *
 * §6.2 is explicit that the reason is "not a free-text afterthought — a short
 * required field, because the value of this control over a season is the record
 * of why the club degraded, which is an operational analytic in §11.3 and a
 * staffing argument the founder will otherwise have to make from memory."
 *
 * So the cause is a closed vocabulary that can be counted, and the note is free
 * text that carries the particulars. Both are required. A control that logged
 * only the new level would tell the founder in December that the club degraded
 * eleven times and nothing about whether to hire somebody.
 *
 * ===========================================================================
 * PURE, AND IT DECIDES NOTHING ABOUT NOTIFICATIONS
 *
 * This module answers what a level MEANS and whether a move is permitted. It
 * does not send a WhatsApp message, close a slot or rebuild a day pack — those
 * are effects, and `src/domain/state-machines.ts` already establishes the house
 * pattern of returning effects as data rather than performing them. `consequences`
 * below is that list; the server module carries it out.
 */

/* ============================================================================
   WHAT EACH RUNG MEANS
   ========================================================================= */

export type LevelDefinition = {
  readonly level: OperatingLevel;
  /** What staff see on the control. */
  readonly label: string;
  /** What a member is told. Written for them, not for the club. */
  readonly memberLine: string;
  /** Whether the firing line is running at all. */
  readonly liveFire: boolean;
  /** Whether guests may be brought at all. */
  readonly guestsAdmitted: boolean;
  /**
   * Whether the deck and kitchen trade.
   *
   * True at every rung including the last, and that is the hospitality-first
   * principle surviving contact with a bad evening: the club closing its range
   * is not the club closing. §6.2's ladder ends at "the clubhouse trades only"
   * rather than at "closed" for exactly this reason.
   */
  readonly hospitality: boolean;
};

export const LEVEL_DEFINITIONS: readonly LevelDefinition[] = [
  {
    level: "normal",
    label: "Normal",
    memberLine: "The club is running normally.",
    liveFire: true,
    guestsAdmitted: true,
    hospitality: true,
  },
  {
    level: "guests_capped",
    label: "Guests capped",
    memberLine:
      "The club is busy this evening and is not taking new guest bookings. Members are unaffected.",
    liveFire: true,
    guestsAdmitted: false,
    hospitality: true,
  },
  {
    level: "live_fire_closed",
    label: "No live fire",
    memberLine:
      "The range is closed this evening. The deck and kitchen are open as usual.",
    liveFire: false,
    guestsAdmitted: false,
    hospitality: true,
  },
  {
    level: "range_closed",
    label: "Range closed — clubhouse only",
    memberLine:
      "The range is closed. The clubhouse is open and serving.",
    liveFire: false,
    guestsAdmitted: false,
    hospitality: true,
  },
];

export const definitionOf = (level: OperatingLevel): LevelDefinition =>
  LEVEL_DEFINITIONS.find((entry) => entry.level === level) ?? LEVEL_DEFINITIONS[0];

/** How far down the ladder a level sits. The order in OPERATING_LEVELS is the rank. */
export const rankOf = (level: OperatingLevel): number =>
  OPERATING_LEVELS.indexOf(level);

/* ============================================================================
   WHO MAY MOVE IT

   §18's second open decision, settled by the founder on 17 August 2026:
   DUTY MANAGER AND ABOVE.
   ========================================================================= */

/**
 * The grants that admit the control.
 *
 * Either, not both. A duty manager holds `programme`; a safety officer holds
 * `safety_manage` and no programme grant at all, and a ladder they could not
 * touch would be a safety veto that cannot stop anything — which is the one
 * refusal S4 exists to guarantee they CAN make.
 *
 * A range officer holds neither, per the founder's decision. On an evening with
 * nobody senior on site the answer is an acting grant, issued with a reason and
 * lapsing by clock — which is the mechanism §4.3's gap was closed with, and it
 * leaves a record where a widened permission would not.
 */
export const MAY_SET_LEVEL: readonly StaffGrant[] = ["programme", "safety_manage"];

export const maySetLevel = (grants: ReadonlySet<StaffGrant>): boolean =>
  MAY_SET_LEVEL.some((grant) => grants.has(grant));

/* ============================================================================
   MOVING IT
   ========================================================================= */

export class OperatingLevelError extends Error {}

export type LevelChange = {
  readonly from: OperatingLevel;
  readonly to: OperatingLevel;
  readonly cause: DegradationCause;
  /** The particulars. Required — see the header. */
  readonly note: string;
  readonly grants: ReadonlySet<StaffGrant>;
};

/**
 * What moving the level obliges the club to do, as data.
 *
 * ===========================================================================
 * RECOVERY IS NOT THE MIRROR OF DEGRADATION
 *
 * Coming back UP the ladder does not undo what going down did, and treating it
 * as symmetrical is the bug this shape prevents. Closing live fire cancels
 * bookings and tells those members; reopening it cannot un-tell them, and it
 * must not silently reinstate a booking somebody has already made other plans
 * around. So recovery notifies and reopens AVAILABILITY, and leaves the
 * cancelled bookings cancelled.
 */
export type Consequence =
  | { readonly kind: "cap_guest_bookings" }
  | { readonly kind: "close_shooting_slots"; readonly fromNow: true }
  | { readonly kind: "notify_affected_members"; readonly line: string }
  | { readonly kind: "refresh_day_pack" }
  | { readonly kind: "reopen_availability" };

export function consequences(change: {
  readonly from: OperatingLevel;
  readonly to: OperatingLevel;
}): Consequence[] {
  const before = definitionOf(change.from);
  const after = definitionOf(change.to);
  const out: Consequence[] = [];

  const descending = rankOf(change.to) > rankOf(change.from);

  if (before.guestsAdmitted && !after.guestsAdmitted) {
    out.push({ kind: "cap_guest_bookings" });
  }

  if (before.liveFire && !after.liveFire) {
    out.push({ kind: "close_shooting_slots", fromNow: true });
  }

  /* Members hear about every move in both directions. §6.2 puts notification
     inside the control rather than beside it, because the version where staff
     remember to send a message afterwards is the version where a member drives
     to a closed range. */
  out.push({ kind: "notify_affected_members", line: after.memberLine });

  /* The desk works from a day pack and is offline-first, so a level change that
     did not reach it would leave the console admitting guests the club has just
     stopped taking. */
  out.push({ kind: "refresh_day_pack" });

  if (!descending) out.push({ kind: "reopen_availability" });

  return out;
}

/**
 * Validate a move, or throw.
 *
 * Throws rather than returning a refusal, unlike `decideGrant`. The difference
 * is who is asking: a grant assignment can legitimately be attempted and
 * refused by governance, so a screen renders that sentence to a person. A level
 * change reaching this function with no permission or no reason is a screen that
 * failed to guard itself, which is a defect rather than an answer.
 */
export function validateChange(change: LevelChange): Consequence[] {
  if (!maySetLevel(change.grants)) {
    throw new OperatingLevelError(
      "Moving the operating level is held by the duty manager and above.",
    );
  }

  if (change.from === change.to) {
    throw new OperatingLevelError(
      `The club is already at ${definitionOf(change.to).label.toLowerCase()}.`,
    );
  }

  /* §12.1 lists the operating level among the actions that must always carry a
     reason. The same twelve-character floor as an override and a grant, for the
     same reason: somebody reads this next quarter with nobody left to ask. */
  if (change.note.trim().length < 12) {
    throw new OperatingLevelError(
      "A level change needs a note a founder can read next quarter and " +
        "understand without asking anyone.",
    );
  }

  return consequences(change);
}

/**
 * Degradation events grouped by cause, for §11.3's staffing argument.
 *
 * Counts, not percentages — §11.1. And a count of MOVES rather than of hours
 * spent degraded, because the founder's question is "how often did this happen
 * and why", and an hours figure would let one very long closure look like a
 * chronic staffing problem.
 */
export function degradationSummary(
  events: readonly { readonly cause: DegradationCause; readonly to: OperatingLevel }[],
): { readonly cause: DegradationCause; readonly count: number }[] {
  const counts = new Map<DegradationCause, number>();

  for (const event of events) {
    /* Recovery is not degradation. A move back to normal has a cause recorded
       against it, and counting it here would double every episode. */
    if (event.to === "normal") continue;
    counts.set(event.cause, (counts.get(event.cause) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count);
}
