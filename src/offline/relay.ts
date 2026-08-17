import type { IndexedDayPack, PackLane } from "./daypack";
import type { LocalParticipation } from "./checkin";
import type { LocalIssue } from "./close";
import { standingRounds, type ScoredRound } from "@/domain/scoring";

/**
 * THE RELAY — §6.5's first screen.
 *
 *   "Relay — Who is on which lane right now. LARGE TYPE, READABLE AT ARM'S
 *    LENGTH IN DAYLIGHT."
 *
 * ===========================================================================
 * THE ACCEPTANCE CRITERION IS ABOUT A ROOM, NOT ABOUT A COMPONENT
 *
 * "Arm's length in daylight" is not a font size on a design mock. It is a
 * tablet clamped to a post on a covered outdoor firing line at midday in Abuja,
 * read by an officer wearing ear defenders who is not going to walk over and
 * squint.
 *
 * What that constrains is the DATA, which is why it is enforced here and not
 * only in CSS: a row that has to carry six facts cannot be set in type that
 * large. So a relay row carries four — the lane, the shooter, what they are
 * shooting with, and whether anything is outstanding — and everything else is
 * one tap away on the lane's own screen.
 *
 * The temptation this resists is adding the shooter's tier, their member
 * number, their check-in time and their round count "since we have them". Each
 * is defensible alone; together they are a spreadsheet nobody can read from two
 * metres, and the officer goes back to looking down the line.
 *
 * ===========================================================================
 * READ FROM LOCAL STATE, LIKE EVERY OTHER DESK DECISION
 *
 * Same reasoning as src/offline/lanes.ts and src/offline/today.ts: the pack
 * describes who was EXPECTED, and `armory-session` holds who actually arrived.
 * A relay built from the pack alone would show a line-up from whenever the last
 * pull succeeded, which on a range with no uplink is a line-up from this
 * morning.
 *
 * This module is pure — it takes the pack and the local rows and returns rows.
 * It touches no store, which is what lets the legibility rule above be asserted
 * as a property of the data in a unit test.
 */

/**
 * A card as the lane holds it, before and after it is sent.
 *
 * `ScoredRound` (src/domain/scoring.ts) is the shape §6.2's history reads, and
 * it deliberately carries no participation — a member's phone has no business
 * holding one. The lane needs it, so the lane's type widens rather than the
 * portal's.
 */
export type LocalRound = ScoredRound & {
  readonly participationId: string;
  readonly sessionId: string;
  readonly capturedByStaffId: string | null;
};

/**
 * Everybody on the premises, as this device best understands it.
 *
 * The pack carries what the SERVER knew at the last pull (`PackParticipation`);
 * `armory-session` carries what THIS device recorded, sent or not. A lane tablet
 * has only the first — it takes no check-ins — and a desk that had just checked
 * somebody in has the second before anybody else does.
 *
 * ===========================================================================
 * LOCAL WINS, AND IT WINS ON EVERY FIELD
 *
 * Keyed by the participation's id, which is the same UUIDv7 on both sides (§7),
 * so the two copies of one check-in collapse rather than double.
 *
 * When they disagree, the local row is taken whole rather than merged
 * field-by-field. Field-level merging sounds more careful and is worse: the
 * common disagreement is a check-OUT this device recorded thirty seconds ago
 * and has not sent, and a merge that preferred the server's `checkedOutAt`
 * because it preferred non-null values would put somebody back on a lane they
 * had just left. Whole-row means the disagreement is resolved once, in one
 * direction, and the direction is "the device that recorded it knows".
 *
 * The rows the pack has and the device does not are added as they are. That is
 * the case this function exists for: a lane tablet learning that the desk
 * checked somebody in.
 */
export function mergedParticipations(
  indexed: IndexedDayPack,
  local: readonly LocalParticipation[],
): LocalParticipation[] {
  const byId = new Map<string, LocalParticipation>();

  for (const row of indexed.pack.participations ?? []) {
    byId.set(row.id, {
      id: row.id,
      sessionId: row.sessionId,
      personId: row.personId,
      role: row.role,
      hostPersonId: row.hostPersonId,
      laneId: row.laneId,
      /* The pack does not carry `tier_snapshot` and this device has no decision
         that reads one — see the projection. Null rather than a guess. */
      tierSnapshot: null,
      checkedInAt: row.checkedInAt,
      /* The day pack does not carry the check-in clock and this device has no
         decision that reads one. Null rather than a guess — the measurement
         belongs to the desk that took it, and inventing a start here would put
         a duration into §11.4's figures that nobody timed. */
      arrivalAt: null,
      checkedInByStaffId: null,
      checkedOutAt: row.checkedOutAt,
    });
  }

  for (const row of local) byId.set(row.id, row);

  return [...byId.values()];
}

export type RelayShooter = {
  readonly participationId: string;
  readonly personId: string;
  readonly name: string;
  /** §6.5 scores guests identically; the badge exists for the officer's eye. */
  readonly isGuest: boolean;
  /**
   * The serial of what they are paired with, or null.
   *
   * Null is a real and common state — a shooter using club equipment issued at
   * the desk is paired; one who has not been to the counter yet is not — so it
   * renders as "not paired" rather than as an error.
   */
  readonly firearmSerial: string | null;
  /** Standing cards recorded for this participation. §1.2 rule 3 applied. */
  readonly cardsRecorded: number;
};

