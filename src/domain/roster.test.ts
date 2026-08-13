import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ROSTER_POLICY,
  moveTo,
  nextPosition,
  occupiesSeat,
  renumber,
  rosterStanding,
  rosterSummary,
  type RosterMembership,
  type RosterPolicy,
  type WaitlistEntry,
} from "./roster";
import { applicationTransition } from "./state-machines";

/**
 * §1.1: "The roster has a hard cap; a waitlist sits behind it."
 * §5:   "Admission requires roster headroom or an explicit founder override."
 * §12:  "Roster at cap, application admitted → Blocked, or admitted only with
 *        explicit founder override recorded."
 * §3.1: "position maintained server-side. Never derived from a client sort."
 *
 * §14 leaves the cap NUMBER open. These tests are about everything else: what
 * counts as occupying a seat, what happens at the boundary, and the promise the
 * waitlist makes about fairness.
 */

const seat = (
  status: RosterMembership["status"],
  isAttached = false,
): RosterMembership => ({ status, isAttached });

const policy = (overrides: Partial<RosterPolicy> = {}): RosterPolicy => ({
  ...DEFAULT_ROSTER_POLICY,
  cap: 10,
  ...overrides,
});

describe("what occupies a seat", () => {
  it("counts an active member", () => {
    assert.equal(occupiesSeat(seat("active"), policy()), true);
  });

  it("counts a suspended member", () => {
    /* A suspension is a sanction, not a departure. The member is expected back
       and their seat is not offered to the waitlist in the meantime. */
    assert.equal(occupiesSeat(seat("suspended"), policy()), true);
  });

  it("counts an admitted member who has not yet paid", () => {
    /* §5: "pending → active (on payment)". If pending did not count, the club
       could admit past its cap by admitting faster than people pay — and find
       out when they all paid. */
    assert.equal(occupiesSeat(seat("pending"), policy()), true);
  });

  it("frees the seat when a member lapses or resigns", () => {
    /* The entire point of a cap with a waitlist behind it: a seat returns. */
    assert.equal(occupiesSeat(seat("lapsed"), policy()), false);
    assert.equal(occupiesSeat(seat("resigned"), policy()), false);
  });

  it("counts a Partner membership by default", () => {
    assert.equal(occupiesSeat(seat("active", true), policy()), true);
  });

  it("can be told not to, when the founder settles §14 the other way", () => {
    assert.equal(
      occupiesSeat(seat("active", true), policy({ countAttached: false })),
      false,
    );
  });
});

describe("standing against the cap", () => {
  it("reports the seats that are free", () => {
    const standing = rosterStanding(
      [seat("active"), seat("active"), seat("pending")],
      policy({ cap: 10 }),
    );

    assert.equal(standing.occupied, 3);
    assert.equal(standing.headroom, 7);
    assert.equal(standing.atCap, false);
  });

  it("is at cap when the last seat goes", () => {
    const standing = rosterStanding(
      Array.from({ length: 10 }, () => seat("active")),
      policy({ cap: 10 }),
    );

    assert.equal(standing.headroom, 0);
    assert.equal(standing.atCap, true);
    assert.equal(standing.overCap, 0);
  });

  it("reports how far over the cap an override has taken the club", () => {
    /* §12 permits admitting past the cap with a recorded override, so over-cap
       is a state the club can legitimately be in — and §6.6 has to show it. */
    const standing = rosterStanding(
      Array.from({ length: 12 }, () => seat("active")),
      policy({ cap: 10 }),
    );

    assert.equal(standing.overCap, 2);
    assert.equal(standing.headroom, 0);
  });

  it("returns null headroom rather than infinity when no cap is set", () => {
    /* §14's open item. Null is "nobody has decided", which the caller must
       handle deliberately — a large number here would silently admit everybody
       and look like a working cap. */
    const standing = rosterStanding([seat("active")], policy({ cap: null }));

    assert.equal(standing.headroom, null);
    assert.equal(standing.atCap, false);
  });
});

