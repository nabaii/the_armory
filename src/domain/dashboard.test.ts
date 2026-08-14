import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dashboardHeadline,
  guestConversion,
  hostingRate,
  lapseList,
  occupancy,
  rankHosts,
  recentOverrides,
  rosterMetric,
} from "./dashboard";

/**
 * §6.6: "Roster against cap with waitlist depth; hosting rate; guest-to-
 *        application conversion; admissions by host; occupancy by day and slot
 *        SEPARATING MEMBER AND GUEST LOAD; lapse list; revenue by source;
 *        reconciliation exceptions; expiries within 90 days; overrides in the
 *        last 7 days."
 * §3.2:  guest visits are counted "across all hosts, not per host".
 * §12:   an override "appears on the founder's dashboard the same day".
 *
 * A dashboard is where wrong numbers survive longest, because nobody can tell
 * by looking. Most of what follows asserts a DENOMINATOR.
 */

const NOW = new Date("2026-08-14T09:00:00.000Z");

describe("roster against cap — §6.6", () => {
  it("reports seats left", () => {
    const metric = rosterMetric({ seated: 84, cap: 120, waitlistDepth: 0 });
    assert.equal(metric.headroom, 36);
    assert.equal(metric.line, "84 of 120. 36 seats left.");
  });

  it("says full, and how many are waiting", () => {
    const metric = rosterMetric({ seated: 120, cap: 120, waitlistDepth: 7 });
    assert.equal(metric.headroom, 0);
    assert.equal(metric.line, "120 of 120 — full. 7 waiting.");
  });

  it("does not invent a cap §14 has not set", () => {
    /* A cap defaulted to a number closes admissions at it, and nobody chose it. */
    const metric = rosterMetric({ seated: 84, cap: null, waitlistDepth: 0 });
    assert.equal(metric.headroom, null);
    assert.equal(metric.line, "84 members. No roster cap set.");
  });

  it("never reports negative headroom when the club is over cap", () => {
    /* §3.1 admits over cap with an explicit founder override, so this happens. */
    const metric = rosterMetric({ seated: 123, cap: 120, waitlistDepth: 2 });
    assert.equal(metric.headroom, 0);
  });
});

describe("hosting rate — the denominator is who CAN host", () => {
  it("divides by members whose tier permits hosting", () => {
    const rate = hostingRate({ hostsWhoInvited: 9, membersWhoCanHost: 31 });
    assert.equal(
      rate.line,
      "9 of 31 members who can host brought a guest.",
    );
    assert.ok(Math.abs(rate.rate - 9 / 31) < 1e-9);
  });

  it("is zero rather than NaN in a club where nobody can host", () => {
    const rate = hostingRate({ hostsWhoInvited: 0, membersWhoCanHost: 0 });
    assert.equal(rate.rate, 0);
    assert.equal(Number.isNaN(rate.rate), false);
  });

  it("always states the denominator on screen", () => {
    /* A bare "29%" invites comparison against a figure from a different
       denominator six months later. */
    const rate = hostingRate({ hostsWhoInvited: 9, membersWhoCanHost: 31 });
    assert.match(rate.line, /31/);
  });
});

describe("guest conversion — the denominator is distinct guests", () => {
  it("counts people, not visits", () => {
    /* §3.2 counts "across all hosts, not per host". The same person brought
       four times is one prospect — and a rate over visits would FALL every
       time a guest enjoyed themselves enough to come back. */
    const rate = guestConversion({ guestsWhoApplied: 6, distinctGuests: 40 });
    assert.equal(rate.line, "6 of 40 guests went on to apply.");
    assert.equal(rate.denominator, 40);
  });

  it("is zero rather than NaN before the first guest", () => {
    const rate = guestConversion({ guestsWhoApplied: 0, distinctGuests: 0 });
    assert.equal(rate.rate, 0);
  });
});

describe("admissions by host — §6.6", () => {
  const host = (
    hostName: string,
    guestsBrought: number,
    applications: number,
    admitted: number,
  ) => ({ hostPersonId: hostName, hostName, guestsBrought, applications, admitted });

  it("ranks by admissions, not by guests brought", () => {
    /* The distinction is the whole metric: twelve guests and no admissions is
       a different fact from three guests and two admissions. */
    const ranked = rankHosts([
      host("Volume", 12, 1, 0),
      host("Converter", 3, 2, 2),
      host("Middling", 6, 2, 1),
    ]);

    assert.deepEqual(
      ranked.map((row) => row.hostName),
      ["Converter", "Middling", "Volume"],
    );
  });

  it("breaks a tie on applications, then on guests brought", () => {
    const ranked = rankHosts([
      host("Fewer guests", 2, 1, 1),
      host("More guests", 9, 1, 1),
    ]);

    assert.equal(ranked[0].hostName, "More guests");
  });
});

