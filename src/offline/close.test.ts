import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hydrate, type DayPack } from "./daypack";
import {
  buildSessionClose,
  closeStateFor,
  endOfDay,
  type LocalAmmunitionIssue,
  type LocalIssue,
  type SessionLocalState,
} from "./close";
import type { LocalParticipation } from "./checkin";

/**
 * §6.4:  "Session close — GUARDED. Lists everything outstanding. Cannot be
 *         forced without an override carrying a reason."
 * §12.1: "Session close with a firearm unreturned → Blocked. Lists the specific
 *         firearm. Override requires a reason and appears on the dashboard."
 * §3.4:  "qty_issued must equal qty_fired plus qty_returned at reconciliation."
 *
 * This is the guard that stops a range being locked with a firearm in somebody's
 * hands. Everything below is about it failing in the direction that matters.
 */

const NOW = new Date("2026-08-13T20:00:00.000Z");
const SESSION = "s-1";

function pack(): DayPack {
  return {
    pulledAt: "2026-08-13T05:00:00.000Z",
    windowStart: "2026-08-13",
    windowEnd: "2026-08-14",
    activeWaiverVersionId: "waiver-4",
    waiverValidityDays: null,
    storageEnabled: false,
    disciplinesRequiringQualification: [],
    tiers: [],
    people: [
      { id: "p-1", firstName: "Ada", lastName: "Nwosu", photoUrl: null },
      { id: "p-2", firstName: "Bem", lastName: "Tarka", photoUrl: null },
    ],
    memberships: [],
    licences: [],
    qualifications: [],
    waiverSignatures: [],
    allowances: [],
    invitations: [],
    arrivals: [],
    firearms: [],
    ammunitionLots: [],
    lanes: [],
    staff: [],
    devices: [],
  };
}

const participation = (
  id: string,
  personId: string,
  checkedOutAt: string | null,
): LocalParticipation => ({
  id,
  sessionId: SESSION,
  personId,
  role: "member_shooter",
  hostPersonId: null,
  laneId: "lane-1",
  tierSnapshot: null,
  checkedInAt: "2026-08-13T17:00:00.000Z",
    arrivalAt: null,
  checkedInByStaffId: "staff-1",
  checkedOutAt,
});

const issue = (serial: string, returnedAt: string | null): LocalIssue => ({
  custodyEventId: `ce-${serial}`,
  firearmId: `f-${serial}`,
  serialNumber: serial,
  personId: "p-1",
  sessionId: SESSION,
  returnedAt,
});

const ammo = (
  participationId: string,
  qtyIssued: number,
  qtyFired: number | null,
  qtyReturned: number | null,
): LocalAmmunitionIssue => ({
  issueId: `ai-${participationId}`,
  participationId,
  lotId: "lot-1",
  qtyIssued,
  qtyFired,
  qtyReturned,
});

const state = (overrides: Partial<SessionLocalState> = {}): SessionLocalState => ({
  sessionId: SESSION,
  participations: [participation("part-1", "p-1", "2026-08-13T19:00:00.000Z")],
  firearmIssues: [],
  ammunitionIssues: [],
  ...overrides,
});

const close = (
  local: SessionLocalState,
  override: { reason: string } | null = null,
) =>
  buildSessionClose(hydrate(pack()), local, {
    actorStaffId: "staff-1",
    now: NOW,
    override,
  });

describe("§12.1 — a firearm still out", () => {
  it("blocks the close", () => {
    const result = close(state({ firearmIssues: [issue("AB1234", null)] }));
    assert.equal(result.ok, false);
  });

  it("names the specific firearm, not just a count", () => {
    /* §12.1 says "lists the specific firearm". An officer at nine in the evening
       cannot act on "one firearm outstanding" — they need to know which rack to
       look at. */
    const result = close(state({ firearmIssues: [issue("AB1234", null)] }));
    if (result.ok) return assert.fail("expected a refusal");

    assert.equal(result.refusal.outstanding.length, 1);
    assert.match(result.refusal.outstanding[0], /AB1234/);
  });

  it("lets a returned firearm through", () => {
    const result = close(
      state({ firearmIssues: [issue("AB1234", "2026-08-13T19:30:00.000Z")] }),
    );
    assert.equal(result.ok, true);
  });
});

describe("everything outstanding, at once", () => {
  it("reports all three kinds in one list rather than the first one", () => {
    /* state-machines.ts: "An officer closing down at nine in the evening should
       get one list and clear it, not discover a second item after fixing the
       first." */
    const result = close(
      state({
        participations: [
          participation("part-1", "p-1", null),
          participation("part-2", "p-2", "2026-08-13T19:00:00.000Z"),
        ],
        firearmIssues: [issue("AB1234", null)],
        ammunitionIssues: [ammo("part-1", 40, null, null)],
      }),
    );

    if (result.ok) return assert.fail("expected a refusal");

    assert.equal(result.refusal.outstanding.length, 3);
    const joined = result.refusal.outstanding.join(" | ");
    assert.match(joined, /AB1234/);
    assert.match(joined, /Ada Nwosu/);
    assert.match(joined, /40 rounds/);
  });
});

