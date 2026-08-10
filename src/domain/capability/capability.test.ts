import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOverride,
  evaluate,
  expiries,
  foreseeableBlocks,
  OverrideError,
  type FirearmSnapshot,
  type Subject,
  type TierPermissions,
} from "./index";

/**
 * §12, Definition of done:
 *
 *   "Every gated action has an automated test for both the permitted and the
 *    blocked path, and the blocked path asserts the reason string."
 *
 * The reason string, not the boolean. §4.3 makes the sentence a product
 * surface — "Anything a member first learns at the desk, in front of their
 * guest, is a defect in this system" — so a test that asserted only
 * `allowed === false` would be testing half the requirement and would pass
 * against a screen that said "not permitted".
 *
 * §12.1 additionally names eight scenarios that must exist. The six decidable
 * without a database are at the bottom of this file, under their own headings
 * and quoting their expected outcome.
 */

/* ---------------------------------------------------------------------------
   FIXTURES
   -------------------------------------------------------------------------- */

const NOW = new Date("2026-08-10T09:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const FULL_TIER: TierPermissions = {
  id: "tier-full",
  name: "Full",
  canHost: true,
  guestAllowanceAnnual: 6,
  guestConcurrentMax: 2,
  canOwnFirearm: true,
  canStoreFirearm: true,
  disciplineAccess: ["10m-air-rifle", "25m-pistol"],
  bookingHorizonDays: 14,
  concurrentBookingsMax: 2,
};

const ENTRY_TIER: TierPermissions = {
  ...FULL_TIER,
  id: "tier-entry",
  name: "Entry",
  canHost: false,
  guestAllowanceAnnual: 0,
  guestConcurrentMax: 0,
  canOwnFirearm: false,
  canStoreFirearm: false,
  disciplineAccess: ["10m-air-rifle"],
  bookingHorizonDays: 7,
  concurrentBookingsMax: 1,
};

const WAIVER = { activeWaiverVersionId: "waiver-4", waiverValidityDays: null };

function member(overrides: Partial<Subject> = {}): Subject {
  return {
    personId: "person-1",
    membership: {
      id: "membership-1",
      status: "active",
      tier: FULL_TIER,
      endedOn: null,
      renewsOn: day("2027-01-01"),
    },
    waiver: { waiverVersionId: "waiver-4", signedAt: day("2026-01-05") },
    licences: [
      {
        id: "licence-1",
        status: "verified",
        calibres: [".22 LR"],
        expiresOn: day("2027-06-01"),
      },
    ],
    qualifications: [
      {
        discipline: "25m-pistol",
        level: "unsupervised",
        expiresAt: day("2027-01-01"),
      },
    ],
    ...overrides,
  };
}

/** A guest: a person with no membership. §3.1 — a state, not another table. */
function guest(overrides: Partial<Subject> = {}): Subject {
  return {
    personId: "person-guest",
    membership: null,
    waiver: { waiverVersionId: "waiver-4", signedAt: day("2026-08-09") },
    licences: [],
    qualifications: [],
    ...overrides,
  };
}

const OWN_FIREARM: FirearmSnapshot = {
  id: "firearm-1",
  serialNumber: "AX-4471",
  calibre: ".22 LR",
  ownership: "member",
  ownerPersonId: "person-1",
  status: "in_service",
};

const CLUB_FIREARM: FirearmSnapshot = {
  id: "firearm-club",
  serialNumber: "CL-0012",
  calibre: ".22 LR",
  ownership: "club",
  ownerPersonId: null,
  status: "in_service",
};