describe("occupancy separates member and guest load — §6.6", () => {
  const at = (date: string, slot: string, isGuest: boolean) => ({
    date,
    slot,
    isGuest,
  });

  it("counts members and guests apart", () => {
    /* A full Saturday is a good problem or a bad one depending entirely on
       this split, and the two call for opposite decisions. */
    const cells = occupancy({
      participations: [
        at("2026-08-15", "18:00", false),
        at("2026-08-15", "18:00", false),
        at("2026-08-15", "18:00", true),
      ],
    });

    assert.equal(cells.length, 1);
    assert.equal(cells[0].memberCount, 2);
    assert.equal(cells[0].guestCount, 1);
    assert.equal(cells[0].total, 3);
  });

  it("computes utilisation against a known capacity", () => {
    const cells = occupancy({
      participations: [
        at("2026-08-15", "18:00", false),
        at("2026-08-15", "18:00", true),
      ],
      capacityBySlot: new Map([["2026-08-15 18:00", 8]]),
    });

    assert.equal(cells[0].utilisation, 0.25);
  });

  it("reports no utilisation rather than a guess when capacity is unknown", () => {
    const cells = occupancy({
      participations: [at("2026-08-15", "18:00", false)],
    });

    assert.equal(cells[0].capacity, null);
    assert.equal(cells[0].utilisation, null);
  });

  it("caps utilisation at one on a night that overran", () => {
    /* An officer moves somebody; a lane takes two. A 140% bar reads as a bug
       rather than as a busy evening. */
    const cells = occupancy({
      participations: [
        at("2026-08-15", "18:00", false),
        at("2026-08-15", "18:00", false),
        at("2026-08-15", "18:00", true),
      ],
      capacityBySlot: new Map([["2026-08-15 18:00", 2]]),
    });

    assert.equal(cells[0].utilisation, 1);
  });

  it("returns cells in day and slot order", () => {
    const cells = occupancy({
      participations: [
        at("2026-08-16", "10:00", false),
        at("2026-08-15", "18:00", false),
        at("2026-08-15", "10:00", false),
      ],
    });

    assert.deepEqual(
      cells.map((cell) => `${cell.date} ${cell.slot}`),
      ["2026-08-15 10:00", "2026-08-15 18:00", "2026-08-16 10:00"],
    );
  });
});

describe("the lapse list — §6.6", () => {
  const lapsed = (name: string, iso: string) => ({
    personId: name,
    name,
    memberNumber: 1,
    lapsedOn: new Date(iso),
  });

  it("puts the most recent lapse first", () => {
    /* Last week is a phone call; March is a different conversation. */
    const rows = lapseList(
      [
        lapsed("March", "2026-03-01T00:00:00.000Z"),
        lapsed("Last week", "2026-08-07T00:00:00.000Z"),
      ],
      NOW,
    );

    assert.deepEqual(
      rows.map((row) => row.name),
      ["Last week", "March"],
    );
  });

  it("says how long ago in words, never a bare date", () => {
    const [row] = lapseList([lapsed("Ada", "2026-08-13T00:00:00.000Z")], NOW);
    assert.equal(row.line, "Ada — lapsed yesterday.");
  });
});

describe("overrides — §12's same-day requirement", () => {
  const override = (id: string, iso: string) => ({
    id,
    action: "session.close",
    reason: "Firearm returned after the log closed.",
    actorName: "Ada N.",
    occurredAt: new Date(iso),
  });

  it("returns only those inside the window, newest first", () => {
    const since = new Date("2026-08-07T09:00:00.000Z");

    const rows = recentOverrides(
      [
        override("old", "2026-07-01T09:00:00.000Z"),
        override("recent", "2026-08-13T09:00:00.000Z"),
        override("today", "2026-08-14T08:00:00.000Z"),
      ],
      since,
    );

    assert.deepEqual(
      rows.map((row) => row.id),
      ["today", "recent"],
    );
  });

  it("includes one made exactly at the boundary", () => {
    const since = new Date("2026-08-07T09:00:00.000Z");
    const rows = recentOverrides([override("edge", since.toISOString())], since);
    assert.equal(rows.length, 1);
  });
});

describe("the headline — what a founder reads first", () => {
  const headline = (over: Partial<Parameters<typeof dashboardHeadline>[0]>) =>
    dashboardHeadline({
      integrityExceptions: 0,
      attentionExceptions: 0,
      overrides: 0,
      expiringSoon: 0,
      roster: rosterMetric({ seated: 84, cap: 120, waitlistDepth: 0 }),
      ...over,
    });

  it("puts an integrity problem above everything", () => {
    /* §3.4: "if the two can disagree, they eventually will." A register that
       disagrees with its log outranks a full roster. */
    assert.equal(
      headline({
        integrityExceptions: 1,
        attentionExceptions: 4,
        overrides: 2,
      }),
      "1 record disagrees with the log.",
    );
  });

  it("puts something unaccounted for above a full roster", () => {
    assert.equal(
      headline({
        attentionExceptions: 2,
        roster: rosterMetric({ seated: 120, cap: 120, waitlistDepth: 3 }),
      }),
      "2 things are unaccounted for.",
    );
  });

  it("reports a full roster when nothing is wrong", () => {
    assert.equal(
      headline({
        roster: rosterMetric({ seated: 120, cap: 120, waitlistDepth: 3 }),
      }),
      "The roster is full. 3 waiting.",
    );
  });

  it("says nothing needs the founder when nothing does", () => {
    /* Not a summary of what is fine. A dashboard that always says something is
       a dashboard nobody reads — the same rule the exception list follows. */
    assert.equal(headline({}), "Nothing needs you today.");
  });

  it("counts in singular and plural correctly", () => {
    assert.equal(headline({ overrides: 1 }), "1 override in the last seven days.");
    assert.equal(headline({ overrides: 3 }), "3 overrides in the last seven days.");
    assert.equal(
      headline({ expiringSoon: 1 }),
      "1 document expires within ninety days.",
    );
  });
});
