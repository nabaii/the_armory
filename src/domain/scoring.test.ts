import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { disciplines } from "@/content/disciplines";
import {
  cardsUntilTrend,
  describeScore,
  formatById,
  formatsFor,
  parseScore,
  personalBests,
  SCORE_FORMATS,
  standingRounds,
  trendFor,
  type ScoredRound,
} from "./scoring";

/**
 * §6.5: "Select shooter, enter total, confirm. No free-text entry in the normal
 *        path. Under twenty seconds. Guests are scored identically to members."
 * §6.2: "Score history, personal best by discipline, trend."
 * §1.2 rule 3: "a correction is a new row referencing the old one."
 * §12:  "the blocked path asserts the reason string."
 */

const round = (overrides: Partial<ScoredRound> = {}): ScoredRound => ({
  id: "r-1",
  discipline: "10m-air-rifle",
  format: "10m-air-rifle/60",
  totalScore: 570,
  capturedAt: new Date("2026-08-01T10:00:00.000Z"),
  correctsRoundId: null,
  ...overrides,
});

const sixty = formatById("10m-air-rifle/60")!;
const final = formatById("10m-air-rifle/final")!;

describe("the format table", () => {
  it("gives every format a unique, discipline-prefixed id", () => {
    const ids = SCORE_FORMATS.map((format) => format.id);
    assert.equal(new Set(ids).size, ids.length);

    for (const format of SCORE_FORMATS) {
      assert.ok(
        format.id.startsWith(`${format.discipline}/`),
        `${format.id} does not name its discipline`,
      );
    }
  });

  it("offers a format for every discipline the club runs", () => {
    /* Read from src/content/disciplines.ts rather than listed here. A
       discipline that can be booked and cannot be scored is a lane that
       records nothing — and a hand-copied list is how that goes unnoticed,
       which is exactly what happened when 25m pistol was retired and this
       test went on asserting against a slug the club no longer runs. */
    for (const { slug } of disciplines) {
      assert.ok(formatsFor(slug).length > 0, `nothing to score for ${slug}`);
    }
  });

  it("offers no format for a discipline the club has retired", () => {
    /* The other half of the same guarantee. Retiring a discipline means
       removing its formats too, or the lane keeps offering a course of fire
       for a range that no longer exists. */
    assert.equal(formatsFor("25m-pistol").length, 0);
    assert.equal(formatById("25m-pistol/60"), null);
  });

  it("hides a retired format from the lane and still resolves it for history", () => {
    /* Asserted against the shape rather than a retired row, because there is
       no retired format yet and the guarantee has to hold on the day there is. */
    const active = formatsFor("10m-air-rifle");
    assert.ok(active.every((format) => format.active));
    assert.equal(formatById("10m-air-rifle/60")?.id, "10m-air-rifle/60");
  });

  it("does not resolve a format nobody defined", () => {
    assert.equal(formatById("10m-air-rifle/90"), null);
  });
});

