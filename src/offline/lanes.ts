import type { IndexedDayPack, PackLane } from "./daypack";
import type { LocalParticipation } from "./checkin";

/**
 * LANE ASSIGNMENT AT THE DESK — §6.4.
 *
 *   "Check in — three taps maximum from Today to checked in WITH A LANE
 *    ASSIGNED."
 *
 * `participations.lane_id` was written as null for the whole of M1, and
 * docs/M1_offline_acceptance.md is explicit about why: "Lane assignment needs
 * the lane list and occupancy, which is M5/M7." The list now travels in the day
 * pack. This file is the occupancy.
 *
 * ===========================================================================
 * OCCUPANCY COMES FROM LOCAL PARTICIPATIONS, NOT FROM THE PACK
 *
 * This is the whole design and it is the same reasoning that makes the
 * host-presence rule work offline (§12.1: "clears automatically when the host
 * checks in — no retry needed").
 *
 * A lane is occupied because somebody was checked in on it. Those check-ins are
 * in `armory-session` on this device, written by this desk, possibly seconds ago
 * and possibly still sitting in the outbox unsent. A pack refreshed from the
 * server ten minutes ago cannot know about any of them.
 *
 * So occupancy is computed from what the device itself did. The consequence
 * worth stating: two tablets running two desks would each see only their own
 * assignments and could double-book a lane. That is acceptable and it is the
 * same trade §8.3 makes for allowances — except that unlike an allowance, a
 * double-booked lane is discovered instantly by a range officer standing in
 * front of it, and costs nothing to correct.
 *
 * ===========================================================================
 * A LANE IS NEVER ASSIGNED AUTOMATICALLY WHEN THE CHOICE IS AMBIGUOUS
 *
 * `suggestLane` returns the lowest-numbered free lane, and the desk offers it
 * as a default the officer can change. It does not decide silently.
 *
 * §6.4 budgets three taps and the officer knows things this function does not —
 * that bay four has a left-handed shooter on it, that a nervous first-timer
 * should not be next to the loudest calibre on the range. A system that assigned
 * without asking would be overruled by an officer moving somebody physically and
 * not telling it, and the record would then be wrong about where a person stood
 * on a live range.
 */

export type LaneOption = {
  readonly id: string;
  readonly label: string;
  readonly discipline: string;
  readonly number: number;
  /** Positions this lane holds at once. §3.3 `position_capacity`. */
  readonly capacity: number;
  readonly occupied: number;
  readonly free: number;
  /** False for maintenance and closed, and for a lane already full. */
  readonly assignable: boolean;
  /** One line saying why it cannot be used. Null when it can. */
  readonly unavailableReason: string | null;
};

/**
 * How many people this device believes are standing on each lane right now.
 *
 * Counts participations that are checked in and not checked out. A shooter who
 * has left has given the bay back, and counting them would shrink the range over
 * the course of an evening.
 */
export function laneOccupancy(
  participations: readonly LocalParticipation[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const participation of participations) {
    if (!participation.laneId) continue;
    if (participation.checkedOutAt) continue;
    counts.set(participation.laneId, (counts.get(participation.laneId) ?? 0) + 1);
  }

  return counts;
}

/**
 * Every lane for a discipline, with what is left on it.
 *
 * Unavailable lanes are returned rather than filtered out, for the same reason
 * `availableSlots` returns full slots (src/domain/availability.ts): a bay that
 * silently vanishes reads as the club having fewer lanes than it has, and an
 * officer looking for bay three needs to be told it is under maintenance rather
 * than left to wonder.
 */
export function lanesFor(
  indexed: IndexedDayPack,
  discipline: string,
  participations: readonly LocalParticipation[],
): LaneOption[] {
  const occupancy = laneOccupancy(participations);
  const lanes = indexed.lanesByDiscipline.get(discipline) ?? [];

  return [...lanes]
    .sort((a, b) => a.number - b.number)
    .map((lane) => option(lane, occupancy.get(lane.id) ?? 0));
}

function option(lane: PackLane, occupied: number): LaneOption {
  const capacity = Math.max(0, lane.positionCapacity);
  const free = Math.max(0, capacity - occupied);

  const unavailableReason =
    lane.status === "maintenance"
      ? "Under maintenance"
      : lane.status === "closed"
        ? "Closed"
        : free === 0
          ? "Full"
          : null;

  return {
    id: lane.id,
    label: `${lane.discipline} ${lane.number}`,
    discipline: lane.discipline,
    number: lane.number,
    capacity,
    occupied,
    free,
    assignable: unavailableReason === null,
    unavailableReason,
  };
}

/**
 * The lane to offer by default: the lowest-numbered one with room.
 *
 * Lowest-numbered rather than emptiest, deliberately. A range fills from one end
 * — that is how officers supervise it, standing behind a contiguous line rather
 * than walking between scattered shooters. Spreading people across the bays to
 * balance occupancy would be optimising a number nobody cares about at the cost
 * of the one thing the officer is actually doing.
 *
 * Null when nothing is free, and the caller must then say so rather than
 * checking somebody in onto no lane.
 */
export function suggestLane(options: readonly LaneOption[]): LaneOption | null {
  return options.find((lane) => lane.assignable) ?? null;
}

/**
 * One line for the desk when there is no lane to give.
 *
 * §4.3's shape: a specific reason, not "unavailable". The three cases send an
 * officer three different places — wait, call someone, or check the pack is
 * current — and collapsing them would leave them guessing at the busiest moment
 * of the evening.
 */
export function noLaneReason(
  options: readonly LaneOption[],
  discipline: string,
): string {
  if (options.length === 0) {
    return `This device has no ${discipline} lanes on file. Sync while there is a connection.`;
  }

  /* "Every lane is down" and "every lane is full" are different problems with
     different responses — one is a phone call, the other is a wait. Told apart
     by whether anything is merely full rather than out of service. */
  const anyInService = options.some((lane) => lane.unavailableReason !== "Under maintenance" && lane.unavailableReason !== "Closed");

  if (!anyInService) {
    return `Every ${discipline} lane is closed or under maintenance.`;
  }

  return `Every ${discipline} lane is full. Someone has to check out first.`;
}
