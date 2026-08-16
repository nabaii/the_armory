import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UNCONFIGURED_AVAILABILITY,
  availableSlots,
  availableTables,
  capacityFor,
  emptyReason,
  emptyTableReason,
  minuteOfDay,
  occupancyOf,
  slotId,
  usesLane,
  type AvailabilityPolicy,
  type BookedSlot,
  type LaneInfo,
} from "./availability";

/**
 * §6.2: "Availability computed from lanes, hours, officer coverage and existing
 *        bookings — NEVER A MANUALLY MAINTAINED CALENDAR."
 * §13:  "Range officer rostering — WhatsApp and a spreadsheet." (Out of scope,
 *        which is why coverage is declared on an opening period rather than
 *        queried from a rota that must not exist.)
 * §14:  "Lanes per discipline, session length, opening hours." Still open, so
 *        every value here arrives as a parameter.
 */

/* Thursday 13 August 2026, 06:00 UTC = 07:00 Lagos. */
const NOW = new Date("2026-08-13T06:00:00.000Z");
const THURSDAY = 4;

const lane = (
  id: string,
  discipline: string,
  status: LaneInfo["status"] = "available",
  positionCapacity = 2,
): LaneInfo => ({ id, discipline, status, positionCapacity });

const policy = (overrides: Partial<AvailabilityPolicy> = {}): AvailabilityPolicy => ({
  sessionMinutes: 60,
  leadTimeMinutes: 0,
  openingHours: [
    {
      weekday: THURSDAY,
      opens: minuteOfDay(9),
      closes: minuteOfDay(12),
      staffed: true,
    },
  ],
  /* Null by default, matching a club that has not counted its covers. Every
     table test opts in explicitly, so no lane test can pass by accident on a
     capacity it never asked for. */
  tableCapacity: null,
  ...overrides,
});

const slots = (input: {
  policy?: AvailabilityPolicy;
  lanes?: readonly LaneInfo[];
  booked?: readonly BookedSlot[];
  discipline?: string;
  days?: number;
} = {}) =>
  availableSlots({
    policy: input.policy ?? policy(),
    lanes: input.lanes ?? [lane("l-1", "pistol")],
    booked: input.booked ?? [],
    discipline: input.discipline ?? "pistol",
    now: NOW,
    days: input.days ?? 1,
  });

describe("slots come from the hours and the session length", () => {
  it("divides an opening period into sessions", () => {
    /* 09:00–12:00 Lagos, hourly. */
    const result = slots();
    assert.deepEqual(
      result.map((slot) => slot.id),
      ["2026-08-13T09:00", "2026-08-13T10:00", "2026-08-13T11:00"],
    );
  });

  it("does not offer a session that would run past closing", () => {
    /* 09:00–12:00 with 90-minute sessions is two, not two and a half. */
    const result = slots({ policy: policy({ sessionMinutes: 90 }) });
    assert.deepEqual(
      result.map((slot) => slot.id),
      ["2026-08-13T09:00", "2026-08-13T10:30"],
    );
  });

  it("uses the Lagos weekday, not the UTC one", () => {
    /* 23:30 UTC on Wednesday is 00:30 Thursday in Lagos. A UTC weekday would
       read this as Wednesday and return the wrong day's hours — for the first
       hour of every single day. */
    const result = availableSlots({
      policy: policy(),
      lanes: [lane("l-1", "pistol")],
      booked: [],
      discipline: "pistol",
      now: new Date("2026-08-12T23:30:00.000Z"),
      days: 1,
    });

    assert.equal(result.length, 3);
    assert.match(result[0].id, /^2026-08-13/);
  });

  it("returns nothing when the club has published no hours", () => {
    /* §14 is unsettled. An empty week produces nothing and sends somebody to
       ask the founder — a plausible-looking default is how a guess becomes the
       club's opening hours by accident. */
    assert.deepEqual(slots({ policy: UNCONFIGURED_AVAILABILITY }), []);
  });
});

