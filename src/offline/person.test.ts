import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hydrate, type DayPack } from "./daypack";
import { personDetail } from "./person";

/**
 * §6.4: "Person detail — opened only when the officer needs it. Documents,
 *        history, current blocks with reasons."
 * §10:  "Licence scans readable only by the founder role. Not by range officers.
 *        NOT ON THE DESK OR LANE SURFACES."
 *
 * Those two sit in tension and this screen is where they meet. The tests below
 * are mostly about the second one — the first is satisfied by rendering, the
 * second is satisfied only by never having the data.
 */

const NOW = new Date("2026-08-10T09:00:00Z");

const TIER = {
  id: "tier-full",
  name: "Full",
  canHost: true,
  guestAllowanceAnnual: 6,
  guestConcurrentMax: 2,
  canOwnFirearm: true,
  canStoreFirearm: false,
  disciplineAccess: ["10m-air-rifle", "25m-pistol"],
  bookingHorizonDays: 14,
  concurrentBookingsMax: 2,
  active: true,
};

function pack(overrides: Partial<DayPack> = {}): DayPack {
  return {
    pulledAt: "2026-08-10T05:00:00.000Z",
    windowStart: "2026-08-10",
    windowEnd: "2026-08-11",
    activeWaiverVersionId: "waiver-4",
    waiverValidityDays: null,
    storageEnabled: false,
    disciplinesRequiringQualification: ["25m-pistol"],

    tiers: [TIER],
    people: [
      { id: "p-host", firstName: "Ada", lastName: "Nwosu", photoUrl: null },
      { id: "p-guest", firstName: "Bem", lastName: "Tarka", photoUrl: null },
    ],
    memberships: [
      {
        id: "m-1",
        personId: "p-host",
        tierId: "tier-full",
        memberNumber: 12,
        status: "active",
        endedOn: null,
        renewsOn: "2027-01-01",
      },
    ],
    licences: [
      {
        id: "l-1",
        personId: "p-host",
        status: "verified",
        calibres: [".22 LR"],
        expiresOn: "2027-06-01",
      },
    ],
    qualifications: [
      {
        personId: "p-host",
        discipline: "25m-pistol",
        level: "unsupervised",
        expiresAt: "2027-01-01",
      },
    ],
    waiverSignatures: [
      {
        personId: "p-host",
        waiverVersionId: "waiver-4",
        signedAt: "2026-01-05T10:00:00.000Z",
      },
    ],
    allowances: [
      {
        membershipId: "m-1",
        includedQuota: 6,
        usedCount: 2,
        overagePriceLabel: "₦15,000",
      },
    ],
    invitations: [],
    arrivals: [
      {
        personId: "p-host",
        bookingId: "b-1",
        sessionId: null,
        role: "member_shooter",
        discipline: "10m-air-rifle",
        slotStart: "2026-08-10T16:00:00.000Z",
        hostPersonId: null,
        invitationId: null,
      },
    ],
    firearms: [],
    ammunitionLots: [],
    lanes: [],
    staff: [],
    devices: [],
    ...overrides,
  };
}

const view = (overrides: Partial<DayPack> = {}, personId = "p-host") =>
  personDetail(hydrate(pack(overrides)), personId, NOW, new Set());

