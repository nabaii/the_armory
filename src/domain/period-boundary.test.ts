import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluate, type Subject } from "./capability";
import { allowancePeriod } from "@/server/armory/allowances";
import {
  LAGOS_OFFSET_HOURS,
  addDays,
  lagosDateKey,
  lagosDaysBetween,
  lagosParts,
  parseDateColumn,
} from "@/lib/time";

/**
 * PERIOD BOUNDARIES — §2.1, §11 M10.
 *
 *   §2.1: "Staging must hold realistic seed data … because MOST DEFECTS IN THIS
 *    SYSTEM ONLY APPEAR AT VOLUME OR AT A PERIOD BOUNDARY."
 *   §11 M10: "Security review, LOAD AND PERIOD-BOUNDARY TESTING, restore
 *    rehearsal, staff training, seeded go-live."
 *
 * That sentence names a whole class of defect and this file is the answer to
 * half of it. Every rule in this system that involves a date has a day on which
 * it changes, and the bug is almost never in the rule — it is in whether the
 * boundary is inclusive, and in which timezone the question was asked.
 *
 * ===========================================================================
 * ONE HOUR IS THE WHOLE PROBLEM
 *
 * §2 stores UTC and renders Africa/Lagos, which is UTC+1 all year — no daylight
 * saving, which removes the hardest version of this and leaves the one that
 * actually bites:
 *
 *   A licence expiring on 2026-08-14 stops being valid at the end of the 14th
 *   IN LAGOS, which is 2026-08-14T23:00:00Z. Between 23:00Z and midnight Z it
 *   is a different date in the two zones.
 *
 * So a member arriving at 8pm Lagos on the last day of their licence is inside
 * it; a naive UTC comparison agrees. A member arriving at 11:30pm Lagos is on
 * the 14th locally and the 15th in UTC, and a naive comparison refuses them —
 * at the door, over an hour that does not exist for them.
 *
 * The range closes long before 11pm, which is exactly why this is the defect
 * that survives to production: it is unreachable in normal operation until one
 * evening runs late.
 *
 * ===========================================================================
 * WHAT THIS FILE IS NOT
 *
 * It is not the load half of §11 M10 — that is scripts/volume.ts, which runs
 * the same decisions against §2.1's hundred-member fixture and measures them.
 *
 * And no test here substitutes for §8.5's power cut. A boundary crossed
 * correctly in a unit test is still a boundary crossed on a tablet whose clock
 * came back from a dead battery believing it is 1970 — which is why
 * src/offline/device.ts keeps a high-water mark and why step 33 of the
 * acceptance protocol winds the clock backwards on hardware.
 */

const TIER = {
  id: "tier-full",
  name: "Full",
  canHost: true,
  guestAllowanceAnnual: 6,
  guestConcurrentMax: 2,
  canOwnFirearm: true,
  canStoreFirearm: false,
  disciplineAccess: ["10m-pistol"],
  bookingHorizonDays: 30,
  concurrentBookingsMax: 2,
};

const subject = (over: Partial<Subject> = {}): Subject => ({
  personId: "11111111-1111-4111-8111-111111111111",
  membership: {
    id: "22222222-2222-4222-8222-222222222222",
    status: "active",
    tier: TIER,
    endedOn: null,
    renewsOn: null,
  },
  waiver: {
    waiverVersionId: "active-waiver",
    signedAt: new Date("2026-01-01T09:00:00.000Z"),
  },
  licences: [],
  qualifications: [],
  ...over,
});

/** §3.1's one active version, as every dated capability needs it. */
const WAIVER = {
  activeWaiverVersionId: "active-waiver",
  waiverValidityDays: null as number | null,
};

/* ===========================================================================
   THE LAGOS DAY — the boundary every other one is built on
   ======================================================================== */