describe("entering a total — §6.5's one keyed number", () => {
  it("accepts a whole-point card", () => {
    const entry = parseScore(sixty, "578");
    assert.deepEqual(entry, { ok: true, totalScore: 578 });
  });

  it("stores a decimal card in tenths, exactly", () => {
    const entry = parseScore(final, "251.4");
    assert.deepEqual(entry, { ok: true, totalScore: 2514 });
  });

  it("scales every decimal in range without a float rounding to the wrong tenth", () => {
    /* The multiply is exact across this range today — that is the point of
       checking it here rather than trusting it in the parse. The day somebody
       adds a format with a larger ceiling, this test still passes because the
       parse never multiplies; if it did, this is where the range would have to
       be re-proved and nobody would remember to. */
    for (let whole = 0; whole * 10 <= final.maxTotal - 9; whole += 1) {
      for (let tenth = 0; tenth <= 9; tenth += 1) {
        const entry = parseScore(final, `${whole}.${tenth}`);
        assert.deepEqual(entry, {
          ok: true,
          totalScore: whole * 10 + tenth,
        });
      }
    }
  });

  it("records a zero, and does not confuse it with an empty field", () => {
    assert.deepEqual(parseScore(sixty, "0"), { ok: true, totalScore: 0 });

    const empty = parseScore(sixty, "");
    assert.equal(empty.ok, false);
    assert.equal(empty.ok === false && empty.refusal.reason, "Enter the total.");
  });

  it("refuses a decimal where the format has none, in English", () => {
    const entry = parseScore(sixty, "578.5");
    assert.equal(entry.ok, false);
    assert.equal(
      entry.ok === false && entry.refusal.reason,
      "Enter the total as a whole number.",
    );
  });

  it("refuses two decimal places where the format allows one", () => {
    const entry = parseScore(final, "623.45");
    assert.equal(entry.ok, false);
    assert.equal(
      entry.ok === false && entry.refusal.reason,
      "Enter the total as a number, to one decimal place.",
    );
  });

  it("refuses anything that is not a number rather than truncating it", () => {
    /* parseFloat("12abc") is 12. A half-scanned barcode must not become a card. */
    for (const keyed of ["12abc", "5 7 8", "-40", "1e3"]) {
      const entry = parseScore(sixty, keyed);
      assert.equal(entry.ok, false, `${keyed} was accepted`);
    }
  });

  it("refuses an impossible total and names the ceiling", () => {
    const entry = parseScore(sixty, "6000");
    assert.equal(entry.ok, false);
    assert.equal(
      entry.ok === false && entry.refusal.reason,
      "A 60 shots card cannot exceed 600.",
    );
    assert.equal(
      entry.ok === false && entry.refusal.remedy,
      "Check the total and enter it again.",
    );
  });

  it("accepts a perfect card without asking whether the officer is sure", () => {
    assert.deepEqual(parseScore(sixty, "600"), { ok: true, totalScore: 600 });
    assert.deepEqual(parseScore(final, "261.6"), { ok: true, totalScore: 2616 });
  });

  it("reads a stored score back as it was keyed", () => {
    assert.equal(describeScore(sixty, 578), "578");
    assert.equal(describeScore(final, 6234), "623.4");
    assert.equal(describeScore(final, 6230), "623.0");
  });
});

describe("corrections — §1.2 rule 3", () => {
  const original = round({ id: "r-1", totalScore: 578 });
  const correction = round({
    id: "r-2",
    totalScore: 478,
    correctsRoundId: "r-1",
    capturedAt: new Date("2026-08-01T10:30:00.000Z"),
  });

  it("drops the superseded card from what still stands", () => {
    const standing = standingRounds([original, correction]);
    assert.deepEqual(
      standing.map((r) => r.id),
      ["r-2"],
    );
  });

  it("keeps a corrected score out of the personal best", () => {
    /* The defect this exists to prevent: a mis-keyed 578 that was corrected to
       478 remaining the member's personal best forever. */
    const bests = personalBests([original, correction]);
    assert.equal(bests.length, 1);
    assert.equal(bests[0].totalScore, 478);
  });

  it("returns history newest first", () => {
    const standing = standingRounds([
      round({ id: "a", capturedAt: new Date("2026-08-01T10:00:00.000Z") }),
      round({ id: "c", capturedAt: new Date("2026-08-03T10:00:00.000Z") }),
      round({ id: "b", capturedAt: new Date("2026-08-02T10:00:00.000Z") }),
    ]);
    assert.deepEqual(
      standing.map((r) => r.id),
      ["c", "b", "a"],
    );
  });
});

