import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { minuteOfDay, type OpeningPeriod } from "./availability";
import {
  hasProgramme,
  programmeForDay,
  weekFrom,
  type ProgrammeEvent,
  type ProgrammeFixture,
} from "./programme";

/**
 * Members Portal §7.3 — "Three feeds, not one."
 *
 * The tests below are arranged around the two claims the section makes that
 * could be wrong in production:
 *
 *   1. The Diary is not empty most weeks, because the operating rhythm carries
 *      it. That is a claim about the merge, and it is testable.
 *   2. A closure means a member does not drive to a closed range. That is the
 *      most expensive failure this surface can produce and it gets the most
 *      cases.
 */

/* Thursday 13 August 2026 in Lagos. */
const THURSDAY = new Date("2026-08-13T06:00:00.000Z");
const THURSDAY_KEY = "2026-08-13";
const THURSDAY_WEEKDAY = 4;

const period = (overrides: Partial<OpeningPeriod> = {}): OpeningPeriod => ({
  weekday: THURSDAY_WEEKDAY,
  opens: minuteOfDay(9),
  closes: minuteOfDay(21),
  staffed: true,
  ...overrides,
});

const event = (overrides: Partial<ProgrammeEvent> = {}): ProgrammeEvent => ({
  kind: "event",
  title: "Guest evening",
  detail: null,
  onDate: THURSDAY_KEY,
  startsMinute: minuteOfDay(18),
  endsMinute: minuteOfDay(21),
  ...overrides,
});

const day = (input: {
  openingHours?: readonly OpeningPeriod[];
  events?: readonly ProgrammeEvent[];
  fixtures?: readonly ProgrammeFixture[];
  date?: Date;
} = {}) =>
  programmeForDay({
    date: input.date ?? THURSDAY,
    openingHours: input.openingHours ?? [period()],
    events: input.events ?? [],
    fixtures: input.fixtures ?? [],
  });

describe("the operating rhythm carries the week", () => {
  it("renders an opening period as a service entry with no rows anywhere", () => {
    /* §7.3: "Free once the hours migration lands, which booking needs anyway."
       The Diary is not waiting on an events module. */
    const result = day();

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].kind, "service");
    assert.equal(result.entries[0].startsMinute, minuteOfDay(9));
  });

  it("uses the club's own label where it has written one", () => {
    const result = day({ openingHours: [period({ label: "Range and deck" })] });
    assert.equal(result.entries[0].title, "Range and deck");
  });

  it("distinguishes the club being open from the range being open", () => {
    /* An unstaffed period is a real thing to publish — the deck is lit, the
       range is not — and a member who read "open" and arrived to shoot would
       have been misled by their own club. */
    const result = day({ openingHours: [period({ staffed: false })] });

    assert.equal(result.entries[0].staffed, false);
    assert.equal(result.entries[0].title, "Club open");
    assert.match(result.entries[0].detail ?? "", /No range officer/);
  });

  it("ignores periods for another weekday", () => {
    assert.deepEqual(day({ openingHours: [period({ weekday: 0 })] }).entries, []);
  });
});

describe("a closure outranks the hours", () => {
  const closure = event({ kind: "closure", title: "Closed — public holiday", startsMinute: null, endsMinute: null });

  it("suppresses the day's service entirely", () => {
    /* The failure: a member drives to the National Stadium because the portal
       said the range was open. It costs the club a member and it is entirely
       preventable. */
    const result = day({ events: [closure] });

    assert.equal(result.closed, true);
    assert.equal(result.entries.filter((e) => e.kind === "service").length, 0);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].kind, "closure");
  });

  it("does not suppress a fixture or an event on the same day", () => {
    /* A closure of the range does not necessarily cancel a dinner. Silently
       deleting something the club announced is the worse failure, and cancelling
       it is an operational act this module will not perform by inference. */
    const result = day({
      events: [closure, event()],
      fixtures: [{ title: "Week 3 — Thursday League", detail: null, onDate: THURSDAY_KEY }],
    });

    assert.equal(result.entries.filter((e) => e.kind === "event").length, 1);
    assert.equal(result.entries.filter((e) => e.kind === "fixture").length, 1);
  });

  it("does not leak a closure onto the following day", () => {
    const friday = new Date("2026-08-14T06:00:00.000Z");
    const result = programmeForDay({
      date: friday,
      openingHours: [period({ weekday: 5 })],
      events: [closure],
      fixtures: [],
    });

    assert.equal(result.closed, false);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].kind, "service");
  });
});

describe("ordering", () => {
  it("puts an all-day entry before a timed one", () => {
    /* An entry with no time is usually the frame the timed ones sit inside.
       Reading it after the 18:00 fixture it governs is reading it too late. */
    const result = day({
      openingHours: [period()],
      events: [event({ kind: "event", title: "Aduvie tournament", startsMinute: null, endsMinute: null })],
    });

    assert.equal(result.entries[0].title, "Aduvie tournament");
  });

  it("orders timed entries by when they start", () => {
    const result = day({
      openingHours: [period()],
      events: [
        event({ title: "Late", startsMinute: minuteOfDay(20), endsMinute: minuteOfDay(21) }),
        event({ title: "Early", startsMinute: minuteOfDay(10), endsMinute: minuteOfDay(11) }),
      ],
    });

    assert.deepEqual(
      result.entries.map((e) => e.title),
      ["Range open", "Early", "Late"],
    );
  });

  it("breaks a tie on kind rather than on insertion order", () => {
    /* §6.3's argument about computed ordering applies to any list a member
       learns to read: a programme that reshuffles when the founder adds an
       event is never learned. */
    const both = day({
      openingHours: [period({ opens: minuteOfDay(18), closes: minuteOfDay(21) })],
      events: [event({ title: "Guest evening", startsMinute: minuteOfDay(18) })],
    });

    assert.deepEqual(
      both.entries.map((e) => e.kind),
      ["service", "event"],
    );
  });
});

describe("the week", () => {
  it("rolls from today rather than snapping to a Monday", () => {
    /* A strip that starts on the Monday a member cannot travel back to spends
       two of its seven cells on the past. */
    const week = weekFrom(THURSDAY);

    assert.equal(week.length, 7);
    assert.equal(week[0].toISOString(), "2026-08-12T23:00:00.000Z");
  });

  it("crosses a month boundary without arithmetic drift", () => {
    const week = weekFrom(new Date("2026-08-29T06:00:00.000Z"));
    assert.equal(week[6].toISOString(), "2026-09-03T23:00:00.000Z");
  });

  it("knows which days are worth tapping", () => {
    assert.equal(hasProgramme(day()), true);
    assert.equal(hasProgramme(day({ openingHours: [] })), false);
  });
});