describe("officer coverage", () => {
  it("offers nothing for an unstaffed period", () => {
    /* The club does not run a range without an officer, and availability that
       offered one would be offering something the club cannot deliver. */
    const result = slots({
      policy: policy({
        openingHours: [
          {
            weekday: THURSDAY,
            opens: minuteOfDay(9),
            closes: minuteOfDay(12),
            staffed: false,
          },
        ],
      }),
    });

    assert.deepEqual(result, []);
  });
});

describe("lanes decide capacity", () => {
  it("adds up positions across available lanes", () => {
    const result = slots({
      lanes: [lane("l-1", "pistol", "available", 2), lane("l-2", "pistol", "available", 3)],
    });

    assert.equal(result[0].capacity, 5);
  });

  it("ignores a lane under maintenance", () => {
    /* The case a hand-kept calendar always gets wrong, and the reason §6.2
       forbids one: the lane goes down, nobody updates the spreadsheet, and a
       member arrives to shoot on it. */
    const result = slots({
      lanes: [
        lane("l-1", "pistol", "available", 2),
        lane("l-2", "pistol", "maintenance", 3),
      ],
    });

    assert.equal(result[0].capacity, 2);
  });

  it("offers nothing when every lane for the discipline is down", () => {
    assert.deepEqual(slots({ lanes: [lane("l-1", "pistol", "closed")] }), []);
  });

  it("counts only lanes for the discipline asked about", () => {
    assert.equal(
      capacityFor([lane("l-1", "pistol"), lane("l-2", "rifle")], "pistol"),
      2,
    );
  });
});

describe("existing bookings take positions, not slots", () => {
  const booked = (startIso: string, endIso: string, positions: number): BookedSlot => ({
    slotStart: new Date(startIso),
    slotEnd: new Date(endIso),
    discipline: "pistol",
    bookingType: "shoot",
    positions,
  });

  it("subtracts people rather than bookings", () => {
    /* A member bringing two guests takes three positions. Counting bookings is
       how a range ends up double-booked on a Saturday. */
    const result = slots({
      lanes: [lane("l-1", "pistol", "available", 6)],
      booked: [booked("2026-08-13T08:00:00.000Z", "2026-08-13T09:00:00.000Z", 3)],
    });

    const nine = result.find((slot) => slot.id === "2026-08-13T09:00");
    assert.equal(nine?.taken, 3);
    assert.equal(nine?.free, 3);
  });

  it("does not collide a booking that ends when a slot begins", () => {
    /* Half-open on both sides. Getting this wrong the inclusive way loses the
       club one slot in every pair, all day, every day. */
    const result = slots({
      lanes: [lane("l-1", "pistol", "available", 4)],
      booked: [booked("2026-08-13T08:00:00.000Z", "2026-08-13T09:00:00.000Z", 4)],
    });

    const ten = result.find((slot) => slot.id === "2026-08-13T10:00");
    assert.equal(ten?.taken, 0);
  });

  it("ignores bookings for another discipline", () => {
    const result = slots({
      booked: [
        {
          slotStart: new Date("2026-08-13T08:00:00.000Z"),
          slotEnd: new Date("2026-08-13T09:00:00.000Z"),
          discipline: "rifle",
          bookingType: "shoot",
          positions: 2,
        },
      ],
    });

    assert.equal(result[0].taken, 0);
  });

  it("shows a full slot rather than hiding it", () => {
    /* §6.2 gives the member a picture of the week. A Saturday that silently
       vanishes because it is busy reads as the club being closed — which sends
       them to WhatsApp, which is the phone call the portal exists to prevent. */
    const result = slots({
      lanes: [lane("l-1", "pistol", "available", 2)],
      booked: [booked("2026-08-13T08:00:00.000Z", "2026-08-13T09:00:00.000Z", 2)],
    });

    const nine = result.find((slot) => slot.id === "2026-08-13T09:00");
    assert.ok(nine, "a full slot was removed from the list");
    assert.equal(nine.free, 0);
  });
});

