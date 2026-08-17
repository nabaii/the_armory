import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHECK_IN_PROMISE_SECONDS,
  MEANINGFUL_VISIT_COUNT,
  checkInClock,
  visitMix,
  visitMixCaveat,
} from "./intelligence";

/**
 * Management System Design Specification §11.2, §11.4 — and finding F4.
 *
 * The number that would have read zero, and the promise nothing measured.
 */

const ADA = "11111111-1111-4111-8111-111111111111";
const BODE = "22222222-2222-4222-8222-222222222222";
const CHIKE = "33333333-3333-4333-8333-333333333333";

const WINDOW = {
  from: new Date("2026-09-01T00:00:00Z"),
  to: new Date("2026-10-01T00:00:00Z"),
};

const at = (iso: string) => new Date(iso);

describe("the non-shooting visit share — §11.2, F4", () => {
  it("counts the lunch nobody checked in for", () => {
    /* The whole finding, as one case. Ada shoots. Bode eats and is never
       checked in, because the desk is a range gate. Before `fnb` existed Bode
       left no trace and the club's first falsifying number read zero. */
    const mix = visitMix({
      visits: [{ personId: ADA, at: at("2026-09-10T10:00:00Z"), firedRound: true }],
      service: [{ personId: BODE, at: at("2026-09-10T13:00:00Z") }],
      window: WINDOW,
    });

    assert.equal(mix.visits, 2);
    assert.equal(mix.shooting, 1);
    assert.equal(mix.nonShooting, 1);
    assert.equal(mix.fromServiceOnly, 1, "Bode is known only from his lunch");
  });

  it("counts a checked-in member who fired nothing", () => {
    const mix = visitMix({
      visits: [
        { personId: ADA, at: at("2026-09-11T18:00:00Z"), firedRound: false },
      ],
      service: [],
      window: WINDOW,
    });

    assert.equal(mix.nonShooting, 1);
    assert.equal(mix.fromServiceOnly, 0, "the desk saw this one");
  });

  it("counts a person-day once, however many times they came through", () => {
    /* Counting rows would report two visits for a member who stepped out for an
       hour — a number that improves for no reason and is then defended. */
    const mix = visitMix({
      visits: [
        { personId: ADA, at: at("2026-09-12T09:00:00Z"), firedRound: true },
        { personId: ADA, at: at("2026-09-12T17:00:00Z"), firedRound: false },
      ],
      service: [{ personId: ADA, at: at("2026-09-12T18:00:00Z") }],
      window: WINDOW,
    });

    assert.equal(mix.visits, 1);
    assert.equal(mix.shooting, 1, "they shot that day, so the day is a shooting day");
    assert.equal(mix.nonShooting, 0);
  });

  it("does not let a charge make a day look like a shooting day", () => {
    const mix = visitMix({
      visits: [],
      service: [
        { personId: ADA, at: at("2026-09-13T13:00:00Z") },
        { personId: ADA, at: at("2026-09-13T14:00:00Z") },
      ],
      window: WINDOW,
    });

    assert.equal(mix.visits, 1);
    assert.equal(mix.shooting, 0);
    assert.equal(mix.nonShooting, 1);
  });

  it("separates days in Lagos, not in UTC", () => {
    /* 2026-09-14T23:30Z is 00:30 on the FIFTEENTH in Lagos, and 2026-09-15T10:00Z
       is 11:00 on the fifteenth. One Lagos day, two UTC days — so a UTC key
       would report two visits for a member who came in once and stayed.
       §2.1's period boundary, in the module whose whole job is periods. */
    const mix = visitMix({
      visits: [
        { personId: ADA, at: at("2026-09-14T23:30:00Z"), firedRound: false },
        { personId: ADA, at: at("2026-09-15T10:00:00Z"), firedRound: false },
      ],
      service: [],
      window: WINDOW,
    });

    assert.equal(mix.visits, 1);
  });

  it("is half-open on the window", () => {
    const mix = visitMix({
      visits: [
        { personId: ADA, at: at("2026-10-01T00:00:00Z"), firedRound: true },
        { personId: BODE, at: at("2026-08-31T23:00:00Z"), firedRound: true },
        { personId: CHIKE, at: at("2026-09-30T23:00:00Z"), firedRound: true },
      ],
      service: [],
      window: WINDOW,
    });

    assert.equal(mix.visits, 1);
  });

  it("always carries the sentence that says it is a floor", () => {
    const mix = visitMix({ visits: [], service: [], window: WINDOW });
    assert.ok(mix.basis.includes("floor, not a census"));
    assert.ok(
      mix.basis.includes("bought nothing"),
      "the residue — a member who came to watch — must be stated, not hidden",
    );
  });
});

