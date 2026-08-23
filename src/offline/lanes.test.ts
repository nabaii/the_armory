import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hydrate, type DayPack, type PackLane } from "./daypack";
import { laneOccupancy, lanesFor, noLaneReason, suggestLane } from "./lanes";
import type { LocalParticipation } from "./checkin";

/**
 * §6.4: "Check in — three taps maximum from Today to checked in WITH A LANE
 *        ASSIGNED."
 *
 * docs/M1_offline_acceptance.md records why this did not exist: "No lane is
 * assigned at check-in… `lane_id` is written as null. Lane assignment needs the
 * lane list and occupancy, which is M5/M7."
 */

const lane = (
  number: number,
  status: PackLane["status"] = "available",
  positionCapacity = 1,
): PackLane => ({
  id: `lane-${number}`,
  discipline: "10m-pistol",
  number,
  status,
  positionCapacity,
});

function pack(lanes: PackLane[]): DayPack {
  return {
    pulledAt: "2026-08-13T05:00:00.000Z",
    windowStart: "2026-08-13",
    windowEnd: "2026-08-14",
    activeWaiverVersionId: "waiver-4",
    waiverValidityDays: null,
    storageEnabled: false,
    disciplinesRequiringQualification: [],
    tiers: [],
    people: [],
    memberships: [],
    licences: [],
    qualifications: [],
    waiverSignatures: [],
    allowances: [],
    invitations: [],
    arrivals: [],
    firearms: [],
    ammunitionLots: [],
    lanes,
    staff: [],
    devices: [],
  };
}

const on = (laneId: string | null, checkedOutAt: string | null = null): LocalParticipation => ({
  id: `part-${laneId}-${checkedOutAt ?? "in"}-${Math.random()}`,
  sessionId: "s-1",
  personId: "p-1",
  role: "member_shooter",
  hostPersonId: null,
  laneId,
  tierSnapshot: null,
  checkedInAt: "2026-08-13T17:00:00.000Z",
    arrivalAt: null,
  checkedInByStaffId: "staff-1",
  checkedOutAt,
});

const options = (lanes: PackLane[], present: LocalParticipation[] = []) =>
  lanesFor(hydrate(pack(lanes)), "10m-pistol", present);

describe("occupancy comes from what this device did", () => {
  it("counts shooters currently on a lane", () => {
    const counts = laneOccupancy([on("lane-1"), on("lane-1"), on("lane-2")]);
    assert.equal(counts.get("lane-1"), 2);
    assert.equal(counts.get("lane-2"), 1);
  });

  it("gives the bay back when a shooter checks out", () => {
    /* Counting people who have left would shrink the range over the course of
       an evening until nothing could be assigned. */
    const counts = laneOccupancy([on("lane-1", "2026-08-13T18:00:00.000Z")]);
    assert.equal(counts.get("lane-1"), undefined);
  });

  it("ignores a participation with no lane", () => {
    /* Every check-in written before M5 has `lane_id` null. They must not be
       counted against any bay. */
    const counts = laneOccupancy([on(null)]);
    assert.equal(counts.size, 0);
  });
});

describe("what the desk is offered", () => {
  it("orders lanes by number", () => {
    assert.deepEqual(
      options([lane(3), lane(1), lane(2)]).map((l) => l.number),
      [1, 2, 3],
    );
  });

  it("shows a lane under maintenance rather than hiding it", () => {
    /* A bay that silently vanishes reads as the club having fewer lanes than it
       has, and an officer looking for bay two needs to be told why. */
    const result = options([lane(1), lane(2, "maintenance")]);

    assert.equal(result.length, 2);
    assert.equal(result[1].assignable, false);
    assert.equal(result[1].unavailableReason, "Under maintenance");
  });

  it("marks a full lane unassignable", () => {
    const result = options([lane(1, "available", 1)], [on("lane-1")]);
    assert.equal(result[0].assignable, false);
    assert.equal(result[0].unavailableReason, "Full");
    assert.equal(result[0].free, 0);
  });

  it("keeps a lane with room assignable", () => {
    const result = options([lane(1, "available", 2)], [on("lane-1")]);
    assert.equal(result[0].assignable, true);
    assert.equal(result[0].free, 1);
  });
});

describe("the suggestion", () => {
  it("is the lowest-numbered lane with room", () => {
    /* Lowest rather than emptiest. A range fills from one end because that is
       how an officer supervises it — standing behind a contiguous line rather
       than walking between scattered shooters. */
    const suggested = suggestLane(
      options([lane(1, "available", 2), lane(2, "available", 2)], [on("lane-1")]),
    );
    assert.equal(suggested?.id, "lane-1");
  });

  it("skips a lane that is down", () => {
    const suggested = suggestLane(options([lane(1, "maintenance"), lane(2)]));
    assert.equal(suggested?.id, "lane-2");
  });

  it("is null when nothing is free, rather than a lane that is not", () => {
    /* Returning a full lane would check somebody in onto a bay somebody else is
       standing on. */
    const suggested = suggestLane(options([lane(1, "available", 1)], [on("lane-1")]));
    assert.equal(suggested, null);
  });
});

describe("why there is no lane", () => {
  it("distinguishes a pack with no lanes from a range that is busy", () => {
    /* Three different responses: sync, call someone, or wait. §4.3's rule about
       blocks applies here too. */
    assert.match(noLaneReason([], "10m-pistol"), /no 10m-pistol lanes on file/);
  });

  it("names every lane being out of service", () => {
    assert.match(
      noLaneReason(options([lane(1, "maintenance"), lane(2, "closed")]), "10m-pistol"),
      /closed or under maintenance/,
    );
  });

  it("names a full range separately", () => {
    assert.match(
      noLaneReason(options([lane(1, "available", 1)], [on("lane-1")]), "10m-pistol"),
      /full/,
    );
  });
});