describe("lead time", () => {
  it("does not offer a session starting sooner than the club accepts", () => {
    const result = availableSlots({
      policy: policy({ leadTimeMinutes: 180 }),
      lanes: [lane("l-1", "pistol")],
      booked: [],
      discipline: "pistol",
      /* 07:00 Lagos. Three hours' notice makes 10:00 the earliest acceptable
         start, so the 09:00 session drops out and 10:00 is exactly on the
         boundary — which must be offered, not refused by an off-by-one. */
      now: NOW,
      days: 1,
    });

    assert.deepEqual(
      result.map((slot) => slot.id),
      ["2026-08-13T10:00", "2026-08-13T11:00"],
    );
  });

  it("never offers a slot in the past", () => {
    const result = availableSlots({
      policy: policy(),
      lanes: [lane("l-1", "pistol")],
      booked: [],
      discipline: "pistol",
      /* 10:30 Lagos on the Thursday. */
      now: new Date("2026-08-13T09:30:00.000Z"),
      days: 1,
    });

    assert.deepEqual(
      result.map((slot) => slot.id),
      ["2026-08-13T11:00"],
    );
  });
});

describe("the slot id", () => {
  it("is the Lagos date and time, readable in a message", () => {
    assert.equal(slotId(new Date("2026-08-13T17:00:00.000Z")), "2026-08-13T18:00");
  });

  it("round-trips through the list the client was given", () => {
    const result = slots();
    assert.equal(slotId(result[0].start), result[0].id);
  });
});

describe("an empty list says why", () => {
  it("names unpublished hours", () => {
    assert.match(
      emptyReason(UNCONFIGURED_AVAILABILITY, [lane("l-1", "pistol")], "pistol") ?? "",
      /opening hours/,
    );
  });

  it("names a discipline the club does not run", () => {
    assert.match(
      emptyReason(policy(), [lane("l-1", "pistol")], "archery") ?? "",
      /does not have a range/,
    );
  });

  it("distinguishes every lane being down from there being no lanes", () => {
    /* One is a call to the club, the other is the club not offering it at all.
       §4.3's rule about blocks applies to an empty screen too. */
    assert.match(
      emptyReason(policy(), [lane("l-1", "pistol", "maintenance")], "pistol") ?? "",
      /maintenance/,
    );
  });

  it("says nothing when there is nothing wrong", () => {
    assert.equal(emptyReason(policy(), [lane("l-1", "pistol")], "pistol"), null);
  });
});

/* ============================================================================
   BOOKING TYPES AND TABLE CAPACITY — Members Portal §7.4

   "Shoot, table, both and spectate require a booking_type on the booking, and
    availability must model table capacity separately from lane capacity. A
    table-only booking consumes no lane; a spectator consumes neither."

   This is the point at which the hospitality-first principle stops being a
   principle and becomes arithmetic, so it is tested as arithmetic.
   ========================================================================= */

describe("what a booking consumes", () => {
  it("charges a shoot to the lanes and nothing to the tables", () => {
    assert.deepEqual(occupancyOf("shoot", 3), { lane: 3, table: 0 });
  });

  it("charges a table booking to the covers and NO lane", () => {
    assert.deepEqual(occupancyOf("table", 2), { lane: 0, table: 2 });
  });

  it("charges both to both", () => {
    assert.deepEqual(occupancyOf("both", 2), { lane: 2, table: 2 });
  });

  it("charges a spectator to neither", () => {
    /* They still appear on the arrivals list — that is the booking row, not the
       capacity arithmetic. See the header of `occupancyOf`. */
    assert.deepEqual(occupancyOf("spectate", 1), { lane: 0, table: 0 });
  });

  it("knows which types need a discipline", () => {
    /* The same rule as the CHECK in drizzle/0008. Where these two disagree the
       database wins and the portal throws, which is the right way round. */
    assert.equal(usesLane("shoot"), true);
    assert.equal(usesLane("both"), true);
    assert.equal(usesLane("table"), false);
    assert.equal(usesLane("spectate"), false);
  });
});