describe("§12.1 — roster at cap, application admitted", () => {
  const atCap = { rosterHeadroom: 0 } as const;

  it("is blocked without an override", () => {
    const transition = applicationTransition("under_review", {
      type: "admit",
      ...atCap,
    });

    assert.equal(transition.ok, false);
    if (transition.ok) return;
    assert.equal(transition.code, "ROSTER_AT_CAP");
    assert.equal(transition.overridable, true);
    /* §4.3: a sentence that says what to do. */
    assert.match(transition.message, /founder override/);
  });

  it("goes through with an explicit founder override", () => {
    const transition = applicationTransition("under_review", {
      type: "admit",
      ...atCap,
      founderOverride: {
        staffUserId: "staff-1",
        reason: "Founding member promised a place before the cap was set.",
      },
    });

    assert.equal(transition.ok, true);
  });

  it("admits from the waitlist when a seat frees up", () => {
    const transition = applicationTransition("waitlisted", {
      type: "admit",
      rosterHeadroom: 1,
    });

    assert.equal(transition.ok, true);
    if (!transition.ok) return;
    assert.equal(transition.to, "admitted");
    /* Both effects: issue the membership, and take them off the queue. */
    assert.deepEqual(
      transition.effects.map((effect) => effect.kind).sort(),
      ["close_waitlist_entry", "issue_membership"],
    );
  });
});

describe("the waitlist keeps its promise", () => {
  const entry = (id: string, position: number, minute: number): WaitlistEntry => ({
    id,
    position,
    addedAt: new Date(Date.UTC(2026, 7, 13, 9, minute)),
  });

  it("renumbers to a contiguous queue after someone is admitted", () => {
    /* A member told they are fourth, who watches two ahead of them join and
       remains fourth, has been told something untrue. */
    const remaining = [entry("b", 2, 1), entry("d", 4, 3), entry("e", 5, 4)];

    assert.deepEqual(renumber(remaining), [
      { id: "b", position: 1 },
      { id: "d", position: 2 },
      { id: "e", position: 3 },
    ]);
  });

  it("preserves the order people joined in", () => {
    const entries = [entry("c", 3, 2), entry("a", 1, 0), entry("b", 2, 1)];

    assert.deepEqual(
      renumber(entries).map((e) => e.id),
      ["a", "b", "c"],
    );
  });

  it("breaks a position tie the same way every time", () => {
    /* Ties should not occur. A renumber that resolved them differently on each
       run would silently shuffle the queue, which is the one thing a waitlist
       must never do. */
    const entries = [entry("z", 1, 5), entry("a", 1, 5)];

    assert.deepEqual(renumber(entries), renumber([...entries].reverse()));
  });

  it("adds new applicants to the back", () => {
    assert.equal(nextPosition([]), 1);
    assert.equal(nextPosition([entry("a", 1, 0), entry("b", 2, 1)]), 3);
  });

  it("moves someone up and pushes the rest along", () => {
    const entries = [
      entry("a", 1, 0),
      entry("b", 2, 1),
      entry("c", 3, 2),
      entry("d", 4, 3),
    ];

    assert.deepEqual(
      moveTo(entries, "d", 2).map((e) => e.id),
      ["a", "d", "b", "c"],
    );
  });

  it("clamps a target past the end rather than refusing it", () => {
    /* A founder dragging someone to "position 40" on a list of three means the
       bottom. Refusing that gesture would be pedantry about a clear intention. */
    const entries = [entry("a", 1, 0), entry("b", 2, 1), entry("c", 3, 2)];

    assert.deepEqual(
      moveTo(entries, "a", 40).map((e) => e.id),
      ["b", "c", "a"],
    );
  });

  it("leaves the queue alone when the entry is not on it", () => {
    const entries = [entry("a", 1, 0), entry("b", 2, 1)];
    assert.deepEqual(
      moveTo(entries, "nobody", 1).map((e) => e.id),
      ["a", "b"],
    );
  });
});

describe("the sentence on the founder's dashboard", () => {
  it("states seats free and waitlist depth", () => {
    const standing = rosterStanding([seat("active"), seat("active")], policy({ cap: 10 }));
    assert.equal(rosterSummary(standing, 3), "2 of 10 members, 8 seats free, 3 waiting.");
  });

  it("says plainly when the club is over its cap", () => {
    const standing = rosterStanding(
      Array.from({ length: 11 }, () => seat("active")),
      policy({ cap: 10 }),
    );
    assert.match(rosterSummary(standing, 0), /1 over, nobody waiting/);
  });

  it("does not invent a cap that has not been set", () => {
    const standing = rosterStanding([seat("active")], policy({ cap: null }));
    assert.match(rosterSummary(standing, 2), /no cap set/);
  });
});
