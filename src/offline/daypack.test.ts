import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluate, type Subject } from "@/domain/capability";
import {
  allowanceFor,
  arrivalsFor,
  assertNoRestrictedFields,
  firearmBySerial,
  hydrate,
  requiresQualification,
  subjectFor,
  type DayPack,
} from "./daypack";

/**
 * §8.1 — the day pack, and the thing it exists to make possible.
 *
 * §4: "No screen makes its own permission decision, and no permission check is
 * duplicated in the client and the server."
 * §8: the desk works "fully offline. Not read-only — fully."
 *
 * Those two together mean the desk must reach the SAME decision offline that
 * the server would reach online — not an approximation, and not a cached copy
 * of an answer computed earlier. The parity tests below are the assertion that
 * it does.
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
      { personId: "p-host", waiverVersionId: "waiver-4", signedAt: "2026-01-05T10:00:00.000Z" },
      { personId: "p-guest", waiverVersionId: "waiver-4", signedAt: "2026-08-09T18:00:00.000Z" },
    ],
    allowances: [
      {
        membershipId: "m-1",
        includedQuota: 6,
        usedCount: 2,
        overagePriceLabel: "₦15,000",
      },
    ],
    invitations: [
      {
        id: "inv-1",
        hostMembershipId: "m-1",
        hostPersonId: "p-host",
        guestPersonId: "p-guest",
        bookingId: "b-1",
        status: "completed",
        expiresAt: "2026-08-11T00:00:00.000Z",
        isChargeable: false,
      },
    ],
    arrivals: [
      {
        personId: "p-guest",
        bookingId: "b-1",
        sessionId: null,
        role: "guest_shooter",
        discipline: "10m-air-rifle",
        slotStart: "2026-08-10T17:00:00.000Z",
        hostPersonId: "p-host",
        invitationId: "inv-1",
      },
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
    firearms: [
      {
        id: "f-1",
        serialNumber: "AX-4471",
        make: "Walther",
        model: "LG400",
        calibre: ".22 LR",
        ownership: "member",
        ownerPersonId: "p-host",
        status: "in_service",
      },
      {
        id: "f-2",
        serialNumber: "CL-0012",
        make: "Anschutz",
        model: "1907",
        calibre: ".22 LR",
        ownership: "club",
        ownerPersonId: null,
        status: "in_service",
      },
    ],
    ammunitionLots: [{ id: "lot-1", calibre: ".22 LR", quantityRemaining: 460 }],
    lanes: [],
    staff: [
      {
        id: "s-1",
        personId: "p-host",
        displayName: "Ada N.",
        role: "range_officer",
        active: true,
      },
    ],
    devices: [{ id: "d-1", label: "Desk tablet", surface: "desk", revoked: false }],
    ...overrides,
  };
}

/* ===========================================================================
   THE PARITY GUARANTEE — §4 + §8
   ======================================================================== */