describe("a table booking does not take a firing point", () => {
  const tableBooking = (positions: number): BookedSlot => ({
    slotStart: new Date("2026-08-13T08:00:00.000Z"),
    slotEnd: new Date("2026-08-13T09:00:00.000Z"),
    discipline: null,
    bookingType: "table",
    positions,
  });

  it("leaves the lane grid untouched", () => {
    /* The failure this prevents: four people eating on the deck closing the
       09:00 pistol session. */
    const result = slots({
      lanes: [lane("l-1", "pistol", "available", 4)],
      booked: [tableBooking(4)],
    });

    const nine = result.find((slot) => slot.id === "2026-08-13T09:00");
    assert.equal(nine?.taken, 0);
    assert.equal(nine?.free, 4);
  });

  it("takes covers from the table grid instead", () => {
    const result = availableTables({
      policy: policy({ tableCapacity: 10 }),
      booked: [tableBooking(4)],
      now: NOW,
      days: 1,
    });

    const nine = result.find((slot) => slot.id === "2026-08-13T09:00");
    assert.equal(nine?.taken, 4);
    assert.equal(nine?.free, 6);
    assert.equal(nine?.discipline, null, "a table is not a discipline");
  });

  it("counts a `both` booking against the lanes AND the covers", () => {
    const both: BookedSlot = {
      slotStart: new Date("2026-08-13T08:00:00.000Z"),
      slotEnd: new Date("2026-08-13T09:00:00.000Z"),
      discipline: "pistol",
      bookingType: "both",
      positions: 2,
    };

    const lanes = slots({
      lanes: [lane("l-1", "pistol", "available", 4)],
      booked: [both],
    });
    const tables = availableTables({
      policy: policy({ tableCapacity: 10 }),
      booked: [both],
      now: NOW,
      days: 1,
    });

    assert.equal(lanes.find((s) => s.id === "2026-08-13T09:00")?.taken, 2);
    assert.equal(tables.find((s) => s.id === "2026-08-13T09:00")?.taken, 2);
  });

  it("counts a spectator against neither", () => {
    const spectator: BookedSlot = {
      slotStart: new Date("2026-08-13T08:00:00.000Z"),
      slotEnd: new Date("2026-08-13T09:00:00.000Z"),
      discipline: null,
      bookingType: "spectate",
      positions: 2,
    };

    assert.equal(
      slots({
        lanes: [lane("l-1", "pistol", "available", 4)],
        booked: [spectator],
      }).find((s) => s.id === "2026-08-13T09:00")?.taken,
      0,
    );
    assert.equal(
      availableTables({
        policy: policy({ tableCapacity: 10 }),
        booked: [spectator],
        now: NOW,
        days: 1,
      }).find((s) => s.id === "2026-08-13T09:00")?.taken,
      0,
    );
  });
});

describe("the tables keep their own hours", () => {
  it("offers covers in an UNSTAFFED period", () => {
    /* P4. The deck can be open on an evening the range is not, and a club whose
       system could not express that would be a booking tool with a calendar
       bolted on. */
    const unstaffed = policy({
      tableCapacity: 8,
      openingHours: [
        {
          weekday: THURSDAY,
          opens: minuteOfDay(9),
          closes: minuteOfDay(12),
          staffed: false,
        },
      ],
    });

    assert.equal(availableTables({ policy: unstaffed, booked: [], now: NOW, days: 1 }).length, 3);
    /* And the same period yields no shooting, which is the whole distinction. */
    assert.deepEqual(slots({ policy: unstaffed }), []);
  });

  it("offers nothing at all when the club has not counted its covers", () => {
    /* Null is "not open yet", never "unlimited". Unlimited is the default that
       sells a Friday evening the kitchen cannot serve. */
    assert.deepEqual(
      availableTables({ policy: policy(), booked: [], now: NOW, days: 1 }),
      [],
    );
    assert.match(emptyTableReason(policy()) ?? "", /not open yet/);
  });

  it("distinguishes no covers from no hours", () => {
    assert.match(emptyTableReason(policy({ tableCapacity: 0 })) ?? "", /no covers/);
    assert.match(
      emptyTableReason({ ...UNCONFIGURED_AVAILABILITY, tableCapacity: 6 }) ?? "",
      /opening hours/,
    );
    assert.equal(emptyTableReason(policy({ tableCapacity: 6 })), null);
  });
});
