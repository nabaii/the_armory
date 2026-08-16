import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lagosParts } from "@/lib/time";
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
import {
  CLOSES,
  CLUB_HOURS_LINE,
  CLUB_WEEK,
  OPENS,
  SESSION_MINUTES,
  TURNAROUND_MINUTES,
  declaredSessionStarts,
} from "@/content/club-week";

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
  /* No buffer by default, so every pre-existing case still describes a
     back-to-back day and the turnaround tests opt in explicitly. */
  turnaroundMinutes: 0,
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

/** The club's real configuration: its declared week, session and buffer. */
const declaredPolicy = (): AvailabilityPolicy => ({
  sessionMinutes: SESSION_MINUTES,
  turnaroundMinutes: TURNAROUND_MINUTES,
  openingHours: CLUB_WEEK,
  leadTimeMinutes: 0,
  tableCapacity: null,
});

/** Minutes since Lagos midnight for an instant, for comparing against a grid. */
const lagosMinuteOf = (instant: Date): number => {
  const parts = lagosParts(instant);
  return parts.hours * 60 + parts.minutes;
};

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

  it("names an unset session length once hours are published", () => {
    /* The half-configured state, and the likeliest way this ends up half done:
       publishing the hours feels like the whole job. Without this branch the
       screen falls through to "nothing free on this day", which is not true,
       reads as a busy club, and sends the member to WhatsApp to ask why a
       range that is open has no sessions. */
    const halfDone = policy({ sessionMinutes: 0 });

    assert.deepEqual(slots({ policy: halfDone }), []);
    assert.match(
      emptyReason(halfDone, [lane("l-1", "pistol")], "pistol") ?? "",
      /how long a session runs/,
    );
    assert.match(
      emptyTableReason({ ...halfDone, tableCapacity: 12 }) ?? "",
      /how long a session runs/,
    );
  });

  it("still names the hours first when neither is set", () => {
    /* Order matters: a club with no hours and no session length has one thing
       to do first, and being told about the second would be noise. */
    assert.match(
      emptyReason(UNCONFIGURED_AVAILABILITY, [lane("l-1", "pistol")], "pistol") ?? "",
      /opening hours/,
    );
  });

  it("says nothing when there is nothing wrong", () => {
    assert.equal(emptyReason(policy(), [lane("l-1", "pistol")], "pistol"), null);
  });
});

/* ============================================================================
   THE CLUB'S OWN WEEK — declared by the founder, 16 August 2026

   "Open from 9AM-6PM everyday."

   These assert the declaration rather than the mechanism, and they are here so
   that a change to the club's hours is a change somebody made on purpose. The
   rows in armory.opening_hours are what the portal reads; this is the file both
   the public sentence and `npm run db:hours` come from, and a silent edit to it
   would move the club's week on two surfaces at once.
   ========================================================================= */