describe("offline decisions equal server decisions", () => {
  const WAIVER = { activeWaiverVersionId: "waiver-4", waiverValidityDays: null };

  /** The Subject a server would assemble from Postgres for the same person. */
  const serverSubject: Subject = {
    personId: "p-host",
    membership: {
      id: "m-1",
      status: "active",
      tier: {
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
      },
      endedOn: null,
      renewsOn: new Date("2027-01-01"),
    },
    waiver: {
      waiverVersionId: "waiver-4",
      signedAt: new Date("2026-01-05T10:00:00.000Z"),
    },
    licences: [
      {
        id: "l-1",
        status: "verified",
        calibres: [".22 LR"],
        expiresOn: new Date("2027-06-01"),
      },
    ],
    qualifications: [
      {
        discipline: "25m-pistol",
        level: "unsupervised",
        expiresAt: new Date("2027-01-01"),
      },
    ],
  };

  it("builds a Subject indistinguishable from the server's", () => {
    const offline = subjectFor(hydrate(pack()), "p-host");
    assert.deepEqual(offline, serverSubject);
  });

  it("reaches the identical decision, including the exact sentence", () => {
    const offline = subjectFor(hydrate(pack()), "p-host");
    assert.ok(offline);

    /* Run every capability both ways and compare the whole decision object —
       allowed, reason code, message, remedy, overridable. §4.1 makes the
       string part of the contract, so comparing booleans would not be
       testing the requirement. */
    const contexts = [
      {
        capability: "MAY_ATTEND" as const,
        now: NOW,
        ...WAIVER,
      },
      {
        capability: "MAY_BOOK" as const,
        now: NOW,
        slotStart: new Date("2026-08-14T17:00:00Z"),
        discipline: "10m-air-rifle",
        heldBookings: 0,
      },
      {
        capability: "MAY_SHOOT_DISCIPLINE" as const,
        now: NOW,
        discipline: "25m-pistol",
        requiresQualification: true,
      },
      {
        capability: "MAY_STORE_FIREARM" as const,
        now: NOW,
        storageEnabled: false,
      },
    ];

    for (const context of contexts) {
      assert.deepEqual(
        evaluate(offline, context),
        evaluate(serverSubject, context),
        `${context.capability} diverged between desk and server`,
      );
    }
  });

  it("blocks identically, sentence for sentence, when a licence has expired", () => {
    const expired = pack({
      licences: [
        {
          id: "l-1",
          personId: "p-host",
          status: "verified",
          calibres: [".22 LR"],
          expiresOn: "2026-08-09",
        },
      ],
    });

    const offline = subjectFor(hydrate(expired), "p-host");
    assert.ok(offline);

    const serverEquivalent: Subject = {
      ...serverSubject,
      licences: [
        {
          id: "l-1",
          status: "verified",
          calibres: [".22 LR"],
          expiresOn: new Date("2026-08-09"),
        },
      ],
    };

    const context = {
      capability: "MAY_USE_OWN_FIREARM" as const,
      now: NOW,
      firearm: firearmBySerial(hydrate(expired), "AX-4471")!,
    };

    const deskDecision = evaluate(offline, context);
    assert.deepEqual(deskDecision, evaluate(serverEquivalent, context));
    assert.equal(deskDecision.allowed, false);
    if (!deskDecision.allowed) {
      assert.equal(deskDecision.reason.code, "LICENCE_EXPIRED");
      assert.match(deskDecision.reason.message, /9 August/);
    }
  });
});

/* ===========================================================================
   THE HOST-PRESENCE RULE, DECIDED OFFLINE — §4, §12.1
   ======================================================================== */

describe("the desk decides the host-presence rule with no network", () => {
  it("blocks the guest, then clears when the host checks in", () => {
    const indexed = hydrate(pack());
    const guest = subjectFor(indexed, "p-guest");
    assert.ok(guest);
    assert.equal(guest.membership, null, "a guest is a person with no membership");

    const invitation = indexed.invitationById.get("inv-1");
    assert.ok(invitation);

    const base = {
      capability: "GUEST_MAY_ATTEND" as const,
      now: NOW,
      invitation: {
        status: invitation.status,
        expiresAt: new Date(invitation.expiresAt),
      },
      activeWaiverVersionId: indexed.pack.activeWaiverVersionId,
      waiverValidityDays: indexed.pack.waiverValidityDays,
    };

    const host = indexed.personById.get("p-host");
    const hostName = host ? `${host.firstName} ${host.lastName}` : null;

    const waiting = evaluate(guest, {
      ...base,
      host: { checkedIn: false, name: hostName },
    });
    assert.equal(waiting.allowed, false);
    if (!waiting.allowed) {
      assert.equal(waiting.reason.code, "HOST_NOT_CHECKED_IN");
      assert.match(waiting.reason.message, /Ada Nwosu/);
    }

    const cleared = evaluate(guest, {
      ...base,
      host: { checkedIn: true, name: hostName },
    });
    assert.equal(cleared.allowed, true);
  });
});

/* ===========================================================================
   §10 — WHAT MUST NOT BE ON THE DEVICE
   ======================================================================== */