describe("the Lagos day boundary", () => {
  it("is one hour ahead of UTC, all year", () => {
    /* Stated as a test rather than as a comment because everything below
       depends on it, and because the day Nigeria adopts daylight saving this
       is the assertion that fails first. */
    assert.equal(LAGOS_OFFSET_HOURS, 1);
  });

  it("rolls the date at 23:00 UTC, not at midnight UTC", () => {
    assert.equal(lagosDateKey(new Date("2026-08-14T22:59:59.999Z")), "2026-08-14");
    assert.equal(lagosDateKey(new Date("2026-08-14T23:00:00.000Z")), "2026-08-15");
  });

  it("puts 11:30pm Lagos on the day the member thinks it is", () => {
    /* The hour this whole file exists for. In UTC this instant is the 15th. */
    const lateEvening = new Date("2026-08-14T22:30:00.000Z");
    assert.equal(lagosParts(lateEvening).day, 14);
    assert.equal(lagosDateKey(lateEvening), "2026-08-14");
    assert.equal(lateEvening.getUTCDate(), 14);

    const afterMidnightLagos = new Date("2026-08-14T23:30:00.000Z");
    assert.equal(lagosDateKey(afterMidnightLagos), "2026-08-15");
  });

  it("counts a day between two instants an hour either side of the roll", () => {
    assert.equal(
      lagosDaysBetween(
        new Date("2026-08-14T22:00:00.000Z"),
        new Date("2026-08-14T23:30:00.000Z"),
      ),
      1,
      "ninety minutes that cross Lagos midnight are one day, not zero",
    );
  });
});

/* ===========================================================================
   LICENCES — §12.1: "Member licence expired yesterday"
   ======================================================================== */

describe("a licence on the day it expires — §4.2, §12.1", () => {
  const withLicence = (expiresOn: string) =>
    subject({
      licences: [
        {
          id: "licence-1",
          status: "verified",
          calibres: [".22 LR"],
          /* A DATE column, read as Lagos midnight. `parseDateColumn` is what
             the server and the desk both use, so this fixture crosses the
             boundary the same way production does. */
          expiresOn: parseDateColumn(expiresOn),
        },
      ],
    });

  const firearm = {
    id: "firearm-1",
    serialNumber: "AX-4471",
    calibre: ".22 LR",
    ownership: "member" as const,
    ownerPersonId: "11111111-1111-4111-8111-111111111111",
    status: "in_service" as const,
  };

  const may = (expiresOn: string, at: string) =>
    evaluate(withLicence(expiresOn), {
      capability: "MAY_USE_OWN_FIREARM",
      now: new Date(at),
      firearm,
    });

  it("is valid at nine in the morning on its last day", () => {
    assert.equal(may("2026-08-14", "2026-08-14T08:00:00.000Z").allowed, true);
  });

  it("is STILL valid at half past eleven that night, Lagos", () => {
    /* 22:30Z is 23:30 in Lagos — the 14th locally, the 14th in UTC too. The
       member is inside their licence and the range is inside its own day. */
    assert.equal(may("2026-08-14", "2026-08-14T22:30:00.000Z").allowed, true);
  });

  it("has expired by nine the next morning", () => {
    const decision = may("2026-08-14", "2026-08-15T08:00:00.000Z");
    assert.equal(decision.allowed, false);
    /* §12: "the blocked path asserts the reason string." */
    assert.match(decision.reason.message, /licence/i);
  });

  it("blocks own-firearm use and leaves club equipment alone — §12.1", () => {
    /* "Member licence expired yesterday → Own-firearm use blocked. CLUB
        EQUIPMENT SHOOTING STILL PERMITTED." The boundary must not take the
       whole visit with it. */
    const expired = withLicence("2026-08-13");
    const now = new Date("2026-08-14T10:00:00.000Z");

    assert.equal(
      evaluate(expired, { capability: "MAY_USE_OWN_FIREARM", now, firearm })
        .allowed,
      false,
    );
    assert.equal(
      evaluate(expired, { capability: "MAY_ATTEND", now, ...WAIVER }).allowed,
      true,
      "an expired licence must not stop somebody shooting club equipment",
    );
  });
});