export type RelayLane = {
  readonly laneId: string;
  readonly label: string;
  readonly number: number;
  readonly discipline: string;
  readonly status: PackLane["status"];
  readonly shooters: readonly RelayShooter[];
  /**
   * One line under the lane number, or null when there is nothing to say.
   *
   * Null rather than "OK" deliberately: a column of "OK" is a column an eye
   * stops reading, and the one lane with something to say is then invisible.
   */
  readonly note: string | null;
};

/**
 * Who is standing where, right now.
 *
 * Every lane in the pack is returned, including empty ones and ones under
 * maintenance. §6.5's screen is a picture of the range, and a range with a bay
 * missing from the picture is how somebody ends up sent to a bay that is shut.
 */
export function relay(
  indexed: IndexedDayPack,
  input: {
    readonly participations: readonly LocalParticipation[];
    readonly firearmIssues: readonly LocalIssue[];
    readonly rounds: readonly LocalRound[];
  },
): RelayLane[] {
  const present = mergedParticipations(indexed, input.participations).filter(
    (participation) => !participation.checkedOutAt,
  );

  /**
   * What each person has in their hands.
   *
   * Keyed by PERSON rather than by participation because that is what
   * `LocalIssue` carries (src/offline/close.ts) and because it is the truer
   * key: §3.4's custody log records a firearm going to a human, not to a row.
   * A shooter who checked out and back in on one evening is the same pair of
   * hands, and the firearm did not go back in the rack in between.
   */
  const pairedBy = new Map<string, string>();
  for (const issue of input.firearmIssues) {
    /* Returned equipment is not in anybody's hands. Skipped rather than
       overwritten, so an earlier unreturned issue still shows — that is a
       shooter holding two firearms, which the close guard already refuses to
       let the session end on. */
    if (issue.returnedAt) continue;
    pairedBy.set(issue.personId, issue.serialNumber);
  }

  /* Standing cards only. A corrected score is not a second card, and a relay
     that counted it would tell an officer a shooter had shot more than they
     had — the number is read to decide whether somebody is finished. */
  const cardsBy = new Map<string, number>();
  for (const round of standingRounds(input.rounds) as readonly LocalRound[]) {
    cardsBy.set(
      round.participationId,
      (cardsBy.get(round.participationId) ?? 0) + 1,
    );
  }

  return [...indexed.pack.lanes]
    .sort(
      (a, b) => a.discipline.localeCompare(b.discipline) || a.number - b.number,
    )
    .map((lane) => {
      const shooters = present
        .filter((participation) => participation.laneId === lane.id)
        .map((participation) => shooter(indexed, participation, pairedBy, cardsBy))
        /* Guests last, then by name. Not alphabetical throughout: an officer
           scanning for the person who needs watching is scanning for the
           guests, and putting them in a known place is worth more than one
           consistent sort. */
        .sort(
          (a, b) =>
            Number(a.isGuest) - Number(b.isGuest) || a.name.localeCompare(b.name),
        );

      return {
        laneId: lane.id,
        label: `${lane.discipline} ${lane.number}`,
        number: lane.number,
        discipline: lane.discipline,
        status: lane.status,
        shooters,
        note: noteFor(lane, shooters),
      };
    });
}

function shooter(
  indexed: IndexedDayPack,
  participation: LocalParticipation,
  pairedBy: Map<string, string>,
  cardsBy: Map<string, number>,
): RelayShooter {
  const person = indexed.personById.get(participation.personId);

  return {
    participationId: participation.id,
    personId: participation.personId,
    /* A person the pack does not hold is a real state on a device that has not
       synced since they were added. It cannot arrive through check-in —
       buildCheckIn refuses first — so this is the belt to that braces, and it
       says what is wrong rather than rendering a blank name on a live line. */
    name: person
      ? `${person.firstName} ${person.lastName}`
      : "Not on this device",
    isGuest: participation.role === "guest_shooter",
    firearmSerial: pairedBy.get(participation.personId) ?? null,
    cardsRecorded: cardsBy.get(participation.id) ?? 0,
  };
}

/**
 * The one line a lane gets, chosen by what an officer would act on first.
 *
 * Ordered rather than concatenated. Two notes on one row is two lines of large
 * type, which is the thing this screen cannot spend.
 */
function noteFor(
  lane: PackLane,
  shooters: readonly RelayShooter[],
): string | null {
  if (lane.status === "maintenance") return "Under maintenance";
  if (lane.status === "closed") return "Closed";

  if (shooters.length === 0) return null;

  if (shooters.length > lane.positionCapacity) {
    /* Over capacity is not refused here — people are physically on the lane and
       refusing would not move them. It is said, plainly, so it is fixed. */
    return `${shooters.length} on ${lane.positionCapacity} positions`;
  }

  const unpaired = shooters.filter((s) => s.firearmSerial === null).length;
  if (unpaired > 0) {
    return unpaired === shooters.length ? "Not paired" : `${unpaired} not paired`;
  }

  return null;
}

/** Every shooter on the range, for the pickers that need one flat list. */
export const relayShooters = (lanes: readonly RelayLane[]): RelayShooter[] =>
  lanes.flatMap((lane) => [...lane.shooters]);
