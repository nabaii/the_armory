import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUuidv7 } from "@/lib/uuidv7";
import { hydrate, type DayPack } from "./daypack";
import { relay, relayShooters, type LocalRound } from "./relay";
import { buildScore, confirmationLine } from "./score";
import { buildIncident } from "./incident";
import { formatById } from "@/domain/scoring";
import type { LocalParticipation } from "./checkin";
import type { LocalIssue } from "./close";

/**
 * §6.5: "Relay — who is on which lane right now, LARGE TYPE, READABLE AT ARM'S
 *        LENGTH IN DAYLIGHT. Pair — assign shooter to firearm by serial. Score —
 *        select shooter, enter total, confirm. NO FREE-TEXT ENTRY IN THE NORMAL
 *        PATH. GUESTS ARE SCORED IDENTICALLY TO MEMBERS. Incident — always
 *        reachable, never more than one tap away, ALWAYS AVAILABLE OFFLINE."
 * §8.5: "…record two scores, then pull the power mid-session."
 * §1.2 rule 3: "a correction is a new row referencing the old one."
 */

const NOW = new Date("2026-08-14T15:00:00.000Z");
const SESSION = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
const STAFF = "7a2b4c6d-8e90-4f12-a345-b6c7d8e9f012";

const LANE_RIFLE_1 = "aaaaaaa1-0000-4000-8000-000000000001";
const LANE_RIFLE_2 = "aaaaaaa1-0000-4000-8000-000000000002";
const LANE_PISTOL_1 = "aaaaaaa2-0000-4000-8000-000000000001";

const ADA = "2b3c4d5e-6f70-4182-93a4-b5c6d7e8f901";
const BEN = "3c4d5e6f-7081-4293-a4b5-c6d7e8f90123";
const CHI = "4d5e6f70-8192-43a4-b5c6-d7e8f9012345";

const pack = (overrides: Partial<DayPack> = {}) =>
  hydrate({
    pulledAt: "2026-08-14T08:00:00.000Z",
    windowStart: "2026-08-14",
    windowEnd: "2026-08-15",
    activeWaiverVersionId: "708192a3-b4c5-46d7-e8f9-012345678901",
    waiverValidityDays: null,
    storageEnabled: false,
    disciplinesRequiringQualification: [],
    tiers: [],
    people: [
      { id: ADA, firstName: "Ada", lastName: "Obi", photoUrl: null },
      { id: BEN, firstName: "Ben", lastName: "Umeh", photoUrl: null },
      { id: CHI, firstName: "Chidi", lastName: "Eze", photoUrl: null },
    ],
    memberships: [],
    licences: [],
    qualifications: [],
    waiverSignatures: [],
    allowances: [],
    invitations: [],
    arrivals: [],
    firearms: [],
    ammunitionLots: [],
    lanes: [
      {
        id: LANE_RIFLE_1,
        discipline: "10m-air-rifle",
        number: 1,
        status: "available",
        positionCapacity: 1,
      },
      {
        id: LANE_RIFLE_2,
        discipline: "10m-air-rifle",
        number: 2,
        status: "maintenance",
        positionCapacity: 1,
      },
      {
        id: LANE_PISTOL_1,
        discipline: "25m-pistol",
        number: 1,
        status: "available",
        positionCapacity: 2,
      },
    ],
    staff: [],
    devices: [],
    ...overrides,
  });

const participation = (
  overrides: Partial<LocalParticipation> = {},
): LocalParticipation => ({
  id: "p-ada",
  sessionId: SESSION,
  personId: ADA,
  role: "member_shooter",
  hostPersonId: null,
  laneId: LANE_RIFLE_1,
  tierSnapshot: null,
  checkedInAt: "2026-08-14T14:00:00.000Z",
  arrivalAt: null,
  checkedInByStaffId: STAFF,
  checkedOutAt: null,
  ...overrides,
});

const issue = (overrides: Partial<LocalIssue> = {}): LocalIssue => ({
  custodyEventId: "c-1",
  firearmId: "f-1",
  serialNumber: "AB1234",
  personId: ADA,
  sessionId: SESSION,
  returnedAt: null,
  ...overrides,
});

const localRound = (overrides: Partial<LocalRound> = {}): LocalRound => ({
  id: "r-1",
  participationId: "p-ada",
  sessionId: SESSION,
  discipline: "10m-air-rifle",
  format: "10m-air-rifle/60",
  totalScore: 570,
  capturedAt: NOW,
  correctsRoundId: null,
  capturedByStaffId: STAFF,
  ...overrides,
});

const context = { actorStaffId: STAFF, now: NOW, sessionId: SESSION };

/* ===========================================================================
   THE RELAY — §6.5
   ======================================================================== */