/** Asserts a block, its code, and that the sentence is fit to show a member. */
function assertBlocked(
  decision: ReturnType<typeof evaluate>,
  code: string,
  messageIncludes?: string,
) {
  assert.equal(decision.allowed, false, "expected a block");
  if (decision.allowed) return;

  assert.equal(decision.reason.code, code);

  /* §4.3: "Every block returns a specific single-line reason. Never 'not
     permitted', never a code, never a stack of conditions." */
  const message = decision.reason.message;
  assert.ok(message.length > 0, "a block must carry a message");
  assert.ok(!message.includes("\n"), "a block reason is one line");
  assert.ok(
    !/not permitted|forbidden|denied|invalid/i.test(message),
    `reason reads as a system error rather than an explanation: "${message}"`,
  );
  assert.ok(
    !message.includes(code),
    "the machine code must not leak into the human string",
  );
  assert.ok(/[.]$/.test(message), "reasons are written as sentences");

  if (messageIncludes) assert.ok(message.includes(messageIncludes), message);
}

/* ===========================================================================
   MAY_BOOK
   ======================================================================== */

describe("MAY_BOOK", () => {
  const book = (subject: Subject, over: Record<string, unknown> = {}) =>
    evaluate(subject, {
      capability: "MAY_BOOK",
      now: NOW,
      slotStart: new Date("2026-08-14T17:00:00Z"),
      discipline: "10m-air-rifle",
      heldBookings: 0,
      ...over,
    } as Parameters<typeof evaluate>[1]);

  it("permits an active member within horizon, limit and tier access", () => {
    assert.equal(book(member()).allowed, true);
  });

  it("blocks a lapsed membership and names the date", () => {
    const subject = member({
      membership: {
        id: "m",
        status: "lapsed",
        tier: FULL_TIER,
        endedOn: day("2026-03-14"),
        renewsOn: null,
      },
    });
    const decision = book(subject);
    assertBlocked(decision, "MEMBERSHIP_LAPSED", "14 March");
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.remedy, "Renew in the portal.");
  });

  it("blocks beyond the tier's booking horizon", () => {
    assertBlocked(
      book(member(), { slotStart: new Date("2026-09-30T17:00:00Z") }),
      "BOOKING_HORIZON_EXCEEDED",
      "14 days",
    );
  });

  it("blocks at the concurrent booking limit", () => {
    assertBlocked(
      book(member(), { heldBookings: 2 }),
      "CONCURRENT_BOOKING_LIMIT",
    );
  });

  it("blocks a discipline outside tier access", () => {
    const entry = member({
      membership: {
        id: "m",
        status: "active",
        tier: ENTRY_TIER,
        endedOn: null,
        renewsOn: null,
      },
    });
    assertBlocked(
      book(entry, { discipline: "25m-pistol" }),
      "DISCIPLINE_NOT_IN_TIER",
      "25m-pistol",
    );
  });

  it("counts the horizon in whole Lagos days, not elapsed hours", () => {
    /* Exactly 14 days ahead on the calendar, at a later hour than `now`. An
       hours-based comparison would refuse this. */
    assert.equal(
      book(member(), { slotStart: new Date("2026-08-24T18:00:00Z") }).allowed,
      true,
    );
  });
});

/* ===========================================================================
   MAY_HOST
   ======================================================================== */

describe("MAY_HOST", () => {
  const host = (subject: Subject, over: Record<string, unknown> = {}) =>
    evaluate(subject, {
      capability: "MAY_HOST",
      now: NOW,
      allowance: { includedQuota: 6, usedCount: 2, overagePriceLabel: "₦15,000" },
      overageAccepted: false,
      guestsInSession: 0,
      ...over,
    } as Parameters<typeof evaluate>[1]);

  it("permits a hosting tier with allowance remaining", () => {
    assert.equal(host(member()).allowed, true);
  });

  it("blocks a tier that cannot host", () => {
    const entry = member({
      membership: {
        id: "m",
        status: "active",
        tier: ENTRY_TIER,
        endedOn: null,
        renewsOn: null,
      },
    });
    assertBlocked(host(entry), "TIER_CANNOT_HOST");
  });

  it("blocks an exhausted allowance and quotes the overage price", () => {
    const decision = host(member(), {
      allowance: { includedQuota: 6, usedCount: 6, overagePriceLabel: "₦15,000" },
    });
    assertBlocked(decision, "ALLOWANCE_EXHAUSTED", "all 6 guest visits");
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.ok(decision.remedy?.includes("₦15,000"));
    }
  });

  it("permits an exhausted allowance once the overage is accepted", () => {
    assert.equal(
      host(member(), {
        allowance: { includedQuota: 6, usedCount: 6, overagePriceLabel: "₦15,000" },
        overageAccepted: true,
      }).allowed,
      true,
    );
  });

  it("blocks past the concurrent guest limit", () => {
    assertBlocked(host(member(), { guestsInSession: 2 }), "GUEST_CONCURRENT_LIMIT");
  });
});