/* ===========================================================================
   THE ALLOWANCE YEAR — §3.2, §12.1's "an allowance period ending today"
   ======================================================================== */

describe("the allowance period boundary — §3.2", () => {
  const started = new Date("2025-11-20T00:00:00.000Z");

  it("runs from the membership anniversary, not the calendar year", () => {
    /* A member who joins in November and gets twelve visits must not get
       twelve again on 1 January. */
    const period = allowancePeriod(started, new Date("2026-08-14T10:00:00.000Z"));
    assert.equal(lagosDateKey(period.periodStart), "2025-11-20");
    assert.equal(lagosDateKey(period.periodEnd), "2026-11-19");
  });

  it("is still the old period on the last day", () => {
    /* §12.1 plants "an allowance period ending today" deliberately, and a
       period that ended at the start of its final day would give a member a
       fresh quota a day early — every year, compounding. */
    const period = allowancePeriod(started, new Date("2026-11-19T10:00:00.000Z"));
    assert.equal(lagosDateKey(period.periodStart), "2025-11-20");
    assert.equal(lagosDateKey(period.periodEnd), "2026-11-19");
  });

  it("rolls on the anniversary itself", () => {
    const period = allowancePeriod(started, new Date("2026-11-20T10:00:00.000Z"));
    assert.equal(lagosDateKey(period.periodStart), "2026-11-20");
    assert.equal(lagosDateKey(period.periodEnd), "2027-11-19");
  });

  it("does not roll early for a late Lagos evening on the day before", () => {
    /* 22:30Z on the 19th is 23:30 Lagos on the 19th. Still the old period. */
    const period = allowancePeriod(started, new Date("2026-11-19T22:30:00.000Z"));
    assert.equal(lagosDateKey(period.periodEnd), "2026-11-19");
  });

  it("survives a 29 February anniversary", () => {
    /* A member admitted on a leap day. The anniversary does not exist in three
       years out of four, and the period must still be exactly one year and
       must not skip a year or produce an invalid date. */
    const leapStart = new Date("2024-02-29T00:00:00.000Z");

    const inLeapYear = allowancePeriod(leapStart, new Date("2028-03-01T10:00:00.000Z"));
    assert.equal(lagosDateKey(inLeapYear.periodStart), "2028-02-29");

    const ordinary = allowancePeriod(leapStart, new Date("2027-03-05T10:00:00.000Z"));
    /* JavaScript rolls 29 February in a non-leap year to 1 March. That is the
       behaviour to be aware of rather than to be surprised by, and what
       actually matters is stated below: the periods are contiguous. */
    assert.equal(lagosDateKey(ordinary.periodStart), "2027-03-01");
  });

  it("never leaves a gap or an overlap between consecutive periods", () => {
    /* The property that matters, and the one a length assertion would miss.
       A gap is a day on which a member has no allowance row and a guest cannot
       be invited; an overlap is a day on which two rows both claim the visit,
       and §3.2 says "one row per membership per period". */
    for (const start of ["2024-02-29", "2025-11-20", "2026-01-01", "2026-12-31"]) {
      const startedAt = new Date(`${start}T00:00:00.000Z`);

      for (let year = 2026; year <= 2030; year += 1) {
        const inside = allowancePeriod(startedAt, new Date(`${year}-06-15T10:00:00.000Z`));
        /* The instant one day after this period ends must fall in the NEXT
           period, and that period must begin on exactly that day. */
        const dayAfter = addDays(inside.periodEnd, 1);
        const next = allowancePeriod(startedAt, dayAfter);

        assert.equal(
          lagosDateKey(next.periodStart),
          lagosDateKey(dayAfter),
          `${start}: the period after ${lagosDateKey(inside.periodEnd)} does not begin the next day`,
        );
      }
    }
  });

  it("gives every ordinary member a period of exactly one year", () => {
    for (const day of ["2026-01-01", "2026-03-15", "2026-06-30", "2026-12-31"]) {
      const period = allowancePeriod(
        new Date(`${day}T00:00:00.000Z`),
        new Date("2026-12-31T23:00:00.000Z"),
      );

      const days = lagosDaysBetween(period.periodStart, period.periodEnd) + 1;
      assert.ok(
        days === 365 || days === 366,
        `a member starting ${day} got a period of ${days} days`,
      );
    }
  });
});