describe("§10 restricted fields", () => {
  it("accepts a well-formed pack", () => {
    assert.doesNotThrow(() => assertNoRestrictedFields(pack()));
  });

  it("rejects a pack carrying a licence document", () => {
    /* §10: "Licence scans readable only by the founder role. Not by range
       officers. Not on the desk or lane surfaces." The type makes this
       unrepresentable in TypeScript; this guard covers the pack arriving as
       JSON, where TypeScript is not present. */
    const bad = pack();
    const licences = [
      { ...bad.licences[0], documentUrl: "s3://licences/ng-1.pdf" },
    ] as unknown as DayPack["licences"];

    assert.throws(
      () => assertNoRestrictedFields({ ...bad, licences }),
      /documentUrl/,
    );
  });

  it("rejects a pack carrying home addresses or next of kin", () => {
    const bad = pack();
    const people = [
      { ...bad.people[0], address: "12 Aso Drive, Maitama" },
    ] as unknown as DayPack["people"];

    assert.throws(() => assertNoRestrictedFields({ ...bad, people }), /address/);

    const withKin = [
      { ...bad.people[0], emergencyContactPhone: "+2348000000000" },
    ] as unknown as DayPack["people"];
    assert.throws(
      () => assertNoRestrictedFields({ ...bad, people: withKin }),
      /emergencyContactPhone/,
    );
  });

  it("rejects a pack carrying a staff PIN hash or an invitation token", () => {
    const bad = pack();
    const staff = [
      { ...bad.staff[0], pinHash: "$argon2id$..." },
    ] as unknown as DayPack["staff"];
    assert.throws(() => assertNoRestrictedFields({ ...bad, staff }), /pinHash/);

    const invitations = [
      { ...bad.invitations[0], tokenHash: "abc123" },
    ] as unknown as DayPack["invitations"];
    assert.throws(
      () => assertNoRestrictedFields({ ...bad, invitations }),
      /tokenHash/,
    );
  });

  it("finds a restricted field however deeply it is nested", () => {
    const bad = pack() as unknown as Record<string, unknown>;
    bad.extra = { nested: [{ deeper: { document_url: "s3://x" } }] };
    assert.throws(
      () => assertNoRestrictedFields(bad as unknown as DayPack),
      /document_url/,
    );
  });
});

/* ===========================================================================
   LOOKUPS
   ======================================================================== */

describe("pack lookups", () => {
  it("orders arrivals by time (§6.4)", () => {
    const arrivals = arrivalsFor(hydrate(pack()), "2026-08-10");
    assert.deepEqual(
      arrivals.map((a) => a.personId),
      ["p-host", "p-guest"],
      "the host's 4pm slot precedes the guest's 5pm",
    );
  });

  it("returns nothing for a day outside the window", () => {
    assert.deepEqual(arrivalsFor(hydrate(pack()), "2026-09-01"), []);
  });

  it("finds a firearm by the serial an officer will actually type", () => {
    const found = firearmBySerial(hydrate(pack()), "AX-4471");
    assert.equal(found?.ownership, "member");
    assert.equal(firearmBySerial(hydrate(pack()), "NOPE"), null);
  });

  it("reads the qualification rule from the pack, not from a hard-coded list", () => {
    const indexed = hydrate(pack());
    assert.equal(requiresQualification(indexed, "25m-pistol"), true);
    assert.equal(requiresQualification(indexed, "10m-air-rifle"), false);
  });

  it("exposes the host's allowance for MAY_HOST", () => {
    const allowance = allowanceFor(hydrate(pack()), "m-1");
    assert.equal(allowance?.usedCount, 2);
    assert.equal(allowance?.overagePriceLabel, "₦15,000");
  });

  it("returns null for a person the pack does not know", () => {
    assert.equal(subjectFor(hydrate(pack()), "p-stranger"), null);
  });

  it("degrades to no-membership rather than throwing on a missing tier", () => {
    /* Should be impossible — the pack carries every active tier. But a blank
       Today screen at eight in the morning is a much worse failure than one
       person showing an overridable block. */
    const orphaned = pack({ tiers: [] });
    const subject = subjectFor(hydrate(orphaned), "p-host");
    assert.ok(subject);
    assert.equal(subject.membership, null);
  });
});