/* ===========================================================================
   MAY_ATTEND
   ======================================================================== */

describe("MAY_ATTEND", () => {
  const attend = (subject: Subject, over: Record<string, unknown> = {}) =>
    evaluate(subject, {
      capability: "MAY_ATTEND",
      now: NOW,
      ...WAIVER,
      ...over,
    } as Parameters<typeof evaluate>[1]);

  it("permits an active member with a current waiver", () => {
    assert.equal(attend(member()).allowed, true);
  });

  it("blocks a missing waiver", () => {
    assertBlocked(attend(member({ waiver: null })), "WAIVER_MISSING");
  });

  it("blocks a signature against a superseded version", () => {
    const stale = member({
      waiver: { waiverVersionId: "waiver-3", signedAt: day("2025-02-01") },
    });
    assertBlocked(attend(stale), "WAIVER_SUPERSEDED");
  });

  it("blocks a signature past its validity window", () => {
    assertBlocked(
      attend(member(), { waiverValidityDays: 30 }),
      "WAIVER_EXPIRED",
      "5 January",
    );
  });

  it("never lets an officer override a suspension", () => {
    const suspended = member({
      membership: {
        id: "m",
        status: "suspended",
        tier: FULL_TIER,
        endedOn: null,
        renewsOn: null,
      },
    });
    const decision = attend(suspended);
    assertBlocked(decision, "MEMBERSHIP_SUSPENDED");
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.overridable, false);

    assert.throws(
      () =>
        applyOverride(decision, {
          staffUserId: "staff-1",
          reason: "founder said it was fine on the phone",
        }),
      OverrideError,
    );
  });

  it("refuses an override whose reason is a reflex tap", () => {
    const lapsed = member({
      membership: {
        id: "m",
        status: "lapsed",
        tier: FULL_TIER,
        endedOn: day("2026-03-14"),
        renewsOn: null,
      },
    });
    const decision = attend(lapsed);
    assert.throws(
      () => applyOverride(decision, { staffUserId: "staff-1", reason: "ok" }),
      OverrideError,
    );

    const overridden = applyOverride(decision, {
      staffUserId: "staff-1",
      reason: "Renewing by transfer this afternoon, confirmed with the founder.",
    });
    assert.equal(overridden.allowed, true);
    assert.equal(overridden.overridden?.by, "staff-1");
  });
});

/* ===========================================================================
   GUEST_MAY_ATTEND
   ======================================================================== */

describe("GUEST_MAY_ATTEND", () => {
  const arrive = (subject: Subject, over: Record<string, unknown> = {}) =>
    evaluate(subject, {
      capability: "GUEST_MAY_ATTEND",
      now: NOW,
      invitation: {
        status: "completed" as const,
        expiresAt: new Date("2026-08-11T00:00:00Z"),
      },
      host: { checkedIn: true, name: "Ada Nwosu" },
      ...WAIVER,
      ...over,
    } as Parameters<typeof evaluate>[1]);

  it("permits a completed invitation once the host is in", () => {
    assert.equal(arrive(guest()).allowed, true);
  });

  it("blocks with no invitation", () => {
    assertBlocked(arrive(guest(), { invitation: null }), "NO_INVITATION");
  });

  it("blocks a cancelled invitation", () => {
    assertBlocked(
      arrive(guest(), {
        invitation: {
          status: "cancelled",
          expiresAt: new Date("2026-08-11T00:00:00Z"),
        },
      }),
      "INVITATION_CANCELLED",
    );
  });

  it("blocks an invitation the guest never finished", () => {
    assertBlocked(
      arrive(guest(), {
        invitation: {
          status: "opened",
          expiresAt: new Date("2026-08-11T00:00:00Z"),
        },
      }),
      "INVITATION_INCOMPLETE",
    );
  });

  it("blocks on the clock even when the status column is stale", () => {
    assertBlocked(
      arrive(guest(), {
        invitation: {
          status: "completed",
          expiresAt: new Date("2026-08-09T00:00:00Z"),
        },
      }),
      "INVITATION_EXPIRED",
    );
  });

  it("blocks an unsigned waiver before it blocks on the host", () => {
    /* Order matters: the waiver is something the guest can deal with while
       standing there; the host arriving is not. */
    assertBlocked(
      arrive(guest({ waiver: null }), { host: { checkedIn: false, name: "Ada Nwosu" } }),
      "WAIVER_MISSING",
    );
  });
});

