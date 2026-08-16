import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { minuteOfDay, type OpeningPeriod } from "./availability";
import { programmeForDay, type ProgrammeEvent } from "./programme";
import {
  agendaFrom,
  calendarDays,
  calendarMonth,
  columnOf,
  isMarked,
  isNotable,
  monthKeyOf,
  monthLabel,
  parseMonthKey,
  relativeDayLabel,
  shiftMonthKey,
  withinHorizon,
  HORIZON_MONTHS,
  WEEK_STARTS_ON,
} from "./calendar";
import { lagosDateKey, lagosInstant } from "@/lib/time";

/**
 * THE MONTH — Members Portal §7.1.
 *
 * The tests are arranged around the four claims this module makes that could be
 * wrong in production, in the order they would hurt:
 *
 *   1. A CLOSURE IS MARKED. A member who drives to the National Stadium on a
 *      day the range is shut is the worst thing the Diary can do, and the
 *      calendar is now the surface they check before setting off. It gets the
 *      most cases.
 *   2. THE GRID IS THE RIGHT DAYS. Off-by-one in the leading cells is the
 *      classic calendar defect and it is silent: the month renders, it is
 *      simply the wrong month. Every weekday a month can start on is covered.
 *   3. THE HORIZON HOLDS. It is what stops the club making claims about
 *      February, and it is reachable by editing a URL.
 *   4. THE AGENDA IS NOT THE OPENING HOURS. §7.3's feed that carries the Diary
 *      is exactly the feed that would ruin a list of what is coming up.
 */

/* Thursday 13 August 2026 in Lagos. August 2026 begins on a Saturday, which is
   the worst case for a Monday-first grid: five leading cells. */
const THURSDAY = new Date("2026-08-13T06:00:00.000Z");

const period = (weekday: number, overrides: Partial<OpeningPeriod> = {}): OpeningPeriod => ({
  weekday,
  opens: minuteOfDay(9),
  closes: minuteOfDay(18),
  staffed: true,
  ...overrides,
});

/** Every day of the week open, which is the club's actual position. */
const OPEN_EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((weekday) => period(weekday));

const event = (overrides: Partial<ProgrammeEvent> = {}): ProgrammeEvent => ({
  kind: "event",
  title: "Guest evening",
  detail: null,
  onDate: "2026-08-20",
  startsMinute: minuteOfDay(18),
  endsMinute: minuteOfDay(21),
  ...overrides,
});

/** The programme for a run of days, as the page builds it. */
const programmeOver = (input: {
  from: Date;
  days: number;
  openingHours?: readonly OpeningPeriod[];
  events?: readonly ProgrammeEvent[];
}) =>
  Array.from({ length: input.days }, (_, offset) =>
    programmeForDay({
      date: new Date(input.from.getTime() + offset * 86_400_000),
      openingHours: input.openingHours ?? OPEN_EVERY_DAY,
      events: input.events ?? [],
      fixtures: [],
    }),
  );

/** The month grid, loaded the way the Diary loads it: shape first, then days. */
function monthWith(input: {
  monthKey: string;
  today?: Date;
  events?: readonly ProgrammeEvent[];
  openingHours?: readonly OpeningPeriod[];
  bookedKeys?: ReadonlySet<string>;
}) {
  const today = input.today ?? THURSDAY;
  const shape = calendarMonth({ monthKey: input.monthKey, today });

  return calendarMonth({
    monthKey: input.monthKey,
    today,
    programme: programmeOver({
      from: shape.from,
      days: shape.weeks.length * 7,
      openingHours: input.openingHours,
      events: input.events,
    }),
    bookedKeys: input.bookedKeys,
  });
}

const cellFor = (
  month: ReturnType<typeof calendarMonth>,
  dateKey: string,
) => {
  const cell = month.weeks.flat().find((candidate) => candidate.dateKey === dateKey);
  assert.ok(cell, `expected ${dateKey} on the ${month.monthKey} grid`);
  return cell;
};