describe("the relay shows who is on which lane", () => {
  const empty = { participations: [], firearmIssues: [], rounds: [] };

  it("returns every lane, including the empty and the shut ones", () => {
    const lanes = relay(pack(), empty);

    assert.equal(lanes.length, 3);
    /* A bay that vanishes reads as a range with fewer lanes than it has, and is
       how somebody is sent to a bay that is closed. */
    assert.ok(lanes.some((lane) => lane.laneId === LANE_RIFLE_2));
  });

  it("says a lane is under maintenance instead of leaving it blank", () => {
    const lanes = relay(pack(), empty);
    const shut = lanes.find((lane) => lane.laneId === LANE_RIFLE_2);

    assert.equal(shut?.note, "Under maintenance");
  });

  it("says nothing at all about a lane with nothing to say", () => {
    /* Not "OK". A column of OK is a column an eye stops reading, and the one
       lane that matters is then invisible. */
    const lanes = relay(pack(), empty);
    const quiet = lanes.find((lane) => lane.laneId === LANE_RIFLE_1);

    assert.equal(quiet?.note, null);
  });

  it("puts each shooter on their own lane, with what they are holding", () => {
    const lanes = relay(pack(), {
      participations: [participation()],
      firearmIssues: [issue()],
      rounds: [],
    });

    const bay = lanes.find((lane) => lane.laneId === LANE_RIFLE_1);
    assert.equal(bay?.shooters.length, 1);
    assert.equal(bay?.shooters[0].name, "Ada Obi");
    assert.equal(bay?.shooters[0].firearmSerial, "AB1234");
  });

  it("shows an unpaired shooter as unpaired rather than as an error", () => {
    const lanes = relay(pack(), {
      participations: [participation()],
      firearmIssues: [],
      rounds: [],
    });

    const bay = lanes.find((lane) => lane.laneId === LANE_RIFLE_1);
    assert.equal(bay?.shooters[0].firearmSerial, null);
    assert.equal(bay?.note, "Not paired");
  });

  it("stops counting a firearm that has gone back in the rack", () => {
    const lanes = relay(pack(), {
      participations: [participation()],
      firearmIssues: [issue({ returnedAt: "2026-08-14T14:50:00.000Z" })],
      rounds: [],
    });

    const bay = lanes.find((lane) => lane.laneId === LANE_RIFLE_1);
    assert.equal(bay?.shooters[0].firearmSerial, null);
  });

  it("drops a shooter who has checked out", () => {
    const lanes = relay(pack(), {
      participations: [
        participation({ checkedOutAt: "2026-08-14T14:55:00.000Z" }),
      ],
      firearmIssues: [],
      rounds: [],
    });

    assert.deepEqual(relayShooters(lanes), []);
  });

  it("puts guests last so an officer's eye knows where to look", () => {
    const lanes = relay(pack(), {
      participations: [
        participation({
          id: "p-guest",
          personId: BEN,
          role: "guest_shooter",
          hostPersonId: ADA,
          laneId: LANE_PISTOL_1,
        }),
        participation({ id: "p-chi", personId: CHI, laneId: LANE_PISTOL_1 }),
      ],
      firearmIssues: [],
      rounds: [],
    });

    const bay = lanes.find((lane) => lane.laneId === LANE_PISTOL_1);
    assert.deepEqual(
      bay?.shooters.map((s) => [s.name, s.isGuest]),
      [
        ["Chidi Eze", false],
        ["Ben Umeh", true],
      ],
    );
  });

  it("says a lane is over capacity rather than refusing what is already true", () => {
    const lanes = relay(pack(), {
      participations: [
        participation({ id: "p-1", personId: ADA, laneId: LANE_RIFLE_1 }),
        participation({ id: "p-2", personId: BEN, laneId: LANE_RIFLE_1 }),
      ],
      firearmIssues: [],
      rounds: [],
    });

    const bay = lanes.find((lane) => lane.laneId === LANE_RIFLE_1);
    assert.equal(bay?.note, "2 on 1 positions");
  });

  it("counts standing cards only, so a correction is not a second card", () => {
    const lanes = relay(pack(), {
      participations: [participation()],
      firearmIssues: [issue()],
      rounds: [
        localRound({ id: "r-1", totalScore: 570 }),
        localRound({ id: "r-2", totalScore: 470, correctsRoundId: "r-1" }),
      ],
    });

    const bay = lanes.find((lane) => lane.laneId === LANE_RIFLE_1);
    assert.equal(bay?.shooters[0].cardsRecorded, 1);
  });

  it("shows somebody the desk checked in, whom this device never saw", () => {
    /* The case the lane surface exists inside: check-in happens at the counter,
       on another tablet, and reaches this one through the pack. Without this
       the relay on a lane device is empty all evening. */
    const lanes = relay(
      pack({
        participations: [
          {
            id: "p-desk",
            sessionId: SESSION,
            personId: BEN,
            role: "member_shooter",
            hostPersonId: null,
            laneId: LANE_PISTOL_1,
            checkedInAt: "2026-08-14T14:10:00.000Z",
            checkedOutAt: null,
          },
        ],
      }),
      { participations: [], firearmIssues: [], rounds: [] },
    );

    const bay = lanes.find((lane) => lane.laneId === LANE_PISTOL_1);
    assert.equal(bay?.shooters[0].name, "Ben Umeh");
  });

  it("does not show one person twice when both copies exist", () => {
    /* The same check-in, from the pack and from this device's own disk. They
       share an id (§7), which is what makes the two collapse. */
    const lanes = relay(
      pack({
        participations: [
          {
            id: "p-ada",
            sessionId: SESSION,
            personId: ADA,
            role: "member_shooter",
            hostPersonId: null,
            laneId: LANE_RIFLE_1,
            checkedInAt: "2026-08-14T14:00:00.000Z",
            checkedOutAt: null,
          },
        ],
      }),
      { participations: [participation()], firearmIssues: [], rounds: [] },
    );

    assert.equal(relayShooters(lanes).length, 1);
  });

  it("lets this device's checkout win over the pack's stale row", () => {
    /* The disagreement that matters. The server still believes Ada is on the
       line because the checkout has not been sent; this device recorded it
       thirty seconds ago. A merge that preferred the server would put her back
       on a lane she had left. */
    const lanes = relay(
      pack({
        participations: [
          {
            id: "p-ada",
            sessionId: SESSION,
            personId: ADA,
            role: "member_shooter",
            hostPersonId: null,
            laneId: LANE_RIFLE_1,
            checkedInAt: "2026-08-14T14:00:00.000Z",
            checkedOutAt: null,
          },
        ],
      }),
      {
        participations: [
          participation({ checkedOutAt: "2026-08-14T14:55:00.000Z" }),
        ],
        firearmIssues: [],
        rounds: [],
      },
    );

    assert.deepEqual(relayShooters(lanes), []);
  });

  it("names the problem when a shooter is not on this device", () => {
    const lanes = relay(pack(), {
      participations: [
        participation({
          id: "p-unknown",
          personId: "9999a9a9-0000-4000-8000-000000000009",
        }),
      ],
      firearmIssues: [],
      rounds: [],
    });

    const bay = lanes.find((lane) => lane.laneId === LANE_RIFLE_1);
    assert.equal(bay?.shooters[0].name, "Not on this device");
  });
});