describe("personal bests — §6.2", () => {
  it("keeps formats apart rather than reporting the largest number", () => {
    /* A 585 over 60 shots is a better card than a 195 over 20, and a 195 over
       20 is a better card than a 180 over 20. Comparing across formats would
       report the first as the person's best at everything. */
    const bests = personalBests([
      round({ id: "a", format: "10m-air-rifle/60", totalScore: 585 }),
      round({
        id: "b",
        format: "10m-air-rifle/20-practice",
        totalScore: 195,
      }),
      round({
        id: "c",
        format: "10m-air-rifle/20-practice",
        totalScore: 180,
      }),
    ]);

    assert.deepEqual(
      bests.map((best) => [best.format, best.totalScore]),
      [
        ["10m-air-rifle/20-practice", 195],
        ["10m-air-rifle/60", 585],
      ],
    );
  });

  it("carries the discipline so a screen can group without a join", () => {
    const [best] = personalBests([round()]);
    assert.equal(best.discipline, "10m-air-rifle");
  });

  it("has nothing to say about somebody who has not shot", () => {
    assert.deepEqual(personalBests([]), []);
  });
});

describe("trend — §6.2", () => {
  const series = (totals: readonly number[]): ScoredRound[] =>
    totals.map((totalScore, index) =>
      round({
        id: `r-${index}`,
        totalScore,
        /* Ascending time; `standingRounds` sorts newest first, so the last
           entry is the most recent card. */
        capturedAt: new Date(Date.UTC(2026, 6, index + 1, 10)),
      }),
    );

  it("says nothing at all from a second visit", () => {
    const rounds = series([560, 540]);
    assert.equal(trendFor(rounds, "10m-air-rifle/60"), null);
    assert.equal(cardsUntilTrend(rounds, "10m-air-rifle/60"), 2);
  });

  it("reports improvement once there are enough cards", () => {
    /* Four cards: two against two. 560 against 542.5. */
    const trend = trendFor(series([540, 545, 550, 570]), "10m-air-rifle/60");
    assert.equal(trend?.direction, "up");
    assert.equal(trend?.line, "Up 18 points on your previous cards.");
  });

  it("compares equal windows rather than three cards against one", () => {
    /* The defect the symmetric window exists to prevent: one bad card four
       visits ago setting the baseline for every later comparison. Both series
       below hold the same four most recent cards; only the older history
       differs, and the older history is not what a trend over four cards is
       about. */
    const four = trendFor(series([560, 560, 570, 570]), "10m-air-rifle/60");
    assert.equal(four?.change, 10);

    const six = trendFor(
      series([400, 400, 560, 560, 570, 570]),
      "10m-air-rifle/60",
    );
    /* Six cards legitimately reaches further back — 566.67 against 453.33 —
       but it reaches back by the same amount on both sides. */
    assert.equal(six?.direction, "up");
    assert.ok(six !== null && six.change > 0);
  });

  it("reports a decline plainly rather than hiding it", () => {
    const trend = trendFor(series([580, 578, 575, 550]), "10m-air-rifle/60");
    assert.equal(trend?.direction, "down");
    assert.match(trend?.line ?? "", /^Down \d+ points/);
  });

  it("calls a small change steady rather than an improvement", () => {
    const trend = trendFor(series([560, 560, 561, 561]), "10m-air-rifle/60");
    assert.equal(trend?.direction, "steady");
    assert.equal(trend?.line, "Holding steady across your recent cards.");
  });

  it("reads a decimal trend in points, not in tenths", () => {
    const decimal = [2050, 2060, 2070, 2200].map((totalScore, index) =>
      round({
        id: `d-${index}`,
        format: "10m-air-rifle/final",
        totalScore,
        capturedAt: new Date(Date.UTC(2026, 6, index + 1, 10)),
      }),
    );

    const trend = trendFor(decimal, "10m-air-rifle/final");
    assert.equal(trend?.direction, "up");
    assert.match(trend?.line ?? "", /^Up \d+\.\d points/);
  });

  it("does not mix two formats into one trend", () => {
    const mixed = [
      ...series([560, 561, 562, 563]),
      round({
        id: "p-1",
        format: "10m-air-rifle/20-practice",
        totalScore: 190,
        capturedAt: new Date(Date.UTC(2026, 6, 9, 10)),
      }),
    ];

    assert.equal(trendFor(mixed, "10m-air-rifle/20-practice"), null);
    assert.ok(trendFor(mixed, "10m-air-rifle/60"));
  });
});
