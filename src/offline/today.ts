import {
  evaluate,
  type Decision,
  type InvitationSnapshot,
  type WaiverSignatureSnapshot,
} from "@/domain/capability";
import { formatTime } from "@/lib/time";
import { arrivalsFor, subjectFor, type IndexedDayPack, type PackArrival } from "./daypack";

/**
 * THE TODAY SCREEN, DECIDED — §6.4, §4, §12.1.
 *
 *   §6.4: "Expected arrivals in time order: name, photograph, tier or host,
 *          discipline, and ONE status indicator — clear, attention, blocked.
 *          Renders in under one second from cold, with no network."
 *
 * A pure function from a day pack to a list of rows. The component that renders it
 * makes no decisions at all, which is what §4 requires — "No screen makes its own
 * permission decision" — and what makes the rule §12.1 singles out testable without
 * a browser:
 *
 *   "Guest arrives before host → Blocked with a clear reason. Clears automatically
 *    when the host checks in — no retry needed."
 *
 * That clearing is not an event, a subscription or a refetch. It is this function
 * being called again with a larger `checkedIn` set, which happens because the
 * check-in that admitted the host changed local state. The guest's row re-evaluates
 * because everything it depends on is an argument.
 *
 * ===========================================================================
 * WHY THERE IS ONE INDICATOR AND NOT A LIST OF PROBLEMS
 *
 * §4.3: "Every block returns a specific single-line reason. Never 'not permitted',
 * never a code, never a stack of conditions."
 *
 * A member can fail two checks at once — a lapsed membership and an unsigned
 * waiver. The capability service already resolves that to the most fundamental one,
 * and this layer does not add a second opinion: it takes the decision it is given
 * and maps it to one of three states. Anything that showed both would put the
 * officer in the position of deciding which matters, in front of a queue.
 */

/** §6.4's three states. */
export type ArrivalStatus = "clear" | "attention" | "blocked";

export type ArrivalRow = {
  personId: string;
  name: string;
  photoUrl: string | null;
  /** §6.4: "tier or host" — a member shows their tier, a guest shows who brought them. */
  subtitle: string;
  discipline: string;
  /** Africa/Lagos, per §2. */
  time: string;
  status: ArrivalStatus;
  /** The single line. Empty when clear — a cleared row says nothing. */
  line: string;
  /** §4.3: whether an officer may let this through with a recorded reason. */
  overridable: boolean;
  /** True once this person is on the premises. */
  checkedIn: boolean;
  /**
   * Whether what stands in this row's way is a signature the desk can take.
   *
   * Decided here rather than in the component, because deciding it means reading
   * a reason code and §4 is explicit that "no screen makes its own permission
   * decision". The component renders a button; this says whether there is one.
   *
   * False for a member blocked by something else even if their waiver is also
   * unsigned — §4.3 resolves a row to its single most fundamental reason, and
   * signing would not admit somebody whose membership has lapsed. The offer is
   * made only when taking it actually clears the row.
   */
  needsWaiver: boolean;
};

/**
 * The three blocks a signature at the desk resolves. §3.1, and reasons.ts.
 *
 * None of them is overridable — the waiver is the club's legal position if
 * someone is hurt on a live range — so for a row in one of these states this is
 * the ONLY way forward. Before src/offline/waiver.ts existed there was none, and
 * the check-in button on such a row is disabled by §4.3.
 */
const SIGNABLE = new Set(["WAIVER_MISSING", "WAIVER_SUPERSEDED", "WAIVER_EXPIRED"]);

/**
 * Map a decision onto the indicator.
 *
 * The distinction between `attention` and `blocked` is whether §4.3 permits an
 * override. That is the only difference an officer can act on: attention means
 * "you may let this through and say why", blocked means "this is not yours to
 * waive". Collapsing them into one red state would make every refusal look like a
 * negotiation.
 */
function statusFor(decision: Decision): ArrivalStatus {
  if (decision.allowed) return "clear";
  return decision.overridable ? "attention" : "blocked";
}

const personName = (indexed: IndexedDayPack, personId: string): string => {
  const person = indexed.personById.get(personId);
  return person ? `${person.firstName} ${person.lastName}` : "Unknown person";
};

/**
 * The invitation as the capability service wants it.
 *
 * Null when the arrival cites no invitation, or cites one the pack does not carry —
 * both of which `GUEST_MAY_ATTEND` already treats as "no valid invitation", so this
 * does not need to distinguish them and must not invent a third answer.
 */
function invitationSnapshot(
  indexed: IndexedDayPack,
  invitationId: string | null,
): InvitationSnapshot | null {
  if (!invitationId) return null;
  const invitation = indexed.invitationById.get(invitationId);
  if (!invitation) return null;
  return {
    status: invitation.status,
    expiresAt: new Date(invitation.expiresAt),
  };
}

/**
 * Decide one arrival.
 *
 * Split out so the guest branch is readable: §4.2 gives guests a different
 * capability, not a variation of the member one, because a guest has no membership
 * and applying a tier rule to someone who has no tier is how a guest ends up
 * blocked for a reason about a tier they were never going to have.
 */