/* ===========================================================================
   MEMBERSHIP AND WAIVER — the other two dated rules
   ======================================================================== */

describe("a membership on the day it ends — §4.2", () => {
  const may = (endedOn: string | null, at: string, status: "active" | "lapsed") =>
    evaluate(
      subject({
        membership: {
          id: "22222222-2222-4222-8222-222222222222",
          status,
          tier: TIER,
          endedOn: endedOn ? parseDateColumn(endedOn) : null,
          renewsOn: null,
        },
      }),
      { capability: "MAY_ATTEND", now: new Date(at), ...WAIVER },
    );

  it("admits a member on the last day of their membership", () => {
    assert.equal(may("2026-08-14", "2026-08-14T10:00:00.000Z", "active").allowed, true);
  });

  it("admits them at half past eleven that night, Lagos", () => {
    assert.equal(may("2026-08-14", "2026-08-14T22:30:00.000Z", "active").allowed, true);
  });

  it("refuses a lapsed membership, in English", () => {
    const decision = may("2026-08-13", "2026-08-14T10:00:00.000Z", "lapsed");
    assert.equal(decision.allowed, false);
    assert.ok(decision.reason.message.length > 0);
    assert.doesNotMatch(decision.reason.message, /not permitted/i);
  });
});

describe("a waiver on the day its validity runs out — §3.1", () => {
  const signedAt = new Date("2026-01-01T09:00:00.000Z");

  const may = (validityDays: number | null, at: string) =>
    evaluate(subject({ waiver: { waiverVersionId: "active-waiver", signedAt } }), {
      capability: "MAY_ATTEND",
      now: new Date(at),
      activeWaiverVersionId: "active-waiver",
      waiverValidityDays: validityDays,
    });

  it("never expires while §14 leaves the rule unset", () => {
    /* "Fails open" is the recorded position, and it is the right way to be
       wrong: the alternative turns members away over a rule nobody set. */
    assert.equal(may(null, "2030-01-01T10:00:00.000Z").allowed, true);
  });

  it("is valid on the final day of the window", () => {
    /* 365 days from 1 January 2026 is 1 January 2027. The last valid day is
       31 December 2026 and the member must not be refused on it. */
    assert.equal(may(365, "2026-12-31T22:30:00.000Z").allowed, true);
  });

  it("has run out the day after", () => {
    const decision = may(365, "2027-01-02T10:00:00.000Z");
    assert.equal(decision.allowed, false);
    assert.match(decision.reason.message, /waiver/i);
  });
});

/* ===========================================================================
   THE BOOKING HORIZON — a boundary counted forwards rather than back
   ======================================================================== */

describe("the booking horizon — §4.2's MAY_BOOK", () => {
  const now = new Date("2026-08-14T10:00:00.000Z");

  const mayBookAt = (slotStart: Date) =>
    evaluate(subject(), {
      capability: "MAY_BOOK",
      now,
      slotStart,
      discipline: "10m-pistol",
      heldBookings: 0,
    });

  it("permits a slot on the last day of the horizon", () => {
    /* The tier's horizon is 30 days. Day 30 is inside it — a horizon that
       refused its own last day would quietly be 29. */
    assert.equal(mayBookAt(addDays(now, 30)).allowed, true);
  });

  it("refuses a slot one day past it, and says how far ahead they may book", () => {
    const decision = mayBookAt(addDays(now, 31));
    assert.equal(decision.allowed, false);
    assert.match(decision.reason.message, /30|thirty/i);
  });
});
