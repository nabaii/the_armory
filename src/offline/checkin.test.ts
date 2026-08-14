import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUuidv7 } from "@/lib/uuidv7";
import { buildCheckIn, presentPersonIds, type LocalParticipation } from "./checkin";
import { hydrate, type DayPack, type PackArrival } from "./daypack";
import { PUSH_OPERATIONS } from "@/sync/contract";
import { parsePush } from "@/sync/operations";

/**
 * §6.4: "Three taps maximum from Today to checked in with a lane assigned."
 * §8.5: "check in a member and a guest … then pull the power mid-session.
 *        Restore power. Reopen. Every record must be present."
 *
 * The records this builds are the ones that have to be there after the cut, so their
 * shape is worth asserting directly — including the two things that are easy to lose
 * and impossible to reconstruct afterwards: the §3.3 tier snapshot and the §10
 * attribution.
 */

const NOW = new Date("2026-08-12T09:30:00.000Z");

const HOST = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const TIER = "44444444-4444-4444-8444-444444444444";
const SESSION = "77777777-7777-4777-8777-777777777777";
const LANE = "88888888-8888-4888-8888-888888888888";
const STAFF = "99999999-9999-4999-8999-999999999999";
const DEVICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WAIVER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const memberArrival: PackArrival = {
  personId: HOST,
  bookingId: null,
  sessionId: SESSION,
  role: "member_shooter",
  discipline: "25m-pistol",
  slotStart: "2026-08-12T10:00:00.000Z",
  hostPersonId: null,
  invitationId: null,
};

const guestArrival: PackArrival = {
  personId: GUEST,
  bookingId: null,
  sessionId: SESSION,
  role: "guest_shooter",
  discipline: "25m-pistol",
  slotStart: "2026-08-12T10:00:00.000Z",
  hostPersonId: HOST,
  invitationId: null,
};

function pack(): DayPack {
  return {
    pulledAt: "2026-08-12T07:00:00.000Z",
    windowStart: "2026-08-12",
    windowEnd: "2026-08-13",
    activeWaiverVersionId: WAIVER,
    waiverValidityDays: null,
    storageEnabled: false,
    disciplinesRequiringQualification: [],
    tiers: [
      {
        id: TIER,
        name: "Full",
        canHost: true,
        guestAllowanceAnnual: 6,
        guestConcurrentMax: 2,
        canOwnFirearm: true,
        canStoreFirearm: false,
        disciplineAccess: ["25m-pistol"],
        bookingHorizonDays: 14,
        concurrentBookingsMax: 2,
        active: true,
      },
    ],
    people: [
      { id: HOST, firstName: "Ada", lastName: "Nwosu", photoUrl: null },
      { id: GUEST, firstName: "Bode", lastName: "Adeyemi", photoUrl: null },
    ],
    memberships: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        personId: HOST,
        tierId: TIER,
        memberNumber: 14,
        status: "active",
        endedOn: null,
        renewsOn: "2027-01-01",
      },
    ],
    licences: [],
    qualifications: [],
    waiverSignatures: [],
    allowances: [],
    invitations: [],
    arrivals: [memberArrival, guestArrival],
    firearms: [],
    ammunitionLots: [],
    lanes: [],
    staff: [],
    devices: [],
  };
}

const context = {
  actorStaffId: STAFF,
  now: NOW,
  override: null,
  laneId: LANE,
};