function rowFor(
  indexed: IndexedDayPack,
  arrival: PackArrival,
  now: Date,
  checkedIn: ReadonlySet<string>,
  locallySigned: ReadonlyMap<string, WaiverSignatureSnapshot>,
): ArrivalRow {
  const pack = indexed.pack;
  const subject = subjectFor(indexed, arrival.personId, locallySigned);
  const person = indexed.personById.get(arrival.personId);

  const waiver = {
    activeWaiverVersionId: pack.activeWaiverVersionId,
    waiverValidityDays: pack.waiverValidityDays,
  };

  /**
   * A person in the arrivals list who is not in the pack's roster.
   *
   * Should be impossible — the pack carries every person it lists an arrival for —
   * but the failure mode of a thrown exception here is a blank Today screen at eight
   * in the morning, and the failure mode of this is one row an officer has to ask
   * about. §1.1's whole point is that the range keeps operating.
   */
  if (!subject) {
    return {
      personId: arrival.personId,
      name: "Unknown person",
      photoUrl: null,
      subtitle: "Not in today's information",
      discipline: arrival.discipline,
      time: formatTime(new Date(arrival.slotStart)),
      status: "blocked",
      line: "This booking refers to someone this device does not have on file.",
      overridable: false,
      checkedIn: false,
      needsWaiver: false,
    };
  }

  const isGuest = arrival.role === "guest_shooter";

  const decision = isGuest
    ? evaluate(subject, {
        capability: "GUEST_MAY_ATTEND",
        now,
        /* Exactly what `InvitationSnapshot` declares and nothing more. The
           capability service decides on the status and the expiry; handing it the
           host id as well would invite a second host-presence check inside
           `evaluate()` alongside the one §4 already specifies. */
        invitation: invitationSnapshot(indexed, arrival.invitationId),
        host: {
          /* The rule §12.1 singles out. Read from the set of people already
             checked in, so the guest's row clears the moment the host's check-in
             lands — with no retry, and with no network. */
          checkedIn: arrival.hostPersonId
            ? checkedIn.has(arrival.hostPersonId)
            : false,
          name: arrival.hostPersonId
            ? personName(indexed, arrival.hostPersonId)
            : null,
        },
        ...waiver,
      })
    : evaluate(subject, { capability: "MAY_ATTEND", now, ...waiver });

  const membership = indexed.membershipByPersonId.get(arrival.personId);
  const tier = membership ? indexed.tierById.get(membership.tierId) : undefined;

  const subtitle = isGuest
    ? `Guest of ${arrival.hostPersonId ? personName(indexed, arrival.hostPersonId) : "an unnamed member"}`
    : (tier?.name ?? "No tier");

  return {
    personId: arrival.personId,
    name: person ? `${person.firstName} ${person.lastName}` : "Unknown person",
    photoUrl: person?.photoUrl ?? null,
    subtitle,
    discipline: arrival.discipline,
    time: formatTime(new Date(arrival.slotStart)),
    status: statusFor(decision),
    line: decision.allowed ? "" : decision.reason.message,
    overridable: decision.allowed ? false : decision.overridable,
    checkedIn: checkedIn.has(arrival.personId),
    needsWaiver: !decision.allowed && SIGNABLE.has(decision.reason.code),
  };
}

/**
 * Every expected arrival for one Lagos day, in time order, with its status.
 *
 * `checkedIn` is the set of people already on the premises — from local
 * participations, including ones still in the outbox, because a check-in written
 * during a power cut has happened whether or not the server knows.
 *
 * `locallySigned` is the same idea for §3.1's waiver: signatures taken at this
 * desk, which the pack cannot know about because it was pulled before they
 * happened. A waiver block clears the moment it is signed for exactly the reason
 * a guest's block clears when their host arrives — everything the row depends on
 * is an argument, so re-evaluating is the whole mechanism. Defaulted empty so a
 * caller with nothing local to say reads as it did before.
 */
export function todayRows(
  indexed: IndexedDayPack,
  dateKey: string,
  now: Date,
  checkedIn: ReadonlySet<string>,
  locallySigned: ReadonlyMap<string, WaiverSignatureSnapshot> = new Map(),
): ArrivalRow[] {
  return arrivalsFor(indexed, dateKey).map((arrival) =>
    rowFor(indexed, arrival, now, checkedIn, locallySigned),
  );
}

/** One line for the screen header: how the day stands at a glance. */
export function todaySummary(rows: readonly ArrivalRow[]): string {
  if (rows.length === 0) return "No arrivals expected today.";

  const waiting = rows.filter((row) => !row.checkedIn).length;
  const problems = rows.filter(
    (row) => row.status !== "clear" && !row.checkedIn,
  ).length;

  const expected =
    rows.length === 1 ? "1 arrival expected" : `${rows.length} arrivals expected`;

  if (problems === 0) return `${expected}, ${waiting} still to arrive.`;
  return `${expected}, ${waiting} still to arrive, ${problems} needing attention.`;
}
