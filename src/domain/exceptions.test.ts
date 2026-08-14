import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  armouryExceptions,
  exceptionSummary,
  type AmmunitionRecord,
  type FirearmRecord,
  type LotRecord,
} from "./exceptions";

/**
 * §3.4: "Firearm status is derived from it, not maintained independently — IF
 *        THE TWO CAN DISAGREE, THEY EVENTUALLY WILL."
 * §6.6: the owner dashboard shows "reconciliation exceptions".
 * §12:  an override "appears on the founder's dashboard the same day".
 *
 * The risk this list runs is not missing something. It is reporting normal
 * operation until a founder stops reading it — so most of what follows is about
 * what must NOT appear.
 */

const NOW = new Date("2026-08-14T09:00:00.000Z");

const event = (
  eventType: FirearmRecord["custody"][number]["eventType"],
  iso: string,
) => ({
  id: `0199a1b2-c3d4-7e5f-8a9b-${iso.slice(11, 13)}1d2e3f4a5b`,
  eventType,
  occurredAt: new Date(iso),
  correctsEventId: null,
});

const firearm = (overrides: Partial<FirearmRecord> = {}): FirearmRecord => ({
  id: "f-1",
  serialNumber: "AB1234",
  status: "in_service",
  custody: [],
  lastMovedAt: null,
  ...overrides,
});

const run = (input: {
  firearms?: FirearmRecord[];
  ammunition?: AmmunitionRecord[];
  lots?: LotRecord[];
  forcedCloses?: Parameters<typeof armouryExceptions>[0]["forcedCloses"];
}) =>
  armouryExceptions({
    firearms: input.firearms ?? [],
    ammunition: input.ammunition ?? [],
    lots: input.lots ?? [],
    forcedCloses: input.forcedCloses ?? [],
    now: NOW,
  });

describe("§3.4 — the column against the log", () => {
  it("reports a firearm whose status disagrees with its custody events", () => {
    /* Should be impossible: `firearms.status` is written only by the trigger in
       drizzle/0002. Checked anyway, because §3.4's whole warning is about this
       pair and a check that never fires costs nothing. */
    const found = run({
      firearms: [
        firearm({
          status: "in_service",
          custody: [event("issued", "2026-08-14T08:00:00.000Z")],
          lastMovedAt: new Date("2026-08-14T08:00:00.000Z"),
        }),
      ],
    });

    const mismatch = found.find((e) => e.kind === "status_mismatch");
    assert.ok(mismatch);
    assert.equal(mismatch.severity, "integrity");
    assert.match(mismatch.line, /AB1234/);
    assert.match(mismatch.line, /in_service/);
    assert.match(mismatch.line, /issued/);
  });

  it("says nothing when they agree", () => {
    const found = run({
      firearms: [
        firearm({
          status: "issued",
          custody: [event("issued", "2026-08-14T08:00:00.000Z")],
          lastMovedAt: new Date("2026-08-14T08:00:00.000Z"),
        }),
      ],
    });

    assert.equal(found.filter((e) => e.kind === "status_mismatch").length, 0);
  });
});

describe("a firearm that is out", () => {
  it("is not an exception during a session", () => {
    /* A firearm being used is not a problem, and a list that said so would be
       a list of everyone currently shooting. */
    const found = run({
      firearms: [
        firearm({
          status: "issued",
          custody: [event("issued", "2026-08-14T08:00:00.000Z")],
          lastMovedAt: new Date("2026-08-14T08:00:00.000Z"),
        }),
      ],
    });

    assert.deepEqual(found, []);
  });

  it("becomes one once it has been out overnight", () => {
    const found = run({
      firearms: [
        firearm({
          status: "issued",
          custody: [event("issued", "2026-08-12T08:00:00.000Z")],
          lastMovedAt: new Date("2026-08-12T08:00:00.000Z"),
        }),
      ],
    });

    const out = found.find((e) => e.kind === "firearm_out");
    assert.ok(out);
    assert.match(out.line, /2 days/);
  });

  it("says nothing about one that is simply off site", () => {
    /* A member's own firearm that they took home. §3.4 has `taken_out` as a
       normal movement, and reporting it would make the list a list of members
       who own firearms. */
    const found = run({
      firearms: [
        firearm({
          status: "off_site",
          custody: [event("taken_out", "2026-08-01T08:00:00.000Z")],
          lastMovedAt: new Date("2026-08-01T08:00:00.000Z"),
        }),
      ],
    });

    assert.deepEqual(found, []);
  });
});