describe("checking somebody in offline", () => {
  it("writes a participation and an audit entry, in that order", () => {
    const result = buildCheckIn(hydrate(pack()), memberArrival, context);
    assert.ok(result.ok);

    assert.deepEqual(
      result.writes.queue.map((item) => item.operation),
      ["participations.checkin", "audit_log.create"],
      "the participation is the record that matters and goes first",
    );
  });

  it("§7: the participation's id is the queue item's id", () => {
    /* The idempotency argument in one assertion: the local record and the queued
       write share a key, so a replay is an insert on a key the server already has. */
    const result = buildCheckIn(hydrate(pack()), memberArrival, context);
    assert.ok(result.ok);

    assert.equal(result.writes.queue[0].id, result.writes.participation.id);
    assert.ok(isUuidv7(result.writes.participation.id));
  });

  it("§3.3: copies the tier in rather than referencing it", () => {
    const result = buildCheckIn(hydrate(pack()), memberArrival, context);
    assert.ok(result.ok);

    const snapshot = result.writes.participation.tierSnapshot as { id: string; guestAllowanceAnnual: number };
    assert.equal(snapshot.id, TIER);
    assert.equal(
      snapshot.guestAllowanceAnnual,
      6,
      "the allowance as it stood at the visit, so March's edit cannot rewrite February",
    );
  });

  it("a guest carries no tier snapshot — they never had a tier", () => {
    const result = buildCheckIn(hydrate(pack()), guestArrival, context);
    assert.ok(result.ok);
    assert.equal(result.writes.participation.tierSnapshot, null);
    assert.equal(result.writes.participation.hostPersonId, HOST);
  });

  it("§10: every record names the officer", () => {
    const result = buildCheckIn(hydrate(pack()), memberArrival, context);
    assert.ok(result.ok);
    assert.equal(result.writes.participation.checkedInByStaffId, STAFF);
  });

  it("§2: records the device's clock as the domain time", () => {
    const result = buildCheckIn(hydrate(pack()), memberArrival, context);
    assert.ok(result.ok);
    assert.equal(result.writes.participation.checkedInAt, NOW.toISOString());
  });

  it("§6.4: carries the assigned lane", () => {
    const result = buildCheckIn(hydrate(pack()), memberArrival, context);
    assert.ok(result.ok);
    assert.equal(result.writes.participation.laneId, LANE);
  });

  it("§3.6: an override is recorded with its reason, never silently", () => {
    const result = buildCheckIn(hydrate(pack()), memberArrival, {
      ...context,
      override: { reason: "Licence renewal seen at the desk." },
    });
    assert.ok(result.ok);

    const audit = result.writes.queue[1].payload as {
      action: string;
      isOverride: boolean;
      overrideReason: string;
    };
    assert.equal(audit.isOverride, true);
    assert.equal(audit.action, "check_in_override");
    assert.match(audit.overrideReason, /Licence renewal/);
  });

  it("refuses in English when there is no open session", () => {
    const result = buildCheckIn(
      hydrate(pack()),
      { ...memberArrival, sessionId: null },
      context,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.refusal.reason, /no open session/);
    assert.ok(result.refusal.remedy);
    assert.match(result.refusal.reason, /[.]$/);
  });

  it("§3.3: refuses a guest with no recorded host", () => {
    const result = buildCheckIn(
      hydrate(pack()),
      { ...guestArrival, hostPersonId: null },
      context,
    );

    assert.equal(result.ok, false);
    assert.ok(!result.ok && /who is hosting them/.test(result.refusal.reason));
  });
});

/* ===========================================================================
   THE WRITES THIS BUILDS ARE WRITES THE ENDPOINT ACCEPTS

   The check-in builder and the push parser were written separately, and nothing in
   the language connects the payload one produces to the shape the other requires.
   These are the tests that they agree — a mismatch would surface as a rejected
   custody record on a range floor, hours after the officer went home.
   ======================================================================== */

describe("the desk's records survive the endpoint that stores them", () => {
  it("both queued writes parse cleanly against the push contract", () => {
    const result = buildCheckIn(hydrate(pack()), guestArrival, {
      ...context,
      override: { reason: "Host vouched at the desk." },
    });
    assert.ok(result.ok);

    for (const item of result.writes.queue) {
      assert.ok(
        (PUSH_OPERATIONS as readonly string[]).includes(item.operation),
        `${item.operation} is not an operation the endpoint accepts`,
      );

      const parsed = parsePush({
        id: item.id,
        operation: item.operation,
        payload: item.payload,
        deviceId: DEVICE,
        actorStaffId: STAFF,
        clientRecordedAt: NOW.toISOString(),
      });

      assert.ok(
        parsed.ok,
        `${item.operation} was refused by the endpoint: ${
          parsed.ok ? "" : parsed.reason
        }`,
      );
    }
  });
});

/* ===========================================================================
   PRESENCE — §12.1, across a power cut
   ======================================================================== */

describe("who is on the premises", () => {
  const participation = (personId: string, checkedOutAt: string | null): LocalParticipation => ({
    id: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
    sessionId: SESSION,
    personId,
    role: "member_shooter",
    hostPersonId: null,
    laneId: null,
    tierSnapshot: null,
    checkedInAt: NOW.toISOString(),
    checkedInByStaffId: STAFF,
    checkedOutAt,
  });

  it("is read from stored participations, not from the queue", () => {
    /* The reason presence has its own store: reading it from the outbox would make a
       host's check-in stop counting the moment it synced successfully, and §12.1's
       guest row would re-block because something went right. */
    const present = presentPersonIds([participation(HOST, null)]);
    assert.ok(present.has(HOST));
  });

  it("stops counting somebody who has checked out", () => {
    const present = presentPersonIds([
      participation(HOST, "2026-08-12T12:00:00.000Z"),
    ]);
    assert.equal(present.has(HOST), false);
  });

  it("is empty when nothing has been recorded", () => {
    assert.equal(presentPersonIds([]).size, 0);
  });
});