/* ===========================================================================
   SCORE — §6.5, §8.5 step 12
   ======================================================================== */

describe("capturing a score", () => {
  const input = {
    participation: participation(),
    formatId: "10m-air-rifle/60",
    keyed: "578",
    corrects: null,
  };

  it("builds a round and its queued write from one keyed number", () => {
    const result = buildScore(pack(), input, context);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.writes.round.totalScore, 578);
    assert.equal(result.writes.round.format, "10m-air-rifle/60");
    assert.equal(result.writes.round.discipline, "10m-air-rifle");
    assert.equal(result.writes.round.capturedByStaffId, STAFF);
    assert.equal(result.writes.queue.length, 1);
    assert.equal(result.writes.queue[0].operation, "rounds.create");
    /* §7: the id is generated here, before the network, and is the row's key. */
    assert.equal(result.writes.queue[0].id, result.writes.round.id);
    assert.ok(isUuidv7(result.writes.round.id));
  });

  it("scores a guest identically to a member", () => {
    /* §6.5 says so, and the way to honour it is for `role` to appear nowhere in
       the builder. Two calls differing only in role must be indistinguishable. */
    const member = buildScore(pack(), input, context);
    const guest = buildScore(
      pack(),
      {
        ...input,
        participation: participation({
          role: "guest_shooter",
          hostPersonId: BEN,
        }),
      },
      context,
    );

    assert.equal(member.ok && guest.ok, true);
    if (!member.ok || !guest.ok) return;

    assert.equal(member.writes.round.totalScore, guest.writes.round.totalScore);
    assert.equal(member.writes.queue.length, guest.writes.queue.length);
  });

  it("refuses a card that could not have been shot on that bay", () => {
    const result = buildScore(
      pack(),
      { ...input, formatId: "25m-pistol/60" },
      context,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.refusal.reason,
      "60 shots is not shot on 10m-air-rifle 1.",
    );
  });

  it("records a card for a participation with no lane", () => {
    /* Rows written before M5 carry a null lane. A device holding those must
       still be able to record what happened on them. */
    const result = buildScore(
      pack(),
      { ...input, participation: participation({ laneId: null }) },
      context,
    );

    assert.equal(result.ok, true);
  });

  it("passes the parse refusal through, in the parser's words", () => {
    const result = buildScore(pack(), { ...input, keyed: "6000" }, context);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.refusal.reason,
      "A 60 shots card cannot exceed 600.",
    );
  });

  it("refuses a format nobody defined", () => {
    const result = buildScore(
      pack(),
      { ...input, formatId: "10m-air-rifle/90" },
      context,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.refusal.reason, /course of fire/);
  });

  it("writes a correction as a new row citing the old one, with an audit entry", () => {
    const result = buildScore(
      pack(),
      {
        ...input,
        keyed: "478",
        corrects: { roundId: "r-1", reason: "Card misread." },
      },
      context,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.writes.round.correctsRoundId, "r-1");
    assert.notEqual(result.writes.round.id, "r-1");

    const audit = result.writes.queue.find(
      (item) => item.operation === "audit_log.create",
    );
    assert.ok(audit, "§3.6: a correction to a score belongs in the audit log");
  });

  it("writes no audit row for an ordinary card", () => {
    const result = buildScore(pack(), input, context);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(
      result.writes.queue.filter((i) => i.operation === "audit_log.create")
        .length,
      0,
      "an ordinary round is already attributed and append-only",
    );
  });

  it("refuses a correction that says nothing about why", () => {
    const result = buildScore(
      pack(),
      { ...input, corrects: { roundId: "r-1", reason: "  " } },
      context,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.refusal.reason,
      "A corrected score has to say why it was changed.",
    );
  });

  it("confirms in one line an officer can actually check", () => {
    const format = formatById("10m-air-rifle/60")!;
    assert.equal(
      confirmationLine(format, "Ada Obi", 578),
      "Ada Obi — 60 shots, 578.",
    );
  });
});