describe("the share refuses to be read from too little — §11.1", () => {
  it("says so rather than drawing a line through three points", () => {
    const mix = visitMix({
      visits: [{ personId: ADA, at: at("2026-09-10T10:00:00Z"), firedRound: true }],
      service: [],
      window: WINDOW,
    });
    assert.ok(visitMixCaveat(mix)?.includes("too few"));
  });

  it("stays quiet once there is a season's worth", () => {
    const visits = Array.from({ length: MEANINGFUL_VISIT_COUNT }, (_, index) => ({
      personId: `person-${index}`,
      at: at("2026-09-10T10:00:00Z"),
      firedRound: index % 2 === 0,
    }));

    assert.equal(visitMixCaveat(visitMix({ visits, service: [], window: WINDOW })), null);
  });
});

describe("the fifteen seconds — §11.4", () => {
  it("reports nothing rather than zero when nothing is measured — S2", () => {
    const clock = checkInClock([]);
    assert.equal(clock.count, 0);
    assert.equal(clock.medianSeconds, null);
    assert.equal(clock.ninetiethSeconds, null);
  });

  it("catches a bad tail that both a mean and a percentile miss", () => {
    /* Ninety-five check-ins at six seconds and five at two minutes.

       The mean is 11.7s and reads as a club comfortably inside its promise.
       The median is 6s and says the same. So does the ninetieth percentile,
       because a 5% tail sits above it — which is the honest limit of a
       percentile and the reason this type carries a fourth figure.

       `overPromise` is the one that surfaces it: five members stood at a
       counter for two minutes, and they are the entire content of the
       measurement. It is the number that should be zero. */
    const durations = [
      ...Array.from({ length: 95 }, () => 6),
      ...Array.from({ length: 5 }, () => 120),
    ];
    const clock = checkInClock(durations);

    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    assert.ok(mean < CHECK_IN_PROMISE_SECONDS, "the mean looks healthy");

    assert.equal(clock.count, 100);
    assert.equal(clock.medianSeconds, 6, "a normal check-in is fast, and is");
    assert.equal(clock.ninetiethSeconds, 6, "and even the ninetieth misses the tail");
    assert.equal(clock.overPromise, 5, "this is the figure that does not");
  });

  it("reports a distribution once the tail is wide enough to reach it", () => {
    const clock = checkInClock([
      ...Array.from({ length: 50 }, () => 8),
      ...Array.from({ length: 10 }, () => 240),
    ]);

    assert.equal(clock.medianSeconds, 8);
    assert.equal(clock.ninetiethSeconds, 240, "a bad check-in costs four minutes");
    assert.equal(clock.overPromise, 10);
  });

  it("counts anything over the promise, and the promise is fifteen seconds", () => {
    assert.equal(CHECK_IN_PROMISE_SECONDS, 15);
    assert.equal(checkInClock([14, 15, 16]).overPromise, 1);
  });

  it("discards negative durations as clock skew, not as fast check-ins", () => {
    /* §8 has the desk writing a device clock and a server clock precisely
       because the device's is not trusted. A negative means the pair
       disagreed, and averaging it in would flatter the figure. */
    const clock = checkInClock([-30, 10, 12]);
    assert.equal(clock.count, 2);
    assert.equal(clock.medianSeconds, 10);
  });

  it("reports a percentile somebody actually experienced", () => {
    /* Nearest-rank, not interpolated: the ninetieth percentile of an officer's
       day should be a real check-in rather than a weighted average of two. */
    assert.equal(checkInClock([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).ninetiethSeconds, 9);
  });
});