describe("§10 — no document reaches the desk", () => {
  it("carries no scan, key or link anywhere in the view", () => {
    /* Asserted over the serialised view rather than field by field, because the
       risk is a field nobody thought to check. If a document key is ever added
       to the pack, this fails wherever it surfaces. */
    const serialised = JSON.stringify(view());

    assert.doesNotMatch(serialised, /documentUrl/i);
    assert.doesNotMatch(serialised, /https?:\/\//);
    assert.doesNotMatch(serialised, /\.(pdf|jpe?g|png)/i);
  });

  it("still tells the officer what the licence establishes", () => {
    /* The point of the rule is that an officer does not need the scan, not that
       they are kept in the dark. They must be able to answer "may this member
       shoot their own pistol" from this screen. */
    const detail = view();
    const licence = detail?.documents.find((d) => d.kind === "licence");

    assert.ok(licence);
    assert.equal(licence.live, true);
    assert.match(licence.label, /\.22 LR/);
    assert.match(licence.state, /Verified/);
  });
});

describe("documents", () => {
  it("puts the waiver first, because it blocks everyone", () => {
    assert.equal(view()?.documents[0].kind, "waiver");
  });

  it("reads a signature against a superseded version as not current", () => {
    /* §3.1 keeps exactly one version active. The capability service treats a
       signature against any other as stale, and this screen must agree — an
       officer told "signed" who then watches the check-in refuse has been
       misled by the screen, not by the rule. */
    const detail = view({ activeWaiverVersionId: "waiver-5" });
    const waiver = detail?.documents[0];

    assert.equal(waiver?.live, false);
    assert.match(waiver?.state ?? "", /earlier version/);
  });

  it("calls an unverified licence what it is", () => {
    const detail = view({
      licences: [
        {
          id: "l-1",
          personId: "p-host",
          status: "pending_review",
          calibres: [".22 LR"],
          expiresOn: "2027-06-01",
        },
      ],
    });
    const licence = detail?.documents.find((d) => d.kind === "licence");

    assert.equal(licence?.live, false);
    /* §3.1: "Capability activates only on verified." The state says so in words
       an officer can repeat to the member. */
    assert.match(licence?.state ?? "", /grants nothing yet/);
  });

  it("trusts the clock over the status column", () => {
    /* The sweep maintains the column; between the expiry date and the sweep
       running it says `verified` and the licence is not. A screen that read the
       column would contradict the capability service, and the officer would
       believe the screen. */
    const detail = view({
      licences: [
        {
          id: "l-1",
          personId: "p-host",
          status: "verified",
          calibres: [".22 LR"],
          expiresOn: "2026-08-01",
        },
      ],
    });
    const licence = detail?.documents.find((d) => d.kind === "licence");

    assert.equal(licence?.live, false);
    assert.match(licence?.state ?? "", /Expired/);
  });
});

describe("blocks", () => {
  it("names what an unsigned waiver will stop, with a remedy", () => {
    const detail = view({ waiverSignatures: [] });

    assert.ok(detail);
    assert.ok(detail.blocks.length > 0, "an unsigned waiver produced no block");

    const block = detail.blocks[0];
    /* §4.3: a sentence, not a code, not a stack. */
    assert.doesNotMatch(block.message, /[A-Z]{3,}_[A-Z]{3,}/);
    assert.equal(block.message.trim().split("\n").length, 1);
  });

  it("says nothing for a member who is clear", () => {
    const detail = view();
    assert.equal(detail?.line, "");
    assert.deepEqual(detail?.blocks, []);
  });
});

describe("standing", () => {
  it("names the tier and member number for a member", () => {
    assert.match(view()?.standing ?? "", /Full · No\. 12/);
  });

  it("describes a guest as a guest rather than as a member with faults", () => {
    /* §3.1: a guest is a state of a person. "No tier" would read as something
       missing from their record rather than as what they are. */
    const detail = view({}, "p-guest");
    assert.match(detail?.standing ?? "", /Guest/);
  });
});

describe("history", () => {
  it("shows the window it has and admits that is all it has", () => {
    const detail = view();

    assert.equal(detail?.history.length, 1);
    /* §8.1 gives the pack two days. An officer who mistook this for the full
       record would draw the wrong conclusion about a member of ten years. */
    assert.equal(detail?.historyIsPartial, true);
  });
});

describe("a person the pack does not carry", () => {
  it("returns null rather than throwing", () => {
    /* The same reasoning as the unknown-arrival row in today.ts: the failure
       mode of a throw here is a blank desk, and §1.1's whole point is that the
       range keeps operating. */
    assert.equal(view({}, "p-nobody"), null);
  });
});