/* ===========================================================================
   INCIDENT — §6.5, §3.3
   ======================================================================== */

describe("recording an incident", () => {
  const base = {
    category: "safety_breach",
    narrative: "Muzzle crossed the line at bay three. Shooter stood down.",
    persons: [{ personId: ADA, involvement: "involved" }],
  };

  it("builds the incident and its people as one queued write", () => {
    const result = buildIncident(base, context);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.writes.queue.length, 1);
    assert.equal(result.writes.queue[0].operation, "incidents.create");
    assert.equal(result.writes.queue[0].id, result.writes.incident.id);
    assert.equal(result.writes.incident.reportedByStaffId, STAFF);
  });

  it("records one with no session, because those happen", () => {
    const result = buildIncident(base, { ...context, sessionId: null });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.writes.incident.sessionId, null);
  });

  it("records one that involved nobody", () => {
    const result = buildIncident(
      { ...base, category: "equipment_fault", persons: [] },
      context,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.writes.incident.persons, []);
  });

  it("insists on an account of what happened", () => {
    const result = buildIncident({ ...base, narrative: "   " }, context);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.reason, "Say what happened, in a sentence or two.");
    assert.equal(
      result.refusal.remedy,
      "It does not have to be tidy. It has to exist.",
    );
  });

  it("insists on a category, and points at Other", () => {
    const result = buildIncident({ ...base, category: "whatever" }, context);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.remedy, "Use Other if none of them fit.");
  });

  it("refuses a person with no stated involvement", () => {
    const result = buildIncident(
      { ...base, persons: [{ personId: ADA, involvement: "somehow" }] },
      context,
    );

    assert.equal(result.ok, false);
  });

  it("de-duplicates a double tap rather than breaking the transaction", () => {
    const result = buildIncident(
      {
        ...base,
        persons: [
          { personId: ADA, involvement: "involved" },
          { personId: ADA, involvement: "witness" },
        ],
      },
      context,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.writes.incident.persons.length, 1);
    assert.equal(result.writes.incident.persons[0].involvement, "involved");
  });

  it("accepts a time earlier than now — written up after the fact", () => {
    const earlier = new Date("2026-08-14T14:40:00.000Z");
    const result = buildIncident({ ...base, occurredAt: earlier }, context);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.writes.incident.occurredAt, earlier.toISOString());
  });

  it("clamps a time in the future rather than refusing the record", () => {
    /* A tablet back from a dead battery can believe anything. §10's clock rules
       exist for that, and none of them are worth losing a safety record over. */
    const result = buildIncident(
      { ...base, occurredAt: new Date("2026-08-14T18:00:00.000Z") },
      context,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.writes.incident.occurredAt, NOW.toISOString());
  });

  it("does not need the day pack, so a stranger can be named", () => {
    /* A contractor, a spectator, somebody from the stadium. The builder takes
       ids and never looks anyone up — a stale pack must not be the reason an
       injury goes unrecorded. */
    const result = buildIncident(
      {
        ...base,
        category: "injury",
        persons: [
          {
            personId: "9999a9a9-0000-4000-8000-000000000009",
            involvement: "injured",
          },
        ],
      },
      context,
    );

    assert.equal(result.ok, true);
  });
});
