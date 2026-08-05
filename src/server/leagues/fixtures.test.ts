/**
 * Fixtures, streaks and the churn signal.
 *
 * Rewritten against the Leagues Specification. The previous version tested a
 * dated weekly slot; §6 makes fixtures asynchronous ("the fixture is a week,
 * not an evening") and §8 forbids showing dates at all. The timezone tests that
 * used to live here are gone with the dates — there is no longer any clock
 * arithmetic to get wrong, which is a better outcome than testing it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ANCHOR_WEEKDAY,
  SEASON_WEEKS,
  currentStreak,
  hasGoneQuiet,
  longestStreak,
  nextFixture,
  seasonFixtures,
  weekStatus,
  weekdayName,
  weeksSinceLastRound,
} from "./fixtures";

describe("season shape", () => {
  it("is six weeks", () => {
    // §6: "Season length — six weeks. Capped at six for now."
    assert.equal(SEASON_WEEKS, 6);
  });

  it("anchors on Thursday by default", () => {
    // §6: "Thursday is the default night."
    assert.equal(DEFAULT_ANCHOR_WEEKDAY, 4);
    assert.equal(weekdayName(DEFAULT_ANCHOR_WEEKDAY), "Thursday");
  });

  it("names every weekday", () => {
    assert.equal(weekdayName(0), "Sunday");
    assert.equal(weekdayName(6), "Saturday");
  });

  it("falls back to the anchor for an out-of-range weekday", () => {
    assert.equal(weekdayName(99), "Thursday");
  });
});

describe("nextFixture", () => {
  it("opens on week one", () => {
    const next = nextFixture({ roundsSubmitted: 0 });
    assert.equal(next.status, "open");
    if (next.status === "open") {
      assert.equal(next.fixture.week, 1);
      assert.equal(next.weeksRemaining, 6);
    }
  });

  it("advances by rounds submitted", () => {
    const next = nextFixture({ roundsSubmitted: 3 });
    if (next.status === "open") {
      assert.equal(next.fixture.week, 4);
      assert.equal(next.weeksRemaining, 3);
    }
  });

  it("completes after the last week", () => {
    assert.equal(nextFixture({ roundsSubmitted: 6 }).status, "season-complete");
    assert.equal(nextFixture({ roundsSubmitted: 99 }).status, "season-complete");
  });

  it("labels the fixture as a week, never a date", () => {
    // §8, non-negotiable: "Show week numbers, not dates."
    const next = nextFixture({ roundsSubmitted: 2 });
    if (next.status === "open") {
      assert.equal(next.fixture.label, "Week 3 of 6");
    }
  });

  it("emits no date-like string anywhere in its output", () => {
    // A regression guard: if anyone reintroduces a formatted date, this fails.
    const months = /January|February|March|April|May|June|July|August|September|October|November|December/;
    const weekdays = /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/;
    const clock = /\d{1,2}:\d{2}|\d\s?(am|pm)/i;

    for (let submitted = 0; submitted <= 6; submitted += 1) {
      const next = nextFixture({ roundsSubmitted: submitted });
      const serialised = JSON.stringify(next);
      assert.doesNotMatch(serialised, months, serialised);
      assert.doesNotMatch(serialised, weekdays, serialised);
      assert.doesNotMatch(serialised, clock, serialised);
    }
  });

  it("honours a shorter season", () => {
    const next = nextFixture({ roundsSubmitted: 1, seasonWeeks: 3 });
    if (next.status === "open") assert.equal(next.fixture.label, "Week 2 of 3");
  });
});

describe("seasonFixtures", () => {
  it("returns one fixture per week", () => {
    const all = seasonFixtures();
    assert.equal(all.length, 6);
    assert.equal(all[0].week, 1);
    assert.equal(all[5].label, "Week 6 of 6");
  });
});

describe("weekStatus", () => {
  const fixture = { week: 3, label: "Week 3 of 6" };

  it("reports a submitted week", () => {
    assert.equal(weekStatus({ submittedThisWeek: true, fixture }), "Week 3 of 6 — submitted");
  });

  it("reports an open week without urgency", () => {
    // There is genuinely no deadline: the week is open until they shoot it.
    const s = weekStatus({ submittedThisWeek: false, fixture });
    assert.equal(s, "Week 3 of 6 — still to shoot");
    assert.doesNotMatch(s, /only|hurry|last chance|deadline|!/i);
  });
});

/* ---------------------------------------------------------------- STREAKS */

describe("longestStreak", () => {
  it("is zero with no rounds", () => {
    assert.equal(longestStreak([]), 0);
  });

  it("counts a single round", () => {
    assert.equal(longestStreak([3]), 1);
  });

  it("counts consecutive weeks", () => {
    assert.equal(longestStreak([1, 2, 3, 4]), 4);
  });

  it("breaks on a gap and takes the longest run", () => {
    assert.equal(longestStreak([1, 2, 4, 5, 6]), 3);
  });

  it("is order-independent", () => {
    assert.equal(longestStreak([6, 1, 5, 2, 4]), 3);
  });

  it("ignores duplicates", () => {
    assert.equal(longestStreak([2, 2, 3, 3, 4]), 3);
  });
});

describe("currentStreak", () => {
  it("counts back from the current week", () => {
    assert.equal(currentStreak([1, 2, 3], 3), 3);
  });

  it("is zero when this week is unshot", () => {
    // Distinct from longestStreak on purpose: a personal best is a trophy, a
    // current streak is a reason to come back this week.
    assert.equal(currentStreak([1, 2, 3], 4), 0);
  });

  it("stops at the first gap", () => {
    assert.equal(currentStreak([1, 3, 4, 5], 5), 3);
  });

  it("is zero with no rounds", () => {
    assert.equal(currentStreak([], 4), 0);
  });

  it("is skill-independent — any player can hold the longest", () => {
    // §3: "the worst shooter in the club can hold the longest streak."
    // Nothing in the signature admits a score, which is the guarantee.
    assert.equal(currentStreak([1, 2, 3, 4, 5, 6], 6), 6);
  });
});

/* ----------------------------------------------------------- CHURN SIGNAL */

describe("the churn signal", () => {
  // §3: "Track who stops submitting, not only who is winning... the single
  // most important thing to measure in the first season."

  it("reports weeks since the last round", () => {
    assert.equal(weeksSinceLastRound([1, 2, 3], 5), 2);
    assert.equal(weeksSinceLastRound([4], 4), 0);
  });

  it("returns null for a player who never submitted", () => {
    assert.equal(weeksSinceLastRound([], 3), null);
  });

  it("flags a player who has missed two weeks", () => {
    assert.equal(hasGoneQuiet([1, 2], 4), true);
  });

  it("does not flag a player who shot last week", () => {
    assert.equal(hasGoneQuiet([1, 2, 3], 4), false);
  });

  it("does not flag anyone in the first two weeks", () => {
    // A season that has barely started has no churn to detect, and flagging
    // week one would make the signal useless.
    assert.equal(hasGoneQuiet([], 1), false);
    assert.equal(hasGoneQuiet([], 2), false);
  });

  it("flags someone who never started once the season is under way", () => {
    assert.equal(hasGoneQuiet([], 3), true);
  });

  it("detects the pattern the spec warns about", () => {
    // "If beginners stop submitting rounds after three or four weeks, the
    // variance problem has surfaced."
    const beginner = [1, 2, 3]; // stopped after week three
    assert.equal(hasGoneQuiet(beginner, 4), false, "one missed week is not a signal");
    assert.equal(hasGoneQuiet(beginner, 5), true, "two missed weeks is");
  });
});