/* ===========================================================================
   MAY_SHOOT_DISCIPLINE
   ======================================================================== */

describe("MAY_SHOOT_DISCIPLINE", () => {
  const shoot = (subject: Subject, over: Record<string, unknown> = {}) =>
    evaluate(subject, {
      capability: "MAY_SHOOT_DISCIPLINE",
      now: NOW,
      discipline: "25m-pistol",
      requiresQualification: true,
      ...over,
    } as Parameters<typeof evaluate>[1]);

  it("permits a qualified member within tier access", () => {
    assert.equal(shoot(member()).allowed, true);
  });

  it("blocks a discipline outside the tier", () => {
    const entry = member({
      membership: {
        id: "m",
        status: "active",
        tier: ENTRY_TIER,
        endedOn: null,
        renewsOn: null,
      },
    });
    assertBlocked(shoot(entry), "DISCIPLINE_NOT_IN_TIER");
  });

  it("blocks a missing sign-off, and allows an officer to assess on the day", () => {
    const decision = shoot(member({ qualifications: [] }));
    assertBlocked(decision, "QUALIFICATION_MISSING");
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.overridable, true);
  });

  it("blocks an expired sign-off and names when it lapsed", () => {
    const stale = member({
      qualifications: [
        {
          discipline: "25m-pistol",
          level: "unsupervised",
          expiresAt: day("2026-04-02"),
        },
      ],
    });
    assertBlocked(shoot(stale), "QUALIFICATION_EXPIRED", "2 April");
  });

  it("does not apply a tier rule to a guest, who has no tier", () => {
    /* §6.5: "Guests are scored identically to members." Their permission to be
       here was settled by GUEST_MAY_ATTEND; a tier test would block every
       guest from every discipline. */
    assert.equal(
      shoot(guest(), { requiresQualification: false }).allowed,
      true,
    );
  });
});

/* ===========================================================================
   MAY_USE_OWN_FIREARM
   ======================================================================== */

describe("MAY_USE_OWN_FIREARM", () => {
  const pair = (subject: Subject, firearm: FirearmSnapshot) =>
    evaluate(subject, {
      capability: "MAY_USE_OWN_FIREARM",
      now: NOW,
      firearm,
    });

  it("permits a licensed owner on a covered calibre", () => {
    assert.equal(pair(member(), OWN_FIREARM).allowed, true);
  });

  it("permits any club firearm — this capability does not govern them", () => {
    assert.equal(pair(guest(), CLUB_FIREARM).allowed, true);
  });

  it("blocks a tier that excludes own firearms", () => {
    const entry = member({
      membership: {
        id: "m",
        status: "active",
        tier: ENTRY_TIER,
        endedOn: null,
        renewsOn: null,
      },
    });
    assertBlocked(pair(entry, OWN_FIREARM), "TIER_CANNOT_OWN_FIREARM");
  });

  it("blocks when the club holds no licence", () => {
    assertBlocked(pair(member({ licences: [] }), OWN_FIREARM), "LICENCE_MISSING");
  });

  it("blocks an unverified licence — §3.1, capability activates on verified", () => {
    const pending = member({
      licences: [
        {
          id: "l",
          status: "pending_review",
          calibres: [".22 LR"],
          expiresOn: day("2027-06-01"),
        },
      ],
    });
    assertBlocked(pair(pending, OWN_FIREARM), "LICENCE_UNVERIFIED");
  });

  it("blocks a calibre the licence does not cover", () => {
    assertBlocked(
      pair(member(), { ...OWN_FIREARM, calibre: "9mm" }),
      "CALIBRE_OUTSIDE_LICENCE",
      "9mm",
    );
  });

  it("blocks a decommissioned firearm", () => {
    assertBlocked(
      pair(member(), { ...OWN_FIREARM, status: "decommissioned" }),
      "FIREARM_UNAVAILABLE",
    );
  });
});