/* ============================================================================
   1. A CLOSURE IS MARKED — the most expensive failure this surface can produce
   ========================================================================= */

describe("a closure on the calendar", () => {
  it("marks the day closed and does not mark it open", () => {
    const month = monthWith({
      monthKey: "2026-08",
      events: [
        event({ kind: "closure", title: "Closed — public holiday", onDate: "2026-08-20" }),
      ],
    });

    const cell = cellFor(month, "2026-08-20");
    assert.equal(cell.marks.closed, true);
    assert.equal(
      cell.marks.open,
      false,
      "a closure suppresses the day's service periods, so the cell must not also claim the club is open",
    );
  });

  it("leaves the surrounding days open", () => {
    const month = monthWith({
      monthKey: "2026-08",
      events: [event({ kind: "closure", title: "Closed", onDate: "2026-08-20" })],
    });

    assert.equal(cellFor(month, "2026-08-19").marks.open, true);
    assert.equal(cellFor(month, "2026-08-19").marks.closed, false);
    assert.equal(cellFor(month, "2026-08-21").marks.open, true);
  });

  it("still marks an event the club announced on a closed day", () => {
    /* The programme merge does not suppress events on a closure, and the
       calendar must not quietly do it either — a dinner that survives a range
       closure is a real state, and hiding it would be the calendar deciding an
       operational question by inference. */
    const month = monthWith({
      monthKey: "2026-08",
      events: [
        event({ kind: "closure", title: "Range closed", onDate: "2026-08-20" }),
        event({ title: "Dinner", onDate: "2026-08-20" }),
      ],
    });

    const cell = cellFor(month, "2026-08-20");
    assert.equal(cell.marks.closed, true);
    assert.equal(cell.marks.event, true);
  });
});

/* ============================================================================
   2. THE GRID IS THE RIGHT DAYS
   ========================================================================= */