describe("the club's declared week", () => {
  it("opens 09:00 to 18:00", () => {
    assert.equal(OPENS, minuteOfDay(9));
    assert.equal(CLOSES, minuteOfDay(18));
  });

  it("covers all seven days, once each", () => {
    assert.equal(CLUB_WEEK.length, 7);
    assert.deepEqual(
      [...CLUB_WEEK.map((period) => period.weekday)].sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5, 6],
    );
  });

  it("declares an officer on the floor for the whole of it", () => {
    /* Consequential rather than cosmetic: an unstaffed period yields NO
       shooting slots while still publishing to the Diary as club open. If the
       club's true coverage is narrower, this is the field to change. */
    assert.ok(CLUB_WEEK.every((period) => period.staffed));
  });

  it("runs the club's declared day: 60 minutes, 15 apart", () => {
    /* Nine hours with a 60-minute session and a 15-minute buffer is SEVEN
       sessions, not nine. 09:00, 10:15, 11:30, 12:45, 14:00, 15:15, 16:30 —
       and the 17:45 that a naive step would offer runs to 18:45, past closing,
       so it is not there. */
    const day = availableSlots({
      policy: declaredPolicy(),
      lanes: [lane("l-1", "pistol")],
      booked: [],
      discipline: "pistol",
      now: NOW,
      days: 1,
    });

    assert.deepEqual(
      day.map((slot) => slot.id),
      [
        "2026-08-13T09:00",
        "2026-08-13T10:15",
        "2026-08-13T11:30",
        "2026-08-13T12:45",
        "2026-08-13T14:00",
        "2026-08-13T15:15",
        "2026-08-13T16:30",
      ],
    );
  });

  it("gives the member sixty minutes, not seventy-five", () => {
    /* The distinction the two columns exist to hold. A booking at 09:00 ends
       at 10:00; the quarter hour after it is the range's, not the member's.
       Folded into one number, the record would say the member had the lane
       until 10:15 while the officer walked them off at 10:00 — and the one
       holding the phone would be right. */
    const [first] = availableSlots({
      policy: declaredPolicy(),
      lanes: [lane("l-1", "pistol")],
      booked: [],
      discipline: "pistol",
      now: NOW,
      days: 1,
    });

    assert.equal(
      (first.end.getTime() - first.start.getTime()) / 60_000,
      SESSION_MINUTES,
    );
  });

  it("agrees with the grid the club declared", () => {
    /* `declaredSessionStarts` is what a founder reads to see the club's day.
       It derives from the same three constants the portal computes from, and
       this is what keeps the two from drifting. */
    const day = availableSlots({
      policy: declaredPolicy(),
      lanes: [lane("l-1", "pistol")],
      booked: [],
      discipline: "pistol",
      now: NOW,
      days: 1,
    });

    assert.equal(declaredSessionStarts().length, 7);
    assert.deepEqual(
      day.map((slot) => lagosMinuteOf(slot.start)),
      declaredSessionStarts(),
    );
  });

  it("declares a 60-minute session and a 15-minute buffer", () => {
    assert.equal(SESSION_MINUTES, 60);
    assert.equal(TURNAROUND_MINUTES, 15);
  });

  it("says the same thing to the public site", () => {
    assert.match(CLUB_HOURS_LINE, /9am/);
    assert.match(CLUB_HOURS_LINE, /6pm/);
    assert.match(CLUB_HOURS_LINE, /every day/);
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

/* ============================================================================
   THE OPERATIONAL BUFFER — founder decision, 16 August 2026

   "60-minute default + 15-minute operational buffer."

   The buffer belongs to the RANGE and the session belongs to the MEMBER, and
   almost every test below is a way of asking whether those two have stayed
   apart. They are one field away from being the same number, and the day they
   become one is the day a booking record and a range officer disagree about
   when somebody has to be off the line.
   ========================================================================= */

describe("the turnaround between sessions", () => {
  const buffered = (turnaroundMinutes: number) =>
    availableSlots({
      policy: policy({ turnaroundMinutes }),
      lanes: [lane("l-1", "pistol")],
      booked: [],
      discipline: "pistol",
      now: NOW,
      days: 1,
    });

  it("spaces the grid by session plus buffer", () => {
    /* The default fixture is 09:00–12:00. Back to back that is three sessions;
       with fifteen minutes between them it is two, because 11:30 would run to
       12:30 and the club shuts at noon. */
    assert.deepEqual(
      buffered(0).map((s) => s.id),
      ["2026-08-13T09:00", "2026-08-13T10:00", "2026-08-13T11:00"],
    );
    assert.deepEqual(
      buffered(15).map((s) => s.id),
      ["2026-08-13T09:00", "2026-08-13T10:15"],
    );
  });

  it("keeps the last session of the day, whose buffer runs past closing", () => {
    /* The fit test is against the SESSION, not the step. A buffer exists to
       separate one session from the next; there is no next one at closing
       time, and testing the step instead would silently cost the club its last
       slot of every single day. 11:00–12:00 fits exactly. */
    const tight = availableSlots({
      policy: policy({
        turnaroundMinutes: 30,
        openingHours: [
          { weekday: THURSDAY, opens: minuteOfDay(9), closes: minuteOfDay(12), staffed: true },
        ],
      }),
      lanes: [lane("l-1", "pistol")],
      booked: [],
      discipline: "pistol",
      now: NOW,
      days: 1,
    });

    /* 09:00 and 10:30. 12:00 would start after closing; 11:30 would end at
       12:30. Neither is offered — and 10:30 IS, even though its buffer would
       run to 12:00. */
    assert.deepEqual(
      tight.map((s) => s.id),
      ["2026-08-13T09:00", "2026-08-13T10:30"],
    );
  });

  it("changes nothing about an on-grid booking's occupancy", () => {
    /* The buffer extends how long a lane is out of the grid, and on an aligned
       grid that is a no-op: the overlap test is half-open, so a 09:00 booking
       held until 10:15 still does not collide with the 10:15 slot. This is the
       case that must NOT regress — if it did, every second slot of every day
       would vanish. */
    const onGrid: BookedSlot = {
      slotStart: new Date("2026-08-13T08:00:00.000Z"), // 09:00 Lagos
      slotEnd: new Date("2026-08-13T09:00:00.000Z"), // 10:00 Lagos
      discipline: "pistol",
      bookingType: "shoot",
      positions: 2,
    };

    const result = availableSlots({
      policy: policy({ turnaroundMinutes: 15 }),
      lanes: [lane("l-1", "pistol", "available", 2)],
      booked: [onGrid],
      discipline: "pistol",
      now: NOW,
      days: 1,
    });

    assert.equal(result.find((s) => s.id === "2026-08-13T09:00")?.free, 0);
    assert.equal(result.find((s) => s.id === "2026-08-13T10:15")?.free, 2);
  });

  it("protects a slot that begins inside an OFF-GRID booking's turnaround", () => {
    /* The case the occupancy extension exists for: a booking written by the
       desk, or from before the club set a turnaround, ending at 10:05. Without
       the buffer the 10:15 slot looks free while the line is still being
       cleared. */
    const offGrid: BookedSlot = {
      slotStart: new Date("2026-08-13T08:05:00.000Z"), // 09:05 Lagos
      slotEnd: new Date("2026-08-13T09:05:00.000Z"), // 10:05 Lagos
      discipline: "pistol",
      bookingType: "shoot",
      positions: 2,
    };

    const withBuffer = availableSlots({
      policy: policy({ turnaroundMinutes: 15 }),
      lanes: [lane("l-1", "pistol", "available", 2)],
      booked: [offGrid],
      discipline: "pistol",
      now: NOW,
      days: 1,
    });

    /* 10:05 + 15 = 10:20, which is inside the 10:15–11:15 slot. */
    assert.equal(withBuffer.find((s) => s.id === "2026-08-13T10:15")?.free, 0);

    /* And with no turnaround declared, the same booking leaves it free — which
       is correct for a club running back to back, and is the behaviour every
       club had before the column existed. */
    const noBuffer = availableSlots({
      policy: policy({ turnaroundMinutes: 0 }),
      lanes: [lane("l-1", "pistol", "available", 2)],
      booked: [offGrid],
      discipline: "pistol",
      now: NOW,
      days: 1,
    });

    assert.equal(noBuffer.find((s) => s.id === "2026-08-13T11:00")?.free, 2);
  });

  it("clears the tables on the same buffer", () => {
    /* A table needs laying as much as a lane needs clearing, and the deck's
       grid steps by the same amount. */
    assert.equal(
      availableTables({
        policy: policy({ tableCapacity: 8, turnaroundMinutes: 15 }),
        booked: [],
        now: NOW,
        days: 1,
      }).map((s) => s.id).join(","),
      "2026-08-13T09:00,2026-08-13T10:15",
    );
  });

  it("treats a negative buffer as none rather than overlapping sessions", () => {
    /* The database refuses one (drizzle/0009) and this refuses to act on one.
       A negative step would hand two relays the same lane, which is the single
       value in this file that could put two people on one firing point. */
    assert.deepEqual(
      buffered(-30).map((s) => s.id),
      buffered(0).map((s) => s.id),
    );
  });
});