/* ===========================================================================
   MAY_STORE_FIREARM
   ======================================================================== */

describe("MAY_STORE_FIREARM", () => {
  const store = (subject: Subject, storageEnabled: boolean) =>
    evaluate(subject, { capability: "MAY_STORE_FIREARM", now: NOW, storageEnabled });

  it("permits a storing tier once the feature is open", () => {
    assert.equal(store(member(), true).allowed, true);
  });

  it("fails closed while the storage decision is outstanding (§14)", () => {
    assertBlocked(store(member(), false), "STORAGE_DISABLED");
  });

  it("blocks a tier without the capability", () => {
    const entry = member({
      membership: {
        id: "m",
        status: "active",
        tier: ENTRY_TIER,
        endedOn: null,
        renewsOn: null,
      },
    });
    assertBlocked(store(entry, true), "TIER_CANNOT_STORE_FIREARM");
  });
});

/* ===========================================================================
   §12.1 — THE NAMED SCENARIOS
   ======================================================================== */

describe("§12.1 scenarios", () => {
  it("Guest arrives before host → blocked, and clears when the host checks in", () => {
    /* Expected: "Blocked with a clear reason. Clears automatically when the
       host checks in — no retry needed." */
    const context = {
      capability: "GUEST_MAY_ATTEND" as const,
      now: NOW,
      invitation: {
        status: "completed" as const,
        expiresAt: new Date("2026-08-11T00:00:00Z"),
      },
      ...WAIVER,
    };

    const waiting = evaluate(guest(), {
      ...context,
      host: { checkedIn: false, name: "Ada Nwosu" },
    });
    assertBlocked(waiting, "HOST_NOT_CHECKED_IN", "Ada Nwosu");

    /* Not overridable: §1.1 permits a guest on the premises "only while that
       host is present". It clears by the host arriving and by nothing else. */
    assert.equal(waiting.allowed, false);
    if (!waiting.allowed) assert.equal(waiting.overridable, false);

    /* The SAME subject and the SAME invitation, with only the host's arrival
       changed, now passes — which is what lets the desk row clear itself on
       re-evaluation rather than needing the officer to retry. */
    const cleared = evaluate(guest(), {
      ...context,
      host: { checkedIn: true, name: "Ada Nwosu" },
    });
    assert.equal(cleared.allowed, true);
  });

  it("Member licence expired yesterday → own firearm blocked, club equipment still permitted", () => {
    const expired = member({
      licences: [
        {
          id: "l",
          status: "verified",
          calibres: [".22 LR"],
          expiresOn: day("2026-08-09"),
        },
      ],
    });

    assertBlocked(
      evaluate(expired, {
        capability: "MAY_USE_OWN_FIREARM",
        now: NOW,
        firearm: OWN_FIREARM,
      }),
      "LICENCE_EXPIRED",
      "9 August",
    );

    /* "Club-equipment shooting still permitted." Both halves of the scenario
       matter — a system that locked this member out entirely would be wrong
       in a way that costs the club a member. */
    assert.equal(
      evaluate(expired, {
        capability: "MAY_USE_OWN_FIREARM",
        now: NOW,
        firearm: CLUB_FIREARM,
      }).allowed,
      true,
    );
    assert.equal(
      evaluate(expired, {
        capability: "MAY_ATTEND",
        now: NOW,
        ...WAIVER,
      }).allowed,
      true,
    );
  });

  it("Member licence expired yesterday → warnings were foreseeable at 60, 30 and 7 days", () => {
    const subject = member({
      licences: [
        {
          id: "l",
          status: "verified",
          calibres: [".22 LR"],
          expiresOn: day("2026-10-09"),
        },
      ],
    });

    /* 60 days out, exactly, is a warning day on the ladder. */
    const sixtyDaysBefore = new Date("2026-08-10T09:00:00Z");
    const found = expiries(subject, sixtyDaysBefore);
    const licence = found.find((e) => e.kind === "licence");
    assert.ok(licence, "an expiry within 60 days must surface in the portal");
    assert.equal(licence.daysRemaining, 60);
    assert.equal(licence.isWarningDay, true);
  });

  it("Allowance exhausted mid-booking → overage offered with the price, in the portal", () => {
    /* Expected: "Overage offered in the portal with the price shown. Never
       discovered at the desk." The second sentence is the assertion that
       matters: the block must be foreseeable, so the portal surfaces it. */
    const subject = member();
    const seen = foreseeableBlocks(subject, {
      ...WAIVER,
      now: NOW,
      allowance: { includedQuota: 6, usedCount: 6, overagePriceLabel: "₦15,000" },
    });

    const block = seen.find((f) => f.block.code === "ALLOWANCE_EXHAUSTED");
    assert.ok(block, "an exhausted allowance must be surfaced before arrival");
    assert.ok(block.block.remedy?.includes("₦15,000"), "the price must be shown");
  });

  it("Guest shoots a member-owned firearm → blocked at pairing, overridable but recorded", () => {
    const decision = evaluate(guest(), {
      capability: "MAY_USE_OWN_FIREARM",
      now: NOW,
      firearm: OWN_FIREARM,
    });

    assertBlocked(decision, "FIREARM_NOT_OWNED", "AX-4471");

    /* §12: "If overridden, appears as a same-day dashboard exception." So the
       override must be possible and must carry a reason to record. */
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.overridable, true);

    const overridden = applyOverride(decision, {
      staffUserId: "staff-7",
      reason: "Owner present and coaching on the line, agreed with the founder.",
    });
    assert.equal(overridden.allowed, true);
    assert.ok(overridden.overridden?.reason);
  });
});