describe("§3.4 — ammunition that does not add up", () => {
  const issue = (overrides: Partial<AmmunitionRecord> = {}): AmmunitionRecord => ({
    issueId: "ai-1",
    shooter: "Ada Nwosu",
    qtyIssued: 40,
    qtyFired: 35,
    qtyReturned: 5,
    reconciledAt: new Date("2026-08-13T20:00:00.000Z"),
    issuedAt: new Date("2026-08-13T17:00:00.000Z"),
    ...overrides,
  });

  it("says nothing when the figures balance", () => {
    assert.deepEqual(run({ ammunition: [issue()] }), []);
  });

  it("names whose rounds are missing, not only that some are", () => {
    /* §3.4 reconciles per participation "because a per-day total cannot answer
       the only question that matters when it fails to balance: whose rounds are
       missing." */
    const found = run({
      ammunition: [issue({ qtyFired: 30, qtyReturned: 5 })],
    });

    assert.equal(found.length, 1);
    assert.match(found[0].line, /Ada Nwosu/);
    assert.match(found[0].line, /5 of 40/);
  });

  it("reports a count that is over as well as under", () => {
    const found = run({
      ammunition: [issue({ qtyFired: 40, qtyReturned: 5 })],
    });

    assert.match(found[0].line, /5 more rounds/);
  });

  it("ignores an issue that has not been reconciled yet", () => {
    /* An open session, not an exception. Reporting it would put every shooter
       currently on the range onto the founder's list. */
    const found = run({
      ammunition: [
        issue({ qtyFired: null, qtyReturned: null, reconciledAt: null }),
      ],
    });

    assert.deepEqual(found, []);
  });
});

describe("a lot that has issued more than it received", () => {
  it("is reported", () => {
    const found = run({
      lots: [
        {
          id: "lot-1",
          calibre: "9mm",
          quantityReceived: 1000,
          quantityRemaining: 0,
          quantityIssued: 1040,
        },
      ],
    });

    assert.equal(found.length, 1);
    assert.equal(found[0].severity, "integrity");
    assert.match(found[0].line, /1040 rounds from a delivery of 1000/);
  });

  it("is not reported when the lot is merely empty", () => {
    const found = run({
      lots: [
        {
          id: "lot-1",
          calibre: "9mm",
          quantityReceived: 1000,
          quantityRemaining: 0,
          quantityIssued: 1000,
        },
      ],
    });

    assert.deepEqual(found, []);
  });
});

describe("§12 — a forced close reaches the founder", () => {
  it("carries what was left outstanding and the reason given", () => {
    const found = run({
      forcedCloses: [
        {
          sessionId: "s-1",
          at: new Date("2026-08-13T21:00:00.000Z"),
          reason: "Firearm AB1234 signed out to the founder overnight.",
          outstanding: ["Firearm AB1234 is still out"],
        },
      ],
    });

    assert.equal(found.length, 1);
    assert.match(found[0].line, /AB1234/);
    assert.match(found[0].remedy ?? "", /founder overnight/);
  });
});

describe("the order and the summary", () => {
  it("puts records that do not add up above things that are merely late", () => {
    const found = run({
      firearms: [
        firearm({
          status: "issued",
          custody: [event("issued", "2026-08-12T08:00:00.000Z")],
          lastMovedAt: new Date("2026-08-12T08:00:00.000Z"),
        }),
      ],
      lots: [
        {
          id: "lot-1",
          calibre: "9mm",
          quantityReceived: 100,
          quantityRemaining: 0,
          quantityIssued: 140,
        },
      ],
    });

    assert.equal(found[0].severity, "integrity");
  });

  it("says so plainly when there is nothing to look at", () => {
    assert.equal(exceptionSummary([]), "Nothing outstanding in the armoury.");
  });

  it("distinguishes integrity problems in the summary", () => {
    const found = run({
      lots: [
        {
          id: "lot-1",
          calibre: "9mm",
          quantityReceived: 100,
          quantityRemaining: 0,
          quantityIssued: 140,
        },
      ],
      forcedCloses: [
        {
          sessionId: "s-1",
          at: NOW,
          reason: "Signed out overnight, logged in the book.",
          outstanding: ["Firearm AB1234 is still out"],
        },
      ],
    });

    assert.match(exceptionSummary(found), /1 record that do(es)? not add up|do not add up/);
  });
});