describe("the month grid", () => {
  it("starts every row on the week's first day", () => {
    const month = monthWith({ monthKey: "2026-08" });

    for (const week of month.weeks) {
      assert.equal(week.length, 7);
      assert.equal(week[0].weekday, WEEK_STARTS_ON);
      assert.equal(columnOf(week[0].weekday), 0);
    }
  });

  it("contains every day of the month exactly once", () => {
    const month = monthWith({ monthKey: "2026-08" });
    const inMonth = month.weeks.flat().filter((cell) => cell.inMonth);

    assert.equal(inMonth.length, 31);
    assert.equal(inMonth[0].dayOfMonth, 1);
    assert.equal(inMonth[30].dayOfMonth, 31);
    assert.equal(new Set(inMonth.map((cell) => cell.dateKey)).size, 31);
  });

  it("fills the first and last rows with the neighbouring months", () => {
    /* August 2026 begins on a Saturday, so a Monday-first grid leads with the
       last five days of July — which is exactly the run a member planning
       across the month boundary wants beside the first of August. */
    const month = monthWith({ monthKey: "2026-08" });
    const first = month.weeks[0];

    assert.equal(first[0].dateKey, "2026-07-27");
    assert.equal(first[0].inMonth, false);
    assert.equal(first[5].dateKey, "2026-08-01");
    assert.equal(first[5].inMonth, true);
  });

  it("takes as many rows as the month needs and no more", () => {
    /* February 2027 has 28 days and begins on a Monday: four rows exactly, and
       a fixed six-row grid would give up two rows of a phone screen to
       nothing. */
    const february = calendarMonth({
      monthKey: "2027-02",
      today: new Date("2026-12-01T06:00:00.000Z"),
      horizonMonths: 12,
    });
    assert.equal(february.weeks.length, 4);

    /* August 2026 begins on a Saturday and has 31 days: 5 + 31 = 36, which
       needs six. */
    assert.equal(monthWith({ monthKey: "2026-08" }).weeks.length, 6);
  });

  it("handles a leap February", () => {
    const month = calendarMonth({
      monthKey: "2028-02",
      today: new Date("2027-12-01T06:00:00.000Z"),
      horizonMonths: 24,
    });

    const inMonth = month.weeks.flat().filter((cell) => cell.inMonth);
    assert.equal(inMonth.length, 29);
    assert.equal(inMonth[28].dateKey, "2028-02-29");
  });

  it("reports the range it actually covers, so the caller loads all of it", () => {
    const shape = calendarMonth({ monthKey: "2026-08", today: THURSDAY });

    assert.equal(lagosDateKey(shape.from), "2026-07-27");
    assert.equal(lagosDateKey(shape.to), "2026-09-06");
  });

  it("marks today, and only today", () => {
    const month = monthWith({ monthKey: "2026-08" });
    const marked = month.weeks.flat().filter((cell) => cell.isToday);

    assert.equal(marked.length, 1);
    assert.equal(marked[0].dateKey, "2026-08-13");
  });

  it("marks the days before today as past, and no others", () => {
    const month = monthWith({ monthKey: "2026-08" });

    assert.equal(cellFor(month, "2026-08-12").isPast, true);
    assert.equal(
      cellFor(month, "2026-08-13").isPast,
      false,
      "today is not past — the Diary opens on it",
    );
    assert.equal(cellFor(month, "2026-08-14").isPast, false);
  });

  it("marks the member's own bookings", () => {
    const month = monthWith({
      monthKey: "2026-08",
      bookedKeys: new Set(["2026-08-22"]),
    });

    assert.equal(cellFor(month, "2026-08-22").marks.booked, true);
    assert.equal(cellFor(month, "2026-08-21").marks.booked, false);
  });

  it("leaves a day the caller did not load unmarked rather than guessing", () => {
    /* P2. A day outside the loaded programme carries no marks, which is what an
       unloaded day honestly is — the page is expected to load the range the
       grid reports, and this is what it looks like when it does not. */
    const month = calendarMonth({ monthKey: "2026-08", today: THURSDAY });
    const cell = cellFor(month, "2026-08-20");

    assert.equal(cell.marks.open, false);
    assert.equal(cell.marks.event, false);
    assert.equal(cell.marks.closed, false);
  });
});

describe("a month grid built for every weekday a month can start on", () => {
  /* The leading-cell count is the classic silent calendar defect: the month
     renders, it is simply shifted. Twelve consecutive months cover all seven
     starting weekdays several times over. */
  for (let offset = 0; offset < 12; offset += 1) {
    const monthKey = shiftMonthKey("2026-08", offset);

    it(`starts ${monthLabel(monthKey)} in the right column`, () => {
      const month = calendarMonth({
        monthKey,
        today: THURSDAY,
        horizonMonths: 24,
      });

      const firstOfMonth = month.weeks
        .flat()
        .find((cell) => cell.inMonth && cell.dayOfMonth === 1);
      assert.ok(firstOfMonth);

      const index = month.weeks.flat().indexOf(firstOfMonth);
      assert.equal(
        index,
        columnOf(firstOfMonth.weekday),
        "the first of the month sits in the column its weekday belongs to",
      );
      assert.ok(index < 7, "and it is in the first row");
    });
  }
});

/* ============================================================================
   3. THE HORIZON
   ========================================================================= */