describe("§3.4 — ammunition must add up", () => {
  it("blocks an issue that was never reconciled", () => {
    const result = close(state({ ammunitionIssues: [ammo("part-1", 40, null, null)] }));
    assert.equal(result.ok, false);
  });

  it("blocks an issue whose halves do not add up", () => {
    /* The quiet one. 30 fired plus 5 returned against 40 issued means five
       rounds are unaccounted for, and a check that only asked "were both fields
       filled in" would let it close. */
    const result = close(state({ ammunitionIssues: [ammo("part-1", 40, 30, 5)] }));

    if (result.ok) return assert.fail("expected a refusal");
    assert.match(result.refusal.outstanding[0], /35 of 40/);
  });

  it("lets a balanced issue through", () => {
    const result = close(state({ ammunitionIssues: [ammo("part-1", 40, 35, 5)] }));
    assert.equal(result.ok, true);
  });

  it("ignores an issue belonging to another session's shooter", () => {
    const result = close(state({ ammunitionIssues: [ammo("part-other", 40, null, null)] }));
    assert.equal(result.ok, true);
  });
});

describe("the override", () => {
  const blocked = state({ firearmIssues: [issue("AB1234", null)] });

  it("is permitted, because a range that cannot be locked is worse", () => {
    const result = close(blocked, {
      reason: "Firearm AB1234 signed out to the founder overnight; logged in the book.",
    });
    assert.equal(result.ok, true);
  });

  it("refuses a reason nobody could act on tomorrow", () => {
    const result = close(blocked, { reason: "ok" });

    if (result.ok) return assert.fail("expected a refusal");
    assert.match(result.refusal.reason, /read tomorrow morning/);
  });

  it("records what was left outstanding, not only the reason", () => {
    /* By the time a founder reads the audit row the session is closed and the
       list is gone. If the row does not carry it, nobody can ever reconstruct
       what was forced. */
    const result = close(blocked, {
      reason: "Firearm AB1234 signed out to the founder overnight; logged in the book.",
    });

    if (!result.ok) return assert.fail("expected a close");

    const payload = result.queue[0].payload as {
      isOverride: boolean;
      before: { outstanding: string[] };
      overrideReason: string;
    };

    assert.equal(payload.isOverride, true);
    assert.match(payload.before.outstanding[0], /AB1234/);
    assert.match(payload.overrideReason, /founder overnight/);
  });

  it("writes an ordinary audit row when nothing was forced", () => {
    const result = close(state());
    if (!result.ok) return assert.fail("expected a close");

    const payload = result.queue[0].payload as { isOverride: boolean };
    assert.equal(payload.isOverride, false);
  });
});

describe("the outstanding state", () => {
  it("counts only this session's participations", () => {
    const other: LocalParticipation = {
      ...participation("part-9", "p-2", null),
      sessionId: "s-other",
    };

    const built = closeStateFor(
      hydrate(pack()),
      state({ participations: [participation("part-1", "p-1", null), other] }),
    );

    assert.deepEqual(built.missingCheckouts, ["Ada Nwosu"]);
  });
});

describe("end of day — §6.4", () => {
  it("is not clear while a firearm is out", () => {
    const summary = endOfDay(
      hydrate(pack()),
      [state({ firearmIssues: [issue("AB1234", null)] })],
      0,
    );

    assert.equal(summary.clear, false);
    assert.match(
      summary.lines.find((l) => l.label === "Firearms")?.detail ?? "",
      /AB1234/,
    );
  });

  it("reconciles ammunition issued against fired and returned", () => {
    const summary = endOfDay(
      hydrate(pack()),
      [state({ ammunitionIssues: [ammo("part-1", 40, 30, 5)] })],
      0,
    );

    const line = summary.lines.find((l) => l.label === "Ammunition");
    assert.match(line?.detail ?? "", /40 issued, 30 fired, 5 returned/);
    assert.match(line?.detail ?? "", /5 unaccounted for/);
    assert.equal(line?.outstanding, true);
  });

  it("shows the queue depth without letting it block the range", () => {
    /* §8 designs for a range that runs for days without an uplink. A rule that
       refused to lock up until the queue drained would strand an officer
       because the internet is down — which is the one thing §1.1 says the
       system must never do. */
    const summary = endOfDay(hydrate(pack()), [state()], 12);

    const line = summary.lines.find((l) => l.label === "Sync queue");
    assert.match(line?.detail ?? "", /12 records waiting/);
    assert.equal(line?.outstanding, false);
    assert.equal(summary.clear, true);
  });

  it("clears when everything is in", () => {
    const summary = endOfDay(
      hydrate(pack()),
      [
        state({
          firearmIssues: [issue("AB1234", "2026-08-13T19:30:00.000Z")],
          ammunitionIssues: [ammo("part-1", 40, 35, 5)],
        }),
      ],
      0,
    );

    assert.equal(summary.clear, true);
  });
});