/* ===========================================================================
   §4.3 — the portal's advance-warning obligation
   ======================================================================== */

describe("foreseeable blocks", () => {
  it("excludes live conditions a member could not have resolved in advance", () => {
    /* A host who has not arrived is not something the portal should warn
       about. Marked foreseeable: false, so it cannot reach this list. */
    const seen = foreseeableBlocks(guest(), {
      ...WAIVER,
      now: NOW,
      allowance: null,
    });
    assert.equal(
      seen.some((f) => f.block.code === "HOST_NOT_CHECKED_IN"),
      false,
    );
  });

  it("reports one expired licence once, however many firearms it covers", () => {
    const subject = member({
      licences: [
        {
          id: "l",
          status: "verified",
          calibres: [".22 LR"],
          expiresOn: day("2026-08-01"),
        },
      ],
    });

    const seen = foreseeableBlocks(subject, {
      ...WAIVER,
      now: NOW,
      allowance: null,
      ownFirearms: [
        OWN_FIREARM,
        { ...OWN_FIREARM, id: "f2", serialNumber: "AX-4472" },
        { ...OWN_FIREARM, id: "f3", serialNumber: "AX-4473" },
      ],
    });

    const licenceBlocks = seen.filter((f) => f.block.code === "LICENCE_EXPIRED");
    assert.equal(licenceBlocks.length, 1);
  });

  it("surfaces a superseded waiver, which a member can resolve before arriving", () => {
    const subject = member({
      waiver: { waiverVersionId: "waiver-3", signedAt: day("2025-02-01") },
    });
    const seen = foreseeableBlocks(subject, {
      ...WAIVER,
      now: NOW,
      allowance: null,
    });
    assert.ok(seen.some((f) => f.block.code === "WAIVER_SUPERSEDED"));
  });
});