describe("the horizon", () => {
  it("does not offer a month before this one", () => {
    const month = monthWith({ monthKey: "2026-08" });
    assert.equal(month.previousKey, null);
  });

  it("offers the way back once the member has travelled forward", () => {
    const month = calendarMonth({ monthKey: "2026-09", today: THURSDAY });
    assert.equal(month.previousKey, "2026-08");
  });

  it("stops at the far edge rather than projecting the club's week forever", () => {
    const furthest = shiftMonthKey("2026-08", HORIZON_MONTHS);
    const month = calendarMonth({ monthKey: furthest, today: THURSDAY });

    assert.equal(
      month.nextKey,
      null,
      "beyond the horizon every cell would carry the same rhythm mark, which is a claim the club has not made",
    );
  });

  it("accepts the months in between", () => {
    assert.equal(withinHorizon("2026-08", THURSDAY), true);
    assert.equal(withinHorizon("2026-09", THURSDAY), true);
    assert.equal(withinHorizon(shiftMonthKey("2026-08", HORIZON_MONTHS), THURSDAY), true);
  });

  it("refuses a month a member typed into the URL", () => {
    assert.equal(withinHorizon("2031-02", THURSDAY), false);
    assert.equal(withinHorizon("2026-07", THURSDAY), false);
    assert.equal(
      withinHorizon(shiftMonthKey("2026-08", HORIZON_MONTHS + 1), THURSDAY),
      false,
    );
  });
});

describe("month keys", () => {
  it("reads a month off an instant on the Lagos calendar", () => {
    /* 23:30 UTC on 31 August is 00:30 Lagos on 1 September. A UTC-derived key
       would file it under August and the calendar would open on the wrong
       month for the first hour of every day. */
    assert.equal(monthKeyOf(new Date("2026-08-31T23:30:00.000Z")), "2026-09");
    assert.equal(monthKeyOf(new Date("2026-08-31T22:30:00.000Z")), "2026-08");
  });

  it("crosses the year boundary in both directions", () => {
    assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
    assert.equal(shiftMonthKey("2027-01", -1), "2026-12");
    assert.equal(shiftMonthKey("2026-08", 12), "2027-08");
  });

  it("refuses what it cannot parse rather than throwing", () => {
    /* The value is in a URL a member can edit or a link somebody sent them. */
    for (const raw of ["", "2026", "2026-13", "2026-00", "august", "2026-8", undefined]) {
      assert.equal(parseMonthKey(raw), null, `expected ${String(raw)} to be refused`);
    }

    assert.deepEqual(parseMonthKey("2026-08"), { year: 2026, month: 7 });
  });
});

/* ============================================================================
   4. THE AGENDA IS NOT THE OPENING HOURS
   ========================================================================= */

describe("coming up", () => {
  it("leaves the operating rhythm out entirely", () => {
    /* §7.3's feed that keeps the Diary populated is exactly the feed that would
       ruin this list: ninety days of "Range open, 09:00–18:00" is the opening
       hours printed ninety times, not an agenda. */
    const days = programmeOver({ from: THURSDAY, days: 30 });
    const items = agendaFrom({ days, today: THURSDAY });

    assert.equal(items.length, 0);
    assert.ok(
      days.every((day) => day.entries.length > 0),
      "the days themselves are not empty — the club is open on all of them",
    );
  });

  it("lists the one-offs in the order they happen", () => {
    const days = programmeOver({
      from: THURSDAY,
      days: 30,
      events: [
        event({ title: "Guest evening", onDate: "2026-08-20" }),
        event({ title: "Open day", onDate: "2026-08-16" }),
        event({ kind: "closure", title: "Closed", onDate: "2026-09-01" }),
      ],
    });

    const items = agendaFrom({ days, today: THURSDAY });

    assert.deepEqual(
      items.map((item) => item.entry.title),
      ["Open day", "Guest evening", "Closed"],
    );
    assert.ok(
      items.every((item) => item.entry.kind !== "service"),
      "the rhythm never reaches this list",
    );
  });

  it("counts the days to each one", () => {
    const days = programmeOver({
      from: THURSDAY,
      days: 30,
      events: [event({ onDate: "2026-08-14" })],
    });

    assert.equal(agendaFrom({ days, today: THURSDAY })[0].inDays, 1);
  });

  it("stops at the limit rather than becoming a scroll", () => {
    const days = programmeOver({
      from: THURSDAY,
      days: 30,
      events: Array.from({ length: 9 }, (_, index) =>
        event({ title: `Evening ${index}`, onDate: `2026-08-${14 + index}` }),
      ),
    });

    assert.equal(agendaFrom({ days, today: THURSDAY, limit: 5 }).length, 5);
  });

  it("does not look backwards", () => {
    const days = programmeOver({
      from: new Date("2026-08-01T06:00:00.000Z"),
      days: 30,
      events: [
        event({ title: "Last week", onDate: "2026-08-05" }),
        event({ title: "Next week", onDate: "2026-08-20" }),
      ],
    });

    assert.deepEqual(
      agendaFrom({ days, today: THURSDAY }).map((item) => item.entry.title),
      ["Next week"],
    );
  });
});

describe("what counts as marked", () => {
  const marks = (overrides: Partial<Parameters<typeof isMarked>[0]> = {}) => ({
    open: false,
    event: false,
    fixture: false,
    closed: false,
    booked: false,
    ...overrides,
  });

  it("counts the club being open as marked", () => {
    assert.equal(isMarked(marks({ open: true })), true);
    assert.equal(isMarked(marks()), false);
  });

  it("does not count the club being open as notable", () => {
    /* The distinction the grid's quiet treatment and the agenda's filter both
       turn on. A club open on a Tuesday is not news; a guest evening is. */
    assert.equal(isNotable(marks({ open: true })), false);
    assert.equal(isNotable(marks({ event: true })), true);
    assert.equal(isNotable(marks({ closed: true })), true);
    assert.equal(isNotable(marks({ fixture: true })), true);
  });

  it("does not count the member's own booking as notable to the club", () => {
    /* A booking is a fact about the member, and the agenda is the club's list.
       A member's own sessions belong on Today's next-booking card, where they
       already are. */
    assert.equal(isNotable(marks({ booked: true })), false);
    assert.equal(isMarked(marks({ booked: true })), true);
  });
});

describe("how far off a day is", () => {
  it("names the two days a member holds by name, and dates the rest", () => {
    assert.equal(relativeDayLabel(0, "Thursday 13 August"), "Today");
    assert.equal(relativeDayLabel(1, "Friday 14 August"), "Tomorrow");
    assert.equal(relativeDayLabel(2, "Saturday 15 August"), "Saturday 15 August");
    assert.equal(relativeDayLabel(23, "Friday 4 September"), "Friday 4 September");
  });
});

/* ============================================================================
   THE RAIL AND THE GRID ARE THE SAME DAYS
   ========================================================================= */

describe("calendarDays", () => {
  it("marks a run of days identically to the month grid that contains them", () => {
    const events = [event({ onDate: "2026-08-20" })];
    const month = monthWith({ monthKey: "2026-08", events });

    const rail = calendarDays({
      from: THURSDAY,
      days: 7,
      today: THURSDAY,
      programme: programmeOver({ from: THURSDAY, days: 7, events }),
    });

    for (const cell of rail) {
      assert.deepEqual(
        cell.marks,
        cellFor(month, cell.dateKey).marks,
        `${cell.dateKey} must carry the same marks on Today's rail as in the Diary`,
      );
    }
  });

  it("treats every day as in frame when no month is named", () => {
    /* A rail is about its seven days and nothing else. Setting the ones that
       fall in next month lighter would mark a distinction the rail is not
       making. */
    const rail = calendarDays({
      from: new Date("2026-08-29T06:00:00.000Z"),
      days: 7,
      today: THURSDAY,
    });

    assert.ok(rail.every((cell) => cell.inMonth));
    assert.equal(rail[3].dateKey, "2026-09-01");
  });

  it("steps in Lagos calendar days rather than in 24-hour blocks", () => {
    const rail = calendarDays({
      from: lagosInstant(2026, 7, 30, 23, 30),
      days: 3,
      today: THURSDAY,
    });

    assert.deepEqual(
      rail.map((cell) => cell.dateKey),
      ["2026-08-30", "2026-08-31", "2026-09-01"],
    );
  });
});
